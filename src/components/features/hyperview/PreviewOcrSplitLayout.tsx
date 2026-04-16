import { useEffect, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface PreviewOcrSplitLayoutProps {
  showPanel: boolean;
  preview: ReactNode;
  panel: ReactNode;
}

const LAYOUT_TRANSITION = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1] as const,
};

const MIN_PANEL_PX = 200;
const MIN_PREVIEW_PX = 150;
const DEFAULT_PANEL_RATIO = 0.4;

export function PreviewOcrSplitLayout({
  showPanel,
  preview,
  panel,
}: PreviewOcrSplitLayoutProps) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : LAYOUT_TRANSITION;

  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const panelWidthRef = useRef(0);

  // Initialize panel width from default ratio when panel first opens
  const hasOpenedRef = useRef(false);
  useEffect(() => {
    if (showPanel && !hasOpenedRef.current) {
      hasOpenedRef.current = true;
      if (containerRef.current) {
        panelWidthRef.current = containerRef.current.offsetWidth * DEFAULT_PANEL_RATIO;
      }
    }
  }, [showPanel]);

  // Drag handlers — direct DOM manipulation for smooth 60fps resizing
  useEffect(() => {
    const container = containerRef.current;
    const previewEl = previewRef.current;
    const panelEl = panelRef.current;
    if (!container || !previewEl || !panelEl) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const pointerOffset = e.clientX - containerRect.left;

      // Panel width = container width - pointer offset
      const newPanelWidth = Math.min(
        Math.max(containerWidth - pointerOffset, MIN_PANEL_PX),
        containerWidth - MIN_PREVIEW_PX,
      );

      panelWidthRef.current = newPanelWidth;
      const newPreviewWidth = containerWidth - newPanelWidth;

      previewEl.style.width = `${newPreviewWidth}px`;
      panelEl.style.width = `${newPanelWidth}px`;
    };

    const onMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;

      // Re-enable transitions after drag
      previewEl.style.transition = '';
      panelEl.style.transition = '';

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;

    const previewEl = previewRef.current;
    const panelEl = panelRef.current;
    if (previewEl && panelEl) {
      // Disable transitions during drag for instant feedback
      previewEl.style.transition = 'none';
      panelEl.style.transition = 'none';
    }

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      <motion.div
        ref={previewRef}
        initial={false}
        animate={{ width: showPanel ? `${(1 - DEFAULT_PANEL_RATIO) * 100}%` : '100%' }}
        transition={transition}
        className="min-w-0 shrink-0 overflow-hidden"
      >
        {preview}
      </motion.div>

      {/* Draggable divider */}
      {showPanel && (
        <div
          onMouseDown={startResize}
          className="relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 active:bg-primary"
        />
      )}

      <motion.div
        ref={panelRef}
        initial={false}
        animate={
          showPanel
            ? reduceMotion
              ? { width: `${DEFAULT_PANEL_RATIO * 100}%`, opacity: 1 }
              : { width: `${DEFAULT_PANEL_RATIO * 100}%`, opacity: 1, x: 0, filter: 'blur(0px)' }
            : reduceMotion
              ? { width: '0%', opacity: 0 }
              : { width: '0%', opacity: 0, x: 18, filter: 'blur(6px)' }
        }
        transition={transition}
        style={{ pointerEvents: showPanel ? 'auto' : 'none' }}
        className="min-w-0 shrink-0 overflow-hidden"
      >
        {panel}
      </motion.div>
    </div>
  );
}
