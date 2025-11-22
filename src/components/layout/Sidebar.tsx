import { BookOpen, FileJson, GitMerge, Settings, ChevronLeft, ChevronRight, Globe, Moon, Sun } from 'lucide-react';
import { useAppStore, AppView } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function Sidebar() {
  const { currentView, setView, isSidebarOpen, toggleSidebar } = useAppStore();
  
  const [isDark, setIsDark] = useState(true); 

  const menuItems: { id: AppView; icon: any; label: string }[] = [
    { id: 'prompts', icon: BookOpen, label: 'Prompt Verse' },
    { id: 'context', icon: FileJson, label: 'Context Forge' },
    { id: 'patch', icon: GitMerge, label: 'Patch Weaver' },
  ];

  return (
    <aside
      className={cn(
        "bg-slate-950 border-r border-slate-800 flex flex-col relative select-none transition-[width] duration-300 ease-in-out overflow-hidden",
        // 宽度切换：16 (64px) <-> 48 (192px)
        isSidebarOpen ? "w-48" : "w-16"
      )}
    >
      {/* --- 1. 顶部 Header (修复展开按钮丢失问题) --- */}
      <div 
        className={cn(
          "h-12 flex items-center border-b border-slate-800 shrink-0 overflow-hidden transition-all",
          // 展开时两端对ZX，折叠时居中
          isSidebarOpen ? "px-4 justify-between" : "justify-center px-0"
        )}
      >
        {/* 标题区：折叠时宽度归零，防止挤占空间 */}
        <div 
          className={cn(
            "flex items-center gap-2 font-bold text-slate-300 tracking-wide transition-all duration-300 overflow-hidden whitespace-nowrap",
            isSidebarOpen ? "w-auto opacity-100 mr-2" : "w-0 opacity-0 mr-0"
          )}
        >
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
          <span className="text-xs uppercase">Explorer</span>
        </div>
        
        {/* 展开/折叠按钮 */}
        <button
          onClick={toggleSidebar}
          className={cn(
            "text-slate-500 hover:text-slate-200 p-1.5 rounded hover:bg-slate-800 transition-colors shrink-0",
            // 修复：确保按钮本身有固定大小，不会被压缩
            "h-8 w-8 flex items-center justify-center"
          )}
          title={isSidebarOpen ? "Collapse" : "Expand"}
        >
          {isSidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* --- 2. 核心导航菜单 (修复图标不居中问题) --- */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden flex flex-col">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={!isSidebarOpen ? item.label : undefined}
            className={cn(
              "flex items-center rounded-md text-sm font-medium transition-all border border-transparent whitespace-nowrap relative group shrink-0",
              // 样式逻辑：
              // 1. 宽度：总是 w-full
              // 2. 高度：固定 py-2.5
              // 3. 关键修复：isSidebarOpen ? "gap-3 px-3" : "gap-0 justify-center px-0"
              //    折叠时 gap-0 是关键，否则图标会歪
              "w-full py-2.5",
              isSidebarOpen ? "gap-3 px-3 justify-start" : "gap-0 px-0 justify-center",
              
              // 颜色状态
              currentView === item.id
                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            )}
          >
            <item.icon size={20} className="shrink-0" />
            
            {/* 文字标签：宽度的平滑过渡 */}
            <span 
              className={cn(
                "transition-all duration-300 overflow-hidden",
                isSidebarOpen ? "opacity-100 w-auto translate-x-0" : "opacity-0 w-0 -translate-x-4"
              )}
            >
              {item.label}
            </span>

            {/* 折叠状态下的蓝色指示点 (可选) */}
            {!isSidebarOpen && currentView === item.id && (
               <div className="absolute left-0.5 w-1 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
      </nav>

      {/* --- 3. 底部扩展区域 (同样修复居中) --- */}
      <div className="p-3 border-t border-slate-800 shrink-0 flex flex-col gap-1 overflow-hidden whitespace-nowrap">
        
        {/* 辅助函数：生成底部按钮 */}
        {[
          { icon: isDark ? Moon : Sun, label: isDark ? "Dark Mode" : "Light Mode", onClick: () => setIsDark(!isDark) },
          { icon: Globe, label: "English", onClick: () => {} },
          { icon: Settings, label: "Settings", onClick: () => {}, isSettings: true }
        ].map((btn, idx) => (
          <button 
            key={idx}
            onClick={btn.onClick}
            className={cn(
              "flex items-center rounded-md transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-900 group/btn",
              "w-full py-2",
              // 同样的居中修复逻辑
              isSidebarOpen ? "gap-3 px-3 justify-start" : "gap-0 px-0 justify-center",
              btn.isSettings && "mt-2 pt-2 border-t border-slate-800/50 rounded-none"
            )}
            title={!isSidebarOpen ? btn.label : undefined}
          >
            <btn.icon 
              size={18} 
              className={cn(
                "shrink-0 transition-transform duration-500", 
                btn.isSettings && "group-hover/btn:rotate-90"
              )} 
            />
            <span className={cn("text-sm transition-all duration-300", isSidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0")}>
              {btn.label}
            </span>
          </button>
        ))}

      </div>
    </aside>
  );
}