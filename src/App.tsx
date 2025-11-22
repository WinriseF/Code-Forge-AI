import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAppStore } from "@/store/useAppStore";

function App() {
  const { currentView } = useAppStore();

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 overflow-hidden flex flex-col rounded-xl border border-slate-700/50">
      {/* 1. 自定义深色标题栏 (固定在顶部) */}
      <TitleBar />

      {/* 2. 主体区域 (在标题栏下方) */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* 左侧可伸缩侧边栏 */}
        <Sidebar />

        {/* 右侧内容区 */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950 relative">

          {/* 滚动内容区 */}
          <div className="flex-1 overflow-auto p-6 scroll-smooth">
             <div className="max-w-5xl mx-auto">
                <div className="flex flex-col items-center justify-center h-[50vh] border border-dashed border-slate-800 rounded-xl bg-slate-900/20">
                  <span className="text-4xl mb-4">🚧</span>
                  <p className="text-xl font-semibold text-slate-600 capitalize">
                    {currentView} Module
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