import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { GIT_PLUGIN_PREFIX, useGitGraphStore } from './useGitGraphStore';
import { errorToString } from '@/lib/utils';
import type {
  GitBranchSummary,
  GitRepoOverview,
  SwitchBranchOptions,
  SwitchBranchResult,
} from '@/components/features/patch/patch_types';

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
  isSwitching: boolean;
  switchError: string | null;
  branchRequestId: number;
  overviewRequestId: number;
  openPanel: (projectPath: string) => Promise<void>;
  closePanel: () => void;
  fetchOverview: (projectPath: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  searchBranches: (projectPath: string, query?: string) => Promise<void>;
  switchBranch: (
    projectPath: string,
    targetBranch: GitBranchSummary,
    options: SwitchBranchOptions,
  ) => Promise<SwitchBranchResult | null>;
  clearSwitchError: () => void;
}

export const useGitOpsStore = create<GitOpsState>((set, get) => ({
  projectPath: null,
  isPanelOpen: false,
  repoOverview: null,
  isOverviewLoading: false,
  branches: [],
  loadedBranchProjectPath: null,
  loadedBranchQuery: '',
  searchQuery: '',
  isBranchesLoading: false,
  isSwitching: false,
  switchError: null,
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
      switchError: null,
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
      switchError: null,
      isBranchesLoading: false,
      isSwitching: false,
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
        switchError: errorToString(err),
      });
    }
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
        switchError: errorToString(err),
      });
    }
  },

  switchBranch: async (projectPath, targetBranch, options) => {
    set({ isSwitching: true, switchError: null });

    try {
      const result = await invoke<SwitchBranchResult>(`${GIT_PLUGIN_PREFIX}switch_branch`, {
        projectPath,
        targetBranch: targetBranch.full_refname,
        options,
      });

      if (result.success) {
        await Promise.all([
          get().fetchOverview(projectPath),
          get().searchBranches(projectPath, get().searchQuery),
          useGitGraphStore.getState().loadCommits(projectPath, useGitGraphStore.getState().commitSearchQuery),
        ]);
      }

      set({ isSwitching: false, isPanelOpen: false, searchQuery: '', switchError: null });
      return result;
    } catch (err) {
      set({
        isSwitching: false,
        switchError: errorToString(err),
      });
      return null;
    }
  },

  clearSwitchError: () => set({ switchError: null }),
}));
