import {
  ChatCompletionResult,
  ChatRequestMessage,
  ChatToolDefinition,
  streamChatCompletionWithTools,
} from '@/lib/llm';
import { AgentToolRegistry } from './registry';
import { DEFAULT_AGENT_TOOL_POLICY, isToolAllowed } from './policy';
import {
  AgentRunOptions,
  AgentRunResult,
  AgentToolCallInfo,
  AgentToolDefinition,
  AgentToolExecutionResult,
  AgentToolPolicy,
} from './types';

const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_TOOL_FAILURES = 3;
const DEFAULT_MAX_TOTAL_TOOL_CALLS = 120;
const DEFAULT_MAX_RUNTIME_MS = 8 * 60 * 1000;
const MAX_IDENTICAL_TOOL_OUTCOME_STREAK = 4;
const HARD_MAX_TOOL_ROUNDS = 512;
const MAX_EMPTY_FINAL_RESPONSE_RETRIES = 2;
const EMPTY_FINAL_RESPONSE_RECENT_MESSAGE_LIMIT = 24;
const EMPTY_FINAL_RESPONSE_TOOL_CONTENT_LIMIT = 6_000;
const DEFAULT_AGENT_SYSTEM_PROMPT =
  `You are CtxRun, a coding-focused assistant with tool access.

Core principles:
- Be precise, honest, and concise.
- Solve the user's request end-to-end when possible.
- Never fabricate tool results, file contents, or web facts.
- Match the user's language unless they ask otherwise.

Tool-use strategy:
- For local workspace tasks, prioritize: fs.search_files -> fs.list_directory -> fs.read_file. Use fs.grep to search file contents by regex.
- Use shell_command for guarded workspace-scoped shell inspection when command output is the fastest path. Read-only commands may auto-run; anything else may require approval.
- For online or time-sensitive information, use web.search first, then web.extract_page on selected sources.
- Use tools before answering whenever the request depends on external or local factual data.
- If data is missing, state exactly what is missing and what next tool/input is needed.

Coding behavior:
- Keep recommendations minimal, practical, and aligned with existing project style.
- Focus on root-cause solutions, not superficial patches.
- Do not claim files were edited, commands were run, or tests passed unless tool output proves it.
- When proposing code changes, provide clear actionable outputs (file paths, snippets, or patch-style steps).

Response style:
- Lead with the answer, then key evidence.
- Keep output scannable and avoid unnecessary verbosity.
- For web-derived facts, include source URLs when relevant.
- If tool calls fail or are blocked, clearly report the failure and provide the best fallback path.`;
const EMPTY_FINAL_RESPONSE_RECOVERY_PROMPT =
  'You have tool results available. Provide a final answer to the user now. Do not return an empty response. Avoid calling more tools unless strictly necessary.';

function toChatToolDefinition(definition: AgentToolDefinition): ChatToolDefinition {
  return {
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
    },
  };
}

function buildToolResultPayload(result: AgentToolExecutionResult): string {
  if (result.ok) {
    return JSON.stringify({
      ok: true,
      text: result.text,
      structured: result.structured ?? null,
      warnings: result.warnings ?? [],
    });
  }

  return JSON.stringify({
    ok: false,
    error: result.error,
    structured: result.structured ?? null,
    warnings: result.warnings ?? [],
  });
}

function parseToolArguments(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid tool arguments JSON: ${trimmed}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutErrorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutErrorMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function buildToolNotFoundMessage(name: string, registry: AgentToolRegistry): string {
  const availableTools = registry
    .listDefinitions()
    .map((tool) => tool.name)
    .sort();
  const scopedSuggestions = !name.includes('.')
    ? availableTools.filter((toolName) => toolName.startsWith(`${name}.`)).slice(0, 4)
    : [];
  const base = `Tool "${name}" not found. Use an exact tool name. Available tools: ${availableTools.join(', ')}.`;
  if (scopedSuggestions.length === 0) {
    return base;
  }
  return `${base} Did you mean: ${scopedSuggestions.join(', ')}?`;
}

function buildToolInfo(callId: string, name: string, argumentsRaw: string, argsParsed: unknown): AgentToolCallInfo {
  return {
    id: callId,
    name,
    argumentsRaw,
    argumentsParsed: argsParsed,
  };
}

function looksLikeToolSupportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('tool') ||
    message.includes('function call') ||
    message.includes('function_call') ||
    message.includes('tool_choice')
  );
}

function appendSystemPrompt(messages: ChatRequestMessage[], systemPrompt?: string): ChatRequestMessage[] {
  const hasSystem = messages.some((message) => message.role === 'system');
  if (hasSystem) return [...messages];

  return [
    {
      role: 'system',
      content: systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT,
    },
    ...messages,
  ];
}

