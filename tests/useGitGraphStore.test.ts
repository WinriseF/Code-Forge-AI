import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphCommit } from '@/components/features/patch/patch_types';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

async function importFreshGitGraphStore(): Promise<typeof import('@/store/useGitGraphStore')> {
  vi.resetModules();
  return import('@/store/useGitGraphStore');
}

function makeCommit(hash: string, parentHashes: string[] = []): GraphCommit {
  return {
    hash,
    short_hash: hash.slice(0, 7),
    author: 'tester',
    date: '2026-04-19 12:00',
    message: hash,
    parent_hashes: parentHashes,
    refs: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useGitGraphStore compareWith', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('compares the clicked commit against the working tree when the working tree is selected', async () => {
    const { useGitGraphStore, WORKING_TREE_HASH } = await importFreshGitGraphStore();
    const pending = deferred<Array<{
      path: string;
      status: 'Added' | 'Modified' | 'Deleted' | 'Renamed';
      original_content: string;
      modified_content: string;
      is_binary: boolean;
      is_large: boolean;
      old_path?: string;
    }>>();

    invokeMock.mockReturnValueOnce(pending.promise);

    useGitGraphStore.setState({
      commits: [makeCommit('abc1234')],
      selectedCommitHash: WORKING_TREE_HASH,
      selectedExportPaths: new Set(['stale.ts']),
      diffOldHash: 'oldhash',
      diffNewHash: 'newhash',
      selectedFilePath: 'stale.ts',
      showDiffPanel: true,
    });

    const comparePromise = useGitGraphStore.getState().compareWith('abc1234', '/repo');

    expect(useGitGraphStore.getState()).toMatchObject({
      isLoading: true,
      selectedFilePath: null,
      showDiffPanel: false,
      diffOldHash: null,
      diffNewHash: null,
    });
    expect(Array.from(useGitGraphStore.getState().selectedExportPaths)).toEqual([]);

    pending.resolve([
      {
        path: 'src/example.ts',
        status: 'Modified',
        original_content: 'before',
        modified_content: 'after',
        is_binary: false,
        is_large: false,
      },
    ]);
    await comparePromise;

    expect(invokeMock).toHaveBeenCalledWith('plugin:ctxrun-plugin-git|get_git_diff', {
      projectPath: '/repo',
      oldHash: 'abc1234',
      newHash: WORKING_TREE_HASH,
    });

    expect(useGitGraphStore.getState()).toMatchObject({
      selectedCommitHash: WORKING_TREE_HASH,
      compareTargetHash: 'abc1234',
      diffOldHash: 'abc1234',
      diffNewHash: WORKING_TREE_HASH,
      isLoading: false,
    });
    expect(Array.from(useGitGraphStore.getState().selectedExportPaths)).toEqual(['src/example.ts']);
  });

  it('keeps working tree as the new hash when comparing a selected commit to current changes', async () => {
    const { useGitGraphStore, WORKING_TREE_HASH } = await importFreshGitGraphStore();

    invokeMock.mockResolvedValueOnce([]);

    useGitGraphStore.setState({
      commits: [makeCommit('base123')],
      selectedCommitHash: 'base123',
    });

    await useGitGraphStore.getState().compareWith(WORKING_TREE_HASH, '/repo');

    expect(invokeMock).toHaveBeenCalledWith('plugin:ctxrun-plugin-git|get_git_diff', {
      projectPath: '/repo',
      oldHash: 'base123',
      newHash: WORKING_TREE_HASH,
    });
    expect(useGitGraphStore.getState()).toMatchObject({
      compareTargetHash: WORKING_TREE_HASH,
      diffOldHash: 'base123',
      diffNewHash: WORKING_TREE_HASH,
    });
  });
});
