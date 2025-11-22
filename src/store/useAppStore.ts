import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/storage';
import { IgnoreConfig, DEFAULT_GLOBAL_IGNORE } from '@/types/context';
import { AIModelConfig } from '@/types/model';
import { fetch } from '@tauri-apps/api/http';

// --- 1. 导出类型 (解决循环引用问题) ---
export type AppView = 'prompts' | 'context' | 'patch';
export type AppTheme = 'dark' | 'light';
export type AppLang = 'en' | 'zh';

// --- 2. 默认/兜底模型数据 (2025 Latest) ---
export const DEFAULT_MODELS: AIModelConfig[] = [
  { 
    id: 'gpt-4o', 
    name: 'GPT-4o', 
    provider: 'OpenAI',
    contextLimit: 128000, 
    inputPricePerMillion: 2.50,
    color: 'bg-green-500' 
  },
  { 
    id: 'claude-3-5-sonnet', 
    name: 'Claude 3.5 Sonnet', 
    provider: 'Anthropic',
    contextLimit: 200000, 
    inputPricePerMillion: 3.00, 
    color: 'bg-orange-500' 
  },
  { 
    id: 'gemini-1-5-pro', 
    name: 'Gemini 1.5 Pro', 
    provider: 'Google',
    contextLimit: 2000000, 
    inputPricePerMillion: 1.25, 
    color: 'bg-blue-500' 
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    contextLimit: 64000,
    inputPricePerMillion: 0.14, // 极高性价比
    color: 'bg-purple-500'
  }
];

// 🌍 远程配置源
const REMOTE_CONFIG_URL = 'https://github.com/WinriseF/Code-Forge-AI/models/models.json'; 

// --- 3. Store 接口 ---
interface AppState {
  // UI State
  currentView: AppView;
  isSidebarOpen: boolean;
  isSettingsOpen: boolean;
  isPromptSidebarOpen: boolean;
  isContextSidebarOpen: boolean;
  contextSidebarWidth: number;
  theme: AppTheme;
  language: AppLang;
  
  // Filters
  globalIgnore: IgnoreConfig;

  // ✨ Models State
  models: AIModelConfig[];
  lastUpdated: number;

  // Actions
  setView: (view: AppView) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  setPromptSidebarOpen: (open: boolean) => void;
  setContextSidebarOpen: (open: boolean) => void;
  setContextSidebarWidth: (width: number) => void;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (lang: AppLang) => void;
  updateGlobalIgnore: (type: keyof IgnoreConfig, action: 'add' | 'remove', value: string) => void;
  
  // ✨ Async Actions
  syncModels: () => Promise<void>;
  resetModels: () => void;
}

// --- 4. Store 实现 ---
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // 初始值
      currentView: 'prompts',
      isSidebarOpen: true,
      isSettingsOpen: false,
      isPromptSidebarOpen: true,
      isContextSidebarOpen: true,
      contextSidebarWidth: 300,
      theme: 'dark',
      language: 'zh',
      globalIgnore: DEFAULT_GLOBAL_IGNORE,
      
      // 模型初始值 (优先使用 Store 内部缓存，如果没有则用 Default)
      models: DEFAULT_MODELS,
      lastUpdated: 0,

      // Setters
      setView: (view) => set({ currentView: view }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),
      setPromptSidebarOpen: (open) => set({ isPromptSidebarOpen: open }),
      setContextSidebarOpen: (open) => set({ isContextSidebarOpen: open }),
      setContextSidebarWidth: (width) => set({ contextSidebarWidth: width }),
      setTheme: (theme) => set(() => {
        const root = document.documentElement;
        if (theme === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
        return { theme };
      }),
      setLanguage: (language) => set({ language }),
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

      // ✨ 核心：从云端同步模型
      syncModels: async () => {
        try {
          // 使用 Tauri API 绕过 CORS
          const response = await fetch<AIModelConfig[]>(REMOTE_CONFIG_URL, {
            method: 'GET',
            timeout: 10,
          });

          if (response.ok && Array.isArray(response.data) && response.data.length > 0) {
            set({ 
              models: response.data, 
              lastUpdated: Date.now() 
            });
            console.log(`[AppStore] Models synced successfully: ${response.data.length} models found.`);
          }
        } catch (err) {
          console.warn('[AppStore] Failed to sync models, keeping local cache.', err);
        }
      },

      resetModels: () => set({ models: DEFAULT_MODELS }),
    }),
    {
      name: 'app-config',
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({
        // 持久化所有重要状态
        theme: state.theme,
        language: state.language,
        isSidebarOpen: state.isSidebarOpen,
        isPromptSidebarOpen: state.isPromptSidebarOpen,
        isContextSidebarOpen: state.isContextSidebarOpen,
        contextSidebarWidth: state.contextSidebarWidth,
        currentView: state.currentView,
        globalIgnore: state.globalIgnore,
        models: state.models, // 缓存模型列表
        lastUpdated: state.lastUpdated
      }),
    }
  )
);