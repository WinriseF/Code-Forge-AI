import { motion } from "framer-motion";
import { useState, useMemo, useEffect, useRef, type CSSProperties, memo } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { basename } from '@tauri-apps/api/path';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { writeText as writeClipboard } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';

const CONTEXT_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-context|';
import {
  RefreshCw, Loader2, FileJson,
  PanelLeft, SlidersHorizontal, ChevronUp,
  LayoutDashboard, FileText, ArrowRightLeft, GitBranch, Sparkles
} from 'lucide-react';
import { useContextStore } from '@/store/useContextStore';
import { useAppStore, DEFAULT_MODELS } from '@/store/useAppStore';
import { usePreviewStore } from '@/store/usePreviewStore';
import { scanProject } from '@/lib/fs_helper';
import { calculateIdealTreeWidth, flattenTree } from '@/lib/tree_utils';
import { getSelectedPaths, generateHeader } from '@/lib/context_assembler';
import { FileTreeNode } from './FileTreeNode';
import { TokenDashboard } from './TokenDashboard';
import { FilterManager } from './FilterManager';
import { ContextPreview } from './ContextPreview';
import { ScanResultDialog, SecretMatch } from './ScanResultDialog';
import { AiSelectionPanel } from './AiSelectionPanel';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Toast, ToastType } from '@/components/ui/Toast';
import { FileNode } from '@/types/context';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useShallow } from 'zustand/react/shallow';

interface FlatNode {
  node: FileNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  displaySelected: boolean;
  displayPartial: boolean;
}

interface RowProps {
  index: number;
  style: CSSProperties;
  data: {
    items: FlatNode[];
    onToggleSelect: (id: string, checked: boolean) => void;
    onToggleExpand: (id: string) => void;
    onPreview?: (path: string) => void;
  };
}

const Row = memo(function Row({ index, style, data }: RowProps) {
  const { items, onToggleSelect, onToggleExpand, onPreview } = data;
  const item = items[index];

  return (
    <FileTreeNode
      node={item.node}
      depth={item.depth}
      isExpanded={item.isExpanded}
      hasChildren={item.hasChildren}
      displaySelected={item.displaySelected}
      displayPartial={item.displayPartial}
      style={style}
      onToggleSelect={onToggleSelect}
      onToggleExpand={onToggleExpand}
      onPreview={onPreview}
    />
  );
});

interface NodeUiState {
  isSelected: boolean;
  isExpanded?: boolean;
}

