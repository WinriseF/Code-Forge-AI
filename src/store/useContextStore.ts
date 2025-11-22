import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/storage';
import { IgnoreConfig, DEFAULT_PROJECT_IGNORE, FileNode } from '@/types/context';

// --- 辅助函数：递归处理勾选逻辑 ---

/**
 * 将指定节点及其所有子孙节点的 isSelected 状态强制设为目标值
 */
const setAllChildren = (node: FileNode, isSelected: boolean): FileNode => {
  // 创建节点副本
  const newNode = { ...node, isSelected };
  
  // 如果有子节点，递归处理
  if (newNode.children) {
    newNode.children = newNode.children.map(child => setAllChildren(child, isSelected));
  }
  return newNode;
};

/**
 * 在树中查找目标 ID，并更新其状态（向下级联）
 */
const updateNodeState = (nodes: FileNode[], targetId: string, isSelected: boolean): FileNode[] => {
  return nodes.map(node => {
    // 1. 找到目标节点：应用级联更新
    if (node.id === targetId) {
      return setAllChildren(node, isSelected);
    }
    
    // 2. 未找到目标，但当前节点有子节点：递归向下查找
    if (node.children) {
      return {
        ...node,
        children: updateNodeState(node.children, targetId, isSelected)
      };
    }
    
    // 3. 无关节点：保持原样
    return node;
  });
};

const applyLockState = (nodes: FileNode[], fullConfig: IgnoreConfig): FileNode[] => {
  return nodes.map(node => {
    // 1. 检查当前节点是否匹配黑名单
    let shouldLock = false;
    
    // 检查文件夹名
    if (node.kind === 'dir' && fullConfig.dirs.includes(node.name)) shouldLock = true;
    // 检查文件名
    if (node.kind === 'file' && fullConfig.files.includes(node.name)) shouldLock = true;
    // 检查后缀
    if (node.kind === 'file') {
      const ext = node.name.split('.').pop()?.toLowerCase();
      if (ext && fullConfig.extensions.includes(ext)) shouldLock = true;
    }

    // 2. 如果匹配，强制不选中 + 锁定
    // 3. 如果不匹配，解锁 (isLocked = false)，但保持原有的 isSelected 状态
    const newNode: FileNode = {
      ...node,
      isSelected: shouldLock ? false : node.isSelected,
      isLocked: shouldLock
    };

    // 4. 递归处理子节点
    if (newNode.children) {
      newNode.children = applyLockState(newNode.children, fullConfig);
      
      // (可选优化) 如果所有子节点都被 Lock 了，父节点也可以标记一下，但这里先不做太复杂
    }

    return newNode;
  });
};

// --- Store 定义 ---

interface ContextState {
  // --- 持久化设置 ---
  // ✨ 改名：这里只存项目特有的配置，不再包含默认值
  projectIgnore: IgnoreConfig;
  
  // --- 运行时状态 (不持久化) ---
  projectRoot: string | null;
  fileTree: FileNode[]; 
  isScanning: boolean;

  // --- Actions ---
  setProjectRoot: (path: string) => void;
  setFileTree: (tree: FileNode[]) => void;
  setIsScanning: (status: boolean) => void;
  
  // ✨ 新增：修改项目配置
  updateProjectIgnore: (type: keyof IgnoreConfig, action: 'add' | 'remove', value: string) => void;
  resetProjectIgnore: () => void;
  refreshTreeStatus: (globalConfig: IgnoreConfig) => void;
  // 树操作
  toggleSelect: (nodeId: string, checked: boolean) => void;
}

export const useContextStore = create<ContextState>()(
  persist(
    (set) => ({
      projectIgnore: DEFAULT_PROJECT_IGNORE,
      projectRoot: null,
      fileTree: [],
      isScanning: false,

      setProjectRoot: (path) => set({ projectRoot: path }),
      setFileTree: (tree) => set({ fileTree: tree }),
      setIsScanning: (status) => set({ isScanning: status }),

      updateProjectIgnore: (type, action, value) => {
        set((state) => {
          const currentList = state.projectIgnore[type];
          let newList = currentList;
          if (action === 'add' && !currentList.includes(value)) {
            newList = [...currentList, value];
          } else if (action === 'remove') {
            newList = currentList.filter(item => item !== value);
          }
          
          const newProjectIgnore = { ...state.projectIgnore, [type]: newList };
          
          return { projectIgnore: newProjectIgnore };
        });
      },
      
      resetProjectIgnore: () => set({ projectIgnore: DEFAULT_PROJECT_IGNORE }),

      // ✨ 刷新树状态（应用黑名单）
      refreshTreeStatus: (globalConfig) => set((state) => {
        // 合并配置
        const effectiveConfig = {
          dirs: [...globalConfig.dirs, ...state.projectIgnore.dirs],
          files: [...globalConfig.files, ...state.projectIgnore.files],
          extensions: [...globalConfig.extensions, ...state.projectIgnore.extensions],
        };

        // 应用锁定逻辑
        const newTree = applyLockState(state.fileTree, effectiveConfig);
        return { fileTree: newTree };
      }),

      toggleSelect: (nodeId, checked) => set((state) => ({
        fileTree: updateNodeState(state.fileTree, nodeId, checked)
      })),
    }),
    {
      name: 'context-config',
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({
        projectIgnore: state.projectIgnore
      }),
    }
  )
);