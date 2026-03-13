import type {
  GitBranchRef,
  GitCommit,
  GitCommitDetails,
  GitDiffFileItem,
  GitInsightsViewMode,
  GitRepositorySummary,
} from '@/types/git';

export interface GitDiffStats {
  total: number;
  diffable: number;
  binary: number;
  large: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
}

export function summarizeDiffFiles(files: GitDiffFileItem[]): GitDiffStats {
  return files.reduce<GitDiffStats>(
    (stats, file) => {
      stats.total += 1;
      if (file.isBinary) stats.binary += 1;
      if (file.isLarge) stats.large += 1;
      if (!file.isBinary && !file.isLarge) stats.diffable += 1;

      switch (file.gitStatus) {
        case 'Added':
          stats.added += 1;
          break;
        case 'Modified':
          stats.modified += 1;
          break;
        case 'Deleted':
          stats.deleted += 1;
          break;
        case 'Renamed':
          stats.renamed += 1;
          break;
      }

      return stats;
    },
    {
      total: 0,
      diffable: 0,
      binary: 0,
      large: 0,
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
    },
  );
}

export function getDefaultSelectedFileId(files: GitDiffFileItem[]): string | null {
  return files[0]?.id ?? null;
}

export function countExportableFiles(files: GitDiffFileItem[]): number {
  return files.filter((file) => !file.isBinary && !file.isLarge).length;
}

export function resolveGitReferenceLabel(hash: string, commits: GitCommit[]): string {
  return resolveGitReferenceLabelWithLabels(hash, commits, {
    workingTree: 'Working Tree',
    initialCommit: 'Initial Commit',
  });
}

export function resolveGitReferenceLabelWithLabels(
  hash: string,
  commits: GitCommit[],
  labels: { workingTree: string; initialCommit: string },
): string {
  if (hash === '__WORK_DIR__') return labels.workingTree;
  if (hash === '__EMPTY_TREE__') return labels.initialCommit;

  const commit = commits.find((entry) => entry.hash === hash);
  if (!commit) return hash.slice(0, 7);

  return `${commit.hash.slice(0, 7)} ${commit.message}`;
}

export function buildGitViewTitle(
  mode: GitInsightsViewMode,
  commits: GitCommit[],
  baseHash: string,
  compareHash: string,
  commitDetails: GitCommitDetails | null,
  labels: { workingTree: string; initialCommit: string },
): string {
  if (mode === 'commit' && commitDetails) {
    return commitDetails.summary || commitDetails.hash.slice(0, 7);
  }

  if (mode === 'workingTree') {
    return `${resolveGitReferenceLabelWithLabels(baseHash, commits, labels)} -> ${labels.workingTree}`;
  }

  return `${resolveGitReferenceLabelWithLabels(baseHash, commits, labels)} -> ${resolveGitReferenceLabelWithLabels(compareHash, commits, labels)}`;
}

export function buildRepositorySubtitle(
  summary: GitRepositorySummary | null,
  labels: { staged: string; unstaged: string; untracked: string },
): string {
  if (!summary) return '';

  const parts = [`${summary.branchName}`];
  if (summary.stagedChanges > 0) parts.push(`${labels.staged} ${summary.stagedChanges}`);
  if (summary.unstagedChanges > 0) parts.push(`${labels.unstaged} ${summary.unstagedChanges}`);
  if (summary.untrackedFiles > 0) parts.push(`${labels.untracked} ${summary.untrackedFiles}`);

  return parts.join(' · ');
}

export function splitBranchesByType(branches: GitBranchRef[]) {
  return {
    local: branches.filter((branch) => branch.branchType === 'local'),
    remote: branches.filter((branch) => branch.branchType === 'remote'),
  };
}

export function getBranchDisplayName(branch: GitBranchRef) {
  return branch.shortName || branch.name;
}

export function getInitialSelectedBranch(branches: GitBranchRef[], currentBranchName: string) {
  return (
    branches.find((branch) => branch.isCurrent) ||
    branches.find((branch) => branch.shortName === currentBranchName) ||
    branches.find((branch) => branch.branchType === 'local') ||
    branches[0] ||
    null
  );
}
