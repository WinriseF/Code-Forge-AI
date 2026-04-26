import { AIProviderConfig } from "@/types/model";
import { fetch } from '@tauri-apps/plugin-http';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string;
  attachments?: ChatMessageAttachment[];
  toolCalls?: ChatToolCallTrace[];
  assistantTrace?: ChatAssistantTraceItem[];
}

export interface ChatToolCallTrace {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  argumentsPreview?: string;
  resultPreview?: string;
  warnings?: string[];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

export type ChatAssistantTraceItem =
  | {
      id: string;
      type: 'reasoning';
      content: string;
    }
  | {
      id: string;
      type: 'tool';
      toolCallId: string;
    };

export type ChatMessageContent = string | ChatContentPart[];

export interface ChatMessageAttachment {
  id: string;
  kind: 'image' | 'file_text';
  name: string;
  mime: string;
  size: number;
  previewUrl?: string;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
      };
    };

export interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatMessageContent;
  tool_call_id?: string;
  tool_calls?: ChatCompletionToolCallPayload[];
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionToolCallPayload {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatCompletionResult {
  content: string;
  reasoning: string;
  toolCalls: ChatCompletionToolCall[];
  rawAssistantMessage: {
    role: 'assistant';
    content: string;
    tool_calls?: ChatCompletionToolCallPayload[];
  };
}

interface ChatCompletionOptions {
  tools?: ChatToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
}

interface ChatCompletionStreamCallbacks {
  onContentDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

interface ChatCompletionRequestError {
  status: number;
  text: string;
}

type ChatCompletionRequestResult =
  | { response: Response; error?: never }
  | { error: ChatCompletionRequestError; response?: never };

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('');
}

function normalizeDeltaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return normalizeAssistantContent(value);
  if (value && typeof value === 'object') {
    const text = (value as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function normalizeToolCalls(raw: unknown): ChatCompletionToolCall[] {
  if (!Array.isArray(raw)) return [];

  const normalized: ChatCompletionToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const id = (item as { id?: unknown }).id;
    const fn = (item as { function?: unknown }).function;
    if (typeof id !== 'string' || !fn || typeof fn !== 'object') continue;

    const name = (fn as { name?: unknown }).name;
    const args = (fn as { arguments?: unknown }).arguments;
    if (typeof name !== 'string') continue;

    normalized.push({
      id,
      name,
      arguments: typeof args === 'string' ? args : '{}',
    });
  }

  return normalized;
}

function normalizeToolCallPayload(raw: unknown): ChatCompletionToolCallPayload[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const payload: ChatCompletionToolCallPayload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const fn = (item as { function?: unknown }).function;
    if (typeof id !== 'string' || !fn || typeof fn !== 'object') continue;

    const name = (fn as { name?: unknown }).name;
    const args = (fn as { arguments?: unknown }).arguments;
    if (typeof name !== 'string') continue;

    payload.push({
      id,
      type: 'function',
      function: {
        name,
        arguments: typeof args === 'string' ? args : '{}',
      },
    });
  }

  return payload.length > 0 ? payload : undefined;
}

function toToolCallPayloadFromCalls(calls: ChatCompletionToolCall[]): ChatCompletionToolCallPayload[] | undefined {
  if (calls.length === 0) return undefined;
  return calls.map((call) => ({
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: call.arguments,
    },
  }));
}

function buildChatRequestBody(
  messages: ChatRequestMessage[],
  config: AIProviderConfig,
  options: ChatCompletionOptions,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages,
    stream,
    temperature: options.temperature ?? config.temperature,
  };

  const maxTokens = options.maxTokens ?? config.maxTokens;
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? 'auto';
  } else if (options.toolChoice) {
    body.tool_choice = options.toolChoice;
  }

  return body;
}

function parseChatCompletionPayload(payload: unknown): ChatCompletionResult {
  const choice = (payload as { choices?: unknown[] })?.choices?.[0];
  if (!choice || typeof choice !== 'object') {
    throw new Error("Empty choices in chat completion response.");
  }

  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    throw new Error("Missing assistant message in chat completion response.");
  }

  const rawContent = (message as { content?: unknown }).content;
  const rawReasoning =
    (message as { reasoning_content?: unknown }).reasoning_content ??
    (message as { reasoning?: unknown }).reasoning;
  const rawToolCalls = (message as { tool_calls?: unknown }).tool_calls;

  const content = normalizeAssistantContent(rawContent);
  const reasoning = normalizeDeltaText(rawReasoning);
  const toolCalls = normalizeToolCalls(rawToolCalls);
  const toolCallsPayload = normalizeToolCallPayload(rawToolCalls);

  return {
    content,
    reasoning,
    toolCalls,
    rawAssistantMessage: {
      role: 'assistant',
      content,
      tool_calls: toolCallsPayload,
    },
  };
}

