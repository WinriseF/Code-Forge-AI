export type ExportFormat = 'Markdown' | 'Json' | 'Xml' | 'Txt';
export type ExportLayout = 'Split' | 'Unified' | 'GitPatch';
export type GraphDisplayKind = 'commit' | 'stash';

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

export interface CommitDisplayNode extends GraphCommit {
  display_kind: 'commit';
}

export interface StashDisplayNode extends GraphCommit {
  display_kind: 'stash';
  parent_hashes: [string];
  stash_base_hash: string;
  stash_untracked_hash: string | null;
  collapsed_hashes: string[];
}

export type DisplayGraphCommit = CommitDisplayNode | StashDisplayNode;

export interface GitRef {
  name: string;
  kind: 'Head' | 'Branch' | 'RemoteBranch' | 'Tag' | 'Stash' | 'DeletedBranch';
}

export interface GitRepoOverview {
  current_branch: string | null;
  is_detached_head: boolean;
  head_hash: string | null;
  head_short_hash: string | null;
  upstream_branch: string | null;
  ahead: number;
  behind: number;
  has_staged_changes: boolean;
  has_unstaged_changes: boolean;
  has_untracked_files: boolean;
  conflicted_count: number;
  stash_count: number;
}

export interface GitBranchSummary {
  name: string;
  full_refname: string;
  is_current: boolean;
  is_remote: boolean;
  upstream_name: string | null;
  ahead: number;
  behind: number;
  head_hash: string | null;
  head_short_hash: string | null;
  last_commit_message: string | null;
  last_commit_date: string | null;
}

export interface SwitchBranchOptions {
  stash_if_dirty: boolean;
  stash_message: string | null;
  create_tracking: boolean;
}

export interface SwitchBranchResult {
  success: boolean;
  current_branch: string;
  previous_branch: string | null;
  stash_created: boolean;
  stash_name: string | null;
  warning: string | null;
}

export interface GitSyncResult {
  success: boolean;
  current_branch: string;
  upstream_branch: string | null;
  ahead: number;
  behind: number;
  summary: string;
  warning: string | null;
}