function compactValue(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactToolMessageContent(content: ChatRequestMessage['content']): ChatRequestMessage['content'] {
  if (typeof content === 'string') {
    return compactValue(content, EMPTY_FINAL_RESPONSE_TOOL_CONTENT_LIMIT);
  }

  return content.map((part) => {
    if (part.type !== 'text') {
      return part;
    }

    return {
      ...part,
      text: compactValue(part.text, EMPTY_FINAL_RESPONSE_TOOL_CONTENT_LIMIT),
    };
  });
}

function compactRecoveryMessage(message: ChatRequestMessage): ChatRequestMessage {
  if (message.role !== 'tool') {
    return { ...message };
  }

  return {
    ...message,
    content: compactToolMessageContent(message.content),
  };
}

export function buildFinalResponseRecoveryMessages(history: ChatRequestMessage[]): ChatRequestMessage[] {
  const recentStart = Math.max(0, history.length - EMPTY_FINAL_RESPONSE_RECENT_MESSAGE_LIMIT);
  const anchorIndexes: number[] = [];

  history.forEach((message, index) => {
    if (index >= recentStart) {
      return;
    }
    if (message.role === 'system') {
      anchorIndexes.push(index);
    }
  });

  const firstUserIndex = history.findIndex((message, index) => index < recentStart && message.role === 'user');
  if (firstUserIndex >= 0) {
    anchorIndexes.push(firstUserIndex);
  }

  const orderedAnchorIndexes = Array.from(new Set(anchorIndexes)).sort((a, b) => a - b);
  const recentMessages = history.slice(recentStart);
  while (recentMessages[0]?.role === 'tool') {
    recentMessages.shift();
  }

  return [
    ...orderedAnchorIndexes.map((index) => compactRecoveryMessage(history[index])),
    ...recentMessages.map(compactRecoveryMessage),
    {
      role: 'system',
      content: EMPTY_FINAL_RESPONSE_RECOVERY_PROMPT,
    },
  ];
}

function stringifyForFingerprint(input: unknown): string {
  try {
    if (typeof input === 'string') return input;
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function buildToolOutcomeFingerprint(info: AgentToolCallInfo, result: AgentToolExecutionResult): string {
  const argsPart = compactValue(info.argumentsRaw?.trim() || '{}', 900);
  if (result.ok) {
    const textPart = compactValue(result.text ?? '', 320);
    const structuredPart = compactValue(stringifyForFingerprint(result.structured ?? null), 900);
    const warningsPart = (result.warnings ?? []).join('|');
    return `${info.name}|${argsPart}|ok|${textPart}|${structuredPart}|${warningsPart}`;
  }
  const errorPart = compactValue(result.error ?? '', 320);
  const structuredPart = compactValue(stringifyForFingerprint(result.structured ?? null), 900);
  const warningsPart = (result.warnings ?? []).join('|');
  return `${info.name}|${argsPart}|error|${errorPart}|${structuredPart}|${warningsPart}`;
}

function buildConsecutiveToolFailureMessage(
  consecutiveFailures: number,
  lastFailure: { name: string; error: string } | null
): string {
  const header = `I stopped tool retries after ${consecutiveFailures} consecutive failures to avoid a loop.`;
  if (!lastFailure) {
    return `${header} Please provide a different source or a more specific URL, and I can continue.`;
  }
  return `${header} Latest failure: ${lastFailure.name} — ${lastFailure.error}. Please provide a different source or a more specific URL, and I can continue.`;
}

function buildToolLoopExceededMessage(
  maxToolRounds: number,
  lastFailure: { name: string; error: string } | null
): string {
  const header = `I reached the tool-call safety limit (${maxToolRounds} rounds), so I stopped automatically retrying.`;
  if (!lastFailure) {
    return `${header} Please provide a more direct source URL or narrower target, and I will continue.`;
  }
  return `${header} Last failure: ${lastFailure.name} — ${lastFailure.error}. Please provide a more direct source URL or narrower target, and I will continue.`;
}

function buildToolCallBudgetExceededMessage(
  maxTotalToolCalls: number,
  lastFailure: { name: string; error: string } | null
): string {
  const header = `I reached the tool-call budget (${maxTotalToolCalls} calls), so I stopped to prevent runaway loops.`;
  if (!lastFailure) {
    return `${header} If you want deeper exploration, ask me to continue and I can keep going.`;
  }
  return `${header} Last failure: ${lastFailure.name} — ${lastFailure.error}. If you want deeper exploration, ask me to continue and I can keep going.`;
}

function buildRuntimeBudgetExceededMessage(
  maxRuntimeMs: number,
  lastFailure: { name: string; error: string } | null
): string {
  const seconds = Math.max(1, Math.floor(maxRuntimeMs / 1000));
  const header = `I reached the tool runtime budget (${seconds}s), so I stopped to keep the session responsive.`;
  if (!lastFailure) {
    return `${header} Ask me to continue and I will resume from current context.`;
  }
  return `${header} Last failure: ${lastFailure.name} — ${lastFailure.error}. Ask me to continue and I will resume from current context.`;
}

function buildNoProgressMessage(streak: number, toolName: string): string {
  return `I stopped after ${streak} identical ${toolName} results in a row because no new progress was detected. Please narrow the target, provide another source, or ask me to continue with a different strategy.`;
}

function buildEmptyFinalResponseMessage(retries: number): string {
  return `I completed tool calls but the model returned an empty final answer ${retries} times. Please retry, or switch to another model/provider and I can continue.`;
}

async function executeToolCall(
  registry: AgentToolRegistry,
  toolPolicy: AgentToolPolicy,
  sessionId: string,
  callId: string,
  name: string,
  argumentsRaw: string,
  onStart?: (info: AgentToolCallInfo) => void
): Promise<{ info: AgentToolCallInfo; result: AgentToolExecutionResult }> {
  let parsedArgs: unknown;
  try {
    parsedArgs = parseToolArguments(argumentsRaw);
  } catch (error) {
    const info = buildToolInfo(callId, name, argumentsRaw, null);
    onStart?.(info);
    return {
      info,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const normalizedName = name.trim();
  const info = buildToolInfo(callId, normalizedName, argumentsRaw, parsedArgs);
  onStart?.(info);

  const definition = registry.getDefinition(normalizedName);
  const handler = registry.getHandler(normalizedName);
  if (!definition || !handler) {
    return {
      info,
      result: {
        ok: false,
        error: buildToolNotFoundMessage(normalizedName || name, registry),
      },
    };
  }

  if (!isToolAllowed(normalizedName, toolPolicy)) {
    const allowedTools = registry
      .listDefinitions()
      .map((tool) => tool.name)
      .filter((toolName) => isToolAllowed(toolName, toolPolicy));
    const allowedHint = allowedTools.length > 0
      ? ` Allowed tools: ${allowedTools.join(', ')}.`
      : '';
    return {
      info,
      result: {
        ok: false,
        error: `Tool "${normalizedName}" is blocked by tool policy.${allowedHint}`,
      },
    };
  }

  const timeoutMs = definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  try {
    const result = await withTimeout(
      handler(parsedArgs, { sessionId, callId }),
      timeoutMs,
      `Tool "${normalizedName}" timed out after ${timeoutMs}ms.`
    );
    return { info, result };
  } catch (error) {
    return {
      info,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function toAssistantHistoryMessage(completion: ChatCompletionResult): ChatRequestMessage {
  return {
    role: 'assistant',
    content: completion.content || '',
    tool_calls: completion.rawAssistantMessage.tool_calls,
  };
}

export async function runAgentTurn(
  registry: AgentToolRegistry,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const callbacks = options.callbacks;
  const maxToolRounds = options.maxToolRounds;
  const maxTotalToolCalls = options.maxTotalToolCalls ?? DEFAULT_MAX_TOTAL_TOOL_CALLS;
  const maxRuntimeMs = options.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const toolPolicy = options.toolPolicy ?? DEFAULT_AGENT_TOOL_POLICY;
  const history: ChatRequestMessage[] = appendSystemPrompt(options.messages);
  const startedAt = Date.now();

  let assistantContent = '';
  let assistantReasoning = '';
  let toolEnabled = true;
  let consecutiveToolFailures = 0;
  let totalToolCalls = 0;
  let identicalToolOutcomeStreak = 0;
  let lastToolOutcomeFingerprint: string | null = null;
  let lastToolFailure: { name: string; error: string } | null = null;
  let emptyFinalResponseRetries = 0;
  let forceFinalizeAnswer = false;

  for (let round = 0; ; round += 1) {
    if (Date.now() - startedAt >= maxRuntimeMs) {
      const stopMessage = buildRuntimeBudgetExceededMessage(maxRuntimeMs, lastToolFailure);
      history.push({
        role: 'assistant',
        content: stopMessage,
      });
      callbacks?.onAssistantDelta?.(stopMessage);
      return {
        assistantContent: stopMessage,
        assistantReasoning,
        history,
      };
    }

    if (maxToolRounds !== undefined && round >= maxToolRounds) {
      const stopMessage = buildToolLoopExceededMessage(maxToolRounds, lastToolFailure);
      history.push({
        role: 'assistant',
        content: stopMessage,
      });
      callbacks?.onAssistantDelta?.(stopMessage);
      return {
        assistantContent: stopMessage,
        assistantReasoning,
        history,
      };
    }

    if (round >= HARD_MAX_TOOL_ROUNDS) {
      const stopMessage = buildToolLoopExceededMessage(HARD_MAX_TOOL_ROUNDS, lastToolFailure);
      history.push({
        role: 'assistant',
        content: stopMessage,
      });
      callbacks?.onAssistantDelta?.(stopMessage);
      return {
        assistantContent: stopMessage,
        assistantReasoning,
        history,
      };
    }

    const availableTools = toolEnabled
      ? registry
          .listDefinitions()
          .filter((tool) => isToolAllowed(tool.name, toolPolicy))
          .map(toChatToolDefinition)
      : [];
    const completionMessages = forceFinalizeAnswer
      ? buildFinalResponseRecoveryMessages(history)
      : history;

    let completion: ChatCompletionResult;
    try {
      completion = await streamChatCompletionWithTools(
        completionMessages,
        options.config,
        {
          tools: availableTools,
          toolChoice: availableTools.length > 0 ? 'auto' : 'none',
        },
        {
          onContentDelta: (contentDelta) => {
            callbacks?.onAssistantDelta?.(contentDelta);
          },
          onReasoningDelta: (reasoningDelta) => {
            assistantReasoning += reasoningDelta;
            callbacks?.onReasoningDelta?.(reasoningDelta);
          },
        }
      );
    } catch (error) {
      if (toolEnabled && availableTools.length > 0 && looksLikeToolSupportError(error)) {
        toolEnabled = false;
        callbacks?.onReasoningDelta?.('\nTool calling is unsupported by current provider, fallback to plain completion.\n');
        round -= 1;
        continue;
      }
      throw error;
    }

    if (completion.toolCalls.length === 0) {
      const content = completion.content ?? '';
      const hasToolHistory = history.some((message) => message.role === 'tool');
      if (!content.trim() && hasToolHistory) {
        emptyFinalResponseRetries += 1;
        if (emptyFinalResponseRetries <= MAX_EMPTY_FINAL_RESPONSE_RETRIES) {
          forceFinalizeAnswer = true;
          continue;
        }

        const stopMessage = buildEmptyFinalResponseMessage(emptyFinalResponseRetries);
        history.push({
          role: 'assistant',
          content: stopMessage,
        });
        callbacks?.onAssistantDelta?.(stopMessage);
        return {
          assistantContent: stopMessage,
          assistantReasoning,
          history,
        };
      }

      forceFinalizeAnswer = false;
      emptyFinalResponseRetries = 0;
      assistantContent = content;
      history.push({
        role: 'assistant',
        content: assistantContent,
      });
      return {
        assistantContent,
        assistantReasoning,
        history,
      };
    }

    history.push(toAssistantHistoryMessage(completion));
    forceFinalizeAnswer = false;
    emptyFinalResponseRetries = 0;

    for (const call of completion.toolCalls) {
      if (totalToolCalls >= maxTotalToolCalls) {
        const stopMessage = buildToolCallBudgetExceededMessage(maxTotalToolCalls, lastToolFailure);
        history.push({
          role: 'assistant',
          content: stopMessage,
        });
        callbacks?.onAssistantDelta?.(stopMessage);
        return {
          assistantContent: stopMessage,
          assistantReasoning,
          history,
        };
      }

      const executed = await executeToolCall(
        registry,
        toolPolicy,
        options.sessionId,
        call.id,
        call.name,
        call.arguments,
        (info) => callbacks?.onToolStart?.(info)
      );
      totalToolCalls += 1;
      callbacks?.onToolFinish?.(executed.info, executed.result);

      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: buildToolResultPayload(executed.result),
      });

      if (executed.result.ok) {
        consecutiveToolFailures = 0;
      } else {
        consecutiveToolFailures += 1;
        lastToolFailure = {
          name: executed.info.name,
          error: executed.result.error,
        };
      }

      const outcomeFingerprint = buildToolOutcomeFingerprint(executed.info, executed.result);
      if (outcomeFingerprint === lastToolOutcomeFingerprint) {
        identicalToolOutcomeStreak += 1;
      } else {
        identicalToolOutcomeStreak = 1;
        lastToolOutcomeFingerprint = outcomeFingerprint;
      }

      if (identicalToolOutcomeStreak >= MAX_IDENTICAL_TOOL_OUTCOME_STREAK) {
        const stopMessage = buildNoProgressMessage(
          identicalToolOutcomeStreak,
          executed.info.name
        );
        history.push({
          role: 'assistant',
          content: stopMessage,
        });
        callbacks?.onAssistantDelta?.(stopMessage);
        return {
          assistantContent: stopMessage,
          assistantReasoning,
          history,
        };
      }

      if (consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
        const stopMessage = buildConsecutiveToolFailureMessage(
          consecutiveToolFailures,
          lastToolFailure
        );
        history.push({
          role: 'assistant',
          content: stopMessage,
        });
        callbacks?.onAssistantDelta?.(stopMessage);
        return {
          assistantContent: stopMessage,
          assistantReasoning,
          history,
        };
      }
    }
  }
}
