import { useState, useRef, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChatAssistantTraceItem, ChatContentPart, ChatMessage, ChatMessageAttachment, ChatRequestMessage, ChatToolCallTrace } from '@/lib/llm';
import { useAppStore } from '@/store/useAppStore';
import { useSpotlight } from '../core/SpotlightContext';
import { assembleChatPrompt } from '@/lib/template';
import { ChatAttachment } from '@/types/spotlight';
import { runDefaultAgentTurn } from '@/lib/agent';
import type { AgentToolCallInfo, AgentToolExecutionResult } from '@/lib/agent/types';
import { useThrottledStreamUpdate } from '@/lib/hooks/useThrottledStreamUpdate';

function buildDisplayAttachments(attachments: ChatAttachment[]): ChatMessageAttachment[] {
  return attachments.map(item => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mime: item.mime,
    size: item.size,
    previewUrl: item.kind === 'image' ? item.content : undefined
  }));
}

function buildUserContentForApi(text: string, attachments: ChatAttachment[]): string | ChatContentPart[] {
  if (attachments.length === 0) {
    return text;
  }

  const parts: ChatContentPart[] = [];
  const normalizedText = text.trim();
  if (normalizedText) {
    parts.push({ type: 'text', text: normalizedText });
  }

  for (const item of attachments) {
    if (item.kind === 'image') {
      parts.push({ type: 'text', text: `Image: ${item.name}` });
      parts.push({
        type: 'image_url',
        image_url: {
          url: item.content,
          detail: 'auto'
        }
      });
    } else {
      parts.push({ type: 'text', text: item.content });
    }
  }

  return parts;
}

function compactSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function pickStringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatToolPreviewFromParsed(name: string, parsed: Record<string, unknown>): string {
  switch (name) {
    case 'shell_command':
      return pickStringField(parsed, 'command');
    case 'fs.read_file':
      return pickStringField(parsed, 'path');
    case 'fs.list_directory':
      return pickStringField(parsed, 'path') || '.';
    case 'fs.search_files': {
      const query = pickStringField(parsed, 'query');
      const path = pickStringField(parsed, 'path');
      if (query && path) return `${query} in ${path}`;
      return query || path;
    }
    case 'fs.grep': {
      const pattern = pickStringField(parsed, 'pattern');
      const path = pickStringField(parsed, 'path');
      if (pattern && path) return `${pattern} in ${path}`;
      return pattern || path;
    }
    case 'web.search':
      return pickStringField(parsed, 'query');
    case 'web.extract_page':
      return pickStringField(parsed, 'url');
    default:
      return '';
  }
}

function toolArgumentsPreview(info: AgentToolCallInfo): string | undefined {
  if (info.argumentsParsed && typeof info.argumentsParsed === 'object' && !Array.isArray(info.argumentsParsed)) {
    const preview = formatToolPreviewFromParsed(
      info.name,
      info.argumentsParsed as Record<string, unknown>,
    );
    const compactPreview = compactSingleLine(preview, 260);
    if (compactPreview) {
      return compactPreview;
    }
  }

  const fromParsed =
    info.argumentsParsed === undefined || info.argumentsParsed === null
      ? ''
      : typeof info.argumentsParsed === 'string'
        ? info.argumentsParsed
        : safeStringify(info.argumentsParsed);
  const fallbackRaw = info.argumentsRaw?.trim() ?? '';
  const source = fromParsed || fallbackRaw;
  const compacted = compactSingleLine(source, 260);
  return compacted || undefined;
}

function summarizeToolResult(result: AgentToolExecutionResult): {
  resultPreview?: string;
  warnings?: string[];
} {
  if (result.ok) {
    const source = result.text?.trim() || (result.structured ? safeStringify(result.structured) : '');
    const resultPreview = compactSingleLine(source, 320) || undefined;
    const warnings = result.warnings
      ?.map((warning) => compactSingleLine(warning, 180))
      .filter((warning) => warning.length > 0);
    return {
      resultPreview,
      warnings: warnings && warnings.length > 0 ? warnings : undefined,
    };
  }

  const source = result.error?.trim() || (result.structured ? safeStringify(result.structured) : '');
  const resultPreview = compactSingleLine(source, 320) || undefined;
  const warnings = result.warnings
    ?.map((warning) => compactSingleLine(warning, 180))
    .filter((warning) => warning.length > 0);
  return {
    resultPreview,
    warnings: warnings && warnings.length > 0 ? warnings : undefined,
  };
}

function createReasoningTraceItem(content: string): ChatAssistantTraceItem {
  return {
    id: `trace-r-${Math.random().toString(36).slice(2, 10)}`,
    type: 'reasoning',
    content,
  };
}

