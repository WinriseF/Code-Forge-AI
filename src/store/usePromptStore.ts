import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { fileStorage } from '@/lib/storage';
import { Prompt, DEFAULT_GROUP, PackManifest, PackManifestItem } from '@/types/prompt';
import { fetch } from '@tauri-apps/api/http';

// ✨ 多源 URL 配置 (GitHub + Gitee)
const MANIFEST_URLS = [
    'https://raw.githubusercontent.com/WinriseF/Code-Forge-AI/main/build/dist/manifest.json', // GitHub Source
    'https://gitee.com/winriseF/models/raw/master/build/dist/manifest.json' // Gitee Source
];

// 提取 base URL 用于下载 pack
const getBaseUrl = (manifestUrl: string) => {
    return manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
};

interface PromptState {
  // --- 数据源 (Data Sources) ---
  localPrompts: Prompt[];     // 用户自己创建的 (持久化)
  repoPrompts: Prompt[];      // 从文件加载的官方包 (不持久化到 storage，每次启动读文件)
  
  // --- UI State ---
  groups: string[];
  activeGroup: string;
  searchQuery: string;
  
  // --- 商店状态 ---
  isStoreLoading: boolean;
  manifest: PackManifest | null; // 商店清单
  activeManifestUrl: string;     // 记录当前生效的 Base URL
  installedPackIds: string[];    // 已安装的包 ID 列表

  // --- Computed ---
  getAllPrompts: () => Prompt[];

  // --- Actions ---
  initStore: () => Promise<void>; 
  setSearchQuery: (query: string) => void;
  setActiveGroup: (group: string) => void;
  
