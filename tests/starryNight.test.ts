import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createStarryNightMock, highlightMock, flagToScopeMock, toJsxRuntimeMock } = vi.hoisted(() => ({
  createStarryNightMock: vi.fn(),
  highlightMock: vi.fn(),
  flagToScopeMock: vi.fn(),
  toJsxRuntimeMock: vi.fn(() => 'jsx-tree'),
}));

vi.mock('@wooorm/starry-night', () => ({
  common: { mocked: true },
  createStarryNight: createStarryNightMock,
}));

vi.mock('hast-util-to-jsx-runtime', () => ({
  toJsxRuntime: toJsxRuntimeMock,
}));

type StarryNightModule = typeof import('@/lib/markdown/starryNight');

async function importFreshStarryNight(): Promise<StarryNightModule> {
  vi.resetModules();
  const mod = await import('@/lib/markdown/starryNight');
  return mod;
}

describe('starryNight helpers', () => {
  beforeEach(() => {
    createStarryNightMock.mockReset();
    highlightMock.mockReset();
    flagToScopeMock.mockReset();
    toJsxRuntimeMock.mockImplementation(() => 'jsx-tree');
  });

  it('caches highlighted trees and resolves language aliases', async () => {
    createStarryNightMock.mockResolvedValue({
      flagToScope: flagToScopeMock.mockImplementation((flag: string) =>
        flag === 'text' ? 'scope:text' : undefined
      ),
      highlight: highlightMock.mockReturnValue({ type: 'root' }),
    });

    const starryNight = await importFreshStarryNight();

    expect(starryNight.getCachedHighlightTree('plaintext', 'hello')).toBeUndefined();

    const first = await starryNight.highlightCodeTree('plaintext', 'hello');
    const second = await starryNight.highlightCodeTree('plaintext', 'hello');

    expect(first).toEqual({ type: 'root' });
    expect(second).toEqual({ type: 'root' });
    expect(createStarryNightMock).toHaveBeenCalledTimes(1);
    expect(highlightMock).toHaveBeenCalledWith('hello', 'scope:text');
    expect(starryNight.getCachedHighlightTree('plaintext', 'hello')).toEqual({ type: 'root' });
  });

  it('stores null when no scope can be resolved and renders trees to jsx', async () => {
    createStarryNightMock.mockResolvedValue({
      flagToScope: flagToScopeMock.mockReturnValue(undefined),
      highlight: highlightMock.mockReturnValue({ type: 'root' }),
    });

    const starryNight = await importFreshStarryNight();
    const result = await starryNight.highlightCodeTree('unknown', 'hello');

    expect(result).toBeNull();
    expect(highlightMock).not.toHaveBeenCalled();
    expect(starryNight.getCachedHighlightTree('unknown', 'hello')).toBeNull();
    expect(starryNight.renderHighlightTree({ type: 'root' } as any)).toBe('jsx-tree');
    expect(toJsxRuntimeMock).toHaveBeenCalled();
  });

  it('refreshes cached tree recency and evicts the least recently used entry', async () => {
    createStarryNightMock.mockResolvedValue({
      flagToScope: flagToScopeMock.mockImplementation((flag: string) =>
        flag === 'txt' ? 'scope:text' : undefined
      ),
      highlight: highlightMock.mockImplementation((value: string) => ({ type: 'root', value })),
    });

    const starryNight = await importFreshStarryNight();

    for (let index = 0; index < 200; index += 1) {
      await starryNight.highlightCodeTree('txt', `value-${index}`);
    }

    expect(starryNight.getCachedHighlightTree('txt', 'value-0')).toEqual({
      type: 'root',
      value: 'value-0',
    });

    await starryNight.highlightCodeTree('txt', 'value-200');

    expect(starryNight.getCachedHighlightTree('txt', 'value-0')).toEqual({
      type: 'root',
      value: 'value-0',
    });
    expect(starryNight.getCachedHighlightTree('txt', 'value-1')).toBeUndefined();
  });
});
