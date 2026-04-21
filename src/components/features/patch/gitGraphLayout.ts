import type { GraphCommit } from './patch_types';

interface GitGraphNodeLayout {
  hash: string;
  row: number;
  lane: number;
  colorIndex: number;
}

interface GitGraphEdgeLayout {
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

export interface SwimlaneNode {
  id: string;
  color: string;
}

export interface CommitRowViewModel {
  commit: GraphCommit;
  inputSwimlanes: SwimlaneNode[];
  outputSwimlanes: SwimlaneNode[];
  circleIndex: number;
  circleColor: string;
}

interface GitGraphLayout {
  rows: CommitRowViewModel[];
  nodes: Map<string, GitGraphNodeLayout>;
  edges: GitGraphEdgeLayout[];
  laneCount: number;
}

const GRAPH_COLORS = [
  '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8',
  '#cba6f7', '#fab387', '#94e2d5', '#f5c2e7',
];

export function computeGitGraphLayout(commits: GraphCommit[]): GitGraphLayout {
  const commitHashes = new Set(commits.map((commit) => commit.hash));
  const rows: CommitRowViewModel[] = [];
  let colorIdx = 0;

  for (const commit of commits) {
    const parents = commit.parent_hashes.filter((parentHash) => commitHashes.has(parentHash));
    const prevOutput = rows.length > 0 ? rows[rows.length - 1].outputSwimlanes : [];
    const inputSwimlanes = prevOutput.map(n => ({ ...n }));
    const outputSwimlanes: SwimlaneNode[] = [];
    let firstParentAdded = false;

    for (const node of inputSwimlanes) {
      if (node.id === commit.hash) {
        if (parents.length > 0 && !firstParentAdded) {
          outputSwimlanes.push({
            id: parents[0],
            color: node.color,
          });
          firstParentAdded = true;
        }
        continue;
      }
      outputSwimlanes.push({ ...node });
    }

    for (let i = firstParentAdded ? 1 : 0; i < parents.length; i++) {
      outputSwimlanes.push({
        id: parents[i],
        color: GRAPH_COLORS[colorIdx % GRAPH_COLORS.length],
      });
      colorIdx++;
    }

    const inputIndex = inputSwimlanes.findIndex(n => n.id === commit.hash);
    const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
    const circleColor =
      circleIndex < outputSwimlanes.length
        ? outputSwimlanes[circleIndex].color
        : circleIndex < inputSwimlanes.length
          ? inputSwimlanes[circleIndex].color
          : GRAPH_COLORS[0];

    rows.push({
      commit: { ...commit, parent_hashes: parents },
      inputSwimlanes,
      outputSwimlanes,
      circleIndex,
      circleColor,
    });
  }

  const nodes = new Map<string, GitGraphNodeLayout>();
  let laneCount = 0;

  rows.forEach((row, rowIndex) => {
    nodes.set(row.commit.hash, {
      hash: row.commit.hash,
      row: rowIndex,
      lane: row.circleIndex,
      colorIndex: row.circleIndex,
    });

    laneCount = Math.max(
      laneCount,
      row.circleIndex + 1,
      row.inputSwimlanes.length,
      row.outputSwimlanes.length,
    );
  });

  const edges: GitGraphEdgeLayout[] = [];
  rows.forEach((row, rowIndex) => {
    row.commit.parent_hashes.forEach((parentHash, parentIndex) => {
      const targetNode = nodes.get(parentHash);
      if (!targetNode) return;

      edges.push({
        id: `${row.commit.hash}:${parentHash}:${parentIndex}`,
        fromHash: row.commit.hash,
        toHash: parentHash,
        fromRow: rowIndex,
        toRow: targetNode.row,
        fromLane: row.circleIndex,
        toLane: targetNode.lane,
        colorIndex: Math.max(row.circleIndex, targetNode.lane),
        isFirstParent: parentIndex === 0,
      });
    });
  });

  return { rows, nodes, edges, laneCount };
}
