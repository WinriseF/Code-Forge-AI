import { useEffect, useRef, type ReactNode } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  animate,
} from 'framer-motion';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const hasOpenedRef = useRef(false);

  // MotionValue lives outside React render cycle — zero re-renders on drag
  const panelWidth = useMotionValue(0);

  // Stable transition: avoid creating new object every render
  const transition = reduceMotion ? { duration: 0 } : LAYOUT_TRANSITION;

  // Open / close animation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (showPanel) {
      if (!hasOpenedRef.current) {
        hasOpenedRef.current = true;
        animate(panelWidth, container.offsetWidth * DEFAULT_PANEL_RATIO, transition);
      }
    } else {
      hasOpenedRef.current = false;
      animate(panelWidth, 0, transition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transition is logically stable
  }, [showPanel, panelWidth]);

  // Drag handlers — update MotionValue directly, no React re-render
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const pointerOffset = e.clientX - containerRect.left;

      panelWidth.set(
        Math.min(
          Math.max(containerWidth - pointerOffset, MIN_PANEL_PX),
          containerWidth - MIN_PREVIEW_PX,
        ),
      );
    };

    const onMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [panelWidth]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/*
        Preview uses flex:1 to fill remaining space.
        No useTransform needed — flex handles container resize automatically.
      */}
      <div
        className={`min-w-0 overflow-hidden pr-[2px] ${showPanel ? 'flex-1' : 'w-full'}`}
      >
        {preview}
      </div>

      {/* Draggable divider */}
      {showPanel && (
        <div
          onMouseDown={startResize}
          className="relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 active:bg-primary"
        />
      )}

      <motion.div
        initial={false}
        animate={
          showPanel
            ? reduceMotion
              ? { opacity: 1 }
              : { opacity: 1, x: 0, filter: 'blur(0px)' }
            : reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, x: 18, filter: 'blur(6px)' }
        }
        style={{
          width: showPanel ? panelWidth : 0,
          pointerEvents: showPanel ? 'auto' : 'none',
        }}
        transition={transition}
        className="min-w-0 shrink-0 overflow-hidden pr-[3px]"
      >
        {panel}
      </motion.div>
    </div>
  );
}
