import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGitGraphStore, ROW_HEIGHT, WORKING_TREE_HASH } from '@/store/useGitGraphStore';
import { useGitOpsStore } from '@/store/useGitOpsStore';
import { computeGitGraphLayout, type CommitRowViewModel } from './gitGraphLayout';
import { CommitHoverCard } from './CommitHoverCard';
import { GitRefBadges } from './GitRefBadges';
import { GitOpsPanel } from './GitOpsPanel';
import {
  buildGitGraphDisplayCommits,
  isCollapsedStashCommit,
  isRawStashCommit,
} from './gitGraphDisplay';
import { ArrowDown, ArrowUp, FolderOpen, GitBranch, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DisplayGraphCommit, GraphCommit } from './patch_types';

const SW = 11;
const CR = 5;
const CIRCLE_R = 4;

function laneX(index: number) {
  return SW * (index + 1);
}

function rowSurfaceClass(isSelected: boolean, isCompareTarget: boolean) {
  if (isSelected) return 'bg-secondary';
  if (isCompareTarget) return 'bg-yellow-500/10';
  return 'group-hover:bg-secondary/30';
}

function rowBorderClass(isSelected: boolean, isCompareTarget: boolean) {
  if (isSelected) return 'border-l-primary';
  if (isCompareTarget) return 'border-l-yellow-500';
  return 'border-l-transparent';
}

