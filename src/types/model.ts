export interface AIModelConfig {
  id: string;
  name: string;
  provider: 'OpenAI' | 'Anthropic' | 'Google' | 'DeepSeek' | 'Other';
  contextLimit: number;
  inputPricePerMillion: number;
  color?: string;
}

export interface AIProviderConfig {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  temperature: number;
}

export interface AIProviderSetting {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  temperature: number;
}

export type AIModelCategory =
  | 'chat'
  | 'translation'
  | 'coding'
  | 'vision'
  | 'embedding'
  | 'rerank'
  | 'other';

export interface AIModelCapabilities {
  stream?: boolean;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  [key: string]: unknown;
}

export interface AIModelParams {
  [key: string]: unknown;
}

export interface AIModelRecord {
  id: string;
  name: string;
  category: AIModelCategory;
  providerName: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature: number | null;
  maxTokens: number | null;
  capabilitiesJson: string;
  paramsJson: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  remark: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAIModelInput {
  name: string;
  category: AIModelCategory;
  providerName: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature?: number | null;
  maxTokens?: number | null;
  capabilitiesJson?: string;
  paramsJson?: string;
  enabled?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  remark?: string;
}

export interface UpdateAIModelInput extends CreateAIModelInput {
  id: string;
  enabled: boolean;
  isDefault: boolean;
}

export const DEFAULT_PROVIDER_SETTINGS: Record<string, AIProviderSetting> = {
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o', temperature: 0.7 },
  deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-chat', temperature: 0.7 },
  anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-3-5-sonnet', temperature: 0.7 }
};

export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  providerId: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
  temperature: 0.7
};
