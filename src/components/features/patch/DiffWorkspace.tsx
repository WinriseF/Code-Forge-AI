import { Copy, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DiffViewer } from './DiffViewer';
import type { GitDiffFileItem } from '@/types/git';

interface DiffWorkspaceProps {
  selectedFile: GitDiffFileItem | null;
  onCopy: (content: string) => void;
  onExport?: () => void;
}

export function DiffWorkspace({
  selectedFile,
  onCopy,
  onExport,
}: DiffWorkspaceProps) {
  const { t } = useTranslation();

  const copyContent = selectedFile
    ? selectedFile.modified || selectedFile.original
    : '';

  return (
    <div className="flex h-full flex-1 flex-col min-h-0 bg-background animate-in fade-in duration-300">
      <div className="z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {selectedFile ? (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-foreground" title={selectedFile.path}>
                  {selectedFile.path}
                </h2>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    selectedFile.gitStatus === 'Added' && 'bg-green-500/10 text-green-600',
                    selectedFile.gitStatus === 'Modified' && 'bg-blue-500/10 text-blue-600',
                    selectedFile.gitStatus === 'Deleted' && 'bg-red-500/10 text-red-600',
                    selectedFile.gitStatus === 'Renamed' && 'bg-purple-500/10 text-purple-600',
                  )}
                >
                  {selectedFile.gitStatus}
                </span>
                {selectedFile.isBinary ? (
                  <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-500">
                    {t('patch.binaryFile')}
                  </span>
                ) : null}
                {selectedFile.isLarge ? (
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                    {t('patch.largeFile')}
                  </span>
                ) : null}
              </div>
              {selectedFile.oldPath ? (
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {t('patch.previousPath')}: {selectedFile.oldPath}
                </div>
              ) : (
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {selectedFile.id}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{t('patch.selectFile')}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {selectedFile && (
            <button
              onClick={() => onCopy(copyContent)}
              className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
            >
              <Copy size={14} />
              {t('spotlight.copy')}
            </button>
          )}

          {onExport && (
            <button
              onClick={onExport}
              className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
            >
              <FileDown size={14} />
              {t('patch.export')}
            </button>
          )}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-background">
        <DiffViewer
          original={selectedFile?.original || ''}
          modified={selectedFile?.modified || ''}
          fileName={selectedFile?.path || ''}
          placeholder={t('patch.selectFile')}
        />
      </div>
    </div>
  );
}
