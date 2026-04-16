import { useCallback, useEffect, useRef } from 'react';

interface UseThrottledStreamUpdateOptions {
  bufferThreshold?: number | null;
  flushInterval?: number;
  flushOnNewline?: boolean;
}

const DEFAULT_BUFFER_THRESHOLD: number | null = null;
const DEFAULT_FLUSH_INTERVAL = 200;
const DEFAULT_FLUSH_ON_NEWLINE = true;

export function useThrottledStreamUpdate(
  onFlush: (content: string, reasoning: string) => void,
  options: UseThrottledStreamUpdateOptions = {},
) {
  const contentBufferRef = useRef('');
  const reasoningBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFlushRef = useRef(onFlush);
  const bufferThreshold = options.bufferThreshold === undefined
    ? DEFAULT_BUFFER_THRESHOLD
    : options.bufferThreshold;
  const flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
  const flushOnNewline = options.flushOnNewline ?? DEFAULT_FLUSH_ON_NEWLINE;

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  const clear = useCallback(() => {
    contentBufferRef.current = '';
    reasoningBufferRef.current = '';
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const flush = useCallback(() => {
    const content = contentBufferRef.current;
    const reasoning = reasoningBufferRef.current;

    if (!content && !reasoning) {
      return;
    }

    onFlushRef.current(content, reasoning);
    clear();
  }, [clear]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) {
      return;
    }

    flushTimerRef.current = setTimeout(() => {
      flush();
    }, flushInterval);
  }, [flush, flushInterval]);

  const append = useCallback(
    (contentDelta: string, reasoningDelta: string) => {
      contentBufferRef.current += contentDelta;
      reasoningBufferRef.current += reasoningDelta;

      if (
        flushOnNewline
        && (
          contentDelta.includes('\n')
          || reasoningDelta.includes('\n')
        )
      ) {
        flush();
        return;
      }

      if (
        bufferThreshold !== null
        && (
          contentBufferRef.current.length >= bufferThreshold
          || reasoningBufferRef.current.length >= bufferThreshold
        )
      ) {
        flush();
        return;
      }

      scheduleFlush();
    },
    [bufferThreshold, flush, flushOnNewline, scheduleFlush],
  );

  const flushFinal = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flush();
  }, [flush]);

  return {
    append,
    flushFinal,
    clear,
  };
}
