import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/api/clipboard';
import { listen } from '@tauri-apps/api/event';
import { Search as SearchIcon, Sparkles, Terminal, CornerDownLeft, Check, Command, Bot } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore, AppTheme } from '@/store/useAppStore';
import { Prompt } from '@/types/prompt';
import { cn } from '@/lib/utils';

// 常量定义
const FIXED_HEIGHT = 106; 
const MAX_WINDOW_HEIGHT = 460;

interface ScoredPrompt extends Prompt {
  score: number;
}

type SpotlightMode = 'search' | 'chat';

export default function SpotlightApp() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const [mode, setMode] = useState<SpotlightMode>('search');
  const [chatInput, setChatInput] = useState('');
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  
  const { getAllPrompts, initStore } = usePromptStore();
  const { theme, setTheme } = useAppStore(); 
  
  const allPrompts = getAllPrompts();

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
    const unlistenPromise = appWindow.onFocusChanged(async ({ payload: isFocused }) => {
      if (isFocused) {
        await usePromptStore.persist.rehydrate();
        setTimeout(() => inputRef.current?.focus(), 50);
        setSelectedIndex(0);
        setCopiedId(null);
      } 
    });
    return () => { unlistenPromise.then(f => f()); };
  }, []);

  // --- Search Logic ---
  const filtered = useMemo(() => {
    if (mode === 'chat') return [];

    const rawQuery = query.trim().toLowerCase();
    if (!rawQuery) return allPrompts.slice(0, 20);

    const terms = rawQuery.split(/\s+/).filter(t => t.length > 0);
    const results: ScoredPrompt[] = [];

    for (const p of allPrompts) {
      let score = 0;
      const title = p.title.toLowerCase();
      const content = p.content.toLowerCase();
      const group = p.group.toLowerCase();
      let isMatch = true;

      for (const term of terms) {
        let termScore = 0;
        if (title.includes(term)) {
          termScore += 10;
          if (title.startsWith(term)) termScore += 5;
        } else if (group.includes(term)) {
          termScore += 5;
        } else if (content.includes(term)) {
          termScore += 1;
        } else {
          isMatch = false;
          break;
        }
        score += termScore;
      }
      if (isMatch) results.push({ ...p, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 20);
  }, [query, allPrompts, mode]);

  // --- Height Calculation ---
  useLayoutEffect(() => {
    let finalHeight = 120;
    if (mode === 'search') {
        const listHeight = listRef.current?.scrollHeight || 0;
        const totalIdealHeight = FIXED_HEIGHT + listHeight;
        finalHeight = Math.min(Math.max(totalIdealHeight, 120), MAX_WINDOW_HEIGHT);
    } else {
        finalHeight = 400; 
    }
    appWindow.setSize(new LogicalSize(640, finalHeight));
  }, [filtered, query, selectedIndex, mode]);

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

  const toggleMode = () => {
    setMode(prev => prev === 'search' ? 'chat' : 'search');
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  // --- Keyboard ---
  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (e.isComposing) return;

      if (e.key === 'Tab') {
          e.preventDefault();
          toggleMode();
          return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'search' && query) setQuery('');
        else if (mode === 'chat' && chatInput) setChatInput('');
        else await appWindow.hide();
        return;
      }

      if (mode === 'search') {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % filtered.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[selectedIndex]) handleCopy(filtered[selectedIndex]);
          }
      } else {
          if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              console.log('Send to AI:', chatInput);
          }
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [filtered, selectedIndex, query, mode, chatInput]);

  // Auto Scroll
  useEffect(() => {
    if (mode === 'search' && listRef.current && filtered.length > 0) {
        const activeItem = listRef.current.children[selectedIndex] as HTMLElement;
        if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, filtered, mode]);

  const isCommand = (p: Prompt) => p.type === 'command' || (!p.type && p.content.length < 50);

  return (
    <>
      {/* ✨ 注入一个局部样式来实现缓慢流动的关键帧动画 */}
      <style>{`
        @keyframes gradient-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-flow {
          background-size: 400% 400%; /* 放大背景以允许移动 */
          animation: gradient-flow 10s ease infinite; /* 10秒循环一次，非常缓慢 */
        }
      `}</style>

      <div className="w-screen h-screen flex flex-col items-center p-1 bg-transparent font-sans overflow-hidden">
        <div className="w-full h-full flex flex-col bg-background/95 backdrop-blur-2xl border border-border/50 rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 transition-all duration-300 relative overflow-hidden">
          
          {/* 柔和的背景流动层 */}
          <div 
              className={cn(
                  "absolute inset-0 pointer-events-none transition-opacity duration-1000 ease-in-out",
                  // 仅在 Chat 模式显示
                  mode === 'chat' ? "opacity-100" : "opacity-0"
              )}
          >
              {/* 
                  1. 使用 animate-gradient-flow 类(上方style定义的) 
                  2. 颜色使用了 /10 的极低透明度
                  3. 颜色跨度：靛蓝 -> 紫 -> 粉 -> 青
              */}
              <div className="absolute inset-0 animate-gradient-flow bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-cyan-500/10" />
              
              {/* 顶部叠加一层静态微光，增加通透感 */}
              <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-purple-500/5 to-transparent" />
          </div>

          {/* Header */}
          <div 
            data-tauri-drag-region 
            className={cn(
               "h-16 shrink-0 flex items-center px-5 gap-4 border-b transition-colors duration-300 cursor-move relative z-10",
               // AI 模式下，分割线变色
               mode === 'chat' ? "border-purple-500/20" : "border-border/40"
            )}
          >
            {/* 图标切换按钮 */}
            <button 
              onClick={toggleMode}
              className="w-6 h-6 flex items-center justify-center relative outline-none group"
              title="Toggle Mode (Tab)"
            >
                <SearchIcon 
                   className={cn("absolute transition-all duration-300 text-muted-foreground/70 group-hover:text-foreground", mode === 'search' ? "scale-100 opacity-100" : "scale-50 opacity-0 rotate-90")} 
                   size={24} 
                />
                <Bot 
                   className={cn("absolute transition-all duration-300 text-purple-500", mode === 'chat' ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 -rotate-90")} 
                   size={24} 
                />
            </button>

            <input
              ref={inputRef}
              className="flex-1 bg-transparent border-none outline-none text-xl placeholder:text-muted-foreground/40 h-full text-foreground caret-primary relative z-10"
              placeholder={mode === 'search' ? "Search commands..." : "Ask AI anything..."}
              value={mode === 'search' ? query : chatInput}
              onChange={e => mode === 'search' ? setQuery(e.target.value) : setChatInput(e.target.value)}
              autoFocus
              spellCheck={false}
            />
            
            {/* 右侧提示 */}
            <div className="flex items-center gap-2 pointer-events-none opacity-50 relative z-10">
               <span className={cn(
                   "text-[10px] px-1.5 py-0.5 rounded font-medium border transition-colors duration-300",
                   mode === 'chat' ? "bg-purple-500/10 text-purple-500 border-purple-500/20" : "bg-secondary text-muted-foreground border-border"
               )}>
                  TAB
               </span>
               {mode === 'search' && query && <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-medium border border-border">ESC Clear</span>}
            </div>
          </div>

          {/* Content Area */}
          <div className="relative z-10 flex-1 min-h-0 flex flex-col">
              {mode === 'search' ? (
                  // --- Search List Mode ---
                  <div 
                      ref={listRef}
                      className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar scroll-smooth"
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
                      const hasDesc = !!item.description;

                      return (
                          <div
                          key={item.id}
                          onClick={() => handleCopy(item)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                              "relative px-4 py-3 rounded-lg flex items-start gap-4 cursor-pointer transition-all duration-150 group",
                              isActive ? "bg-primary text-primary-foreground shadow-sm scale-[0.99]" : "text-foreground hover:bg-secondary/40",
                              isCopied && "bg-green-500 text-white"
                          )}
                          >
                              <div className={cn(
                                  "w-9 h-9 mt-0.5 rounded-md flex items-center justify-center shrink-0 transition-colors",
                                  isActive ? "bg-white/20 text-white" : "bg-secondary text-muted-foreground",
                                  isCopied && "bg-white/20"
                              )}>
                                  {isCopied ? <Check size={18} /> : (isCommand(item) ? <Terminal size={18} /> : <Sparkles size={18} />)}
                              </div>
                              
                              <div className="flex-1 min-w-0 flex flex-col gap-1">
                                  <div className="flex items-center justify-between">
                                      <span className={cn("font-semibold truncate text-sm tracking-tight", isActive ? "text-white" : "text-foreground")}>
                                          {item.title}
                                      </span>
                                      {isActive && !isCopied && (
                                          <span className="text-[10px] opacity-70 flex items-center gap-1 font-medium bg-black/10 px-1.5 rounded whitespace-nowrap">
                                              <CornerDownLeft size={10} /> Enter
                                          </span>
                                      )}
                                  </div>
                                  
                                  {hasDesc && (
                                      <div className={cn(
                                          "text-xs transition-all", 
                                          isActive ? "opacity-90 text-white/90 whitespace-pre-wrap" : "text-muted-foreground opacity-70 truncate"
                                      )}>
                                          {item.description}
                                      </div>
                                  )}

                                  <div className={cn(
                                      "text-xs font-mono transition-all duration-200",
                                      isActive ? "mt-1 bg-black/20 rounded p-2 text-white/95 whitespace-pre-wrap break-all line-clamp-6" : (hasDesc ? "hidden" : "text-muted-foreground opacity-50 truncate")
                                  )}>
                                      {item.content}
                                  </div>
                              </div>
                          </div>
                      );
                      })
                  )}
                  </div>
              ) : (
                  // --- Chat Mode (Placeholder) ---
                  <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <div className="w-12 h-12 bg-purple-500/10 rounded-full flex items-center justify-center mb-4 text-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)] animate-pulse">
                          <Sparkles size={24} />
                      </div>
                      <h3 className="text-foreground font-medium mb-1">AI Assistant Ready</h3>
                      <p className="text-xs text-center max-w-[200px] opacity-70 leading-relaxed">
                          Type your question and press Enter to start chatting with <span className="text-purple-500 font-medium">{useAppStore.getState().aiConfig.providerId}</span>.
                      </p>
                      <div className="mt-8 text-[10px] opacity-40 font-mono bg-background/50 border border-border/50 px-2 py-1 rounded">
                          Ephemeral Mode (History not saved)
                      </div>
                  </div>
              )}
          </div>
          
          {/* Footer */}
          <div 
              data-tauri-drag-region
              className="h-8 shrink-0 bg-secondary/30 border-t border-border/40 flex items-center justify-between px-4 text-[10px] text-muted-foreground/60 select-none backdrop-blur-sm cursor-move relative z-10"
          >
              <span className="pointer-events-none">
                  {mode === 'search' ? `${filtered.length} results` : 'AI Console'}
              </span>
              <div className="flex gap-4 pointer-events-none">
                  {mode === 'search' ? (
                      <>
                          <span>Navigate ↑↓</span>
                          <span>Copy ↵</span>
                      </>
                  ) : (
                      <span>Send ↵</span>
                  )}
                  <span>Close Esc</span>
              </div>
          </div>
        </div>
      </div>
    </>
  );
}