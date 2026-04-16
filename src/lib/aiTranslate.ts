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
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_TRANSLATE_LINES = 2000;

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
// Content preparation
// ---------------------------------------------------------------------------

export function prepareContent(content: string): {
  text: string;
  truncated: boolean;
} {
  const lines = content.split('\n');
  if (lines.length <= MAX_TRANSLATE_LINES) {
    return { text: content, truncated: false };
  }
  return {
    text: lines.slice(0, MAX_TRANSLATE_LINES).join('\n'),
    truncated: true,
  };
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

  // 1. Truncate if needed
  const { text: preparedContent } = prepareContent(content);

  // 2. Build prompt
  const strategyKey = getStrategyKey(previewType);
  const strategy = PROMPT_STRATEGIES[strategyKey] ?? PROMPT_STRATEGIES.default;
  const targetLangName = getLanguageName(targetLang);

  const messages: ChatRequestMessage[] = [
    {
      role: 'system',
      content: strategy.systemPrompt.replace('{targetLang}', targetLangName),
    },
    {
      role: 'user',
      content: strategy.buildUserPrompt(preparedContent, targetLangName),
    },
  ];

  // 3. Call LLM with streaming
  try {
    const result = await streamChatCompletionWithTools(
      messages,
      config,
      { temperature: 0.3 },
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
}
