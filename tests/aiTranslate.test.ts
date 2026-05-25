import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProviderConfig } from '@/types/model';

const { streamChatCompletionWithToolsMock } = vi.hoisted(() => ({
  streamChatCompletionWithToolsMock: vi.fn(),
}));

vi.mock('@/lib/llm', () => ({
  streamChatCompletionWithTools: streamChatCompletionWithToolsMock,
}));

const config: AIProviderConfig = {
  providerId: 'test',
  apiKey: 'key',
  baseUrl: 'https://api.example.com/v1',
  modelId: 'model',
  temperature: 0.4,
};

async function runChunkedTranslation(content: string) {
  let responseIndex = 0;
  const deltas: string[] = [];
  const onDone = vi.fn();
  const onError = vi.fn();
  const onChunkProgress = vi.fn();

  streamChatCompletionWithToolsMock.mockImplementation(async (_messages, _config, _options, callbacks) => {
    const translated = `translated-${responseIndex}`;
    responseIndex += 1;
    callbacks?.onContentDelta?.(translated);
    return {
      content: translated,
      reasoning: '',
      toolCalls: [],
      rawAssistantMessage: {
        role: 'assistant',
        content: translated,
      },
    };
  });

  const { translate } = await import('@/lib/aiTranslate');
  await translate(
    {
      content,
      previewType: 'markdown',
      targetLang: 'en',
    },
    config,
    {
      onContentDelta: (delta) => deltas.push(delta),
      onChunkProgress,
      onDone,
      onError,
    }
  );

  return { deltas, onDone, onError, onChunkProgress };
}

describe('aiTranslate chunk separators', () => {
  beforeEach(() => {
    vi.resetModules();
    streamChatCompletionWithToolsMock.mockReset();
  });

  it('preserves single newline separators between forced line chunks', async () => {
    const { deltas, onDone, onChunkProgress } = await runChunkedTranslation(
      `${'a'.repeat(3000)}\n${'b'.repeat(3000)}`
    );

    expect(deltas).toEqual(['translated-0', '\n', 'translated-1']);
    expect(onDone).toHaveBeenCalledWith('translated-0\ntranslated-1');
    expect(onChunkProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it('preserves multi-newline paragraph separators between chunks', async () => {
    const { deltas, onDone } = await runChunkedTranslation(
      `${'a'.repeat(3000)}\n\n\n${'b'.repeat(3000)}`
    );

    expect(deltas).toEqual(['translated-0', '\n\n\n', 'translated-1']);
    expect(onDone).toHaveBeenCalledWith('translated-0\n\n\ntranslated-1');
  });

  it('does not inject separators when chunks are split by character limit only', async () => {
    const { deltas, onDone } = await runChunkedTranslation('x'.repeat(6000));

    expect(deltas).toEqual(['translated-0', 'translated-1']);
    expect(onDone).toHaveBeenCalledWith('translated-0translated-1');
  });
});
