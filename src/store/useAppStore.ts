import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/storage';

export type AppView = 'prompts' | 'context' | 'patch';
export type AppTheme = 'dark' | 'light';
export type AppLang = 'en' | 'zh';

interface AppState {
  currentView: AppView;
  isSidebarOpen: boolean;
  
  // 新增：控制设置弹窗
  isSettingsOpen: boolean; 
  
  theme: AppTheme;
  language: AppLang;

  setView: (view: AppView) => void;
  toggleSidebar: () => void;
  
  // 新增：打开/关闭设置
  setSettingsOpen: (open: boolean) => void; 

  setTheme: (theme: AppTheme) => void; // 改名为 setTheme 更直观
  setLanguage: (lang: AppLang) => void; // 改名为 setLanguage
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentView: 'prompts',
      isSidebarOpen: true,
      isSettingsOpen: false, // 默认关闭
      theme: 'dark', 
      language: 'zh',

      setView: (view) => set({ currentView: view }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),

      // 修改逻辑：直接传入目标值，而不是 toggle
      setTheme: (theme) => set(() => {
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        return { theme };
      }),

      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'app-config',
      storage: createJSONStorage(() => fileStorage),
    }
  )
);