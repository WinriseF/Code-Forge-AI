import { motion } from "framer-motion";
import { useState, useEffect, useCallback, CSSProperties, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore } from '@/store/useAppStore';
import { Search, Plus, Folder, Star, Hash, Trash2, Layers, PanelLeft, AlertTriangle, Terminal, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Prompt, DEFAULT_GROUP } from '@/types/prompt';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { parseVariables } from '@/lib/template';
import { useTranslation } from 'react-i18next'; 
import { Toast, ToastType } from '@/components/ui/Toast';
import { AnimatedEmptyState } from '@/components/ui/AnimatedEmptyState';

import { PromptCard } from './PromptCard';
import { PromptEditorDialog } from './dialogs/PromptEditorDialog';
import { VariableFillerDialog } from './dialogs/VariableFillerDialog';

import { executeCommand } from '@/lib/command_executor';
import { useContextStore } from '@/store/useContextStore';

import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid } from 'react-window';

const GridAny = FixedSizeGrid as any;

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

interface PromptGridItemData {
  items: Prompt[];
  columnCount: number;
  onEdit: (p: Prompt) => void;
  onDelete: (p: Prompt) => void;
  onTrigger: (p: Prompt) => void;
}

interface CellProps {
  columnIndex: number;
  rowIndex: number;
  style: CSSProperties;
  data: PromptGridItemData;
}

const Cell = memo(({ columnIndex, rowIndex, style, data }: CellProps) => {
  const { items, columnCount, onEdit, onDelete, onTrigger } = data;
  const index = rowIndex * columnCount + columnIndex;
  
  if (index >= items.length) {
    return null;
  }

  const prompt = items[index];
  const GAP = 16;

  const itemStyle: CSSProperties = {
    ...style,
    left: Number(style.left) + GAP,
    top: Number(style.top) + GAP,
    width: Number(style.width) - GAP, 
    height: Number(style.height) - GAP
  };

  return (
    <div style={itemStyle}>
      <PromptCard 
        key={prompt.id}
        prompt={prompt}
        onEdit={onEdit}
        onDelete={onDelete}
        onTrigger={onTrigger}
      />
    </div>
  );
});

