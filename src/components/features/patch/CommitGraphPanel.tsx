import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { useGitGraphStore, ROW_HEIGHT, WORKING_TREE_HASH } from '@/store/useGitGraphStore';
import { computeGitGraphLayout, type CommitRowViewModel } from './gitGraphLayout';
import { CommitHoverCard } from './CommitHoverCard';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GraphCommit } from './patch_types';

const SW = 11;
const CR = 5;
const CIRCLE_R = 4;
const GRAPH_COLUMN_WIDTH = 124;

function laneX(index: number) {
  return SW * (index + 1);
}

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
  const totalRows = commits.length + 1;
  const totalHeight = totalRows * ROW_HEIGHT;

  const visibleStart = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 2;
  const visibleEnd = Math.min(visibleStart + visibleCount, totalRows);

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
      if (e.key === 'Escape' && useGitGraphStore.getState().isCompareView && projectRoot) {
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
        const firstCommitX = layout.rows.length > 0 ? laneX(layout.rows[0].circleIndex) : laneX(0);

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
            <div className="shrink-0 relative" style={{ width: GRAPH_COLUMN_WIDTH, height: ROW_HEIGHT }}>
              <FolderOpen
                size={16}
                className="text-orange-400 absolute"
                style={{ left: `${firstCommitX - 8}px`, top: `${ROW_HEIGHT / 2 - 8}px` }}
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

      const row = layout.rows[i - 1];
      if (!row) continue;

      const commit = row.commit;
      const isSelected = selectedCommitHash === commit.hash;
      const isCompareTarget = isCompareView && compareTargetHash === commit.hash;
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
          <div className="shrink-0" style={{ width: GRAPH_COLUMN_WIDTH }}>
            {renderRowGraph(row, isSelected, isCompareTarget)}
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

function renderRowGraph(
  row: CommitRowViewModel,
  isSelected: boolean,
  isCompareTarget: boolean,
): React.ReactNode {
  const { commit, inputSwimlanes, outputSwimlanes, circleIndex, circleColor } = row;
  const midY = ROW_HEIGHT / 2;
  const elements: React.ReactNode[] = [];
  let key = 0;

  const lp = (color: string) => ({
    stroke: color,
    strokeWidth: 1,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
  });

  let outputIdx = 0;

  for (let i = 0; i < inputSwimlanes.length; i++) {
    const color = inputSwimlanes[i].color;
    const inputX = laneX(i);

    // Current commit in input swimlanes
    if (inputSwimlanes[i].id === commit.hash) {
      if (i !== circleIndex) {
        const circleX = laneX(circleIndex);
        // Arc from input position to circle (VS Code: large arc then horizontal)
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
    } else {
      // Continuing node
      if (
        outputIdx < outputSwimlanes.length &&
        inputSwimlanes[i].id === outputSwimlanes[outputIdx].id
      ) {
        if (i === outputIdx) {
          // Straight vertical
          elements.push(
            <path key={key++} d={`M ${inputX} 0 V ${ROW_HEIGHT}`} {...lp(color)} />,
          );
        } else {
          // Curved path (VS Code: V, arc, H, arc, V)
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
  }

  // Additional parents / merge (VS Code: two subpaths — horizontal to circle + arc down)
  for (let i = 1; i < commit.parent_hashes.length; i++) {
    // findLastIndex
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

    // Subpath 1: arc from parent left edge at midY down to parent center at bottom
    // Subpath 2: horizontal from parent left edge at midY to circle
    const d = [
      `M ${parentLeftEdge} ${midY}`,
      `A ${SW} ${midY} 0 0 1 ${parentCenter} ${ROW_HEIGHT}`,
      `M ${parentLeftEdge} ${midY}`,
      `H ${circleX}`,
    ].join(' ');
    elements.push(
      <path key={key++} d={d} {...lp(outputSwimlanes[parentOutIdx].color)} />,
    );
  }

  // Vertical line to circle (from above)
  const inputIndex = inputSwimlanes.findIndex((n) => n.id === commit.hash);
  if (inputIndex !== -1) {
    elements.push(
      <path
        key={key++}
        d={`M ${laneX(circleIndex)} 0 V ${midY}`}
        {...lp(inputSwimlanes[inputIndex].color)}
      />,
    );
  }

  // Vertical line from circle (to below)
  if (commit.parent_hashes.length > 0) {
    elements.push(
      <path
        key={key++}
        d={`M ${laneX(circleIndex)} ${midY} V ${ROW_HEIGHT}`}
        {...lp(circleColor)}
      />,
    );
  }

  // Circle node (VS Code style)
  const fill = isCompareTarget ? '#eab308' : circleColor;
  if (commit.parent_hashes.length > 1) {
    // Merge commit: outer circle + inner circle
    elements.push(
      <circle key={key++} cx={laneX(circleIndex)} cy={midY} r={CIRCLE_R + 2} fill={fill} strokeWidth={0} />,
      <circle key={key++} cx={laneX(circleIndex)} cy={midY} r={CIRCLE_R - 1} fill={fill} strokeWidth={0} />,
    );
  } else {
    // Regular node
    const r = isSelected || isCompareTarget ? CIRCLE_R + 2 : CIRCLE_R + 1;
    const stroke = isSelected ? 'hsl(var(--foreground))' : isCompareTarget ? '#ca8a04' : 'none';
    const sw = isSelected || isCompareTarget ? 2 : 0;
    elements.push(
      <circle key={key++} cx={laneX(circleIndex)} cy={midY} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />,
    );
  }

  return (
    <svg width={GRAPH_COLUMN_WIDTH} height={ROW_HEIGHT} viewBox={`0 0 ${GRAPH_COLUMN_WIDTH} ${ROW_HEIGHT}`}>
      {elements}
    </svg>
  );
}
