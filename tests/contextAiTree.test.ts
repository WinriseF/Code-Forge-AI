import { describe, expect, it } from 'vitest';

import {
  buildSelectableTreePrompt,
  resolveSelectablePath,
  validateAiSelectionSuggestions,
} from '@/lib/context-ai/tree';
import { FileNode } from '@/types/context';

function file(path: string, selected = false, locked = false): FileNode {
  const name = path.split('/').pop() ?? path;
  return {
    id: path,
    name,
    path,
    kind: 'file',
    isSelected: selected,
    isLocked: locked,
  };
}

describe('context AI tree helpers', () => {
  const tree: FileNode[] = [
    {
      id: '/repo/src',
      name: 'src',
      path: '/repo/src',
      kind: 'dir',
      isSelected: false,
      children: [
        file('/repo/src/main.ts'),
        file('/repo/src/ignored.ts', false, true),
        {
          id: '/repo/src/context',
          name: 'context',
          path: '/repo/src/context',
          kind: 'dir',
          isSelected: false,
          children: [
            file('/repo/src/context/ContextView.tsx'),
            file('/repo/src/context/FileTreeNode.tsx'),
          ],
        },
      ],
    },
    {
      id: '/repo/dist',
      name: 'dist',
      path: '/repo/dist',
      kind: 'dir',
      isSelected: false,
      isLocked: true,
      children: [file('/repo/dist/app.js')],
    },
  ];

  it('buildSelectableTreePrompt omits locked nodes', () => {
    const prompt = buildSelectableTreePrompt(tree, '/repo');

    expect(prompt).toContain('src/');
    expect(prompt).toContain('src/context/ContextView.tsx');
    expect(prompt).not.toContain('ignored.ts');
    expect(prompt).not.toContain('dist');
  });

  it('validateAiSelectionSuggestions expands selectable directories and reports misses', () => {
    const result = validateAiSelectionSuggestions(tree, '/repo', [
      { path: 'src/context', kind: 'dir', reason: 'Context UI components.' },
      { path: 'missing.ts', kind: 'file', reason: 'Does not exist.' },
    ]);

    expect(result.validSuggestions).toEqual([
      { path: 'src/context', kind: 'dir', reason: 'Context UI components.' },
    ]);
    expect(result.selectedPaths.sort()).toEqual([
      '/repo/src/context/ContextView.tsx',
      '/repo/src/context/FileTreeNode.tsx',
    ]);
    expect(result.unmatchedPaths).toEqual(['missing.ts']);
  });

  it('resolveSelectablePath repairs duplicated leading path segments', () => {
    const result = resolveSelectablePath(
      tree,
      '/repo',
      'src/src/context/ContextView.tsx',
      'file'
    );

    expect(result?.relativePath).toBe('src/context/ContextView.tsx');
    expect(result?.node.path).toBe('/repo/src/context/ContextView.tsx');
  });
});