interface StreamToolAccumulator {
  id?: string;
  name?: string;
  arguments: string;
}

function mergeToolCallDeltas(accumulators: Map<number, StreamToolAccumulator>, raw: unknown): void {
  if (!Array.isArray(raw)) return;

  for (let offset = 0; offset < raw.length; offset += 1) {
    const item = raw[offset];
    if (!item || typeof item !== 'object') continue;

    const rawIndex = (item as { index?: unknown }).index;
    const index = typeof rawIndex === 'number' && Number.isFinite(rawIndex)
      ? Math.max(0, Math.floor(rawIndex))
      : offset;

    const existing = accumulators.get(index) ?? { arguments: '' };
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) {
      existing.id = id;
    }

    const fn = (item as { function?: unknown }).function;
    if (fn && typeof fn === 'object') {
      const name = (fn as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) {
        existing.name = name;
      }

      const argsPart = (fn as { arguments?: unknown }).arguments;
      if (typeof argsPart === 'string') {
        existing.arguments += argsPart;
      }
    }

    accumulators.set(index, existing);
  }
}

function finalizeStreamToolCalls(accumulators: Map<number, StreamToolAccumulator>): ChatCompletionToolCall[] {
  if (accumulators.size === 0) return [];

  const sorted = Array.from(accumulators.entries()).sort((a, b) => a[0] - b[0]);
  const toolCalls: ChatCompletionToolCall[] = [];

  for (const [index, value] of sorted) {
    const name = value.name?.trim();
    if (!name) continue;

    toolCalls.push({
      id: value.id?.trim() || `tool_call_${index}`,
      name,
      arguments: value.arguments || '{}',
    });
  }

  return toolCalls;
}

function emitCompletionToStreamCallbacks(
  completion: ChatCompletionResult,
  callbacks: ChatCompletionStreamCallbacks
): void {
  if (completion.reasoning) {
    callbacks.onReasoningDelta?.(completion.reasoning);
  }
  if (completion.content) {
    callbacks.onContentDelta?.(completion.content);
  }
}

