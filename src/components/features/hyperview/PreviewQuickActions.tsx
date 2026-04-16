import { Languages, Pin, PinOff, ScanText } from 'lucide-react';

import { cn } from '@/lib/utils';

interface PreviewQuickActionsProps {
  canUseOcr: boolean;
  isOcrOpen: boolean;
  canUseAi: boolean;
  isAiOpen: boolean;
  isPinned: boolean;
  onToggleOcr: () => void;
  onToggleAi: () => void;
  onTogglePinned: () => void;
  ocrRunTitle: string;
  ocrCloseTitle: string;
  aiRunTitle: string;
  aiCloseTitle: string;
  pinTitle: string;
  unpinTitle: string;
  buttonClassName: string;
  activeButtonClassName?: string;
  iconSize?: number;
}

export function PreviewQuickActions({
  canUseOcr,
  isOcrOpen,
  canUseAi,
  isAiOpen,
  isPinned,
  onToggleOcr,
  onToggleAi,
  onTogglePinned,
  ocrRunTitle,
  ocrCloseTitle,
  aiRunTitle,
  aiCloseTitle,
  pinTitle,
  unpinTitle,
  buttonClassName,
  activeButtonClassName,
  iconSize = 18,
}: PreviewQuickActionsProps) {
  return (
    <>
      {canUseOcr && (
        <button
          type="button"
          onClick={onToggleOcr}
          className={cn(buttonClassName, isOcrOpen && activeButtonClassName)}
          title={isOcrOpen ? ocrCloseTitle : ocrRunTitle}
        >
          <ScanText size={iconSize} />
        </button>
      )}
      {canUseAi && (
        <button
          type="button"
          onClick={onToggleAi}
          className={cn(buttonClassName, isAiOpen && activeButtonClassName)}
          title={isAiOpen ? aiCloseTitle : aiRunTitle}
        >
          <Languages size={iconSize} />
        </button>
      )}
      <button
        type="button"
        onClick={onTogglePinned}
        className={buttonClassName}
        title={isPinned ? unpinTitle : pinTitle}
      >
        {isPinned ? <PinOff size={iconSize} /> : <Pin size={iconSize} />}
      </button>
    </>
  );
}