  // Local CRUD
  addPrompt: (data: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt' | 'isFavorite' | 'source'>) => void;
  updatePrompt: (id: string, data: Partial<Prompt>) => void;
  deletePrompt: (id: string) => void;
  toggleFavorite: (id: string) => void;
  
  addGroup: (name: string) => void;
  deleteGroup: (name: string) => void;

  // Store Actions
  fetchManifest: () => Promise<void>;
  installPack: (pack: PackManifestItem) => Promise<void>;
  uninstallPack: (packId: string) => Promise<void>;
}

export const usePromptStore = create<PromptState>()(
  persist(
    (set, get) => ({
      localPrompts: [],
      repoPrompts: [], 
      groups: [DEFAULT_GROUP],
      activeGroup: 'all',
      searchQuery: '',
      
      isStoreLoading: false,
      manifest: null,
      activeManifestUrl: MANIFEST_URLS[0],
      installedPackIds: [], 

      // ✨ 核心修复 1: 实现 Shadowing (遮蔽) 逻辑
      // 如果本地有一个 prompt 标记了 originalId 指向官方 prompt，则隐藏官方那个，防止重复显示
      getAllPrompts: () => {
        const { localPrompts, repoPrompts } = get();
        
        // 1. 收集所有被“覆盖”了的官方指令 ID
        const shadowedIds = new Set(
            localPrompts
                .map(p => p.originalId)
                .filter(id => !!id) // 过滤掉 undefined
        );

        // 2. 过滤掉被覆盖的官方指令
        const visibleRepoPrompts = repoPrompts.filter(p => !shadowedIds.has(p.id));

        return [...localPrompts, ...visibleRepoPrompts];
      },

      setSearchQuery: (query) => set({ searchQuery: query }),
      setActiveGroup: (group) => set({ activeGroup: group }),

      // ✨ 核心修复 2: 并发加载文件，提升启动速度
      initStore: async () => {
        console.log('[Store] Initializing prompts...');
        const installed = get().installedPackIds; 
        
        // 1. 并发读取所有包文件
        const loadPromises = installed.map(async (packId) => {
             const content = await fileStorage.packs.readPack(`${packId}.json`);
             if (!content) return [];
             try {
                 const parsed: Prompt[] = JSON.parse(content);
                 // 注入 packId 和 source 标记
                 return parsed.map(p => ({ 
                     ...p, 
                     packId, 
                     source: 'official' as const 
                 }));
             } catch (e) {
                 console.error(`Failed to parse pack ${packId}`, e);
                 return [];
             }
        });

        // 2. 等待所有读取完成并展平数组
        const results = await Promise.all(loadPromises);
        const loadedPrompts = results.flat();

        // 3. 收集所有涉及的 Group (包括本地的和官方的)
        const loadedGroups = new Set(get().localPrompts.map(p => p.group).filter(Boolean));
        loadedGroups.add(DEFAULT_GROUP);
        // 合并用户手动创建的空组
        get().groups.forEach(g => loadedGroups.add(g));
        // 合并官方包里的组
        loadedPrompts.forEach(p => { if(p.group) loadedGroups.add(p.group); });

        set({ 
            repoPrompts: loadedPrompts,
            groups: Array.from(loadedGroups)
        });
        console.log(`[Store] Loaded ${loadedPrompts.length} official prompts.`);
      },

      addPrompt: (data) => set((state) => ({
        localPrompts: [{
          id: uuidv4(),
          ...data,
          isFavorite: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: 'local'
        }, ...state.localPrompts]
      })),

      updatePrompt: (id, data) => set((state) => ({
        localPrompts: state.localPrompts.map(p => p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p)
      })),

      deletePrompt: (id) => set((state) => ({
        localPrompts: state.localPrompts.filter(p => p.id !== id)
      })),

      // ✨ 核心修复 3: 收藏官方指令时记录 originalId
      toggleFavorite: (id) => set((state) => {
        // 1. 先在本地找
        const localIndex = state.localPrompts.findIndex(p => p.id === id);
        if (localIndex !== -1) {
             // 是本地数据，直接 toggle
             const newLocal = [...state.localPrompts];
             newLocal[localIndex] = { ...newLocal[localIndex], isFavorite: !newLocal[localIndex].isFavorite };
             return { localPrompts: newLocal };
        }

        // 2. 如果本地没找到，去官方库找
        const repoPrompt = state.repoPrompts.find(p => p.id === id);
        if (repoPrompt) {
            // 是官方数据 -> 克隆到本地并设为已收藏
            const newPrompt: Prompt = {
                ...repoPrompt,
                id: uuidv4(),      // 生成全新的本地 ID
                source: 'local',   // 变为本地
                isFavorite: true,  // 默认收藏
                createdAt: Date.now(),
                updatedAt: Date.now(),
                packId: undefined, // 清除 packId (因为它现在属于用户了)
                originalId: repoPrompt.id // ✨ 关键：认祖归宗，用于 getAllPrompts 遮蔽原版
            };
            return {
                localPrompts: [newPrompt, ...state.localPrompts]
            };
        }

        return state;
      }),
      
      addGroup: (name) => set((state) => {
        if (state.groups.includes(name)) return state;
        return { groups: [...state.groups, name] };
      }),

      deleteGroup: (name) => set((state) => ({
        groups: state.groups.filter((g) => g !== name),
        activeGroup: state.activeGroup === name ? 'all' : state.activeGroup,
        localPrompts: state.localPrompts.map(p => p.group === name ? { ...p, group: DEFAULT_GROUP } : p)
      })),

      // --- 商店逻辑 ---
      
      fetchManifest: async () => {
        set({ isStoreLoading: true });
        
        const fetchOne = async (url: string) => {
             const res = await fetch<PackManifest>(url, { method: 'GET', timeout: 8000 });
             if (res.ok) return { data: res.data, url };
             throw new Error("Failed");
        };

        try {
            const result = await Promise.any(MANIFEST_URLS.map(url => fetchOne(url)));
            set({ 
                manifest: result.data, 
                activeManifestUrl: result.url 
            });
            console.log(`[Store] Manifest loaded from ${result.url}`);
        } catch (e) {
            console.error("Failed to fetch manifest from all sources", e);
        } finally {
            set({ isStoreLoading: false });
        }
      },

      installPack: async (pack) => {
        set({ isStoreLoading: true });
        try {
            const baseUrl = getBaseUrl(get().activeManifestUrl);
            const url = `${baseUrl}${pack.url}`; 
            console.log(`[Store] Downloading pack from ${url}`);

            const response = await fetch<Prompt[]>(url);
            
            if (!response.ok) throw new Error("Download failed");
            
            const data = response.data;
            const filename = `${pack.id}.json`;
            await fileStorage.packs.savePack(filename, JSON.stringify(data));
            
            // 更新状态
            const newInstalled = Array.from(new Set([...get().installedPackIds, pack.id]));
            
            // 立即加载到内存
            const labeledData = data.map(p => ({ ...p, packId: pack.id, source: 'official' as const }));
            const otherRepoPrompts = get().repoPrompts.filter(p => p.packId !== pack.id);
            
            const newGroups = new Set(get().groups);
            labeledData.forEach(p => { if(p.group) newGroups.add(p.group); });

            set({
                installedPackIds: newInstalled,
                repoPrompts: [...otherRepoPrompts, ...labeledData],
                groups: Array.from(newGroups)
            });
            
            console.log(`Pack ${pack.id} installed.`);

        } catch (e) {
            console.error(e);
        } finally {
            set({ isStoreLoading: false });
        }
      },

      uninstallPack: async (packId) => {
        set({ isStoreLoading: true });
        try {
            const filename = `${packId}.json`;
            await fileStorage.packs.removePack(filename);
            
            set(state => ({
                installedPackIds: state.installedPackIds.filter(id => id !== packId),
                repoPrompts: state.repoPrompts.filter(p => p.packId !== packId)
            }));
        } catch (e) {
            console.error(e);
        } finally {
            set({ isStoreLoading: false });
        }
      }

    }),
    {
      name: 'prompts-data',
      storage: createJSONStorage(() => fileStorage),
      // 只持久化本地数据
      partialize: (state) => ({
        localPrompts: state.localPrompts,
        groups: state.groups,
        installedPackIds: state.installedPackIds
      }),

      onRehydrateStorage: () => {
        return (state, _error) => {
          if (state) {
            console.log('数据恢复完成，开始加载指令...');
            state.initStore(); // 👈 这里会自动调用，所以 App.tsx 里不需要了
          }
        };
      },
    }
  )
);