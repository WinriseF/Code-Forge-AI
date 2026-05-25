import { getAIModel, getDefaultAIModelByCategory, listAIModels } from '@/lib/aiModels';
import type { AIModelCategory, AIModelRecord, AIProviderConfig } from '@/types/model';

const RUNTIME_AI_CONFIG_CACHE_TTL_MS = 2_000;

const runtimeConfigCache = new Map<string, { value: AIProviderConfig; expiresAt: number }>();
const runtimeConfigInFlight = new Map<string, Promise<AIProviderConfig>>();

function toProviderConfig(model: AIModelRecord): AIProviderConfig {
  return {
    providerId: model.modelId,
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    modelId: model.modelId,
    temperature: model.temperature ?? 0.7,
    maxTokens: model.maxTokens ?? undefined,
  };
}

async function resolveCategoryRuntimeAIConfig(category: AIModelCategory): Promise<AIProviderConfig | null> {
  const [defaultModel, enabledModels] = await Promise.all([
    getDefaultAIModelByCategory(category),
    listAIModels({ category, enabledOnly: true }),
  ]);

  if (defaultModel?.enabled) {
    return toProviderConfig(defaultModel);
  }

  const fallback = enabledModels[0];
  if (fallback) {
    return toProviderConfig(fallback);
  }

  return null;
}

function getCachedRuntimeConfig(key: string): AIProviderConfig | null {
  const cached = runtimeConfigCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() >= cached.expiresAt) {
    runtimeConfigCache.delete(key);
    return null;
  }

  return cached.value;
}

async function resolveCachedRuntimeConfig(
  key: string,
  loader: () => Promise<AIProviderConfig>
): Promise<AIProviderConfig> {
  const cached = getCachedRuntimeConfig(key);
  if (cached) {
    return cached;
  }

  const existing = runtimeConfigInFlight.get(key);
  if (existing) {
    return existing;
  }

  const inFlight = loader()
    .then((value) => {
      runtimeConfigCache.set(key, {
        value,
        expiresAt: Date.now() + RUNTIME_AI_CONFIG_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      runtimeConfigInFlight.delete(key);
    });

  runtimeConfigInFlight.set(key, inFlight);
  return inFlight;
}

export function clearRuntimeAIConfigCache(): void {
  runtimeConfigCache.clear();
  runtimeConfigInFlight.clear();
}

export async function getRuntimeAIConfig(category: AIModelCategory = 'chat'): Promise<AIProviderConfig> {
  return resolveCachedRuntimeConfig(`category:${category}`, async () => {
    const categoryConfig = await resolveCategoryRuntimeAIConfig(category);
    if (categoryConfig) {
      return categoryConfig;
    }

    if (category === 'translation' || category === 'coding') {
      const chatConfig = await resolveCategoryRuntimeAIConfig('chat');
      if (chatConfig) {
        return chatConfig;
      }
    }

    throw new Error(`No enabled default AI model configured for ${category}.`);
  });
}

export async function getRuntimeAIConfigById(id: string): Promise<AIProviderConfig> {
  return resolveCachedRuntimeConfig(`id:${id}`, async () => {
    const model = await getAIModel(id);
    if (!model) {
      throw new Error(`AI model not found: ${id}.`);
    }
    if (!model.enabled) {
      throw new Error(`AI model is disabled: ${model.modelId}.`);
    }
    return toProviderConfig(model);
  });
}