export function PromptView() {
  const {
    prompts,
    groups,
    activeGroup, setActiveGroup,
    activeCategory, setActiveCategory,
    searchQuery: storeSearchQuery, setSearchQuery,
    initStore, loadPrompts, isLoading, hasMore,
    deleteGroup, deletePrompt,
    counts,
  } = usePromptStore(
    useShallow((state) => ({
      prompts: state.prompts,
      groups: state.groups,
      activeGroup: state.activeGroup,
      setActiveGroup: state.setActiveGroup,
      activeCategory: state.activeCategory,
      setActiveCategory: state.setActiveCategory,
      searchQuery: state.searchQuery,
      setSearchQuery: state.setSearchQuery,
      initStore: state.initStore,
      loadPrompts: state.loadPrompts,
      isLoading: state.isLoading,
      hasMore: state.hasMore,
      deleteGroup: state.deleteGroup,
      deletePrompt: state.deletePrompt,
      counts: state.counts,
    })),
  );

  const { isPromptSidebarOpen, setPromptSidebarOpen, language } = useAppStore(
    useShallow((state) => ({
      isPromptSidebarOpen: state.isPromptSidebarOpen,
      setPromptSidebarOpen: state.setPromptSidebarOpen,
      language: state.language,
    })),
  );
  const projectRoot = useContextStore((state) => state.projectRoot);
  const { t } = useTranslation(); 

  const [localSearchInput, setLocalSearchInput] = useState('');
  const debouncedSearchTerm = useDebounce(localSearchInput, 500);

  const [toastState, setToastState] = useState<{ show: boolean; msg: string; type: ToastType }>({
      show: false, msg: '', type: 'success'
  });

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [isFillerOpen, setIsFillerOpen] = useState(false);
  const [fillPrompt, setFillPrompt] = useState<Prompt | null>(null);
  const [fillVars, setFillVars] = useState<string[]>([]);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<Prompt | null>(null);

  useEffect(() => {
    const init = async () => {
        await initStore();
        if (prompts.length === 0) {
            loadPrompts(true);
        }
    };
    init();
  }, []);

  useEffect(() => {
    if (debouncedSearchTerm !== storeSearchQuery) {
        setSearchQuery(debouncedSearchTerm);
    }
  }, [debouncedSearchTerm]);

  const handleCreate = useCallback(() => { setEditingPrompt(null); setIsEditorOpen(true); }, []);
  const handleEdit = useCallback((prompt: Prompt) => { setEditingPrompt(prompt); setIsEditorOpen(true); }, []);
  const handleDeleteClick = useCallback((prompt: Prompt) => { setPromptToDelete(prompt); setIsDeleteConfirmOpen(true); }, []);
  
  const triggerToast = (msg?: string, type: ToastType = 'success') => {
      setToastState({ show: true, msg: msg || t('prompts.copySuccess', language), type });
  };

  const confirmDelete = async () => {
    if (promptToDelete) {
      await deletePrompt(promptToDelete.id);
      setIsDeleteConfirmOpen(false);
      setPromptToDelete(null);
    }
  };

  const handleTrigger = useCallback(async (prompt: Prompt) => {
    const vars = parseVariables(prompt.content);
    if (prompt.isExecutable) {
      if (vars.length > 0) {
        setFillPrompt(prompt);
        setFillVars(vars);
        setIsFillerOpen(true);
      } else {
        await executeCommand(prompt.content, prompt.shellType, projectRoot);
      }
    } else {
      if (vars.length > 0) {
        setFillPrompt(prompt);
        setFillVars(vars);
        setIsFillerOpen(true);
      } else {
        await writeText(prompt.content);
        triggerToast();
      }
    }
  }, [language, projectRoot]);

  const GAP = 16;
  const ITEM_HEIGHT = 180 + GAP; 
  const MIN_COLUMN_WIDTH = 300; 

  return (
    <div className="h-full flex flex-row overflow-hidden bg-background">

      {/* 侧边栏 */}
      <aside className={cn("flex flex-col bg-secondary/5 select-none transition-all duration-300 ease-in-out overflow-hidden", isPromptSidebarOpen ? "w-56 border-r border-border opacity-100" : "w-0 border-none opacity-0")}>
        <div className="p-3 pb-0 flex flex-col gap-1 shrink-0">
            <button
                onClick={() => setActiveCategory('prompt')}
                className={cn(
                    "relative w-full flex items-center justify-between px-3 py-2 text-xs font-bold rounded-md transition-colors group outline-none",
                    activeCategory === 'prompt' ? "text-primary" : "text-muted-foreground hover:bg-secondary"
                )}
            >
                {activeCategory === 'prompt' && (
                    <motion.div
                        layoutId="prompt-category-bg"
                        className="absolute inset-0 bg-primary/10 rounded-md"
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                )}
                <div className="flex items-center gap-2 relative z-10">
                    <Sparkles size={14} />
                    <span>{t('editor.typePrompt', language)}</span>
                </div>
                <span className={cn(
                    "relative z-10 text-[10px] px-1.5 py-0.5 rounded-full transition-colors font-mono",
                    activeCategory === 'prompt' ? "bg-primary/20 text-primary" : "bg-secondary/50 text-muted-foreground group-hover:bg-secondary-foreground/10"
                )}>
                    {counts.prompt}
                </span>
            </button>
            <button
                onClick={() => setActiveCategory('command')}
                className={cn(
                    "relative w-full flex items-center justify-between px-3 py-2 text-xs font-bold rounded-md transition-colors group outline-none",
                    activeCategory === 'command' ? "text-primary" : "text-muted-foreground hover:bg-secondary"
                )}
            >
                {activeCategory === 'command' && (
                    <motion.div
                        layoutId="prompt-category-bg"
                        className="absolute inset-0 bg-primary/10 rounded-md"
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                )}
                <div className="flex items-center gap-2 relative z-10">
                    <Terminal size={14} />
                    <span>{t('editor.typeCommand', language)}</span>
                </div>
                <span className={cn(
                    "relative z-10 text-[10px] px-1.5 py-0.5 rounded-full transition-colors font-mono",
                    activeCategory === 'command' ? "bg-primary/20 text-primary" : "bg-secondary/50 text-muted-foreground group-hover:bg-secondary-foreground/10"
                )}>
                    {counts.command}
                </span>
            </button>
        </div>

        <div className="p-4 pb-2 min-w-[13rem]">
           <div className="space-y-1">
            <CategoryItem icon={<Layers size={16} />} label={t('sidebar.all', language)} isActive={activeGroup === 'all'} onClick={() => setActiveGroup('all')} />
            <CategoryItem icon={<Star size={16} />} label={t('sidebar.favorites', language)} isActive={activeGroup === 'favorite'} onClick={() => setActiveGroup('favorite')} />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 pt-0 scrollbar-hide min-w-[13rem]">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 mt-4 flex justify-between items-center px-2">
                {t('sidebar.groups', language)}
                <button className="hover:text-primary transition-colors p-1 rounded hover:bg-secondary" onClick={handleCreate}>
                    <Plus size={14} />
                </button>
            </h2>
            <div className="space-y-1">
                {groups.map(group => {
                   if (group === DEFAULT_GROUP) return null; 
                   return (
                       <CategoryItem key={group} icon={group === 'Git' ? <Hash size={16} /> : <Folder size={16} />} label={group} isActive={activeGroup === group} onClick={() => setActiveGroup(group)} onDelete={() => deleteGroup(group)} />
                   )
                })}
            </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        <header className="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0 bg-background/80 backdrop-blur z-10">
          <button onClick={() => setPromptSidebarOpen(!isPromptSidebarOpen)} className={cn("p-2 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors", !isPromptSidebarOpen && "text-primary bg-primary/10")}>
            <PanelLeft size={18} />
          </button>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              placeholder={t('prompts.searchPlaceholder', language)}
              className="w-full bg-secondary/40 border border-transparent focus:border-primary/30 rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              value={localSearchInput}
              onChange={(e) => setLocalSearchInput(e.target.value)}
            />
          </div>
          <div className="flex-1" /> 
          <button onClick={handleCreate} className="h-9 w-9 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 active:scale-95">
            <Plus size={18} />
          </button>
        </header>

        {/* 核心容器 */}
        <div className="flex-1 overflow-hidden p-0 relative" style={{ width: '100%', height: '100%' }}> 
          {prompts.length === 0 && !isLoading ? (
             <AnimatedEmptyState
               title={t('prompts.noResults', language)}
               className="h-full"
               animationClassName="h-64 w-64"
             />
           ) : (
             <AutoSizer>
              {({ height, width }: { height: number; width: number }) => {
                const safeWidth = width - 20; 
                const columnCount = Math.max(1, Math.floor(safeWidth / MIN_COLUMN_WIDTH));
                const columnWidth = safeWidth / columnCount;
                const rowCount = Math.ceil(prompts.length / columnCount);

                return (
                  <GridAny
                    className="custom-scrollbar"
                    columnCount={columnCount}
                    columnWidth={columnWidth}
                    height={height}
                    rowCount={rowCount}
                    rowHeight={ITEM_HEIGHT}
                    width={width}
                    itemData={{ 
                        items: prompts, 
                        columnCount,
                        onEdit: handleEdit,
                        onDelete: handleDeleteClick,
                        onTrigger: handleTrigger
                    }}
                    onItemsRendered={({ visibleRowStopIndex }: any) => {
                        if (visibleRowStopIndex >= rowCount - 2 && !isLoading && hasMore) {
                            loadPrompts(); 
                        }
                    }}
                  >
                    {Cell}
                  </GridAny>
                );
              }}
             </AutoSizer>
          )}

          {isLoading && prompts.length > 0 && (
             <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-background/80 backdrop-blur px-4 py-2 rounded-full border border-border shadow-lg flex items-center gap-2 text-sm text-muted-foreground animate-in slide-in-from-bottom-2 z-10">
                 <Loader2 className="animate-spin text-primary" size={16} />
                 {t('common.loadingMore', language)}
             </div>
          )}
        </div>

        {/* Dialogs */}
        <PromptEditorDialog isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} initialData={editingPrompt} />
        
        <VariableFillerDialog
            isOpen={isFillerOpen}
            onClose={() => setIsFillerOpen(false)}
            prompt={fillPrompt}
            variables={fillVars}
            confirmText={fillPrompt?.isExecutable ? t('common.runCommand', language) : t('common.copyResult', language)}
            onConfirm={async (filledContent) => {
                if (fillPrompt?.isExecutable) {
                    await executeCommand(filledContent, fillPrompt.shellType, projectRoot);
                } else {
                    await writeText(filledContent);
                    triggerToast();
                }
                setIsFillerOpen(false);
            }}
        />

        {isDeleteConfirmOpen && promptToDelete && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
             <div className="w-[400px] bg-background border border-border rounded-xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 text-destructive">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{t('prompts.deleteTitle', language)}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('prompts.deleteMessage', language, { name: promptToDelete.title })}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setIsDeleteConfirmOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  {t('prompts.cancel', language)}
                </button>
                <button onClick={confirmDelete} className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm">
                  {t('prompts.confirmDelete', language)}
                </button>
              </div>
            </div>
          </div>
        )}

        <Toast 
            message={toastState.msg} 
            type={toastState.type} 
            show={toastState.show} 
            onDismiss={() => setToastState(prev => ({ ...prev, show: false }))} 
        />
        
      </main>
    </div>
  );
}

function CategoryItem({ icon, label, isActive, onClick, onDelete }: any) {
    return (
      <div onClick={onClick} className={cn("group flex items-center justify-between w-full px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-all select-none", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
        <div className="flex items-center gap-3 overflow-hidden"><div className="shrink-0">{icon}</div><span className="truncate">{label}</span></div>
        <div className="flex items-center">
          {onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="mr-2 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-1 rounded hover:bg-background"><Trash2 size={12} /></button>}
        </div>
      </div>
    );
}
