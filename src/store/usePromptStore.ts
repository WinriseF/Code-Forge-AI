import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { fileStorage } from '@/lib/storage';
import { Prompt, DEFAULT_GROUP } from '@/types/prompt';

interface PromptState {
  // --- Data ---
  prompts: Prompt[];
  groups: string[]; // 存储分组名称列表
  
  // --- UI State (不持久化) ---
  activeGroup: string; // 当前选中的分组
  searchQuery: string; // 搜索关键词

  // --- Actions ---
  setSearchQuery: (query: string) => void;
  setActiveGroup: (group: string) => void;
  
  // CRUD Actions
  addPrompt: (data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt' | 'isFavorite'>) => void;
  updatePrompt: (id: string, data: Partial<Prompt>) => void;
  deletePrompt: (id: string) => void;
  toggleFavorite: (id: string) => void;
  
  addGroup: (name: string) => void;
  deleteGroup: (name: string) => void;
}

export const usePromptStore = create<PromptState>()(
  persist(
    (set) => ({
      prompts: [],
      groups: [DEFAULT_GROUP, 'Git', 'SQL', 'Docker'], // 预设几个常用组
      activeGroup: 'all', // 'all' 表示查看全部
      searchQuery: '',

      setSearchQuery: (query) => set({ searchQuery: query }),
      setActiveGroup: (group) => set({ activeGroup: group }),

      addPrompt: (data) => set((state) => {
        const newPrompt: Prompt = {
          id: uuidv4(),
          ...data,
          isFavorite: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return { prompts: [newPrompt, ...state.prompts] };
      }),

      updatePrompt: (id, data) => set((state) => ({
        prompts: state.prompts.map((p) => 
          p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p
        )
      })),

      deletePrompt: (id) => set((state) => ({
        prompts: state.prompts.filter((p) => p.id !== id)
      })),

      toggleFavorite: (id) => set((state) => ({
        prompts: state.prompts.map((p) => 
          p.id === id ? { ...p, isFavorite: !p.isFavorite } : p
        )
      })),

      addGroup: (name) => set((state) => {
        if (state.groups.includes(name)) return state;
        return { groups: [...state.groups, name] };
      }),

      deleteGroup: (name) => set((state) => ({
        groups: state.groups.filter((g) => g !== name),
        // 如果删除的是当前选中的组，重置为 all
        activeGroup: state.activeGroup === name ? 'all' : state.activeGroup,
        // 可选：把该组下的 prompt 移动到 Default 组，或者直接删除，这里暂时保留 Prompt 但标记为 Default
        prompts: state.prompts.map(p => p.group === name ? { ...p, group: DEFAULT_GROUP } : p)
      })),
    }),
    {
      name: 'prompts-data', // 对应存储的文件名 prompts-data.json (在 fileStorage 内部逻辑里处理)
      storage: createJSONStorage(() => fileStorage),
      // 过滤：只持久化 prompts 和 groups，UI 状态不保存
      partialize: (state) => ({
        prompts: state.prompts,
        groups: state.groups,
      }),
    }
  )
);