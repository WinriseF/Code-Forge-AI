import { useState } from 'react';
import { 
  FolderOpen, FileText, Sparkles, AlertCircle, FileCode, 
  CheckCircle2, XCircle, ArrowRightLeft, Loader2, 
  Copy, ChevronDown, ChevronRight, Trash2, Info 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PatchFileItem, PatchMode } from './patch_types';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '@/store/useAppStore'; 
import { getText } from '@/lib/i18n';
import { useSmartContextMenu } from '@/lib/hooks';

const AI_SYSTEM_PROMPT = `You are a top-tier software engineer. Generate a code patch based on the user's request.

IMPORTANT: You must use the "SEARCH/REPLACE" block format. Do NOT use YAML or JSON. Reply in Chinese and wrap the content in Markdown code format.

Format Rules:
1. Start each file with "File: path/to/file.ext"
2. Use the following block structure for EVERY change:

<<<<<<< SEARCH
[Exact code content to find]
=======
[New code content to replace with]
>>>>>>> REPLACE

Example:

File: src/utils.ts
<<<<<<< SEARCH
export function add(a, b) {
  return a + b;
}
=======
export function add(a: number, b: number): number {
  return a + b;
}
>>>>>>> REPLACE

My request is:`;

interface PatchSidebarProps {
  mode: PatchMode;
  setMode: (m: PatchMode) => void;
  projectRoot: string | null;
  onLoadProject: () => void;
  yamlInput: string;
  onYamlChange: (val: string) => void;
  onClearYaml: () => void;
  files: PatchFileItem[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
}

export function PatchSidebar({
  mode, setMode,
  projectRoot, onLoadProject,
  yamlInput, onYamlChange, onClearYaml,
  files, selectedFileId, onSelectFile
}: PatchSidebarProps) {
  
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { language } = useAppStore();

  const handleCopyPrompt = async () => {
    await writeText(AI_SYSTEM_PROMPT);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // 定义粘贴逻辑并通过 Hook 获取 onContextMenu
  const handlePaste = (pastedText: string, textarea: HTMLTextAreaElement | null) => {
    // --- 增加空值检查 ---
    if (!textarea) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const newValue = value.substring(0, selectionStart) + pastedText + value.substring(selectionEnd);
    onYamlChange(newValue);

    // 异步更新光标位置
    setTimeout(() => {
      // 在 timeout 内部再次检查
      if (textarea) {
        const newCursorPos = selectionStart + pastedText.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const { onContextMenu } = useSmartContextMenu({ onPaste: handlePaste });

  return (
    <div className="w-[350px] flex flex-col border-r border-border bg-secondary/10 h-full select-none">
      
      {/* 1. Header */}
      <div className="p-4 border-b border-border bg-background space-y-4 shadow-sm z-10 shrink-0">
        <div className="flex bg-secondary p-1 rounded-lg border border-border/50">
           <button 
             onClick={() => setMode('patch')}
             className={cn(
               "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-all",
               mode === 'patch' ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
             )}
           >
             <Sparkles size={14} /> AI Patch
           </button>
           <button 
             onClick={() => setMode('diff')}
             className={cn(
               "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-all",
               mode === 'diff' ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
             )}
           >
             <ArrowRightLeft size={14} /> Manual
           </button>
        </div>

        {mode === 'patch' && (
          <button 
            onClick={onLoadProject}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all",
              projectRoot 
                ? "bg-background border-border text-foreground shadow-sm hover:border-primary/50" 
                : "bg-primary/5 border-dashed border-primary/30 text-primary hover:bg-primary/10"
            )}
            title={projectRoot || "Select folder"}
          >
            <div className="flex items-center gap-2 truncate">
                <FolderOpen size={14} className={projectRoot ? "text-blue-500" : "shrink-0"} />
                <span className="truncate font-medium">{projectRoot || getText('context', 'browse', language)}</span>
            </div>
            {projectRoot && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
          </button>
        )}
      </div>

      {/* 2. Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {mode === 'patch' && (
            <div className="bg-background border-b border-border shrink-0">
                <button 
                    onClick={() => setIsPromptOpen(!isPromptOpen)}
                    className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider hover:bg-secondary/50 transition-colors"
                >
                    <span className="flex items-center gap-1.5">
                        <Info size={12} /> AI Instruction
                    </span>
                    {isPromptOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                
                {isPromptOpen && (
                    <div className="px-4 pb-3 animate-in slide-in-from-top-2 duration-200">
                        <div className="bg-secondary/30 rounded-lg border border-border p-2 space-y-2">
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                                Use this prompt to get the correct SEARCH/REPLACE format.
                            </p>
                            <button 
                                onClick={handleCopyPrompt}
                                className={cn(
                                    "w-full flex items-center justify-center gap-2 py-1.5 rounded text-xs font-medium transition-all",
                                    isCopied 
                                        ? "bg-green-500 text-white shadow-sm" 
                                        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                                )}
                            >
                                {isCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                                {isCopied ? "Copied!" : "Copy System Prompt"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
          )}

          {/* Input Area */}
          {mode === 'patch' && (
            <div className="flex-1 flex flex-col min-h-0 border-b border-border bg-background">
              <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-secondary/5 shrink-0">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                   <FileCode size={12} /> AI Response Input
                </span>
                <button 
                    onClick={onClearYaml}
                    className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                    title="Clear"
                >
                    <Trash2 size={12} />
                </button>
              </div>
              <textarea
                value={yamlInput}
                onChange={e => onYamlChange(e.target.value)}
                onContextMenu={onContextMenu}
                placeholder={`Paste AI response here...\n\nFile: src/App.tsx\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE`}
                className="flex-1 w-full bg-transparent p-4 resize-none outline-none font-mono text-[11px] leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30 text-muted-foreground focus:text-foreground transition-colors"
                spellCheck="false"
              />
            </div>
          )}

          {/* Files List */}
          <div className={cn("flex flex-col min-h-0 bg-secondary/5", mode === 'patch' ? "h-[40%]" : "flex-1")}>
            <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-secondary/10 shrink-0">
               <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                 <FileText size={12} /> Changes ({files.length})
               </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-2">
                  <AlertCircle size={20} />
                  <span className="text-xs">No files detected</span>
                </div>
              ) : (
                files.map(file => (
                  <button
                    key={file.id}
                    onClick={() => onSelectFile(file.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group border border-transparent",
                      selectedFileId === file.id 
                        ? "bg-background text-primary border-border shadow-sm" 
                        : "hover:bg-background/60 text-muted-foreground hover:text-foreground hover:border-border/50"
                    )}
                  >
                    <div className="shrink-0">
                        {file.status === 'success' && <CheckCircle2 size={14} className="text-green-500" />}
                        {file.status === 'error' && <XCircle size={14} className="text-destructive" />}
                        {file.status === 'pending' && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                    </div>
                    
                    <div className="flex-1 min-w-0 flex flex-col items-start gap-0.5">
                        <span className="truncate font-medium w-full text-left" title={file.path}>{file.path}</span>
                        {file.errorMsg && <span className="text-[10px] text-destructive truncate w-full text-left">{file.errorMsg}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
      </div>
    </div>
  );
}