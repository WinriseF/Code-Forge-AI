import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/api/clipboard';
import { listen } from '@tauri-apps/api/event';
import { Search as SearchIcon, Sparkles, Terminal, CornerDownLeft, Check, Command, Bot, User, Brain, ChevronDown } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore, AppTheme } from '@/store/useAppStore';
import { Prompt } from '@/types/prompt';
import { cn } from '@/lib/utils';
import { streamChatCompletion, ChatMessage } from '@/lib/llm';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getText } from './lib/i18n';

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null); 
  
  const { getAllPrompts, initStore } = usePromptStore();
  const { theme, setTheme, aiConfig, spotlightAppearance, language } = useAppStore(); 
  
  const allPrompts = getAllPrompts();

  useEffect(() => { initStore(); }, []);

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

  useEffect(() => {
    const unlistenPromise = appWindow.onFocusChanged(async ({ payload: isFocused }) => {
      if (isFocused) {
        await usePromptStore.persist.rehydrate();
        await useAppStore.persist.rehydrate();
        setTimeout(() => inputRef.current?.focus(), 50);
        setSelectedIndex(0);
        setCopiedId(null);
      } 
    });
    return () => { unlistenPromise.then(f => f()); };
  }, []);

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

  useLayoutEffect(() => {
    let finalHeight = 120;
    const targetWidth = spotlightAppearance.width;
    if (mode === 'search') {
        const listHeight = listRef.current?.scrollHeight || 0;
        const totalIdealHeight = FIXED_HEIGHT + listHeight;
        finalHeight = Math.min(Math.max(totalIdealHeight, 120), MAX_WINDOW_HEIGHT);
    } else {
        // 如果有消息，窗口变高；没有消息，保持紧凑的空状态高度
        finalHeight = messages.length > 0 ? spotlightAppearance.maxChatHeight : 300;
    }
    appWindow.setSize(new LogicalSize(targetWidth, finalHeight));
  }, [filtered, query, selectedIndex, mode, messages.length, spotlightAppearance]);

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

