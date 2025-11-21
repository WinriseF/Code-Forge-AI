import { useState, useEffect, useCallback } from 'react';
import { BookOpen, FileJson, GitMerge, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore, AppView } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const { currentView, setView, sidebarWidth, setSidebarWidth, isSidebarOpen, toggleSidebar } = useAppStore();
  const [isResizing, setIsResizing] = useState(false);

  // 菜单配置
  const menuItems: { id: AppView; icon: any; label: string }[] = [
    { id: 'prompts', icon: BookOpen, label: 'Prompt Verse' },
    { id: 'context', icon: FileJson, label: 'Context Forge' },
    { id: 'patch', icon: GitMerge, label: 'Patch Weaver' },
  ];

  // --- 拖拽逻辑开始 ---
  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);
  
  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth > 160 && newWidth < 480) setSidebarWidth(newWidth);
      }
    },
    [isResizing, setSidebarWidth]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);
  // --- 拖拽逻辑结束 ---

  // 🔴 模式 A: 折叠状态 (窄条)
  if (!isSidebarOpen) {
    return (
      <aside className="w-14 bg-slate-950 border-r border-slate-800 flex flex-col items-center py-4 select-none">
        {/* 1. 展开按钮 */}
        <button 
          onClick={toggleSidebar} 
          className="p-2 mb-4 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
          title="Expand Sidebar"
        >
          <ChevronRight size={20} />
        </button>

        {/* 2. 核心菜单图标 */}
        <nav className="flex-1 w-full flex flex-col items-center gap-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                "p-2 rounded-md transition-all relative group",
                currentView === item.id 
                  ? "bg-blue-500/10 text-blue-400" 
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
              title={item.label}
            >
              <item.icon size={20} />
              {/* 选中时的左侧指示条 */}
              {currentView === item.id && (
                <div className="absolute left-0 top-2 bottom-2 w-1 bg-blue-500 rounded-r-full" />
              )}
            </button>
          ))}
        </nav>

        {/* 3. 底部设置图标 (修复：之前这里漏了) */}
        <div className="mt-auto">
          <button 
            className="p-2 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </aside>
    );
  }

  // 🟢 模式 B: 展开状态 (可拖拽)
  return (
    <aside 
      style={{ width: sidebarWidth }} 
      className="bg-slate-950 border-r border-slate-800 flex flex-col relative group select-none"
    >
      {/* 1. 顶部 Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Explorer</span>
        <button 
          onClick={toggleSidebar} 
          className="text-slate-600 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* 2. 菜单列表 */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all truncate border border-transparent",
              currentView === item.id
                ? "bg-blue-500/10 text-blue-400 border-blue-500/20" // 选中态
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200" // 默认态
            )}
          >
            <item.icon size={18} className="shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 3. 底部设置按钮 (修复：改回了 Button，并置于底部) */}
      <div className="p-3 border-t border-slate-800 shrink-0">
         <button className="flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors group/settings">
             <Settings size={18} className="group-hover/settings:rotate-45 transition-transform duration-300"/>
             <span className="text-sm font-medium">Settings</span>
         </button>
      </div>

      {/* 4. 拖拽手柄 */}
      <div
        onMouseDown={startResizing}
        className={cn(
          "absolute right-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-blue-500/50 transition-colors",
          isResizing && "bg-blue-600 w-1.5"
        )}
      />
    </aside>
  );
}