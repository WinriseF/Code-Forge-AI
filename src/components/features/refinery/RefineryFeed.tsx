import { useRefineryStore } from '@/store/useRefineryStore';
import { formatTimeAgo } from '@/lib/refinery_utils';
import { useAppStore } from '@/store/useAppStore';
import { MoreHorizontal, Pin, Image as ImageIcon, FileText, Loader2, Filter, X, PenTool, Edit3, Copy, Check, Globe, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useImageLoader } from '@/hooks/useImageLoader';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LangKey } from '@/i18n/config';
import { GroupedVirtuoso } from 'react-virtuoso';
import { useMemo, useCallback, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { bundleItems, FeedItemType } from '@/lib/bundler';
import { BundleCard } from './BundleCard';
import { AnimatedEmptyState } from '@/components/ui/AnimatedEmptyState';

const REFINERY_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-refinery|';

export function RefineryFeed() {
  const { t } = useTranslation();
  const {
    items, setActiveId, activeId, togglePin, isLoading, hasMore,
    searchQuery, dateRange, kindFilter, pinnedOnly, manualOnly,
    setSearchQuery, resetDateFilter, setKindFilter, togglePinnedOnly, toggleManualOnly,
    loadHistory
  } = useRefineryStore(
    useShallow((state) => ({
      items: state.items,
      setActiveId: state.setActiveId,
      activeId: state.activeId,
      togglePin: state.togglePin,
      isLoading: state.isLoading,
      hasMore: state.hasMore,
      searchQuery: state.searchQuery,
      dateRange: state.dateRange,
      kindFilter: state.kindFilter,
      pinnedOnly: state.pinnedOnly,
      manualOnly: state.manualOnly,
      setSearchQuery: state.setSearchQuery,
      resetDateFilter: state.resetDateFilter,
      setKindFilter: state.setKindFilter,
      togglePinnedOnly: state.togglePinnedOnly,
      toggleManualOnly: state.toggleManualOnly,
      loadHistory: state.loadHistory,
    })),
  );
  const language = useAppStore((state) => state.language);

  // 判断是否有活跃的筛选
  const hasActiveFilter = searchQuery.trim() !== '' || dateRange.start !== null || dateRange.end !== null || kindFilter !== 'all' || pinnedOnly || manualOnly;

  // 清除所有筛选
  const clearAllFilters = () => {
    setSearchQuery('');
    resetDateFilter();
    setKindFilter('all');
    if (pinnedOnly) {
      togglePinnedOnly();
    }
    if (manualOnly) {
      toggleManualOnly();
    }
  };

  // 将 items 先进行折叠，再按日期分组，使用 useMemo 优化性能
  const { groups, flatFeedItems, groupCounts } = useMemo(() => {
    // 1. 先进行折叠 (Bundling)
    const bundledItems = bundleItems(items);

    const groupMap = new Map<string, FeedItemType[]>();

    // 2. 按日期分组 (注意时间戳获取方式)
    bundledItems.forEach(feedItem => {
      const ts = feedItem.type === 'single' ? feedItem.item.updatedAt : feedItem.timestamp;
      const dateKey = getDateKey(ts, language, t);
      if (!groupMap.has(dateKey)) {
        groupMap.set(dateKey, []);
      }
      groupMap.get(dateKey)!.push(feedItem);
    });

    // 3. 排序
    const sortedGroups = Array.from(groupMap.entries())
      .map(([dateKey, items]) => ({ dateKey, items }))
      .sort((a, b) => {
        const getTs = (i: FeedItemType) => i.type === 'single' ? i.item.updatedAt : i.timestamp;
        return getTs(b.items[0]) - getTs(a.items[0]);
      });

    // 4. 展平
    const flat: FeedItemType[] = [];
    const counts: number[] = [];
    sortedGroups.forEach(group => {
      flat.push(...group.items);
      counts.push(group.items.length);
    });

    return {
      groups: sortedGroups,
      flatFeedItems: flat,
      groupCounts: counts
    };
  }, [items, language]);

  // 无限滚动加载更多
  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      loadHistory(false);
    }
  }, [isLoading, hasMore, loadHistory]);

  // 获取分组索引
  const getGroupIndex = useCallback((itemIndex: number) => {
    let count = 0;
    for (let i = 0; i < groupCounts.length; i++) {
      count += groupCounts[i];
      if (itemIndex < count) {
        return i;
      }
    }
    return groupCounts.length - 1;
  }, [groupCounts]);

  return (
    <div className="flex-1 h-full bg-background py-8">
      <div className="max-w-3xl mx-auto px-6 h-full flex flex-col">
        {/* Filter indicator bar */}
        {hasActiveFilter && (
          <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg mb-4 shrink-0">
            <div className="flex items-center gap-2 text-xs text-primary">
              <Filter size={12} />
              <span>{t('refinery.filteredResults')}</span>
              <span className="text-muted-foreground">({items.length} {items.length === 1 ? 'item' : 'items'})</span>
            </div>
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <X size={12} />
              {t('refinery.clearAll')}
            </button>
          </div>
        )}

        {/* Virtual list */}
        {items.length === 0 ? (
          hasActiveFilter ? (
            <AnimatedEmptyState
              title={t('refinery.noResults')}
              className="flex-1"
              animationClassName="h-64 w-64"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/30 gap-6">
              <div className="w-20 h-20 rounded-2xl bg-secondary/20 flex items-center justify-center border border-dashed border-border">
                <FileText size={32} />
              </div>
              <p className="text-sm italic">{t('refinery.waitingForFirstCopy')}</p>
            </div>
          )
        ) : (
          <div className="flex-1 min-h-0">
            <GroupedVirtuoso
              style={{ height: '100%' }}
              groupCounts={groupCounts}
              groupContent={index => {
                const group = groups[index];
                if (!group) return null;
                return (
                  <div className="sticky top-0 z-[100] bg-background/95 backdrop-blur-sm py-2 border-b border-border/30">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                      {group.dateKey}
                    </span>
                  </div>
                );
              }}
              itemContent={index => {
                const feedItem = flatFeedItems[index];
                const groupIndex = getGroupIndex(index);
                const isFirstInGroup = index === groupCounts.slice(0, groupIndex).reduce((a, b) => a + b, 0);

                return (
                  <div className={cn(isFirstInGroup ? 'mt-4' : '')}>
                    {feedItem.type === 'single' ? (
                      <FeedCard
                        item={feedItem.item}
                        isActive={activeId === feedItem.item.id}
                          onClick={() => setActiveId(feedItem.item.id)}
                          onTogglePin={(e) => {
                            e.stopPropagation();
                            void togglePin(feedItem.item.id);
                          }}
                        />
                    ) : (
                      <BundleCard
                        key={feedItem.id}
                        items={feedItem.items}
                        activeId={activeId}
                        onItemClick={setActiveId}
                        onTogglePin={(id) => {
                          void togglePin(id);
                        }}
                        FeedCardComponent={FeedCard}
                      />
                    )}
                  </div>
                );
              }}
              endReached={loadMore}
              components={{
                Footer: () => {
                  return (
                    <div className={cn("py-4 flex justify-center", !isLoading && items.length > 0 ? "opacity-0" : "")}>
                      <Loader2 size={24} className={cn("animate-spin text-primary/50", !isLoading && "hidden")} />
                    </div>
                  );
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// FeedCard 作为组件引用传给 BundleCard 使用，增加 extraBadge 和 className 参数
function FeedCard({
  item,
  isActive,
  onClick,
  onTogglePin,
  extraBadge,
  className
}: {
  item: any;
  isActive: boolean;
  onClick: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  extraBadge?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const language = useAppStore((state) => state.language);
  const loadItemDetail = useRefineryStore((state) => state.loadItemDetail);
  // 智能判断图片路径：image 类型取 content，mixed 类型取 metaParsed.image_path
  const imagePath = item.kind === 'image' ? item.content : item.metaParsed?.image_path;
  const isImageOrMixed = item.kind === 'image' || item.kind === 'mixed';
  const { imageUrl, isLoading, error } = useImageLoader(imagePath);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  // 复制完整内容
  const handleQuickCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCopying(true);
    try {
      if (item.kind === 'text' || item.kind === 'mixed') {
        // 如果 content 为空，先加载完整内容
        let contentToCopy = item.content;
        if (!contentToCopy) {
          await loadItemDetail(item.id);
          // 重新获取 store 中的最新 item
          const { items } = useRefineryStore.getState();
          const updatedItem = items.find(i => i.id === item.id);
          contentToCopy = updatedItem?.content;
        }
        if (!contentToCopy) {
          console.warn('Content not loaded, cannot copy');
          return;
        }
        await invoke(`${REFINERY_PLUGIN_PREFIX}copy_refinery_text`, { text: contentToCopy });
      } else if (item.kind === 'image') {
        await invoke(`${REFINERY_PLUGIN_PREFIX}copy_refinery_image`, { imagePath: item.content });
      }
      setCopySuccess(true);
    } catch (err) {
      console.error('Failed to copy:', err);
    } finally {
      setIsCopying(false);
    }
  };

  // 复制成功反馈 2 秒后重置
  useEffect(() => {
    if (copySuccess) {
      const timer = setTimeout(() => setCopySuccess(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copySuccess]);

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative bg-card border rounded-xl p-4 cursor-pointer transition-all duration-200 hover:border-primary/40 hover:shadow-md',
        // 如果没有传入 className，则使用默认的 mb-4，否则使用传入的
        className ? className : 'mb-4',
        isActive ? 'border-primary/60 ring-1 ring-primary/20 shadow-md' : 'border-border/60',
        // 手动笔记使用不同的背景色
        item.isManual && 'bg-gradient-to-br from-primary/5 to-transparent'
      )}
    >
      {/* Manual Note indicator */}
      {item.isManual && (
        <div className="absolute -top-1 left-4 px-1.5 py-0.5 bg-blue-500 rounded-b-sm flex items-center gap-0.5 shadow-sm z-10">
          <PenTool size={8} className="text-white" />
        </div>
      )}

      {/* Time & Source Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/70 font-medium">
            {formatTimeAgo(item.updatedAt, language)}
          </span>
          {/* 来源/类型标识 */}
          <div className="flex items-center gap-1">
            {item.isManual ? (
              <span className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded border border-blue-500/20 flex items-center gap-1">
                <PenTool size={8} />
                {t('refinery.note')}
              </span>
            ) : item.sourceApp ? (
              <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground/80 border border-border/30">
                {item.sourceApp}
              </span>
            ) : null}
            {item.url && (
              <button
                onClick={() => item.url && open(item.url)}
                className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 flex items-center gap-1 hover:bg-primary/20 transition-colors max-w-[150px] truncate"
                title={item.url}
              >
                <Globe size={8} />
                {item.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
              </button>
            )}
            {item.isEdited && !item.isManual && (
              <span className="text-[10px] bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded border border-orange-500/20 flex items-center gap-1">
                <Edit3 size={8} />
              </span>
            )}
            {/* 新增：在这里插入额外的 Badge (比如堆叠数量) */}
            {extraBadge}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onTogglePin}
            className={cn(
              'p-1.5 rounded-md transition-all hover:bg-secondary',
              item.isPinned ? 'text-orange-500' : 'opacity-0 group-hover:opacity-100 text-muted-foreground'
            )}
            title={item.isPinned ? t('refinery.unpin') : t('refinery.pin')}
          >
            <Pin size={14} className={cn(item.isPinned && 'fill-current')} />
          </button>
          <button
            onClick={handleQuickCopy}
            disabled={isCopying}
            className={cn(
              'p-1.5 rounded-md transition-all hover:bg-secondary relative overflow-hidden',
              'opacity-0 group-hover:opacity-100',
              copySuccess ? 'text-green-500' : 'text-muted-foreground',
              isCopying && 'opacity-100 cursor-wait'
            )}
            title={t('common.copy')}
          >
            <div className="relative w-[14px] h-[14px] flex items-center justify-center">
              {isCopying ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <motion.div
                  key={copySuccess ? 'check' : 'copy'}
                  initial={{ scale: 0, rotate: -90, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0, rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {copySuccess ? <Check size={14} /> : <Copy size={14} />}
                </motion.div>
              )}
            </div>
          </button>
          <button className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-secondary transition-colors text-muted-foreground">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* Content Preview */}
      <div className="text-sm text-foreground/90 leading-relaxed font-sans break-words flex flex-col gap-3">
        {/* 文本部分 (Text 或 Mixed) */}
        {(item.kind === 'text' || item.kind === 'mixed') && (
          <div className={cn("whitespace-pre-wrap", item.kind === 'mixed' ? "line-clamp-4" : "line-clamp-[10]")}>
            {item.preview || t('refinery.emptyContent')}
          </div>
        )}

        {/* 图片部分 (Mixed 或 Image) */}
        {isImageOrMixed && (
          <div className={cn(
            "rounded-lg overflow-hidden border border-border/30 bg-secondary/20 relative",
            item.kind === 'mixed' ? "h-32 w-full" : "w-64 aspect-[4/3]"
          )}>
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center text-destructive/60 text-xs px-4 text-center">
                {t('refinery.failedToLoadImage')}
              </div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                className="absolute inset-0 w-full h-full object-cover"
                alt="Preview"
                loading="lazy"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                <ImageIcon size={32} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer with size info */}
      <div className="mt-3 pt-2 border-t border-border/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-5 h-5 rounded flex items-center justify-center',
              item.kind === 'image' ? 'bg-purple-500/10 text-purple-500' :
              item.kind === 'mixed' ? 'bg-indigo-500/10 text-indigo-500' :
              'bg-blue-500/10 text-blue-500'
            )}
          >
            {item.kind === 'text' && <FileText size={12} />}
            {item.kind === 'image' && <ImageIcon size={12} />}
            {item.kind === 'mixed' && <Layers size={12} />}
          </div>
          <span className="text-[10px] text-muted-foreground/60 font-mono">{item.sizeInfo}</span>
        </div>
      </div>
    </div>
  );
}

// Helper function to get date key for grouping
function getDateKey(timestamp: number, lang: LangKey, t: TFunction): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return t('refinery.today');
  if (isYesterday) return t('refinery.yesterday');

  return date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
