import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { formatBytes } from '@/lib/utils';
import { MAX_INLINE_PREVIEW_BYTES, OVERSIZED_PREVIEW_ERROR } from '@/lib/previewLimits';
import { usePreviewStore } from '@/store/usePreviewStore';
import { FileText, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { PreviewQuickActions } from './PreviewQuickActions';
import { PreviewModeSwitch } from './PreviewModeSwitch';
import { PreviewViewport } from './PreviewViewport';
import { usePreviewOcr } from './usePreviewOcr';
import { usePreviewAi, type PreviewTextSource } from './usePreviewAi';

export function PreviewModal() {
  const { t } = useTranslation();
  const {
    isOpen,
    activeFile,
    activeMode,
    isLoading,
    error,
    isPinned,
    closePreview,
    setActiveMode,
    setPinned,
    togglePinned,
  } = usePreviewStore(
    useShallow((state) => ({
      isOpen: state.isOpen,
      activeFile: state.activeFile,
      activeMode: state.activeMode,
      isLoading: state.isLoading,
      error: state.error,
      isPinned: state.isPinned,
      closePreview: state.closePreview,
      setActiveMode: state.setActiveMode,
      setPinned: state.setPinned,
      togglePinned: state.togglePinned,
    })),
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        e.stopPropagation();
        closePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closePreview]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-8"
          onClick={isPinned ? undefined : closePreview}
        >
          <div
            className="w-full max-w-5xl h-[80vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-secondary/10 shrink-0 select-none">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="p-1.5 bg-secondary rounded text-muted-foreground">
                        <FileText size={16} />
                    </div>
                    <div className="flex flex-col min-w-0">
                         <span className="font-medium text-sm truncate">{activeFile?.name || t('peek.loading')}</span>
                         {activeFile && <span className="text-[10px] text-muted-foreground font-mono">{activeFile.mime} • {activeFile.size.toLocaleString()} bytes</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {activeFile && !error && activeFile.supportedModes.length > 1 && (
                        <PreviewModeSwitch
                          modes={activeFile.supportedModes}
                          value={activeMode}
                          onChange={setActiveMode}
                        />
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
                      buttonClassName="rounded p-1.5 transition-colors hover:bg-secondary/70"
                      activeButtonClassName="bg-secondary/70 text-foreground"
                    />
                    <button onClick={closePreview} className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded transition-colors">
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 bg-card relative overflow-hidden">
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
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    {t('peek.loading')}
                  </div>
                )}
                renderError={({ error: currentError, isOversizedPreview, activeFile: currentFile, openExternal }) => (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-destructive flex-col gap-3 text-center">
                    <p className="font-bold">
                      {isOversizedPreview ? t('peek.oversizedTitle') : t('peek.failed')}
                    </p>
                    <p className="max-w-xl text-sm opacity-80">
                      {isOversizedPreview
                        ? t('peek.oversizedDescription', { limit: formatBytes(MAX_INLINE_PREVIEW_BYTES) })
                        : currentError}
                    </p>
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
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
