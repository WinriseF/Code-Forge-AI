import { Copy } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { DiffViewer } from './DiffViewer';
import { PatchFileItem } from './patch_types';
import { useTranslation } from 'react-i18next';
import { AnimatedEmptyState } from '@/components/ui/AnimatedEmptyState';

interface DiffWorkspaceProps {
  selectedFile: PatchFileItem | null;
  onCopy: (content: string) => void;
}

export function DiffWorkspace({ selectedFile, onCopy }: DiffWorkspaceProps) {
  const { t } = useTranslation();
  const hasChanges = selectedFile ? selectedFile.original !== selectedFile.modified : false;

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

        {/* Left Side: File Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
            {selectedFile && (
                <div className="flex flex-col min-w-0">
                    <h2 className="text-sm font-semibold flex items-center gap-2 truncate">
                        <span className="truncate" title={selectedFile.path}>{selectedFile.path}</span>
                        {hasChanges ?
                            <span className="shrink-0 text-[10px] bg-yellow-500/10 text-yellow-600 px-2 py-0.5 rounded-full border border-yellow-500/20 font-medium">{t('patch.modified')}</span> :
                            <span className="shrink-0 text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-medium">{t('patch.noChangesLabel')}</span>
                        }
                    </h2>
                    {selectedFile.renameFrom && (
                      <p className="text-[11px] text-muted-foreground mt-1 truncate" title={selectedFile.renameFrom}>
                        {t('patch.renamedFrom', { path: selectedFile.renameFrom })}
                      </p>
                    )}
                </div>
            )}
        </div>

        {/* Right Side: Actions */}
        <div className="flex items-center gap-2 shrink-0">
            {selectedFile && (
                <button
                    onClick={() => onCopy(selectedFile.modified)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground transition-colors active:scale-95"
                >
                    <Copy size={14} /> {t('spotlight.copy')}
                </button>
            )}
        </div>
      </div>

      {/* 2. Content Area  */}
      {!selectedFile ? (
          <AnimatedEmptyState
            title={t('patch.selectFile')}
            className="h-full bg-background/50"
            animationClassName="h-60 w-60"
            titleClassName="text-xs text-muted-foreground"
          />
      ) : (
        <div className="flex-1 relative overflow-hidden bg-background">
            <DiffViewer
                original={selectedFile.original}
                modified={selectedFile.modified}
                fileName={selectedFile.path}
                placeholder={t('common.waitingForInputs')}
            />
        </div>
      )}
    </div>
  );
}
