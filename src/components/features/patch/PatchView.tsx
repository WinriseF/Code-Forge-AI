import { useEffect, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeText as writeClipboard } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { Toast, ToastType } from '@/components/ui/Toast';
import { BranchManagerView } from './BranchManagerView';
import { CommitTimelinePane } from './CommitTimelinePane';
import { CompareControls } from './CompareControls';
import { CommitOverviewCard } from './CommitOverviewCard';
import { DiffFileList } from './DiffFileList';
import { DiffWorkspace } from './DiffWorkspace';
import { GitWorkbenchHeader } from './GitWorkbenchHeader';
import { ExportDialog } from './dialogs/ExportDialog';
import { getDefaultSelectedFileId, getInitialSelectedBranch } from '@/lib/git_insights';
import { createGitHistoryPagingState, mergeGitCommitPages, type GitHistoryPagingState } from '@/lib/git_graph';
import type {
  ExportFormat,
  ExportLayout,
  GitBranchRef,
  GitCommit,
  GitCommitDetails,
  GitDiffFileItem,
  GitRepositorySummary,
  GitWorkbenchTab,
} from '@/types/git';

const GIT_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-git|';
const WORK_DIR_REF = '__WORK_DIR__';
const EMPTY_TREE_REF = '__EMPTY_TREE__';
const HISTORY_PAGE_SIZE = 80;

const EMPTY_HISTORY_PAGING: GitHistoryPagingState = createGitHistoryPagingState([], HISTORY_PAGE_SIZE, {
  hasMore: false,
});

interface GitDiffResponseFile {
  path: string;
  status: 'Added' | 'Modified' | 'Deleted' | 'Renamed';
  oldPath?: string | null;
  old_path?: string | null;
  originalContent?: string;
  original_content?: string;
  modifiedContent?: string;
  modified_content?: string;
  isBinary?: boolean;
  is_binary?: boolean;
  isLarge?: boolean;
  is_large?: boolean;
}

