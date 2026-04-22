import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, GitBranch, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGitOpsStore } from '@/store/useGitOpsStore';
import { useTranslation } from 'react-i18next';
import type { GitBranchSummary } from './patch_types';

interface GitOpsPanelProps {
  projectRoot: string | undefined;
}

function defaultStashMessage(branchName: string | null | undefined) {
  return `WIP: on ${branchName || 'detached-head'}`;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function GitOpsPanel({ projectRoot }: GitOpsPanelProps) {
  const { t } = useTranslation();
  const isPanelOpen = useGitOpsStore((s) => s.isPanelOpen);
  const repoOverview = useGitOpsStore((s) => s.repoOverview);
  const branches = useGitOpsStore((s) => s.branches);
  const searchQuery = useGitOpsStore((s) => s.searchQuery);
  const isOverviewLoading = useGitOpsStore((s) => s.isOverviewLoading);
  const isBranchesLoading = useGitOpsStore((s) => s.isBranchesLoading);
  const isSwitching = useGitOpsStore((s) => s.isSwitching);
  const switchError = useGitOpsStore((s) => s.switchError);
  const closePanel = useGitOpsStore((s) => s.closePanel);
  const setSearchQuery = useGitOpsStore((s) => s.setSearchQuery);
  const searchBranches = useGitOpsStore((s) => s.searchBranches);
  const switchBranch = useGitOpsStore((s) => s.switchBranch);
  const clearSwitchError = useGitOpsStore((s) => s.clearSwitchError);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stashInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const skipInitialSearchRef = useRef(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingBranch, setPendingBranch] = useState<GitBranchSummary | null>(null);
  const [stashMessage, setStashMessage] = useState(defaultStashMessage(repoOverview?.current_branch));

  const isDirty = Boolean(
    repoOverview?.has_staged_changes || repoOverview?.has_unstaged_changes || repoOverview?.has_untracked_files,
  );
  const hasConflicts = Boolean(repoOverview?.conflicted_count);
  const isConfirming = pendingBranch !== null;

  useEffect(() => {
    if (!isPanelOpen || !projectRoot) {
      return;
    }

    if (skipInitialSearchRef.current) {
      skipInitialSearchRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void searchBranches(projectRoot, deferredSearchQuery);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [deferredSearchQuery, isPanelOpen, projectRoot, searchBranches]);

  useEffect(() => {
    startTransition(() => {
      setActiveIndex(0);
    });
  }, [branches]);

  useEffect(() => {
    if (!pendingBranch) {
      setStashMessage(defaultStashMessage(repoOverview?.current_branch));
    }
  }, [pendingBranch, repoOverview?.current_branch]);

  useEffect(() => {
    if (!isPanelOpen) {
      skipInitialSearchRef.current = true;
      setPendingBranch(null);
      setActiveIndex(0);
    }
  }, [isPanelOpen]);

  useEffect(() => {
    if (isPanelOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      return;
    }

    previousFocusRef.current?.focus();
  }, [isPanelOpen]);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (isConfirming) {
        stashInputRef.current?.focus();
        return;
      }

      searchInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isConfirming, isPanelOpen]);

  useEffect(() => {
    if (!listContainerRef.current || activeIndex < 0) {
      return;
    }

    const selected = listContainerRef.current.querySelector<HTMLElement>(`[data-branch-index="${activeIndex}"]`);
    selected?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleRequestSwitch = async (branch: GitBranchSummary) => {
    if (!projectRoot || isSwitching) {
      return;
    }

    clearSwitchError();
    if (branch.is_current) {
      closePanel();
      return;
    }
    if (hasConflicts) {
      return;
    }

    if (isDirty) {
      setPendingBranch(branch);
      setStashMessage(defaultStashMessage(repoOverview?.current_branch));
      return;
    }

    await switchBranch(projectRoot, branch, {
      stash_if_dirty: false,
      stash_message: null,
      create_tracking: branch.is_remote,
    });
  };

  const handleConfirmSwitch = async () => {
    if (!projectRoot || !pendingBranch) {
      return;
    }

    const result = await switchBranch(projectRoot, pendingBranch, {
      stash_if_dirty: true,
      stash_message: stashMessage.trim() || defaultStashMessage(repoOverview?.current_branch),
      create_tracking: pendingBranch.is_remote,
    });
    if (result?.success) {
      setPendingBranch(null);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isConfirming) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(branches.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter' && branches[activeIndex]) {
      event.preventDefault();
      void handleRequestSwitch(branches[activeIndex]);
    }
  };

  const handlePanelKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) {
      return;
    }

    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hasAttribute('disabled'))
      .filter((element) => element.tabIndex !== -1)
      .filter((element) => element.offsetParent !== null || element === document.activeElement);

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!activeElement || !panelRef.current.contains(activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const panelSubtitle = useMemo(() => {
    if (!repoOverview) {
      return null;
    }

    if (repoOverview.upstream_branch) {
      return `${repoOverview.upstream_branch} · ↑${repoOverview.ahead} ↓${repoOverview.behind}`;
    }

    if (isDirty) {
      return t('patch.gitOpsDirtyNotice', 'Local changes detected');
    }

    return null;
  }, [isDirty, repoOverview, t]);

  if (!isPanelOpen || !projectRoot) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120]">
      <button
        type="button"
        className="absolute inset-0 bg-black/48"
        onClick={closePanel}
        aria-label={t('patch.closeGitOpsPanel', 'Close git operations panel')}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDownCapture={handlePanelKeyDownCapture}
        className="absolute left-1/2 top-24 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-[0_18px_36px_rgba(0,0,0,0.28)] ring-1 ring-black/15"
      >
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GitBranch size={15} className="text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">
                  {t('patch.gitOpsTitle', 'Switch branch')}
                </span>
                {isOverviewLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {repoOverview?.current_branch
                    ?? t('patch.gitOpsDetachedHead', 'Detached HEAD')}
                </span>
                {panelSubtitle && <span>{panelSubtitle}</span>}
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={closePanel}
              aria-label={t('actions.close', 'Close')}
            >
              <X size={14} />
            </Button>
          </div>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => {
                const nextValue = event.target.value;
                startTransition(() => {
                  setSearchQuery(nextValue);
                });
              }}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={t('patch.gitOpsSearchPlaceholder', 'Search branches...')}
              className="h-10 w-full rounded-xl border border-border bg-background/80 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label={t('patch.clearBranchSearch', 'Clear branch search')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {switchError && (
          <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <AlertTriangle size={14} />
            <span>{switchError}</span>
          </div>
        )}

        {hasConflicts && (
          <div className="flex items-center gap-2 border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300">
            <AlertTriangle size={14} />
            <span>{t('patch.gitOpsResolveConflicts', 'Resolve conflicts before switching branches')}</span>
          </div>
        )}

        {isConfirming ? (
          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {t('patch.gitOpsConfirmTitle', 'Stash changes and switch?')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('patch.gitOpsConfirmDescription', {
                  defaultValue: 'The working tree has local changes. A stash will be created before switching to {{branch}}.',
                  branch: pendingBranch?.name ?? '',
                })}
              </p>
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('patch.gitOpsStashMessage', 'Stash message')}
              </span>
              <input
                ref={stashInputRef}
                type="text"
                value={stashMessage}
                onChange={(event) => setStashMessage(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background/80 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPendingBranch(null)} disabled={isSwitching}>
                {t('actions.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void handleConfirmSwitch()} disabled={isSwitching}>
                {isSwitching && <Loader2 size={14} className="mr-2 animate-spin" />}
                {t('patch.gitOpsConfirmAction', 'Stash and switch')}
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="max-h-[420px] overflow-y-auto px-2 py-2"
            ref={listContainerRef}
            onKeyDown={handleKeyDown}
            tabIndex={0}
          >
            {isBranchesLoading && branches.length === 0 ? (
              <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
                <Loader2 size={16} className="mr-2 animate-spin" />
                {t('patch.gitOpsLoadingBranches', 'Loading branches...')}
              </div>
            ) : branches.length === 0 ? (
              <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
                {t('patch.gitOpsNoBranches', 'No matching branches')}
              </div>
            ) : (
              branches.map((branch, index) => {
                const isActive = index === activeIndex;
                return (
                  <button
                    key={branch.full_refname}
                    type="button"
                    data-branch-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void handleRequestSwitch(branch)}
                    disabled={isSwitching}
                    className={[
                      'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                      isActive ? 'bg-secondary/80' : 'hover:bg-secondary/50',
                    ].join(' ')}
                  >
                    <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/70">
                      {branch.is_current ? <Check size={13} className="text-green-500" /> : <GitBranch size={13} className="text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{branch.name}</span>
                        {branch.is_current && (
                          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600 dark:text-green-300">
                            {t('patch.gitOpsCurrentBranch', 'Current')}
                          </span>
                        )}
                        {branch.is_remote && (
                          <span className="rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                            {t('patch.gitOpsRemoteBranch', 'Remote')}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {branch.upstream_name && <span>{branch.upstream_name} · ↑{branch.ahead} ↓{branch.behind}</span>}
                        {branch.head_short_hash && <span className="font-mono">{branch.head_short_hash}</span>}
                        {branch.last_commit_date && <span>{branch.last_commit_date}</span>}
                      </div>
                      {branch.last_commit_message && (
                        <p className="mt-1 truncate text-xs text-muted-foreground/90">{branch.last_commit_message}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
