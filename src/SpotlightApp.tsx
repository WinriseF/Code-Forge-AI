import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/api/clipboard';
import { listen } from '@tauri-apps/api/event';
import { Search, Sparkles, Terminal, CornerDownLeft, Check, Command } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore, AppTheme } from '@/store/useAppStore';
import { Prompt } from '@/types/prompt';
import { cn } from '@/lib/utils';

// 常量定义
const FIXED_HEIGHT = 106; 
const MAX_WINDOW_HEIGHT = 460;

// 评分接口
interface ScoredPrompt extends Prompt {
  score: number;
}

export default function SpotlightApp() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  
  const { getAllPrompts, initStore, localPrompts, repoPrompts } = usePromptStore();
  const { theme, setTheme } = useAppStore(); 
  
  const allPrompts = useMemo(() => getAllPrompts(), [getAllPrompts, localPrompts, repoPrompts]);

  // --- 初始化与同步 ---
  useEffect(() => { initStore(); }, []);

  // --- Theme Sync ---
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);

    const unlistenPromise = listen<AppTheme>('theme-changed', (event) => {
        setTheme(event.payload, true); 
        root.classList.remove('light', 'dark');
        root.classList.add(event.payload);
    });
    return () => { unlistenPromise.then(unlisten => unlisten()); };
  }, [theme, setTheme]);

  // --- Focus Logic ---
  useEffect(() => {
    const unlisten = appWindow.onFocusChanged(async ({ payload: isFocused }) => {
      if (isFocused) {
        // 延迟一小会儿，等待 React 渲染完成
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.select(); 
            }
        }, 50);
        
        setSelectedIndex(0);
        setCopiedId(null);
        
        if (allPrompts.length === 0) {
            initStore();
        }
      } 
    });
    return () => { unlisten.then(f => f()); };
  }, [allPrompts.length]);

  // --- 智能搜索算法 ---
  const filtered = useMemo(() => {
    const rawQuery = query.trim().toLowerCase();
    
    // 1. 无搜索词：直接返回前 20 条
    if (!rawQuery) return allPrompts.slice(0, 20);

    const terms = rawQuery.split(/\s+/).filter(t => t.length > 0);
    
    // 2. 评分与过滤
    const results: ScoredPrompt[] = [];

    for (const p of allPrompts) {
      let score = 0;
      const title = p.title.toLowerCase();
      const content = p.content.toLowerCase();
      const group = p.group.toLowerCase();
      
      let isMatch = true;

      // 检查每个搜索词
      for (const term of terms) {
        let termScore = 0;
        
        // 规则 A: 标题匹配 (权重最高)
        if (title.includes(term)) {
          termScore += 10;
          // 额外加分：如果是标题开头，或者是单词开头
          if (title.startsWith(term)) termScore += 5;
        } 
        // 规则 B: 标签/组名匹配 (中等权重)
        else if (group.includes(term)) {
          termScore += 5;
        }
        // 规则 C: 内容匹配 (低权重)
        else if (content.includes(term)) {
          termScore += 1;
        } 
        else {
          // 任何一个词不匹配，则该条目淘汰
          isMatch = false;
          break;
        }
        
        score += termScore;
      }

      if (isMatch) {
        results.push({ ...p, score });
      }
    }

    // 3. 排序：分数高的排前面
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // 只取前20条，大幅提升渲染性能

  }, [query, allPrompts]);

  // --- Height Calculation ---
  useLayoutEffect(() => {
    const listHeight = listRef.current?.scrollHeight || 0;
    const totalIdealHeight = FIXED_HEIGHT + listHeight;
    const finalHeight = Math.min(Math.max(totalIdealHeight, 120), MAX_WINDOW_HEIGHT);
    appWindow.setSize(new LogicalSize(640, finalHeight));
  }, [filtered, query]); // 监听 filtered，当搜索结果变化时高度会自动变

  // --- Actions ---
  const handleCopy = async (prompt: Prompt) => {
    if (!prompt) return;
    try {
      await writeText(prompt.content);
      setCopiedId(prompt.id);
      setTimeout(async () => {
        await appWindow.hide();
        setCopiedId(null);
      }, 300);
    } catch (err) {
      console.error(err);
    }
  };

  // --- Keyboard ---
  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) handleCopy(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else await appWindow.hide();
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [filtered, selectedIndex, query]);

  // Auto Scroll
  useEffect(() => {
    if (listRef.current && filtered.length > 0) {
        const activeItem = listRef.current.children[selectedIndex] as HTMLElement;
        if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, filtered]);

  const isCommand = (p: Prompt) => p.type === 'command' || (!p.type && p.content.length < 50);

  return (
    <div className="w-screen h-screen flex flex-col items-center p-1 bg-transparent font-sans overflow-hidden">
      <div className="w-full h-full flex flex-col bg-background/95 backdrop-blur-2xl border border-border/50 rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 transition-all duration-200">
        
        {/* Header */}
        <div 
          data-tauri-drag-region 
          className="h-16 shrink-0 flex items-center px-5 gap-4 border-b border-border/40 bg-transparent cursor-move"
        >
          <Search className="text-muted-foreground/70 w-6 h-6 pointer-events-none" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-xl placeholder:text-muted-foreground/40 h-full text-foreground caret-primary"
            placeholder="Search commands..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            autoFocus
            spellCheck={false}
          />
          <div className="flex items-center gap-2 pointer-events-none opacity-50">
             {query && <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-medium">ESC Clear</span>}
          </div>
        </div>

        {/* List */}
        <div 
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 custom-scrollbar scroll-smooth"
        >
           {filtered.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 opacity-60 min-h-[100px]">
                <Command size={24} strokeWidth={1.5} />
                <span className="text-sm">No matching commands.</span>
             </div>
          ) : (
             filtered.map((item, index) => {
               const isActive = index === selectedIndex;
               const isCopied = copiedId === item.id;
               return (
                 <div
                   key={item.id}
                   onClick={() => handleCopy(item)}
                   onMouseEnter={() => setSelectedIndex(index)}
                   className={cn(
                     "relative px-4 py-3 rounded-lg flex items-center gap-4 cursor-pointer transition-all duration-150 group",
                     isActive ? "bg-primary text-primary-foreground shadow-sm scale-[0.99]" : "text-foreground hover:bg-secondary/40",
                     isCopied && "bg-green-500 text-white"
                   )}
                 >
                    <div className={cn(
                        "w-9 h-9 rounded-md flex items-center justify-center shrink-0 transition-colors",
                        isActive ? "bg-white/20 text-white" : "bg-secondary text-muted-foreground",
                        isCopied && "bg-white/20"
                    )}>
                        {isCopied ? <Check size={18} /> : (isCommand(item) ? <Terminal size={18} /> : <Sparkles size={18} />)}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center justify-between">
                            <span className={cn("font-semibold truncate text-sm tracking-tight", isActive ? "text-white" : "text-foreground")}>
                                {item.title}
                            </span>
                            {isActive && !isCopied && (
                                <span className="text-[10px] opacity-70 flex items-center gap-1 font-medium bg-black/10 px-1.5 rounded">
                                    <CornerDownLeft size={10} /> Enter
                                </span>
                            )}
                        </div>
                        <div className={cn("text-xs truncate transition-opacity font-mono", isActive ? "opacity-80 text-blue-100" : "text-muted-foreground opacity-60")}>
                            {item.description || item.content}
                        </div>
                    </div>
                 </div>
               );
             })
          )}
        </div>
        
        {/* Footer */}
        <div 
            data-tauri-drag-region
            className="h-8 shrink-0 bg-secondary/30 border-t border-border/40 flex items-center justify-between px-4 text-[10px] text-muted-foreground/60 select-none backdrop-blur-sm cursor-move"
        >
            <span className="pointer-events-none">{filtered.length} results</span>
            <div className="flex gap-4 pointer-events-none">
                <span>Navigate ↑↓</span>
                <span>Copy ↵</span>
                <span>Close Esc</span>
            </div>
        </div>
      </div>
    </div>
  );
}