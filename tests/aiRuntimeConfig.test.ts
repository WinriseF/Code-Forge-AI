import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIModelCategory, AIModelRecord } from '@/types/model';

const {
  getAIModelMock,
  getDefaultAIModelByCategoryMock,
  listAIModelsMock,
} = vi.hoisted(() => ({
  getAIModelMock: vi.fn(),
  getDefaultAIModelByCategoryMock: vi.fn(),
  listAIModelsMock: vi.fn(),
}));

vi.mock('@/lib/aiModels', () => ({
  getAIModel: getAIModelMock,
  getDefaultAIModelByCategory: getDefaultAIModelByCategoryMock,
  listAIModels: listAIModelsMock,
}));

function model(overrides: Partial<AIModelRecord> = {}): AIModelRecord {
  return {
    id: overrides.id ?? 'model-id',
    category: overrides.category ?? 'chat',
    baseUrl: overrides.baseUrl ?? 'https://api.example.com/v1',
    modelId: overrides.modelId ?? 'model-name',
    apiKey: overrides.apiKey ?? 'secret',
    temperature: overrides.temperature ?? 0.7,
    maxTokens: overrides.maxTokens ?? null,
    capabilitiesJson: '{}',
    paramsJson: '{}',
    enabled: overrides.enabled ?? true,
    isDefault: overrides.isDefault ?? false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function importFreshRuntimeConfig() {
  vi.resetModules();
  return import('@/lib/aiRuntimeConfig');
}

describe('aiRuntimeConfig', () => {
  beforeEach(() => {
    getAIModelMock.mockReset();
    getDefaultAIModelByCategoryMock.mockReset();
    listAIModelsMock.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  it('caches category config for 2 seconds and deduplicates in-flight requests', async () => {
    const runtimeConfig = await importFreshRuntimeConfig();
    const defaultModel = model({ modelId: 'chat-default' });
    getDefaultAIModelByCategoryMock.mockResolvedValue(defaultModel);
    listAIModelsMock.mockResolvedValue([]);

    const [first, second] = await Promise.all([
      runtimeConfig.getRuntimeAIConfig('chat'),
      runtimeConfig.getRuntimeAIConfig('chat'),
    ]);

    expect(first.modelId).toBe('chat-default');
    expect(second.modelId).toBe('chat-default');
    expect(getDefaultAIModelByCategoryMock).toHaveBeenCalledTimes(1);
    expect(listAIModelsMock).toHaveBeenCalledTimes(1);

    vi.mocked(Date.now).mockReturnValue(2_500);
    await runtimeConfig.getRuntimeAIConfig('chat');
    expect(getDefaultAIModelByCategoryMock).toHaveBeenCalledTimes(1);

    vi.mocked(Date.now).mockReturnValue(3_500);
    await runtimeConfig.getRuntimeAIConfig('chat');
    expect(getDefaultAIModelByCategoryMock).toHaveBeenCalledTimes(2);
    expect(listAIModelsMock).toHaveBeenCalledTimes(2);
  });

  it('falls back from translation and coding categories to chat only when needed', async () => {
    const runtimeConfig = await importFreshRuntimeConfig();
    const calls: AIModelCategory[] = [];
    getDefaultAIModelByCategoryMock.mockImplementation(async (category: AIModelCategory) => {
      calls.push(category);
      return null;
    });
    listAIModelsMock.mockImplementation(async ({ category }: { category: AIModelCategory }) =>
      category === 'chat' ? [model({ category: 'chat', modelId: 'chat-fallback' })] : []
    );

    const config = await runtimeConfig.getRuntimeAIConfig('translation');

    expect(config.modelId).toBe('chat-fallback');
    expect(calls).toEqual(['translation', 'chat']);
    expect(listAIModelsMock).toHaveBeenCalledWith({
      category: 'translation',
      enabledOnly: true,
    });
    expect(listAIModelsMock).toHaveBeenCalledWith({
      category: 'chat',
      enabledOnly: true,
    });
  });

  it('caches explicit model lookup by id and rejects disabled models', async () => {
    const runtimeConfig = await importFreshRuntimeConfig();
    getAIModelMock.mockResolvedValue(model({ id: 'one', modelId: 'explicit-model' }));

    const first = await runtimeConfig.getRuntimeAIConfigById('one');
    const second = await runtimeConfig.getRuntimeAIConfigById('one');

    expect(first.modelId).toBe('explicit-model');
    expect(second.modelId).toBe('explicit-model');
    expect(getAIModelMock).toHaveBeenCalledTimes(1);

    runtimeConfig.clearRuntimeAIConfigCache();
    getAIModelMock.mockResolvedValue(model({ id: 'disabled', enabled: false }));

    await expect(runtimeConfig.getRuntimeAIConfigById('disabled')).rejects.toThrow(
      'AI model is disabled'
    );
  });
});
