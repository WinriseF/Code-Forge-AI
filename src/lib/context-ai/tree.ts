import { FileNode } from '@/types/context';
import { AiFileSelectionSuggestion } from './types';

const MAX_TREE_PROMPT_CHARS = 24_000;

export interface ValidatedAiSelection {
  validSuggestions: AiFileSelectionSuggestion[];
  selectedPaths: string[];
  unmatchedPaths: string[];
}

interface SelectableNodeIndexEntry {
  node: FileNode;
  relativePath: string;
}

export function normalizeContextAiPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function normalizeLookupPath(value: string): string {
  return normalizeContextAiPath(value).toLowerCase();
}

function isSelectable(node: FileNode, parentLocked = false): boolean {
  return !parentLocked && !node.isLocked;
}

function toRelativePath(path: string, projectRoot: string): string {
  const normalizedPath = normalizeContextAiPath(path);
  const normalizedRoot = normalizeContextAiPath(projectRoot);
  const lookupPath = normalizedPath.toLowerCase();
  const lookupRoot = normalizedRoot.toLowerCase();

  if (lookupPath === lookupRoot) {
    return '.';
  }

  if (lookupPath.startsWith(`${lookupRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

function removeAdjacentDuplicateSegments(path: string): string {
  const parts = normalizeContextAiPath(path).split('/').filter(Boolean);
  const deduped: string[] = [];

  for (const part of parts) {
    if (deduped[deduped.length - 1]?.toLowerCase() === part.toLowerCase()) {
      continue;
    }
    deduped.push(part);
  }

  return deduped.join('/');
}

function collectSelectableFiles(node: FileNode, output: string[], parentLocked = false): void {
  const locked = parentLocked || !!node.isLocked;
  if (locked) return;

  if (node.kind === 'file') {
    output.push(node.path);
    return;
  }

  for (const child of node.children ?? []) {
    collectSelectableFiles(child, output, locked);
  }
}

export function buildSelectableTreePrompt(nodes: FileNode[], projectRoot: string): string {
  const lines: string[] = [];
  let promptLength = 0;
  let truncated = false;

  const pushLine = (line: string) => {
    if (truncated) return;
    const nextLength = promptLength + line.length + 1;
    if (nextLength > MAX_TREE_PROMPT_CHARS) {
      lines.push('[tree truncated; use tools to inspect additional files]');
      truncated = true;
      return;
    }
    lines.push(line);
    promptLength = nextLength;
  };

  const walk = (items: FileNode[], depth: number, parentLocked = false) => {
    for (const node of items) {
      if (!isSelectable(node, parentLocked)) {
        continue;
      }

      const relativePath = toRelativePath(node.path, projectRoot);
      const marker = node.kind === 'dir' ? '/' : '';
      pushLine(`${'  '.repeat(depth)}- ${relativePath}${marker}`);

      if (node.kind === 'dir' && node.children) {
        walk(node.children, depth + 1, false);
      }
    }
  };

  walk(nodes, 0);
  return lines.length > 0 ? lines.join('\n') : '[no selectable files]';
}

export function buildSelectableNodeIndex(
  nodes: FileNode[],
  projectRoot: string
): Map<string, SelectableNodeIndexEntry> {
  const index = new Map<string, SelectableNodeIndexEntry>();

  const walk = (items: FileNode[], parentLocked = false) => {
    for (const node of items) {
      const locked = parentLocked || !!node.isLocked;
      if (locked) continue;

      const relativePath = toRelativePath(node.path, projectRoot);
      const entry = { node, relativePath };
      index.set(normalizeLookupPath(relativePath), entry);
      index.set(normalizeLookupPath(node.path), entry);

      if (node.children) {
        walk(node.children, locked);
      }
    }
  };

  walk(nodes);
  return index;
}

export function resolveSelectablePath(
  nodes: FileNode[],
  projectRoot: string,
  path: string,
  expectedKind?: FileNode['kind']
): SelectableNodeIndexEntry | null {
  const index = buildSelectableNodeIndex(nodes, projectRoot);
  const candidates = new Set<string>();
  const normalized = normalizeContextAiPath(path);
  candidates.add(normalized);
  candidates.add(removeAdjacentDuplicateSegments(normalized));

  const normalizedRoot = normalizeContextAiPath(projectRoot);
  if (normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    candidates.add(normalized.slice(normalizedRoot.length + 1));
  }

  const parts = normalized.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    candidates.add(parts.slice(i).join('/'));
    candidates.add(removeAdjacentDuplicateSegments(parts.slice(i).join('/')));
  }

  for (const candidate of candidates) {
    const entry = index.get(normalizeLookupPath(candidate));
    if (entry && (!expectedKind || entry.node.kind === expectedKind)) {
      return entry;
    }
  }

  return null;
}

export function validateAiSelectionSuggestions(
  nodes: FileNode[],
  projectRoot: string,
  suggestions: AiFileSelectionSuggestion[]
): ValidatedAiSelection {
  const index = buildSelectableNodeIndex(nodes, projectRoot);
  const selectedPathSet = new Set<string>();
  const validSuggestions: AiFileSelectionSuggestion[] = [];
  const unmatchedPaths: string[] = [];
  const seenSuggestions = new Set<string>();

  for (const suggestion of suggestions) {
    const rawPath = suggestion.path.trim();
    if (!rawPath) continue;

    const entry = index.get(normalizeLookupPath(rawPath));
    if (!entry) {
      unmatchedPaths.push(rawPath);
      continue;
    }

    const stablePath = entry.relativePath === '.' ? entry.node.path : entry.relativePath;
    const suggestionKey = normalizeLookupPath(stablePath);
    if (!seenSuggestions.has(suggestionKey)) {
      seenSuggestions.add(suggestionKey);
      validSuggestions.push({
        path: stablePath,
        kind: entry.node.kind,
        reason: suggestion.reason.trim() || 'Relevant to the requested context.',
      });
    }

    const files: string[] = [];
    collectSelectableFiles(entry.node, files);
    for (const filePath of files) {
      selectedPathSet.add(filePath);
    }
  }

  return {
    validSuggestions,
    selectedPaths: Array.from(selectedPathSet),
    unmatchedPaths,
  };
}
