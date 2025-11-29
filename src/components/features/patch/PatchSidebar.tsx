import { useState } from 'react';
import { 
  FolderOpen, FileText, Sparkles, AlertCircle, FileCode, 
  CheckCircle2, XCircle, ArrowRightLeft, Loader2, 
  Copy, ChevronDown, ChevronRight, Trash2, Info 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PatchFileItem, PatchMode } from './patch_types';
import { writeText } from '@tauri-apps/api/clipboard';
import { useAppStore } from '@/store/useAppStore'; // 引入 Store 以获取语言
import { getText } from '@/lib/i18n';

// --- 常量：AI 提示词 ---
const AI_SYSTEM_PROMPT = `你是一位顶级的软件工程师。请针对用户的需求，生成一个多文件代码修改补丁。
请严格遵循 "CodeForge Project Patch" (YAML) 格式。

格式规范：
是一个 YAML 列表，每个列表项包含：
- file: <相对路径，例如 src/components/App.tsx>
- replace: (可选) 代码替换操作
    original: |
      <精确的原始代码块>
    modified: |
      <修改后的代码块>
- insert_after: (可选) 代码插入操作
    anchor: |
      <插入点锚定行>
    content: |
      <要插入的新代码>

示例：
- file: src/utils.ts
  replace:
    original: |
      export const sum = (a, b) => a + b;
    modified: |
      export const sum = (a: number, b: number) => a + b;

注意：不要输出任何Markdown代码块标记，直接输出纯 YAML 内容。`;

interface PatchSidebarProps {
  mode: PatchMode;
  setMode: (m: PatchMode) => void;
  projectRoot: string | null;
  onLoadProject: () => void;
  yamlInput: string;
  onYamlChange: (val: string) => void;
  onClearYaml: () => void; // ✨ 新增：清空回调
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

  return (
    <div className="w-[350px] flex flex-col border-r border-border bg-secondary/10 h-full select-none">
      
      {/* 1. Header: Mode & Project */}
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

      {/* 2. Scrollable Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* Section: AI Prompt Helper (NEW) */}
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
                                Paste this prompt to AI (ChatGPT/Claude) to get the correct YAML format.
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

          {/* Section: Input */}
          {mode === 'patch' && (
            <div className="flex-1 flex flex-col min-h-0 border-b border-border bg-background">
              <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-secondary/5 shrink-0">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                   <FileCode size={12} /> AI YAML Input
                </span>
                {/* Clear Button */}
                <button 
                    onClick={onClearYaml}
                    className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                    title="Clear Input"
                >
                    <Trash2 size={12} />
                </button>
              </div>
              <textarea
                value={yamlInput}
                onChange={e => onYamlChange(e.target.value)}
                placeholder="Paste the YAML here..."
                className="flex-1 w-full bg-transparent p-4 resize-none outline-none font-mono text-[11px] leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30 text-muted-foreground focus:text-foreground transition-colors"
                spellCheck="false"
              />
            </div>
          )}

          {/* Section: Files List */}
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