import { useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  Check,
  GitBranch,
  RadioTower,
  Search,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getBranchDisplayName, splitBranchesByType } from '@/lib/git_insights';
import type { GitBranchRef, GitRepositorySummary } from '@/types/git';

interface BranchSidebarProps {
  repositorySummary: GitRepositorySummary | null;
  workspaceRoot: string | null;
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  isGitLoading: boolean;
  onSelectBranch: (branch: GitBranchRef) => void;
  onCheckoutBranch: (branch: GitBranchRef) => void;
}

export function BranchSidebar({
  repositorySummary,
  workspaceRoot,
  branches,
  selectedBranch,
  isGitLoading,
  onSelectBranch,
  onCheckoutBranch,
}: BranchSidebarProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const normalized = search.trim().toLowerCase();
  const visibleBranches = normalized
    ? branches.filter((branch) => {
        const text = `${branch.shortName} ${branch.lastCommitMessage} ${branch.upstreamName || ''}`.toLowerCase();
        return text.includes(normalized);
      })
    : branches;
  const grouped = splitBranchesByType(visibleBranches);

  return (
    <aside className="flex h-full w-[312px] shrink-0 flex-col border-r border-border bg-[linear-gradient(180deg,rgba(148,163,184,0.09),rgba(15,23,42,0)_32%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]">
      <div className="border-b border-border bg-background/92 px-4 py-4 backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-2 text-primary">
            <GitBranch size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {t('patch.branchExplorer')}
            </div>
            <div className="mt-2 truncate text-base font-semibold text-foreground">
              {repositorySummary?.repositoryName || t('patch.selectRepository')}
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              {workspaceRoot || t('workspace.selectHint')}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/30 px-3 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles size={12} />
            {t('patch.currentBranch')}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              {repositorySummary?.branchName || t('patch.noBranchSelected')}
            </span>
            {repositorySummary?.isDirty ? (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600">
                {t('patch.uncommitted')}
              </span>
            ) : null}
          </div>
        </div>

        <div className="relative mt-4">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('patch.branchSearchPlaceholder')}
            className="h-10 w-full rounded-xl border border-border/60 bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
        <BranchSection
          title={t('patch.localBranches')}
          icon={<GitBranch size={12} />}
          branches={grouped.local}
          selectedBranch={selectedBranch}
          isGitLoading={isGitLoading}
          onSelectBranch={onSelectBranch}
          onCheckoutBranch={onCheckoutBranch}
          emptyText={t('patch.noLocalBranches')}
        />

        <BranchSection
          title={t('patch.remoteBranches')}
          icon={<RadioTower size={12} />}
          branches={grouped.remote}
          selectedBranch={selectedBranch}
          isGitLoading={isGitLoading}
          onSelectBranch={onSelectBranch}
          onCheckoutBranch={onCheckoutBranch}
          emptyText={t('patch.noRemoteBranches')}
        />
      </div>
    </aside>
  );
}

function BranchSection({
  title,
  icon,
  branches,
  selectedBranch,
  isGitLoading,
  onSelectBranch,
  onCheckoutBranch,
  emptyText,
}: {
  title: string;
  icon: ReactNode;
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  isGitLoading: boolean;
  onSelectBranch: (branch: GitBranchRef) => void;
  onCheckoutBranch: (branch: GitBranchRef) => void;
  emptyText: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {icon}
          {title}
        </div>
        <span className="text-[10px] text-muted-foreground">{branches.length}</span>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-secondary/15 px-3 py-4 text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-1.5">
          {branches.map((branch) => {
            const isSelected = selectedBranch?.name === branch.name && selectedBranch.branchType === branch.branchType;
            return (
              <div
                key={`${branch.branchType}:${branch.name}`}
                className={cn(
                  'rounded-2xl border p-3 transition-colors',
                  isSelected
                    ? 'border-primary/25 bg-primary/10 shadow-[0_8px_24px_-18px_rgba(59,130,246,0.65)]'
                    : 'border-transparent bg-background/50 hover:border-border/60 hover:bg-background',
                )}
              >
                <button type="button" onClick={() => onSelectBranch(branch)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {getBranchDisplayName(branch)}
                        </span>
                        {branch.isCurrent ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                            {t('patch.current')}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                        {branch.lastCommitMessage || t('patch.noCommitMessage')}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{branch.lastCommitDate || '--'}</span>
                        {branch.upstreamName ? <span>{branch.upstreamName}</span> : null}
                        {(branch.ahead > 0 || branch.behind > 0) && (
                          <span>
                            {t('patch.ahead')}: {branch.ahead} / {t('patch.behind')}: {branch.behind}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {branch.isCurrent ? (
                        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                          <Check size={12} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCheckoutBranch(branch);
                          }}
                          disabled={isGitLoading}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
                        >
                          <ArrowRightLeft size={12} />
                          {branch.branchType === 'local' ? t('patch.switchBranch') : t('patch.trackBranch')}
                        </button>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
