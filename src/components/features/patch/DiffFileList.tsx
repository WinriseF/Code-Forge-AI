import { AlertOctagon, CheckSquare, FileCode2, FileImage, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { summarizeDiffFiles } from '@/lib/git_insights';
import type { GitDiffFileItem } from '@/types/git';

interface DiffFileListProps {
  title: string;
  files: GitDiffFileItem[];
  selectedFileId: string | null;
  selectedExportIds: Set<string>;
  onSelectFile: (id: string) => void;
  onToggleExport: (id: string, checked: boolean) => void;
}

export function DiffFileList({
  title,
  files,
  selectedFileId,
  selectedExportIds,
  onSelectFile,
  onToggleExport,
}: DiffFileListProps) {
  const { t } = useTranslation();
  const stats = summarizeDiffFiles(files);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[28px] border border-border/70 bg-background/85">
      <div className="border-b border-border/60 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {title}
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {files.length} {t('patch.changes')}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-secondary/25 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {t('patch.diffableFiles')}
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">{stats.diffable}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {files.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-secondary/15 px-4 text-center text-sm text-muted-foreground">
            {t('patch.noFilesInSelection')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {files.map((file) => {
              const isSelected = selectedFileId === file.id;
              const isChecked = selectedExportIds.has(file.id);
              const isDisabled = file.isBinary || file.isLarge;

              return (
                <div
                  key={file.id}
                  className={cn(
                    'flex items-center gap-1 rounded-2xl border p-2 transition-colors',
                    isSelected
                      ? 'border-primary/20 bg-primary/10'
                      : 'border-transparent bg-background/55 hover:border-border/60 hover:bg-background',
                  )}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isDisabled) {
                        onToggleExport(file.id, !isChecked);
                      }
                    }}
                    disabled={isDisabled}
                    className={cn(
                      'rounded-xl p-2 text-muted-foreground transition-colors',
                      isDisabled ? 'cursor-not-allowed opacity-30' : 'hover:text-primary',
                    )}
                    title={isDisabled ? t('patch.exportBlocked') : t('patch.export')}
                  >
                    {isChecked ? <CheckSquare size={14} className="text-primary" /> : <Square size={14} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectFile(file.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {file.isBinary ? (
                        <FileImage size={13} className="shrink-0 text-orange-400" />
                      ) : file.isLarge ? (
                        <AlertOctagon size={13} className="shrink-0 text-red-400" />
                      ) : (
                        <FileCode2 size={13} className="shrink-0 text-muted-foreground" />
                      )}

                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{file.path}</div>
                        {file.oldPath ? (
                          <div className="truncate text-[11px] text-muted-foreground">{file.oldPath}</div>
                        ) : null}
                      </div>
                    </div>

                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        file.gitStatus === 'Added' && 'bg-green-500/10 text-green-600',
                        file.gitStatus === 'Modified' && 'bg-blue-500/10 text-blue-600',
                        file.gitStatus === 'Deleted' && 'bg-red-500/10 text-red-600',
                        file.gitStatus === 'Renamed' && 'bg-purple-500/10 text-purple-600',
                      )}
                    >
                      {file.gitStatus}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
