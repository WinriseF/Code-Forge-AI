import { useState } from 'react';
import { X, FileText, FileJson, FileCode, FileType, Columns, List, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { ExportFormat, ExportLayout } from '@/types/git';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (format: ExportFormat, layout: ExportLayout) => void;
  count: number;
}

export function ExportDialog({ isOpen, onClose, onConfirm, count }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('Markdown');
  const [layout, setLayout] = useState<ExportLayout>('Split');
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
      <div className="w-[500px] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        <div className="px-6 py-4 border-b border-border bg-secondary/10 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{t('export.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
                {t('export.selected', { count })}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-secondary text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
            <div className="space-y-3">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t('export.layout')}</label>
                <div className="grid grid-cols-3 gap-3">
                    <LayoutOption 
                        active={layout === 'Split'} 
                        onClick={() => setLayout('Split')}
                        icon={Columns}
                        title={t('export.split')}
                        desc={t('export.splitDesc')}
                    />
                    <LayoutOption 
                        active={layout === 'Unified'} 
                        onClick={() => setLayout('Unified')}
                        icon={List}
                        title={t('export.unified')}
                        desc={t('export.unifiedDesc')}
                    />
                    <LayoutOption 
                        active={layout === 'GitPatch'} 
                        onClick={() => setLayout('GitPatch')}
                        icon={GitMerge}
                        title={t('export.gitPatch')}
                        desc={t('export.gitPatchDesc')}
                    />
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t('export.format')}</label>
                <div className="grid grid-cols-2 gap-2">
                    <FormatOption active={format === 'Markdown'} onClick={() => setFormat('Markdown')} icon={FileText} label={t('export.markdown')} />
                    <FormatOption active={format === 'Json'} onClick={() => setFormat('Json')} icon={FileJson} label={t('export.json')} />
                    <FormatOption active={format === 'Xml'} onClick={() => setFormat('Xml')} icon={FileCode} label={t('export.xml')} />
                    <FormatOption active={format === 'Txt'} onClick={() => setFormat('Txt')} icon={FileType} label={t('export.txt')} />
                </div>
            </div>
        </div>

        <div className="p-4 border-t border-border bg-secondary/5 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-secondary text-muted-foreground transition-colors">{t('export.btnCancel')}</button>
            <button
                onClick={() => onConfirm(format, layout)}
                className="px-6 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors"
            >
                {t('export.btnExport')}
            </button>
        </div>
      </div>
    </div>
  );
}

function FormatOption({ active, onClick, icon: Icon, label }: any) {
    return (
        <button 
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border transition-all text-xs font-medium",
                active 
                    ? "bg-primary text-primary-foreground border-primary" 
                    : "bg-background border-border text-foreground hover:border-primary/50"
            )}
        >
            <Icon size={14} /> {label}
        </button>
    )
}

function LayoutOption({ active, onClick, icon: Icon, title, desc }: any) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all h-24 text-center",
                active 
                    ? "border-primary bg-primary/5 text-primary" 
                    : "border-border bg-secondary/20 hover:border-primary/50 text-muted-foreground hover:text-foreground"
            )}
        >
            <Icon size={20} />
            <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold">{title}</span>
                <span className="text-[10px] opacity-70 leading-tight">{desc}</span>
            </div>
        </button>
    )
}
