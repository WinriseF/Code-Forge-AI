import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatchView } from '@/components/features/patch/PatchView';

function createMockCommit(index: number) {
  const hash = `${index.toString(16).padStart(8, '0')}abcdef1234567890`;
  return {
    hash,
    author: `Author ${index}`,
    date: `2026-03-${String((index % 28) + 1).padStart(2, '0')} 10:00`,
    message: `History commit ${index}`,
    parentHashes: index === 0 ? ['1234567890abcdef'] : [`${(index - 1).toString(16).padStart(8, '0')}abcdef1234567890`],
    refs: index === 0 ? [{ name: 'main', refType: 'local' }] : [],
    filesChanged: 0,
    additions: 0,
    deletions: 0,
  };
}

const {
  invokeMock,
  writeClipboardMock,
  saveMock,
  useAppStoreMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  writeClipboardMock: vi.fn(),
  saveMock: vi.fn(),
  useAppStoreMock: vi.fn((selector?: (value: any) => unknown) => {
    const state = { projectRoot: '/workspace/repo' };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeClipboardMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveMock,
}));

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="mock-diff-editor">
      {original}
      {' -> '}
      {modified}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: useAppStoreMock,
}));

vi.mock('react-virtuoso', async () => {
  const ReactModule = await import('react');

  return {
    Virtuoso: ({
      data = [],
      itemContent,
      components = {},
      endReached,
    }: {
      data?: any[];
      itemContent: (index: number, item: any) => React.ReactNode;
      components?: {
        Scroller?: React.ComponentType<any>;
        Footer?: React.ComponentType<any>;
      };
      endReached?: (index: number) => void;
    }) => {
      const Scroller = components.Scroller ?? ((props: any) => <div {...props} />);
      const Footer = components.Footer;

      return (
        <Scroller
          onScroll={(event: React.UIEvent<HTMLDivElement>) => {
            const target = event.currentTarget;
            if (target.scrollTop + target.clientHeight >= target.scrollHeight - 240) {
              endReached?.(data.length - 1);
            }
          }}
        >
          {data.map((item, index) => (
            <div key={item.hash ?? index}>{itemContent(index, item)}</div>
          ))}
          {Footer ? <Footer /> : null}
        </Scroller>
      );
    },
  };
});

