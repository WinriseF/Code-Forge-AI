import { BookOpen, FileJson, GitMerge, Settings, ChevronLeft, ChevronRight, Globe, Moon, Sun } from 'lucide-react';
import { useAppStore, AppView } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function Sidebar() {
  const { currentView, setView, isSidebarOpen, toggleSidebar } = useAppStore();
  const [isDark, setIsDark] = useState(true); 

  // 菜单配置
  const menuItems: { id: AppView; icon: any; label: string }[] = [
    { id: 'prompts', icon: BookOpen, label: 'Prompt Verse' },
    { id: 'context', icon: FileJson, label: 'Context Forge' },
    { id: 'patch', icon: GitMerge, label: 'Patch Weaver' },
  ];

  return (
    <aside
      className={cn(
        // 核心动画：宽度切换 w-16 (64px) <-> w-48 (192px)
        "bg-slate-950 border-r border-slate-800 flex flex-col relative select-none transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
        isSidebarOpen ? "w-48" : "w-16"
      )}
    >
      {/* --- 1. 顶部 Header --- */}
      <div className="h-14 flex items-center border-b border-slate-800 shrink-0 overflow-hidden">
        
        {/* 左侧：Logo / 标题区域 */}
        <div className="h-full flex items-center min-w-[256px] pl-5"> 
          
          {/* 修改这里：蓝色小圆点现在会随侧边栏折叠而消失 */}
          <div 
            className={cn(
              "w-2 h-2 bg-blue-500 rounded-full shrink-0 mr-3 transition-all duration-300",
              // 逻辑：展开时显示，折叠时完全透明并缩小到0
              isSidebarOpen ? "opacity-100 scale-100" : "opacity-0 scale-0"
            )} 
          />
          
          {/* 文字 */}
          <span 
            className={cn(
              "font-bold text-slate-300 tracking-wide text-xs uppercase transition-all duration-300",
              isSidebarOpen ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
            )}
          >
            CodeForge
          </span>
        </div>

        {/* 切换按钮 (折叠时全屏覆盖 Header，方便点击) */}
        <button
          onClick={toggleSidebar}
          className={cn(
            "absolute top-0 bottom-0 right-0 w-8 flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors z-20 h-14 border-l border-transparent",
            !isSidebarOpen && "w-full right-auto left-0 border-none hover:bg-slate-900"
          )}
          title={isSidebarOpen ? "Collapse" : "Expand"}
        >
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* --- 2. 核心导航菜单 --- */}
      <nav className="flex-1 py-4 space-y-1 overflow-y-auto overflow-x-hidden flex flex-col">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={!isSidebarOpen ? item.label : undefined}
            className={cn(
              "relative flex items-center text-sm font-medium transition-all group h-10 w-full",
              currentView === item.id
                ? "text-blue-400"
                : "text-slate-400 hover:text-slate-100"
            )}
          >
            {/* 背景高亮块 */}
            {currentView === item.id && (
              <div className={cn(
                "absolute left-0 top-0 bottom-0 w-1 bg-blue-500 transition-all duration-300",
                isSidebarOpen && "w-full opacity-10 border-r border-blue-500/20 left-0 bg-blue-500"
              )} />
            )}
            
            {/* 图标槽位 (固定宽度) */}
            <div className="w-16 flex items-center justify-center shrink-0 z-10">
              <item.icon size={20} className="transition-transform duration-300 group-hover:scale-110" />
            </div>

            {/* 文字区域 */}
            <span 
              className={cn(
                "whitespace-nowrap transition-all duration-300 z-10 origin-left",
                isSidebarOpen ? "opacity-100 translate-x-0 scale-100" : "opacity-0 -translate-x-4 scale-90"
              )}
            >
              {item.label}
            </span>
          </button>
        ))}
      </nav>

      {/* --- 3. 底部扩展区域 --- */}
      <div className="border-t border-slate-800 shrink-0 flex flex-col overflow-hidden whitespace-nowrap py-2">
        {[
          { icon: isDark ? Moon : Sun, label: isDark ? "Dark Mode" : "Light Mode", onClick: () => setIsDark(!isDark) },
          { icon: Globe, label: "English", onClick: () => {} },
          { icon: Settings, label: "Settings", onClick: () => {}, isSettings: true }
        ].map((btn, idx) => (
          <button 
            key={idx}
            onClick={btn.onClick}
            className={cn(
              "relative flex items-center h-10 w-full text-slate-400 hover:text-slate-100 hover:bg-slate-900/50 transition-colors group/btn",
              btn.isSettings && "mt-1"
            )}
            title={!isSidebarOpen ? btn.label : undefined}
          >
            <div className="w-16 flex items-center justify-center shrink-0">
               <btn.icon 
                 size={18} 
                 className={cn(
                   "transition-transform duration-500", 
                   btn.isSettings && "group-hover/btn:rotate-90"
                 )} 
               />
            </div>
            <span className={cn(
              "text-sm transition-all duration-300 origin-left", 
              isSidebarOpen ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
            )}>
              {btn.label}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}