function buildNodeStateMap(nodes: FileNode[]): Map<string, NodeUiState> {
  const map = new Map<string, NodeUiState>();
  const walk = (items: FileNode[]) => {
    for (const node of items) {
      map.set(node.id, { isSelected: node.isSelected, isExpanded: node.isExpanded });
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
}

function mergeTreeUiState(nextTree: FileNode[], prevTree: FileNode[]): FileNode[] {
  if (prevTree.length === 0) {
    return nextTree;
  }

  const prevStateMap = buildNodeStateMap(prevTree);
  const mergeNode = (node: FileNode, parentLocked = false): FileNode => {
    const prev = prevStateMap.get(node.id);
    const isLocked = parentLocked || !!node.isLocked;
    const merged: FileNode = {
      ...node,
      isSelected: isLocked ? false : (prev?.isSelected ?? node.isSelected),
      isExpanded: prev?.isExpanded ?? node.isExpanded,
    };

    if (node.children && node.children.length > 0) {
      merged.children = node.children.map(child => mergeNode(child, isLocked));
    }
    return merged;
  };

  return nextTree.map(node => mergeNode(node));
}

export function ContextView() {
  const { t } = useTranslation();
  const [
    scannedProjectRoot,
    fileTree,
    isScanning,
    projectIgnore,
    updateProjectIgnore,
    refreshTreeStatus,
    setFileTree,
    setIsScanning,
    toggleSelect,
    applySelectionByPaths,
    removeComments,
    detectSecrets,
    invertSelection,
    expandedIds,
    toggleExpand,
    hasProjectIgnoreFiles,
    isIgnoreSyncActive,
    toggleIgnoreSync,
    checkIgnoreFiles
  ] = useContextStore(
    useShallow((state) => [
      state.scannedProjectRoot,
      state.fileTree,
      state.isScanning,
      state.projectIgnore,
      state.updateProjectIgnore,
      state.refreshTreeStatus,
      state.setFileTree,
      state.setIsScanning,
      state.toggleSelect,
      state.applySelectionByPaths,
      state.removeComments,
      state.detectSecrets,
      state.invertSelection,
      state.expandedIds,
      state.toggleExpand,
      state.hasProjectIgnoreFiles,
      state.isIgnoreSyncActive,
      state.toggleIgnoreSync,
      state.checkIgnoreFiles
    ])
  );

  const [
    isContextSidebarOpen,
    setContextSidebarOpen,
    contextSidebarWidth,
    setContextSidebarWidth,
    globalIgnore,
    models,
    globalProjectRoot
  ] = useAppStore(
    useShallow((state) => [
      state.isContextSidebarOpen,
      state.setContextSidebarOpen,
      state.contextSidebarWidth,
      state.setContextSidebarWidth,
      state.globalIgnore,
      state.models,
      state.projectRoot
    ])
  );

  const openPreview = usePreviewStore((state) => state.openPreview);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAiSelectionOpen, setIsAiSelectionOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false); 
  const [rightViewMode, setRightViewMode] = useState<'dashboard' | 'preview'>('dashboard');
  const ignoreSyncInitializedRef = useRef(false);
  const ignoreRescanInitializedRef = useRef(false);
  const ignoreRescanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalProjectRootRef = useRef<string | null>(null);
  const scanRequestIdRef = useRef(0);

  const [toastState, setToastState] = useState<{ show: boolean; msg: string; type: ToastType }>({
      show: false,
      msg: '',
      type: 'success'
  });

  const [scanState, setScanState] = useState<{
    isOpen: boolean;
    results: SecretMatch[];
    pendingText: string;
    pendingAction: 'copy' | 'save' | null;
    pendingSavePath?: string;
  }>({
    isOpen: false,
    results: [],
    pendingText: '',
    pendingAction: null
  });

  const activeModels = (models && models.length > 0) ? models : DEFAULT_MODELS;

  useEffect(() => {
    globalProjectRootRef.current = globalProjectRoot;
  }, [globalProjectRoot]);

  useEffect(() => {
    if (!globalProjectRoot || scannedProjectRoot === globalProjectRoot) {
      return;
    }

    const timer = setTimeout(() => {
      if (useAppStore.getState().projectRoot !== globalProjectRoot) {
        return;
      }
      if (useContextStore.getState().scannedProjectRoot === globalProjectRoot) {
        return;
      }

      void performScan(globalProjectRoot);
    }, 150);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalProjectRoot, scannedProjectRoot, projectIgnore, globalIgnore, isIgnoreSyncActive]);

  useEffect(() => {
    if (fileTree.length > 0) {
      refreshTreeStatus(globalIgnore);
    }
  }, [globalIgnore, projectIgnore, refreshTreeStatus, isIgnoreSyncActive]);

  useEffect(() => {
    if (!ignoreSyncInitializedRef.current) {
      ignoreSyncInitializedRef.current = true;
      return;
    }

    const root = globalProjectRootRef.current;
    if (!root || scannedProjectRoot !== root) return;
    void performScan(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIgnoreSyncActive]);

  useEffect(() => {
    if (!ignoreRescanInitializedRef.current) {
      ignoreRescanInitializedRef.current = true;
      return;
    }

    if (ignoreRescanTimerRef.current) {
      clearTimeout(ignoreRescanTimerRef.current);
    }

    ignoreRescanTimerRef.current = setTimeout(() => {
      const root = globalProjectRootRef.current;
      if (!root || scannedProjectRoot !== root) return;
      void performScan(root);
    }, 400);

    return () => {
      if (ignoreRescanTimerRef.current) {
        clearTimeout(ignoreRescanTimerRef.current);
        ignoreRescanTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalIgnore, projectIgnore, scannedProjectRoot]);

  const selectedFileCount = useMemo(() => {
    let count = 0;
    const traverse = (nodes: typeof fileTree) => {
      for (const node of nodes) {
        if (node.kind === 'file' && node.isSelected) count++;
        if (node.children) traverse(node.children);
      }
    };
    traverse(fileTree);
    return count;
  }, [fileTree]);

  const flatData = useMemo(() => {
    return flattenTree(fileTree, expandedIds);
  }, [fileTree, expandedIds]);

  const rowData = useMemo(() => ({
    items: flatData,
    onToggleSelect: toggleSelect,
    onToggleExpand: toggleExpand,
    onPreview: openPreview
  }), [flatData, toggleSelect, toggleExpand, openPreview]);

  const triggerToast = (msg: string, type: ToastType = 'success') => {
    setToastState({ show: true, msg, type });
  };

  const getDefaultSavePath = async () => {
    let namePart = 'context';

    if (globalProjectRoot) {
      try {
        const base = await basename(globalProjectRoot);
        if (base) namePart = base;
      } catch (e) {
        const separator = globalProjectRoot.includes('\\') ? '\\' : '/';
        const cleanRoot = globalProjectRoot.endsWith(separator) ? globalProjectRoot.slice(0, -1) : globalProjectRoot;
        namePart = cleanRoot.split(separator).pop() || 'context';
      }
    }

    const now = new Date();
    const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    return `${namePart}_${timeStr}.txt`;
  };

  const executeFinalAction = async (text: string, action: 'copy' | 'save', savePath?: string) => {
      try {
          if (action === 'copy') {
              await writeClipboard(text);
              triggerToast(t('context.toastCopied'), 'success');
          } else if (action === 'save') {
              let filePath = savePath;
              if (!filePath) {
                  const defaultPath = await getDefaultSavePath();
                  filePath = await save({
                      filters: [{ name: 'Text File', extensions: ['txt', 'md', 'json'] }],
                      defaultPath: defaultPath
                  }) || undefined;
              }

              if (!filePath) {
                  setIsGenerating(false);
                  return;
              }

              await writeTextFile(filePath, text);
              triggerToast(t('context.toastSaved'), 'success');
          }
      } catch (err) {
          triggerToast(action === 'copy' ? t('context.toastCopyFail') : t('context.toastSaveFail'), 'error');
      } finally {
          if (action === 'save') {
              setIsGenerating(false);
          }
      }
  };

  const processWithSecurityCheck = async (text: string, action: 'copy' | 'save', savePath?: string) => {
      if (!detectSecrets) {
          await executeFinalAction(text, action, savePath);
          return;
      }

      try {
          const results = await invoke<SecretMatch[]>(`${CONTEXT_PLUGIN_PREFIX}scan_for_secrets`, { content: text });

          if (results && results.length > 0) {
              setScanState({
                  isOpen: true,
                  results,
                  pendingText: text,
                  pendingAction: action,
                  pendingSavePath: savePath
              });
          } else {
              await executeFinalAction(text, action, savePath);
          }
      } catch (e) {
          console.warn('Security scan failed, fallback to direct action:', e);
          triggerToast(t('context.securityScanFallback'), 'warning');
          await executeFinalAction(text, action, savePath);
      }
  };

  const handleScanConfirm = async (indicesToRedact: Set<number>) => {
      const { pendingText, pendingAction, results, pendingSavePath } = scanState;
      if (!pendingAction) return;

      let finalText = pendingText;

      if (indicesToRedact.size > 0) {
          const sortedResults = [...results].sort((a, b) => b.index - a.index);

          for (const match of sortedResults) {
              if (!indicesToRedact.has(match.index)) {
                  continue;
              }
              const jsIndex = match.utf16_index;
              const val = match.value;
              let maskedValue = '';
              if (val.length <= 8) {
                  maskedValue = '*'.repeat(val.length);
              } else {
                  const visiblePart = val.substring(0, 8);
                  const maskedPart = 'X'.repeat(val.length - 8);
                  maskedValue = visiblePart + maskedPart;
              }
              const before = finalText.substring(0, jsIndex);
              const after = finalText.substring(jsIndex + val.length);
              finalText = before + maskedValue + after;
          }
      }

      setScanState(prev => ({ ...prev, isOpen: false }));
      await executeFinalAction(finalText, pendingAction, pendingSavePath);
  };

  const handleCopyContext = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const paths = getSelectedPaths(fileTree);
      if (paths.length === 0) return;

      const header = generateHeader(fileTree, removeComments);

      if (detectSecrets) {
        const text = await invoke<string>(`${CONTEXT_PLUGIN_PREFIX}get_context_content`, { paths, header, removeComments });
        await processWithSecurityCheck(text, 'copy');
      } else {
        await invoke(`${CONTEXT_PLUGIN_PREFIX}copy_context_to_clipboard`, { paths, header, removeComments });
        triggerToast(t('context.toastCopied'), 'success');
      }
    } catch (err) {
      console.error('Failed to copy context to clipboard:', err);
      triggerToast(t('context.toastCopyFail'), 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToFile = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const paths = getSelectedPaths(fileTree);
      const header = generateHeader(fileTree, removeComments);

      if (detectSecrets) {
        const text = await invoke<string>(`${CONTEXT_PLUGIN_PREFIX}get_context_content`, { paths, header, removeComments });
        await processWithSecurityCheck(text, 'save', undefined);
      } else {
        const defaultPath = await getDefaultSavePath();
        const filePath = await save({
          filters: [{ name: 'Text File', extensions: ['txt', 'md', 'json'] }],
          defaultPath: defaultPath
        });

        if (!filePath) {
          setIsGenerating(false);
          return;
        }

        await invoke(`${CONTEXT_PLUGIN_PREFIX}save_context_to_file`, {
          paths,
          header,
          removeComments,
          savePath: filePath
        });
        triggerToast(t('context.toastSaved'), 'success');
      }
    } catch (err) {
      console.error('Failed to generate and save context:', err);
      triggerToast(t('context.toastSaveFail'), 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const performScan = async (path: string) => {
    if (!path.trim()) return;
    const requestId = ++scanRequestIdRef.current;
    setIsScanning(true);
    try {
      const effectiveConfig = {
        dirs: Array.from(new Set([...globalIgnore.dirs, ...projectIgnore.dirs])),
        files: Array.from(new Set([...globalIgnore.files, ...projectIgnore.files])),
        extensions: Array.from(new Set([...globalIgnore.extensions, ...projectIgnore.extensions])),
      };

      const result = await scanProject(path, effectiveConfig, {
        syncIgnoreFiles: isIgnoreSyncActive,
        maxDepth: 24,
        maxEntries: 100000,
      });
      if (requestId !== scanRequestIdRef.current) return;
      if (useAppStore.getState().projectRoot !== path) return;
      const previousTree = useContextStore.getState().fileTree;
      const tree = mergeTreeUiState(result.nodes, previousTree);
      setFileTree(tree, path);
      await checkIgnoreFiles(path);
      if (useAppStore.getState().projectRoot !== path) return;

      if (result.capped) {
        triggerToast(
          t('context.scanCapped', { scanned: result.scannedEntries, max: result.maxEntries }),
          'warning'
        );
      }

      const idealWidth = calculateIdealTreeWidth(tree);
      if (idealWidth > contextSidebarWidth) setContextSidebarWidth(idealWidth);
      if (!isContextSidebarOpen) setContextSidebarOpen(true);
    } catch (err) {
      if (requestId !== scanRequestIdRef.current) return;
      console.error('Project scan failed:', err);
      triggerToast(t('context.scanFail'), 'error');
    } finally {
      if (requestId === scanRequestIdRef.current) {
        setIsScanning(false);
      }
    }
  };

  const isResizingRef = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const sidebarLeftRef = useRef(0);
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    if (sidebarRef.current) {
      sidebarLeftRef.current = sidebarRef.current.getBoundingClientRect().left;
      sidebarRef.current.style.transition = 'none';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    let rafId = 0;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(200, Math.min(e.clientX - sidebarLeftRef.current, 800));
      // 直接操作 DOM，不经过 React 状态更新，避免重渲染卡顿
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
      }
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setContextSidebarWidth(newWidth);
      });
    };
    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      cancelAnimationFrame(rafId);
      if (sidebarRef.current) {
        sidebarRef.current.style.transition = '';
      }
      // 最终状态同步到 Zustand
      const finalWidth = sidebarRef.current ? parseInt(sidebarRef.current.style.width, 10) : 200;
      setContextSidebarWidth(finalWidth);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      cancelAnimationFrame(rafId);
    };
  }, [setContextSidebarWidth]);

  return (
    <div className="h-full flex flex-col bg-background relative">

      <div className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-background/80 backdrop-blur z-10">
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <button 
            onClick={() => setContextSidebarOpen(!isContextSidebarOpen)} 
            className={cn("p-2 rounded-md transition-colors", !isContextSidebarOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-secondary")}
          >
            <PanelLeft size={18} />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{t('menu.context')}</div>
          </div>
        </div>

        <div className="flex-1 flex justify-center px-4">
          <div className="bg-secondary/50 border border-border/60 p-1 rounded-xl flex items-center shadow-sm">
            <ViewToggleBtn 
              active={rightViewMode === 'dashboard'} 
              onClick={() => setRightViewMode('dashboard')}
              icon={<LayoutDashboard size={14} />} 
              label={t('context.tabDashboard')}
            />
            <ViewToggleBtn 
              active={rightViewMode === 'preview'} 
              onClick={() => setRightViewMode('preview')}
              icon={<FileText size={14} />} 
              label={t('context.tabPreview')}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 shrink-0 min-w-[120px]">
          <span className="bg-secondary/50 px-2 py-1 rounded-md text-[10px] font-medium tabular-nums text-muted-foreground">
            {t('context.selectedCount', { count: selectedFileCount })}
          </span>
          <button
            onClick={() => setIsAiSelectionOpen(true)}
            disabled={!globalProjectRoot || isScanning || fileTree.length === 0}
            title={t('context.aiSelectionTitle')}
            className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors disabled:opacity-50 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
          >
            <Sparkles size={16} />
          </button>
          <button
            onClick={() => performScan(globalProjectRoot || '')}
            disabled={!globalProjectRoot}
            title={t('workspace.rescan')}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={cn(isScanning && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <div 
          ref={sidebarRef}
          className={cn("flex flex-col bg-secondary/5 border-r border-border transition-all duration-75 ease-linear overflow-hidden relative group/sidebar", !isContextSidebarOpen && "w-0 border-none opacity-0")}
          style={{ width: isContextSidebarOpen ? `${contextSidebarWidth}px` : 0 }}
        >
          <div className="p-3 border-b border-border/50 text-xs font-bold text-muted-foreground uppercase tracking-wider flex justify-between shrink-0 items-center">
             <span className="flex items-center gap-1"><FileJson size={12}/>{t('context.explorer')}</span>
             <div className="flex items-center gap-2">
                {hasProjectIgnoreFiles && (
                  <button
                    onClick={toggleIgnoreSync}
                    className={cn(
                      "p-1 rounded transition-all duration-200 flex items-center gap-1",
                      isIgnoreSyncActive
                        ? "bg-orange-500/20 text-orange-500 border border-orange-500/30"
                        : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                    )}
                    title={isIgnoreSyncActive ? t('context.releaseIgnore') : t('context.syncIgnore')}
                  >
                    <GitBranch size={12} className={cn(isIgnoreSyncActive && "animate-pulse")} />
                    {isIgnoreSyncActive && <span className="text-[10px] font-bold">GIT</span>}
                  </button>
                )}
                <button
                  onClick={invertSelection}
                  className="p-1 hover:bg-secondary/80 rounded transition-colors text-muted-foreground hover:text-foreground"
                  title={t('context.invertSelection')}
                >
                   <ArrowRightLeft size={12} />
                </button>
              </div>
           </div>
          
          <div className="flex-1 overflow-hidden relative">
            {!globalProjectRoot ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-50 gap-2 text-center px-4">
                <p className="text-sm">{t('workspace.selectHint')}</p>
              </div>
            ) : isScanning ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground animate-pulse"><Loader2 size={20} className="animate-spin text-primary" /><span>{t('context.scanning')}</span></div>
            ) : scannedProjectRoot !== globalProjectRoot ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground opacity-60 gap-3 text-center px-4">
                <p className="text-sm">{t('workspace.loadHint')}</p>
              </div>
            ) : fileTree.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('context.emptyDir')}</div>
            ) : (
              <AutoSizer>
                {({ height, width }) => (
                  <List
                    height={height}
                    itemCount={flatData.length}
                    itemSize={28}
                    width={width}
                    className="custom-scrollbar"
                    overscanCount={10}
                    itemData={rowData}
                    itemKey={(index) => rowData.items[index]?.node.id ?? index}
                  >
                    {Row}
                  </List>
                )}
              </AutoSizer>
            )}
          </div>

          <div className="border-t border-border bg-background shrink-0 flex flex-col z-10">
              <button 
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center justify-between px-3 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wider hover:bg-secondary/50 transition-colors"
              >
                  <span className="flex items-center gap-2"><SlidersHorizontal size={12}/> {t('context.filters')}</span>
                  <ChevronUp size={14} className={cn("transition-transform duration-200", showFilters ? "rotate-180" : "rotate-0")} />
              </button>
              {showFilters && (
                  <div className="h-64 p-3 bg-secondary/5 overflow-hidden border-t border-border/50 animate-in slide-in-from-bottom-2">
                      <FilterManager localConfig={projectIgnore} globalConfig={globalIgnore} onUpdate={updateProjectIgnore} />
                  </div>
              )}
          </div>
          
          {isContextSidebarOpen && <div onMouseDown={startResizing} className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors z-20" />}
        </div>

        <div className="flex-1 bg-background min-w-0 flex flex-col relative">
            <div className="absolute inset-0 bg-grid-slate-900/[0.04] bg-[bottom_1px_center] dark:bg-grid-slate-400/[0.05] [mask-image:linear-gradient(to_bottom,transparent,black)] pointer-events-none" />
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pb-10 h-full"> 
                {rightViewMode === 'dashboard' ? (
                   <TokenDashboard
                      fileTree={fileTree}
                      models={activeModels}
                      onCopy={handleCopyContext}
                      onSave={handleSaveToFile}
                      isGenerating={isGenerating}
                      isActive={rightViewMode === 'dashboard'}
                    />
                ) : (
                   <div className="h-full">
                      <ContextPreview fileTree={fileTree} />
                   </div>
                )}
            </div>
        </div>
      </div>

      <Toast 
        message={toastState.msg} 
        type={toastState.type} 
        show={toastState.show} 
        onDismiss={() => setToastState(prev => ({ ...prev, show: false }))} 
      />

      <ScanResultDialog 
        isOpen={scanState.isOpen}
        results={scanState.results}
        onConfirm={handleScanConfirm}
        onCancel={() => setScanState(prev => ({ ...prev, isOpen: false }))}
      />
      <AiSelectionPanel
        isOpen={isAiSelectionOpen}
        fileTree={fileTree}
        projectRoot={globalProjectRoot}
        onApply={applySelectionByPaths}
        onClose={() => setIsAiSelectionOpen(false)}
      />
    </div>
  );
}

function ViewToggleBtn({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
      )}
    >
      {active && (
        <motion.div
          layoutId="context-view-toggle"
          className="absolute inset-0 bg-background shadow-sm rounded-lg ring-1 ring-black/5 dark:ring-white/10"
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </span>
    </button>
  );
}
