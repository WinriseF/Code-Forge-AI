import type { GitCommit } from '@/types/git';

export interface GitCommitGraphLabel {
  id: string;
  name: string;
  tone: 'head' | 'local' | 'remote' | 'tag' | 'other';
}

export interface GitCommitGraphRow {
  commit: GitCommit;
  lane: number;
  laneCount: number;
  lanesBefore: number[];
  lanesAfter: number[];
  primaryLane: number | null;
  mergeToLanes: number[];
  labels: GitCommitGraphLabel[];
}

export interface GitHistoryPagingState {
  pageSize: number;
  nextOffset: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  anchorHash: string | null;
}

interface GitHistoryPagingOptions {
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

export function createGitHistoryPagingState(
  commits: GitCommit[],
  pageSize: number,
  options: GitHistoryPagingOptions = {},
): GitHistoryPagingState {
  const lastCommit = commits.length > 0 ? commits[commits.length - 1] : null;

  return {
    pageSize,
    nextOffset: commits.length,
    hasMore: options.hasMore ?? commits.length >= pageSize,
    isLoadingMore: options.isLoadingMore ?? false,
    anchorHash: lastCommit?.hash ?? null,
  };
}

export function mergeGitCommitPages(
  existingCommits: GitCommit[],
  nextPage: GitCommit[],
  anchorHash = existingCommits.length > 0 ? existingCommits[existingCommits.length - 1].hash : null,
): GitCommit[] {
  if (nextPage.length === 0) {
    return existingCommits;
  }

  let anchoredCommits = existingCommits;
  if (anchorHash) {
    const anchorIndex = existingCommits.findIndex((commit) => commit.hash === anchorHash);
    if (anchorIndex >= 0) {
      anchoredCommits = existingCommits.slice(0, anchorIndex + 1);
    }
  }

  const seen = new Set(anchoredCommits.map((commit) => commit.hash));
  const merged = [...anchoredCommits];
  for (const commit of nextPage) {
    if (seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    merged.push(commit);
  }

  return merged;
}

export function buildGitCommitGraphRows(commits: GitCommit[]): GitCommitGraphRow[] {
  const activeLanes: string[] = [];

  return commits.map((commit) => {
    const parentHashes = commit.parentHashes ?? [];
    let lane = activeLanes.indexOf(commit.hash);
    const lanesBefore = activeLanes.map((_, index) => index);
    if (lane === -1) {
      lane = activeLanes.length;
      activeLanes.push(commit.hash);
    }

    const nextLanes = [...activeLanes];
    const [primaryParent, ...mergeParents] = parentHashes;

    if (primaryParent) {
      nextLanes[lane] = primaryParent;
    } else {
      nextLanes.splice(lane, 1);
    }

    let insertionLane = lane + 1;
    for (const parentHash of mergeParents) {
      if (nextLanes.includes(parentHash)) continue;
      nextLanes.splice(insertionLane, 0, parentHash);
      insertionLane += 1;
    }

    const dedupedLanes: string[] = [];
    for (const hash of nextLanes) {
      if (hash && !dedupedLanes.includes(hash)) {
        dedupedLanes.push(hash);
      }
    }

    const primaryLane = primaryParent ? dedupedLanes.indexOf(primaryParent) : null;
    const mergeToLanes = mergeParents
      .map((parentHash) => dedupedLanes.indexOf(parentHash))
      .filter((targetLane) => targetLane >= 0);

    activeLanes.splice(0, activeLanes.length, ...dedupedLanes);

    const lanesAfter = activeLanes.map((_, index) => index);
    const labels = (commit.refs ?? []).map((ref) => ({
      id: `${commit.hash}:${ref.refType}:${ref.name}`,
      name: ref.name,
      tone: mapCommitRefTone(ref.refType),
    }));
    const laneCount = Math.max(
      lanesBefore.length,
      lanesAfter.length,
      lane + 1,
      primaryLane !== null ? primaryLane + 1 : 0,
      ...mergeToLanes.map((targetLane) => targetLane + 1),
    );

    return {
      commit,
      lane,
      laneCount,
      lanesBefore,
      lanesAfter,
      primaryLane,
      mergeToLanes,
      labels,
    };
  });
}

export function filterGitCommitGraphRows(rows: GitCommitGraphRow[], query: string): GitCommitGraphRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter(({ commit }) => buildGitCommitSearchText(commit).includes(normalized));
}

export function buildGitCommitSearchText(commit: GitCommit): string {
  const refs = (commit.refs ?? []).map((ref) => ref.name).join(' ');
  return `${commit.message} ${commit.author} ${commit.hash} ${refs}`.toLowerCase();
}

function mapCommitRefTone(refType: string): GitCommitGraphLabel['tone'] {
  switch (refType) {
    case 'head':
      return 'head';
    case 'local':
      return 'local';
    case 'remote':
      return 'remote';
    case 'tag':
      return 'tag';
    default:
      return 'other';
  }
}
