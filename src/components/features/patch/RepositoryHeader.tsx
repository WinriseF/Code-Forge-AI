import { GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildGitViewTitle, buildRepositorySubtitle } from '@/lib/git_insights';
import type {
  GitCommit,
  GitCommitDetails,
  GitInsightsViewMode,
  GitRepositorySummary,
} from '@/types/git';

interface RepositoryHeaderProps {
  repositorySummary: GitRepositorySummary | null;
  commits: GitCommit[];
  activeView: GitInsightsViewMode;
  baseHash: string;
  compareHash: string;
  commitDetails: GitCommitDetails | null;
  isGitLoading: boolean;
  gitError: string | null;
  onRefresh: () => void;
  canRefresh: boolean;
}

export function RepositoryHeader({
  repositorySummary,
  commits,
  activeView,
  baseHash,
  compareHash,
  commitDetails,
  isGitLoading,
  gitError,
  onRefresh,
  canRefresh,
}: RepositoryHeaderProps) {
  const { t } = useTranslation();
  const title = buildGitViewTitle(activeView, commits, baseHash, compareHash, commitDetails, {
    workingTree: t('patch.workingTree'),
    initialCommit: t('patch.initialCommit'),
  });
  const subtitle = buildRepositorySubtitle(repositorySummary, {
    staged: t('patch.staged'),
    unstaged: t('patch.unstaged'),
    untracked: t('patch.untracked'),
  });

  return (
    <div className="border-b border-border bg-background/90 backdrop-blur">
      <div className="flex items-start justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitBranch size={16} className="text-primary" />
            <span className="truncate">
              {repositorySummary?.repositoryName || t('patch.title')}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {subtitle || t('patch.repositoryIdle')}
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={!canRefresh || isGitLoading}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={isGitLoading ? 'animate-spin' : ''} />
          {t('workspace.rescan')}
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border/50 px-6 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {gitError
              ? t('common.errorMsg', { msg: gitError })
              : commitDetails?.message || repositorySummary?.lastCommitMessage || t('patch.noCommitMessage')}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {repositorySummary && (
            <>
              <StatBadge label={t('patch.staged')} value={repositorySummary.stagedChanges} tone="amber" />
              <StatBadge label={t('patch.unstaged')} value={repositorySummary.unstagedChanges} tone="blue" />
              <StatBadge label={t('patch.untracked')} value={repositorySummary.untrackedFiles} tone="green" />
            </>
          )}
          {isGitLoading && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              {t('patch.loadingRepository')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBadge({
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
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${toneClass}`}>
      <span>{label}</span>
      <span>{value}</span>
    </span>
  );
}
