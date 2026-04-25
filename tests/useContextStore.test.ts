import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROJECT_IGNORE, FileNode } from '@/types/context';

const { invokeMock, storageMap } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  storageMap: new Map<string, string>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/lib/storage', () => ({
  fileStorage: {
    getItem: vi.fn(async (name: string) => storageMap.get(name) ?? null),
    setItem: vi.fn(async (name: string, value: string) => {
      storageMap.set(name, value);
    }),
    removeItem: vi.fn(async (name: string) => {
      storageMap.delete(name);
    }),
  },
}));

type ContextStore = typeof import('@/store/useContextStore')['useContextStore'];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function importFreshContextStore(): Promise<ContextStore> {
  vi.resetModules();
  const mod = await import('@/store/useContextStore');
  return mod.useContextStore;
}

function makeNode(overrides: Partial<FileNode>): FileNode {
  return {
    id: 'n',
    name: 'node',
    path: '/node',
    kind: 'file',
    isSelected: true,
    ...overrides,
  };
}

describe('useContextStore', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    storageMap.clear();
  });

  it('setProjectRoot keeps newest config when older request resolves later', async () => {
    const first = deferred<any>();
    const second = deferred<any>();

    invokeMock.mockImplementation((command: string, args: any) => {
      if (command !== 'get_project_config') return Promise.resolve(null);
      if (args.path === '/project-a') return first.promise;
      if (args.path === '/project-b') return second.promise;
      return Promise.resolve(null);
    });

    const useContextStore = await importFreshContextStore();
    const firstLoad = useContextStore.getState().setProjectRoot('/project-a');
    const secondLoad = useContextStore.getState().setProjectRoot('/project-b');

    second.resolve({ dirs: ['b'], files: [], extensions: [] });
    await secondLoad;

    first.resolve({ dirs: ['a'], files: [], extensions: [] });
    await firstLoad;

    const state = useContextStore.getState();
    expect(state.projectRoot).toBe('/project-b');
    expect(state.projectIgnore).toEqual({ dirs: ['b'], files: [], extensions: [] });
  });

  it('setProjectRoot(null) clears project-scoped state', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      projectRoot: '/project',
      scannedProjectRoot: '/project',
      projectIgnore: { dirs: ['dist'], files: ['a.txt'], extensions: ['log'] },
      fileTree: [makeNode({ id: 'a', name: 'a.ts', path: '/project/a.ts' })],
      expandedIds: ['dir-a'],
      hasProjectIgnoreFiles: true,
    });

    await useContextStore.getState().setProjectRoot(null);

    const state = useContextStore.getState();
    expect(state.projectRoot).toBeNull();
    expect(state.scannedProjectRoot).toBeNull();
    expect(state.projectIgnore).toEqual(DEFAULT_PROJECT_IGNORE);
    expect(state.fileTree).toEqual([]);
    expect(state.expandedIds).toEqual([]);
    expect(state.hasProjectIgnoreFiles).toBe(false);
  });

  it('updateProjectIgnore deduplicates add operations and persists config', async () => {
    invokeMock.mockResolvedValue(null);
    const useContextStore = await importFreshContextStore();

    useContextStore.setState({
      projectRoot: '/project',
      projectIgnore: { dirs: [], files: [], extensions: [] },
    });

    useContextStore.getState().updateProjectIgnore('dirs', 'add', 'dist');
    useContextStore.getState().updateProjectIgnore('dirs', 'add', 'dist');
    useContextStore.getState().updateProjectIgnore('dirs', 'remove', 'dist');

    const state = useContextStore.getState();
    expect(state.projectIgnore.dirs).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith(
      'save_project_config',
      expect.objectContaining({
        path: '/project',
      })
    );
  });

  it('refreshTreeStatus applies config lock and git-ignore lock correctly', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      projectIgnore: { dirs: [], files: ['secret.txt'], extensions: [] },
      isIgnoreSyncActive: false,
      fileTree: [
        makeNode({
          id: 'secret',
          name: 'secret.txt',
          path: '/secret.txt',
          kind: 'file',
          isSelected: true,
        }),
        makeNode({
          id: 'git-file',
          name: 'git-only.txt',
          path: '/git-only.txt',
          kind: 'file',
          isSelected: false,
          ignoreSource: 'git',
        }),
      ],
    });

    await useContextStore.getState().refreshTreeStatus(DEFAULT_PROJECT_IGNORE);
    let state = useContextStore.getState();
    const secret = state.fileTree.find((x) => x.id === 'secret')!;
    const gitOnly = state.fileTree.find((x) => x.id === 'git-file')!;

    expect(secret.isLocked).toBe(true);
    expect(secret.isSelected).toBe(false);
    expect(secret.ignoreSource).toBe('filter');

    expect(gitOnly.isLocked).toBe(false);
    expect(gitOnly.isSelected).toBe(true);
    expect(gitOnly.ignoreSource).toBeUndefined();

    useContextStore.setState({
      isIgnoreSyncActive: true,
      fileTree: [
        makeNode({
          id: 'git-file',
          name: 'git-only.txt',
          path: '/git-only.txt',
          kind: 'file',
          isSelected: true,
          ignoreSource: 'git',
        }),
      ],
    });
    await useContextStore.getState().refreshTreeStatus(DEFAULT_PROJECT_IGNORE);
    state = useContextStore.getState();
    const gitLocked = state.fileTree.find((x) => x.id === 'git-file')!;
    expect(gitLocked.isLocked).toBe(true);
    expect(gitLocked.isSelected).toBe(false);
    expect(gitLocked.ignoreSource).toBe('git');
  });

  it('setFileTree ignores stale scan result and accepts matching scan root', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      projectRoot: '/project-b',
      scannedProjectRoot: null,
      fileTree: [],
    });

    const staleTree = [makeNode({ id: 'stale', name: 'stale.ts', path: '/project-a/stale.ts' })];
    useContextStore.getState().setFileTree(staleTree, '/project-a');
    expect(useContextStore.getState().fileTree).toEqual([]);
    expect(useContextStore.getState().scannedProjectRoot).toBeNull();

    const activeTree = [makeNode({ id: 'active', name: 'active.ts', path: '/project-b/active.ts' })];
    useContextStore.getState().setFileTree(activeTree, '/project-b');
    expect(useContextStore.getState().fileTree).toEqual(activeTree);
    expect(useContextStore.getState().scannedProjectRoot).toBe('/project-b');
  });

  it('setAllExpanded collects only directory ids and supports collapse all', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      fileTree: [
        makeNode({
          id: 'dir-1',
          name: 'src',
          kind: 'dir',
          children: [
            makeNode({ id: 'file-1', name: 'a.ts', path: '/src/a.ts' }),
            makeNode({
              id: 'dir-2',
              name: 'nested',
              kind: 'dir',
              children: [makeNode({ id: 'file-2', name: 'b.ts', path: '/src/nested/b.ts' })],
            }),
          ],
        }),
      ],
      expandedIds: [],
    });

    useContextStore.getState().setAllExpanded(true);
    expect(useContextStore.getState().expandedIds.sort()).toEqual(['dir-1', 'dir-2']);

    useContextStore.getState().setAllExpanded(false);
    expect(useContextStore.getState().expandedIds).toEqual([]);
  });

  it('toggleExpand adds and removes ids while same-root project loads are ignored', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({ expandedIds: ['dir-1'], projectRoot: '/project' });

    useContextStore.getState().toggleExpand('dir-2');
    expect(useContextStore.getState().expandedIds.sort()).toEqual(['dir-1', 'dir-2']);

    useContextStore.getState().toggleExpand('dir-1');
    expect(useContextStore.getState().expandedIds).toEqual(['dir-2']);

    await useContextStore.getState().setProjectRoot('/project');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('setProjectRoot falls back to default ignore config when loading fails', async () => {
    invokeMock.mockRejectedValue(new Error('load failed'));
    const useContextStore = await importFreshContextStore();

    await useContextStore.getState().setProjectRoot('/project');

    expect(useContextStore.getState().projectRoot).toBe('/project');
    expect(useContextStore.getState().projectIgnore).toEqual(DEFAULT_PROJECT_IGNORE);
  });

  it('setFileTree without scannedRoot uses the active project root', async () => {
    const useContextStore = await importFreshContextStore();
    const tree = [makeNode({ id: 'active', name: 'active.ts', path: '/project/active.ts' })];
    useContextStore.setState({
      projectRoot: '/project',
      scannedProjectRoot: null,
    });

    useContextStore.getState().setFileTree(tree);

    expect(useContextStore.getState().fileTree).toEqual(tree);
    expect(useContextStore.getState().scannedProjectRoot).toBe('/project');
  });

  it('toggleSelect and invertSelection respect locked ancestors', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      fileTree: [
        makeNode({
          id: 'locked-dir',
          name: 'vendor',
          kind: 'dir',
          isSelected: false,
          isLocked: true,
          children: [
            makeNode({
              id: 'locked-child',
              name: 'a.ts',
              path: '/vendor/a.ts',
              isSelected: true,
            }),
          ],
        }),
        makeNode({
          id: 'open-dir',
          name: 'src',
          kind: 'dir',
          isSelected: false,
          children: [
            makeNode({
              id: 'open-child',
              name: 'b.ts',
              path: '/src/b.ts',
              isSelected: false,
            }),
          ],
        }),
      ],
    });

    useContextStore.getState().toggleSelect('locked-dir', true);
    let state = useContextStore.getState();
    const lockedDir = state.fileTree[0];
    expect(lockedDir.isSelected).toBe(false);
    expect(lockedDir.children?.[0].isSelected).toBe(false);

    useContextStore.getState().toggleSelect('open-dir', true);
    state = useContextStore.getState();
    const openDir = state.fileTree[1];
    expect(openDir.isSelected).toBe(true);
    expect(openDir.children?.[0].isSelected).toBe(true);

    useContextStore.getState().invertSelection();
    state = useContextStore.getState();
    expect(state.fileTree[0].isSelected).toBe(false);
    expect(state.fileTree[0].children?.[0].isSelected).toBe(false);
    expect(state.fileTree[1].isSelected).toBe(false);
    expect(state.fileTree[1].children?.[0].isSelected).toBe(false);
  });

  it('applySelectionByPaths replaces selection and keeps locked files unselected', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      fileTree: [
        makeNode({
          id: 'src',
          name: 'src',
          path: '/project/src',
          kind: 'dir',
          isSelected: false,
          children: [
            makeNode({
              id: 'a',
              name: 'a.ts',
              path: '/project/src/a.ts',
              isSelected: false,
            }),
            makeNode({
              id: 'b',
              name: 'b.ts',
              path: '/project/src/b.ts',
              isSelected: true,
            }),
            makeNode({
              id: 'locked',
              name: 'locked.ts',
              path: '/project/src/locked.ts',
              isSelected: true,
              isLocked: true,
            }),
          ],
        }),
      ],
    });

    useContextStore.getState().applySelectionByPaths(['/project/src/a.ts', '/project/src/locked.ts']);

    const src = useContextStore.getState().fileTree[0];
    expect(src.isSelected).toBe(true);
    expect(src.children?.[0].isSelected).toBe(true);
    expect(src.children?.[1].isSelected).toBe(false);
    expect(src.children?.[2].isSelected).toBe(false);
  });

  it('refreshTreeStatus applies directory and extension ignores recursively', async () => {
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({
      projectIgnore: { dirs: ['dist'], files: [], extensions: ['log'] },
      isIgnoreSyncActive: true,
      fileTree: [
        makeNode({
          id: 'dist',
          name: 'dist',
          kind: 'dir',
          isSelected: true,
          children: [
            makeNode({
              id: 'dist-child',
              name: 'bundle.js',
              path: '/dist/bundle.js',
              isSelected: true,
            }),
          ],
        }),
        makeNode({
          id: 'log-file',
          name: 'debug.log',
          path: '/debug.log',
          isSelected: true,
        }),
        makeNode({
          id: 'git-dir',
          name: 'ignored-from-git',
          kind: 'dir',
          isSelected: true,
          ignoreSource: 'git',
          children: [
            makeNode({
              id: 'git-child',
              name: 'nested.ts',
              path: '/ignored-from-git/nested.ts',
              isSelected: true,
            }),
          ],
        }),
      ],
    });

    await useContextStore.getState().refreshTreeStatus(DEFAULT_PROJECT_IGNORE);
    const [distDir, logFile, gitDir] = useContextStore.getState().fileTree;
    expect(distDir.isLocked).toBe(true);
    expect(distDir.ignoreSource).toBe('filter');
    expect(distDir.children?.[0].isLocked).toBe(true);
    expect(logFile.isLocked).toBe(true);
    expect(logFile.ignoreSource).toBe('filter');
    expect(gitDir.isLocked).toBe(true);
    expect(gitDir.children?.[0].isLocked).toBe(true);
    expect(gitDir.ignoreSource).toBe('git');
  });

  it('persists ignore config only when a project root exists and can reset it', async () => {
    invokeMock.mockResolvedValue(null);
    const useContextStore = await importFreshContextStore();

    useContextStore.setState({
      projectRoot: null,
      projectIgnore: { dirs: [], files: [], extensions: [] },
    });
    useContextStore.getState().updateProjectIgnore('files', 'add', 'notes.txt');
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useContextStore.getState().projectIgnore.files).toEqual(['notes.txt']);

    useContextStore.setState({ projectRoot: '/project' });
    useContextStore.getState().resetProjectIgnore();
    expect(useContextStore.getState().projectIgnore).toEqual(DEFAULT_PROJECT_IGNORE);
    expect(invokeMock).toHaveBeenCalledWith('save_project_config', {
      path: '/project',
      config: DEFAULT_PROJECT_IGNORE,
    });
  });

  it('toggles ignore sync, simple flags, and detects project ignore files', async () => {
    invokeMock.mockResolvedValue(true);
    const useContextStore = await importFreshContextStore();
    useContextStore.setState({ projectRoot: '/project' });

    useContextStore.getState().setRemoveComments(true);
    useContextStore.getState().setDetectSecrets(false);
    useContextStore.getState().toggleIgnoreSync();
    await useContextStore.getState().checkIgnoreFiles();

    expect(useContextStore.getState().removeComments).toBe(true);
    expect(useContextStore.getState().detectSecrets).toBe(false);
    expect(useContextStore.getState().isIgnoreSyncActive).toBe(true);
    expect(useContextStore.getState().hasProjectIgnoreFiles).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      'plugin:ctxrun-plugin-context|has_ignore_files',
      { projectRoot: '/project' }
    );
  });
});
