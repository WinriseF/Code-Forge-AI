import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { fileStorage } from '@/lib/storage';
import { Prompt, DEFAULT_GROUP, PackManifest, PackManifestItem } from '@/types/prompt';
import { fetch } from '@tauri-apps/api/http';
import { emit } from '@tauri-apps/api/event';

// 多源 URL 配置 (GitHub + Gitee)
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

      // 实现 Shadowing (遮蔽) 逻辑
      // 如果本地有一个 prompt 标记了 originalId 指向官方 prompt，则隐藏官方那个，防止重复显示
      getAllPrompts: () => {
        const { localPrompts, repoPrompts } = get();
        
        // 1. 收集所有被“覆盖”了的官方指令 ID
        const shadowedIds = new Set(
            localPrompts
                .map(p => p.originalId)
                .filter(id => !!id) // 过滤掉 undefined
        );

        // 过滤掉被覆盖的官方指令
        const visibleRepoPrompts = repoPrompts.filter(p => !shadowedIds.has(p.id));

        return [...localPrompts, ...visibleRepoPrompts];
      },

      setSearchQuery: (query) => set({ searchQuery: query }),
      setActiveGroup: (group) => set({ activeGroup: group }),

      // 并发加载文件，提升启动速度
      initStore: async () => {
        console.log('[Store] Initializing prompts...');
        const installed = get().installedPackIds; 
        
        // 临时容器，用于收集有效数据
        const loadedPrompts: Prompt[] = [];
        const validIds: string[] = [];

        // 并发读取所有包文件
        const loadPromises = installed.map(async (packId) => {
             const content = await fileStorage.packs.readPack(`${packId}.json`);
             
             // 如果读不到内容（文件不存在），直接跳过，不加入 validIds
             if (!content) {
                 console.warn(`[Store] Pack ${packId} not found on disk, removing from registry.`);
                 return; 
             }

             try {
                 const parsed: Prompt[] = JSON.parse(content);
                 // 注入 packId 和 source 标记
                 const labeled = parsed.map(p => ({ 
                     ...p, 
                     packId, 
                     source: 'official' as const 
                 }));
                 
                 loadedPrompts.push(...labeled);
                 validIds.push(packId); // ✨ 只有读成功的才算有效
             } catch (e) {
                 console.error(`Failed to parse pack ${packId}`, e);
                 // 解析失败的也不算有效，会被自动剔除
             }
        });

        // 等待所有读取完成
        await Promise.all(loadPromises);

        // 收集所有涉及的 Group
        const loadedGroups = new Set(get().localPrompts.map(p => p.group).filter(Boolean));
        loadedGroups.add(DEFAULT_GROUP);
        get().groups.forEach(g => loadedGroups.add(g));
        loadedPrompts.forEach(p => { if(p.group) loadedGroups.add(p.group); });

        set({ 
            repoPrompts: loadedPrompts,
            installedPackIds: validIds,
            groups: Array.from(loadedGroups)
        });
        
        console.log(`[Store] Sync complete. Valid packs: ${validIds.length}/${installed.length}`);
      },

      addPrompt: (data) => {
        set((state) => ({
          localPrompts: [{
            id: uuidv4(),
            ...data,
            isFavorite: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'local'
          }, ...state.localPrompts]
        }));
        emit('prompts-updated');
      },

      updatePrompt: (id, data) => {
        set((state) => ({
          localPrompts: state.localPrompts.map(p => p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p)
        }));
        emit('prompts-updated');
      },

      deletePrompt: (id) => {
        set((state) => ({
          localPrompts: state.localPrompts.filter(p => p.id !== id)
        }));
        emit('prompts-updated');
      },

      // 收藏官方指令时记录 originalId
      toggleFavorite: (id) => set((state) => {
        // 先在本地找
        const localIndex = state.localPrompts.findIndex(p => p.id === id);
        if (localIndex !== -1) {
             // 是本地数据，直接 toggle
             const newLocal = [...state.localPrompts];
             newLocal[localIndex] = { ...newLocal[localIndex], isFavorite: !newLocal[localIndex].isFavorite };
             return { localPrompts: newLocal };
        }

        // 如果本地没找到，去官方库找
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
                originalId: repoPrompt.id
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
            // 兼容路径问题修复
            const url = `${baseUrl}${pack.url}`; 
            
            console.log(`[Store] Downloading pack from ${url}`);

            const response = await fetch<Prompt[]>(url);
            
            // 详细检查状态码
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`404 Not Found: 无法在服务器找到文件。\nURL: ${url}`);
                }
                if (response.status === 403) {
                    throw new Error(`403 Forbidden: 访问被拒绝 (可能是 Gitee 拦截了敏感词)。`);
                }
                throw new Error(`下载失败 (Status: ${response.status})`);
            }
            
            // 解析数据
            const data = response.data;
            if (!Array.isArray(data)) {
                 throw new Error("数据格式错误：下载的内容不是数组。");
            }

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
            emit('prompts-updated');

        } catch (e: any) {
            console.error("Install failed:", e);
            // 把错误抛出去，让 UI 层能捕获到
            throw e; 
        } finally {
            set({ isStoreLoading: false });
        }
      },

      uninstallPack: async (packId) => {
        set({ isStoreLoading: true });
        try {
            const filename = `${packId}.json`;
            // 尝试删除文件
            try {
                await fileStorage.packs.removePack(filename);
            } catch (fsErr) {
                console.warn(`File ${filename} maybe already deleted or locked:`, fsErr);
                // 忽略文件系统的错误，继续执行状态更新
            }
            
            // 无论文件删除是否成功，都强制在内存中移除这个 ID
            set(state => ({
                installedPackIds: state.installedPackIds.filter(id => id !== packId),
                repoPrompts: state.repoPrompts.filter(p => p.packId !== packId)
            }));
            
            emit('prompts-updated');
        } catch (e) {
            console.error("Uninstall critical error:", e);
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
            state.initStore();
          }
        };
      },
    }
  )
);