import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAppStore } from "@/store/useAppStore";

function App() {
  const { currentView } = useAppStore();

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 overflow-hidden flex flex-col rounded-xl border border-slate-700/50">
      
      {/* 1. 顶部标题栏 (Window Controls) */}
      <TitleBar />

      {/* 2. 主体布局区域 */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* 左侧侧边栏 */}
        <Sidebar />

        {/* 右侧主内容区 (移除顶部 Header，直奔主题) */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950 relative">
          
          {/* 核心内容滚动区 */}
          <div className="flex-1 overflow-auto p-6 scroll-smooth">
             <div className="max-w-5xl mx-auto h-full">
                
                {/* 这里是各个功能模块的入口，目前是占位符 */}
                <div className="flex flex-col items-center justify-center h-full border border-dashed border-slate-800 rounded-xl bg-slate-900/20">
                  <span className="text-5xl mb-6 opacity-20">
                    {currentView === 'prompts' && "📚"}
                    {currentView === 'context' && "🔥"}
                    {currentView === 'patch' && "🧬"}
                  </span>
                  <h1 className="text-2xl font-bold text-slate-500 capitalize tracking-tight">
                    {currentView === 'prompts' && "Prompt Verse"}
                    {currentView === 'context' && "Context Forge"}
                    {currentView === 'patch' && "Patch Weaver"}
                  </h1>
                  <p className="text-slate-600 mt-2 text-sm">
                    Workspace Ready
                  </p>
                </div>

             </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;