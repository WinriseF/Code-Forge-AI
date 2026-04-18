export type ExportFormat = 'Markdown' | 'Json' | 'Xml' | 'Txt';
export type ExportLayout = 'Split' | 'Unified' | 'GitPatch';

export interface PatchOperation {
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
  isManual?: boolean;

  gitStatus?: 'Added' | 'Modified' | 'Deleted' | 'Renamed';

  renameFrom?: string;
  isBinary?: boolean;
  isLarge?: boolean;
}

// --- Git Graph Types ---

export interface GraphCommit {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
  parent_hashes: string[];
  refs: GitRef[];
}

export interface GitRef {
  name: string;
  kind: 'Head' | 'Branch' | 'RemoteBranch' | 'Tag';
}