import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { ChevronLeft, ChevronRight, Eye, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { PreviewQuickActions } from '@/components/features/hyperview/PreviewQuickActions';
import { PreviewModeSwitch } from '@/components/features/hyperview/PreviewModeSwitch';
import { PreviewViewport } from '@/components/features/hyperview/PreviewViewport';
import { usePreviewOcr } from '@/components/features/hyperview/usePreviewOcr';
import { usePreviewAi, type PreviewTextSource } from '@/components/features/hyperview/usePreviewAi';
import { MAX_INLINE_PREVIEW_BYTES, OVERSIZED_PREVIEW_ERROR } from '@/lib/previewLimits';
import { applyThemeToDocument } from '@/lib/theme';
import { formatBytes } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';
import { usePeekStore } from '@/store/usePeekStore';
import type { PeekOpenPayload } from '@/types/peek';

const appWindow = getCurrentWebviewWindow();
const BLUR_CLOSE_DELAY_MS = 180;
const DRAG_BLUR_GUARD_MS = 1_200;
const INTERACTIVE_KEYBOARD_TARGETS = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'audio',
  'video',
  'iframe',
  '[contenteditable="true"]',
  '[role="button"]',
  '.monaco-editor',
].join(', ');

function targetOwnsKeyboard(event: KeyboardEvent) {
  const nodes = [event.target, document.activeElement].filter(
    (value): value is Element => value instanceof Element
  );

  return nodes.some((node) => node.closest(INTERACTIVE_KEYBOARD_TARGETS));
}

