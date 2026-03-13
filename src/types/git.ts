export type GitChangeStatus = 'Added' | 'Modified' | 'Deleted' | 'Renamed';
export type GitBranchType = 'local' | 'remote';
export type GitCommitRefType = 'head' | 'local' | 'remote' | 'tag' | 'other';
export type ExportFormat = 'Markdown' | 'Json' | 'Xml' | 'Txt';
export type ExportLayout = 'Split' | 'Unified' | 'GitPatch';
export type GitInsightsViewMode = 'workingTree' | 'comparison' | 'commit';
export type GitWorkbenchTab = 'history' | 'branches' | 'compare';

export interface GitCommitRef {
  name: string;
  refType: GitCommitRefType | string;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  parentHashes: string[];
  refs: GitCommitRef[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitDiffFileItem {
  id: string;
  path: string;
  oldPath?: string | null;
  gitStatus: GitChangeStatus;
  original: string;
  modified: string;
  isBinary: boolean;
  isLarge: boolean;
}

export interface GitRepositorySummary {
  repositoryName: string;
  branchName: string;
  headHash: string;
  lastCommitMessage: string;
  stagedChanges: number;
  unstagedChanges: number;
  untrackedFiles: number;
  isDirty: boolean;
}

export interface GitBranchRef {
  name: string;
  shortName: string;
  branchType: GitBranchType;
  isCurrent: boolean;
  upstreamName?: string | null;
  ahead: number;
  behind: number;
  lastCommitHash: string;
  lastCommitDate: string;
  lastCommitMessage: string;
}

export interface GitCommitChange {
  path: string;
  status: GitChangeStatus;
  oldPath?: string | null;
}

export interface GitCommitDetails {
  hash: string;
  author: string;
  email: string;
  date: string;
  summary: string;
  message: string;
  parentHashes: string[];
  changedFiles: GitCommitChange[];
}
