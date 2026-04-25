import { AIProviderConfig } from '@/types/model';
import { FileNode } from '@/types/context';
import { AgentToolRegistry } from '@/lib/agent/registry';
import { runAgentTurn } from '@/lib/agent/runtime';
import { registerFsTools } from '@/lib/agent/tools/fs';
import type { AgentToolCallInfo, AgentToolExecutionResult, AgentToolHandler } from '@/lib/agent/types';
import {
  buildSelectableTreePrompt,
  normalizeContextAiPath,
  resolveSelectablePath,
  validateAiSelectionSuggestions,
} from './tree';
import {
  AiFileSelectionResult,
  AiFileSelectionSuggestion,
  AiFileSelectionToolTrace,
} from './types';

interface SelectContextFilesOptions {
  instruction: string;
  fileTree: FileNode[];
  projectRoot: string;
  config: AIProviderConfig;
  onToolTrace?: (trace: AiFileSelectionToolTrace) => void;
}

export interface SelectContextFilesResult extends AiFileSelectionResult {
  selectedPaths: string[];
  unmatchedPaths: string[];
}

const SYSTEM_PROMPT = `You help users select project files for an LLM context pack.

Rules:
- Analyze the user's request and select only files or folders needed to understand that request.
- Use tools to search, list, and read files before producing the final selection.
- Only select paths that exist in the provided selectable file tree.
- Treat the selectable file tree as the allowlist. Do not read or recommend paths that are absent from it.
- Tool path arguments must be workspace-relative paths exactly as shown in the selectable file tree.
- Do not repeat path segments. For example use ".AI/PROJECT_OVERVIEW.md", not ".AI/.AI/PROJECT_OVERVIEW.md".
- Prefer a small sufficient set over a broad dump.
- Select a folder only when most files under it are directly relevant.
- Exclude generated files, dependencies, lock files, binary/media assets, and ignored files.
- Return strict JSON only, with no Markdown fences or prose.

JSON schema:
{
  "summary": "one short sentence",
  "suggestions": [
    { "path": "workspace-relative/path.ts", "kind": "file", "reason": "short reason" }
  ]
}`;

let baseFsRegistry: AgentToolRegistry | null = null;

function getBaseFsRegistry(): AgentToolRegistry {
  if (baseFsRegistry) {
    return baseFsRegistry;
  }

  const registry = new AgentToolRegistry();
  registerFsTools(registry);
  baseFsRegistry = registry;
  return registry;
}

function rewriteToolPathArgs(
  input: unknown,
  nodes: FileNode[],
  projectRoot: string,
  toolName: string
): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const raw = input as Record<string, unknown>;
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (!path) {
    return input;
  }

  const expectedKind = toolName === 'fs.read_file' ? 'file' : 'dir';
  const resolved = resolveSelectablePath(nodes, projectRoot, path, expectedKind);
  if (!resolved) {
    throw new Error(`Path is not in the selectable file tree: ${path}`);
  }

  return {
    ...raw,
    path: normalizeContextAiPath(resolved.relativePath),
  };
}

function createContextSelectionRegistry(nodes: FileNode[], projectRoot: string): AgentToolRegistry {
  const base = getBaseFsRegistry();
  const registry = new AgentToolRegistry();

  for (const definition of base.listDefinitions()) {
    const baseHandler = base.getHandler(definition.name);
    if (!baseHandler) continue;

    const handler: AgentToolHandler = async (input, context) => {
      try {
        const rewrittenInput = rewriteToolPathArgs(input, nodes, projectRoot, definition.name);
        return baseHandler(rewrittenInput, context);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    registry.register({
      definition: {
        ...definition,
        description: `${definition.description} The path must exist in the selectable file tree for this AI selection run.`,
      },
      handler,
    });
  }

  return registry;
}

function parseToolPreview(info: AgentToolCallInfo): string | undefined {
  if (!info.argumentsParsed || typeof info.argumentsParsed !== 'object') {
    return undefined;
  }

  const args = info.argumentsParsed as Record<string, unknown>;
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : '';

  if (info.name === 'fs.search_files') {
    return [query, path ? `in ${path}` : ''].filter(Boolean).join(' ');
  }
  if (info.name === 'fs.grep') {
    return [pattern, path ? `in ${path}` : ''].filter(Boolean).join(' ');
  }
  if (info.name === 'fs.read_file' || info.name === 'fs.list_directory') {
    return path || '.';
  }
  return undefined;
}

function normalizeKind(value: unknown): 'file' | 'dir' {
  return value === 'dir' ? 'dir' : 'file';
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('AI 没有返回勾选结果，请重试或切换模型。');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('AI 没有按要求返回可应用的文件列表，请重试或切换模型。');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function parseSelectionResult(text: string): AiFileSelectionResult {
  const payload = extractJsonObject(text);
  if (!payload || typeof payload !== 'object') {
    throw new Error('AI 返回的勾选结果格式不正确，请重试。');
  }

  const raw = payload as Record<string, unknown>;
  const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  const suggestions: AiFileSelectionSuggestion[] = rawSuggestions.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const path = typeof value.path === 'string' ? value.path.trim() : '';
    if (!path) return [];
    const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
    return [{
      path,
      kind: normalizeKind(value.kind),
      reason: reason || 'Relevant to the requested context.',
    }];
  });

  return {
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : `Suggested ${suggestions.length} item(s).`,
    suggestions,
  };
}

function summarizeToolResult(result: AgentToolExecutionResult): 'success' | 'error' {
  return result.ok ? 'success' : 'error';
}

export async function selectContextFilesWithAi(
  options: SelectContextFilesOptions
): Promise<SelectContextFilesResult> {
  const selectableTree = buildSelectableTreePrompt(options.fileTree, options.projectRoot);
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: [
        `User request: ${options.instruction.trim()}`,
        '',
        `Workspace root: ${options.projectRoot}`,
        '',
        'Selectable file tree:',
        selectableTree,
      ].join('\n'),
    },
  ];

  const runResult = await runAgentTurn(createContextSelectionRegistry(options.fileTree, options.projectRoot), {
    sessionId: `context-ai-${Date.now().toString(36)}`,
    messages,
    config: options.config,
    toolPolicy: {
      mode: 'allowList',
      toolNames: ['fs.search_files', 'fs.list_directory', 'fs.read_file', 'fs.grep'],
    },
    maxTotalToolCalls: 48,
    maxRuntimeMs: 4 * 60_000,
    callbacks: {
      onToolStart: (info) => {
        options.onToolTrace?.({
          id: info.id,
          name: info.name,
          preview: parseToolPreview(info),
          status: 'running',
        });
      },
      onToolFinish: (info, result) => {
        options.onToolTrace?.({
          id: info.id,
          name: info.name,
          preview: parseToolPreview(info),
          status: summarizeToolResult(result),
        });
      },
    },
  });

  const parsed = parseSelectionResult(runResult.assistantContent);
  const validated = validateAiSelectionSuggestions(
    options.fileTree,
    options.projectRoot,
    parsed.suggestions
  );

  return {
    summary: parsed.summary,
    suggestions: validated.validSuggestions,
    selectedPaths: validated.selectedPaths,
    unmatchedPaths: validated.unmatchedPaths,
  };
}
