import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { GitDiffSummary, GraphCommit, PatchFileItem } from '@/components/features/patch/patch_types';
import { isExportablePatchFile } from '@/lib/patch_tree_utils';
import {
  getStashBaseHash,
  getStashUntrackedHash,
  isRawStashCommit,
} from '@/components/features/patch/gitGraphDisplay';
import i18n from '@/i18n/config';
import { errorToString } from '@/lib/utils';

export const GIT_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-git|';
export const WORKING_TREE_HASH = '__WORK_DIR__';

function stashCompareUnsupportedMessage(): string {
  return i18n.t('patch.stashCompareUnsupported', 'Collapsed stash diffs cannot be compared yet');
}

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

interface LoadedDiffState {
  diffFiles: PatchFileItem[];
  diffSummary: GitDiffSummary | null;
  selectedFilePath: string | null;
  diffOldHash: string | null;
  diffNewHash: string | null;
  selectedExportPaths: Set<string>;
  canExportCurrentDiff: boolean;
}

interface GitGraphState {
  // Data
  projectPath: string | null;
  commits: GraphCommit[];
  commitSearchQuery: string;
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
  canExportCurrentDiff: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshingView: boolean;
  refreshRequestId: number;
  error: string | null;

  // Actions
  loadCommits: (projectPath: string, searchQuery?: string) => Promise<void>;
  loadMoreCommits: (projectPath: string) => Promise<void>;
  selectCommit: (hash: string, projectPath: string) => Promise<void>;
  compareWith: (hash: string, projectPath: string) => Promise<void>;
  selectFile: (path: string) => void;
  closeDiff: () => void;
  cancelCompare: (projectPath: string) => void;
  toggleExportPath: (path: string, checked: boolean) => void;
  toggleExportPaths: (paths: string[], checked: boolean) => void;
  refreshGitView: (projectPath: string, searchQuery?: string) => Promise<void>;
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
  return new Set(files.filter(isExportablePatchFile).map((f) => f.path));
}

function normalizeExportSelection(files: PatchFileItem[], selectedPaths?: Set<string> | null): Set<string> {
  const exportable = exportablePaths(files);
  if (selectedPaths === undefined) {
    return exportable;
  }
  if (selectedPaths === null || selectedPaths.size === 0) {
    return new Set();
  }

  return new Set(Array.from(selectedPaths).filter((path) => exportable.has(path)));
}

function normalizeSelectedFilePath(files: PatchFileItem[], selectedFilePath?: string | null): string | null {
  if (!selectedFilePath) {
    return null;
  }

  return files.some((file) => file.path === selectedFilePath) ? selectedFilePath : null;
}

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf899d15363d7aa91';

function emptyDiffSummary(): GitDiffSummary {
  return {
    files_changed: 0,
    files_added: 0,
    files_modified: 0,
    files_deleted: 0,
    files_renamed: 0,
    insertions: 0,
    deletions: 0,
  };
}

function mergeDiffResponses(...responses: GitDiffResponse[]): GitDiffResponse {
  const filesByPath = new Map<string, GitDiffFile>();

  for (const response of responses) {
    for (const file of response.files) {
      filesByPath.set(file.path, file);
    }
  }

  const files = Array.from(filesByPath.values());
  const summary = emptyDiffSummary();
  for (const file of files) {
    summary.insertions += file.additions;
    summary.deletions += file.deletions;
    switch (file.status) {
      case 'Added':
        summary.files_added += 1;
        break;
      case 'Modified':
        summary.files_modified += 1;
        break;
      case 'Deleted':
        summary.files_deleted += 1;
        break;
      case 'Renamed':
        summary.files_renamed += 1;
        break;
    }
  }
  summary.files_changed = files.length;

  return {
    files,
    summary,
  };
}

function normalizeCommitQuery(searchQuery = ''): string {
  return searchQuery.trim();
}

async function fetchCommitsPage(projectPath: string, searchQuery: string, limit: number): Promise<GraphCommit[]> {
  return invoke<GraphCommit[]>(`${GIT_PLUGIN_PREFIX}get_git_log_graph`, {
    projectPath,
    limit,
    skip: 0,
    query: searchQuery || null,
  });
}

