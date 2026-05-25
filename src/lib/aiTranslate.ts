import { streamChatCompletionWithTools, type ChatRequestMessage } from '@/lib/llm';
import type { AIProviderConfig } from '@/types/model';
import type { PreviewType } from '@/types/hyperview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedLangCode =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'pt'
  | 'it'
  | 'ar'
  | 'th'
  | 'vi';

export interface LanguageOption {
  code: SupportedLangCode;
  label: string;
  nativeLabel: string;
}

export interface TranslateRequest {
  content: string;
  previewType: PreviewType;
  targetLang: SupportedLangCode;
  signal?: AbortSignal;
}

export interface TranslateCallbacks {
  onContentDelta: (text: string) => void;
  onChunkProgress?: (chunkIndex: number, totalChunks: number) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '中文', nativeLabel: 'Chinese' },
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'ja', label: '日本語', nativeLabel: 'Japanese' },
  { code: 'ko', label: '한국어', nativeLabel: 'Korean' },
  { code: 'fr', label: 'Français', nativeLabel: 'French' },
  { code: 'de', label: 'Deutsch', nativeLabel: 'German' },
  { code: 'es', label: 'Español', nativeLabel: 'Spanish' },
  { code: 'ru', label: 'Русский', nativeLabel: 'Russian' },
  { code: 'pt', label: 'Português', nativeLabel: 'Portuguese' },
  { code: 'it', label: 'Italiano', nativeLabel: 'Italian' },
  { code: 'ar', label: 'العربية', nativeLabel: 'Arabic' },
  { code: 'th', label: 'ไทย', nativeLabel: 'Thai' },
  { code: 'vi', label: 'Tiếng Việt', nativeLabel: 'Vietnamese' },
];

/** Maximum characters per translation chunk (~3000 ≈ 1000-2000 tokens). */
const MAX_CHUNK_CHARS = 3000;

// ---------------------------------------------------------------------------
// Prompt strategies
// ---------------------------------------------------------------------------

interface PromptStrategy {
  systemPrompt: string;
  buildUserPrompt: (content: string, targetLang: string) => string;
}

const PROMPT_STRATEGIES: Record<string, PromptStrategy> = {
  code: {
    systemPrompt:
      'You are a professional translation engine. Translate the following source code file. Translate ONLY comments, docstrings, and string literals into {targetLang}. Preserve all code structure, variable names, and formatting exactly. Do NOT translate code keywords or identifiers.',
    buildUserPrompt: (content, targetLang) =>
      `Translate all comments, docstrings and string literals into ${targetLang}:\n\n\`\`\`\n${content}\n\`\`\``,
  },
  markdown: {
    systemPrompt:
      'You are a professional translation engine. Translate the following Markdown document into {targetLang}. Preserve all Markdown formatting (headings, links, code blocks, lists, etc). Do NOT translate code blocks, URLs, or technical identifiers. Output pure translated Markdown.',
    buildUserPrompt: (content, targetLang) =>
      `Translate into ${targetLang}:\n\n${content}`,
  },
  image: {
    systemPrompt:
      'You are a professional translation engine. The following text was extracted from an image via OCR. Translate it into {targetLang}. Fix any OCR errors if obvious. Output only the translated text.',
    buildUserPrompt: (content, targetLang) =>
      `Translate the following OCR-extracted text into ${targetLang}:\n\n"""\n${content}\n"""`,
  },
  default: {
    systemPrompt:
      'You are a professional translation engine. Translate the following text into {targetLang}. Output only the translated text, preserving the original formatting and structure.',
    buildUserPrompt: (content, targetLang) =>
      `Translate into ${targetLang}:\n\n"""\n${content}\n"""`,
  },
};

