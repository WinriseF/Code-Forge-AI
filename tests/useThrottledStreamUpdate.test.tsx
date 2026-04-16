import React, { useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThrottledStreamUpdate } from '@/lib/hooks/useThrottledStreamUpdate';

function StreamHarness({
  onFlush,
  onReady,
}: {
  onFlush: (content: string, reasoning: string) => void;
  onReady: (controls: {
    append: (content: string, reasoning: string) => void;
    flushFinal: () => void;
  }) => void;
}) {
  const stream = useThrottledStreamUpdate(onFlush, {
    bufferThreshold: null,
    flushInterval: 200,
    flushOnNewline: true,
  });

  useEffect(() => {
    onReady({
      append: stream.append,
      flushFinal: stream.flushFinal,
    });
  }, [onReady, stream.append, stream.flushFinal]);

  return null;
}

describe('useThrottledStreamUpdate', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('flushes immediately when a newline arrives', () => {
    vi.useFakeTimers();
    const flushSpy = vi.fn();
    let controls: {
      append: (content: string, reasoning: string) => void;
      flushFinal: () => void;
    } | null = null;

    render(
      <StreamHarness
        onFlush={flushSpy}
        onReady={(value) => {
          controls = value;
        }}
      />,
    );

    act(() => {
      controls?.append('hello', '');
    });
    expect(flushSpy).not.toHaveBeenCalled();

    act(() => {
      controls?.append('\nworld', '');
    });
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledWith('hello\nworld', '');
  });

  it('flushes after 200ms when no newline arrives', () => {
    vi.useFakeTimers();
    const flushSpy = vi.fn();
    let controls: {
      append: (content: string, reasoning: string) => void;
      flushFinal: () => void;
    } | null = null;

    render(
      <StreamHarness
        onFlush={flushSpy}
        onReady={(value) => {
          controls = value;
        }}
      />,
    );

    act(() => {
      controls?.append('hello', '');
    });
    expect(flushSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(flushSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledWith('hello', '');
  });
});
