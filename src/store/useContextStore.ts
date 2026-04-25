import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/storage';
import { IgnoreConfig, DEFAULT_PROJECT_IGNORE, FileNode } from '@/types/context';
import { invoke } from '@tauri-apps/api/core';

const CONTEXT_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-context|';
let projectConfigLoadSeq = 0;
let projectIgnoreEditSeq = 0;

const setAllChildren = (node: FileNode, isSelected: boolean, parentLocked = false): FileNode => {
  const effectiveLocked = parentLocked || !!node.isLocked;
  const newNode = { ...node, isSelected: effectiveLocked ? false : isSelected };
  if (newNode.children) {
    newNode.children = newNode.children.map(child => setAllChildren(child, isSelected, effectiveLocked));
  }
  return newNode;
};

const updateNodeState = (
  nodes: FileNode[],
  targetId: string,
  isSelected: boolean,
  parentLocked = false
): FileNode[] => {
  return nodes.map(node => {
    const effectiveLocked = parentLocked || !!node.isLocked;
    if (node.id === targetId) {
      if (effectiveLocked) {
        return setAllChildren(node, false, true);
      }
      return setAllChildren(node, isSelected, false);
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeState(node.children, targetId, isSelected, effectiveLocked)
      };
    }
    return node;
  });
};

const invertTreeSelection = (nodes: FileNode[], parentLocked = false): FileNode[] => {
  return nodes.map(node => {
    const effectiveLocked = parentLocked || !!node.isLocked;
    const children = node.children ? invertTreeSelection(node.children, effectiveLocked) : undefined;
    if (effectiveLocked) {
      return {
        ...node,
        isSelected: false,
        children
      };
    }

    return {
      ...node,
      isSelected: !node.isSelected,
      children
    };
  });
};

const normalizeSelectionPath = (path: string): string => (
  path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
);

const applySelectionPaths = (
  nodes: FileNode[],
  selectedPaths: Set<string>,
  parentLocked = false
): { nodes: FileNode[]; anySelected: boolean } => {
  let anySelected = false;

  const nextNodes = nodes.map(node => {
    const locked = parentLocked || !!node.isLocked;

    if (locked) {
      const children = node.children
        ? applySelectionPaths(node.children, selectedPaths, true).nodes
        : undefined;
      return {
        ...node,
        isSelected: false,
        children
      };
    }

    if (node.kind === 'file') {
      const selected = selectedPaths.has(normalizeSelectionPath(node.path));
      anySelected = anySelected || selected;
      return {
        ...node,
        isSelected: selected,
      };
    }

    const childResult = node.children
      ? applySelectionPaths(node.children, selectedPaths, false)
      : { nodes: undefined as FileNode[] | undefined, anySelected: false };
    anySelected = anySelected || childResult.anySelected;
    return {
      ...node,
      isSelected: childResult.anySelected,
      children: childResult.nodes,
    };
  });

  return { nodes: nextNodes, anySelected };
};

const collectDirIds = (nodes: FileNode[]): string[] => {
  let ids: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'dir') {
      ids.push(node.id);
      if (node.children) ids = ids.concat(collectDirIds(node.children));
    }
  }
  return ids;
};

interface ContextState {
  projectIgnore: IgnoreConfig;
  removeComments: boolean;

  projectRoot: string | null;
  scannedProjectRoot: string | null;
  fileTree: FileNode[];
  isScanning: boolean;
  detectSecrets: boolean;

  // 展开状态管理
  expandedIds: string[];
  toggleExpand: (id: string) => void;
  setAllExpanded: (expanded: boolean) => void;

  setProjectRoot: (path: string | null) => Promise<void>;
  setFileTree: (tree: FileNode[], scannedRoot?: string | null) => void;
  setIsScanning: (status: boolean) => void;

