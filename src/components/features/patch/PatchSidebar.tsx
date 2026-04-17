import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Sparkles, FileCode,
  CheckCircle2, ArrowRightLeft, Loader2,
  Copy, ChevronDown, ChevronRight, Trash2, Info, GitMerge,
  RefreshCw, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CommitSelector } from './CommitSelector';
import { PatchFileItem, PatchMode } from './patch_types';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useTranslation } from 'react-i18next';
import { useSmartContextMenu } from '@/lib/hooks';
import { buildPatchFileTree, flattenPatchTree, allDirIds } from '@/lib/patch_tree_utils';
import { PatchFileTreeNode } from './PatchFileTreeNode';

const AI_SYSTEM_PROMPT = `You are an elite coding agent. Generate precise code patches from the user's request.

Core rules:
- Be precise, minimal, and safe. Only change files directly related to the request.
- Preserve existing code style, naming, and architecture.
- Do not introduce unrelated refactors or speculative changes.
- If required context is missing, ask one concise question instead of guessing.

Output requirements (strict):
- Reply in Chinese.
- Reply with Markdown code block content only.
- Do NOT use YAML, JSON, or prose explanations.
- Every changed file must start with: File: path/to/file.ext
- Every change must use this exact block format:

<<<<<<< SEARCH
[Exact existing code to locate]
=======
[Replacement code]
>>>>>>> REPLACE

SEARCH/REPLACE constraints:
- SEARCH must be exact, contiguous text from the current file.
- Keep SEARCH as small as possible while uniquely matching.
- Preserve indentation and surrounding syntax correctness.
- For multiple edits in one file, output multiple SEARCH/REPLACE blocks under the same File header.

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

My request as input is:`;

