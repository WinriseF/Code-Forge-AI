import { type ReactNode } from 'react';
import { FileText, GitCommitHorizontal, History, Plus, Minus, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { GitBranchRef, GitCommit, GitCommitDetails, GitCommitRef } from '@/types/git';

interface CommitOverviewCardProps {
  selectedBranch: GitBranchRef | null;
  selectedCommit: GitCommit | null;
  commitDetails: GitCommitDetails | null;
  isGitLoading: boolean;
}

export function CommitOverviewCard({
  selectedBranch,
  selectedCommit,
  commitDetails,
  isGitLoading,
}: CommitOverviewCardProps) {
  const { t } = useTranslation();

  if (!selectedBranch) {
    return (
      <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-dashed border-border/70 bg-secondary/15 px-5 py-6 text-sm text-muted-foreground">
        {t('patch.noBranchSelected')}
      </aside>
    );
  }

  if (!selectedCommit) {
    return (
      <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-dashed border-border/70 bg-secondary/15 px-5 py-6 text-sm text-muted-foreground">
        {t('patch.commitPlaceholder')}
      </aside>
    );
  }

  const title = commitDetails?.summary || selectedCommit.message || selectedCommit.hash.slice(0, 7);
  const message = commitDetails?.message || selectedCommit.message || selectedCommit.hash;
  const changedFiles = commitDetails?.changedFiles ?? [];
  const refs = selectedCommit.refs ?? [];
  const filesChanged = selectedCommit.filesChanged > 0 ? selectedCommit.filesChanged : changedFiles.length;
  const showLineStats = selectedCommit.additions > 0 || selectedCommit.deletions > 0;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <GitCommitHorizontal size={11} />
          {t('patch.commitDetails')}
        </div>

        <div className="mt-2 text-base font-semibold text-foreground">{title}</div>
        <div className="mt-1 font-mono text-xs text-muted-foreground select-text">{selectedCommit.hash}</div>

        {refs.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {refs.map((ref) => (
              <RefBadge key={`${ref.refType}:${ref.name}`} refInfo={ref} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <section className="border-b border-border/60 px-4 py-4">
          <div className="grid gap-2">
            <MetaCard icon={<UserRound size={14} />} label={t('patch.author')} value={commitDetails?.author || selectedCommit.author} />
            <MetaCard icon={<History size={14} />} label={t('patch.date')} value={commitDetails?.date || selectedCommit.date} />
            <MetaCard
              icon={<GitCommitHorizontal size={14} />}
              label={t('patch.parents')}
              value={`${commitDetails?.parentHashes.length ?? selectedCommit.parentHashes.length}`}
            />
            <MetaCard
              icon={<FileText size={14} />}
              label={t('patch.changesColumn')}
              value={filesChanged > 0 ? `${filesChanged} ${t('patch.filesLabel')}` : '--'}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/10 px-2 py-1 text-foreground">
              <FileText size={12} />
              {filesChanged > 0 ? `${filesChanged} ${t('patch.filesLabel')}` : '--'}
            </span>
            {showLineStats ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-600">
                  <Plus size={12} />
                  {selectedCommit.additions}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-600">
                  <Minus size={12} />
                  {selectedCommit.deletions}
                </span>
              </>
            ) : null}
          </div>
        </section>

        <section className="border-b border-border/60 px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('patch.summary')}
          </div>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground select-text">{message}</div>
          {isGitLoading && !commitDetails ? (
            <div className="mt-2 text-xs text-muted-foreground">{t('patch.loadingRepository')}</div>
          ) : null}
        </section>

        <section className="min-h-0 flex-1 px-4 py-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <FileText size={13} />
            {t('patch.changedFiles')}
          </div>

          {changedFiles.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {commitDetails ? t('patch.noChangedFiles') : t('patch.commitPlaceholder')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {changedFiles.map((file) => (
                <div
                  key={`${file.path}-${file.status}`}
                  className="rounded-md border border-border/60 bg-secondary/10 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground select-text">{file.path}</div>
                      {file.oldPath ? (
                        <div className="mt-1 truncate text-xs text-muted-foreground select-text">
                          {t('patch.previousPath')}: {file.oldPath}
                        </div>
                      ) : null}
                    </div>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', statusTone(file.status))}>
                      {file.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function MetaCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/10 px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 min-w-0 truncate text-sm font-medium text-foreground select-text">{value}</div>
    </div>
  );
}

function RefBadge({ refInfo }: { refInfo: GitCommitRef }) {
  const toneClass =
    refInfo.refType === 'head'
      ? 'border-primary/25 bg-primary/10 text-primary'
      : refInfo.refType === 'local'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
        : refInfo.refType === 'remote'
          ? 'border-sky-500/20 bg-sky-500/10 text-sky-600'
          : refInfo.refType === 'tag'
            ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
            : 'border-border/60 bg-secondary/20 text-muted-foreground';

  return <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', toneClass)}>{refInfo.name}</span>;
}

function statusTone(status: string) {
  if (status === 'Added') return 'bg-emerald-500/10 text-emerald-600';
  if (status === 'Deleted') return 'bg-rose-500/10 text-rose-600';
  if (status === 'Renamed') return 'bg-amber-500/10 text-amber-600';
  return 'bg-sky-500/10 text-sky-600';
}
