import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewAiPanel } from '@/components/features/hyperview/PreviewAiPanel';
import type { PreviewAiState } from '@/components/features/hyperview/usePreviewAi';

const { useAppStoreMock } = vi.hoisted(() => {
  const state = {
    aiConfig: {
      providerId: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      temperature: 0.7,
    },
    setAIConfig: vi.fn(),
    savedProviderSettings: {
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o-mini',
        temperature: 0.7,
      },
    },
  };

  return {
    useAppStoreMock: vi.fn((selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
    ),
  };
});

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lottiefiles/dotlottie-react', () => ({
  DotLottieReact: () => <div data-testid="ai-loader" />,
}));

vi.mock('@/assets/liquid-loader.lottie', () => ({
  default: 'liquid-loader.lottie',
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: useAppStoreMock,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value }: { value: string }) => <div>{value}</div>,
}));

vi.mock('@/components/ui/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe('PreviewAiPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows streaming content while translation is still in progress', () => {
    const state: PreviewAiState = {
      isOpen: true,
      isTranslating: true,
      isOcrRunning: false,
      translatedContent: 'partial translated text',
      targetLang: 'zh',
      error: null,
      truncated: false,
    };

    render(
      <PreviewAiPanel
        state={state}
        onStartTranslate={vi.fn()}
        onRetranslate={vi.fn()}
        onTargetLangChange={vi.fn()}
      />,
    );

    expect(screen.getByText('partial translated text')).toBeTruthy();
    expect(screen.getByText('peek.aiTranslatingTitle')).toBeTruthy();
  });

  it('keeps the centered loader only before the first translation chunk arrives', () => {
    const state: PreviewAiState = {
      isOpen: true,
      isTranslating: true,
      isOcrRunning: false,
      translatedContent: '',
      targetLang: 'zh',
      error: null,
      truncated: false,
    };

    render(
      <PreviewAiPanel
        state={state}
        onStartTranslate={vi.fn()}
        onRetranslate={vi.fn()}
        onTargetLangChange={vi.fn()}
      />,
    );

    expect(screen.getByText('peek.aiTranslatingTitle')).toBeTruthy();
    expect(screen.getByText('...')).toBeTruthy();
  });
});
