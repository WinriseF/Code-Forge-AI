import { describe, expect, it } from 'vitest';
import {
  buildPatchFileTree,
  collectExportablePatchFilePaths,
  type PatchTreeNode,
} from '@/lib/patch_tree_utils';
import type { PatchFileItem } from '@/components/features/patch/patch_types';

function patchFile(path: string, overrides: Partial<PatchFileItem> = {}): PatchFileItem {
  return {
    id: path,
    path,
    original: 'before',
    modified: 'after',
    status: 'success',
    gitStatus: 'Modified',
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

function findDir(nodes: PatchTreeNode[], path: string): PatchTreeNode {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'dir' && node.path === path) {
      return node;
    }
    stack.push(...node.children);
  }
  throw new Error(`Missing dir ${path}`);
}

describe('patch tree utils', () => {
  it('collects exportable file paths from nested directories', () => {
    const tree = buildPatchFileTree([
      patchFile('src/a.ts'),
      patchFile('src/nested/b.ts'),
      patchFile('docs/readme.md'),
    ]);

    expect(collectExportablePatchFilePaths(findDir(tree, 'src'))).toEqual([
      'src/nested/b.ts',
      'src/a.ts',
    ]);
  });

  it('skips binary and oversized files', () => {
    const tree = buildPatchFileTree([
      patchFile('src/a.ts'),
      patchFile('src/image.png', { isBinary: true }),
      patchFile('src/large.json', { isLarge: true }),
    ]);

    expect(collectExportablePatchFilePaths(findDir(tree, 'src'))).toEqual(['src/a.ts']);
  });

  it('returns no paths for empty or fully disabled directories', () => {
    const emptyDir: PatchTreeNode = {
      id: 'dir:empty',
      name: 'empty',
      path: 'empty',
      kind: 'dir',
      children: [],
    };
    const disabledTree = buildPatchFileTree([
      patchFile('assets/a.bin', { isBinary: true }),
      patchFile('assets/b.json', { isLarge: true }),
    ]);

    expect(collectExportablePatchFilePaths(emptyDir)).toEqual([]);
    expect(collectExportablePatchFilePaths(findDir(disabledTree, 'assets'))).toEqual([]);
  });
});
