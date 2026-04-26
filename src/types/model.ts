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
  maxTokens?: number;
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
  category: AIModelCategory;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature: number | null;
  maxTokens: number | null;
  capabilitiesJson: string;
  paramsJson: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAIModelInput {
  category: AIModelCategory;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature?: number | null;
  maxTokens?: number | null;
  capabilitiesJson?: string;
  paramsJson?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface UpdateAIModelInput extends CreateAIModelInput {
  id: string;
  enabled: boolean;
  isDefault: boolean;
}
