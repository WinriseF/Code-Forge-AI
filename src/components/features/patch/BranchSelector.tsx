import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, GitBranch, RadioTower, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getBranchDisplayName, splitBranchesByType } from '@/lib/git_insights';
import type { GitBranchRef } from '@/types/git';

interface BranchSelectorProps {
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  disabled?: boolean;
  onSelect: (branch: GitBranchRef) => void;
}

export function BranchSelector({
  branches,
  selectedBranch,
  disabled,
  onSelect,
}: BranchSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredBranches = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return branches;
    return branches.filter((branch) => {
      const text = `${branch.shortName} ${branch.lastCommitMessage} ${branch.upstreamName || ''}`.toLowerCase();
      return text.includes(normalized);
    });
  }, [branches, search]);
  const groupedBranches = useMemo(() => splitBranchesByType(filteredBranches), [filteredBranches]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (branch: GitBranchRef) => {
    onSelect(branch);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="relative min-w-[190px] max-w-[240px]">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled}
        className={cn(
          'flex h-8 w-full items-center justify-between rounded-lg border border-border/70 bg-background/75 px-2.5 text-left text-sm transition-colors',
          'hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-50',
          isOpen && 'border-primary/50 ring-1 ring-primary/35',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground">
            {selectedBranch?.branchType === 'remote' ? <RadioTower size={13} /> : <GitBranch size={13} />}
          </span>
          <div className="truncate font-semibold text-foreground">
            {selectedBranch ? getBranchDisplayName(selectedBranch) : t('patch.noBranchSelected')}
          </div>
          {selectedBranch ? (
            <div className="rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {selectedBranch.branchType === 'remote' ? t('patch.remoteBranches') : t('patch.localBranches')}
            </div>
          ) : null}
        </div>
        <ChevronsUpDown size={13} className="ml-3 shrink-0 text-muted-foreground" />
      </button>

      {isOpen ? (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full z-30 mt-2 w-[320px] overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl"
        >
          <div className="border-b border-border/60 p-2.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('patch.branchSearchPlaceholder')}
                className="h-8 w-full rounded-lg border border-border/60 bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary/50"
              />
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto p-2 custom-scrollbar">
            <BranchSelectorSection
              title={t('patch.localBranches')}
              branches={groupedBranches.local}
              selectedBranch={selectedBranch}
              onSelect={handleSelect}
              currentLabel={t('patch.current')}
            />
            <BranchSelectorSection
              title={t('patch.remoteBranches')}
              branches={groupedBranches.remote}
              selectedBranch={selectedBranch}
              onSelect={handleSelect}
              currentLabel={t('patch.current')}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchSelectorSection({
  title,
  branches,
  selectedBranch,
  onSelect,
  currentLabel,
}: {
  title: string;
  branches: GitBranchRef[];
  selectedBranch: GitBranchRef | null;
  onSelect: (branch: GitBranchRef) => void;
  currentLabel: string;
}) {
  if (branches.length === 0) return null;

  return (
    <div className="mb-2 last:mb-0">
      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </div>

      <div className="space-y-1">
        {branches.map((branch) => {
          const isSelected =
            selectedBranch?.name === branch.name && selectedBranch?.branchType === branch.branchType;
          return (
            <button
              key={`${branch.branchType}:${branch.name}`}
              type="button"
              onClick={() => onSelect(branch)}
              className={cn(
                'flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left transition-colors',
                isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/25',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-muted-foreground">
                  {branch.branchType === 'remote' ? <RadioTower size={13} /> : <GitBranch size={13} />}
                </span>
                <span className="truncate text-sm font-medium text-foreground">{getBranchDisplayName(branch)}</span>
                {branch.isCurrent ? (
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                    {currentLabel}
                  </span>
                ) : null}
              </div>

              {isSelected ? <Check size={13} className="shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
