// src/types/context.ts

export interface IgnoreConfig {
  dirs: string[];
  files: string[];
  extensions: string[];
}

// 这是全局默认配置 (更为通用)
export const DEFAULT_GLOBAL_IGNORE: IgnoreConfig = {
  dirs: [
    'node_modules', '.git', '.vscode', '.idea', 'dist', 'build', 'target', 
    'bin', 'obj', '__pycache__', 'coverage', 'venv', '.next', '.nuxt', 
    '.obsidian', 'out'
  ],
  files: [
    '.DS_Store', 'thumbs.db', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
  ],
  extensions: [
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp',
    'mp3', 'mp4', 'mov', 'avi',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'tar', 'gz', '7z', 'rar',
    'exe', 'dll', 'so', 'dylib', 'class', 'jar',
    'bin', 'pyc', 'log'
  ]
};

// 项目默认配置 (初始为空，完全由用户自定义或继承全局)
export const DEFAULT_PROJECT_IGNORE: IgnoreConfig = {
  dirs: [],
  files: [],
  extensions: []
};

// 文件节点定义保持不变
export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  isSelected: boolean;
  isPartial?: boolean;
  isExpanded?: boolean;
  isLocked?: boolean;
  children?: FileNode[];
}