// 定义工作区的虚拟 Commit 对象
const WORK_DIR_OPTION: GitCommit = {
  hash: "__WORK_DIR__",
  author: "You",
  date: "Now",
  message: "Working Directory (Unsaved Changes)"
};

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface PatchSidebarProps {
  mode: PatchMode;
  setMode: (m: PatchMode) => void;

  workspaceRoot: string | null;
  yamlInput: string;
  onYamlChange: (val: string) => void;
  onClearYaml: () => void;

  files: PatchFileItem[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;

  commits: GitCommit[];
  baseHash: string;
  setBaseHash: (h: string) => void;
  compareHash: string;
  setCompareHash: (h: string) => void;
  onCompare: () => void;
  isGitLoading: boolean;
  gitError: string | null;
  repositoryLoaded: boolean;
  onRefreshRepository: () => void;

  selectedExportIds?: Set<string>;
  onToggleExport?: (id: string, checked: boolean) => void;
}

export function PatchSidebar({
  mode, setMode,
  workspaceRoot,
  yamlInput, onYamlChange, onClearYaml,
  files, selectedFileId, onSelectFile,
  commits,
  baseHash, setBaseHash, compareHash, setCompareHash,
  onCompare, isGitLoading, gitError, repositoryLoaded, onRefreshRepository,
  selectedExportIds,
  onToggleExport
}: PatchSidebarProps) {

  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [expandedDirIds, setExpandedDirIds] = useState<Set<string>>(new Set());
  const prevFilesRef = useRef<PatchFileItem[]>([]);
  const { t } = useTranslation();

  // Derive lists from `files` (stable state) — used for display counts + manual file
  const manualFile = files.find(f => f.isManual);
  const gitFileCount = files.filter(f => f.gitStatus).length;
  const aiFileCount = files.filter(f => !f.isManual && !f.gitStatus).length;

  // Build trees — dependency is `files` (stable state reference, won't cause loops)
  const gitTree = useMemo(
    () => buildPatchFileTree(files.filter(f => f.gitStatus)),
    [files],
  );
  const aiTree = useMemo(
    () => buildPatchFileTree(files.filter(f => !f.isManual && !f.gitStatus)),
    [files],
  );

  // Flatten trees for rendering
  const gitFlat = useMemo(
    () => flattenPatchTree(gitTree, expandedDirIds),
    [gitTree, expandedDirIds],
  );
  const aiFlat = useMemo(
    () => flattenPatchTree(aiTree, expandedDirIds),
    [aiTree, expandedDirIds],
  );

  // Auto-expand top-level dirs when the file list changes
  useEffect(() => {
    if (files === prevFilesRef.current) return;
    prevFilesRef.current = files;

    const ids = [...allDirIds(gitTree), ...allDirIds(aiTree)];
    if (ids.length > 0) {
      setExpandedDirIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    }
  }, [files, gitTree, aiTree]);

  const toggleExpand = (id: string) => {
    setExpandedDirIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCopyPrompt = async () => {
    await writeText(AI_SYSTEM_PROMPT);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handlePaste = (pastedText: string, textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    const newValue = value.substring(0, selectionStart) + pastedText + value.substring(selectionEnd);
    onYamlChange(newValue);
    setTimeout(() => {
      if (textarea) {
        const newCursorPos = selectionStart + pastedText.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const { onContextMenu } = useSmartContextMenu({ onPaste: handlePaste });

  const hasWorkspace = !!workspaceRoot;
  const canShowRepoControls = hasWorkspace && repositoryLoaded && !gitError;

  // 将 WorkDir 选项合并到 commit 列表头部
  const compareCommits = [WORK_DIR_OPTION, ...commits];

  return (
    <div className="w-[350px] flex flex-col border-r border-border bg-secondary/10 h-full select-none">

      <div className="p-4 border-b border-border bg-background shadow-sm z-10 shrink-0">
        <div className="flex bg-secondary p-1 rounded-lg border border-border/50">
           <button
             onClick={() => setMode('diff')}
             className={cn(
               "relative flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-colors outline-none",
               mode === 'diff' ? "text-primary" : "text-muted-foreground hover:text-foreground"
             )}
           >
             {mode === 'diff' && (
                <motion.div
                    layoutId="patch-mode-switch"
                    className="absolute inset-0 bg-background shadow-sm rounded-md border border-border/50"
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                />
             )}
             <span className="relative z-10 flex items-center gap-2">
                <ArrowRightLeft size={14} /> {t('patch.manual')}
             </span>
           </button>
           <button
             onClick={() => setMode('patch')}
             className={cn(
               "relative flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-colors outline-none",
               mode === 'patch' ? "text-primary" : "text-muted-foreground hover:text-foreground"
             )}
           >
             {mode === 'patch' && (
                <motion.div
                    layoutId="patch-mode-switch"
                    className="absolute inset-0 bg-background shadow-sm rounded-md border border-border/50"
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                />
             )}
             <span className="relative z-10 flex items-center gap-2">
                <Sparkles size={14} /> {t('patch.aiPatch')}
             </span>
           </button>
         </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {mode === 'patch' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="bg-background border-b border-border shrink-0">
                  <button onClick={() => setIsPromptOpen(!isPromptOpen)} className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider hover:bg-secondary/50 transition-colors">
                      <span className="flex items-center gap-1.5"><Info size={12} /> {t('patch.aiInstruction')}</span>
                      {isPromptOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {isPromptOpen && (
                      <div className="px-4 pb-3 animate-in slide-in-from-top-2 duration-200">
                          <div className="bg-secondary/30 rounded-lg border border-border p-2 space-y-2">
                              <p className="text-[10px] text-muted-foreground leading-relaxed">{t('patch.promptTip')}</p>
                              <button onClick={handleCopyPrompt} className={cn("w-full flex items-center justify-center gap-2 py-1.5 rounded text-xs font-medium transition-all", isCopied ? "bg-green-500 text-white shadow-sm" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm")}>
                                  {isCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                                  {isCopied ? t('patch.copied') : t('patch.copySystemPrompt')}
                              </button>
                          </div>
                      </div>
                  )}
              </div>
              <div className="flex-1 flex flex-col min-h-0 border-b border-border bg-background">
                <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-secondary/5 shrink-0">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><FileCode size={12} /> {t('patch.aiResponseInput')}</span>
                  <button onClick={onClearYaml} className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors" title={t('common.clear')}>
                      <Trash2 size={12} />
                  </button>
                </div>
                <textarea value={yamlInput} onChange={e => onYamlChange(e.target.value)} onContextMenu={onContextMenu} placeholder={t('patch.pasteAIResponse') + '\n\nFile: src/windows/main/MainWindowApp.tsx\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE'} className="flex-1 w-full bg-transparent p-4 resize-none outline-none font-mono text-[11px] leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30 text-muted-foreground focus:text-foreground transition-colors" spellCheck="false" />
              </div>
              <div className="h-[40%] flex flex-col min-h-0 bg-secondary/5">
                <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-secondary/10 shrink-0">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><FileText size={12} /> Changes ({aiFileCount})</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {aiFlat.map(({ node, depth }) => (
                    <div key={node.id} style={{ height: 28, position: 'relative' }}>
                      <PatchFileTreeNode
                        node={node}
                        depth={depth}
                        isExpanded={expandedDirIds.has(node.id)}
                        isSelected={node.kind === 'file' && selectedFileId === node.id}
                        isChecked={false}
                        isDisabled={false}
                        showCheckbox={false}
                        onSelectFile={onSelectFile}
                        onToggleExpand={toggleExpand}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {mode === 'diff' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b border-border bg-background/80 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><GitMerge size={12}/> Git Snapshot Compare</h3>
                  <button
                    type="button"
                    onClick={onRefreshRepository}
                    disabled={!workspaceRoot || isGitLoading}
                    title={t('workspace.rescan')}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={cn(isGitLoading && 'animate-spin')} />
                  </button>
                </div>

                {canShowRepoControls ? (
                  <div className="space-y-3 animate-in fade-in duration-300">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground">{t('patch.baseVersion')}</label>
                      <CommitSelector commits={commits} selectedValue={baseHash} onSelect={setBaseHash} disabled={isGitLoading} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground">{t('patch.compareVersion')}</label>
                      {/* 这里使用新的 compareCommits 列表 */}
                      <CommitSelector commits={compareCommits} selectedValue={compareHash} onSelect={setCompareHash} disabled={isGitLoading} />
                    </div>
                    <button onClick={onCompare} disabled={isGitLoading || !baseHash || !compareHash} className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 active:scale-95 shadow-sm shadow-primary/20">
                      {isGitLoading ? <Loader2 size={14} className="animate-spin"/> : <GitMerge size={14}/>}
                      {isGitLoading ? t('patch.comparing') : t('patch.generateDiff')}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-secondary/15 px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <div>
                          {!workspaceRoot
                            ? t('workspace.selectHint')
                            : gitError
                              ? t('common.errorMsg', { msg: gitError })
                              : t('workspace.loadHint')}
                        </div>
                        {(gitError || (workspaceRoot && !repositoryLoaded)) && (
                          <button
                            type="button"
                            onClick={onRefreshRepository}
                            disabled={!workspaceRoot || isGitLoading}
                            className="text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
                          >
                            {t('workspace.rescan')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col min-h-0 bg-secondary/5">
                <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-secondary/10 shrink-0">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><FileText size={12} /> Changes ({gitFileCount})</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                  {manualFile && (
                    <button onClick={() => onSelectFile(manualFile.id)} className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group border", selectedFileId === manualFile.id ? "bg-background text-primary border-border shadow-sm" : "border-dashed border-border/50 hover:bg-background/60 text-muted-foreground hover:text-foreground")}>
                      <ArrowRightLeft size={14} />
                      <span className="font-medium">{manualFile.path}</span>
                    </button>
                  )}

                  {gitFlat.length > 0 && manualFile && <div className="h-px bg-border/50 my-2"/>}

                  {gitFlat.map(({ node, depth }) => (
                    <div key={node.id} style={{ height: 28, position: 'relative' }}>
                      <PatchFileTreeNode
                        node={node}
                        depth={depth}
                        isExpanded={expandedDirIds.has(node.id)}
                        isSelected={node.kind === 'file' && selectedFileId === node.id}
                        isChecked={selectedExportIds?.has(node.id) ?? false}
                        isDisabled={node.fileData?.isBinary || node.fileData?.isLarge || false}
                        showCheckbox={true}
                        onSelectFile={onSelectFile}
                        onToggleExpand={toggleExpand}
                        onToggleExport={onToggleExport}
                      />
                    </div>
                  ))}

                  {files.length <= 1 && (!workspaceRoot || !!gitError || !repositoryLoaded) && (
                    <div className="text-center text-xs text-muted-foreground/60 p-4">
                      {t('patch.gitTip')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
