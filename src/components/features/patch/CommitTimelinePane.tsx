import {
  forwardRef,
  useDeferredValue,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Clock3, GitBranch, GitCommitHorizontal, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildGitCommitGraphRows, filterGitCommitGraphRows, type GitCommitGraphRow } from '@/lib/git_graph';
import { cn } from '@/lib/utils';
import type { GitBranchRef, GitCommit } from '@/types/git';

interface CommitTimelinePaneProps {
  selectedBranch: GitBranchRef | null;
  commits: GitCommit[];
  selectedCommitHash: string | null;
  isGitLoading: boolean;
  isHistoryLoadingMore: boolean;
  hasMoreHistory: boolean;
  onSelectCommit: (hash: string) => void;
  onLoadMore: () => void;
}

const ROW_HEIGHT = 44;
const GRAPH_LANE_GAP = 14;
const GRAPH_X_PADDING = 12;
const GRAPH_CELL_MIN_WIDTH = 160;
const GRAPH_COLORS = ['#38bdf8', '#22c55e', '#f59e0b', '#f43f5e', '#a78bfa', '#14b8a6'];

const HistoryScroller = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function HistoryScroller(
  { className, ...props },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      data-testid="commit-timeline-scroll"
      className={cn('h-full overflow-y-auto custom-scrollbar', className)}
    />
  );
});

