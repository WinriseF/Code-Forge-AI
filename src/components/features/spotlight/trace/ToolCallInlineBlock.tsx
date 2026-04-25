import { AlertCircle, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatToolCallTrace } from '@/lib/llm';
import { cn } from '@/lib/utils';

interface ToolCallInlineBlockProps {
  call: ChatToolCallTrace;
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function getToolLabel(name: string, t: (key: string) => string): string {
  switch (name) {
    case 'fs.list_directory':
      return t('spotlight.toolInlineFsList');
    case 'fs.search_files':
      return t('spotlight.toolInlineFsSearch');
    case 'fs.read_file':
      return t('spotlight.toolInlineFsRead');
    case 'fs.grep':
      return t('spotlight.toolInlineFsGrep');
    case 'web.search':
      return t('spotlight.toolInlineWebSearch');
    case 'web.extract_page':
      return t('spotlight.toolInlineWebExtract');
    default:
      return t('spotlight.toolInlineTool');
  }
}

export function ToolCallInlineBlock({ call }: ToolCallInlineBlockProps) {
  const { t } = useTranslation();
  const isRunning = call.status === 'running';
  const isSuccess = call.status === 'success';
  const label = getToolLabel(call.name, t);
  const duration = formatDuration(call.durationMs);
  const primaryText = call.argumentsPreview || call.resultPreview || call.name;
  const hasBody = Boolean(call.argumentsPreview || call.resultPreview);
  const tone = isRunning
    ? 'border-amber-500/20 bg-amber-500/5'
    : isSuccess
      ? 'border-border/50 bg-background/35'
      : 'border-rose-500/20 bg-rose-500/5';
  const statusLabel = isRunning
    ? t('spotlight.toolRunning')
    : isSuccess
      ? t('spotlight.toolCompleted')
      : t('spotlight.toolFailed');

  const summaryRow = (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      {hasBody ? (
        <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
      ) : (
        <span className="w-[14px] shrink-0" />
      )}
      {isRunning ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-amber-400" />
      ) : isSuccess ? (
        <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
      ) : (
        <AlertCircle size={12} className="shrink-0 text-rose-400" />
      )}
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/90">
        {primaryText}
      </code>
      <span
        className={cn(
          'shrink-0 text-[10px] uppercase tracking-wide',
          isRunning ? 'text-amber-300' : isSuccess ? 'text-emerald-300' : 'text-rose-300',
        )}
      >
        {statusLabel}
      </span>
      {duration && (
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {duration}
        </span>
      )}
    </div>
  );

  if (!hasBody) {
    return (
      <div className={cn('overflow-hidden rounded-xl border text-xs', tone)}>
        {summaryRow}
      </div>
    );
  }

  return (
    <details className={cn('group overflow-hidden rounded-xl border text-xs', tone)}>
      <summary className="list-none cursor-pointer marker:hidden">
        {summaryRow}
      </summary>
      <div className="space-y-2 border-t border-border/40 px-3 py-3">
        {call.argumentsPreview && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
              {t('spotlight.toolInlineArgs')}
            </div>
            <code className="block whitespace-pre-wrap break-all rounded-lg bg-black/20 px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground/90">
              {call.argumentsPreview}
            </code>
          </div>
        )}
        {call.resultPreview && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
              {t('spotlight.toolInlineOutput')}
            </div>
            <div className="whitespace-pre-wrap break-words rounded-lg bg-black/20 px-2.5 py-2 text-[11px] leading-5 text-foreground/85">
              {call.resultPreview}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
