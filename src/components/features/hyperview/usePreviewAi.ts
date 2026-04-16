import { useCallback, useEffect, useRef, useState } from 'react';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { useShallow } from 'zustand/react/shallow';

import { translate, type SupportedLangCode, type TranslateCallbacks } from '@/lib/aiTranslate';
import { useThrottledStreamUpdate } from '@/lib/hooks/useThrottledStreamUpdate';
import { recognizeOcrFile, normalizeOcrError } from '@/lib/ocr';
import { useAppStore } from '@/store/useAppStore';
import type { FileMeta, PreviewType } from '@/types/hyperview';

export interface PreviewAiState {
  isOpen: boolean;
  isTranslating: boolean;
  isOcrRunning: boolean;
  translatedContent: string;
  targetLang: SupportedLangCode;
  error: string | null;
  truncated: boolean;
  chunkProgress: { current: number; total: number } | null;
}

const INITIAL_STATE: PreviewAiState = {
  isOpen: false,
  isTranslating: false,
  isOcrRunning: false,
  translatedContent: '',
  targetLang: 'zh',
  error: null,
  truncated: false,
  chunkProgress: null,
};

interface UsePreviewAiOptions {
  activeFile: FileMeta | null;
  onAutoPin: () => void;
}

export function usePreviewAi({ activeFile, onAutoPin }: UsePreviewAiOptions) {
  const [state, setState] = useState<PreviewAiState>(INITIAL_STATE);
  const activeRequestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const aiConfig = useAppStore(
    useShallow((s) => s.aiConfig),
  );

  const throttledUpdate = useCallback((contentDelta: string) => {
    setState((prev) => ({
      ...prev,
      translatedContent: prev.translatedContent + contentDelta,
    }));
  }, []);

  const { append, flushFinal, clear } = useThrottledStreamUpdate(
    (contentDelta) => {
      throttledUpdate(contentDelta);
    },
    {
      bufferThreshold: null,
      flushInterval: 200,
      flushOnNewline: true,
    },
  );

  // Reset on file change
  useEffect(() => {
    activeRequestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clear();
    setState(INITIAL_STATE);
  }, [activeFile?.path, clear]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRequestIdRef.current += 1;
      abortRef.current?.abort();
      clear();
    };
  }, [clear]);

  const closePanel = useCallback(() => {
    activeRequestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clear();
    setState(INITIAL_STATE);
  }, [clear]);

  const openPanel = useCallback(() => {
    onAutoPin();
    setState((prev) => ({
      ...INITIAL_STATE,
      isOpen: true,
      targetLang: prev.targetLang,
    }));
  }, [onAutoPin]);

  const runTranslate = useCallback(
    (content: string, previewType: PreviewType, targetLang: SupportedLangCode) => {
      const requestId = ++activeRequestIdRef.current;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      clear();

      setState({
        isOpen: true,
        isTranslating: true,
        isOcrRunning: false,
        translatedContent: '',
        targetLang,
        error: null,
        truncated: false,
        chunkProgress: null,
      });

      const callbacks: TranslateCallbacks = {
        onContentDelta: (delta) => {
          if (requestId !== activeRequestIdRef.current) return;
          append(delta, '');
        },
        onChunkProgress: (chunkIndex, totalChunks) => {
          if (requestId !== activeRequestIdRef.current) return;
          setState((prev) => ({
            ...prev,
            chunkProgress: { current: chunkIndex, total: totalChunks },
          }));
        },
        onDone: (fullText) => {
          if (requestId !== activeRequestIdRef.current) return;
          flushFinal();
          setState((prev) => ({
            ...prev,
            isTranslating: false,
            translatedContent: fullText,
            chunkProgress: null,
          }));
        },
        onError: (error) => {
          if (requestId !== activeRequestIdRef.current) return;
          flushFinal();
          setState((prev) => ({
            ...prev,
            isTranslating: false,
            error,
            chunkProgress: null,
          }));
        },
      };

      void translate(
        { content, previewType, targetLang, signal: abort.signal },
        aiConfig,
        callbacks,
      );
    },
    [aiConfig, append, clear, flushFinal],
  );

  const startTranslate = useCallback(() => {
    if (!activeFile) return;
    onAutoPin();

    // Image: chain OCR → translate
    if (activeFile.previewType === 'image') {
      const requestId = ++activeRequestIdRef.current;
      abortRef.current?.abort();

      setState((prev) => ({
        ...prev,
        isOpen: true,
        isTranslating: false,
        isOcrRunning: true,
        error: null,
        targetLang: prev.targetLang,
      }));

      void (async () => {
        try {
          const ocrResult = await recognizeOcrFile(activeFile.path);
          if (requestId !== activeRequestIdRef.current) return;

          if (!ocrResult.fullText.trim()) {
            setState((prev) => ({
              ...prev,
              isOcrRunning: false,
              error: 'No text detected in image.',
            }));
            return;
          }

          runTranslate(ocrResult.fullText, 'image', state.targetLang);
        } catch (err) {
          if (requestId !== activeRequestIdRef.current) return;
          setState((prev) => ({
            ...prev,
            isOcrRunning: false,
            error: normalizeOcrError(err),
          }));
        }
      })();
      return;
    }

    // Text-based files
    void (async () => {
      try {
        const content = await readTextFile(activeFile.path);
        if (content) {
          runTranslate(content, activeFile.previewType, state.targetLang);
        }
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
  }, [activeFile, onAutoPin, runTranslate, state.targetLang]);

  const setTargetLang = useCallback((lang: SupportedLangCode) => {
    setState((prev) => ({ ...prev, targetLang: lang }));
  }, []);

  return {
    ...state,
    canUseAi: Boolean(activeFile),
    closePanel,
    openPanel,
    startTranslate,
    setTargetLang,
  };
}
