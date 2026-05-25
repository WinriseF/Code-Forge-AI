import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '@/components/features/patch/DetailPanel';
import type { GitDiffSummary, PatchFileItem } from '@/components/features/patch/patch_types';

const {
  storeState,
  selectFileMock,
  toggleExportPathMock,
  toggleExportPathsMock,
} = vi.hoisted(() => {
  const diffFiles: PatchFileItem[] = [];
  const summary: GitDiffSummary = {
    files_changed: 0,
    files_added: 0,
    files_modified: 0,
    files_deleted: 0,
    files_renamed: 0,
    insertions: 0,
    deletions: 0,
  };

  return {
    selectFileMock: vi.fn(),
    toggleExportPathMock: vi.fn(),
    toggleExportPathsMock: vi.fn(),
    storeState: {
      commits: [],
      selectedCommitHash: '__WORK_DIR__',
      diffFiles,
      selectedFilePath: null,
      selectFile: vi.fn(),
      compareTargetHash: null,
      diffOldHash: 'old',
      diffNewHash: '__WORK_DIR__',
      diffSummary: summary,
      isLoading: false,
      selectedExportPaths: new Set<string>(),
      toggleExportPath: vi.fn(),
      toggleExportPaths: vi.fn(),
      canExportCurrentDiff: true,
    },
  };
});

vi.mock('@/store/useGitGraphStore', () => ({
  WORKING_TREE_HASH: '__WORK_DIR__',
  useGitGraphStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'patch.selectFolderForExport': 'Select this folder',
        'patch.unselectFolderForExport': 'Unselect this folder',
        'patch.binaryFileExportDisabled': 'Binary files cannot be exported',
        'patch.binaryFileExportDisabledShort': 'Binary',
        'patch.largeFileExportDisabled': 'Files larger than 2 MB cannot be exported',
        'patch.largeFileExportDisabledShort': 'Too large',
      };

      return translations[key] ?? (typeof fallback === 'string' ? fallback : key);
    },
  }),
}));

function patchFile(path: string, overrides: Partial<PatchFileItem> = {}): PatchFileItem {
  return {
    id: path,
    path,
    original: 'before',
    modified: 'after',
    status: 'success',
    gitStatus: 'Modified',
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

describe('DetailPanel folder export menu', () => {
  beforeEach(() => {
    selectFileMock.mockReset();
    toggleExportPathMock.mockReset();
    toggleExportPathsMock.mockReset();
    storeState.selectFile = selectFileMock;
    storeState.toggleExportPath = toggleExportPathMock;
    storeState.toggleExportPaths = toggleExportPathsMock;
    storeState.selectedCommitHash = '__WORK_DIR__';
    storeState.selectedFilePath = null;
    storeState.isLoading = false;
    storeState.canExportCurrentDiff = true;
    storeState.selectedExportPaths = new Set<string>();
    storeState.diffFiles = [
      patchFile('src/a.ts'),
      patchFile('src/nested/b.ts'),
      patchFile('src/image.png', { isBinary: true }),
      patchFile('src/huge.log', { isLarge: true }),
      patchFile('other/c.ts'),
    ];
    storeState.diffSummary = {
      files_changed: storeState.diffFiles.length,
      files_added: 0,
      files_modified: storeState.diffFiles.length,
      files_deleted: 0,
      files_renamed: 0,
      insertions: 4,
      deletions: 4,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('opens a folder context menu and batch-selects only exportable descendants', () => {
    render(<DetailPanel onExport={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText('src'), { clientX: 50, clientY: 60 });

    expect(screen.getByRole('menuitem', { name: 'Select this folder' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Unselect this folder' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Select this folder' }));

    expect(toggleExportPathsMock).toHaveBeenCalledWith([
      'src/nested/b.ts',
      'src/a.ts',
    ], true);
    expect(selectFileMock).not.toHaveBeenCalled();
  });

  it('renders checkbox and file icons in matching fixed-height alignment slots', () => {
    render(<DetailPanel onExport={vi.fn()} />);

    const checkboxSlot = screen.getAllByTestId('patch-file-checkbox-slot')[0];
    const iconSlot = screen.getAllByTestId('patch-file-icon-slot')[0];

    expect(checkboxSlot.className).toContain('h-5');
    expect(checkboxSlot.className).toContain('items-center');
    expect(iconSlot.className).toContain('h-5');
    expect(iconSlot.className).toContain('items-center');
  });

  it('shows a localized reason for oversized files that cannot be exported', () => {
    render(<DetailPanel onExport={vi.fn()} />);

    expect(screen.getByText('Too large')).toBeTruthy();
    expect(screen.getAllByTitle('Files larger than 2 MB cannot be exported').length).toBeGreaterThan(0);
  });
});
