export interface AIModelConfig {
  id: string;
  name: string;
  provider: 'OpenAI' | 'Anthropic' | 'Google' | 'DeepSeek' | 'Other';
  contextLimit: number;         // 上下文限制 (Token)
  inputPricePerMillion: number; // 输入价格 ($/1M tokens)
  color?: string;               // UI 装饰色 (Tailwind类名)
}

// AI 提供商配置接口
export interface AIProviderConfig {
  providerId: 'openai' | 'deepseek' | 'anthropic';
  apiKey: string;
  baseUrl?: string; // 支持自定义代理地址
  modelId: string;  // 默认模型，如 deepseek-chat
  temperature: number; // 控制随机性 (0-1)
}

export interface AIProviderSetting {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  temperature: number;
}

export const DEFAULT_PROVIDER_SETTINGS: Record<string, AIProviderSetting> = {
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o', temperature: 0.7 },
  deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-chat', temperature: 0.7 },
  anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-3-5-sonnet', temperature: 0.7 }
};

// 默认配置 (以 DeepSeek 为例，性价比高)
export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  providerId: 'deepseek', 
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
  temperature: 0.7
};