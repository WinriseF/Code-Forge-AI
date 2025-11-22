import { useState, useMemo, useEffect, useRef } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { writeText as writeClipboard } from '@tauri-apps/api/clipboard';
import { 
  FolderOpen, RefreshCw, Loader2, FileJson, 
  PanelLeft, Search, ArrowRight, CheckCircle2, SlidersHorizontal, ChevronUp,
  LayoutDashboard, FileText 
} from 'lucide-react';
import { useContextStore } from '@/store/useContextStore';
import { useAppStore, DEFAULT_MODELS } from '@/store/useAppStore'; // 引入默认值
import { scanProject } from '@/lib/fs_helper';
import { calculateIdealTreeWidth } from '@/lib/tree_utils';
import { calculateStats, generateContext } from '@/lib/context_assembler';
import { FileTreeNode } from './FileTreeNode';
import { TokenDashboard } from './TokenDashboard';
import { FilterManager } from './FilterManager';
import { ContextPreview } from './ContextPreview';
import { cn } from '@/lib/utils';

export function ContextView() {
  const { 
    projectRoot, fileTree, isScanning, 
    projectIgnore, updateProjectIgnore, 
    refreshTreeStatus, 
    setProjectRoot, setFileTree, setIsScanning, toggleSelect 
  } = useContextStore();

  const { 
    isContextSidebarOpen, setContextSidebarOpen,
    contextSidebarWidth, setContextSidebarWidth,
    globalIgnore,
    models // ✨ 现在类型是安全的，不需要 as any
  } = useAppStore(); 

  const [pathInput, setPathInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showFilters, setShowFilters] = useState(false); 
  const [rightViewMode, setRightViewMode] = useState<'dashboard' | 'preview'>('dashboard');

  // 兜底逻辑：如果 store 里的 models 为空（比如还没 sync 下来），使用默认值
  const activeModels = (models && models.length > 0) ? models : DEFAULT_MODELS;

  useEffect(() => {
    if (projectRoot) setPathInput(projectRoot);
  }, [projectRoot]);

  useEffect(() => {
    if (fileTree.length > 0) {
      refreshTreeStatus(globalIgnore);
    }
  }, [globalIgnore, projectIgnore, refreshTreeStatus]);

  const stats = useMemo(() => {
    return calculateStats(fileTree);
  }, [fileTree]);

  // --- Actions ---
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const handleCopyContext = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const { text, tokenCount } = await generateContext(fileTree);
      await writeClipboard(text);
      console.log(`Context copied! Actual tokens: ${tokenCount}`);
      triggerToast('Context copied to clipboard!');
    } catch (err) {
      console.error("Failed to copy:", err);
      triggerToast('Failed to copy context');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToFile = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const filePath = await save({
        filters: [{ name: 'Text File', extensions: ['txt', 'md', 'json'] }],
        defaultPath: 'context.txt'
      });
      if (!filePath) {
        setIsGenerating(false);
        return;
      }
      const { text } = await generateContext(fileTree);
      await writeTextFile(filePath, text);
      triggerToast('Context saved to file!');
    } catch (err) {
      console.error("Failed to save file:", err);
      triggerToast('Failed to save file');
    } finally {
      setIsGenerating(false);
    }
  };

  const performScan = async (path: string) => {
    if (!path.trim()) return;
    setIsScanning(true);
    try {
      // 合并全局和项目配置
      const effectiveConfig = {
        dirs: Array.from(new Set([...globalIgnore.dirs, ...projectIgnore.dirs])),
        files: Array.from(new Set([...globalIgnore.files, ...projectIgnore.files])),
        extensions: Array.from(new Set([...globalIgnore.extensions, ...projectIgnore.extensions])),
      };

      const tree = await scanProject(path, effectiveConfig);
      setFileTree(tree);
      setProjectRoot(path);
      
      const idealWidth = calculateIdealTreeWidth(tree);
      if (idealWidth > contextSidebarWidth) setContextSidebarWidth(idealWidth);
      if (!isContextSidebarOpen) setContextSidebarOpen(true);
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, recursive: false });
      if (selected && typeof selected === 'string') {
        setPathInput(selected);
        await performScan(selected);
      }
    } catch (err) { console.error(err); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') performScan(pathInput);
  };

  // Resizing Logic
  const isResizingRef = useRef(false);
  const startResizing = () => { isResizingRef.current = true; };
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(200, Math.min(e.clientX - 64, 800));
      setContextSidebarWidth(newWidth);
    };
    const handleMouseUp = () => { isResizingRef.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setContextSidebarWidth]);

  return (
    <div className="h-full flex flex-col bg-background relative">
      
      {/* Header Toolbar */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-background/80 backdrop-blur z-10">
        <button 
          onClick={() => setContextSidebarOpen(!isContextSidebarOpen)} 
          className={cn("p-2 rounded-md transition-colors", !isContextSidebarOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-secondary")}
        >
          <PanelLeft size={18} />
        </button>

        <div className="flex-1 flex items-center gap-2 bg-secondary/30 border border-border/50 rounded-md px-2 py-1 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all">
          <Search size={14} className="text-muted-foreground/50" />
          <input 
            className="flex-1 bg-transparent border-none outline-none text-sm h-8 placeholder:text-muted-foreground/40"
            placeholder="Paste path or browse..."
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {pathInput && pathInput !== projectRoot && (
             <button onClick={() => performScan(pathInput)} className="p-1 hover:bg-primary hover:text-primary-foreground rounded-sm transition-colors"><ArrowRight size={14} /></button>
          )}
        </div>

        <button onClick={handleBrowse} className="flex items-center gap-2 px-3 py-1.5 bg-secondary hover:bg-secondary/80 border border-border rounded-md text-sm font-medium transition-colors whitespace-nowrap">
          <FolderOpen size={16} /><span>Browse...</span>
        </button>
        <button onClick={() => performScan(projectRoot || '')} disabled={!projectRoot || isScanning} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors disabled:opacity-50">
          <RefreshCw size={16} className={cn(isScanning && "animate-spin")} />
        </button>
      </div>

      {/* Main Split View */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left Sidebar */}
        <div 
          className={cn("flex flex-col bg-secondary/5 border-r border-border transition-all duration-75 ease-linear overflow-hidden relative group/sidebar", !isContextSidebarOpen && "w-0 border-none opacity-0")}
          style={{ width: isContextSidebarOpen ? `${contextSidebarWidth}px` : 0 }}
        >
          <div className="p-3 border-b border-border/50 text-xs font-bold text-muted-foreground uppercase tracking-wider flex justify-between shrink-0 items-center">
             <span className="flex items-center gap-1"><FileJson size={12}/> EXPLORER</span>
             <span className="bg-secondary/50 px-1.5 py-0.5 rounded text-[10px]">{stats.fileCount} selected</span>
          </div>
          
          {/* File Tree */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {!projectRoot ? (
              <div className="mt-10 flex flex-col items-center justify-center text-muted-foreground opacity-50 gap-2 text-center px-4"><p className="text-sm">Enter a path to open</p></div>
            ) : isScanning ? (
              <div className="flex flex-col items-center justify-center mt-10 gap-3 text-sm text-muted-foreground animate-pulse"><Loader2 size={20} className="animate-spin text-primary" /><span>Scanning...</span></div>
            ) : fileTree.length === 0 ? (
              <div className="mt-10 text-center text-sm text-muted-foreground">Empty directory</div>
            ) : (
              fileTree.map(node => <FileTreeNode key={node.id} node={node} onToggleSelect={toggleSelect} />)
            )}
          </div>

          {/* Filters */}
          <div className="border-t border-border bg-background shrink-0 flex flex-col z-10">
              <button 
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider hover:bg-secondary/50 transition-colors"
              >
                  <span className="flex items-center gap-2"><SlidersHorizontal size={12}/> Filters</span>
                  <ChevronUp size={14} className={cn("transition-transform duration-200", showFilters ? "rotate-180" : "rotate-0")} />
              </button>
              {showFilters && (
                  <div className="h-64 p-3 bg-secondary/5 overflow-hidden border-t border-border/50 animate-in slide-in-from-bottom-2">
                      <FilterManager localConfig={projectIgnore} globalConfig={globalIgnore} onUpdate={updateProjectIgnore} />
                  </div>
              )}
          </div>
          
          {/* Resize Handle */}
          {isContextSidebarOpen && <div onMouseDown={startResizing} className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors z-20" />}
        </div>

        {/* Right Content */}
        <div className="flex-1 bg-background min-w-0 flex flex-col relative">
            <div className="absolute inset-0 bg-grid-slate-900/[0.04] bg-[bottom_1px_center] dark:bg-grid-slate-400/[0.05] [mask-image:linear-gradient(to_bottom,transparent,black)] pointer-events-none" />
            
            {/* View Toggle */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
               <div className="bg-secondary/80 backdrop-blur-md border border-border p-1 rounded-xl flex items-center shadow-sm pointer-events-auto">
                  <ViewToggleBtn 
                    active={rightViewMode === 'dashboard'} 
                    onClick={() => setRightViewMode('dashboard')}
                    icon={<LayoutDashboard size={14} />} 
                    label="Dashboard" 
                  />
                  <ViewToggleBtn 
                    active={rightViewMode === 'preview'} 
                    onClick={() => setRightViewMode('preview')}
                    icon={<FileText size={14} />} 
                    label="Preview" 
                  />
               </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pt-20 pb-10 h-full"> 
                {rightViewMode === 'dashboard' ? (
                   <TokenDashboard 
                     stats={stats}
                     fileTree={fileTree}
                     models={activeModels} // ✨ 传入处理后的 models
                     onCopy={handleCopyContext}
                     onSave={handleSaveToFile}
                     isGenerating={isGenerating}
                   />
                ) : (
                   <div className="h-full">
                      <ContextPreview fileTree={fileTree} />
                   </div>
                )}
            </div>
        </div>
      </div>

      {/* Toast */}
      <div className={cn("fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out pointer-events-none", showToast ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0")}>
        <div className="bg-foreground/90 text-background px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-3 text-sm font-medium backdrop-blur-md border border-white/10">
          <CheckCircle2 size={18} className="text-green-400" />
          <span>{toastMessage}</span>
        </div>
      </div>
    </div>
  );
}

// ... ViewToggleBtn component ...
function ViewToggleBtn({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
        active 
          ? "bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10" 
          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}