import { useState } from 'react';
import { Save, Copy, ArrowDownUp, PanelLeftClose, PanelLeftOpen } from 'lucide-react'; // ✨ 引入图标
import { DiffViewer } from './DiffViewer';
import { PatchFileItem } from './patch_types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';
import { getText } from '@/lib/i18n';

interface DiffWorkspaceProps {
  selectedFile: PatchFileItem | null;
  onSave: (file: PatchFileItem) => void;
  onCopy: (content: string) => void;
  onManualUpdate?: (original: string, modified: string) => void;
  // ✨ 新增 Props
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function DiffWorkspace({ 
    selectedFile, onSave, onCopy, onManualUpdate, 
    isSidebarOpen, onToggleSidebar 
}: DiffWorkspaceProps) {
  
  const { language } = useAppStore();
  const [showInputs, setShowInputs] = useState(true);

  // 即使没有文件，我们现在也需要显示 Toolbar 以便能把 Sidebar 切换回来
  // 所以我们把 Toolbar 提取出来或者直接修改结构
  
  const hasChanges = selectedFile ? selectedFile.original !== selectedFile.modified : false;
  const isManual = selectedFile ? !!selectedFile.isManual : false;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background h-full animate-in fade-in duration-300">
      
      {/* 1. Toolbar */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur shrink-0 z-20 gap-4">
        
        {/* Left Side: Sidebar Toggle & File Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* ✨ 切换按钮 */}
            <button 
                onClick={onToggleSidebar}
                className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
            >
                {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>

            {selectedFile && (
                <div className="flex flex-col min-w-0">
                    <h2 className="text-sm font-semibold flex items-center gap-2 truncate">
                        <span className="truncate" title={selectedFile.path}>{selectedFile.path}</span>
                        {hasChanges ? 
                            <span className="shrink-0 text-[10px] bg-yellow-500/10 text-yellow-600 px-2 py-0.5 rounded-full border border-yellow-500/20 font-medium">Modified</span> :
                            <span className="shrink-0 text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-medium">No Changes</span>
                        }
                    </h2>
                    <span className="text-[10px] text-muted-foreground/60 truncate font-mono mt-0.5">
                        {selectedFile.id}
                    </span>
                </div>
            )}
        </div>

        {/* Right Side: Actions */}
        <div className="flex items-center gap-2 shrink-0">
            {selectedFile && isManual && (
                <button 
                    onClick={() => setShowInputs(!showInputs)}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all mr-2",
                        showInputs ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                    )}
                >
                    <ArrowDownUp size={14} /> {showInputs ? "Hide Inputs" : "Edit Text"}
                </button>
            )}

            {selectedFile && (
                <button 
                    onClick={() => onCopy(selectedFile.modified)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground transition-colors active:scale-95"
                >
                    <Copy size={14} /> {getText('spotlight', 'copy', language)}
                </button>
            )}
            
            {selectedFile && !isManual && (
                <button 
                    onClick={() => onSave(selectedFile)}
                    disabled={!hasChanges}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shadow-sm active:scale-95",
                        hasChanges 
                            ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                            : "bg-secondary text-muted-foreground opacity-50 cursor-not-allowed"
                    )}
                >
                    <Save size={14} /> {getText('patch', 'saveChanges', language)}
                </button>
            )}
        </div>
      </div>

      {/* 2. Content Area */}
      {!selectedFile ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-background/50 h-full text-muted-foreground/40 gap-2">
             <div className="p-4 bg-secondary/30 rounded-full">
                <PanelLeftOpen size={32} className="opacity-50" />
             </div>
             <p className="text-xs">Select a file from the sidebar to view diff</p>
          </div>
      ) : (
          <>
            {/* Manual Inputs */}
            {isManual && showInputs && (
                <div className="h-[200px] shrink-0 flex border-b border-border bg-secondary/5">
                    <div className="flex-1 flex flex-col border-r border-border">
                        <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase bg-secondary/10 border-b border-border/50">Original Text</div>
                        <textarea 
                            value={selectedFile.original}
                            onChange={(e) => onManualUpdate?.(e.target.value, selectedFile.modified)}
                            className="flex-1 bg-transparent p-3 resize-none outline-none font-mono text-xs leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30"
                            placeholder="Paste original text here..."
                            spellCheck={false}
                        />
                    </div>
                    <div className="flex-1 flex flex-col">
                        <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase bg-secondary/10 border-b border-border/50">Modified Text</div>
                        <textarea 
                            value={selectedFile.modified}
                            onChange={(e) => onManualUpdate?.(selectedFile.original, e.target.value)}
                            className="flex-1 bg-transparent p-3 resize-none outline-none font-mono text-xs leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30"
                            placeholder="Paste modified text here..."
                            spellCheck={false}
                        />
                    </div>
                </div>
            )}

            {/* Diff Viewer */}
            <div className="flex-1 relative overflow-hidden bg-background">
                <div className="absolute inset-0 bg-grid-slate-900/[0.02] dark:bg-grid-slate-400/[0.02] bg-[bottom_1px_center] pointer-events-none" />
                <DiffViewer 
                original={selectedFile.original}
                modified={selectedFile.modified}
                placeholder={isManual ? "Paste text above to compare" : "Waiting for inputs..."}
                />
            </div>
          </>
      )}
    </div>
  );
}