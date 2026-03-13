import { type ReactNode } from 'react';
import { ArrowRightLeft, GitBranch, GitCommitHorizontal, Loader2, RefreshCw, SplitSquareHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { buildRepositorySubtitle } from '@/lib/git_insights';
import type { GitBranchRef, GitRepositorySummary, GitWorkbenchTab } from '@/types/git';
import { BranchSelector } from './BranchSelector';

interface GitWorkbenchHeaderProps {
  repositorySummary: GitRepositorySummary | null;
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  activeTab: GitWorkbenchTab;
  gitError: string | null;
  canRefresh: boolean;
  onSelectBranch: (branch: GitBranchRef) => void;
  onCheckoutSelectedBranch: () => void;
  onSelectTab: (tab: GitWorkbenchTab) => void;
  onRefresh: () => void;
  isGitLoading: boolean;
}

export function GitWorkbenchHeader({
  repositorySummary,
  branches,
  selectedBranch,
  activeTab,
  gitError,
  canRefresh,
  onSelectBranch,
  onCheckoutSelectedBranch,
  onSelectTab,
  onRefresh,
  isGitLoading,
}: GitWorkbenchHeaderProps) {
  const { t } = useTranslation();
  const subtitle = buildRepositorySubtitle(repositorySummary, {
    staged: t('patch.staged'),
    unstaged: t('patch.unstaged'),
    untracked: t('patch.untracked'),
  });

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-secondary/20 text-muted-foreground">
            <GitBranch size={14} />
          </div>

          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-md border border-border/60 bg-secondary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t('patch.title')}
              </span>
              <span className="truncate text-sm font-semibold text-foreground">
                {repositorySummary?.repositoryName || t('patch.selectRepository')}
              </span>
              <span className="truncate text-xs text-muted-foreground">{subtitle || t('patch.repositoryIdle')}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
          <TabButton
            active={activeTab === 'history'}
            onClick={() => onSelectTab('history')}
            label={t('patch.historyTab')}
            icon={<GitCommitHorizontal size={14} />}
          />
          <TabButton
            active={activeTab === 'branches'}
            onClick={() => onSelectTab('branches')}
            label={t('patch.branchesTab')}
            icon={<GitBranch size={14} />}
          />
          <TabButton
            active={activeTab === 'compare'}
            onClick={() => onSelectTab('compare')}
            label={t('patch.compareTab')}
            icon={<SplitSquareHorizontal size={14} />}
          />
        </div>

        <BranchSelector
          branches={branches}
          selectedBranch={selectedBranch}
          onSelect={onSelectBranch}
          disabled={isGitLoading}
        />

        {selectedBranch && !selectedBranch.isCurrent ? (
          <button
            type="button"
            onClick={onCheckoutSelectedBranch}
            disabled={isGitLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/75 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary disabled:opacity-50"
          >
            <ArrowRightLeft size={13} />
            {t('patch.switchBranch')}
          </button>
        ) : null}

        {repositorySummary ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <MetricPill label={t('patch.staged')} value={repositorySummary.stagedChanges} tone="amber" />
            <MetricPill label={t('patch.unstaged')} value={repositorySummary.unstagedChanges} tone="blue" />
            <MetricPill label={t('patch.untracked')} value={repositorySummary.untrackedFiles} tone="green" />
          </div>
        ) : null}

        <button
          type="button"
          onClick={onRefresh}
          disabled={!canRefresh || isGitLoading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/75 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-50"
        >
          {isGitLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('workspace.rescan')}
        </button>
      </div>

      {gitError ? (
        <div className="border-t border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {t('common.errorMsg', { msg: gitError })}
        </div>
      ) : null}
    </header>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function MetricPill({
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
    <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-semibold', toneClass)}>
      {label}: {value}
    </span>
  );
}