const handleSendToAI = async () => {
      if (!chatInput.trim() || isStreaming) return;
      
      const userText = chatInput.trim();
      setChatInput(''); 
      
      const newMessages: ChatMessage[] = [
          ...messages,
          { role: 'user', content: userText }
      ];
      setMessages(newMessages);
      setIsStreaming(true);

      // 初始化时，reasoning 设为空字符串
      setMessages(prev => [...prev, { role: 'assistant', content: '', reasoning: '' }]);

      await streamChatCompletion(
          newMessages,
          aiConfig,
          // 接收两个参数
          (contentDelta, reasoningDelta) => {
              setMessages(current => {
                  // 如果当前数组为空（说明用户刚按了清空），直接返回，不进行任何操作
                  if (current.length === 0) return current;

                  const updated = [...current];
                  const lastIndex = updated.length - 1;
                  
                  // 二重保险：确保索引有效
                  if (lastIndex < 0) return current;

                  const lastMsg = updated[lastIndex];
                  
                  // 三重保险：确保最后一条消息存在且是 assistant
                  if (lastMsg && lastMsg.role === 'assistant') {
                      updated[lastIndex] = {
                          ...lastMsg,
                          content: lastMsg.content + contentDelta,
                          reasoning: (lastMsg.reasoning || "") + reasoningDelta
                      };
                  }
                  return updated;
              });
          },
          (err) => {
              setMessages(current => {
                  // 防崩溃检查
                  if (current.length === 0) return current;

                  const updated = [...current];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0 && updated[lastIndex]) {
                      updated[lastIndex] = {
                          ...updated[lastIndex],
                          content: updated[lastIndex].content + `\n\n**[Error]**: ${err}`
                      };
                  }
                  return updated;
              });
          },
          () => {
              setIsStreaming(false);
          }
      );
  };

  const handleClearChat = () => {
      setMessages([]);
      setChatInput('');
      setIsStreaming(false); // 强制停止流式状态（虽然无法物理中断 fetch，但能停止 UI 更新）
      setTimeout(() => inputRef.current?.focus(), 50);
  };

  useEffect(() => {
      if (mode === 'chat' && chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
  }, [messages, mode]);

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
      
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          if (mode === 'chat' && !isStreaming) {
              handleClearChat();
          }
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
              handleSendToAI();
          }
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [filtered, selectedIndex, query, mode, chatInput, isStreaming, messages]);

  useEffect(() => {
    if (mode === 'search' && listRef.current && filtered.length > 0) {
        const activeItem = listRef.current.children[selectedIndex] as HTMLElement;
        if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, filtered, mode]);

  const isCommand = (p: Prompt) => p.type === 'command' || (!p.type && p.content.length < 50);

  return (
    <>
      <style>{`
        @keyframes gradient-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-flow {
          background-size: 400% 400%;
          animation: gradient-flow 10s ease infinite;
        }
        /* Markdown 样式微调 */
        .markdown-body p { margin-bottom: 0.5em; }
        .markdown-body p:last-child { margin-bottom: 0; }
        .markdown-body pre { margin: 0.5em 0; border-radius: 0.375rem; overflow: hidden; }
        .markdown-body code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9em; }
      `}</style>

      <div className="w-screen h-screen flex flex-col items-center p-1 bg-transparent font-sans overflow-hidden">
        <div className="w-full h-full flex flex-col bg-background/95 backdrop-blur-2xl border border-border/50 rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 transition-all duration-300 relative overflow-hidden">
          
          {/* 背景流动层 */}
          <div 
              className={cn(
                  "absolute inset-0 pointer-events-none transition-opacity duration-1000 ease-in-out",
                  mode === 'chat' ? "opacity-100" : "opacity-0"
              )}
          >
              <div className="absolute inset-0 animate-gradient-flow bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-cyan-500/10" />
              <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-purple-500/5 to-transparent" />
          </div>

          {/* Header */}
          <div 
            data-tauri-drag-region 
            className={cn(
               "h-16 shrink-0 flex items-center px-5 gap-4 border-b transition-colors duration-300 cursor-move relative z-10",
               mode === 'chat' ? "border-purple-500/20" : "border-border/40"
            )}
          >
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
              placeholder={mode === 'search' ? getText('spotlight', 'searchPlaceholder', language) : getText('spotlight', 'chatPlaceholder', language)}
              value={mode === 'search' ? query : chatInput}
              onChange={e => mode === 'search' ? setQuery(e.target.value) : setChatInput(e.target.value)}
              autoFocus
              spellCheck={false}
            />
            
            <div className="flex items-center gap-2 pointer-events-none opacity-50 relative z-10">
               <span className={cn(
                   "text-[10px] px-1.5 py-0.5 rounded font-medium border transition-colors duration-300",
                   mode === 'chat' ? "bg-purple-500/10 text-purple-500 border-purple-500/20" : "bg-secondary text-muted-foreground border-border"
               )}>
                  TAB
               </span>
               {mode === 'search' && query && <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground font-medium border border-border">ESC {getText('spotlight', 'clear', language)}</span>}
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
                          <span className="text-sm">{getText('spotlight', 'noCommands', language)}</span>
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
                                              <CornerDownLeft size={10} /> {getText('spotlight', 'enter', language)}
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
                  // --- Chat Mode (Fixed) ---
                  <div className="flex-1 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-4">
                      
                      {messages.length === 0 ? (
                           // 空状态 (Empty State)
                           <div className="flex-1 flex flex-col items-center justify-start text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-500">
                               <div className="w-12 h-12 bg-purple-500/10 rounded-full flex items-center justify-center mb-4 text-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)] animate-pulse">
                                   <Sparkles size={24} />
                               </div>
                               <h3 className="text-foreground font-medium mb-1">{getText('spotlight', 'aiReady', language)}</h3>
                               <p className="text-xs text-center max-w-[200px] opacity-70 leading-relaxed">
                                   {getText('spotlight', 'aiDesc', language)} <span className="text-purple-500 font-medium">{useAppStore.getState().aiConfig.providerId}</span>.
                               </p>
                               <div className="mt-8 text-[10px] opacity-40 font-mono bg-background/50 border border-border/50 px-2 py-1 rounded">
                                   {getText('spotlight', 'ephemeral', language)}
                               </div>
                           </div>
                      ) : (
                          // 消息列表 (Message List)
                          <div className="space-y-4 pb-2">
                               {messages.map((msg, idx) => (
                                   <div key={idx} className={cn(
                                       "flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300", 
                                       msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                                   )}>
                                       {/* 头像 */}
                                       <div className={cn(
                                           "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-sm",
                                           msg.role === 'user' 
                                              ? "bg-secondary/80 border-border text-foreground" 
                                              : "bg-purple-500/10 border-purple-500/20 text-purple-500"
                                       )}>
                                           {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                                       </div>

                                       {/* 气泡 */}
                                       <div className={cn(
                                           "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm border",
                                           msg.role === 'user'
                                              ? "bg-primary text-primary-foreground border-primary/50 rounded-tr-sm"
                                              : "bg-secondary/50 border-border/50 text-foreground rounded-tl-sm markdown-body"
                                       )}>
                                           {msg.role === 'user' ? (
                                               <div className="whitespace-pre-wrap">{msg.content}</div>
                                           ) : (
                                              <>
                                                  {/* 1. 思考过程模块 */}
                                                  {msg.reasoning && (
                                                      <details className="mb-2 group" open={isStreaming && idx === messages.length - 1}>
                                                          <summary className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-muted-foreground/60 cursor-pointer hover:text-purple-400 transition-colors select-none list-none outline-none">
                                                              <Brain size={12} />
                                                              <span>{getText('spotlight', 'thinking', language)}</span>
                                                              <ChevronDown size={12} className="group-open:rotate-180 transition-transform duration-200" />
                                                          </summary>
                                                          <div className="mt-2 pl-2 border-l-2 border-purple-500/20 text-xs font-mono text-muted-foreground/80 whitespace-pre-wrap leading-relaxed opacity-80">
                                                              {msg.reasoning}
                                                              {/* 思考时的光标 */}
                                                              {isStreaming && idx === messages.length - 1 && !msg.content && (
                                                                  <span className="inline-block w-1.5 h-3 ml-1 bg-purple-500/50 align-middle animate-pulse" />
                                                              )}
                                                          </div>
                                                      </details>
                                                  )}

                                                  {/* 2. Markdown 回复 */}
                                                  <ReactMarkdown
                                                      remarkPlugins={[remarkGfm]}
                                                      components={{
                                                          code({node, inline, className, children, ...props}: any) {
                                                              const match = /language-(\w+)/.exec(className || '')
                                                              return !inline && match ? (
                                                                  <SyntaxHighlighter
                                                                      style={vscDarkPlus}
                                                                      language={match[1]}
                                                                      PreTag="div"
                                                                      {...props}
                                                                  >
                                                                      {String(children).replace(/\n$/, '')}
                                                                  </SyntaxHighlighter>
                                                              ) : (
                                                                  <code className={cn("bg-black/20 px-1 py-0.5 rounded font-mono", className)} {...props}>
                                                                      {children}
                                                                  </code>
                                                              )
                                                          }
                                                      }}
                                                  >
                                                      {/* 如果正在流式传输且正文为空（正在思考），显示省略号占位，否则显示正文 */}
                                                      {msg.content || (isStreaming && idx === messages.length - 1 && !msg.reasoning ? "..." : "")}
                                                  </ReactMarkdown>
                                              </>
                                           )}
                                       </div>
                                   </div>
                               ))}
                               {/* 底部锚点 */}
                               <div ref={chatEndRef} />
                          </div>
                      )}
                  </div>
              )}
          </div>
          
          {/* Footer */}
          <div 
              data-tauri-drag-region
              className="h-8 shrink-0 bg-secondary/30 border-t border-border/40 flex items-center justify-between px-4 text-[10px] text-muted-foreground/60 select-none backdrop-blur-sm cursor-move relative z-10"
          >
              <span className="pointer-events-none flex items-center gap-2">
                  {mode === 'search' ? `${filtered.length} ${getText('spotlight', 'results', language)}` : getText('spotlight', 'console', language)}
                  {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />}
              </span>
              <div className="flex gap-4 pointer-events-none">
                  {mode === 'search' ? (
                      <>
                          <span>{getText('spotlight', 'nav', language)} ↑↓</span>
                          <span>{getText('spotlight', 'copy', language)} ↵</span>
                      </>
                  ) : (
                      <>
                      <span className={cn(isStreaming && "opacity-30")}>{getText('spotlight', 'clear', language)} Ctrl+K</span> 
                      <span>{getText('spotlight', 'send', language)} ↵</span>
                      </>
                  )}
                  <span>{getText('spotlight', 'close', language)} Esc</span>
              </div>
          </div>
        </div>
      </div>
    </>
  );
}