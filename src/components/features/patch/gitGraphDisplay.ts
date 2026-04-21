import type { DisplayGraphCommit, GraphCommit, StashDisplayNode } from './patch_types';

export const STASH_BASE_PARENT_INDEX = 0;
export const STASH_UNTRACKED_PARENT_INDEX = 2;

export function isRawStashCommit(commit: GraphCommit | null | undefined): boolean {
  return commit?.refs.some((ref) => ref.kind === 'Stash') ?? false;
}

export function isCollapsedStashCommit(
  commit: DisplayGraphCommit | null | undefined,
): commit is StashDisplayNode {
  return commit?.display_kind === 'stash';
}

export function getStashBaseHash(commit: Pick<GraphCommit, 'parent_hashes'>): string | null {
  return commit.parent_hashes[STASH_BASE_PARENT_INDEX] ?? null;
}

export function getStashUntrackedHash(commit: Pick<GraphCommit, 'parent_hashes'>): string | null {
  return commit.parent_hashes[STASH_UNTRACKED_PARENT_INDEX] ?? null;
}

export function buildGitGraphDisplayCommits(commits: GraphCommit[]): DisplayGraphCommit[] {
  const hiddenCommitHashes = new Set<string>();
  const availableCommitHashes = new Set(commits.map((commit) => commit.hash));
  const displayCommits: DisplayGraphCommit[] = [];

  for (const commit of commits) {
    if (hiddenCommitHashes.has(commit.hash)) {
      continue;
    }

    if (!isRawStashCommit(commit) || commit.parent_hashes.length === 0) {
      displayCommits.push({
        ...commit,
        display_kind: 'commit',
      });
      continue;
    }

    const baseHash = getStashBaseHash(commit);
    if (!baseHash) {
      displayCommits.push({
        ...commit,
        display_kind: 'commit',
      });
      continue;
    }

    const collapsedHashes = commit.parent_hashes.slice(STASH_BASE_PARENT_INDEX + 1);
    const untrackedHash = getStashUntrackedHash(commit);

    for (const hash of collapsedHashes) {
      if (availableCommitHashes.has(hash)) {
        hiddenCommitHashes.add(hash);
      }
    }

    displayCommits.push({
      ...commit,
      display_kind: 'stash',
      parent_hashes: [baseHash],
      stash_base_hash: baseHash,
      stash_untracked_hash: untrackedHash,
      collapsed_hashes: collapsedHashes,
    });
  }

  return displayCommits;
}