export default function PeekApp() {
  const theme = useAppStore((state) => state.theme);
  const { t } = useTranslation();
  const blurCloseTimerRef = useRef<number | null>(null);
  const ignoreBlurUntilRef = useRef(0);
  const {
    paths,
    activeIndex,
    activeFile,
    activeMode,
    isLoading,
    error,
    isPinned,
    openSession,
    next,
    previous,
    setActiveMode,
    setPinned,
    togglePinned,
    clear,
  } = usePeekStore(
    useShallow((state) => ({
      paths: state.paths,
      activeIndex: state.activeIndex,
      activeFile: state.activeFile,
      activeMode: state.activeMode,
      isLoading: state.isLoading,
      error: state.error,
      isPinned: state.isPinned,
      openSession: state.openSession,
      next: state.next,
      previous: state.previous,
      setActiveMode: state.setActiveMode,
      setPinned: state.setPinned,
      togglePinned: state.togglePinned,
      clear: state.clear,
    }))
  );
  const [previewTextSource, setPreviewTextSource] = useState<PreviewTextSource | null>(null);

  useEffect(() => {
    setPreviewTextSource(null);
  }, [activeFile?.path]);

  const previewOcr = usePreviewOcr({
    activeFile,
    onAutoPin: () => setPinned(true),
  });
  const previewAi = usePreviewAi({
    activeFile,
    previewTextSource,
    onAutoPin: () => setPinned(true),
  });

  const closePeekWindow = useCallback(async () => {
    clear();

    try {
      await invoke('peek_clear_request');
    } catch (error) {
      console.error('[Peek] Failed to clear pending request:', error);
    }

    try {
      await appWindow.close();
    } catch (error) {
      console.error('[Peek] Failed to close window:', error);
    }
  }, [clear]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const attachPendingRequest = async () => {
      try {
        const payload = await invoke<PeekOpenPayload | null>('peek_get_request');
        if (payload) {
          await openSession(payload);
        }
      } catch (loadError) {
        console.error('[Peek] Failed to load pending request:', loadError);
      }
    };

    void attachPendingRequest();
  }, [openSession]);

  useEffect(() => {
    const unlistenPromise = listen<PeekOpenPayload>('peek:open', (event) => {
      void openSession(event.payload);
    });

    const cancelPendingBlurClose = () => {
      if (blurCloseTimerRef.current !== null) {
        window.clearTimeout(blurCloseTimerRef.current);
        blurCloseTimerRef.current = null;
      }
    };

    const scheduleBlurClose = (delayMs: number) => {
      if (usePeekStore.getState().isPinned) {
        return;
      }

      cancelPendingBlurClose();
      blurCloseTimerRef.current = window.setTimeout(() => {
        blurCloseTimerRef.current = null;

        if (document.hasFocus()) {
          return;
        }

        if (usePeekStore.getState().isPinned) {
          return;
        }

        void closePeekWindow();
      }, delayMs);
    };

    const focusListener = appWindow.onFocusChanged(({ payload }) => {
      if (payload) {
        cancelPendingBlurClose();
        return;
      }

      const remainingIgnoreMs = ignoreBlurUntilRef.current - Date.now();
      if (remainingIgnoreMs > 0) {
        scheduleBlurClose(Math.max(remainingIgnoreMs, BLUR_CLOSE_DELAY_MS));
        return;
      }

      scheduleBlurClose(BLUR_CLOSE_DELAY_MS);
    });

    return () => {
      cancelPendingBlurClose();
      unlistenPromise.then((unlisten) => unlisten());
      focusListener.then((unlisten) => unlisten());
    };
  }, [clear, openSession, closePeekWindow]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        void closePeekWindow();
        return;
      }

      if (targetOwnsKeyboard(event)) {
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        void closePeekWindow();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void next();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void previous();
        return;
      }

      if (event.key === 'Enter' && activeFile) {
        event.preventDefault();
        void open(activeFile.path).catch((error) => {
          console.error('[Peek] Failed to open file with default app:', error);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile, closePeekWindow, next, previous]);

  const canNavigate = paths.length > 1;
  const currentPosition = paths.length > 0 ? activeIndex + 1 : 0;
  const canUseOcr = Boolean(activeFile && !error && activeFile.previewType === 'image');
  const canUseAi = Boolean(activeFile && !error);
  const showOcrPanel = canUseOcr && previewOcr.isOpen && !previewAi.isOpen;
  const showAiPanel = previewAi.isOpen;
  const handleToggleOcr = () => {
    if (previewAi.isOpen) {
      previewAi.closePanel();
      return;
    }
    if (previewOcr.isOpen) {
      previewOcr.closePanel();
      return;
    }

    void previewOcr.runOcr();
  };
  const handleToggleAi = () => {
    if (previewOcr.isOpen) {
      previewOcr.closePanel();
    }
    if (previewAi.isOpen) {
      previewAi.closePanel();
      return;
    }
    previewAi.openPanel();
  };

  return (
    <div className="peek-window flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 px-5 py-3 select-none">
        <div
          data-tauri-drag-region
          className="flex min-w-0 flex-1 cursor-move items-center gap-3"
          onMouseDown={(event) => {
            if (event.button === 0) {
              ignoreBlurUntilRef.current = Date.now() + DRAG_BLUR_GUARD_MS;
            }
          }}
        >
          <Eye size={18} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {activeFile?.name || t('peek.title')}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {activeFile
                ? `${activeFile.mime} · ${formatBytes(activeFile.size)}`
                : t('peek.subtitle')}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          {activeFile && !error && activeFile.supportedModes.length > 1 && (
            <PreviewModeSwitch
              modes={activeFile.supportedModes}
              value={activeMode}
              onChange={setActiveMode}
              className="mr-1"
            />
          )}
          {canNavigate && (
            <span>{currentPosition}/{paths.length}</span>
          )}
          <PreviewQuickActions
            canUseOcr={canUseOcr}
            isOcrOpen={previewOcr.isOpen}
            canUseAi={canUseAi}
            isAiOpen={previewAi.isOpen}
            isPinned={isPinned}
            onToggleOcr={handleToggleOcr}
            onToggleAi={handleToggleAi}
            onTogglePinned={togglePinned}
            ocrRunTitle={t('peek.ocrRun')}
            ocrCloseTitle={t('peek.ocrClosePanel')}
            aiRunTitle={t('peek.aiRun')}
            aiCloseTitle={t('peek.aiClosePanel')}
            pinTitle={t('peek.pinPreview')}
            unpinTitle={t('peek.unpinPreview')}
            buttonClassName="inline-flex items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            activeButtonClassName="bg-secondary/70 text-foreground"
            iconSize={16}
          />
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden bg-transparent">
        <PreviewViewport
          activeFile={activeFile}
          activeMode={activeMode}
          isLoading={isLoading}
          error={error}
          showOcrPanel={showOcrPanel}
          showAiPanel={showAiPanel}
          previewOcr={previewOcr}
          previewAi={previewAi}
          onPreviewTextSourceChange={setPreviewTextSource}
          onHighlightOcrLine={previewOcr.highlightLine}
          onSelectOcrLine={previewOcr.selectLine}
          onAiStartTranslate={previewAi.startTranslate}
          onAiTargetLangChange={previewAi.setTargetLang}
          oversizedError={OVERSIZED_PREVIEW_ERROR}
          renderLoading={() => (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-foreground/60" />
              <p className="text-sm">{t('peek.loading')}</p>
            </div>
          )}
          renderError={({ error: currentError, isOversizedPreview, activeFile: currentFile, openExternal }) => (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText size={22} className="text-destructive" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {isOversizedPreview ? t('peek.oversizedTitle') : t('peek.failed')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isOversizedPreview
                    ? t('peek.oversizedDescription', { limit: formatBytes(MAX_INLINE_PREVIEW_BYTES) })
                    : currentError}
                </p>
              </div>
              {isOversizedPreview && currentFile && (
                <button
                  type="button"
                  onClick={openExternal}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  {t('peek.openExternal')}
                </button>
              )}
            </div>
          )}
          renderEmpty={() => (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <Eye size={22} />
              <div>
                <p className="text-sm font-semibold text-foreground">{t('peek.emptyTitle')}</p>
                <p className="mt-1 text-sm">{t('peek.emptyDescription')}</p>
              </div>
            </div>
          )}
        />
      </main>

      <footer className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{t('peek.hintClose')}</span>
          <span>{t('peek.hintOpen')}</span>
        </div>
        {canNavigate && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <ChevronLeft size={14} />
              {t('peek.hintPrevious')}
            </span>
            <span className="inline-flex items-center gap-1">
              {t('peek.hintNext')}
              <ChevronRight size={14} />
            </span>
          </div>
        )}
      </footer>
    </div>
  );
}
