import { type ReactNode } from 'react';

import { open } from '@tauri-apps/plugin-shell';

import { PreviewContent } from './PreviewContent';
import { PreviewAiPanel } from './PreviewAiPanel';
import { PreviewOcrPanel } from './PreviewOcrPanel';
import { PreviewOcrSplitLayout } from './PreviewOcrSplitLayout';
import type { PreviewAiState } from './usePreviewAi';
import type { PreviewTextSource } from './usePreviewAi';
import type { PreviewOcrState } from './usePreviewOcr';
import type { SupportedLangCode } from '@/lib/aiTranslate';
import type { FileMeta, PreviewMode } from '@/types/hyperview';

interface PreviewViewportProps {
  activeFile: FileMeta | null;
  activeMode: PreviewMode;
  isLoading: boolean;
  error: string | null;
  showOcrPanel: boolean;
  showAiPanel: boolean;
  previewOcr: PreviewOcrState;
  previewAi: PreviewAiState;
  onPreviewTextSourceChange?: (source: PreviewTextSource | null) => void;
  onHighlightOcrLine: (index: number) => void;
  onSelectOcrLine: (index: number) => void;
  onAiStartTranslate: () => void;
  onAiTargetLangChange: (lang: SupportedLangCode) => void;
  renderLoading: () => ReactNode;
  renderError: (args: {
    error: string;
    isOversizedPreview: boolean;
    activeFile: FileMeta | null;
    openExternal: () => void;
  }) => ReactNode;
  renderEmpty?: () => ReactNode;
  oversizedError: string;
}

export function PreviewViewport({
  activeFile,
  activeMode,
  isLoading,
  error,
  showOcrPanel,
  showAiPanel,
  previewOcr,
  previewAi,
  onPreviewTextSourceChange,
  onHighlightOcrLine,
  onSelectOcrLine,
  onAiStartTranslate,
  onAiTargetLangChange,
  renderLoading,
  renderError,
  renderEmpty,
  oversizedError,
}: PreviewViewportProps) {
  const isOversizedPreview = error === oversizedError;
  const showPanel = showOcrPanel || showAiPanel;

  if (isLoading) {
    return <>{renderLoading()}</>;
  }

  if (error) {
    return (
      <>
        {renderError({
          error,
          isOversizedPreview,
          activeFile,
          openExternal: () => {
            if (!activeFile) {
              return;
            }

            void open(activeFile.path).catch(() => undefined);
          },
        })}
      </>
    );
  }

  if (!activeFile) {
    return <>{renderEmpty?.() ?? null}</>;
  }

  return (
    <PreviewOcrSplitLayout
      showPanel={showPanel}
      preview={
        <PreviewContent
          meta={activeFile}
          mode={activeMode}
          ocrResult={previewOcr.result}
          selectedOcrLineIndex={previewOcr.selectedLineIndex}
          onSelectOcrLine={onSelectOcrLine}
          onPreviewTextSourceChange={onPreviewTextSourceChange}
        />
      }
      panel={
        showAiPanel ? (
          <PreviewAiPanel
            state={previewAi}
            onStartTranslate={onAiStartTranslate}
            onRetranslate={onAiStartTranslate}
            onTargetLangChange={onAiTargetLangChange}
          />
        ) : (
          <PreviewOcrPanel
            state={previewOcr}
            onHighlightLine={onHighlightOcrLine}
            onSelectLine={onSelectOcrLine}
          />
        )
      }
    />
  );
}