function appendReasoningToTrace(
  trace: ChatAssistantTraceItem[] | undefined,
  reasoningDelta: string,
): ChatAssistantTraceItem[] {
  if (!reasoningDelta) {
    return trace ?? [];
  }

  const current = [...(trace ?? [])];
  const last = current[current.length - 1];
  if (last?.type === 'reasoning') {
    current[current.length - 1] = {
      ...last,
      content: `${last.content}${reasoningDelta}`,
    };
    return current;
  }

  current.push(createReasoningTraceItem(reasoningDelta));
  return current;
}

function appendToolToTrace(
  trace: ChatAssistantTraceItem[] | undefined,
  toolCallId: string,
): ChatAssistantTraceItem[] {
  const current = [...(trace ?? [])];
  if (current.some((item) => item.type === 'tool' && item.toolCallId === toolCallId)) {
    return current;
  }
  current.push({
    id: `trace-t-${toolCallId}`,
    type: 'tool',
    toolCallId,
  });
  return current;
}

export function useSpotlightChat() {
  const {
    chatInput,
    setChatInput,
    activeTemplate,
    setActiveTemplate,
    attachments,
    clearAttachments,
    clearAttachmentError
  } = useSpotlight();
  const { aiConfig: uiAiConfig, setAIConfig } = useAppStore(
    useShallow((state) => ({
      aiConfig: state.aiConfig,
      setAIConfig: state.setAIConfig,
    })),
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const requestHistoryRef = useRef<ChatRequestMessage[]>([]);
  const currentAssistantContentRef = useRef('');
  const agentSessionIdRef = useRef(`spotlight-${Math.random().toString(36).slice(2)}`);

  // 节流后的状态更新函数
  const throttledUpdate = useCallback((content: string, reasoning: string) => {
    setMessages(current => {
      const updated = [...current];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        updated[updated.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + content,
          reasoning: (lastMsg.reasoning || "") + reasoning,
          assistantTrace: appendReasoningToTrace(lastMsg.assistantTrace, reasoning),
        };
      }
      return updated;
    });
  }, []);

  const { append, flushFinal } = useThrottledStreamUpdate(throttledUpdate, {
    bufferThreshold: null,
    flushInterval: 200,
    flushOnNewline: true,
  });

  const upsertLastAssistantToolCall = useCallback(
    (toolCallId: string, updater: (existing: ChatToolCallTrace | undefined) => ChatToolCallTrace) => {
      setMessages((current) => {
        if (current.length === 0) return current;
        const updated = [...current];
        const lastIndex = updated.length - 1;
        const lastMessage = updated[lastIndex];
        if (!lastMessage || lastMessage.role !== 'assistant') return current;

        const nextToolCalls = [...(lastMessage.toolCalls ?? [])];
        const existingIndex = nextToolCalls.findIndex((item) => item.id === toolCallId);
        const existing = existingIndex >= 0 ? nextToolCalls[existingIndex] : undefined;
        const next = updater(existing);

        if (existingIndex >= 0) {
          nextToolCalls[existingIndex] = next;
        } else {
          nextToolCalls.push(next);
        }

        updated[lastIndex] = {
          ...lastMessage,
          toolCalls: nextToolCalls,
          assistantTrace:
            existingIndex >= 0
              ? lastMessage.assistantTrace
              : appendToolToTrace(lastMessage.assistantTrace, toolCallId),
        };
        return updated;
      });
    },
    []
  );

  const sendMessage = useCallback(async () => {
    // 如果正在流式输出，先 flush 缓冲区避免内容丢失
    if (isStreaming) {
      flushFinal();
      return;
    }

    let finalContent = chatInput.trim();
    const hasAttachments = attachments.length > 0;

    if (activeTemplate) {
        finalContent = assembleChatPrompt(activeTemplate.content, chatInput);
    } else {
        if (!finalContent && !hasAttachments) return;
    }

    if (isStreaming) return;
    if (!finalContent && !hasAttachments) return;

    const freshConfig = useAppStore.getState().aiConfig;

    if (!freshConfig.apiKey) {
       setMessages(prev => [...prev, {
           role: 'assistant',
           content: `**Configuration Error**: API Key is missing. \n\nPlease go to Settings (in the main window) -> AI Configuration to set it up.`,
           reasoning: ''
       }]);
       return;
    }

    const userDisplayContent = finalContent.trim();
    const userDisplayAttachments = buildDisplayAttachments(attachments);
    const userRequestContent = buildUserContentForApi(finalContent, attachments);
    const requestHistoryBase = requestHistoryRef.current;
    const requestMessages: ChatRequestMessage[] = [
      ...requestHistoryBase,
      {
        role: 'user',
        content: userRequestContent
      }
    ];

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userDisplayContent, attachments: userDisplayAttachments },
      { role: 'assistant', content: '', reasoning: '', toolCalls: [], assistantTrace: [] }
    ]);
    setIsStreaming(true);
    setChatInput('');
    setActiveTemplate(null);
    clearAttachments();
    clearAttachmentError();
    currentAssistantContentRef.current = '';
    try {
      const runResult = await runDefaultAgentTurn({
        sessionId: agentSessionIdRef.current,
        messages: requestMessages,
        config: freshConfig,
        toolPolicy: {
          mode: 'allowList',
          toolNames: ['fs.list_directory', 'fs.search_files', 'fs.read_file', 'fs.grep', 'web.search', 'web.extract_page', 'shell_command'],
        },
        callbacks: {
          onAssistantDelta: (contentDelta) => {
            currentAssistantContentRef.current += contentDelta;
            append(contentDelta, '');
          },
          onReasoningDelta: (reasoningDelta) => {
            append('', reasoningDelta);
          },
          onToolStart: (info) => {
            flushFinal();
            const startedAt = Date.now();
            const argumentsPreview = toolArgumentsPreview(info);
            upsertLastAssistantToolCall(info.id, (existing) => ({
              id: info.id,
              name: info.name,
              status: 'running',
              argumentsPreview: argumentsPreview ?? existing?.argumentsPreview,
              startedAt: existing?.startedAt ?? startedAt,
            }));
          },
          onToolFinish: (info, result) => {
            const finishedAt = Date.now();
            const summary = summarizeToolResult(result);
            upsertLastAssistantToolCall(info.id, (existing) => {
              const startedAt = existing?.startedAt ?? finishedAt;
              return {
                id: info.id,
                name: info.name,
                status: result.ok ? 'success' : 'error',
                argumentsPreview: existing?.argumentsPreview ?? toolArgumentsPreview(info),
                resultPreview: summary.resultPreview,
                warnings: summary.warnings,
                startedAt,
                finishedAt,
                durationMs: Math.max(0, finishedAt - startedAt),
              };
            });
          },
        },
      });

      requestHistoryRef.current = runResult.history;
    } catch (error) {
      flushFinal();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorSuffix = `\n\n**[Error]**: ${errorMessage}`;
      setMessages(current => {
        const updated = [...current];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg) {
          updated[updated.length - 1] = {
            ...lastMsg,
            content: lastMsg.content + errorSuffix
          };
        }
        return updated;
      });
      const nextHistory: ChatRequestMessage[] = [
        ...requestHistoryBase,
        { role: 'user', content: userRequestContent }
      ];
      requestHistoryRef.current = nextHistory;
    } finally {
      flushFinal();
      setIsStreaming(false);
    }
  }, [
    chatInput,
    isStreaming,
    activeTemplate,
    attachments,
    setActiveTemplate,
    setChatInput,
    clearAttachments,
    clearAttachmentError,
    append,
    flushFinal,
    upsertLastAssistantToolCall
  ]);

  const clearChat = useCallback(() => {
    // 如果正在流式输出，先 flush 缓冲区避免内容丢失
    if (isStreaming) {
      flushFinal();
      return;
    }
    setMessages([]);
    setChatInput('');
    setActiveTemplate(null);
    clearAttachments();
    clearAttachmentError();
    requestHistoryRef.current = [];
    currentAssistantContentRef.current = '';
    agentSessionIdRef.current = `spotlight-${Math.random().toString(36).slice(2)}`;
  }, [isStreaming, setChatInput, setActiveTemplate, clearAttachments, clearAttachmentError, flushFinal]);

  const cycleProvider = useCallback(() => {
    const currentSettings = useAppStore.getState().savedProviderSettings;
    const providers = Object.keys(currentSettings);
    const currentProvider = useAppStore.getState().aiConfig.providerId;

    if (providers.length > 0) {
        const currentIndex = providers.indexOf(currentProvider);
        const nextIndex = (currentIndex + 1) % providers.length;
        setAIConfig({ providerId: providers[nextIndex] });
    }
  }, [setAIConfig]);

  // 智能滚动：只在用户位于底部时自动滚动
  useEffect(() => {
    if (!isStreaming || !chatEndRef.current || !containerRef.current) return;

    // 只有当用户原本就在底部时，才执行自动滚动
    if (isUserAtBottom) {
      chatEndRef.current.scrollIntoView({
        behavior: 'auto', // 流式输出用 auto，避免平滑滚动的延迟感
        block: 'end'
      });
    }
  }, [messages, isStreaming, isUserAtBottom]);

  return {
    messages,
    isStreaming,
    chatEndRef,
    containerRef,
    isUserAtBottom,
    setIsUserAtBottom,
    sendMessage,
    clearChat,
    cycleProvider,
    providerId: uiAiConfig.providerId // 用于 UI 显示
  };
}