async function requestChatCompletion(
  messages: ChatRequestMessage[],
  config: AIProviderConfig,
  options: ChatCompletionOptions,
  stream: boolean
): Promise<Response> {
  const body = buildChatRequestBody(messages, config, options, stream);
  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function unwrapChatCompletionResponse(response: Response): Promise<ChatCompletionRequestResult> {
  if (response.ok) {
    return { response };
  }

  return {
    error: {
      status: response.status,
      text: await response.text(),
    },
  };
}

function extractChatCompletionErrorMessage(text: string): string {
  try {
    const payload = JSON.parse(text) as {
      message?: unknown;
      error?: {
        message?: unknown;
      };
    };
    if (typeof payload.error?.message === 'string' && payload.error.message.trim()) {
      return payload.error.message;
    }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    // Ignore invalid JSON and fall back to the raw text.
  }

  return text;
}

function shouldRetryWithoutStreaming(error: ChatCompletionRequestError): boolean {
  const normalized = extractChatCompletionErrorMessage(error.text).toLowerCase();
  if (!normalized.includes('stream')) {
    return false;
  }

  return error.status === 501
    || normalized.includes('not implemented')
    || normalized.includes('not supported')
    || normalized.includes('unsupported');
}

export async function streamChatCompletionWithTools(
  messages: ChatRequestMessage[],
  config: AIProviderConfig,
  options: ChatCompletionOptions = {},
  callbacks: ChatCompletionStreamCallbacks = {}
): Promise<ChatCompletionResult> {
  if (!config.apiKey) {
    throw new Error("API Key not configured. Please go to Settings.");
  }

  let responseResult = await unwrapChatCompletionResponse(
    await requestChatCompletion(messages, config, options, true)
  );

  if (responseResult.error) {
    if (!shouldRetryWithoutStreaming(responseResult.error)) {
      throw new Error(`API Error ${responseResult.error.status}: ${responseResult.error.text}`);
    }

    responseResult = await unwrapChatCompletionResponse(
      await requestChatCompletion(messages, config, options, false)
    );
    if (responseResult.error) {
      throw new Error(`API Error ${responseResult.error.status}: ${responseResult.error.text}`);
    }
  }

  const response = responseResult.response;

  if (!response.body) {
    const fallbackText = await response.text();
    let fallbackPayload: unknown;
    try {
      fallbackPayload = JSON.parse(fallbackText);
    } catch {
      throw new Error("No streaming body and invalid JSON response.");
    }
    const completion = parseChatCompletionPayload(fallbackPayload);
    emitCompletionToStreamCallbacks(completion, callbacks);
    return completion;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let nonSseBuffer = "";
  let sawSseData = false;
  let doneSignal = false;

  let content = '';
  let reasoning = '';
  let lastMessageContent = '';
  let lastMessageReasoning = '';
  let lastMessageToolCallsRaw: unknown = undefined;
  const toolAccumulators = new Map<number, StreamToolAccumulator>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (!trimmed.startsWith("data:")) {
        if (!sawSseData) {
          nonSseBuffer += trimmed;
        }
        continue;
      }

      sawSseData = true;
      const dataStr = trimmed.slice(5).trimStart();
      if (!dataStr) continue;
      if (dataStr === "[DONE]") {
        doneSignal = true;
        break;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        continue;
      }

      const choice = (payload as { choices?: unknown[] })?.choices?.[0];
      if (!choice || typeof choice !== 'object') continue;

      const delta = (choice as { delta?: unknown }).delta;
      if (delta && typeof delta === 'object') {
        const contentDelta = normalizeAssistantContent((delta as { content?: unknown }).content);
        const rawReasoningDelta =
          (delta as { reasoning_content?: unknown }).reasoning_content ??
          (delta as { reasoning?: unknown }).reasoning;
        const reasoningDelta = normalizeDeltaText(rawReasoningDelta);

        if (contentDelta) {
          content += contentDelta;
          callbacks.onContentDelta?.(contentDelta);
        }
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          callbacks.onReasoningDelta?.(reasoningDelta);
        }

        mergeToolCallDeltas(toolAccumulators, (delta as { tool_calls?: unknown }).tool_calls);
      }

      const message = (choice as { message?: unknown }).message;
      if (message && typeof message === 'object') {
        const messageContent = normalizeAssistantContent((message as { content?: unknown }).content);
        const rawMessageReasoning =
          (message as { reasoning_content?: unknown }).reasoning_content ??
          (message as { reasoning?: unknown }).reasoning;
        const messageReasoning = normalizeDeltaText(rawMessageReasoning);

        if (messageContent) {
          lastMessageContent = messageContent;
        }
        if (messageReasoning) {
          lastMessageReasoning = messageReasoning;
        }
        if ((message as { tool_calls?: unknown }).tool_calls !== undefined) {
          lastMessageToolCallsRaw = (message as { tool_calls?: unknown }).tool_calls;
        }
      }
    }

    if (doneSignal) break;
  }

  const streamTail = buffer.trim();
  if (!sawSseData) {
    const raw = `${nonSseBuffer}${streamTail}`.trim();
    if (!raw) {
      return {
        content: '',
        reasoning: '',
        toolCalls: [],
        rawAssistantMessage: {
          role: 'assistant',
          content: '',
        },
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("Invalid non-SSE response from chat completion API.");
    }

    const completion = parseChatCompletionPayload(payload);
    emitCompletionToStreamCallbacks(completion, callbacks);
    return completion;
  }

  const toolCallsFromStream = finalizeStreamToolCalls(toolAccumulators);
  const toolCalls = toolCallsFromStream.length > 0
    ? toolCallsFromStream
    : normalizeToolCalls(lastMessageToolCallsRaw);
  const toolCallsPayload = toToolCallPayloadFromCalls(toolCalls);

  const finalContent = content || lastMessageContent;
  const finalReasoning = reasoning || lastMessageReasoning;

  return {
    content: finalContent,
    reasoning: finalReasoning,
    toolCalls,
    rawAssistantMessage: {
      role: 'assistant',
      content: finalContent,
      tool_calls: toolCallsPayload,
    },
  };
}

export async function streamChatCompletion(
  messages: ChatRequestMessage[],
  config: AIProviderConfig,
  onChunk: (contentDelta: string, reasoningDelta: string) => void,
  onError: (err: string) => void,
  onFinish: () => void
) {
  try {
    await streamChatCompletionWithTools(
      messages,
      config,
      {},
      {
        onContentDelta: (delta) => {
          if (delta) onChunk(delta, '');
        },
        onReasoningDelta: (delta) => {
          if (delta) onChunk('', delta);
        },
      }
    );
    onFinish();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    onError(message || "Unknown error");
    onFinish();
  }
}
