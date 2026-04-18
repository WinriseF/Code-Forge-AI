import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { useGitGraphStore, BRANCH_COLORS, ROW_HEIGHT, WORKING_TREE_HASH } from '@/store/useGitGraphStore';
import { computeGitGraphLayout, type GitGraphEdgeLayout } from './gitGraphLayout';
import { CommitHoverCard } from './CommitHoverCard';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GraphCommit } from './patch_types';

const GRAPH_COLUMN_WIDTH = 124;
const GRAPH_CENTER_X = Math.round(GRAPH_COLUMN_WIDTH / 2);
const COMMIT_COLUMN_WIDTH = 16;
const DOT_RADIUS = 5;
const SELECTED_DOT_RADIUS = 6;
const COMPARE_TARGET_DOT_RADIUS = 6;

interface CommitGraphPanelProps {
  projectRoot: string | undefined;
}

export function CommitGraphPanel({ projectRoot }: CommitGraphPanelProps) {
  const commits = useGitGraphStore((s) => s.commits);
  const selectedCommitHash = useGitGraphStore((s) => s.selectedCommitHash);
  const loadCommits = useGitGraphStore((s) => s.loadCommits);
  const loadMoreCommits = useGitGraphStore((s) => s.loadMoreCommits);
  const selectCommit = useGitGraphStore((s) => s.selectCommit);
  const compareWith = useGitGraphStore((s) => s.compareWith);
  const hasMoreCommits = useGitGraphStore((s) => s.hasMoreCommits);
  const isLoading = useGitGraphStore((s) => s.isLoading);
  const isLoadingMore = useGitGraphStore((s) => s.isLoadingMore);
  const error = useGitGraphStore((s) => s.error);
  const isCompareView = useGitGraphStore((s) => s.isCompareView);
  const compareTargetHash = useGitGraphStore((s) => s.compareTargetHash);

  const { t } = useTranslation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(800);
  const [hoveredCommit, setHoveredCommit] = useState<GraphCommit | null>(null);
  const [hoverAnchorRect, setHoverAnchorRect] = useState<DOMRect | null>(null);

  const layout = useMemo(() => computeGitGraphLayout(commits), [commits]);
  const totalRows = commits.length + 1; // +1 for the working tree pseudo-row
  const totalHeight = totalRows * ROW_HEIGHT;
  const graphWidth = GRAPH_COLUMN_WIDTH;

  const laneToX = useCallback(
    (lane: number) => GRAPH_CENTER_X + lane * COMMIT_COLUMN_WIDTH,
    [],
  );

  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 2;
  const visibleEnd = Math.min(visibleStart + visibleCount, totalRows);
  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewHeight;

  const visibleEdges = useMemo(() => {
    return layout.edges.filter((edge) => {
      const top = (edge.fromRow + 1) * ROW_HEIGHT;
      const bottom = (edge.toRow + 2) * ROW_HEIGHT;
      return top < viewBottom && bottom > viewTop;
    });
  }, [layout.edges, viewBottom, viewTop]);

  const maybeLoadMore = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !projectRoot || isLoading || isLoadingMore || !hasMoreCommits) {
      return;
    }

    const threshold = ROW_HEIGHT * 8;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      void loadMoreCommits(projectRoot);
    }
  }, [hasMoreCommits, isLoading, isLoadingMore, loadMoreCommits, projectRoot]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
      setViewHeight(scrollRef.current.clientHeight);
      maybeLoadMore();
    }
  }, [maybeLoadMore]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewHeight(el.clientHeight);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    maybeLoadMore();
  }, [maybeLoadMore, commits.length]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && projectRoot) {
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
    (e: React.MouseEvent, hash: string) => {
      e.preventDefault();
      if (projectRoot) {
        void compareWith(hash, projectRoot);
      }
    },
    [projectRoot, compareWith],
  );

  useEffect(() => {
    if (projectRoot) {
      void loadCommits(projectRoot);
    }
  }, [projectRoot, loadCommits]);

  const openHoverCard = useCallback((commit: GraphCommit, target: HTMLElement) => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }

    setHoveredCommit(commit);
    setHoverAnchorRect(target.getBoundingClientRect());
  }, []);

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

  const buildEdgePath = (edge: GitGraphEdgeLayout): string => {
    const fromX = laneToX(edge.fromLane);
    const toX = laneToX(edge.toLane);
    const fromY = (edge.fromRow + 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
    const toY = (edge.toRow + 1) * ROW_HEIGHT + ROW_HEIGHT / 2;

    if (fromX === toX) {
      return `M${fromX},${fromY} L${toX},${toY}`;
    }

    const verticalDistance = Math.max(0, toY - fromY);
    const cornerRadius = Math.min(6, Math.abs(toX - fromX) / 2, Math.max(2, verticalDistance / 2 - 1));
    const direction = toX > fromX ? 1 : -1;
    const preferredTurnY = edge.isFirstParent
      ? toY - ROW_HEIGHT * 0.45
      : fromY + ROW_HEIGHT * 0.45;
    const turnY = Math.min(
      toY - cornerRadius - 1,
      Math.max(fromY + cornerRadius + 1, preferredTurnY),
    );

    if (turnY <= fromY + 1 || turnY >= toY - 1 || cornerRadius < 2) {
      const bendY = fromY + verticalDistance / 2;
      return `M${fromX},${fromY} L${fromX},${bendY} L${toX},${bendY} L${toX},${toY}`;
    }

    const startTurnX = fromX + direction * cornerRadius;
    const endTurnX = toX - direction * cornerRadius;

    return [
      `M${fromX},${fromY}`,
      `L${fromX},${turnY - cornerRadius}`,
      `Q${fromX},${turnY} ${startTurnX},${turnY}`,
      `L${endTurnX},${turnY}`,
      `Q${toX},${turnY} ${toX},${turnY + cornerRadius}`,
      `L${toX},${toY}`,
    ].join(' ');
  };

  const getLaneColor = (colorIndex: number) => BRANCH_COLORS[colorIndex % BRANCH_COLORS.length];

  if (isLoading && commits.length === 0) {
    return (
      <div className="w-[340px] min-w-[340px] border-r border-border bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">{t('patch.loadingCommits', 'Loading commits...')}</span>
        </div>
      </div>
    );
  }

  if (error && commits.length === 0) {
    return (
      <div className="w-[340px] min-w-[340px] border-r border-border bg-background flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="w-[340px] min-w-[340px] border-r border-border bg-background flex items-center justify-center">
        <span className="text-xs text-muted-foreground">{t('patch.noCommits', 'No commits yet')}</span>
      </div>
    );
  }

  return (
    <div className="w-[340px] min-w-[340px] border-r border-border bg-background flex flex-col">
      {error && commits.length > 0 && (
        <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="h-10 flex items-center justify-between px-3 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground">{t('patch.gitHistory', 'Git History')}</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          width={graphWidth}
          height={totalHeight}
          style={{ overflow: 'hidden' }}
        >
          {visibleEdges.map((edge) => (
            <path
              key={edge.id}
              d={buildEdgePath(edge)}
              stroke={getLaneColor(edge.colorIndex)}
              strokeWidth={edge.isFirstParent ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={edge.isFirstParent ? 0.95 : 0.82}
            />
          ))}
        </svg>

        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${visibleStart * ROW_HEIGHT}px)` }}>
            {renderRows()}
          </div>
        </div>
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

  function renderRows() {
    const rows: React.ReactNode[] = [];

    for (let i = visibleStart; i < visibleEnd; i++) {
      if (i === 0) {
        const isSelected = selectedCommitHash === WORKING_TREE_HASH;

        rows.push(
          <div
            key={WORKING_TREE_HASH}
            className={`group flex items-stretch cursor-pointer transition-colors border-l-2 ${
              isSelected
                ? 'border-l-primary'
                : 'border-l-transparent'
            }`}
            style={{ height: ROW_HEIGHT }}
            onClick={() => handleClick(WORKING_TREE_HASH)}
            onContextMenu={(e) => handleContextMenu(e, WORKING_TREE_HASH)}
          >
            <div className="shrink-0 relative" style={{ width: graphWidth }}>
              <FolderOpen
                size={16}
                className="text-orange-400 absolute top-1/2 -translate-y-1/2"
                style={{ left: `${laneToX(0) - 8}px` }}
              />
            </div>
            <div className={`flex-1 min-w-0 pr-3 flex items-center ${isSelected ? 'bg-secondary' : 'group-hover:bg-secondary/30'}`}>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate leading-tight text-orange-400">
                  {t('patch.workingTree', 'Working Tree')}
                </p>
                <span className="text-[10px] text-muted-foreground">{t('patch.unstagedChanges', 'Unstaged changes')}</span>
              </div>
            </div>
          </div>,
        );
        continue;
      }

      const commit = commits[i - 1];
      const node = layout.nodes.get(commit.hash);
      if (!node) continue;

      const isSelected = selectedCommitHash === commit.hash;
      const isCompareTarget = isCompareView && compareTargetHash === commit.hash;
      const laneColor = getLaneColor(node.colorIndex);
      const primaryRef = commit.refs.find((ref) => ref.kind !== 'RemoteBranch') ?? commit.refs[0];
      const extraRefCount = primaryRef ? commit.refs.length - 1 : 0;

      rows.push(
        <div
          key={commit.hash}
          className={`group flex items-stretch cursor-pointer transition-colors border-l-2 ${
            isSelected
              ? 'border-l-primary'
              : isCompareTarget
                ? 'border-l-yellow-500'
                : 'border-l-transparent'
          }`}
          style={{ height: ROW_HEIGHT }}
          onClick={() => handleClick(commit.hash)}
          onContextMenu={(e) => handleContextMenu(e, commit.hash)}
          onMouseEnter={(e) => openHoverCard(commit, e.currentTarget)}
          onMouseLeave={scheduleHoverClose}
        >
          <div className="shrink-0" style={{ width: graphWidth }}>
            <svg width={graphWidth} height={20} viewBox={`0 0 ${graphWidth} 20`}>
              <circle
                cx={laneToX(node.lane)}
                cy={10}
                r={isSelected ? SELECTED_DOT_RADIUS : isCompareTarget ? COMPARE_TARGET_DOT_RADIUS : DOT_RADIUS}
                fill={isCompareTarget ? '#eab308' : laneColor}
                stroke={isSelected ? 'hsl(var(--foreground))' : isCompareTarget ? '#ca8a04' : laneColor}
                strokeWidth={isSelected || isCompareTarget ? 2 : 0}
              />
            </svg>
          </div>

          <div
            className={`flex-1 min-w-0 pr-3 flex items-center ${
              isSelected
                ? 'bg-secondary'
                : isCompareTarget
                  ? 'bg-yellow-500/10'
                  : 'group-hover:bg-secondary/30'
            }`}
          >
            <div className="min-w-0">
              <p className="text-xs truncate leading-tight font-medium" title={commit.message}>
                {commit.message}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <span className="text-[10px] font-mono text-green-500">{commit.short_hash}</span>
                {primaryRef && (
                  <span
                    className={`shrink-0 text-[9px] leading-none px-1.5 py-[2px] rounded-full font-semibold ${
                      primaryRef.kind === 'Head'
                        ? 'bg-red-500/20 text-red-400'
                        : primaryRef.kind === 'Branch'
                          ? 'bg-blue-500/20 text-blue-400'
                          : primaryRef.kind === 'Tag'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {primaryRef.kind === 'Head' ? 'HEAD' : primaryRef.name}
                  </span>
                )}
                {extraRefCount > 0 && (
                  <span className="shrink-0 text-[9px] leading-none px-1.5 py-[2px] rounded-full font-semibold bg-secondary text-muted-foreground">
                    +{extraRefCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>,
      );
    }

    if (isLoadingMore) {
      rows.push(
        <div
          key="git-graph-loading-more"
          className="flex items-center justify-center text-[10px] text-muted-foreground"
          style={{ height: ROW_HEIGHT }}
        >
          {t('patch.loadingCommits', 'Loading commits...')}
        </div>,
      );
    }

    return rows;
  }
}
