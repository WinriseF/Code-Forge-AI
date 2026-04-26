import { invoke } from '@tauri-apps/api/core';
import type {
  AIModelCategory,
  AIModelRecord,
  CreateAIModelInput,
  UpdateAIModelInput,
} from '@/types/model';

export const AI_MODEL_CATEGORIES: AIModelCategory[] = [
  'chat',
  'translation',
  'coding',
  'vision',
  'embedding',
  'rerank',
  'other',
];

export const AI_MODEL_CATEGORY_LABELS: Record<AIModelCategory, string> = {
  chat: 'Chat',
  translation: 'Translation',
  coding: 'Coding',
  vision: 'Vision',
  embedding: 'Embedding',
  rerank: 'Rerank',
  other: 'Other',
};

export interface ListAIModelsOptions {
  category?: AIModelCategory;
  enabledOnly?: boolean;
}

export function listAIModels(options: ListAIModelsOptions = {}) {
  return invoke<AIModelRecord[]>('list_ai_models', {
    category: options.category ?? null,
    enabledOnly: options.enabledOnly ?? null,
  });
}

export function getAIModel(id: string) {
  return invoke<AIModelRecord | null>('get_ai_model', { id });
}

export function createAIModel(input: CreateAIModelInput) {
  return invoke<AIModelRecord>('create_ai_model', { input });
}

export function updateAIModel(input: UpdateAIModelInput) {
  return invoke<AIModelRecord>('update_ai_model', { input });
}

export function deleteAIModel(id: string) {
  return invoke<void>('delete_ai_model', { id });
}

export function getDefaultAIModelByCategory(category: AIModelCategory) {
  return invoke<AIModelRecord | null>('get_default_ai_model', { category });
}

export function setDefaultAIModel(id: string) {
  return invoke<AIModelRecord>('set_default_ai_model', { id });
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

export function normalizeJsonObject(raw: string) {
  return JSON.stringify(parseJsonObject(raw));
}
