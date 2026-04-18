import type { GraphCommit } from './patch_types';

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

export interface GitGraphLayout {
  rows: CommitRowViewModel[];
}

const GRAPH_COLORS = [
  '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8',
  '#cba6f7', '#fab387', '#94e2d5', '#f5c2e7',
];

export function computeGitGraphLayout(commits: GraphCommit[]): GitGraphLayout {
  const rows: CommitRowViewModel[] = [];
  let colorIdx = 0;

  for (const commit of commits) {
    const parents = commit.parent_hashes;
    const prevOutput = rows.length > 0 ? rows[rows.length - 1].outputSwimlanes : [];
    const inputSwimlanes = prevOutput.map(n => ({ ...n }));
    const outputSwimlanes: SwimlaneNode[] = [];
    let firstParentAdded = false;

    if (parents.length > 0) {
      for (const node of inputSwimlanes) {
        if (node.id === commit.hash) {
          if (!firstParentAdded) {
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

    rows.push({ commit, inputSwimlanes, outputSwimlanes, circleIndex, circleColor });
  }

  return { rows };
}
