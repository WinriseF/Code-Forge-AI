import { describe, expect, it } from 'vitest';
import { computeGitGraphLayout } from '@/components/features/patch/gitGraphLayout';
import type { GitRef, GraphCommit } from '@/components/features/patch/patch_types';

function commit(hash: string, parentHashes: string[], refs: GitRef[] = []): GraphCommit {
  return {
    hash,
    short_hash: hash,
    author: 'tester',
    date: '2026-04-18 12:00',
    message: hash,
    parent_hashes: parentHashes,
    refs,
  };
}

describe('computeGitGraphLayout', () => {
  it('keeps a linear history on a single lane', () => {
    const layout = computeGitGraphLayout([
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1', []),
    ]);

    expect(layout.laneCount).toBe(1);
    expect(layout.nodes.get('c3')?.lane).toBe(0);
    expect(layout.nodes.get('c2')?.lane).toBe(0);
    expect(layout.nodes.get('c1')?.lane).toBe(0);
    expect(layout.edges.map((edge) => [edge.fromHash, edge.toHash, edge.fromLane, edge.toLane])).toEqual([
      ['c3', 'c2', 0, 0],
      ['c2', 'c1', 0, 0],
    ]);
  });

  it('allocates a side lane for a merged branch and reuses the main lane', () => {
    const layout = computeGitGraphLayout([
      commit('merge', ['main-tip', 'feature-tip']),
      commit('main-tip', ['base']),
      commit('feature-tip', ['base']),
      commit('base', ['root']),
      commit('root', []),
    ]);

    expect(layout.laneCount).toBe(2);
    expect(layout.nodes.get('merge')?.lane).toBe(0);
    expect(layout.nodes.get('main-tip')?.lane).toBe(0);
    expect(layout.nodes.get('feature-tip')?.lane).toBe(1);
    expect(layout.nodes.get('base')?.lane).toBe(0);

    const mergeEdge = layout.edges.find((edge) => edge.fromHash === 'merge' && edge.toHash === 'feature-tip');
    expect(mergeEdge).toMatchObject({
      fromLane: 0,
      toLane: 1,
      isFirstParent: false,
    });

    const branchEdge = layout.edges.find((edge) => edge.fromHash === 'feature-tip' && edge.toHash === 'base');
    expect(branchEdge).toMatchObject({
      fromLane: 1,
      toLane: 0,
      isFirstParent: true,
    });
  });

  it('keeps the current head first-parent chain pinned to the main lane', () => {
    const layout = computeGitGraphLayout([
      commit('head-tip', ['main-2'], [{ name: 'HEAD', kind: 'Head' }]),
      commit('main-2', ['merge']),
      commit('merge', ['main-1', 'feature-1']),
      commit('feature-1', ['base']),
      commit('main-1', ['base']),
      commit('base', []),
    ]);

    expect(layout.laneCount).toBe(2);
    expect(layout.nodes.get('head-tip')?.lane).toBe(0);
    expect(layout.nodes.get('main-2')?.lane).toBe(0);
    expect(layout.nodes.get('merge')?.lane).toBe(0);
    expect(layout.nodes.get('main-1')?.lane).toBe(0);
    expect(layout.nodes.get('base')?.lane).toBe(0);
    expect(layout.nodes.get('feature-1')?.lane).toBe(1);
  });

  it('ignores parents that are outside the loaded commit window', () => {
    const layout = computeGitGraphLayout([
      commit('c2', ['c1']),
      commit('c1', ['missing-parent']),
    ]);

    expect(layout.laneCount).toBe(1);
    expect(layout.edges.map((edge) => [edge.fromHash, edge.toHash])).toEqual([['c2', 'c1']]);
  });
});
