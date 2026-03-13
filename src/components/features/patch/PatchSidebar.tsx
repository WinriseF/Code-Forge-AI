import { FileCode2, FileImage, FolderGit2, GitMerge, History, RefreshCw, Square, CheckSquare, AlertOctagon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { summarizeDiffFiles } from '@/lib/git_insights';
import { CommitSelector } from './CommitSelector';
import type {
  GitCommit,
  GitDiffFileItem,
  GitInsightsViewMode,
  GitRepositorySummary,
} from '@/types/git';

const WORK_DIR_OPTION: GitCommit = {
  hash: '__WORK_DIR__',
  author: 'CtxRun',
  date: 'Now',
  message: 'Working Tree',
  parentHashes: [],
  refs: [],
  filesChanged: 0,
  additions: 0,
  deletions: 0,
};

interface PatchSidebarProps {
  workspaceRoot: string | null;
  repositorySummary: GitRepositorySummary | null;
  commits: GitCommit[];
  files: GitDiffFileItem[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  baseHash: string;
  setBaseHash: (hash: string) => void;
  compareHash: string;
  setCompareHash: (hash: string) => void;
  onCompare: () => void;
  isGitLoading: boolean;
  gitError: string | null;
  repositoryLoaded: boolean;
  onRefreshRepository: () => void;
  selectedExportIds: Set<string>;
  onToggleExport: (id: string, checked: boolean) => void;
  activeView: GitInsightsViewMode;
  selectedCommitHash: string | null;
  onSelectWorkingTree: () => void;
  onSelectCommit: (hash: string) => void;
}

export function PatchSidebar({
  workspaceRoot,
  repositorySummary,
  commits,
  files,
  selectedFileId,
  onSelectFile,
  baseHash,
  setBaseHash,
  compareHash,
  setCompareHash,
  onCompare,
  isGitLoading,
  gitError,
  repositoryLoaded,
  onRefreshRepository,
  selectedExportIds,
  onToggleExport,
  activeView,
  selectedCommitHash,
  onSelectWorkingTree,
  onSelectCommit,
}: PatchSidebarProps) {
  const { t } = useTranslation();
  const compareCommits = [WORK_DIR_OPTION, ...commits];
  const diffStats = summarizeDiffFiles(files);
  const canShowRepoControls = !!workspaceRoot && repositoryLoaded && !gitError && repositorySummary;

  return (
    <div className="flex h-full w-[360px] select-none flex-col border-r border-border bg-secondary/10">
      <div className="border-b border-border bg-background px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t('patch.title')}
            </div>
            <div className="mt-2 truncate text-sm font-semibold text-foreground">
              {repositorySummary?.repositoryName || t('patch.selectRepository')}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {workspaceRoot || t('workspace.selectHint')}
            </div>
          </div>

          <button
            type="button"
            onClick={onRefreshRepository}
            disabled={!workspaceRoot || isGitLoading}
            title={t('workspace.rescan')}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(isGitLoading && 'animate-spin')} />
          </button>
        </div>

        {repositorySummary && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <SummaryPill label={t('patch.staged')} value={repositorySummary.stagedChanges} tone="amber" />
            <SummaryPill label={t('patch.unstaged')} value={repositorySummary.unstagedChanges} tone="blue" />
            <SummaryPill label={t('patch.untracked')} value={repositorySummary.untrackedFiles} tone="green" />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border bg-background/80 px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <GitMerge size={12} />
              {t('patch.compareTitle')}
            </h3>

            <button
              type="button"
              onClick={onSelectWorkingTree}
              disabled={!repositorySummary || isGitLoading}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                activeView === 'workingTree'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-secondary text-muted-foreground hover:text-foreground',
              )}
            >
              {t('patch.workingTree')}
            </button>
          </div>

          {canShowRepoControls ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">
                  {t('patch.baseVersion')}
                </label>
                <CommitSelector commits={commits} selectedValue={baseHash} onSelect={setBaseHash} disabled={isGitLoading} />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">
                  {t('patch.compareVersion')}
                </label>
                <CommitSelector
                  commits={compareCommits}
                  selectedValue={compareHash}
                  onSelect={setCompareHash}
                  disabled={isGitLoading}
                />
              </div>

              <button
                onClick={onCompare}
                disabled={isGitLoading || !baseHash || !compareHash}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                <GitMerge size={14} />
                {isGitLoading ? t('patch.comparing') : t('patch.generateDiff')}
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-secondary/15 px-3 py-3 text-xs text-muted-foreground">
              {!workspaceRoot
                ? t('workspace.selectHint')
                : gitError
                  ? t('common.errorMsg', { msg: gitError })
                  : t('workspace.loadHint')}
            </div>
          )}
        </div>

        <div className="border-b border-border bg-secondary/5">
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-2 bg-secondary/10">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <History size={12} />
              {t('patch.recentCommits')}
            </span>
            <span className="text-[10px] text-muted-foreground">{commits.length}</span>
          </div>

          <div className="max-h-56 overflow-y-auto p-2 custom-scrollbar">
            {commits.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground/70">
                {t('patch.noCommits')}
              </div>
            ) : (
              commits.map((commit) => {
                const isSelected = selectedCommitHash === commit.hash;
                return (
                  <button
                    key={commit.hash}
                    type="button"
                    onClick={() => onSelectCommit(commit.hash)}
                    className={cn(
                      'mb-1 flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-transparent bg-background/60 text-foreground hover:border-border hover:bg-background',
                    )}
                  >
                    <span className="truncate text-xs font-medium">{commit.message || commit.hash.slice(0, 7)}</span>
                    <span className="mt-1 truncate text-[10px] text-muted-foreground">
                      {commit.hash.slice(0, 7)} · {commit.author} · {commit.date}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-secondary/5">
          <div className="flex items-center justify-between border-b border-border/50 bg-secondary/10 px-4 py-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <FolderGit2 size={12} />
              {t('patch.changes')} ({diffStats.total})
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t('patch.diffableFiles')}: {diffStats.diffable}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {files.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground/70">
                {t('patch.noFilesInSelection')}
              </div>
            ) : (
              files.map((file) => {
                const isSelected = selectedFileId === file.id;
                const isChecked = selectedExportIds.has(file.id);
                const isDisabled = file.isBinary || file.isLarge;

                return (
                  <div
                    key={file.id}
                    className={cn(
                      'mb-1 flex items-center gap-1 rounded-lg border transition-colors',
                      isSelected ? 'border-border bg-background shadow-sm' : 'border-transparent hover:bg-background/70',
                    )}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isDisabled) {
                          onToggleExport(file.id, !isChecked);
                        }
                      }}
                      disabled={isDisabled}
                      className={cn(
                        'flex items-center justify-center px-2 py-2 text-muted-foreground transition-colors',
                        isDisabled ? 'cursor-not-allowed opacity-30' : 'hover:text-primary',
                      )}
                      title={isDisabled ? t('patch.exportBlocked') : t('patch.export')}
                    >
                      {isChecked ? <CheckSquare size={14} className="text-primary" /> : <Square size={14} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectFile(file.id)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pr-3 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {file.isBinary ? (
                          <FileImage size={12} className="shrink-0 text-orange-400" />
                        ) : file.isLarge ? (
                          <AlertOctagon size={12} className="shrink-0 text-red-400" />
                        ) : (
                          <FileCode2 size={12} className="shrink-0 text-muted-foreground" />
                        )}

                        <div className="min-w-0">
                          <div className={cn('truncate text-xs', isSelected ? 'font-semibold text-foreground' : 'text-foreground')}>
                            {file.path}
                          </div>
                          {file.oldPath ? (
                            <div className="truncate text-[10px] text-muted-foreground">
                              {file.oldPath}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold',
                          file.gitStatus === 'Added' && 'bg-green-500/20 text-green-600',
                          file.gitStatus === 'Modified' && 'bg-blue-500/20 text-blue-600',
                          file.gitStatus === 'Deleted' && 'bg-red-500/20 text-red-600',
                          file.gitStatus === 'Renamed' && 'bg-purple-500/20 text-purple-600',
                        )}
                      >
                        {file.gitStatus.charAt(0)}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'blue' | 'green';
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
      : tone === 'blue'
        ? 'border-blue-500/20 bg-blue-500/10 text-blue-600'
        : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600';

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-none">{value}</div>
    </div>
  );
}
