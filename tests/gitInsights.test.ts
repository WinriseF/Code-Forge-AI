import { describe, expect, it } from 'vitest';
import {
  buildGitViewTitle,
  buildRepositorySubtitle,
  countExportableFiles,
  getDefaultSelectedFileId,
  resolveGitReferenceLabelWithLabels,
  summarizeDiffFiles,
} from '@/lib/git_insights';
import type { GitCommit, GitCommitDetails, GitDiffFileItem, GitRepositorySummary } from '@/types/git';

const commits: GitCommit[] = [
  {
    hash: 'abcdef1234567890',
    author: 'Alice',
    date: '2026-03-12 10:00',
    message: 'Refine git insights page',
    parentHashes: ['fedcba0987654321'],
    refs: [
      { name: 'HEAD', refType: 'head' },
      { name: 'main', refType: 'local' },
      { name: 'origin/main', refType: 'remote' },
    ],
    filesChanged: 5,
    additions: 21,
    deletions: 4,
  },
  {
    hash: 'fedcba0987654321',
    author: 'Bob',
    date: '2026-03-11 09:00',
    message: 'Initial git explorer',
    parentHashes: [],
    refs: [{ name: 'v0.1.0', refType: 'tag' }],
    filesChanged: 2,
    additions: 8,
    deletions: 0,
  },
];

const files: GitDiffFileItem[] = [
  {
    id: 'src/app.ts',
    path: 'src/app.ts',
    gitStatus: 'Modified',
    original: 'old',
    modified: 'new',
    isBinary: false,
    isLarge: false,
  },
  {
    id: 'assets/logo.png',
    path: 'assets/logo.png',
    gitStatus: 'Added',
    original: '',
    modified: '[binary]',
    isBinary: true,
    isLarge: false,
  },
  {
    id: 'docs/guide.md',
    path: 'docs/guide.md',
    gitStatus: 'Renamed',
    oldPath: 'docs/old-guide.md',
    original: 'old doc',
    modified: 'new doc',
    isBinary: false,
    isLarge: true,
  },
];

const labels = {
  workingTree: '工作区',
  initialCommit: '初始提交',
};

describe('git insights helpers', () => {
  it('summarizes diff files by status and exportability', () => {
    expect(summarizeDiffFiles(files)).toEqual({
      total: 3,
      diffable: 1,
      binary: 1,
      large: 1,
      added: 1,
      modified: 1,
      deleted: 0,
      renamed: 1,
    });
    expect(countExportableFiles(files)).toBe(1);
    expect(getDefaultSelectedFileId(files)).toBe('src/app.ts');
  });

  it('builds localized reference labels and view titles', () => {
    const commitDetails: GitCommitDetails = {
      hash: commits[0].hash,
      author: 'Alice',
      email: 'alice@example.com',
      date: '2026-03-12 10:00',
      summary: 'Refine git insights page',
      message: 'Refine git insights page\n\nWith more structure.',
      parentHashes: [commits[1].hash],
      changedFiles: [],
    };

    expect(resolveGitReferenceLabelWithLabels('__WORK_DIR__', commits, labels)).toBe('工作区');
    expect(resolveGitReferenceLabelWithLabels('__EMPTY_TREE__', commits, labels)).toBe('初始提交');
    expect(
      buildGitViewTitle('workingTree', commits, commits[0].hash, '__WORK_DIR__', null, labels),
    ).toContain('工作区');
    expect(
      buildGitViewTitle('comparison', commits, commits[1].hash, commits[0].hash, null, labels),
    ).toContain('Refine git insights page');
    expect(
      buildGitViewTitle('commit', commits, commits[1].hash, commits[0].hash, commitDetails, labels),
    ).toBe('Refine git insights page');
  });

  it('builds repository subtitle from branch and status counts', () => {
    const summary: GitRepositorySummary = {
      repositoryName: 'CtxRun',
      branchName: 'main',
      headHash: commits[0].hash,
      lastCommitMessage: commits[0].message,
      stagedChanges: 2,
      unstagedChanges: 1,
      untrackedFiles: 3,
      isDirty: true,
    };

    expect(
      buildRepositorySubtitle(summary, {
        staged: '已暂存',
        unstaged: '未暂存',
        untracked: '未跟踪',
      }),
    ).toBe('main · 已暂存 2 · 未暂存 1 · 未跟踪 3');
  });
});
