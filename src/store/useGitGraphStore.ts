import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { GitDiffSummary, GraphCommit, PatchFileItem } from '@/components/features/patch/patch_types';

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
  additions: number;
  deletions: number;
}

interface GitDiffResponse {
  files: GitDiffFile[];
  summary: GitDiffSummary;
}

interface GitGraphState {
  // Data
  commits: GraphCommit[];
  selectedCommitHash: string | null;
  diffFiles: PatchFileItem[];
  diffSummary: GitDiffSummary | null;
  selectedFilePath: string | null;
  hasMoreCommits: boolean;

  // Current diff hashes (for export)
  diffOldHash: string | null;
  diffNewHash: string | null;

  // Export selection
  selectedExportPaths: Set<string>;

  // Compare view
  compareTargetHash: string | null;

  // UI
  showDiffPanel: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Actions
  loadCommits: (projectPath: string) => Promise<void>;
  loadMoreCommits: (projectPath: string) => Promise<void>;
  selectCommit: (hash: string, projectPath: string) => Promise<void>;
  compareWith: (hash: string, projectPath: string) => Promise<void>;
  selectFile: (path: string) => void;
  closeDiff: () => void;
  cancelCompare: (projectPath: string) => void;
  toggleExportPath: (path: string, checked: boolean) => void;
}

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
    additions: file.additions,
    deletions: file.deletions,
  }));
}

function exportablePaths(files: PatchFileItem[]): Set<string> {
  return new Set(files.filter((f) => !f.isBinary && !f.isLarge).map((f) => f.path));
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf899d15363d7aa91';

export const useGitGraphStore = create<GitGraphState>((set, get) => ({
  commits: [],
  selectedCommitHash: null,
  diffFiles: [],
  diffSummary: null,
  selectedFilePath: null,
  hasMoreCommits: true,
  diffOldHash: null,
  diffNewHash: null,
  selectedExportPaths: new Set(),
  compareTargetHash: null,
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
      diffSummary: null,
      selectedFilePath: null,
      hasMoreCommits: true,
      showDiffPanel: false,
      compareTargetHash: null,
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
    set({
      selectedCommitHash: hash,
      selectedFilePath: null,
      showDiffPanel: false,
      isLoading: true,
      error: null,
      compareTargetHash: null,
      selectedExportPaths: new Set(),
      diffSummary: null,
    });

    // Working tree: diff HEAD vs working directory
    if (hash === WORKING_TREE_HASH) {
      const headCommit = get().commits.find((c) => c.refs.some((r) => r.kind === 'Head'));
      const headHash = headCommit?.hash ?? '';
      try {
        const result = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
          projectPath,
          oldHash: headHash,
          newHash: WORKING_TREE_HASH,
        });
        const files = mapDiffFiles(result.files);
        set({
          diffFiles: files,
          diffSummary: result.summary,
          isLoading: false,
          diffOldHash: headHash,
          diffNewHash: WORKING_TREE_HASH,
          selectedExportPaths: exportablePaths(files),
        });
      } catch (err: unknown) {
        set({ error: errorToString(err), isLoading: false });
      }
      return;
    }

    const commit = get().commits.find((c) => c.hash === hash);
    if (!commit) {
      set({ isLoading: false });
      return;
    }

    try {
      const oldHash = commit.parent_hashes.length > 0 ? commit.parent_hashes[0] : EMPTY_TREE_HASH;
      const result = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
        projectPath,
        oldHash,
        newHash: hash,
      });
      const files = mapDiffFiles(result.files);
      set({
        diffFiles: files,
        diffSummary: result.summary,
        isLoading: false,
        diffOldHash: oldHash,
        diffNewHash: hash,
        selectedExportPaths: exportablePaths(files),
      });
    } catch (err: unknown) {
      set({ error: errorToString(err), isLoading: false });
    }
  },

  compareWith: async (hash: string, projectPath: string) => {
    const state = get();
    // No base selected or clicking the same commit — ignore
    if (!state.selectedCommitHash || state.selectedCommitHash === hash) return;

    const selectedHash = state.selectedCommitHash;
    const oldHash = selectedHash === WORKING_TREE_HASH ? hash : selectedHash;
    const newHash = hash === WORKING_TREE_HASH || selectedHash !== WORKING_TREE_HASH
      ? hash
      : WORKING_TREE_HASH;

    set({
      isLoading: true,
      error: null,
      selectedFilePath: null,
      showDiffPanel: false,
      selectedExportPaths: new Set(),
      diffOldHash: null,
      diffNewHash: null,
      diffSummary: null,
    });

    try {
      const result = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
        projectPath,
        oldHash,
        newHash,
      });
      const files = mapDiffFiles(result.files);
      set({
        diffFiles: files,
        diffSummary: result.summary,
        isLoading: false,
        diffOldHash: oldHash,
        diffNewHash: newHash,
        compareTargetHash: hash,
        selectedExportPaths: exportablePaths(files),
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

  cancelCompare: (projectPath: string) => {
    const state = get();
    if (state.selectedCommitHash) {
      void state.selectCommit(state.selectedCommitHash, projectPath);
    } else {
      set({ compareTargetHash: null });
    }
  },

  toggleExportPath: (path: string, checked: boolean) => {
    set((state) => {
      const next = new Set(state.selectedExportPaths);
      if (checked) next.add(path);
      else next.delete(path);
      return { selectedExportPaths: next };
    });
  },
}));

export { ROW_HEIGHT };
