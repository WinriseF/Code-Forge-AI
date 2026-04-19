export type ExportFormat = 'Markdown' | 'Json' | 'Xml' | 'Txt';
export type ExportLayout = 'Split' | 'Unified' | 'GitPatch';

export interface PatchFileItem {
  id: string;
  path: string;
  original: string;
  modified: string;
  status: 'pending' | 'success' | 'error';

  errorMsg?: string;
  gitStatus?: 'Added' | 'Modified' | 'Deleted' | 'Renamed';

  renameFrom?: string;
  isBinary?: boolean;
  isLarge?: boolean;
  additions?: number;
  deletions?: number;
}

export interface GitDiffSummary {
  files_changed: number;
  files_added: number;
  files_modified: number;
  files_deleted: number;
  files_renamed: number;
  insertions: number;
  deletions: number;
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
  kind: 'Head' | 'Branch' | 'RemoteBranch' | 'Tag' | 'Stash' | 'DeletedBranch';
}
