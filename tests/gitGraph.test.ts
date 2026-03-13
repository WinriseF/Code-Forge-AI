import { describe, expect, it } from 'vitest';
import {
  buildGitCommitGraphRows,
  createGitHistoryPagingState,
  filterGitCommitGraphRows,
  mergeGitCommitPages,
} from '@/lib/git_graph';
import type { GitCommit } from '@/types/git';

const commits: GitCommit[] = [
  {
    hash: 'c0ffee1234567890',
    author: 'Alice',
    date: '2026-03-12 10:00',
    message: 'Merge feature branch',
    parentHashes: ['feature1234567890', 'main1234567890'],
    refs: [
      { name: 'HEAD', refType: 'head' },
      { name: 'main', refType: 'local' },
    ],
    filesChanged: 3,
    additions: 21,
    deletions: 4,
  },
  {
    hash: 'feature1234567890',
    author: 'Bob',
    date: '2026-03-12 09:40',
    message: 'Feature work',
    parentHashes: ['base1234567890'],
    refs: [{ name: 'feature', refType: 'local' }],
    filesChanged: 1,
    additions: 7,
    deletions: 1,
  },
  {
    hash: 'main1234567890',
    author: 'Alice',
    date: '2026-03-12 09:30',
    message: 'Mainline cleanup',
    parentHashes: ['base1234567890'],
    refs: [{ name: 'origin/main', refType: 'remote' }],
    filesChanged: 2,
    additions: 3,
    deletions: 2,
  },
  {
    hash: 'base1234567890',
    author: 'Carol',
    date: '2026-03-12 09:00',
    message: 'Base commit',
    parentHashes: [],
    refs: [{ name: 'v1.0.0', refType: 'tag' }],
    filesChanged: 1,
    additions: 10,
    deletions: 0,
  },
];

describe('git graph helpers', () => {
  it('builds graph rows with labels and merge lanes', () => {
    const rows = buildGitCommitGraphRows(commits);

    expect(rows).toHaveLength(4);
    expect(rows[0].lane).toBe(0);
    expect(rows[0].mergeToLanes.length).toBeGreaterThan(0);
    expect(rows[0].labels.map((label) => label.name)).toContain('HEAD');
    expect(rows[2].labels.map((label) => label.tone)).toContain('remote');
    expect(rows[3].labels.map((label) => label.tone)).toContain('tag');
  });

  it('filters graph rows by commit metadata', () => {
    const rows = buildGitCommitGraphRows(commits);

    expect(filterGitCommitGraphRows(rows, 'feature')).toHaveLength(2);
    expect(filterGitCommitGraphRows(rows, 'origin/main')[0]?.commit.hash).toBe('main1234567890');
  });

  it('creates paging state from loaded history', () => {
    expect(
      createGitHistoryPagingState(commits.slice(0, 2), 2, {
        hasMore: true,
      }),
    ).toEqual({
      pageSize: 2,
      nextOffset: 2,
      hasMore: true,
      isLoadingMore: false,
      anchorHash: 'feature1234567890',
    });
  });

  it('merges paged commits using the current anchor and removes duplicates', () => {
    const merged = mergeGitCommitPages(commits.slice(0, 2), [commits[1], commits[2], commits[3]], 'feature1234567890');

    expect(merged.map((commit) => commit.hash)).toEqual([
      'c0ffee1234567890',
      'feature1234567890',
      'main1234567890',
      'base1234567890',
    ]);
  });
});