async function loadSelectedDiffState(
  projectPath: string,
  hash: string,
  commits: GraphCommit[],
  options?: {
    selectedFilePath?: string | null;
    selectedExportPaths?: Set<string> | null;
  },
): Promise<LoadedDiffState> {
  const selectedFilePath = options?.selectedFilePath;
  const selectedExportPaths = options?.selectedExportPaths;

  if (hash === WORKING_TREE_HASH) {
    const headCommit = commits.find((commit) => commit.refs.some((reference) => reference.kind === 'Head'));
    const headHash = headCommit?.hash ?? '';
    const result = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
      projectPath,
      oldHash: headHash,
      newHash: WORKING_TREE_HASH,
    });
    const files = mapDiffFiles(result.files);
    return {
      diffFiles: files,
      diffSummary: result.summary,
      selectedFilePath: normalizeSelectedFilePath(files, selectedFilePath),
      diffOldHash: headHash,
      diffNewHash: WORKING_TREE_HASH,
      canExportCurrentDiff: true,
      selectedExportPaths: normalizeExportSelection(files, selectedExportPaths),
    };
  }

  const commit = commits.find((candidate) => candidate.hash === hash);
  if (!commit) {
    return {
      diffFiles: [],
      diffSummary: null,
      selectedFilePath: null,
      diffOldHash: null,
      diffNewHash: null,
      selectedExportPaths: new Set(),
      canExportCurrentDiff: true,
    };
  }

  if (isRawStashCommit(commit)) {
    const baseHash = getStashBaseHash(commit) ?? EMPTY_TREE_HASH;
    const trackedResult = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
      projectPath,
      oldHash: baseHash,
      newHash: hash,
    });
    const untrackedHash = getStashUntrackedHash(commit);
    const result = untrackedHash
      ? mergeDiffResponses(
        trackedResult,
        await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
          projectPath,
          oldHash: EMPTY_TREE_HASH,
          newHash: untrackedHash,
        }),
      )
      : trackedResult;
    const files = mapDiffFiles(result.files);
    return {
      diffFiles: files,
      diffSummary: result.summary,
      selectedFilePath: normalizeSelectedFilePath(files, selectedFilePath),
      diffOldHash: baseHash,
      diffNewHash: hash,
      canExportCurrentDiff: !untrackedHash,
      selectedExportPaths: normalizeExportSelection(files, selectedExportPaths),
    };
  }

  const oldHash = commit.parent_hashes.length > 0 ? commit.parent_hashes[0] : EMPTY_TREE_HASH;
  const result = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
    projectPath,
    oldHash,
    newHash: hash,
  });
  const files = mapDiffFiles(result.files);
  return {
    diffFiles: files,
    diffSummary: result.summary,
    selectedFilePath: normalizeSelectedFilePath(files, selectedFilePath),
    diffOldHash: oldHash,
    diffNewHash: hash,
    canExportCurrentDiff: true,
    selectedExportPaths: normalizeExportSelection(files, selectedExportPaths),
  };
}

async function loadComparedDiffState(
  projectPath: string,
  selectedCommitHash: string,
  targetHash: string,
  commits: GraphCommit[],
  options?: {
    selectedFilePath?: string | null;
    selectedExportPaths?: Set<string> | null;
  },
): Promise<LoadedDiffState> {
  const selectedCommit = commits.find((commit) => commit.hash === selectedCommitHash);
  const targetCommit = commits.find((commit) => commit.hash === targetHash);
  if (isRawStashCommit(selectedCommit) || isRawStashCommit(targetCommit)) {
    throw new Error(stashCompareUnsupportedMessage());
  }

  const oldHash = selectedCommitHash === WORKING_TREE_HASH ? targetHash : selectedCommitHash;
  const newHash = targetHash === WORKING_TREE_HASH || selectedCommitHash !== WORKING_TREE_HASH
    ? targetHash
    : WORKING_TREE_HASH;

  const result = await invoke<GitDiffResponse>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
    projectPath,
    oldHash,
    newHash,
  });
  const files = mapDiffFiles(result.files);
  return {
    diffFiles: files,
    diffSummary: result.summary,
    selectedFilePath: normalizeSelectedFilePath(files, options?.selectedFilePath),
    diffOldHash: oldHash,
    diffNewHash: newHash,
    canExportCurrentDiff: true,
    selectedExportPaths: normalizeExportSelection(files, options?.selectedExportPaths),
  };
}

