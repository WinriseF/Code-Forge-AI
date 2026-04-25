import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, FileCode, Folder, Loader2, Search, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { FileNode } from '@/types/context';
import { cn } from '@/lib/utils';
import { AiProviderSelect } from '@/components/ui/AiProviderSelect';
import { useAppStore } from '@/store/useAppStore';
import { selectContextFilesWithAi, SelectContextFilesResult } from '@/lib/context-ai/selectFiles';
import { AiFileSelectionToolTrace } from '@/lib/context-ai/types';

interface AiSelectionPanelProps {
  isOpen: boolean;
  fileTree: FileNode[];
  projectRoot: string | null;
  onApply: (paths: string[]) => void;
  onClose: () => void;
}

function traceLabel(trace: AiFileSelectionToolTrace): string {
  if (trace.preview) {
    return `${trace.name}: ${trace.preview}`;
  }
  return trace.name;
}

export function AiSelectionPanel({
  isOpen,
  fileTree,
  projectRoot,
  onApply,
  onClose,
}: AiSelectionPanelProps) {
  const { t } = useTranslation();
  const aiConfig = useAppStore(useShallow((state) => state.aiConfig));
  const [instruction, setInstruction] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<SelectContextFilesResult | null>(null);
  const [error, setError] = useState('');
  const [traces, setTraces] = useState<AiFileSelectionToolTrace[]>([]);

  useEffect(() => {
    if (!isOpen) {
      setIsAnalyzing(false);
      setResult(null);
      setError('');
      setTraces([]);
    }
  }, [isOpen]);

  const canAnalyze = useMemo(() => (
    !!projectRoot &&
    !!aiConfig.apiKey &&
    instruction.trim().length > 0 &&
    !isAnalyzing
  ), [aiConfig.apiKey, instruction, isAnalyzing, projectRoot]);

  const upsertTrace = useCallback((trace: AiFileSelectionToolTrace) => {
    setTraces((current) => {
      const existingIndex = current.findIndex((item) => item.id === trace.id);
      if (existingIndex < 0) {
        return [...current, trace].slice(-8);
      }
      const next = [...current];
      next[existingIndex] = trace;
      return next;
    });
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!projectRoot || !aiConfig.apiKey || !instruction.trim()) {
      return;
    }

    setIsAnalyzing(true);
    setResult(null);
    setError('');
    setTraces([]);

    try {
      const nextResult = await selectContextFilesWithAi({
        instruction,
        fileTree,
        projectRoot,
        config: aiConfig,
        onToolTrace: upsertTrace,
      });
      setResult(nextResult);
      if (nextResult.suggestions.length === 0) {
        setError(t('context.aiSelectionNoMatches'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  }, [aiConfig, fileTree, instruction, projectRoot, t, upsertTrace]);

  const handleApply = useCallback(() => {
    if (!result || result.selectedPaths.length === 0) return;
    onApply(result.selectedPaths);
    onClose();
  }, [onApply, onClose, result]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/35 backdrop-blur-[1px] flex justify-end animate-in fade-in duration-200">
      <div className="h-full w-full max-w-[520px] bg-background border-l border-border shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
        <div className="px-5 py-4 border-b border-border bg-secondary/10 flex items-start gap-3 shrink-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">{t('context.aiSelectionTitle')}</div>
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {projectRoot ?? t('workspace.selectHint')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50"
            title={t('context.aiSelectionClose')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 border-b border-border shrink-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('context.aiSelectionProvider')}
              </label>
              <AiProviderSelect disabled={isAnalyzing} size="sm" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('context.aiSelectionModel')}
              </label>
              <div className="h-8 rounded-md border border-input bg-secondary/30 px-2 flex items-center text-xs font-mono text-muted-foreground truncate">
                {aiConfig.modelId || '-'}
              </div>
            </div>
          </div>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            disabled={isAnalyzing}
            placeholder={t('context.aiSelectionPlaceholder')}
            className="w-full min-h-[92px] resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              {!aiConfig.apiKey
                ? t('context.aiSelectionNoApiKey')
                : result
                  ? t('context.aiSelectionResultCount', { count: result.suggestions.length })
                  : t('context.aiSelectionReady')}
            </div>
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={!canAnalyze}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 shrink-0"
            >
              {isAnalyzing ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              {isAnalyzing ? t('context.aiSelectionAnalyzing') : t('context.aiSelectionRun')}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-secondary/5 p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 text-destructive px-3 py-2 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {traces.length > 0 && (
            <div className="mb-4 rounded-lg border border-border bg-background/70 overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('context.aiSelectionTrace')}
              </div>
              <div className="divide-y divide-border/60">
                {traces.map((trace) => (
                  <div key={trace.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                    {trace.status === 'running' ? (
                      <Loader2 size={13} className="animate-spin text-primary shrink-0" />
                    ) : trace.status === 'success' ? (
                      <Check size={13} className="text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle size={13} className="text-destructive shrink-0" />
                    )}
                    <span className="font-mono text-muted-foreground truncate">{traceLabel(trace)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{result.summary}</div>
              {result.suggestions.map((item) => {
                const Icon = item.kind === 'dir' ? Folder : FileCode;
                return (
                  <div key={`${item.kind}:${item.path}`} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon
                        size={15}
                        className={cn('shrink-0', item.kind === 'dir' ? 'text-blue-400' : 'text-muted-foreground')}
                      />
                      <span className="font-mono text-xs text-foreground truncate" title={item.path}>
                        {item.path}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground leading-relaxed">
                      {item.reason}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!result && !isAnalyzing && traces.length === 0 && !error && (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              {t('context.aiSelectionEmpty')}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border bg-background flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-muted-foreground">
            {result?.unmatchedPaths.length
              ? t('context.aiSelectionUnmatched', { count: result.unmatchedPaths.length })
              : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isAnalyzing}
              className="h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-secondary disabled:opacity-50"
            >
              {t('context.aiSelectionCancel')}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!result || result.selectedPaths.length === 0 || isAnalyzing}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {t('context.aiSelectionApply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
