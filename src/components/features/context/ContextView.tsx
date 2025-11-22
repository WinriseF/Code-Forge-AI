import { useState, useMemo, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { writeText } from '@tauri-apps/api/clipboard';
import { 
  FolderOpen, RefreshCw, Loader2, FileJson, 
  PanelLeft, Search, ArrowRight, CheckCircle2 
} from 'lucide-react';
import { useContextStore } from '@/store/useContextStore';
import { useAppStore } from '@/store/useAppStore';
import { scanProject } from '@/lib/fs_helper';
import { calculateIdealTreeWidth } from '@/lib/tree_utils';
import { calculateStats, generateContext } from '@/lib/context_assembler';
import { FileTreeNode } from './FileTreeNode';
import { TokenDashboard } from './TokenDashboard';
import { cn } from '@/lib/utils';

export function ContextView() {
  const { 
    projectRoot, fileTree, isScanning, ignoreConfig,
    setProjectRoot, setFileTree, setIsScanning, toggleSelect 
  } = useContextStore();

  const { 
    isContextSidebarOpen, setContextSidebarOpen,
    contextSidebarWidth, setContextSidebarWidth 
  } = useAppStore();

  // 本地状态：路径输入框
  const [pathInput, setPathInput] = useState('');
  // 本地状态：生成中 loading
  const [isGenerating, setIsGenerating] = useState(false);
  // 本地状态：成功提示 Toast
  const [showToast, setShowToast] = useState(false);

  // 当 projectRoot 改变时，同步到输入框
  useEffect(() => {
    if (projectRoot) setPathInput(projectRoot);
  }, [projectRoot]);

  // --- 统计信息 (实时计算) ---
  // 使用 context_assembler 提供的 calculateStats，包含文件数、总大小、预估Token
  const stats = useMemo(() => {
    return calculateStats(fileTree);
  }, [fileTree]);

  // --- 核心操作：生成并复制上下文 ---
  const handleCopyContext = async () => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    try {
      // 1. 读取文件并组装文本
      const { text, tokenCount } = await generateContext(fileTree);
      
      // 2. 写入系统剪贴板
      await writeText(text);
      
      console.log(`Context copied! Actual tokens: ${tokenCount}`);
      
      // 3. 显示成功提示
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    } catch (err) {
      console.error("Failed to generate context:", err);
      // 实际项目中这里可以用个更正式的 Error Toast
    } finally {
      setIsGenerating(false);
    }
  };

  // --- 核心逻辑：执行扫描并自动调整宽度 ---
  const performScan = async (path: string) => {
    if (!path.trim()) return;
    
    setIsScanning(true);
    try {
      const tree = await scanProject(path, ignoreConfig);
      setFileTree(tree);
      setProjectRoot(path); // 确保 Store 更新
      
      // ✨ 自动调整宽度逻辑
      const idealWidth = calculateIdealTreeWidth(tree);
      
      // 用户体验优化：只有当新宽度显著大于当前宽度时才自动撑开
      if (idealWidth > contextSidebarWidth) {
         setContextSidebarWidth(idealWidth);
      }
      
      // 如果侧边栏是关着的，自动打开
      if (!isContextSidebarOpen) setContextSidebarOpen(true);

    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setIsScanning(false);
    }
  };

  // 处理：浏览文件夹
  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        recursive: false,
      });
      if (selected && typeof selected === 'string') {
        setPathInput(selected);
        await performScan(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 处理：输入框回车
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      performScan(pathInput);
    }
  };

  // --- 拖拽调整宽度逻辑 ---
  const isResizingRef = useRef(false);
  
  const startResizing = () => { isResizingRef.current = true; };
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      
      // 限制最小 200px，最大 800px (可在 tree_utils 或这里修改上限)
      const newWidth = Math.max(200, Math.min(e.clientX - 64, 800)); // 64 是左侧主 Sidebar 的宽度
      setContextSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setContextSidebarWidth]);

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* --- 顶部工具栏 (Header) --- */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-background/80 backdrop-blur z-10">
        
        {/* 侧边栏开关 */}
        <button 
          onClick={() => setContextSidebarOpen(!isContextSidebarOpen)} 
          className={cn(
            "p-2 rounded-md transition-colors", 
            !isContextSidebarOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-secondary"
          )}
          title={isContextSidebarOpen ? "Hide Explorer" : "Show Explorer"}
        >
          <PanelLeft size={18} />
        </button>

        {/* 路径输入栏 */}
        <div className="flex-1 flex items-center gap-2 bg-secondary/30 border border-border/50 rounded-md px-2 py-1 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all">
          <Search size={14} className="text-muted-foreground/50" />
          <input 
            className="flex-1 bg-transparent border-none outline-none text-sm h-8 placeholder:text-muted-foreground/40"
            placeholder="Paste path (e.g., E:\projects\my-app) or browse..."
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {/* Go 按钮 (如果输入了内容且不是当前路径) */}
          {pathInput && pathInput !== projectRoot && (
             <button onClick={() => performScan(pathInput)} className="p-1 hover:bg-primary hover:text-primary-foreground rounded-sm transition-colors">
               <ArrowRight size={14} />
             </button>
          )}
        </div>

        {/* 浏览按钮 */}
        <button 
          onClick={handleBrowse}
          className="flex items-center gap-2 px-3 py-1.5 bg-secondary hover:bg-secondary/80 border border-border rounded-md text-sm font-medium transition-colors whitespace-nowrap"
        >
          <FolderOpen size={16} />
          <span>Browse...</span>
        </button>

        {/* 刷新按钮 */}
        <button 
          onClick={() => performScan(projectRoot || '')}
          disabled={!projectRoot || isScanning}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors disabled:opacity-50"
          title="Rescan Folder"
        >
          <RefreshCw size={16} className={cn(isScanning && "animate-spin")} />
        </button>
      </div>

      {/* --- 主内容区 (左右分栏) --- */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* 左侧：文件树 Explorer */}
        <div 
          className={cn(
            "flex flex-col bg-secondary/5 border-r border-border transition-all duration-75 ease-linear overflow-hidden relative group/sidebar",
            !isContextSidebarOpen && "w-0 border-none opacity-0"
          )}
          style={{ width: isContextSidebarOpen ? `${contextSidebarWidth}px` : 0 }}
        >
          {/* Explorer Header */}
          <div className="p-3 border-b border-border/50 text-xs font-bold text-muted-foreground uppercase tracking-wider flex justify-between shrink-0 items-center">
             <span className="flex items-center gap-1"><FileJson size={12}/> EXPLORER</span>
             <span className="bg-secondary/50 px-1.5 py-0.5 rounded text-[10px]">{stats.fileCount} selected</span>
          </div>
          
          {/* File Tree Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 pb-10">
            {!projectRoot ? (
              <div className="mt-10 flex flex-col items-center justify-center text-muted-foreground opacity-50 gap-2 text-center px-4">
                <p className="text-sm">Enter a path or browse to open a project</p>
              </div>
            ) : isScanning ? (
              <div className="flex flex-col items-center justify-center mt-10 gap-3 text-sm text-muted-foreground animate-pulse">
                <Loader2 size={20} className="animate-spin text-primary" /> 
                <span>Scanning files...</span>
              </div>
            ) : fileTree.length === 0 ? (
              <div className="mt-10 text-center text-sm text-muted-foreground">Empty directory</div>
            ) : (
              fileTree.map(node => (
                <FileTreeNode 
                  key={node.id} 
                  node={node} 
                  onToggleSelect={toggleSelect} 
                />
              ))
            )}
          </div>

          {/* 拖拽手柄 (Resizer Handle) */}
          {isContextSidebarOpen && (
            <div 
              onMouseDown={startResizing}
              className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors z-20"
              title="Drag to resize"
            />
          )}
        </div>

        {/* 右侧：Token 仪表盘与操作区 */}
        <div className="flex-1 bg-background min-w-0 flex flex-col relative">
            {/* 背景网格装饰 */}
            <div className="absolute inset-0 bg-grid-slate-900/[0.04] bg-[bottom_1px_center] dark:bg-grid-slate-400/[0.05] [mask-image:linear-gradient(to_bottom,transparent,black)] pointer-events-none" />
            
            {/* 仪表盘组件 */}
            <TokenDashboard 
              stats={stats}
              onCopy={handleCopyContext}
              isGenerating={isGenerating}
            />
        </div>

      </div>

      {/* 底部 Toast 提示 */}
      <div className={cn(
        "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out pointer-events-none", 
        showToast ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}>
        <div className="bg-foreground/90 text-background px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-3 text-sm font-medium backdrop-blur-md border border-white/10">
          <CheckCircle2 size={18} className="text-green-400" />
          <div className="flex flex-col">
            <span>Context Copied!</span>
            <span className="text-[10px] opacity-70 font-normal">Ready to paste into ChatGPT/Claude</span>
          </div>
        </div>
      </div>

    </div>
  );
}