describe('PatchView Git insights phase', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    writeClipboardMock.mockReset();
    saveMock.mockReset();

    const mainPageOne = [
      {
        hash: 'abcdef1234567890',
        author: 'Alice',
        date: '2026-03-12 10:00',
        message: 'Refine git insights page',
        parentHashes: ['1234567890abcdef'],
        refs: [
          { name: 'HEAD', refType: 'head' },
          { name: 'main', refType: 'local' },
          { name: 'origin/main', refType: 'remote' },
        ],
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
      ...Array.from({ length: 79 }, (_, index) => createMockCommit(index + 1)),
    ];
    const mainPageTwo = [
      {
        hash: 'feedface12345678',
        author: 'Carol',
        date: '2026-03-10 08:30',
        message: 'History page 2 commit',
        parentHashes: ['00000050abcdef1234567890'],
        refs: [],
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      },
    ];

    invokeMock.mockImplementation((command: string, payload?: any) => {
      if (command === 'plugin:ctxrun-plugin-git|get_git_repository_summary') {
        return Promise.resolve({
          repositoryName: 'CtxRun',
          branchName: 'main',
          headHash: 'abcdef1234567890',
          lastCommitMessage: 'Refine git insights page',
          stagedChanges: 1,
          unstagedChanges: 2,
          untrackedFiles: 0,
          isDirty: true,
        });
      }

      if (command === 'plugin:ctxrun-plugin-git|list_git_branches') {
        return Promise.resolve([
          {
            name: 'refs/heads/main',
            shortName: 'main',
            branchType: 'local',
            isCurrent: true,
            upstreamName: 'origin/main',
            ahead: 1,
            behind: 0,
            lastCommitHash: 'abcdef1234567890',
            lastCommitDate: '2026-03-12 10:00',
            lastCommitMessage: 'Refine git insights page',
          },
          {
            name: 'refs/heads/feature',
            shortName: 'feature',
            branchType: 'local',
            isCurrent: false,
            upstreamName: 'origin/feature',
            ahead: 2,
            behind: 1,
            lastCommitHash: 'feature1234567890',
            lastCommitDate: '2026-03-12 09:00',
            lastCommitMessage: 'Add compact branch explorer',
          },
          {
            name: 'refs/remotes/origin/feature',
            shortName: 'origin/feature',
            branchType: 'remote',
            isCurrent: false,
            upstreamName: null,
            ahead: 0,
            behind: 0,
            lastCommitHash: 'feature1234567890',
            lastCommitDate: '2026-03-12 09:00',
            lastCommitMessage: 'Add compact branch explorer',
          },
        ]);
      }

      if (command === 'plugin:ctxrun-plugin-git|get_git_branch_commits') {
        if (payload?.branchName === 'feature') {
          return Promise.resolve([
            {
              hash: 'feature1234567890',
              author: 'Bob',
              date: '2026-03-12 09:00',
              message: 'Add compact branch explorer',
              parentHashes: ['abcdef1234567890'],
              refs: [{ name: 'feature', refType: 'local' }],
              filesChanged: 0,
              additions: 0,
              deletions: 0,
            },
          ]);
        }

        if (payload?.offset === 80) {
          return Promise.resolve(mainPageTwo);
        }

        return Promise.resolve(mainPageOne);
      }

      if (command === 'plugin:ctxrun-plugin-git|get_git_commit_details') {
        return Promise.resolve({
          hash: 'abcdef1234567890',
          author: 'Alice',
          email: 'alice@example.com',
          date: '2026-03-12 10:00',
          summary: 'Refine git insights page',
          message: 'Refine git insights page\n\nwith branch-first layout',
          parentHashes: ['1234567890abcdef'],
          changedFiles: [
            {
              path: 'src/app.ts',
              status: 'Modified',
              oldPath: null,
            },
          ],
        });
      }

      if (command === 'plugin:ctxrun-plugin-git|get_git_diff') {
        return Promise.resolve([
          {
            path: 'src/app.ts',
            status: 'Modified',
            oldPath: null,
            originalContent: 'before',
            modifiedContent: 'after',
            isBinary: false,
            isLarge: false,
          },
        ]);
      }

      throw new Error(`Unhandled command: ${command}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads repository data and no longer renders AI patch mode', async () => {
    render(<PatchView />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:ctxrun-plugin-git|get_git_repository_summary',
        { projectPath: '/workspace/repo' },
      ));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:ctxrun-plugin-git|get_git_branch_commits',
        {
          projectPath: '/workspace/repo',
          branchName: 'main',
          branchType: 'local',
          offset: 0,
          limit: 80,
        },
      ));

    expect(screen.getByText('patch.title')).toBeTruthy();
    expect(screen.getByText('patch.historyTab')).toBeTruthy();
    expect(screen.getByText('patch.branchesTab')).toBeTruthy();
    expect(screen.getByText('patch.branchHistory')).toBeTruthy();
    expect(screen.getByText('patch.changedFiles')).toBeTruthy();
    expect(screen.getAllByText('CtxRun').length).toBeGreaterThan(0);
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    expect(screen.getAllByText('src/app.ts').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('mock-diff-editor')).toBeNull();
    expect(screen.queryByText('patch.aiPatch')).toBeNull();

    fireEvent.click(screen.getByText('patch.compareTab'));
    await waitFor(() => expect(screen.getByTestId('mock-diff-editor')).toBeTruthy());
  });

  it('renders the grouped branch explorer and loads another branch when selected', async () => {
    render(<PatchView />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:ctxrun-plugin-git|get_git_branch_commits',
        {
          projectPath: '/workspace/repo',
          branchName: 'main',
          branchType: 'local',
          offset: 0,
          limit: 80,
        },
      ));

    fireEvent.click(screen.getByText('patch.branchesTab'));

    expect(screen.getByText('patch.branchDetails')).toBeTruthy();
    expect(screen.getAllByText('patch.localBranches').length).toBeGreaterThan(0);
    expect(screen.getAllByText('patch.remoteBranches').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('feature'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:ctxrun-plugin-git|get_git_branch_commits',
        {
          projectPath: '/workspace/repo',
          branchName: 'feature',
          branchType: 'local',
          offset: 0,
          limit: 80,
        },
      ));

    expect(screen.getAllByText('feature').length).toBeGreaterThan(0);
    expect(screen.getAllByText('patch.switchBranch').length).toBeGreaterThan(0);
  });

  it('loads more commits when the history list scrolls to the bottom', async () => {
    render(<PatchView />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:ctxrun-plugin-git|get_git_branch_commits',
        {
          projectPath: '/workspace/repo',
          branchName: 'main',
          branchType: 'local',
          offset: 0,
          limit: 80,
        },
      ));

    const scrollContainer = screen.getByTestId('commit-timeline-scroll');
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2400, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 600, configurable: true });

    fireEvent.scroll(scrollContainer, { target: { scrollTop: 1900 } });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'plugin:ctxrun-plugin-git|get_git_branch_commits',
        {
          projectPath: '/workspace/repo',
          branchName: 'main',
          branchType: 'local',
          offset: 80,
          limit: 80,
        },
      ));

    await waitFor(() => expect(screen.getByText('History page 2 commit')).toBeTruthy());
  });
});
