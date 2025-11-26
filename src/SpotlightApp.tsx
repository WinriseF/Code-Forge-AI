import { useState, useEffect, useRef, useMemo } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/api/clipboard';
import { Search, Sparkles, Terminal, CornerDownLeft } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { cn } from '@/lib/utils';

export default function SpotlightApp() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  
  // 从 Store 获取数据
  // 注意：因为是新窗口，store 会重新初始化并读取文件，数据是同步的
  const { getAllPrompts } = usePromptStore();
  const allPrompts = useMemo(() => getAllPrompts(), []);

  // 过滤逻辑
  const filtered = useMemo(() => {
    if (!query) return allPrompts.slice(0, 10); // 默认显示前10个
    
    const lower = query.toLowerCase();
    return allPrompts
      .filter(p => 
        p.title.toLowerCase().includes(lower) || 
        p.content.toLowerCase().includes(lower) ||
        p.group.toLowerCase().includes(lower)
      )
      .slice(0, 20); // 性能优化：只渲染前20个
  }, [query, allPrompts]);

  // 每次显示窗口时，自动聚焦输入框并重置状态
  useEffect(() => {
    const unlisten = appWindow.onFocusChanged(({ payload: isFocused }) => {
      if (isFocused) {
        setTimeout(() => inputRef.current?.focus(), 50);
        setQuery('');
        setSelectedIndex(0);
      } else {
        // 失去焦点自动隐藏 (类似 Alfred)
        // 开发时可以注释掉这行，方便调试
        if (import.meta.env.PROD) {
            appWindow.hide();
        }
      }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // 键盘导航
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      await appWindow.hide();
    }
  };

  const handleSelect = async (prompt: any) => {
    if (!prompt) return;
    try {
      // 简单处理：直接复制内容
      // TODO: 如果有变量，后续可以在这里扩展 UI 让用户填空
      await writeText(prompt.content);
      // 可以在这里播放一个提示音
      await appWindow.hide();
    } catch (err) {
      console.error(err);
    }
  };

  // 自动滚动
  useEffect(() => {
    if (listRef.current) {
        const el = listRef.current.children[selectedIndex] as HTMLElement;
        if (el) {
            el.scrollIntoView({ block: 'nearest' });
        }
    }
  }, [selectedIndex]);

  return (
    <div className="h-screen w-screen bg-transparent flex flex-col items-center justify-start pt-2 px-2 pb-2">
      {/* 容器：磨砂玻璃效果 */}
      <div className="w-full h-full max-h-[400px] flex flex-col bg-background/80 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl overflow-hidden ring-1 ring-white/10">
        
        {/* 搜索栏 */}
        <div className="h-14 flex items-center px-4 gap-3 border-b border-border/50 shrink-0 bg-secondary/20">
          <Search className="text-muted-foreground w-5 h-5" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-lg placeholder:text-muted-foreground/50 h-full"
            placeholder="Type to search commands..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] bg-secondary border border-border px-1.5 py-0.5 rounded text-muted-foreground">ESC</span>
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar" ref={listRef}>
          {filtered.length === 0 ? (
             <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
                No results found.
             </div>
          ) : (
             filtered.map((item, index) => {
               const isActive = index === selectedIndex;
               const isCommand = item.type === 'command' || (!item.type && item.content.length < 50);
               
               return (
                 <div
                   key={item.id}
                   onClick={() => handleSelect(item)}
                   onMouseEnter={() => setSelectedIndex(index)}
                   className={cn(
                     "px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer transition-colors group",
                     isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary/50"
                   )}
                 >
                    <div className={cn(
                        "w-8 h-8 rounded flex items-center justify-center shrink-0",
                        isActive ? "bg-white/20" : "bg-secondary"
                    )}>
                        {isCommand ? <Terminal size={16} /> : <Sparkles size={16} />}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                            <span className="font-medium truncate text-sm">{item.title}</span>
                            {isActive && <span className="text-[10px] opacity-80 flex items-center gap-1"><CornerDownLeft size={10} /> Enter</span>}
                        </div>
                        <div className={cn("text-xs truncate opacity-70", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
                            {item.description || item.content}
                        </div>
                    </div>
                 </div>
               );
             })
          )}
        </div>
        
        {/* 底部状态栏 (为未来的知识库做预留) */}
        <div className="h-8 bg-secondary/30 border-t border-border/50 flex items-center justify-between px-3 text-[10px] text-muted-foreground shrink-0">
            <span>{filtered.length} results</span>
            <div className="flex gap-3">
                <span>Select: ↑↓</span>
                <span>Copy: ↵</span>
            </div>
        </div>

      </div>
    </div>
  );
}