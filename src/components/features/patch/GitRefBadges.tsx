import { getGitRefBadgeClass, getGitRefLabel, sortGitRefs } from './gitRefs';
import type { GitRef } from './patch_types';

interface GitRefBadgesProps {
  refs: GitRef[];
  maxVisible?: number;
  size?: 'compact' | 'default';
  wrap?: boolean;
}

export function GitRefBadges({ refs, maxVisible, size = 'default', wrap = true }: GitRefBadgesProps) {
  const sortedRefs = sortGitRefs(refs);
  const visibleRefs = maxVisible ? sortedRefs.slice(0, maxVisible) : sortedRefs;
  const hiddenCount = sortedRefs.length - visibleRefs.length;
  const baseClass =
    size === 'compact'
      ? 'text-[9px] leading-none px-1.5 py-[2px]'
      : 'text-[10px] leading-none px-2 py-1';

  return (
    <div className={`flex min-w-0 gap-1.5 ${wrap ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}>
      {visibleRefs.map((ref, index) => (
        <span
          key={`${ref.kind}-${ref.name}-${index}`}
          className={`${baseClass} inline-flex max-w-[160px] items-center truncate rounded-full font-semibold border ${getGitRefBadgeClass(ref.kind)}`}
          title={ref.name}
        >
          {getGitRefLabel(ref)}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className={`${baseClass} rounded-full font-semibold border bg-secondary text-muted-foreground border-border/60`}>
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
