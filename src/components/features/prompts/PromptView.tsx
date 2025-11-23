import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore } from '@/store/useAppStore';
import { Search, Plus, Folder, Star, Hash, Trash2, Layers, CheckCircle2, PanelLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Prompt } from '@/types/prompt';
import { writeText } from '@tauri-apps/api/clipboard';
import { parseVariables } from '@/lib/template';
import { getText } from '@/lib/i18n'; 

import { PromptCard } from './PromptCard';
import { PromptEditorDialog } from './dialogs/PromptEditorDialog';
import { VariableFillerDialog } from './dialogs/VariableFillerDialog';

// ✨ 工具 Hook: 防抖
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const PAGE_SIZE = 24; // 每页显示数量

export function PromptView() {
  const { 
    groups, activeGroup, setActiveGroup, 
    getAllPrompts, // 注意：Zustand Hook 触发时，如果是对象解构，任何 state 变化都会触发重绘
    localPrompts, repoPrompts, // ✨ 显式解构数据依赖，确保 useMemo 正确响应
    searchQuery, setSearchQuery, 
    deleteGroup, deletePrompt 
  } = usePromptStore();

  const { isPromptSidebarOpen, setPromptSidebarOpen, language } = useAppStore();

  const [showToast, setShowToast] = useState(false);
  
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [isFillerOpen, setIsFillerOpen] = useState(false);
  const [fillPrompt, setFillPrompt] = useState<Prompt | null>(null);
  const [fillVars, setFillVars] = useState<string[]>([]);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<Prompt | null>(null);

  // ✨ 性能优化 State
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // 对搜索词进行防抖，输入时只更新 store，不立即触发高耗时的过滤计算
  const debouncedSearchQuery = useDebounce(searchQuery, 300); 
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 1. 获取所有数据
  // 依赖 localPrompts 和 repoPrompts，当下载新包或添加指令时自动更新
  const allPrompts = useMemo(() => getAllPrompts(), [localPrompts, repoPrompts, groups]);

  // 2. 过滤逻辑 (High Cost) - 依赖防抖后的搜索词
  const filteredPrompts = useMemo(() => {
    return allPrompts.filter(p => {
        // Group Filter
        const matchGroup = activeGroup === 'all' ? true : activeGroup === 'favorite' ? p.isFavorite : p.group === activeGroup;
        if (!matchGroup) return false;

        // Search Filter
        if (!debouncedSearchQuery.trim()) return true;
        
        const q = debouncedSearchQuery.toLowerCase();
        return (
            p.title.toLowerCase().includes(q) || 
            (p.description && p.description.toLowerCase().includes(q)) ||
            p.content.toLowerCase().includes(q) ||
            (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
        );
    });
  }, [allPrompts, activeGroup, debouncedSearchQuery]);

  // 3. 切片数据 (用于渲染)
  const visiblePrompts = useMemo(() => {
    return filteredPrompts.slice(0, visibleCount);
  }, [filteredPrompts, visibleCount]);

  // 当搜索条件或分组改变时，重置页码并回到顶部
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [activeGroup, debouncedSearchQuery]);

  // ✨ 无限滚动处理函数
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    // 距离底部 200px 时加载更多
    if (scrollHeight - scrollTop - clientHeight < 200) {
      if (visibleCount < filteredPrompts.length) {
        // 使用函数式更新，避免依赖 visibleCount 导致频繁 recreate
        setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredPrompts.length));
      }
    }
  }, [filteredPrompts.length, visibleCount]); // 添加 visibleCount 依赖以确保逻辑正确，虽 React 批处理会优化

  const triggerToast = () => { setShowToast(true); setTimeout(() => setShowToast(false), 2000); };
  const handleCreate = () => { setEditingPrompt(null); setIsEditorOpen(true); };
  const handleEdit = (prompt: Prompt) => { setEditingPrompt(prompt); setIsEditorOpen(true); };
  const handleDeleteClick = (prompt: Prompt) => { setPromptToDelete(prompt); setIsDeleteConfirmOpen(true); };
  
  const confirmDelete = () => {
    if (promptToDelete) {
      deletePrompt(promptToDelete.id);
      setIsDeleteConfirmOpen(false);
      setPromptToDelete(null);
    }
  };

  const handleTrigger = async (prompt: Prompt) => {
    const vars = parseVariables(prompt.content);
    if (vars.length > 0) {
      setFillPrompt(prompt);
      setFillVars(vars);
      setIsFillerOpen(true);
    } else {
      await writeText(prompt.content);
      triggerToast();
    }
  };

  return (
    <div className="h-full flex flex-row overflow-hidden bg-background">
      
      {/* --- Sidebar --- */}
      <aside className={cn("flex flex-col bg-secondary/5 select-none transition-all duration-300 ease-in-out overflow-hidden", isPromptSidebarOpen ? "w-52 border-r border-border opacity-100" : "w-0 border-none opacity-0")}>
        <div className="p-4 pb-2 min-w-[13rem]">
           <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 px-2">
             {getText('sidebar', 'library', language)}
           </h2>
           <div className="space-y-1">
            <CategoryItem 
              icon={<Layers size={16} />} 
              label={getText('sidebar', 'all', language)} 
              count={allPrompts.length} // 显示总数
              isActive={activeGroup === 'all'} 
              onClick={() => setActiveGroup('all')} 
            />
            <CategoryItem 
              icon={<Star size={16} />} 
              label={getText('sidebar', 'favorites', language)} 
              count={allPrompts.filter(p => p.isFavorite).length}
              isActive={activeGroup === 'favorite'} 
              onClick={() => setActiveGroup('favorite')} 
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 pt-0 scrollbar-hide min-w-[13rem]">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 mt-4 flex justify-between items-center px-2">
                {getText('sidebar', 'groups', language)}
                <button className="hover:text-primary transition-colors p-1 rounded hover:bg-secondary" onClick={handleCreate}>
                    <Plus size={14} />
                </button>
            </h2>
            <div className="space-y-1">
                {groups.map(group => (
                  group !== 'Default' && (
                    <CategoryItem 
                        key={group}
                        icon={group === 'Git' ? <Hash size={16} /> : <Folder size={16} />} 
                        label={group} 
                        count={allPrompts.filter(p => p.group === group).length}
                        isActive={activeGroup === group} 
                        onClick={() => setActiveGroup(group)}
                        onDelete={() => deleteGroup(group)}
                    />
                  )
                ))}
            </div>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        <header className="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0 bg-background/80 backdrop-blur z-10">
          <button onClick={() => setPromptSidebarOpen(!isPromptSidebarOpen)} className={cn("p-2 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors", !isPromptSidebarOpen && "text-primary bg-primary/10")}>
            <PanelLeft size={18} />
          </button>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text"
              placeholder={getText('prompts', 'searchPlaceholder', language)}
              className="w-full bg-secondary/40 border border-transparent focus:border-primary/30 rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex-1" /> 
          <button onClick={handleCreate} className="h-9 w-9 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 active:scale-95">
            <Plus size={18} />
          </button>
        </header>

        {/* ✨ 滚动区域：绑定 ref 和 onScroll */}
        <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth"
        >
          <div className="max-w-[1600px] mx-auto">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 pb-20">
                {/* 渲染可见部分 */}
                {visiblePrompts.map(prompt => (
                    <PromptCard key={prompt.id} prompt={prompt} onEdit={handleEdit} onDelete={handleDeleteClick} onTrigger={handleTrigger} />
                ))}

                {/* 加载指示器 */}
                {visibleCount < filteredPrompts.length && (
                    <div className="col-span-full flex justify-center py-6 text-muted-foreground">
                        <Loader2 className="animate-spin w-6 h-6" />
                    </div>
                )}

                {filteredPrompts.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground opacity-60">
                        <div className="w-16 h-16 bg-secondary/50 rounded-2xl flex items-center justify-center mb-4"><Search size={32} /></div>
                        <p>{getText('prompts', 'noResults', language)}</p>
                    </div>
                )}
             </div>
          </div>
        </div>

        {/* --- Modals --- */}
        <PromptEditorDialog isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} initialData={editingPrompt} />
        <VariableFillerDialog isOpen={isFillerOpen} onClose={() => setIsFillerOpen(false)} prompt={fillPrompt} variables={fillVars} onSuccess={triggerToast} />

        {isDeleteConfirmOpen && promptToDelete && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
            <div className="w-[400px] bg-background border border-border rounded-xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 text-destructive">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{getText('prompts', 'deleteTitle', language)}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {getText('prompts', 'deleteMessage', language, { name: promptToDelete.title })}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setIsDeleteConfirmOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                  {getText('prompts', 'cancel', language)}
                </button>
                <button onClick={confirmDelete} className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm">
                  {getText('prompts', 'confirmDelete', language)}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={cn("fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out transform pointer-events-none", showToast ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0")}>
          <div className="bg-foreground/90 text-background px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium backdrop-blur-sm">
            <CheckCircle2 size={16} className="text-green-400" />
            <span>{getText('prompts', 'copySuccess', language)}</span>
          </div>
        </div>
        
      </main>
    </div>
  );
}

function CategoryItem({ icon, label, count, isActive, onClick, onDelete }: any) {
    return (
      <div onClick={onClick} className={cn("group flex items-center justify-between w-full px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-all select-none", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
        <div className="flex items-center gap-3 overflow-hidden"><div className="shrink-0">{icon}</div><span className="truncate">{label}</span></div>
        <div className="flex items-center">
          {onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="mr-2 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-1 rounded hover:bg-background"><Trash2 size={12} /></button>}
          {/* 简单的数字截断优化 */}
          {count >= 0 && <span className="text-xs opacity-60 min-w-[1.5em] text-center">{count > 999 ? '999+' : count}</span>}
        </div>
      </div>
    );
}