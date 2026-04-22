import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { GIT_PLUGIN_PREFIX, useGitGraphStore } from './useGitGraphStore';
import { errorToString } from '@/lib/utils';
import type {
  GitBranchSummary,
  GitRepoOverview,
  GitSyncResult,
  SwitchBranchOptions,
  SwitchBranchResult,
} from '@/components/features/patch/patch_types';

export type GitOpsOperation = 'switch' | 'push' | 'pull';

interface GitOpsState {
  projectPath: string | null;
  isPanelOpen: boolean;
  repoOverview: GitRepoOverview | null;
  isOverviewLoading: boolean;
  branches: GitBranchSummary[];
  loadedBranchProjectPath: string | null;
  loadedBranchQuery: string;
  searchQuery: string;
  isBranchesLoading: boolean;
  activeOperation: GitOpsOperation | null;
  operationError: string | null;
  branchRequestId: number;
  overviewRequestId: number;
  openPanel: (projectPath: string) => Promise<void>;
  closePanel: () => void;
  fetchOverview: (projectPath: string) => Promise<void>;
  refreshRepositoryState: (projectPath: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  searchBranches: (projectPath: string, query?: string) => Promise<void>;
  switchBranch: (
    projectPath: string,
    targetBranch: GitBranchSummary,
    options: SwitchBranchOptions,
  ) => Promise<SwitchBranchResult | null>;
  pushCurrentBranch: (projectPath: string) => Promise<GitSyncResult | null>;
  pullCurrentBranch: (projectPath: string) => Promise<GitSyncResult | null>;
  clearOperationError: () => void;
}

export const useGitOpsStore = create<GitOpsState>((set, get) => {
  const refreshGitData = async (projectPath: string) => Promise.all([
    get().refreshRepositoryState(projectPath),
    useGitGraphStore.getState().refreshGitView(projectPath),
  ]);

  return {
    projectPath: null,
    isPanelOpen: false,
    repoOverview: null,
    isOverviewLoading: false,
    branches: [],
    loadedBranchProjectPath: null,
    loadedBranchQuery: '',
    searchQuery: '',
    isBranchesLoading: false,
    activeOperation: null,
    operationError: null,
    branchRequestId: 0,
    overviewRequestId: 0,

    openPanel: async (projectPath) => {
      const state = get();
      const hasCachedDefaultBranches = (
        state.loadedBranchProjectPath === projectPath
        && state.loadedBranchQuery === ''
        && state.branches.length > 0
      );
      const hasCachedOverview = state.projectPath === projectPath && state.repoOverview !== null;

      set({
        isPanelOpen: true,
        projectPath,
        searchQuery: '',
        branches: hasCachedDefaultBranches ? state.branches : [],
        operationError: null,
      });

      if (!hasCachedOverview) {
        void get().fetchOverview(projectPath);
      }
      if (!hasCachedDefaultBranches) {
        void get().searchBranches(projectPath, '');
      }
    },

    closePanel: () => {
      set({
        isPanelOpen: false,
        searchQuery: '',
        operationError: null,
        isBranchesLoading: false,
        activeOperation: null,
        branchRequestId: get().branchRequestId + 1,
        overviewRequestId: get().overviewRequestId + 1,
      });
    },

    fetchOverview: async (projectPath) => {
      const requestId = get().overviewRequestId + 1;
      set({
        projectPath,
        isOverviewLoading: true,
        overviewRequestId: requestId,
      });

      try {
        const repoOverview = await invoke<GitRepoOverview>(`${GIT_PLUGIN_PREFIX}get_git_repo_overview`, {
          projectPath,
        });

        if (get().projectPath !== projectPath || get().overviewRequestId !== requestId) {
          return;
        }

        set({ repoOverview, isOverviewLoading: false });
      } catch (err) {
        if (get().projectPath !== projectPath || get().overviewRequestId !== requestId) {
          return;
        }

        set({
          repoOverview: null,
          isOverviewLoading: false,
          operationError: errorToString(err),
        });
      }
    },

    refreshRepositoryState: async (projectPath) => {
      await Promise.all([
        get().fetchOverview(projectPath),
        get().searchBranches(projectPath, get().searchQuery),
      ]);
    },

    setSearchQuery: (query) => {
      set({ searchQuery: query });
    },

    searchBranches: async (projectPath, query) => {
      const requestedQuery = query ?? get().searchQuery;
      const normalizedQuery = requestedQuery.trim();
      const requestId = get().branchRequestId + 1;
      set({
        projectPath,
        searchQuery: requestedQuery,
        isBranchesLoading: true,
        branchRequestId: requestId,
      });

      try {
        const branches = await invoke<GitBranchSummary[]>(`${GIT_PLUGIN_PREFIX}list_git_branches`, {
          projectPath,
          includeRemote: true,
          query: normalizedQuery || null,
        });

        const state = get();
        if (
          state.projectPath !== projectPath
          || state.branchRequestId !== requestId
          || state.searchQuery.trim() !== normalizedQuery
        ) {
          return;
        }

        set({
          branches,
          isBranchesLoading: false,
          loadedBranchProjectPath: projectPath,
          loadedBranchQuery: normalizedQuery,
        });
      } catch (err) {
        const state = get();
        if (state.projectPath !== projectPath || state.branchRequestId !== requestId) {
          return;
        }

        set({
          branches: [],
          isBranchesLoading: false,
          operationError: errorToString(err),
        });
      }
    },

    switchBranch: async (projectPath, targetBranch, options) => {
      set({ activeOperation: 'switch', operationError: null });

      try {
        const result = await invoke<SwitchBranchResult>(`${GIT_PLUGIN_PREFIX}switch_branch`, {
          projectPath,
          targetBranch: targetBranch.full_refname,
          options,
        });

        if (result.success) {
          await refreshGitData(projectPath);
        }

        set({ activeOperation: null, isPanelOpen: false, searchQuery: '', operationError: null });
        return result;
      } catch (err) {
        set({
          activeOperation: null,
          operationError: errorToString(err),
        });
        return null;
      }
    },

    pushCurrentBranch: async (projectPath) => {
      set({ activeOperation: 'push', operationError: null });

      try {
        const result = await invoke<GitSyncResult>(`${GIT_PLUGIN_PREFIX}push_current_branch`, {
          projectPath,
        });

        if (result.success) {
          await refreshGitData(projectPath);
        }

        set({ activeOperation: null, operationError: null });
        return result;
      } catch (err) {
        set({
          activeOperation: null,
          operationError: errorToString(err),
        });
        return null;
      }
    },

    pullCurrentBranch: async (projectPath) => {
      set({ activeOperation: 'pull', operationError: null });

      try {
        const result = await invoke<GitSyncResult>(`${GIT_PLUGIN_PREFIX}pull_current_branch`, {
          projectPath,
        });

        if (result.success) {
          await refreshGitData(projectPath);
        }

        set({ activeOperation: null, operationError: null });
        return result;
      } catch (err) {
        set({
          activeOperation: null,
          operationError: errorToString(err),
        });
        return null;
      }
    },

    clearOperationError: () => set({ operationError: null }),
  };
});
