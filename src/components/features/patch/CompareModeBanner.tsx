import { GitCompareArrows, X } from 'lucide-react';

interface CompareModeBannerProps {
  title: string;
  description: string;
  cancelLabel: string;
  onCancel: () => void;
  compact?: boolean;
}

export function CompareModeBanner({
  title,
  description,
  cancelLabel,
  onCancel,
  compact = false,
}: CompareModeBannerProps) {
  return (
    <div
      className={`flex items-start justify-between gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      }`}
    >
      <div className="min-w-0">
        <div className={`flex items-center gap-1.5 font-medium text-yellow-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
          <GitCompareArrows size={compact ? 12 : 14} />
          <span className="truncate">{title}</span>
        </div>
        <p className={`mt-1 text-muted-foreground ${compact ? 'truncate text-[10px]' : 'text-[11px]'}`}>
          {description}
        </p>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded p-1 text-yellow-500/80 transition-colors hover:bg-yellow-500/10 hover:text-yellow-400"
        title={cancelLabel}
        aria-label={cancelLabel}
      >
        <X size={compact ? 12 : 14} />
      </button>
    </div>
  );
}
