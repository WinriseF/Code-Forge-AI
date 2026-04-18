import type { GraphCommit } from './patch_types';

export interface GitGraphNodeLayout {
  hash: string;
  row: number;
  lane: number;
  colorIndex: number;
}

export interface GitGraphEdgeLayout {
  id: string;
  fromHash: string;
  toHash: string;
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  colorIndex: number;
  isFirstParent: boolean;
}

export interface GitGraphLayout {
  nodes: Map<string, GitGraphNodeLayout>;
  edges: GitGraphEdgeLayout[];
  laneCount: number;
}

interface LaneReservation {
  lane: number;
}

function reserveNextFreeLane(lanes: boolean[], startLane: number): number {
  let lane = startLane;
  while (lanes[lane]) {
    lane += 1;
  }

  lanes[lane] = true;
  return lane;
}

function buildParentMap(commits: GraphCommit[]) {
  const commitHashes = new Set(commits.map((commit) => commit.hash));

  return new Map(
    commits.map((commit) => [
      commit.hash,
      commit.parent_hashes.filter((parentHash) => commitHashes.has(parentHash)),
    ]),
  );
}

function buildPinnedFirstParentSet(
  commits: GraphCommit[],
  parentMap: Map<string, string[]>,
): Set<string> {
  const headCommit = commits.find((commit) => commit.refs.some((ref) => ref.kind === 'Head'));
  if (!headCommit) {
    return new Set();
  }

  const pinned = new Set<string>();
  let currentHash: string | undefined = headCommit.hash;

  while (currentHash && !pinned.has(currentHash)) {
    pinned.add(currentHash);
    currentHash = parentMap.get(currentHash)?.[0];
  }

  return pinned;
}

export function computeGitGraphLayout(commits: GraphCommit[]): GitGraphLayout {
  const parentMap = buildParentMap(commits);
  const pinnedShas = buildPinnedFirstParentSet(commits, parentMap);
  const hasPinnedLane = pinnedShas.size > 0;

  const nodes = new Map<string, GitGraphNodeLayout>();
  const reservations = new Map<string, LaneReservation>();
  const lanesToFreeWhenReached = new Map<string, number[]>();
  const lanesUsed: boolean[] = [];
  const hasMergeChild = new Set<string>();
  let laneCount = hasPinnedLane ? 1 : 0;

  for (const [row, commit] of commits.entries()) {
    hasMergeChild.delete(commit.hash);

    const scheduledLanes = lanesToFreeWhenReached.get(commit.hash);
    if (scheduledLanes) {
      for (const lane of scheduledLanes) {
        lanesUsed[lane] = false;
      }
      lanesToFreeWhenReached.delete(commit.hash);
    }

    let lane: number;
    if (pinnedShas.has(commit.hash)) {
      lane = 0;
      lanesUsed[0] = true;
    } else {
      const reservation = reservations.get(commit.hash);
      if (reservation) {
        lane = reservation.lane;
        lanesUsed[lane] = true;
        reservations.delete(commit.hash);
      } else {
        lane = reserveNextFreeLane(lanesUsed, hasPinnedLane ? 1 : 0);
      }
    }

    nodes.set(commit.hash, {
      hash: commit.hash,
      row,
      lane,
      colorIndex: lane,
    });
    laneCount = Math.max(laneCount, lane + 1);

    const parents = parentMap.get(commit.hash) ?? [];
    for (const [parentIndex, parentHash] of parents.entries()) {
      if (parents.length > 1) {
        hasMergeChild.add(parentHash);
      }

      const parentReservation = reservations.get(parentHash);
      if (parentIndex === 0 && parentReservation && parentReservation.lane !== lane) {
        const pendingLanes = lanesToFreeWhenReached.get(parentHash) ?? [];

        if (parentReservation.lane > lane && !hasMergeChild.has(parentHash)) {
          reservations.set(parentHash, { lane });
          pendingLanes.push(parentReservation.lane);
        } else {
          pendingLanes.push(lane);
        }

        lanesToFreeWhenReached.set(parentHash, pendingLanes);
        continue;
      }

      if (!parentReservation) {
        const reservedLane = pinnedShas.has(parentHash)
          ? 0
          : parentIndex === 0
            ? lane
            : reserveNextFreeLane(lanesUsed, hasPinnedLane ? 1 : 0);

        reservations.set(parentHash, { lane: reservedLane });
        laneCount = Math.max(laneCount, reservedLane + 1);
      }
    }
  }

  const edges: GitGraphEdgeLayout[] = [];
  for (const commit of commits) {
    const sourceNode = nodes.get(commit.hash);
    if (!sourceNode) continue;

    const parents = parentMap.get(commit.hash) ?? [];
    for (const [parentIndex, parentHash] of parents.entries()) {
      const targetNode = nodes.get(parentHash);
      if (!targetNode) continue;

      edges.push({
        id: `${commit.hash}:${parentHash}:${parentIndex}`,
        fromHash: commit.hash,
        toHash: parentHash,
        fromRow: sourceNode.row,
        toRow: targetNode.row,
        fromLane: sourceNode.lane,
        toLane: targetNode.lane,
        colorIndex: Math.max(sourceNode.lane, targetNode.lane),
        isFirstParent: parentIndex === 0,
      });
    }
  }

  return {
    nodes,
    edges,
    laneCount,
  };
}