export function CommitTimelinePane({
  selectedBranch,
  commits,
  selectedCommitHash,
  isGitLoading,
  isHistoryLoadingMore,
  hasMoreHistory,
  onSelectCommit,
  onLoadMore,
}: CommitTimelinePaneProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const graphRows = useMemo(() => buildGitCommitGraphRows(commits), [commits]);
  const visibleRows = useMemo(() => filterGitCommitGraphRows(graphRows, deferredSearch), [graphRows, deferredSearch]);
  const graphWidth = useMemo(() => {
    const maxLaneCount = visibleRows.reduce((maxLane, row) => Math.max(maxLane, row.laneCount), 1);
    return Math.max(GRAPH_CELL_MIN_WIDTH, maxLaneCount * GRAPH_LANE_GAP + GRAPH_X_PADDING * 2 + 8);
  }, [visibleRows]);
  const gridTemplateColumns = `${240}px ${graphWidth}px minmax(460px,1fr) ${168}px ${156}px ${128}px`;
  const tableMinWidth = graphWidth + 1244;

  const handleSelectRow = (hash: string) => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString() ?? '' : '';
    if (selectedText) {
      return;
    }

    onSelectCommit(hash);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, hash: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectCommit(hash);
    }
  };

  const renderFooter = () => (
    <div className="flex h-11 items-center justify-center border-t border-border/50 px-4 text-xs text-muted-foreground">
      {isHistoryLoadingMore
        ? t('patch.loadingMoreCommits')
        : hasMoreHistory
          ? t('patch.scrollForMore')
          : t('patch.historyFullyLoaded')}
    </div>
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <GitCommitHorizontal size={11} />
              {t('patch.branchHistory')}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">
              {selectedBranch?.shortName || t('patch.noBranchSelected')}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {selectedBranch ? (
              <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-secondary/20 px-2.5 text-muted-foreground">
                <GitBranch size={13} />
                <span>{selectedBranch.branchType === 'remote' ? t('patch.remoteBranches') : t('patch.localBranches')}</span>
              </div>
            ) : null}
            <div className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background px-2.5 font-semibold text-foreground">
              {visibleRows.length}/{commits.length}
            </div>
          </div>
        </div>

        <div className="relative mt-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('patch.commitSearchPlaceholder')}
            className="h-9 w-full rounded-md border border-border/60 bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary/50"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {!selectedBranch ? (
          <EmptyState icon={<GitCommitHorizontal size={18} />} text={t('patch.noBranchSelected')} />
        ) : visibleRows.length === 0 ? (
          <EmptyState icon={<Clock3 size={18} />} text={t('patch.noCommits')} />
        ) : (
          <div className="h-full overflow-x-auto">
            <div className="flex h-full min-h-0 flex-col" style={{ minWidth: tableMinWidth }}>
              <div
                className="grid items-center gap-3 border-b border-border/60 bg-background/95 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                style={{ gridTemplateColumns }}
              >
                <div>{t('patch.branchTagColumn')}</div>
                <div>{t('patch.graphLabel')}</div>
                <div>{t('patch.commitMessageLabel')}</div>
                <div>{t('patch.author')}</div>
                <div>{t('patch.date')}</div>
                <div>{t('patch.sha')}</div>
              </div>

              <div className="min-h-0 flex-1">
                <Virtuoso
                  data={visibleRows}
                  style={{ height: '100%' }}
                  components={{
                    Scroller: HistoryScroller,
                    Footer: renderFooter,
                  }}
                  computeItemKey={(_, row) => row.commit.hash}
                  defaultItemHeight={ROW_HEIGHT}
                  increaseViewportBy={{ top: ROW_HEIGHT * 6, bottom: ROW_HEIGHT * 10 }}
                  endReached={() => {
                    if (hasMoreHistory && !isHistoryLoadingMore && !isGitLoading) {
                      onLoadMore();
                    }
                  }}
                  itemContent={(_, row) => {
                    const isSelected = selectedCommitHash === row.commit.hash;

                    return (
                      <div
                        role="button"
                        tabIndex={isGitLoading ? -1 : 0}
                        onClick={() => handleSelectRow(row.commit.hash)}
                        onKeyDown={(event) => handleKeyDown(event, row.commit.hash)}
                        className={cn(
                          'grid items-center gap-3 border-b border-border/50 px-4 text-left outline-none transition-colors',
                          isSelected
                            ? 'bg-primary/10 shadow-[inset_3px_0_0_0_rgba(59,130,246,0.95)]'
                            : 'hover:bg-secondary/20 focus:bg-secondary/20',
                          isGitLoading && 'cursor-wait opacity-70',
                        )}
                        style={{
                          gridTemplateColumns,
                          height: ROW_HEIGHT,
                        }}
                      >
                        <div className="min-w-0 overflow-hidden whitespace-nowrap">
                          {row.labels.length === 0 ? <span className="text-xs text-muted-foreground">--</span> : null}
                          {row.labels.slice(0, 4).map((label) => (
                            <RefBadge key={label.id} tone={label.tone} name={label.name} />
                          ))}
                          {row.labels.length > 4 ? (
                            <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              +{row.labels.length - 4}
                            </span>
                          ) : null}
                        </div>

                        <CommitGraphCell row={row} width={graphWidth} isSelected={isSelected} />

                        <div className="min-w-0 truncate text-sm font-medium text-foreground select-text">
                          {(row.commit.parentHashes?.length ?? 0) > 1 ? '[Merge] ' : ''}
                          {row.commit.message || row.commit.hash.slice(0, 7)}
                        </div>

                        <div className="truncate text-[12px] text-muted-foreground select-text">{row.commit.author}</div>
                        <div className="truncate text-[12px] text-muted-foreground select-text">{row.commit.date}</div>
                        <div className="truncate font-mono text-[12px] text-muted-foreground select-text">
                          {row.commit.hash.slice(0, 10)}
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <div className="rounded-xl border border-dashed border-border/70 bg-secondary/15 p-3">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

function CommitGraphCell({ row, width, isSelected }: { row: GitCommitGraphRow; width: number; isSelected: boolean }) {
  const laneX = (lane: number) => GRAPH_X_PADDING + lane * GRAPH_LANE_GAP;
  const colorForLane = (lane: number) => GRAPH_COLORS[lane % GRAPH_COLORS.length];
  const centerY = ROW_HEIGHT / 2;

  return (
    <div className="pointer-events-none select-none">
      <svg aria-hidden width={width} height={ROW_HEIGHT} viewBox={`0 0 ${width} ${ROW_HEIGHT}`} className="overflow-visible">
        {row.lanesBefore.map((lane) => (
          <line
            key={`before-${row.commit.hash}-${lane}`}
            x1={laneX(lane)}
            y1={-1}
            x2={laneX(lane)}
            y2={centerY}
            stroke={colorForLane(lane)}
            strokeWidth={1.5}
            strokeOpacity={0.92}
            strokeLinecap="round"
          />
        ))}

        {row.lanesAfter.map((lane) => (
          <line
            key={`after-${row.commit.hash}-${lane}`}
            x1={laneX(lane)}
            y1={centerY}
            x2={laneX(lane)}
            y2={ROW_HEIGHT + 1}
            stroke={colorForLane(lane)}
            strokeWidth={1.5}
            strokeOpacity={0.92}
            strokeLinecap="round"
          />
        ))}

        {row.primaryLane !== null && row.primaryLane !== row.lane ? (
          <path
            d={`M ${laneX(row.lane)} ${centerY} C ${laneX(row.lane)} ${centerY + 9}, ${laneX(row.primaryLane)} ${
              ROW_HEIGHT - 9
            }, ${laneX(row.primaryLane)} ${ROW_HEIGHT + 1}`}
            fill="none"
            stroke={colorForLane(row.primaryLane)}
            strokeWidth={1.5}
            strokeOpacity={0.96}
            strokeLinecap="round"
          />
        ) : null}

        {row.mergeToLanes
          .filter((lane) => lane !== row.lane)
          .map((lane) => (
            <path
              key={`merge-${row.commit.hash}-${lane}`}
              d={`M ${laneX(row.lane)} ${centerY} C ${laneX(lane)} ${centerY}, ${laneX(lane)} ${centerY + 9}, ${laneX(
                lane,
              )} ${ROW_HEIGHT + 1}`}
              fill="none"
              stroke={colorForLane(lane)}
              strokeWidth={1.5}
              strokeOpacity={0.96}
              strokeLinecap="round"
            />
          ))}

        <circle
          cx={laneX(row.lane)}
          cy={centerY}
          r={isSelected ? 5 : 4.4}
          fill={isSelected ? 'hsl(var(--primary))' : colorForLane(row.lane)}
          stroke="hsl(var(--background))"
          strokeWidth={isSelected ? 2.2 : 1.6}
        />
      </svg>
    </div>
  );
}

function RefBadge({ tone, name }: { tone: 'head' | 'local' | 'remote' | 'tag' | 'other'; name: string }) {
  const toneClass =
    tone === 'head'
      ? 'border-primary/25 bg-primary/10 text-primary'
      : tone === 'local'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
        : tone === 'remote'
          ? 'border-sky-500/20 bg-sky-500/10 text-sky-600'
          : tone === 'tag'
            ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
            : 'border-border/60 bg-secondary/20 text-muted-foreground';

  return (
    <span
      className={cn(
        'mr-1 inline-flex max-w-[108px] items-center truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold',
        toneClass,
      )}
    >
      {name}
    </span>
  );
}
