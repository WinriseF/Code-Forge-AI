import type { PatchFileItem } from '@/components/features/patch/patch_types';

export interface PatchTreeNode {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children: PatchTreeNode[];
  fileData?: PatchFileItem;
}

/**
 * Convert flat PatchFileItem[] into a tree by splitting paths on '/'.
 * Dirs before files, siblings sorted alphabetically.
 */
export function buildPatchFileTree(files: PatchFileItem[]): PatchTreeNode[] {
  const root: PatchTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let level = root;

    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        level.push({
          id: file.id,
          name: parts[i],
          path: file.path,
          kind: 'file',
          children: [],
          fileData: file,
        });
      } else {
        const partialPath = parts.slice(0, i + 1).join('/');
        let dir = level.find((n) => n.kind === 'dir' && n.path === partialPath);
        if (!dir) {
          dir = {
            id: 'dir:' + partialPath,
            name: parts[i],
            path: partialPath,
            kind: 'dir',
            children: [],
          };
          level.push(dir);
        }
        level = dir.children;
      }
    }
  }

  sortTree(root);
  return root;
}

function sortTree(nodes: PatchTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children.length) sortTree(node.children);
  }
}

/**
 * Flatten the tree into a list for rendering.
 * Only expanded dirs' children are included.
 */
export interface FlatPatchNode {
  node: PatchTreeNode;
  depth: number;
}

export function flattenPatchTree(
  nodes: PatchTreeNode[],
  expandedIds: Set<string>,
  depth = 0,
): FlatPatchNode[] {
  const result: FlatPatchNode[] = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.kind === 'dir' && expandedIds.has(node.id) && node.children.length) {
      result.push(...flattenPatchTree(node.children, expandedIds, depth + 1));
    }
  }
  return result;
}

/** Collect IDs of ALL directories in the tree. */
export function allDirIds(nodes: PatchTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: PatchTreeNode[]) => {
    for (const n of list) {
      if (n.kind === 'dir') {
        ids.push(n.id);
        if (n.children.length) walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
}
