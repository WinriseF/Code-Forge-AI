// src/components/features/patch/patch_types.ts

export type PatchMode = 'patch' | 'diff';

export interface PatchOperation {
  type: 'replace' | 'insert_after';
  originalBlock: string;
  modifiedBlock: string;
}

export interface FilePatch {
  filePath: string;
  operations: PatchOperation[];
}

export interface PatchFileItem {
  id: string;
  path: string;
  original: string;
  modified: string;
  status: 'pending' | 'success' | 'error';
  errorMsg?: string;
  isManual?: boolean; // ✨ 新增：标记是否为手动对比模式的草稿
}