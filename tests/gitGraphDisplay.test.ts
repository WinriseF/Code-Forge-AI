import { describe, expect, it } from 'vitest';
import type { GraphCommit } from '@/components/features/patch/patch_types';
import { buildGitGraphDisplayCommits } from '@/components/features/patch/gitGraphDisplay';

function commit(hash: string, parentHashes: string[] = []): GraphCommit {
  return {
    hash,
    short_hash: hash.slice(0, 7),
    author: 'tester',
    date: '2026-04-21 12:00',
    message: hash,
    parent_hashes: parentHashes,
    refs: [],
  };
}

describe('buildGitGraphDisplayCommits', () => {
  it('folds stash helper commits into a single display node', () => {
    const commits = buildGitGraphDisplayCommits([
      commit('top', ['base']),
      {
        ...commit('stash', ['base', 'index', 'untracked']),
        message: 'On main: demo',
        refs: [{ name: 'stash@{0}', kind: 'Stash' }],
      },
      commit('index', ['base']),
      commit('untracked'),
      commit('base', ['root']),
      commit('root'),
    ]);

    expect(commits.map((entry) => entry.hash)).toEqual(['top', 'stash', 'base', 'root']);
    expect(commits[1]).toMatchObject({
      hash: 'stash',
      display_kind: 'stash',
      parent_hashes: ['base'],
      stash_base_hash: 'base',
      stash_untracked_hash: 'untracked',
      collapsed_hashes: ['index', 'untracked'],
    });
  });

  it('leaves non-stash commits unchanged', () => {
    const commits = [
      commit('head', ['base']),
      commit('base'),
    ];

    expect(buildGitGraphDisplayCommits(commits)).toEqual(commits);
  });
});
