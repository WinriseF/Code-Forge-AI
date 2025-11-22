import { useEffect } from 'react';
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useAppStore } from "@/store/useAppStore";
import { ContextView } from "@/components/features/context/ContextView";
import { PromptView } from "@/components/features/prompts/PromptView";

function App() {
  const { currentView, theme, syncModels, lastUpdated } = useAppStore();

  // 主题初始化
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // ✨ 启动时检查更新
  useEffect(() => {
    // 策略：每次打开 App 都尝试更新，或者设置一个时间间隔（比如 24小时）
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - lastUpdated > ONE_DAY) {
        syncModels();
    } else {
        // 也可以选择每次启动都 sync，因为 json 文件很小
        syncModels();
    }
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