import { useState, useRef, useEffect } from 'react';
import {
  Save, Copy, ArrowDownUp, PanelLeftClose, PanelLeftOpen, Trash2,
  FileDown
} from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { DiffViewer } from './DiffViewer';
import { PatchFileItem } from './patch_types';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useSmartContextMenu } from '@/lib/hooks';

interface DiffWorkspaceProps {
  selectedFile: PatchFileItem | null;
  onSave: (file: PatchFileItem) => void;
  onCopy: (content: string) => void;
  onManualUpdate?: (original: string, modified: string) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isReadOnly?: boolean;
  onExport?: () => void;
}

export function DiffWorkspace({
    selectedFile, onSave, onCopy, onManualUpdate,
    isSidebarOpen, onToggleSidebar, isReadOnly, onExport
}: DiffWorkspaceProps) {

  const { t } = useTranslation();
  const [showInputs, setShowInputs] = useState(true);
  
  const [inputHeight, setInputHeight] = useState(200);
  const isResizingRef = useRef(false);

  const hasChanges = selectedFile ? selectedFile.original !== selectedFile.modified : false;
  const isManual = selectedFile ? !!selectedFile.isManual : false;

  // 拖拽调整高度逻辑
  const startResizing = () => { isResizingRef.current = true; };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newHeight = e.clientY - 88;
      if (newHeight > 100 && newHeight < window.innerHeight - 200) {
        setInputHeight(newHeight);
      }
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
  }, []);

  const handlePaste = (
    pastedText: string, 
    textarea: HTMLTextAreaElement | null, 
    inputType: 'original' | 'modified'
  ) => {
    if (!textarea || !onManualUpdate || !selectedFile) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const newValue = value.substring(0, selectionStart) + pastedText + value.substring(selectionEnd);

    if (inputType === 'original') {
      onManualUpdate(newValue, selectedFile.modified);
    } else {
      onManualUpdate(selectedFile.original, newValue);
    }
    
    setTimeout(() => {
      if (textarea) {
        const newCursorPos = selectionStart + pastedText.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };
  
  const { onContextMenu: onOriginalContextMenu } = useSmartContextMenu<HTMLTextAreaElement>({ 
    onPaste: (text, textarea) => handlePaste(text, textarea, 'original') 
  });
  
  const { onContextMenu: onModifiedContextMenu } = useSmartContextMenu<HTMLTextAreaElement>({ 
    onPaste: (text, textarea) => handlePaste(text, textarea, 'modified') 
  });

  return (
    <div 
      className="flex-1 flex flex-col min-h-0 bg-background h-full animate-in fade-in duration-300"
      onContextMenu={async (e) => {
        const selection = window.getSelection()?.toString();
        if (selection && selection.length > 0) {
          e.preventDefault();
          await writeText(selection);
        }
      }}
    >
      
      {/* 1. Toolbar */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur shrink-0 z-20 gap-4">
        
        {/* Left Side: Sidebar Toggle & File Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
            {onToggleSidebar && (
              <button
                  onClick={onToggleSidebar}
                  className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={isSidebarOpen ? t('common.hideSidebar') : t('common.showSidebar')}
              >
                  {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              </button>
            )}

            {selectedFile && (
                <div className="flex flex-col min-w-0">
                    <h2 className="text-sm font-semibold flex items-center gap-2 truncate">
                        <span className="truncate" title={selectedFile.path}>{selectedFile.path}</span>
                        {hasChanges ?
                            <span className="shrink-0 text-[10px] bg-yellow-500/10 text-yellow-600 px-2 py-0.5 rounded-full border border-yellow-500/20 font-medium">{t('patch.modified')}</span> :
                            <span className="shrink-0 text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-medium">{t('patch.noChangesLabel')}</span>
                        }
                    </h2>
                    {selectedFile.id !== selectedFile.path && (
                      <span className="text-[10px] text-muted-foreground/60 truncate font-mono mt-0.5">
                          {selectedFile.id}
                      </span>
                    )}
                </div>
            )}
        </div>

        {/* Right Side: Actions */}
        <div className="flex items-center gap-2 shrink-0">
            {selectedFile && isManual && (
                <>
                    <button 
                        onClick={() => setShowInputs(!showInputs)}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                            showInputs ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                        )}
                    >
                        <ArrowDownUp size={14} /> {showInputs ? t('patch.hideInputs') : t('patch.editText')}
                    </button>
                    <button
                        onClick={() => onManualUpdate?.('', '')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all bg-secondary hover:bg-destructive/10 hover:text-destructive text-muted-foreground mr-2"
                        title={t('common.clearAll')}
                    >
                        <Trash2 size={14} /> {t('common.clear')}
                    </button>
                </>
            )}

            {selectedFile && (
                <button
                    onClick={() => onCopy(selectedFile.modified)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground transition-colors active:scale-95"
                >
                    <Copy size={14} /> {t('spotlight.copy')}
                </button>
            )}
            
            {/* === Export 按钮 === */}
            {onExport && (
              <button
                  onClick={onExport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground transition-colors active:scale-95"
              >
                  <FileDown size={14} />{t('patch.export')}
              </button>
            )}
            
            {selectedFile && !isManual && !isReadOnly && (
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
                    <Save size={14} /> {t('patch.saveChanges')}
                </button>
            )}
        </div>
      </div>

      {/* 2. Content Area  */}
      {!selectedFile ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-background/50 h-full text-muted-foreground/40 gap-2">
             <div className="p-4 bg-secondary/30 rounded-full">
                <PanelLeftOpen size={32} className="opacity-50" />
             </div>
             <p className="text-xs">{t('patch.selectFile')}</p>
          </div>
      ) : (
          <>
            {isManual && showInputs && (
                <div className="shrink-0 flex flex-col border-b border-border bg-secondary/5 relative" style={{ height: inputHeight }}>
                    <div className="flex-1 flex min-h-0">
                        <div className="flex-1 flex flex-col border-r border-border">
                            <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase bg-secondary/10 border-b border-border/50">{t('patch.originalText')}</div>
                            <textarea
                                onContextMenu={onOriginalContextMenu}
                                value={selectedFile.original}
                                onChange={(e) => onManualUpdate?.(e.target.value, selectedFile.modified)}
                                className="flex-1 bg-transparent p-3 resize-none outline-none font-mono text-xs leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30"
                                placeholder={t('patch.pasteOriginal')}
                                spellCheck={false}
                            />
                        </div>
                        <div className="flex-1 flex flex-col">
                            <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase bg-secondary/10 border-b border-border/50">{t('patch.modifiedText')}</div>
                            <textarea
                                onContextMenu={onModifiedContextMenu}
                                value={selectedFile.modified}
                                onChange={(e) => onManualUpdate?.(selectedFile.original, e.target.value)}
                                className="flex-1 bg-transparent p-3 resize-none outline-none font-mono text-xs leading-relaxed custom-scrollbar placeholder:text-muted-foreground/30"
                                placeholder={t('patch.pasteModified')}
                                spellCheck={false}
                            />
                        </div>
                    </div>
                    
                    {/* Drag Handle */}
                    <div 
                        onMouseDown={startResizing}
                        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-row-resize bg-transparent hover:bg-primary/20 flex justify-center items-center z-10 group"
                    >
                        <div className="w-12 h-1 rounded-full bg-border/50 group-hover:bg-primary/40 transition-colors" />
                    </div>
                </div>
            )}
            <div className="flex-1 relative overflow-hidden bg-background">
                <DiffViewer
                    original={selectedFile.original}
                    modified={selectedFile.modified}
                    fileName={selectedFile.path}
                    placeholder={isManual ? t('patch.pasteToCompare') : t('common.waitingForInputs')}
                />
            </div>
          </>
      )}
    </div>
  );
}