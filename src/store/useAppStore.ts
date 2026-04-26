import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/storage';
import { IgnoreConfig, DEFAULT_GLOBAL_IGNORE } from '@/types/context';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { AIModelConfig } from '@/types/model';
import {
  broadcastLanguageSync,
  broadcastProjectRootSync,
  broadcastSearchSettingsSync,
  broadcastSpotlightAppearanceSync,
} from '@/lib/appStoreEvents';
import { fetchFromMirrors, MODEL_MIRROR_BASES } from '@/lib/network';
import i18n from '@/i18n/config';
import { isPeekWindow } from '@/lib/windowContext';
import { useContextStore } from './useContextStore';
import {
  DEFAULT_SPOTLIGHT_APPEARANCE,
  normalizeSpotlightAppearance,
} from '@/windows/spotlight/resizeMode';

const TOOL_RUNTIME_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-tool-runtime|';

function syncAgentWorkspaceRoot(rootDir: string | null): void {
  void invoke(`${TOOL_RUNTIME_PLUGIN_PREFIX}agent_set_workspace_root`, { rootDir }).catch(() => {});
}

type AppView =
  | 'prompts'
  | 'context'
  | 'patch'
  | 'refinery'
  | 'automator'
  | 'miner'
  | 'transfer'
  | 'settings';
export type AppTheme = 'dark' | 'light' | 'black';
export type AppLang = 'en' | 'zh';
export type SearchEngineType = 'google' | 'bing' | 'baidu' | 'custom';

export const DEFAULT_MODELS: AIModelConfig[] = [
  {
    "id": "Gemini-3-pro-preview",
    "name": "Gemini 3 Pro",
    "provider": "Google",
    "contextLimit": 1048576,
    "inputPricePerMillion": 2.00,
    "color": "bg-blue-600"
  },
  {
    "id": "Grok-4-1",
    "name": "Grok 4.1",
    "provider": "Other",
    "contextLimit": 2000000,
    "inputPricePerMillion": 0.20,
    "color": "bg-gray-900"
  },
  {
    "id": "DeepSeek-v3-2",
    "name": "DeepSeek V3.2",
    "provider": "DeepSeek",
    "contextLimit": 128000,
    "inputPricePerMillion": 0.28,
    "color": "bg-purple-600"
  },
  {
    "id": "GLM-4-6",
    "name": "GLM 4.6",
    "provider": "Other",
    "contextLimit": 200000,
    "inputPricePerMillion": 0.6,
    "color": "bg-blue-400"
  }
];

export interface SpotlightAppearance {
  width: number;
  defaultHeight: number;
  maxChatHeight: number;
}

export interface RefinerySettings {
  enabled: boolean;
  strategy: 'time' | 'count' | 'both';
  days?: number;
  maxCount?: number;
  keepPinned: boolean;
}

const DEFAULT_REFINERY_SETTINGS: RefinerySettings = {
  enabled: false,
  strategy: 'count',
  days: 30,
  maxCount: 1000,
  keepPinned: true,
};

export interface GuardSettings {
  enabled: boolean;
  idleTimeoutSecs: number;
  preventSleep: boolean;
  keepDisplayOn: boolean;
}

const DEFAULT_GUARD_SETTINGS: GuardSettings = {
  enabled: false,
  idleTimeoutSecs: 180,
  preventSleep: true,
  keepDisplayOn: false,
};

type WindowDestroyDelay = number;

const MAX_RECENT_PROJECT_ROOTS = 5;

function buildRecentProjectRoots(current: string[], path: string | null): string[] {
  if (!path) return current;

  const deduped = current.filter((item) => item !== path);
  return [path, ...deduped].slice(0, MAX_RECENT_PROJECT_ROOTS);
}

function areGuardSettingsEqual(left: GuardSettings, right: GuardSettings): boolean {
  return (
    left.enabled === right.enabled &&
    left.idleTimeoutSecs === right.idleTimeoutSecs &&
    left.preventSleep === right.preventSleep &&
    left.keepDisplayOn === right.keepDisplayOn
  );
}

interface AppState {
  currentView: AppView;
  isMonitorOpen: boolean;
  isPromptSidebarOpen: boolean;
  isContextSidebarOpen: boolean;
  contextSidebarWidth: number;
  theme: AppTheme;
  language: AppLang;
  spotlightAppearance: SpotlightAppearance;
  spotlightShortcut: string;
  automatorShortcut: string;
  globalIgnore: IgnoreConfig;
  windowDestroyDelay: WindowDestroyDelay;

