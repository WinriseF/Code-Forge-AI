import type { GraphCommit } from './patch_types';

export function isCollapsedStashCommit(commit: GraphCommit | null | undefined): boolean {
  return commit?.display_kind === 'stash';
}

export function buildGitGraphDisplayCommits(commits: GraphCommit[]): GraphCommit[] {
  const hiddenCommitHashes = new Set<string>();
  const availableCommitHashes = new Set(commits.map((commit) => commit.hash));
  const displayCommits: GraphCommit[] = [];

  for (const commit of commits) {
    if (hiddenCommitHashes.has(commit.hash)) {
      continue;
    }

    const stashRef = commit.refs.find((ref) => ref.kind === 'Stash');
    if (!stashRef || commit.parent_hashes.length === 0) {
      displayCommits.push(commit);
      continue;
    }

    const baseHash = commit.parent_hashes[0];
    const collapsedHashes = commit.parent_hashes.slice(1);
    const untrackedHash = commit.parent_hashes[2] ?? null;

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