  updateProjectIgnore: (type: keyof IgnoreConfig, action: 'add' | 'remove', value: string) => void;
  resetProjectIgnore: () => void;
  refreshTreeStatus: (globalConfig: IgnoreConfig) => Promise<void>;
  toggleSelect: (nodeId: string, checked: boolean) => void;
  applySelectionByPaths: (paths: string[]) => void;
  invertSelection: () => void;
  setRemoveComments: (enable: boolean) => void;
  setDetectSecrets: (enable: boolean) => void;

  // Git ignore 同步相关
  isIgnoreSyncActive: boolean;
  hasProjectIgnoreFiles: boolean;
  toggleIgnoreSync: () => void;
  checkIgnoreFiles: (projectRoot?: string) => Promise<void>;
}

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      projectIgnore: DEFAULT_PROJECT_IGNORE,
      removeComments: false,
      detectSecrets: true,
      projectRoot: null,
      scannedProjectRoot: null,
      fileTree: [],
      isScanning: false,
      isIgnoreSyncActive: false,
      hasProjectIgnoreFiles: false,

      expandedIds: [],

      // 展开/折叠逻辑
      toggleExpand: (id) => set((state) => {
        const exists = state.expandedIds.includes(id);
        if (exists) {
          return { expandedIds: state.expandedIds.filter(i => i !== id) };
        } else {
          return { expandedIds: [...state.expandedIds, id] };
        }
      }),

      setAllExpanded: (expanded) => {
        if (!expanded) {
          set({ expandedIds: [] });
          return;
        }
        set((state) => ({ expandedIds: collectDirIds(state.fileTree) }));
      },

      setProjectRoot: async (path) => {
        if (get().projectRoot === path) {
          return;
        }

        if (!path) {
          set({
            projectRoot: null,
            scannedProjectRoot: null,
            projectIgnore: DEFAULT_PROJECT_IGNORE,
            fileTree: [],
            expandedIds: [],
            hasProjectIgnoreFiles: false,
          });
          return;
        }

        set({
          projectRoot: path,
          scannedProjectRoot: null,
          projectIgnore: DEFAULT_PROJECT_IGNORE,
          fileTree: [],
          expandedIds: [],
          hasProjectIgnoreFiles: false,
        });
        const loadSeq = ++projectConfigLoadSeq;
        const editSeqAtStart = projectIgnoreEditSeq;

        try {
          const savedConfig = await invoke<IgnoreConfig | null>('get_project_config', { path });
          const latest = get();
          if (
            latest.projectRoot !== path ||
            loadSeq !== projectConfigLoadSeq ||
            editSeqAtStart !== projectIgnoreEditSeq
          ) {
            return;
          }
          set({ projectIgnore: savedConfig ?? DEFAULT_PROJECT_IGNORE });
        } catch (e) {
          const latest = get();
          if (
            latest.projectRoot !== path ||
            loadSeq !== projectConfigLoadSeq ||
            editSeqAtStart !== projectIgnoreEditSeq
          ) {
            return;
          }
          set({ projectIgnore: DEFAULT_PROJECT_IGNORE });
        }
      },
      setFileTree: (tree, scannedRoot) => set((state) => {
        if (scannedRoot && state.projectRoot !== scannedRoot) {
          return state;
        }

        return {
          fileTree: tree,
          scannedProjectRoot: scannedRoot ?? state.projectRoot,
        };
      }),
      setIsScanning: (status) => set({ isScanning: status }),

      updateProjectIgnore: (type, action, value) => {
        projectIgnoreEditSeq += 1;
        set((state) => {
          const currentList = state.projectIgnore[type];
          let newList = currentList;
          if (action === 'add' && !currentList.includes(value)) {
            newList = [...currentList, value];
          } else if (action === 'remove') {
            newList = currentList.filter(item => item !== value);
          }

          const newProjectIgnore = { ...state.projectIgnore, [type]: newList };

          if (state.projectRoot) {
            invoke('save_project_config', { path: state.projectRoot, config: newProjectIgnore })
              .catch(() => {});
          }

          return { projectIgnore: newProjectIgnore };
        });
      },

      resetProjectIgnore: () => {
        projectIgnoreEditSeq += 1;
        set((state) => {
          if (state.projectRoot) {
            invoke('save_project_config', { path: state.projectRoot, config: DEFAULT_PROJECT_IGNORE })
              .catch(() => {});
          }
          return { projectIgnore: DEFAULT_PROJECT_IGNORE };
        });
      },

      refreshTreeStatus: async (globalConfig) => {
        const state = get();
        const { fileTree, isIgnoreSyncActive } = state;

        const applyStatus = (nodes: FileNode[], parentFilterLocked = false, parentGitIgnored = false): FileNode[] => {
          return nodes.map(node => {
            const backendFilterLocked = !!node.isLocked && node.ignoreSource === 'filter';
            let isConfigIgnored = parentFilterLocked ||
                                  backendFilterLocked ||
                                  state.projectIgnore.dirs.includes(node.name) ||
                                  globalConfig.dirs.includes(node.name);
            if (node.kind === 'file') {
              isConfigIgnored = isConfigIgnored ||
                                state.projectIgnore.files.includes(node.name) ||
                                globalConfig.files.includes(node.name);
              const ext = node.name.split('.').pop()?.toLowerCase();
              if (ext) {
                isConfigIgnored = isConfigIgnored ||
                                  state.projectIgnore.extensions.includes(ext) ||
                                  globalConfig.extensions.includes(ext);
              }
            }

            // Git ignore 状态由扫描阶段产出，这里只做继承和开关控制。
            const isNodeGitIgnored = isIgnoreSyncActive && (node.ignoreSource === 'git' || parentGitIgnored);
            const shouldLock = isConfigIgnored || isNodeGitIgnored;
            const shouldAutoReselect = !isIgnoreSyncActive && node.ignoreSource === 'git' && !isConfigIgnored;

            let ignoreSource: 'git' | 'filter' | undefined = undefined;
            if (shouldLock) {
              ignoreSource = isNodeGitIgnored ? 'git' : 'filter';
            }

            const newNode: FileNode = {
              ...node,
              isSelected: shouldLock ? false : (shouldAutoReselect ? true : node.isSelected),
              isLocked: shouldLock,
              ignoreSource,
            };

            if (newNode.children) {
              newNode.children = applyStatus(newNode.children, isConfigIgnored, isNodeGitIgnored);
            }
            return newNode;
          });
        };

        set({ fileTree: applyStatus(fileTree) });
      },

      toggleSelect: (nodeId, checked) => set((state) => ({
        fileTree: updateNodeState(state.fileTree, nodeId, checked)
      })),

      applySelectionByPaths: (paths) => set((state) => {
        const selectedPaths = new Set(paths.map(normalizeSelectionPath).filter(Boolean));
        return {
          fileTree: applySelectionPaths(state.fileTree, selectedPaths).nodes,
        };
      }),

      invertSelection: () => set((state) => ({
        fileTree: invertTreeSelection(state.fileTree)
      })),

      setRemoveComments: (enable) => set({ removeComments: enable }),
      setDetectSecrets: (enable) => set({ detectSecrets: enable }),

      // 切换开关
      toggleIgnoreSync: () => {
        set((state) => ({ isIgnoreSyncActive: !state.isIgnoreSyncActive }));
      },

      // 探测项目是否有 ignore 文件
      checkIgnoreFiles: async (projectRoot) => {
        const state = get();
        const root = projectRoot ?? state.projectRoot;
        if (!root) return;
        const hasFiles = await invoke<boolean>(`${CONTEXT_PLUGIN_PREFIX}has_ignore_files`, { projectRoot: root });
        set({ hasProjectIgnoreFiles: hasFiles });
      },
    }),
    {
      name: 'context-config',
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({
        projectRoot: state.projectRoot,
        removeComments: state.removeComments,
        detectSecrets: state.detectSecrets,
        expandedIds: state.expandedIds,
        isIgnoreSyncActive: state.isIgnoreSyncActive,
      }),
      skipHydration: true,
    }
  )
);
