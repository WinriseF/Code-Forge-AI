export interface AIModelConfig {
  id: string;
  name: string;
  provider: 'OpenAI' | 'Anthropic' | 'Google' | 'DeepSeek' | 'Other';
  contextLimit: number;         // 上下文限制 (Token)
  inputPricePerMillion: number; // 输入价格 ($/1M tokens)
  color?: string;               // UI 装饰色 (Tailwind类名)
}