import { useEffect } from 'react';
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useAppStore } from "@/store/useAppStore";
import { ContextView } from "@/components/features/context/ContextView";
import { PromptView } from "@/components/features/prompts/PromptView";

function App() {
  const { currentView, theme, syncModels, lastUpdated } = useAppStore();
  // ✨ 注意：这里不再解构 initStore，我们把它移到 Store 内部自动触发
  // const { initStore } = usePromptStore(); 

  // 主题初始化
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // ✨ 1. 禁止右键菜单 & 快捷键刷新
  useEffect(() => {
    // 禁止右键
    const handleContextMenu = (e: MouseEvent) => {
      // 如果是开发环境，按住 Ctrl 还可以呼出右键（方便调试），生产环境直接禁止
      if (import.meta.env.PROD || !e.ctrlKey) {
        e.preventDefault();
      }
    };
    
    // 禁止 F5 和 Ctrl+R 刷新
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
            e.preventDefault();
        }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 启动时任务
  useEffect(() => {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - lastUpdated > ONE_DAY) {
        syncModels();
    } else {
        syncModels();
    }
    // ✨ 注意：删除了这里的 initStore() 调用，防止竞态条件
  }, []);

  return (
    <div className="h-screen w-full bg-background text-foreground overflow-hidden flex flex-col rounded-xl border border-border transition-colors duration-300 relative shadow-2xl">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 relative transition-colors duration-300">
          {currentView === 'prompts' && <PromptView />}
          {currentView === 'context' && <ContextView />}
          {currentView === 'patch' && (
             <div className="h-full flex items-center justify-center text-muted-foreground">
                🚧 Patch Weaver 开发中...
             </div>
          )}
        </main>
      </div>
      <SettingsModal />
    </div>
  );
}

export default App;