export function PatchView() {
  const { projectRoot: globalProjectRoot } = useAppStore();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<GitWorkbenchTab>('history');
  const [selectedBranch, setSelectedBranch] = useState<GitBranchRef | null>(null);
  const [repositorySummary, setRepositorySummary] = useState<GitRepositorySummary | null>(null);
  const [branches, setBranches] = useState<GitBranchRef[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [historyPaging, setHistoryPaging] = useState<GitHistoryPagingState>(EMPTY_HISTORY_PAGING);
  const [commitDetails, setCommitDetails] = useState<GitCommitDetails | null>(null);
  const [files, setFiles] = useState<GitDiffFileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());
  const [baseHash, setBaseHash] = useState('');
  const [compareHash, setCompareHash] = useState('');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ show: boolean; msg: string; type: ToastType }>({
    show: false,
    msg: '',
    type: 'success',
  });

  const showNotification = (msg: string, type: ToastType = 'success') => {
    setToastState({ show: true, msg, type });
  };

  const clearDiffSelection = () => {
    setFiles([]);
    setSelectedFileId(null);
    setSelectedExportIds(new Set());
  };

  const resetHistoryContext = () => {
    setSelectedBranch(null);
    setCommits([]);
    setHistoryPaging({ ...EMPTY_HISTORY_PAGING });
    setCommitDetails(null);
    clearDiffSelection();
    setSelectedCommitHash(null);
    setBaseHash('');
    setCompareHash('');
  };

  const applyGitDiffFiles = (result: GitDiffResponseFile[], notifyWhenEmpty = false) => {
    const nextFiles: GitDiffFileItem[] = result.map((file) => ({
      id: file.path,
      path: file.path,
      oldPath: file.oldPath ?? file.old_path ?? null,
      gitStatus: file.status,
      original: file.originalContent ?? file.original_content ?? '',
      modified: file.modifiedContent ?? file.modified_content ?? '',
      isBinary: file.isBinary ?? file.is_binary ?? false,
      isLarge: file.isLarge ?? file.is_large ?? false,
    }));

    setFiles(nextFiles);
    setSelectedFileId(getDefaultSelectedFileId(nextFiles));
    setSelectedExportIds(
      new Set(nextFiles.filter((file) => !file.isBinary && !file.isLarge).map((file) => file.id)),
    );

    if (nextFiles.length === 0 && notifyWhenEmpty) {
      showNotification(t('patch.noDiff'), 'info');
    }
  };

  const fetchGitDiff = async (
    projectPath: string,
    oldHash: string,
    newHash: string,
    notifyWhenEmpty = false,
  ) => {
    const result = await invoke<GitDiffResponseFile[]>(`${GIT_PLUGIN_PREFIX}get_git_diff`, {
      projectPath,
      oldHash,
      newHash,
    });
    applyGitDiffFiles(result, notifyWhenEmpty);
  };

  const loadCommitSelection = async (projectPath: string, hash: string) => {
    setSelectedCommitHash(hash);
    setCommitDetails(null);
    const details = await invoke<GitCommitDetails>(`${GIT_PLUGIN_PREFIX}get_git_commit_details`, {
      projectPath,
      hash,
    });
    const parentHash = details.parentHashes[0] || EMPTY_TREE_REF;

    setCommitDetails(details);
    setBaseHash(parentHash);
    setCompareHash(hash);
    clearDiffSelection();
  };

  const loadComparePreview = async (
    projectPath: string,
    nextBaseHash: string,
    nextCompareHash: string,
    notifyWhenEmpty = false,
  ) => {
    setCommitDetails(null);
    setSelectedCommitHash(null);
    setBaseHash(nextBaseHash);
    setCompareHash(nextCompareHash);
    await fetchGitDiff(projectPath, nextBaseHash, nextCompareHash, notifyWhenEmpty);
  };

  const loadBranchContext = async (
    projectPath: string,
    branch: GitBranchRef,
    tab: GitWorkbenchTab,
  ) => {
    const history = await invoke<GitCommit[]>(`${GIT_PLUGIN_PREFIX}get_git_branch_commits`, {
      projectPath,
      branchName: branch.shortName,
      branchType: branch.branchType,
      offset: 0,
      limit: HISTORY_PAGE_SIZE,
    });

    setSelectedBranch(branch);
    setCommits(history);
    setHistoryPaging(
      createGitHistoryPagingState(history, HISTORY_PAGE_SIZE, {
        hasMore: history.length >= HISTORY_PAGE_SIZE,
      }),
    );

    if (history.length === 0) {
      setCommitDetails(null);
      setSelectedCommitHash(null);
      clearDiffSelection();
      setBaseHash('');
      setCompareHash('');
      return;
    }

    const headHash = history[0].hash;
    if (tab === 'compare') {
      await loadComparePreview(projectPath, headHash, WORK_DIR_REF);
    } else {
      await loadCommitSelection(projectPath, headHash);
    }
  };

  const loadMoreHistory = async () => {
    if (
      !globalProjectRoot ||
      !selectedBranch ||
      historyPaging.isLoadingMore ||
      isGitLoading ||
      !historyPaging.hasMore
    ) {
      return;
    }

    setHistoryPaging((prev) => ({ ...prev, isLoadingMore: true }));
    try {
      const nextHistory = await invoke<GitCommit[]>(`${GIT_PLUGIN_PREFIX}get_git_branch_commits`, {
        projectPath: globalProjectRoot,
        branchName: selectedBranch.shortName,
        branchType: selectedBranch.branchType,
        offset: historyPaging.nextOffset,
        limit: historyPaging.pageSize,
      });

      const mergedHistory = mergeGitCommitPages(commits, nextHistory, historyPaging.anchorHash);
      setCommits(mergedHistory);
      setHistoryPaging(
        createGitHistoryPagingState(mergedHistory, historyPaging.pageSize, {
          hasMore: nextHistory.length >= historyPaging.pageSize,
        }),
      );
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      showNotification(t('common.errorMsg', { msg: message }), 'error');
    } finally {
      setHistoryPaging((prev) => ({ ...prev, isLoadingMore: false }));
    }
  };

  const loadGitRepository = async (projectPath: string, preferredBranchName?: string) => {
    setIsGitLoading(true);
    setGitError(null);

    try {
      const [summary, branchList] = await Promise.all([
        invoke<GitRepositorySummary>(`${GIT_PLUGIN_PREFIX}get_git_repository_summary`, { projectPath }),
        invoke<GitBranchRef[]>(`${GIT_PLUGIN_PREFIX}list_git_branches`, { projectPath }),
      ]);

      setRepositorySummary(summary);
      setBranches(branchList);

      const initialBranch =
        branchList.find((branch) => branch.shortName === preferredBranchName) ||
        getInitialSelectedBranch(branchList, summary.branchName);

      if (initialBranch) {
        await loadBranchContext(projectPath, initialBranch, activeTab);
      } else {
        resetHistoryContext();
      }
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      setRepositorySummary(null);
      setBranches([]);
      resetHistoryContext();
      showNotification(t('common.errorMsg', { msg: message }), 'error');
    } finally {
      setIsGitLoading(false);
    }
  };

  useEffect(() => {
    setGitError(null);
    setRepositorySummary(null);
    setBranches([]);
    resetHistoryContext();

    if (globalProjectRoot) {
      void loadGitRepository(globalProjectRoot);
    }
  }, [globalProjectRoot]);

  const handleSelectBranch = async (branch: GitBranchRef) => {
    if (!globalProjectRoot) return;

    setIsGitLoading(true);
    setGitError(null);
    try {
      await loadBranchContext(globalProjectRoot, branch, activeTab);
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      showNotification(t('common.errorMsg', { msg: message }), 'error');
    } finally {
      setIsGitLoading(false);
    }
  };

  const handleCheckoutBranch = async (branch: GitBranchRef) => {
    if (!globalProjectRoot) return;

    setIsGitLoading(true);
    setGitError(null);
    try {
      const summary = await invoke<GitRepositorySummary>(`${GIT_PLUGIN_PREFIX}checkout_git_branch`, {
        projectPath: globalProjectRoot,
        branchName: branch.shortName,
        branchType: branch.branchType,
      });
      setRepositorySummary(summary);
      showNotification(t('patch.checkoutSuccess', { branch: branch.shortName }), 'success');
      await loadGitRepository(globalProjectRoot, summary.branchName);
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      showNotification(t('patch.checkoutFailed', { msg: message }), 'error');
    } finally {
      setIsGitLoading(false);
    }
  };

  const handleSelectCommit = async (hash: string) => {
    if (!globalProjectRoot) return;

    setIsGitLoading(true);
    setGitError(null);
    try {
      await loadCommitSelection(globalProjectRoot, hash);
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      showNotification(t('common.errorMsg', { msg: message }), 'error');
    } finally {
      setIsGitLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!globalProjectRoot || !baseHash || !compareHash) return;

    setIsGitLoading(true);
    setGitError(null);
    try {
      await loadComparePreview(globalProjectRoot, baseHash, compareHash, true);
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      showNotification(t('common.errorMsg', { msg: message }), 'error');
    } finally {
      setIsGitLoading(false);
    }
  };

  const handleChangeTab = async (tab: GitWorkbenchTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);

    if (!globalProjectRoot || !selectedBranch) return;
    if (tab === 'branches') return;

    setIsGitLoading(true);
    setGitError(null);
    try {
      if (tab === 'compare') {
        const nextBase = commits[0]?.hash || repositorySummary?.headHash || '';
        if (nextBase) {
          await loadComparePreview(globalProjectRoot, nextBase, WORK_DIR_REF);
        }
      } else {
        const nextCommit = selectedCommitHash || commits[0]?.hash;
        if (nextCommit) {
          await loadCommitSelection(globalProjectRoot, nextCommit);
        }
      }
    } catch (err: any) {
      const message = err?.toString?.() || String(err);
      setGitError(message);
      showNotification(t('common.errorMsg', { msg: message }), 'error');
    } finally {
      setIsGitLoading(false);
    }
  };

  const toggleFileExport = (id: string, checked: boolean) => {
    setSelectedExportIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleExportTrigger = () => {
    if (!globalProjectRoot || !baseHash || !compareHash) return;
    if (selectedExportIds.size === 0) {
      showNotification(t('patch.selectOne'), 'warning');
      return;
    }
    setIsExportDialogOpen(true);
  };

  const performExport = async (format: ExportFormat, layout: ExportLayout) => {
    if (!globalProjectRoot) return;

    setIsExportDialogOpen(false);

    try {
      const extMap: Record<ExportFormat, string> = {
        Markdown: 'md',
        Json: 'json',
        Xml: 'xml',
        Txt: 'txt',
      };

      const baseLabel = baseHash === EMPTY_TREE_REF ? 'initial' : baseHash.slice(0, 7);
      const compareLabel =
        compareHash === WORK_DIR_REF
          ? 'workdir'
          : compareHash === EMPTY_TREE_REF
            ? 'initial'
            : compareHash.slice(0, 7);

      const filePath = await save({
        title: `Export ${layout} Diff as ${format}`,
        defaultPath: `diff_${layout.toLowerCase()}_${baseLabel}_${compareLabel}.${extMap[format]}`,
        filters: [{ name: format, extensions: [extMap[format]] }],
      });

      if (filePath) {
        await invoke(`${GIT_PLUGIN_PREFIX}export_git_diff`, {
          projectPath: globalProjectRoot,
          oldHash: baseHash,
          newHash: compareHash,
          format,
          layout,
          savePath: filePath,
          selectedPaths: Array.from(selectedExportIds),
        });
        showNotification(t('patch.exportSuccess'), 'success');
      }
    } catch (err: any) {
      showNotification(t('common.exportFailed', { msg: err.toString() }), 'error');
    }
  };

  const currentFile = files.find((file) => file.id === selectedFileId) || null;
  const selectedCommit = commits.find((commit) => commit.hash === selectedCommitHash) || null;

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <GitWorkbenchHeader
          repositorySummary={repositorySummary}
          branches={branches}
          selectedBranch={selectedBranch}
          activeTab={activeTab}
          gitError={gitError}
          canRefresh={!!globalProjectRoot}
          onSelectBranch={(branch) => {
            void handleSelectBranch(branch);
          }}
          onCheckoutSelectedBranch={() => {
            if (selectedBranch) {
              void handleCheckoutBranch(selectedBranch);
            }
          }}
          onSelectTab={(tab) => {
            void handleChangeTab(tab);
          }}
          onRefresh={() => {
            if (globalProjectRoot) {
              void loadGitRepository(globalProjectRoot, selectedBranch?.shortName);
            }
          }}
          isGitLoading={isGitLoading}
        />

        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {activeTab === 'branches' ? (
            <BranchManagerView
              branches={branches}
              selectedBranch={selectedBranch}
              isGitLoading={isGitLoading}
              onSelectBranch={handleSelectBranch}
              onCheckoutBranch={handleCheckoutBranch}
              onOpenHistory={async (branch) => {
                await handleSelectBranch(branch);
                setActiveTab('history');
              }}
            />
          ) : activeTab === 'history' ? (
            <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-h-0">
                <CommitTimelinePane
                  selectedBranch={selectedBranch}
                  commits={commits}
                  selectedCommitHash={selectedCommitHash}
                  isGitLoading={isGitLoading}
                  isHistoryLoadingMore={historyPaging.isLoadingMore}
                  hasMoreHistory={historyPaging.hasMore}
                  onSelectCommit={handleSelectCommit}
                  onLoadMore={loadMoreHistory}
                />
              </div>

              <div className="min-h-0">
                <CommitOverviewCard
                  selectedBranch={selectedBranch}
                  selectedCommit={selectedCommit}
                  commitDetails={commitDetails}
                  isGitLoading={isGitLoading}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <CompareControls
                selectedBranch={selectedBranch}
                commits={commits}
                baseHash={baseHash}
                compareHash={compareHash}
                isGitLoading={isGitLoading}
                onSetBaseHash={setBaseHash}
                onSetCompareHash={setCompareHash}
                onCompare={handleCompare}
              />

              <div className="flex min-h-0 flex-1 gap-4">
                <div className="min-h-0 w-[300px] shrink-0">
                  <DiffFileList
                    title={t('patch.compareTab')}
                    files={files}
                    selectedFileId={selectedFileId}
                    selectedExportIds={selectedExportIds}
                    onSelectFile={setSelectedFileId}
                    onToggleExport={toggleFileExport}
                  />
                </div>

                <div className="min-w-0 flex-1 rounded-[24px] border border-border/70 bg-background/85 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.75)]">
                  <DiffWorkspace
                    selectedFile={currentFile}
                    onCopy={async (txt) => {
                      await writeClipboard(txt);
                      showNotification(t('patch.copied'));
                    }}
                    onExport={files.length > 0 ? handleExportTrigger : undefined}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onConfirm={performExport}
        count={selectedExportIds.size}
      />

      <Toast
        message={toastState.msg}
        type={toastState.type}
        show={toastState.show}
        onDismiss={() => setToastState((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
}
