import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRightLeft, GitBranch, GitCommitHorizontal, RadioTower, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getBranchDisplayName, splitBranchesByType } from '@/lib/git_insights';
import type { GitBranchRef } from '@/types/git';

interface BranchManagerViewProps {
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  isGitLoading: boolean;
  onSelectBranch: (branch: GitBranchRef) => void;
  onCheckoutBranch: (branch: GitBranchRef) => void;
  onOpenHistory: (branch: GitBranchRef) => void;
}

export function BranchManagerView({
  branches,
  selectedBranch,
  isGitLoading,
  onSelectBranch,
  onCheckoutBranch,
  onOpenHistory,
}: BranchManagerViewProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'local' | 'remote'>('all');

  const visibleBranches = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return branches.filter((branch) => {
      if (scope !== 'all' && branch.branchType !== scope) return false;
      if (!normalized) return true;
      const text = `${branch.shortName} ${branch.lastCommitMessage} ${branch.upstreamName || ''}`.toLowerCase();
      return text.includes(normalized);
    });
  }, [branches, scope, search]);

  const groupedBranches = useMemo(() => splitBranchesByType(visibleBranches), [visibleBranches]);
  const inspectedBranch = selectedBranch ?? visibleBranches[0] ?? null;

  return (
    <section className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <GitBranch size={11} />
              {t('patch.branchExplorer')}
              <span className="rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px]">{visibleBranches.length}</span>
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">{t('patch.branchManagerTitle')}</div>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/80 p-0.5">
            <ScopeButton active={scope === 'all'} label={t('patch.allBranches')} onClick={() => setScope('all')} />
            <ScopeButton active={scope === 'local'} label={t('patch.localBranches')} onClick={() => setScope('local')} />
            <ScopeButton active={scope === 'remote'} label={t('patch.remoteBranches')} onClick={() => setScope('remote')} />
          </div>
        </div>

        <div className="border-b border-border/60 px-3 py-2.5">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('patch.branchSearchPlaceholder')}
              className="h-9 w-full rounded-lg border border-border/60 bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
          <BranchSection
            title={t('patch.localBranches')}
            icon={<GitBranch size={12} />}
            branches={groupedBranches.local}
            selectedBranch={selectedBranch}
            onSelectBranch={onSelectBranch}
            emptyText={t('patch.noLocalBranches')}
            currentLabel={t('patch.current')}
            syncedLabel={t('patch.synced')}
          />
          <BranchSection
            title={t('patch.remoteBranches')}
            icon={<RadioTower size={12} />}
            branches={groupedBranches.remote}
            selectedBranch={selectedBranch}
            onSelectBranch={onSelectBranch}
            emptyText={t('patch.noRemoteBranches')}
            currentLabel={t('patch.current')}
            syncedLabel={t('patch.synced')}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95">
        {inspectedBranch ? (
          <>
            <div className="border-b border-border/60 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('patch.branchDetails')}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">
                  {inspectedBranch.branchType === 'remote' ? <RadioTower size={14} /> : <GitBranch size={14} />}
                </span>
                <h2 className="text-base font-semibold text-foreground">{getBranchDisplayName(inspectedBranch)}</h2>
                {inspectedBranch.isCurrent ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                    {t('patch.current')}
                  </span>
                ) : null}
                <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {inspectedBranch.branchType === 'remote' ? t('patch.remoteBranches') : t('patch.localBranches')}
                </span>
              </div>
            </div>

            <div className="grid gap-2 border-b border-border/60 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4">
              <DetailCard
                label={t('patch.scopeColumn')}
                value={inspectedBranch.branchType === 'remote' ? t('patch.remoteBranches') : t('patch.localBranches')}
              />
              <DetailCard label={t('patch.upstream')} value={inspectedBranch.upstreamName || t('patch.noUpstream')} />
              <DetailCard label={t('patch.syncStatus')} value={buildBranchSyncSummary(inspectedBranch, t)} />
              <DetailCard label={t('patch.date')} value={inspectedBranch.lastCommitDate || '--'} />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
              <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('patch.commitMessageLabel')}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {inspectedBranch.lastCommitMessage || t('patch.noCommitMessage')}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-border/60 bg-background p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('patch.sha')}
                </div>
                <div className="mt-2 font-mono text-sm text-foreground">{inspectedBranch.lastCommitHash.slice(0, 12)}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
              <button
                type="button"
                onClick={() => onOpenHistory(inspectedBranch)}
                disabled={isGitLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/75 px-3 text-xs font-semibold text-foreground transition-colors hover:border-primary/35 hover:text-primary disabled:opacity-50"
              >
                <GitCommitHorizontal size={13} />
                {t('patch.openHistory')}
              </button>

              {!inspectedBranch.isCurrent ? (
                <button
                  type="button"
                  onClick={() => onCheckoutBranch(inspectedBranch)}
                  disabled={isGitLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <ArrowRightLeft size={13} />
                  {inspectedBranch.branchType === 'local' ? t('patch.switchBranch') : t('patch.trackBranch')}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            {t('patch.selectedBranchHint')}
          </div>
        )}
      </div>
    </section>
  );
}

function ScopeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function BranchSection({
  title,
  icon,
  branches,
  selectedBranch,
  onSelectBranch,
  emptyText,
  currentLabel,
  syncedLabel,
}: {
  title: string;
  icon: ReactNode;
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  onSelectBranch: (branch: GitBranchRef) => void;
  emptyText: string;
  currentLabel: string;
  syncedLabel: string;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-1 flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {icon}
          {title}
        </div>
        <span>{branches.length}</span>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-1">
          {branches.map((branch) => {
            const isSelected =
              selectedBranch?.name === branch.name && selectedBranch?.branchType === branch.branchType;
            return (
              <button
                key={`${branch.branchType}:${branch.name}`}
                type="button"
                onClick={() => onSelectBranch(branch)}
                className={cn(
                  'flex h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left transition-colors',
                  isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/25',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-muted-foreground">
                    {branch.branchType === 'remote' ? <RadioTower size={13} /> : <GitBranch size={13} />}
                  </span>

                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{getBranchDisplayName(branch)}</span>
                    {branch.isCurrent ? (
                      <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                        {currentLabel}
                      </span>
                    ) : null}
                    {branch.upstreamName ? (
                      <span className="hidden max-w-[150px] truncate text-[11px] text-muted-foreground lg:inline">
                        {branch.upstreamName}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  {branch.ahead > 0 ? <span>↑{branch.ahead}</span> : null}
                  {branch.behind > 0 ? <span>↓{branch.behind}</span> : null}
                  {branch.ahead === 0 && branch.behind === 0 ? <span>{syncedLabel}</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/10 px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function buildBranchSyncSummary(branch: GitBranchRef, t: (key: string) => string) {
  if (branch.ahead === 0 && branch.behind === 0) {
    return t('patch.synced');
  }

  const parts: string[] = [];
  if (branch.ahead > 0) parts.push(`${t('patch.ahead')} ${branch.ahead}`);
  if (branch.behind > 0) parts.push(`${t('patch.behind')} ${branch.behind}`);
  return parts.join(' · ');
}
