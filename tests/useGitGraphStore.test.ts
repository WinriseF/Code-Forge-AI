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

function makeDiffResponse(files = [
  {
    path: 'src/example.ts',
    status: 'Modified' as const,
    original_content: 'before',
    modified_content: 'after',
    is_binary: false,
    is_large: false,
    additions: 1,
    deletions: 1,
  },
]) {
  return {
    files,
    summary: {
      files_changed: files.length,
      files_added: files.filter((file) => file.status === 'Added').length,
      files_modified: files.filter((file) => file.status === 'Modified').length,
      files_deleted: files.filter((file) => file.status === 'Deleted').length,
      files_renamed: files.filter((file) => file.status === 'Renamed').length,
      insertions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
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
    const pending = deferred<ReturnType<typeof makeDiffResponse>>();

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

    pending.resolve(makeDiffResponse());
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

    invokeMock.mockResolvedValueOnce(makeDiffResponse([]));

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

describe('useGitGraphStore selectCommit', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('merges untracked stash content into a collapsed stash diff', async () => {
    const { useGitGraphStore } = await importFreshGitGraphStore();
    const stashCommit: GraphCommit = {
      ...makeCommit('stash123', ['base123', 'index123', 'untracked123']),
      message: 'On main: demo',
      refs: [{ name: 'stash@{0}', kind: 'Stash' }],
    };

    invokeMock
      .mockResolvedValueOnce(makeDiffResponse([
        {
          path: 'src/tracked.ts',
          status: 'Modified',
          original_content: 'before',
          modified_content: 'after',
          is_binary: false,
          is_large: false,
          additions: 4,
          deletions: 1,
        },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([
        {
          path: 'src/untracked.ts',
          status: 'Added',
          original_content: '',
          modified_content: 'new file',
          is_binary: false,
          is_large: false,
          additions: 8,
          deletions: 0,
        },
      ]));

    useGitGraphStore.setState({
      commits: [stashCommit, makeCommit('base123')],
    });

    await useGitGraphStore.getState().selectCommit('stash123', '/repo');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'plugin:ctxrun-plugin-git|get_git_diff', {
      projectPath: '/repo',
      oldHash: 'base123',
      newHash: 'stash123',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'plugin:ctxrun-plugin-git|get_git_diff', {
      projectPath: '/repo',
      oldHash: '4b825dc642cb6eb9a060e54bf899d15363d7aa91',
      newHash: 'untracked123',
    });
    expect(useGitGraphStore.getState()).toMatchObject({
      selectedCommitHash: 'stash123',
      diffOldHash: 'base123',
      diffNewHash: 'stash123',
      canExportCurrentDiff: false,
      isLoading: false,
    });
    expect(useGitGraphStore.getState().diffFiles.map((file) => file.path)).toEqual([
      'src/tracked.ts',
      'src/untracked.ts',
    ]);
    expect(useGitGraphStore.getState().diffSummary).toMatchObject({
      files_changed: 2,
      files_added: 1,
      files_modified: 1,
      insertions: 12,
      deletions: 1,
    });
  });

  it('recomputes summary counts from deduped files when stash diffs overlap on path', async () => {
    const { useGitGraphStore } = await importFreshGitGraphStore();
    const stashCommit: GraphCommit = {
      ...makeCommit('stash123', ['base123', 'index123', 'untracked123']),
      message: 'On main: demo',
      refs: [{ name: 'stash@{0}', kind: 'Stash' }],
    };

    invokeMock
      .mockResolvedValueOnce(makeDiffResponse([
        {
          path: 'src/overlap.ts',
          status: 'Modified',
          original_content: 'before',
          modified_content: 'after',
          is_binary: false,
          is_large: false,
          additions: 3,
          deletions: 1,
        },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([
        {
          path: 'src/overlap.ts',
          status: 'Added',
          original_content: '',
          modified_content: 'new file',
          is_binary: false,
          is_large: false,
          additions: 5,
          deletions: 0,
        },
      ]));

    useGitGraphStore.setState({
      commits: [stashCommit, makeCommit('base123')],
    });

    await useGitGraphStore.getState().selectCommit('stash123', '/repo');

    expect(useGitGraphStore.getState().diffFiles.map((file) => file.path)).toEqual(['src/overlap.ts']);
    expect(useGitGraphStore.getState().diffSummary).toMatchObject({
      files_changed: 1,
      files_added: 1,
      files_modified: 0,
      files_deleted: 0,
      files_renamed: 0,
      insertions: 5,
      deletions: 0,
    });
  });

  it('keeps export enabled for stash commits without an untracked helper commit', async () => {
    const { useGitGraphStore } = await importFreshGitGraphStore();
    const stashCommit: GraphCommit = {
      ...makeCommit('stash123', ['base123', 'index123']),
      message: 'On main: tracked only',
      refs: [{ name: 'stash@{1}', kind: 'Stash' }],
    };

    invokeMock.mockResolvedValueOnce(makeDiffResponse([
      {
        path: 'src/tracked.ts',
        status: 'Modified',
        original_content: 'before',
        modified_content: 'after',
        is_binary: false,
        is_large: false,
        additions: 2,
        deletions: 1,
      },
    ]));

    useGitGraphStore.setState({
      commits: [stashCommit, makeCommit('base123')],
    });

    await useGitGraphStore.getState().selectCommit('stash123', '/repo');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(useGitGraphStore.getState()).toMatchObject({
      diffOldHash: 'base123',
      diffNewHash: 'stash123',
      canExportCurrentDiff: true,
      isLoading: false,
    });
    expect(useGitGraphStore.getState().diffFiles.map((file) => file.path)).toEqual(['src/tracked.ts']);
  });
});

describe('useGitGraphStore closeDiff', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('hides the diff panel and preserves the selected file', async () => {
    const { useGitGraphStore } = await importFreshGitGraphStore();

    useGitGraphStore.setState({
      selectedFilePath: 'src/example.ts',
      showDiffPanel: true,
    });

    useGitGraphStore.getState().closeDiff();

    expect(useGitGraphStore.getState()).toMatchObject({
      selectedFilePath: 'src/example.ts',
      showDiffPanel: false,
    });
  });
});

describe('useGitGraphStore compareWith stash handling', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('reports an error instead of silently comparing stash commits', async () => {
    const { useGitGraphStore } = await importFreshGitGraphStore();
    const stashCommit: GraphCommit = {
      ...makeCommit('stash123', ['base123', 'index123']),
      refs: [{ name: 'stash@{0}', kind: 'Stash' }],
    };

    useGitGraphStore.setState({
      commits: [makeCommit('base123'), stashCommit],
      selectedCommitHash: 'base123',
      error: null,
    });

    await useGitGraphStore.getState().compareWith('stash123', '/repo');

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useGitGraphStore.getState().error).toBe('Collapsed stash diffs cannot be compared yet');
  });
});
