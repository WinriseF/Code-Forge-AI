import type { ReactNode } from 'react';
import emptyAnimationUrl from '@/assets/empty.lottie';
import { cn } from '@/lib/utils';
import { LottieLoader } from './LottieLoader';

interface AnimatedEmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  animationClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

export function AnimatedEmptyState({
  title,
  description,
  className,
  animationClassName,
  titleClassName,
  descriptionClassName,
}: AnimatedEmptyStateProps) {
  return (
    <div className={cn("flex h-full min-h-[220px] w-full flex-col items-center justify-center gap-4 px-6 py-8 text-center", className)}>
      <div className="pointer-events-none relative flex items-center justify-center">
        <div className="absolute h-24 w-24 rounded-full bg-primary/10 blur-3xl" />
        <LottieLoader
          src={emptyAnimationUrl}
          className={cn("h-60 w-60 max-w-full select-none opacity-95", animationClassName)}
        />
      </div>

      <div className="max-w-sm space-y-1">
        <div className={cn("text-sm font-medium text-foreground/90", titleClassName)}>{title}</div>
        {description ? (
          <div className={cn("text-xs leading-6 text-muted-foreground", descriptionClassName)}>
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}