  // Global project root - shared across all features (Context, Patch, Git Diff)
  projectRoot: string | null;
  recentProjectRoots: string[];

  models: AIModelConfig[];
  lastUpdated: number;

  searchSettings: {
    defaultEngine: SearchEngineType;
    customUrl: string;
  };

  refinerySettings: RefinerySettings;
  guardSettings: GuardSettings;

  setView: (view: AppView) => void;
  setProjectRoot: (path: string | null) => void;
  clearProjectRoot: () => void;
  setMonitorOpen: (open: boolean) => void;
  setPromptSidebarOpen: (open: boolean) => void;
  setContextSidebarOpen: (open: boolean) => void;
  setContextSidebarWidth: (width: number) => void;
  setTheme: (theme: AppTheme, skipEmit?: boolean) => void;
  setLanguage: (lang: AppLang) => void;
  updateGlobalIgnore: (type: keyof IgnoreConfig, action: 'add' | 'remove', value: string) => void;
  setSpotlightShortcut: (shortcut: string) => void;
  setAutomatorShortcut: (shortcut: string) => void;
  setWindowDestroyDelay: (seconds: number) => void;
  setSearchSettings: (config: Partial<AppState['searchSettings']>) => void;
  setRefinerySettings: (config: Partial<RefinerySettings>) => void;
  setGuardSettings: (config: Partial<GuardSettings>) => void;
  syncModels: () => Promise<void>;
  resetModels: () => void;
  setSpotlightAppearance: (config: Partial<SpotlightAppearance>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentView: 'prompts',
      isMonitorOpen: false,
      isPromptSidebarOpen: true,
      isContextSidebarOpen: true,
      contextSidebarWidth: 300,
      theme: 'black',
      language: 'zh',
      spotlightShortcut: 'Alt+S',
      automatorShortcut: 'Alt+F1',
      globalIgnore: DEFAULT_GLOBAL_IGNORE,
      windowDestroyDelay: 0,
      projectRoot: null,
      recentProjectRoots: [],

      models: DEFAULT_MODELS,
      lastUpdated: 0,

      spotlightAppearance: DEFAULT_SPOTLIGHT_APPEARANCE,
      searchSettings: {
        defaultEngine: 'google',
        customUrl: 'https://search.bilibili.com/all?keyword=%s'
      },
      refinerySettings: DEFAULT_REFINERY_SETTINGS,
      guardSettings: DEFAULT_GUARD_SETTINGS,
      setSpotlightAppearance: (config) => {
        set((state) => ({
          spotlightAppearance: normalizeSpotlightAppearance({
            ...state.spotlightAppearance,
            ...config,
          })
        }));
        broadcastSpotlightAppearanceSync(useAppStore.getState().spotlightAppearance);
      },
      setView: (view) => set({ currentView: view }),
      setProjectRoot: (path) => {
        const normalizedPath = path?.trim() || null;
        syncAgentWorkspaceRoot(normalizedPath);

        set((state) => {
          const nextRecentProjectRoots = buildRecentProjectRoots(state.recentProjectRoots, normalizedPath);
          const recentUnchanged =
            nextRecentProjectRoots.length === state.recentProjectRoots.length &&
            nextRecentProjectRoots.every((item, index) => item === state.recentProjectRoots[index]);

          if (state.projectRoot === normalizedPath && recentUnchanged) {
            return state;
          }

          return {
            projectRoot: normalizedPath,
            recentProjectRoots: nextRecentProjectRoots,
          };
        });

        const contextState = useContextStore.getState();
        if (contextState.projectRoot !== normalizedPath) {
          void contextState.setProjectRoot(normalizedPath);
        }

        const nextState = useAppStore.getState();
        broadcastProjectRootSync({
          projectRoot: nextState.projectRoot,
          recentProjectRoots: nextState.recentProjectRoots,
        });
      },
      clearProjectRoot: () => {
        syncAgentWorkspaceRoot(null);
        set((state) => (state.projectRoot === null ? state : { projectRoot: null }));

        const contextState = useContextStore.getState();
        if (contextState.projectRoot !== null) {
          void contextState.setProjectRoot(null);
        }

        const nextState = useAppStore.getState();
        broadcastProjectRootSync({
          projectRoot: nextState.projectRoot,
          recentProjectRoots: nextState.recentProjectRoots,
        });
      },
      setMonitorOpen: (open) => set({ isMonitorOpen: open }),
      setPromptSidebarOpen: (open) => set({ isPromptSidebarOpen: open }),
      setContextSidebarOpen: (open) => set({ isContextSidebarOpen: open }),
      setContextSidebarWidth: (width) => set({ contextSidebarWidth: width }),
      setTheme: (theme, skipEmit = false) => {
        set({ theme });
        if (!skipEmit) {
          void emit('theme-changed', theme).catch((err) => {
            console.error('[AppStore] Failed to emit theme-changed event:', err);
          });
        }
      },
      setSpotlightShortcut: (shortcut) => {
        set({ spotlightShortcut: shortcut });
        void invoke('refresh_shortcuts').catch((err) => {
          console.error('[AppStore] Failed to refresh shortcuts after spotlight update:', err);
        });
      },
      setAutomatorShortcut: (shortcut) => {
        set({ automatorShortcut: shortcut });
        void invoke('refresh_shortcuts').catch((err) => {
          console.error('[AppStore] Failed to refresh shortcuts after automator update:', err);
        });
      },
      setWindowDestroyDelay: (seconds) => set({ windowDestroyDelay: seconds }),
      setSearchSettings: (config) => {
        set((state) => ({
          searchSettings: { ...state.searchSettings, ...config }
        }));
        broadcastSearchSettingsSync(useAppStore.getState().searchSettings);
      },
      setRefinerySettings: (config) => set((state) => ({
        refinerySettings: { ...state.refinerySettings, ...config }
      })),
      setGuardSettings: (config) => {
        set((state) => {
          const nextGuardSettings = {
            ...state.guardSettings,
            ...config,
          };

          if (!nextGuardSettings.preventSleep) {
            nextGuardSettings.keepDisplayOn = false;
          }

          nextGuardSettings.idleTimeoutSecs = Math.max(15, nextGuardSettings.idleTimeoutSecs);

          if (areGuardSettingsEqual(state.guardSettings, nextGuardSettings)) {
            return state;
          }

          return { guardSettings: nextGuardSettings };
        });

        void invoke('refresh_guard_service').catch((err) => {
          console.error('[AppStore] Failed to refresh guard service after settings update:', err);
        });
      },
      setLanguage: (language) => {
        set({ language });
        // Also update i18next language
        i18n.changeLanguage(language);
        broadcastLanguageSync({ language });
      },
      updateGlobalIgnore: (type, action, value) => set((state) => {
        const currentList = state.globalIgnore[type];
        let newList = currentList;
        if (action === 'add' && !currentList.includes(value)) {
          newList = [...currentList, value];
        } else if (action === 'remove') {
          newList = currentList.filter(item => item !== value);
        }
        return { globalIgnore: { ...state.globalIgnore, [type]: newList } };
      }),

      syncModels: async () => {
        try {
          const result = await fetchFromMirrors<AIModelConfig[]>(MODEL_MIRROR_BASES, {
            path: 'models/models.json',
            validate: (data) => Array.isArray(data) && data.length > 0
          });

          set({
            models: result.data,
            lastUpdated: Date.now()
          });

        } catch (err) {
          console.error('[AppStore] Failed to sync models from mirrors:', err);
        }
      },

      resetModels: () => set({ models: DEFAULT_MODELS }),

    }),
    {
      name: 'app-config',
      storage: createJSONStorage(() => fileStorage),
      onRehydrateStorage: () => (state) => {
        // Sync language to i18next after rehydration
        if (state?.language) {
          i18n.changeLanguage(state.language);
          broadcastLanguageSync({ language: state.language });
        }
        // Keep context store in sync after persisted app root is restored.
        if (state?.projectRoot && !isPeekWindow()) {
          void useContextStore.getState().setProjectRoot(state.projectRoot);
        }
      },
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        projectRoot: state.projectRoot,
        recentProjectRoots: state.recentProjectRoots,
        spotlightShortcut: state.spotlightShortcut,
        automatorShortcut: state.automatorShortcut,
        isPromptSidebarOpen: state.isPromptSidebarOpen,
        isContextSidebarOpen: state.isContextSidebarOpen,
        contextSidebarWidth: state.contextSidebarWidth,
        currentView: state.currentView,
        globalIgnore: state.globalIgnore,
        models: state.models,
        lastUpdated: state.lastUpdated,
        spotlightAppearance: state.spotlightAppearance,
        windowDestroyDelay: state.windowDestroyDelay,
        searchSettings: state.searchSettings,
        refinerySettings: state.refinerySettings,
        guardSettings: state.guardSettings,
      }),
      skipHydration: true,
    }
  )
);
