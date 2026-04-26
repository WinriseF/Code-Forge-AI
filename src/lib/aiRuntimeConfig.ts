import { getAIModel, getDefaultAIModelByCategory, listAIModels } from '@/lib/aiModels';
import type { AIModelCategory, AIModelRecord, AIProviderConfig } from '@/types/model';

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

export async function getRuntimeAIConfig(category: AIModelCategory = 'chat'): Promise<AIProviderConfig> {
  const defaultModel = await getDefaultAIModelByCategory(category);
  if (defaultModel?.enabled) {
    return toProviderConfig(defaultModel);
  }

  const enabledModels = await listAIModels({ category, enabledOnly: true });
  const fallback = enabledModels[0];
  if (fallback) {
    return toProviderConfig(fallback);
  }

  if (category === 'translation' || category === 'coding') {
    const chatDefault = await getDefaultAIModelByCategory('chat');
    if (chatDefault?.enabled) {
      return toProviderConfig(chatDefault);
    }

    const chatFallback = (await listAIModels({ category: 'chat', enabledOnly: true }))[0];
    if (chatFallback) {
      return toProviderConfig(chatFallback);
    }
  }

  throw new Error(`No enabled default AI model configured for ${category}.`);
}

export async function getRuntimeAIConfigById(id: string): Promise<AIProviderConfig> {
  const model = await getAIModel(id);
  if (!model) {
    throw new Error(`AI model not found: ${id}.`);
  }
  if (!model.enabled) {
    throw new Error(`AI model is disabled: ${model.modelId}.`);
  }
  return toProviderConfig(model);
}