function rowSvgWidth(row?: CommitRowViewModel<DisplayGraphCommit>) {
  if (!row) {
    return SW * 2;
  }

  return SW * (Math.max(row.inputSwimlanes.length, row.outputSwimlanes.length, 1) + 1);
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

interface CommitGraphPanelProps {
  projectRoot: string | undefined;
}

interface WorkingTreeRowProps {
  isSelected: boolean;
  isCompareTarget: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  svgWidth: number;
  title: string;
  subtitle: string;
}

const WorkingTreeRow = memo(function WorkingTreeRow({
  isSelected,
  isCompareTarget,
  onClick,
  onContextMenu,
  svgWidth,
  title,
  subtitle,
}: WorkingTreeRowProps) {
  const surfaceClass = rowSurfaceClass(isSelected, isCompareTarget);

  return (
    <div
      className={`group flex items-stretch cursor-pointer transition-colors border-l-2 ${rowBorderClass(isSelected, isCompareTarget)}`}
      style={{ height: ROW_HEIGHT }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div
        className={`shrink-0 relative flex items-center justify-center ${surfaceClass}`}
        style={{ width: svgWidth }}
      >
        <FolderOpen size={14} className="text-orange-400" />
      </div>
      <div className={`flex-1 min-w-0 pr-3 flex items-center ${surfaceClass}`}>
        <div className="min-w-0">
          <p className="text-xs font-medium truncate leading-tight text-orange-400">{title}</p>
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        </div>
      </div>
    </div>
  );
});

interface CommitGraphRowProps {
  row: CommitRowViewModel<DisplayGraphCommit>;
  isSelected: boolean;
  isCompareTarget: boolean;
  onClick: (hash: string) => void;
  onContextMenu: (event: React.MouseEvent, hash: string) => void;
  onOpenHover: (commit: DisplayGraphCommit, target: HTMLElement) => void;
  onCloseHover: () => void;
}

const CommitGraphRow = memo(function CommitGraphRow({
  row,
  isSelected,
  isCompareTarget,
  onClick,
  onContextMenu,
  onOpenHover,
  onCloseHover,
}: CommitGraphRowProps) {
  const { commit } = row;
  const surfaceClass = rowSurfaceClass(isSelected, isCompareTarget);

  return (
    <div
      className={`group flex items-stretch cursor-pointer transition-colors border-l-2 ${rowBorderClass(isSelected, isCompareTarget)}`}
      style={{ height: ROW_HEIGHT }}
      onClick={() => onClick(commit.hash)}
      onContextMenu={(event) => onContextMenu(event, commit.hash)}
      onMouseEnter={(event) => onOpenHover(commit, event.currentTarget)}
      onMouseLeave={onCloseHover}
    >
      <div className={`shrink-0 ${surfaceClass}`}>
        <CommitRowGraph row={row} isSelected={isSelected} isCompareTarget={isCompareTarget} />
      </div>

      <div className={`flex-1 min-w-0 pr-3 flex items-center ${surfaceClass}`}>
        <div className="min-w-0">
          <p className="text-xs truncate leading-tight font-medium" title={commit.message}>
            {commit.message}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0 overflow-hidden">
            <span className="text-[10px] font-mono text-green-500">{commit.short_hash}</span>
            {commit.refs.length > 0 && (
              <GitRefBadges refs={commit.refs} maxVisible={2} size="compact" wrap={false} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

interface CommitRowGraphProps {
  row: CommitRowViewModel<DisplayGraphCommit>;
  isSelected: boolean;
  isCompareTarget: boolean;
}

const CommitRowGraph = memo(function CommitRowGraph({
  row,
  isSelected,
  isCompareTarget,
}: CommitRowGraphProps) {
  const { commit, inputSwimlanes, outputSwimlanes, circleIndex, circleColor } = row;
  const midY = ROW_HEIGHT / 2;
  const elements: React.ReactNode[] = [];
  let key = 0;
  const isCollapsedStash = isCollapsedStashCommit(commit);

  const lp = (color: string, dashed = false) => ({
    stroke: color,
    strokeWidth: 1,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeDasharray: dashed ? '4 3' : undefined,
  });

  let outputIdx = 0;

  for (let i = 0; i < inputSwimlanes.length; i++) {
    const color = inputSwimlanes[i].color;
    const inputX = laneX(i);

    if (inputSwimlanes[i].id === commit.hash) {
      if (i !== circleIndex) {
        const circleX = laneX(circleIndex);
        const d = inputX > circleX
          ? [
              `M ${inputX} 0`,
              `A ${SW} ${midY} 0 0 1 ${inputX - SW} ${midY}`,
              `H ${circleX}`,
            ]
          : [
              `M ${inputX} 0`,
              `A ${SW} ${midY} 0 0 0 ${inputX + SW} ${midY}`,
              `H ${circleX}`,
            ];
        elements.push(<path key={key++} d={d.join(' ')} {...lp(color)} />);
      } else {
        outputIdx++;
      }
    } else if (
      outputIdx < outputSwimlanes.length &&
      inputSwimlanes[i].id === outputSwimlanes[outputIdx].id
    ) {
      if (i === outputIdx) {
        elements.push(
          <path key={key++} d={`M ${inputX} 0 V ${ROW_HEIGHT}`} {...lp(color)} />,
        );
      } else {
        const outputX = laneX(outputIdx);
        const goingLeft = inputX > outputX;
        const d = goingLeft
          ? [
              `M ${inputX} 0`,
              `V ${midY - CR}`,
              `A ${CR} ${CR} 0 0 1 ${inputX - CR} ${midY}`,
              `H ${outputX + CR}`,
              `A ${CR} ${CR} 0 0 0 ${outputX} ${midY + CR}`,
              `V ${ROW_HEIGHT}`,
            ]
          : [
              `M ${inputX} 0`,
              `V ${midY - CR}`,
              `A ${CR} ${CR} 0 0 0 ${inputX + CR} ${midY}`,
              `H ${outputX - CR}`,
              `A ${CR} ${CR} 0 0 1 ${outputX} ${midY + CR}`,
              `V ${ROW_HEIGHT}`,
            ];
        elements.push(<path key={key++} d={d.join(' ')} {...lp(color)} />);
      }
      outputIdx++;
    }
  }

  for (let i = 1; i < commit.parent_hashes.length; i++) {
    let parentOutIdx = -1;
    for (let j = outputSwimlanes.length - 1; j >= 0; j--) {
      if (outputSwimlanes[j].id === commit.parent_hashes[i]) {
        parentOutIdx = j;
        break;
      }
    }
    if (parentOutIdx === -1) continue;

    const parentLeftEdge = SW * parentOutIdx;
    const parentCenter = laneX(parentOutIdx);
    const circleX = laneX(circleIndex);

    const d = [
      `M ${parentLeftEdge} ${midY}`,
      `A ${SW} ${midY} 0 0 1 ${parentCenter} ${ROW_HEIGHT}`,
      `M ${parentLeftEdge} ${midY}`,
      `H ${circleX}`,
    ].join(' ');
    elements.push(
      <path key={key++} d={d} {...lp(outputSwimlanes[parentOutIdx].color, isCollapsedStash)} />,
    );
  }

  const inputIndex = inputSwimlanes.findIndex((node) => node.id === commit.hash);
  if (inputIndex !== -1) {
    elements.push(
      <path
        key={key++}
        d={`M ${laneX(circleIndex)} 0 V ${midY}`}
        {...lp(inputSwimlanes[inputIndex].color)}
      />,
    );
  }

  if (commit.parent_hashes.length > 0) {
    elements.push(
      <path
        key={key++}
        d={`M ${laneX(circleIndex)} ${midY} V ${ROW_HEIGHT}`}
        {...lp(circleColor, isCollapsedStash)}
      />,
    );
  }

  const fill = isCompareTarget ? '#eab308' : circleColor;
  const isStash = commit.refs.some((r) => r.kind === 'Stash');

  if (isCollapsedStash) {
    const cx = laneX(circleIndex);
    const sz = isSelected || isCompareTarget ? 8 : 7;
    const stroke = isCompareTarget ? '#eab308' : circleColor;
    const accentStroke = isSelected ? 'hsl(var(--foreground))' : stroke;
    elements.push(
      <rect
        key={key++}
        x={cx - sz}
        y={midY - sz}
        width={sz * 2}
        height={sz * 2}
        rx={2}
        fill="hsl(var(--background))"
        stroke={accentStroke}
        strokeWidth={isSelected ? 2 : 1.5}
        strokeDasharray="3 2"
      />,
      <rect
        key={key++}
        x={cx - 3}
        y={midY - 3}
        width={6}
        height={6}
        rx={1}
        fill={fill}
        strokeWidth={0}
      />,
    );
  } else if (isStash) {
    const sz = isSelected || isCompareTarget ? 7 : 6;
    const cx = laneX(circleIndex);
    const stroke = isSelected ? 'hsl(var(--foreground))' : isCompareTarget ? '#ca8a04' : 'none';
    const sw = isSelected || isCompareTarget ? 2 : 0;
    elements.push(
      <rect key={key++} x={cx - sz} y={midY - sz} width={sz * 2} height={sz * 2} rx={1} fill={fill} stroke={stroke} strokeWidth={sw} />,
    );
  } else if (commit.parent_hashes.length > 1) {
    elements.push(
      <circle key={key++} cx={laneX(circleIndex)} cy={midY} r={CIRCLE_R + 2} fill={fill} strokeWidth={0} />,
      <circle key={key++} cx={laneX(circleIndex)} cy={midY} r={CIRCLE_R - 1} fill="hsl(var(--background))" strokeWidth={0} />,
    );
  } else {
    const r = isSelected || isCompareTarget ? CIRCLE_R + 2 : CIRCLE_R + 1;
    const stroke = isSelected ? 'hsl(var(--foreground))' : isCompareTarget ? '#ca8a04' : 'none';
    const sw = isSelected || isCompareTarget ? 2 : 0;
    elements.push(
      <circle key={key++} cx={laneX(circleIndex)} cy={midY} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />,
    );
  }

  const width = rowSvgWidth(row);

  return (
    <svg width={width} height={ROW_HEIGHT} viewBox={`0 0 ${width} ${ROW_HEIGHT}`}>
      {elements}
    </svg>
  );
});

export function CommitGraphPanel({ projectRoot }: CommitGraphPanelProps) {
  const commits = useGitGraphStore((s) => s.commits);
  const commitSearchQuery = useGitGraphStore((s) => s.commitSearchQuery);
  const selectedCommitHash = useGitGraphStore((s) => s.selectedCommitHash);
  const loadCommits = useGitGraphStore((s) => s.loadCommits);
  const loadMoreCommits = useGitGraphStore((s) => s.loadMoreCommits);
  const selectCommit = useGitGraphStore((s) => s.selectCommit);
  const compareWith = useGitGraphStore((s) => s.compareWith);
  const hasMoreCommits = useGitGraphStore((s) => s.hasMoreCommits);
  const isLoading = useGitGraphStore((s) => s.isLoading);
  const isLoadingMore = useGitGraphStore((s) => s.isLoadingMore);
  const error = useGitGraphStore((s) => s.error);
  const compareTargetHash = useGitGraphStore((s) => s.compareTargetHash);
  const repoOverview = useGitOpsStore((s) => s.repoOverview);
  const isPanelOpen = useGitOpsStore((s) => s.isPanelOpen);
  const isOverviewLoading = useGitOpsStore((s) => s.isOverviewLoading);
  const fetchOverview = useGitOpsStore((s) => s.fetchOverview);
  const openPanel = useGitOpsStore((s) => s.openPanel);

  const { t } = useTranslation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(800);
  const [hoveredCommit, setHoveredCommit] = useState<GraphCommit | null>(null);
  const [hoverAnchorRect, setHoverAnchorRect] = useState<DOMRect | null>(null);
  const [searchInput, setSearchInput] = useState(commitSearchQuery);
  const debouncedSearchInput = useDebounce(searchInput, 250);
  const rawCommitByHash = useMemo(() => new Map(commits.map((commit) => [commit.hash, commit])), [commits]);
  const displayCommits = useMemo(() => buildGitGraphDisplayCommits(commits), [commits]);

  const layout = useMemo(() => computeGitGraphLayout(displayCommits), [displayCommits]);
  const totalRows = displayCommits.length + 1;
  const totalHeight = totalRows * ROW_HEIGHT;
  const workingTreeWidth = layout.rows[0] ? rowSvgWidth(layout.rows[0]) : SW * 2;

  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 2;
  const visibleEnd = Math.min(visibleStart + visibleCount, totalRows);
  const visibleCommitRows = useMemo(() => {
    const commitStart = Math.max(visibleStart - 1, 0);
    const commitEnd = Math.max(visibleEnd - 1, 0);
    return layout.rows.slice(commitStart, commitEnd);
  }, [layout.rows, visibleEnd, visibleStart]);

  const workingTreeTitle = t('patch.workingTree', 'Working Tree');
  const unstagedChangesLabel = t('patch.unstagedChanges', 'Unstaged changes');
  const loadingCommitsLabel = t('patch.loadingCommits', 'Loading commits...');
  const commitSearchPlaceholder = t('patch.commitSearchPlaceholder', 'Search by message or hash...');

  const maybeLoadMore = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !projectRoot || isLoading || isLoadingMore || !hasMoreCommits || commits.length === 0) {
      return;
    }

    const threshold = ROW_HEIGHT * 8;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      void loadMoreCommits(projectRoot);
    }
  }, [commits.length, hasMoreCommits, isLoading, isLoadingMore, loadMoreCommits, projectRoot]);

  const flushScrollState = useCallback(() => {
    scrollFrameRef.current = null;
    const nextScrollTop = latestScrollTopRef.current;
    setScrollTop((current) => (current === nextScrollTop ? current : nextScrollTop));
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    latestScrollTopRef.current = el.scrollTop;
    if (scrollFrameRef.current === null) {
      scrollFrameRef.current = window.requestAnimationFrame(flushScrollState);
    }
    maybeLoadMore();
  }, [flushScrollState, maybeLoadMore]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const syncHeight = () => {
      const nextHeight = el.clientHeight;
      setViewHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    syncHeight();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    maybeLoadMore();
  }, [maybeLoadMore, commits.length]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && useGitGraphStore.getState().compareTargetHash && projectRoot) {
        useGitGraphStore.getState().cancelCompare(projectRoot);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [projectRoot]);

  const handleClick = useCallback(
    (hash: string) => {
      if (projectRoot) {
        void selectCommit(hash, projectRoot);
      }
    },
    [projectRoot, selectCommit],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, hash: string) => {
      event.preventDefault();
      const commit = rawCommitByHash.get(hash);
      if (isRawStashCommit(commit)) {
        useGitGraphStore.setState({
          error: t('patch.stashCompareUnsupported', 'Collapsed stash diffs cannot be compared yet'),
        });
        return;
      }
      if (projectRoot) {
        void compareWith(hash, projectRoot);
      }
    },
    [compareWith, projectRoot, rawCommitByHash, t],
  );

  useEffect(() => {
    setSearchInput(commitSearchQuery);
  }, [commitSearchQuery]);

  useEffect(() => {
    if (projectRoot) {
      void loadCommits(projectRoot, debouncedSearchInput);
    }
  }, [debouncedSearchInput, projectRoot, loadCommits]);

  useEffect(() => {
    if (projectRoot) {
      void fetchOverview(projectRoot);
    }
  }, [fetchOverview, projectRoot]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    el.scrollTop = 0;
    latestScrollTopRef.current = 0;
    setScrollTop(0);
  }, [commitSearchQuery, projectRoot]);

  const openHoverCard = useCallback((commit: GraphCommit, target: HTMLElement) => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }

    setHoveredCommit(rawCommitByHash.get(commit.hash) ?? commit);
    setHoverAnchorRect(target.getBoundingClientRect());
  }, [rawCommitByHash]);

  const scheduleHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
    }

    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredCommit(null);
      setHoverAnchorRect(null);
      hoverCloseTimerRef.current = null;
    }, 140);
  }, []);

  const keepHoverOpen = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const branchButtonLabel = repoOverview?.current_branch
    ?? (repoOverview?.is_detached_head ? t('patch.gitOpsDetachedHead', 'Detached HEAD') : t('patch.gitOpsBranchUnknown', 'Branch'));

  return (
    <div className="w-full h-full bg-background flex flex-col">
      {error && commits.length > 0 && (
        <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="min-h-6 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-muted-foreground">{t('patch.gitHistory', 'Git History')}</span>
          <button
            type="button"
            onClick={() => projectRoot && void openPanel(projectRoot)}
            disabled={!projectRoot}
            className="inline-flex min-w-0 max-w-[62%] items-center gap-2 rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-secondary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch size={12} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-semibold">{branchButtonLabel}</span>
            {repoOverview?.upstream_branch && (
              <span className="shrink-0 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                  <ArrowUp size={10} strokeWidth={2.2} />
                  {repoOverview.ahead}
                </span>
                <span className="inline-flex items-center gap-0.5 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                  <ArrowDown size={10} strokeWidth={2.2} />
                  {repoOverview.behind}
                </span>
              </span>
            )}
            {isOverviewLoading && <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />}
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={commitSearchPlaceholder}
            className="h-8 w-full rounded-md border border-border bg-secondary/30 pl-9 pr-9 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={t('patch.clearCommitSearch', 'Clear search')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {isPanelOpen && <GitOpsPanel projectRoot={projectRoot} />}

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {isLoading && commits.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">{loadingCommitsLabel}</span>
            </div>
          </div>
        ) : error && commits.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-xs text-destructive text-center">{error}</p>
          </div>
        ) : commits.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <span className="text-xs text-muted-foreground">
              {commitSearchQuery
                ? t('patch.noMatchingCommits', 'No matching commits')
                : t('patch.noCommits', 'No commits yet')}
            </span>
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${visibleStart * ROW_HEIGHT}px)` }}>
              {visibleStart === 0 && (
                <WorkingTreeRow
                  isSelected={selectedCommitHash === WORKING_TREE_HASH}
                  isCompareTarget={compareTargetHash === WORKING_TREE_HASH}
                  onClick={() => handleClick(WORKING_TREE_HASH)}
                  onContextMenu={(event) => handleContextMenu(event, WORKING_TREE_HASH)}
                  svgWidth={workingTreeWidth}
                  title={workingTreeTitle}
                  subtitle={unstagedChangesLabel}
                />
              )}

              {visibleCommitRows.map((row) => (
                <CommitGraphRow
                  key={row.commit.hash}
                  row={row}
                  isSelected={selectedCommitHash === row.commit.hash}
                  isCompareTarget={compareTargetHash === row.commit.hash}
                  onClick={handleClick}
                  onContextMenu={handleContextMenu}
                  onOpenHover={openHoverCard}
                  onCloseHover={scheduleHoverClose}
                />
              ))}

              {isLoadingMore && (
                <div
                  key="git-graph-loading-more"
                  className="flex items-center justify-center text-[10px] text-muted-foreground"
                  style={{ height: ROW_HEIGHT }}
                >
                  {loadingCommitsLabel}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <CommitHoverCard
        anchorRect={hoverAnchorRect}
        commit={hoveredCommit}
        isOpen={hoveredCommit !== null}
        onMouseEnter={keepHoverOpen}
        onMouseLeave={scheduleHoverClose}
      />
    </div>
  );
}
