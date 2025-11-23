import { useEffect } from 'react';
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useAppStore } from "@/store/useAppStore";
import { usePromptStore } from "@/store/usePromptStore"; // ✨ 引入 PromptStore
import { ContextView } from "@/components/features/context/ContextView";
import { PromptView } from "@/components/features/prompts/PromptView";

function App() {
  const { currentView, theme, syncModels, lastUpdated } = useAppStore();
  const { initStore } = usePromptStore(); // ✨ 获取初始化方法

  // 主题初始化
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // ✨ 启动时任务
  useEffect(() => {
    // 1. 同步模型
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - lastUpdated > ONE_DAY) {
        syncModels();
    } else {
        syncModels();
    }

    // 2. ✨ 初始化 Prompt Store (加载已下载的包)
    initStore();
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