import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { GraphCommit, PatchFileItem } from '@/components/features/patch/patch_types';

export const GIT_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-git|';
export const WORKING_TREE_HASH = '__WORK_DIR__';

interface GitDiffFile {
  path: string;
  old_path?: string;
  status: 'Added' | 'Modified' | 'Deleted' | 'Renamed';
  original_content: string;
  modified_content: string;
  is_binary: boolean;
  is_large: boolean;
}

interface GitGraphState {
  // Data
  commits: GraphCommit[];
  selectedCommitHash: string | null;
  diffFiles: PatchFileItem[];
  selectedFilePath: string | null;
  hasMoreCommits: boolean;

  // Current diff hashes (for export)
  diffOldHash: string | null;
  diffNewHash: string | null;

  // Diff comparison
  compareBaseHash: string | null;

  // UI
  showDiffPanel: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Actions
  loadCommits: (projectPath: string) => Promise<void>;
  loadMoreCommits: (projectPath: string) => Promise<void>;
  selectCommit: (hash: string, projectPath: string) => Promise<void>;
  selectFile: (path: string) => void;
  closeDiff: () => void;
  startCompare: (hash: string) => void;
  cancelCompare: () => void;
}

const BRANCH_COLORS = [
  '#89b4fa', // blue
  '#a6e3a1', // green
  '#f9e2af', // yellow
  '#f38ba8', // red
  '#cba6f7', // mauve
  '#fab387', // peach
  '#94e2d5', // teal
  '#f5c2e7', // pink
];

const ROW_HEIGHT = 44;
const COMMITS_PAGE_SIZE = 300;

function mapDiffFiles(result: GitDiffFile[]): PatchFileItem[] {
  return result.map((file) => ({
    id: file.path,
    path: file.path,
    original: file.original_content,
    modified: file.modified_content,
    status: 'success' as const,
    gitStatus: file.status,
    renameFrom: file.status === 'Renamed' && file.old_path ? file.old_path : undefined,
    isBinary: file.is_binary,
    isLarge: file.is_large,
  }));
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const useGitGraphStore = create<GitGraphState>((set, get) => ({
  commits: [],
  selectedCommitHash: null,
  diffFiles: [],
  selectedFilePath: null,
  hasMoreCommits: true,
  diffOldHash: null,
  diffNewHash: null,
  compareBaseHash: null,
  showDiffPanel: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,

  loadCommits: async (projectPath: string) => {
    set({
      isLoading: true,
      isLoadingMore: false,
      error: null,
      selectedCommitHash: null,
      diffFiles: [],
      selectedFilePath: null,
      hasMoreCommits: true,
      showDiffPanel: false,
      compareBaseHash: null,
      diffOldHash: null,
      diffNewHash: null,
    });
    try {
      const commits = await invoke<GraphCommit[]>(`${GIT_PLUGIN_PREFIX}get_git_log_graph`, {
        projectPath,
        limit: COMMITS_PAGE_SIZE,
        skip: 0,
      });
      set({
        commits,
        isLoading: false,
        hasMoreCommits: commits.length === COMMITS_PAGE_SIZE,
      });
    } catch (err: unknown) {
      set({ error: errorToString(err), isLoading: false, isLoadingMore: false, commits: [] });
    }
  },

  loadMoreCommits: async (projectPath: string) => {
    const state = get();
    if (state.isLoading || state.isLoadingMore || !state.hasMoreCommits) {
      return;
    }

    set({ isLoadingMore: true, error: null });

    try {
      const nextPage = await invoke<GraphCommit[]>(`${GIT_PLUGIN_PREFIX}get_git_log_graph`, {
        projectPath,
        limit: COMMITS_PAGE_SIZE,
        skip: state.commits.length,
      });

      set((current) => {
        const existing = new Set(current.commits.map((commit) => commit.hash));
        const appended = nextPage.filter((commit) => !existing.has(commit.hash));

        return {
          commits: [...current.commits, ...appended],
          isLoadingMore: false,
          hasMoreCommits: nextPage.length === COMMITS_PAGE_SIZE,
        };
      });
    } catch (err: unknown) {
      set({
        error: errorToString(err),
        isLoadingMore: false,
      });
    }
  },

  selectCommit: async (hash: string, projectPath: string) => {
    const state = get();

    // Compare mode: diff two commits
    if (state.compareBaseHash && state.compareBaseHash !== hash) {
      const baseHash = state.compareBaseHash;
      // Keep compareBaseHash during loading so UI shows "Comparing..." indicator
      set({ isLoading: true, error: null, selectedFilePath: null, showDiffPanel: false });
      try {
        const result = await invoke<GitDiffFile[]>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
          projectPath,
          oldHash: baseHash,
          newHash: hash,
        });
        set({
          selectedCommitHash: hash,
          diffFiles: mapDiffFiles(result),
          selectedFilePath: null,
          showDiffPanel: false,
          isLoading: false,
          diffOldHash: baseHash,
          diffNewHash: hash,
          compareBaseHash: null,
        });
      } catch (err: unknown) {
        set({ error: errorToString(err), isLoading: false, compareBaseHash: null });
      }
      return;
    }

    // Cancel compare if clicking same commit
    if (state.compareBaseHash === hash) {
      set({ compareBaseHash: null });
      return;
    }

    // Normal: show single commit diff (commit^ vs commit)
    set({
      selectedCommitHash: hash,
      selectedFilePath: null,
      showDiffPanel: false,
      isLoading: true,
      error: null,
    });

    // Working tree: diff HEAD vs working directory
    if (hash === WORKING_TREE_HASH) {
      const headCommit = state.commits.find((c) => c.refs.some((r) => r.kind === 'Head'));
      const headHash = headCommit?.hash ?? '';
      try {
        const result = await invoke<GitDiffFile[]>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
          projectPath,
          oldHash: headHash,
          newHash: WORKING_TREE_HASH,
        });
        set({
          diffFiles: mapDiffFiles(result),
          isLoading: false,
          diffOldHash: headHash,
          diffNewHash: WORKING_TREE_HASH,
        });
      } catch (err: unknown) {
        set({ error: errorToString(err), isLoading: false });
      }
      return;
    }

    const commit = state.commits.find((c) => c.hash === hash);
    if (!commit) { set({ isLoading: false }); return; }

    try {
      const oldHash = commit.parent_hashes.length > 0
        ? commit.parent_hashes[0]
        : '4b825dc642cb6eb9a060e54bf899d15363d7aa91'; // git empty tree

      const result = await invoke<GitDiffFile[]>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
        projectPath,
        oldHash,
        newHash: hash,
      });
      set({
        diffFiles: mapDiffFiles(result),
        isLoading: false,
        diffOldHash: oldHash,
        diffNewHash: hash,
      });
    } catch (err: unknown) {
      set({ error: errorToString(err), isLoading: false });
    }
  },

  selectFile: (path: string) => {
    set({ selectedFilePath: path, showDiffPanel: true });
  },

  closeDiff: () => {
    set({ showDiffPanel: false, selectedFilePath: null });
  },

  startCompare: (hash: string) => {
    set({ compareBaseHash: hash, error: null });
  },

  cancelCompare: () => {
    set({ compareBaseHash: null });
  },
}));

export { BRANCH_COLORS, ROW_HEIGHT };
