import { create } from 'zustand';

export type AppView = 'prompts' | 'context' | 'patch';

interface AppState {
  currentView: AppView;
  isSidebarOpen: boolean; // 仅保留这个开关状态
  setView: (view: AppView) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'prompts',
  isSidebarOpen: true, // 默认展开
  setView: (view) => set({ currentView: view }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));