function getStrategyKey(previewType: PreviewType): string {
  switch (previewType) {
    case 'code':
    case 'html':
      return 'code';
    case 'markdown':
      return 'markdown';
    case 'image':
      return 'image';
    case 'pdf':
    case 'docx':
    case 'office':
    default:
      return 'default';
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

interface TranslationChunk {
  text: string;
  separatorBefore: string;
}

/**
 * Split text into chunks at natural boundaries.
 * Priority: paragraphs → sentences → lines → characters.
 * Each chunk stays within `maxChars` and ends at a clean boundary.
 */
function splitIntoChunks(text: string, maxChars: number): TranslationChunk[] {
  if (text.length <= maxChars) return [{ text, separatorBefore: '' }];

  // Level 1: Split by paragraph boundaries (2+ newlines)
  return groupSeparatedPieces(
    splitWithSeparators(text, /\n{2,}/g),
    maxChars,
    splitOversized
  );
}

function splitWithSeparators(text: string, separatorPattern: RegExp): TranslationChunk[] {
  const chunks: TranslationChunk[] = [];
  let cursor = 0;
  let separatorBefore = '';

  for (const match of text.matchAll(separatorPattern)) {
    const separator = match[0];
    const index = match.index ?? 0;
    const segment = text.slice(cursor, index);

    if (segment) {
      chunks.push({ text: segment, separatorBefore });
      separatorBefore = separator;
    } else {
      separatorBefore += separator;
    }

    cursor = index + separator.length;
  }

  const tail = text.slice(cursor);
  if (tail) {
    chunks.push({ text: tail, separatorBefore });
  }

  return chunks;
}

function groupSeparatedPieces(
  pieces: TranslationChunk[],
  maxChars: number,
  splitOversizedPiece: (text: string, maxChars: number, separatorBefore: string) => TranslationChunk[]
): TranslationChunk[] {
  const chunks: TranslationChunk[] = [];
  let current = '';
  let currentSeparator = '';

  for (const piece of pieces) {
    if (piece.text.length > maxChars) {
      if (current) {
        chunks.push({ text: current, separatorBefore: currentSeparator });
        current = '';
        currentSeparator = '';
      }
      chunks.push(...splitOversizedPiece(piece.text, maxChars, piece.separatorBefore));
      continue;
    }

    const candidate = current ? `${current}${piece.separatorBefore}${piece.text}` : piece.text;
    if (candidate.length > maxChars && current) {
      chunks.push({ text: current, separatorBefore: currentSeparator });
      current = piece.text;
      currentSeparator = piece.separatorBefore;
    } else {
      if (!current) {
        currentSeparator = `${currentSeparator}${piece.separatorBefore}`;
      }
      current = candidate;
    }
  }

  if (current) {
    chunks.push({ text: current, separatorBefore: currentSeparator });
  }

  return chunks;
}

/**
 * Split oversized text: try sentences first, fall back to lines, then chars.
 * Sentence matches include trailing whitespace so concatenation preserves format.
 */
function splitOversized(text: string, maxChars: number, separatorBefore = ''): TranslationChunk[] {
  if (text.length <= maxChars) return [{ text, separatorBefore }];

  // Level 2: Split by sentence boundaries
  // Matches "content + punctuation + trailing whitespace"
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+\s*/g);

  if (sentences && sentences.length > 1) {
    // Capture trailing text not ending with punctuation
    const covered = sentences.join('');
    if (covered.length < text.length) {
      sentences.push(text.slice(covered.length));
    }
    return groupPieces(sentences, maxChars, separatorBefore);
  }

  // Level 3+4: No sentence boundaries — fall back to lines → chars
  return forceSplitLines(text, maxChars, separatorBefore);
}

/** Group small pieces into chunks of <= maxChars. Preserves original formatting. */
function groupPieces(pieces: string[], maxChars: number, separatorBefore = ''): TranslationChunk[] {
  const chunks: TranslationChunk[] = [];
  let current = '';
  let currentSeparator = separatorBefore;

  for (const piece of pieces) {
    if (piece.length > maxChars) {
      if (current) {
        chunks.push({ text: current, separatorBefore: currentSeparator });
        current = '';
        currentSeparator = '';
      }
      chunks.push(...forceSplitLines(piece, maxChars, currentSeparator));
    } else {
      const candidate = current + piece;
      if (candidate.length > maxChars && current) {
        chunks.push({ text: current, separatorBefore: currentSeparator });
        current = piece;
        currentSeparator = '';
      } else {
        current = candidate;
      }
    }
  }

  if (current) chunks.push({ text: current, separatorBefore: currentSeparator });
  return chunks;
}

/** Force-split by single newlines, then by character limit (last resort). */
function forceSplitLines(text: string, maxChars: number, separatorBefore = ''): TranslationChunk[] {
  return groupSeparatedPieces(
    splitWithSeparators(text, /\n/g),
    maxChars,
    forceSplitChars
  ).map((chunk, index) => ({
    ...chunk,
    separatorBefore: index === 0 ? `${separatorBefore}${chunk.separatorBefore}` : chunk.separatorBefore,
  }));
}

function forceSplitChars(text: string, maxChars: number, separatorBefore = ''): TranslationChunk[] {
  const chunks: TranslationChunk[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push({
      text: text.slice(i, i + maxChars),
      separatorBefore: i === 0 ? separatorBefore : '',
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Output sanitization
// ---------------------------------------------------------------------------

/**
 * Strip common LLM output artifacts: wrapping code fences, triple quotes,
 * and preamble phrases. Applied per-chunk to keep concatenated output clean.
 */
function sanitizeChunkOutput(text: string): string {
  let result = text.trim();

  // Strip wrapping code block markers (```lang ... ```)
  result = result.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '');
  // Strip wrapping triple quotes
  if (result.startsWith('"""') && result.endsWith('"""')) {
    result = result.slice(3, -3);
  } else if (result.startsWith('"""')) {
    result = result.slice(3);
  } else if (result.endsWith('"""')) {
    result = result.slice(0, -3);
  }

  return result.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLanguageName(code: SupportedLangCode): string {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang ? lang.nativeLabel : code;
}

// ---------------------------------------------------------------------------
// Core translate function
// ---------------------------------------------------------------------------

export async function translate(
  request: TranslateRequest,
  config: AIProviderConfig,
  callbacks: TranslateCallbacks,
): Promise<void> {
  const { content, previewType, targetLang, signal } = request;

  if (!content.trim()) {
    callbacks.onDone('');
    return;
  }

  const strategyKey = getStrategyKey(previewType);
  const strategy = PROMPT_STRATEGIES[strategyKey] ?? PROMPT_STRATEGIES.default;
  const targetLangName = getLanguageName(targetLang);
  const systemPrompt = strategy.systemPrompt.replace('{targetLang}', targetLangName);

  const chunks = splitIntoChunks(content, MAX_CHUNK_CHARS);

  // Short content — single request (original behaviour)
  if (chunks.length === 1) {
    const messages: ChatRequestMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: strategy.buildUserPrompt(content, targetLangName) },
    ];

    try {
      const result = await streamChatCompletionWithTools(
        messages,
        config,
        { temperature: 0.4 },
        {
          onContentDelta: (delta) => {
            if (signal?.aborted) return;
            callbacks.onContentDelta(delta);
          },
        },
      );

      if (!signal?.aborted) {
        callbacks.onDone(result.content);
      }
    } catch (err) {
      if (!signal?.aborted) {
        callbacks.onError(err instanceof Error ? err.message : String(err));
      }
    }
    return;
  }

  // Long content — serial chunked translation (OpenAI Cookbook best practice)
  // Each chunk is translated independently with the same clean prompt.
  // No overlap context — avoids repetition and format confusion.
  let fullTranslated = '';

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return;

    const messages: ChatRequestMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: strategy.buildUserPrompt(chunks[i].text, targetLangName) },
    ];

    const separator = chunks[i].separatorBefore;
    if (separator) {
      callbacks.onContentDelta(separator);
    }

    try {
      const result = await streamChatCompletionWithTools(
        messages,
        config,
        { temperature: 0.4 },
        {
          onContentDelta: (delta) => {
            if (signal?.aborted) return;
            callbacks.onContentDelta(delta);
          },
        },
      );

      if (signal?.aborted) return;

      const sanitized = sanitizeChunkOutput(result.content);
      fullTranslated += separator + sanitized;
      callbacks.onChunkProgress?.(i + 1, chunks.length);
    } catch (err) {
      if (!signal?.aborted) {
        callbacks.onError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
  }

  if (!signal?.aborted) {
    callbacks.onDone(fullTranslated);
  }
}