export const useGitGraphStore = create<GitGraphState>((set, get) => ({
  projectPath: null,
  commits: [],
  commitSearchQuery: '',
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
  canExportCurrentDiff: true,
  isLoading: false,
  isLoadingMore: false,
  isRefreshingView: false,
  refreshRequestId: 0,
  error: null,

  loadCommits: async (projectPath: string, searchQuery = '') => {
    const normalizedQuery = normalizeCommitQuery(searchQuery);
    set({
      projectPath,
      commitSearchQuery: normalizedQuery,
      isLoading: true,
      isLoadingMore: false,
      isRefreshingView: false,
      refreshRequestId: get().refreshRequestId + 1,
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
      canExportCurrentDiff: true,
      selectedExportPaths: new Set(),
    });
    try {
      const commits = await fetchCommitsPage(projectPath, normalizedQuery, COMMITS_PAGE_SIZE);
      if (get().projectPath !== projectPath || get().commitSearchQuery !== normalizedQuery) {
        return;
      }
      set({
        commits,
        isLoading: false,
        hasMoreCommits: commits.length === COMMITS_PAGE_SIZE,
      });
    } catch (err: unknown) {
      if (get().projectPath !== projectPath || get().commitSearchQuery !== normalizedQuery) {
        return;
      }
      set({ error: errorToString(err), isLoading: false, isLoadingMore: false, commits: [] });
    }
  },

  loadMoreCommits: async (projectPath: string) => {
    const state = get();
    if (state.isLoading || state.isLoadingMore || !state.hasMoreCommits) {
      return;
    }

    const query = state.commitSearchQuery;
    set({ isLoadingMore: true, error: null });

    try {
      const nextPage = await invoke<GraphCommit[]>(`${GIT_PLUGIN_PREFIX}get_git_log_graph`, {
        projectPath,
        limit: COMMITS_PAGE_SIZE,
        skip: state.commits.length,
        query: query || null,
      });

      set((current) => {
        if (current.projectPath !== projectPath || current.commitSearchQuery !== query) {
          return { isLoadingMore: false };
        }

        const existing = new Set(current.commits.map((commit) => commit.hash));
        const appended = nextPage.filter((commit) => !existing.has(commit.hash));

        return {
          commits: [...current.commits, ...appended],
          isLoadingMore: false,
          hasMoreCommits: nextPage.length === COMMITS_PAGE_SIZE,
        };
      });
    } catch (err: unknown) {
      if (get().projectPath !== projectPath || get().commitSearchQuery !== query) {
        return;
      }
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
      canExportCurrentDiff: true,
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
          canExportCurrentDiff: true,
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
      const diffState = await loadSelectedDiffState(projectPath, hash, get().commits);
      set({
        isLoading: false,
        ...diffState,
      });
    } catch (err: unknown) {
      set({ error: errorToString(err), isLoading: false });
    }
  },

  compareWith: async (hash: string, projectPath: string) => {
    const state = get();
    // No base selected or clicking the same commit — ignore
    if (!state.selectedCommitHash || state.selectedCommitHash === hash) return;

    const selectedCommit = state.commits.find((commit) => commit.hash === state.selectedCommitHash);
    const targetCommit = state.commits.find((commit) => commit.hash === hash);
    if (isRawStashCommit(selectedCommit) || isRawStashCommit(targetCommit)) {
      set({ error: stashCompareUnsupportedMessage() });
      return;
    }

    const selectedHash = state.selectedCommitHash;

    set({
      isLoading: true,
      error: null,
      selectedFilePath: null,
      showDiffPanel: false,
      selectedExportPaths: new Set(),
      diffOldHash: null,
      diffNewHash: null,
      diffSummary: null,
      canExportCurrentDiff: true,
    });

    try {
      const diffState = await loadComparedDiffState(projectPath, selectedHash, hash, get().commits);
      set({
        isLoading: false,
        compareTargetHash: hash,
        ...diffState,
      });
    } catch (err: unknown) {
      set({ error: errorToString(err), isLoading: false });
    }
  },

  selectFile: (path: string) => {
    set({ selectedFilePath: path, showDiffPanel: true });
  },

  closeDiff: () => {
    set({ showDiffPanel: false });
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
      if (!exportablePaths(state.diffFiles).has(path)) {
        return state;
      }

      const next = new Set(state.selectedExportPaths);
      if (checked) next.add(path);
      else next.delete(path);
      return { selectedExportPaths: next };
    });
  },

  toggleExportPaths: (paths: string[], checked: boolean) => {
    set((state) => {
      const exportable = exportablePaths(state.diffFiles);
      const normalizedPaths = paths.filter((path) => exportable.has(path));
      if (normalizedPaths.length === 0) {
        return state;
      }

      const next = new Set(state.selectedExportPaths);
      for (const path of normalizedPaths) {
        if (checked) next.add(path);
        else next.delete(path);
      }
      return { selectedExportPaths: next };
    });
  },

  refreshGitView: async (projectPath: string, searchQuery) => {
    const state = get();
    const normalizedQuery = normalizeCommitQuery(searchQuery ?? state.commitSearchQuery);
    const selectedCommitHash = state.selectedCommitHash;
    const compareTargetHash = state.compareTargetHash;
    const selectedFilePath = state.selectedFilePath;
    const selectedExportPaths = state.selectedExportPaths;
    const showDiffPanel = state.showDiffPanel;
    const commitLimit = Math.max(state.commits.length, COMMITS_PAGE_SIZE);
    const requestId = state.refreshRequestId + 1;

    set({
      projectPath,
      commitSearchQuery: normalizedQuery,
      isRefreshingView: true,
      refreshRequestId: requestId,
      error: null,
    });

    try {
      const commits = await fetchCommitsPage(projectPath, normalizedQuery, commitLimit);
      const currentState = get();
      if (
        currentState.projectPath !== projectPath
        || currentState.commitSearchQuery !== normalizedQuery
        || currentState.refreshRequestId !== requestId
      ) {
        return;
      }

      const selectedCommitExists = selectedCommitHash === WORKING_TREE_HASH
        || (selectedCommitHash !== null && commits.some((commit) => commit.hash === selectedCommitHash));
      const compareTargetExists = compareTargetHash === WORKING_TREE_HASH
        || (compareTargetHash !== null && commits.some((commit) => commit.hash === compareTargetHash));

      let nextSelectedCommitHash = selectedCommitExists ? selectedCommitHash : null;
      let nextCompareTargetHash = compareTargetExists ? compareTargetHash : null;
      let nextShowDiffPanel = showDiffPanel && nextSelectedCommitHash !== null;
      let diffState: LoadedDiffState = {
        diffFiles: [],
        diffSummary: null,
        selectedFilePath: null,
        diffOldHash: null,
        diffNewHash: null,
        selectedExportPaths: new Set(),
        canExportCurrentDiff: true,
      };

      if (nextSelectedCommitHash) {
        if (nextCompareTargetHash) {
          diffState = await loadComparedDiffState(
            projectPath,
            nextSelectedCommitHash,
            nextCompareTargetHash,
            commits,
            { selectedFilePath, selectedExportPaths },
          );
        } else {
          diffState = await loadSelectedDiffState(projectPath, nextSelectedCommitHash, commits, {
            selectedFilePath,
            selectedExportPaths,
          });
        }
      } else {
        nextCompareTargetHash = null;
        nextShowDiffPanel = false;
      }

      const finalSelectedFilePath = nextShowDiffPanel ? diffState.selectedFilePath : diffState.selectedFilePath;
      set({
        commits,
        hasMoreCommits: commits.length === commitLimit,
        selectedCommitHash: nextSelectedCommitHash,
        compareTargetHash: nextCompareTargetHash,
        showDiffPanel: nextShowDiffPanel,
        diffFiles: diffState.diffFiles,
        diffSummary: diffState.diffSummary,
        selectedFilePath: finalSelectedFilePath,
        diffOldHash: diffState.diffOldHash,
        diffNewHash: diffState.diffNewHash,
        selectedExportPaths: diffState.selectedExportPaths,
        canExportCurrentDiff: diffState.canExportCurrentDiff,
        isRefreshingView: false,
        error: null,
      });
    } catch (err) {
      const currentState = get();
      if (
        currentState.projectPath !== projectPath
        || currentState.commitSearchQuery !== normalizedQuery
        || currentState.refreshRequestId !== requestId
      ) {
        return;
      }

      set({
        isRefreshingView: false,
        error: errorToString(err),
      });
    }
  },
}));

export { ROW_HEIGHT };
