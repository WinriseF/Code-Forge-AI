import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import liquidLoaderUrl from '@/assets/liquid-loader.lottie';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { Select } from '@/components/ui/select';
import { SUPPORTED_LANGUAGES, type SupportedLangCode } from '@/lib/aiTranslate';
import { useAppStore } from '@/store/useAppStore';
import type { PreviewAiState } from './usePreviewAi';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
};

interface PreviewAiPanelProps {
  state: PreviewAiState;
  onStartTranslate: () => void;
  onRetranslate: () => void;
  onTargetLangChange: (lang: SupportedLangCode) => void;
}

export function PreviewAiPanel({
  state,
  onStartTranslate,
  onRetranslate,
  onTargetLangChange,
}: PreviewAiPanelProps) {
  const { t } = useTranslation();

  const aiConfig = useAppStore(useShallow((s) => s.aiConfig));
  const setAIConfig = useAppStore((s) => s.setAIConfig);
  const savedProviders = useAppStore(useShallow((s) => s.savedProviderSettings));

  const providerOptions = Object.keys(savedProviders)
    .filter((id) => savedProviders[id]?.apiKey)
    .map((id) => ({ value: id, label: PROVIDER_LABELS[id] ?? id }));

  const langOptions = SUPPORTED_LANGUAGES.map((lang) => ({
    value: lang.code,
    label: lang.label,
  }));

  const handleProviderChange = (id: string) => {
    const saved = savedProviders[id];
    if (saved) {
      setAIConfig({
        providerId: id,
        modelId: saved.modelId,
        baseUrl: saved.baseUrl,
        apiKey: saved.apiKey,
        temperature: saved.temperature,
      });
    }
  };

  const isBusy = state.isOcrRunning || state.isTranslating;
  const hasResult = Boolean(state.translatedContent);
  const showLoader = (state.isOcrRunning || state.isTranslating) && !state.translatedContent;
  const chunkLabel =
    state.chunkProgress && state.chunkProgress.total > 1
      ? `${state.chunkProgress.current}/${state.chunkProgress.total}`
      : null;
  const loaderTitle = state.isOcrRunning
    ? t('peek.aiOcrRunningTitle')
    : chunkLabel
      ? `${t('peek.aiTranslatingTitle')} ${chunkLabel}`
      : t('peek.aiTranslatingTitle');
  const content = state.translatedContent || (state.isTranslating ? '...' : '');

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-background">
      {/* Compact settings row */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <Select
            value={aiConfig.providerId}
            onChange={handleProviderChange}
            options={providerOptions}
            size="sm"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Select
            value={state.targetLang}
            onChange={(v) => onTargetLangChange(v as SupportedLangCode)}
            options={langOptions}
            size="sm"
          />
        </div>
        <button
          type="button"
          onClick={isBusy ? undefined : hasResult ? onRetranslate : onStartTranslate}
          disabled={isBusy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground disabled:opacity-40"
          title={hasResult ? t('peek.aiRetranslate') : t('peek.aiRun')}
        >
          {isBusy ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : hasResult ? (
            <RefreshCw size={13} />
          ) : (
            <Check size={13} />
          )}
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {showLoader ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <DotLottieReact src={liquidLoaderUrl} autoplay loop className="h-16 w-16" />
            <p className="text-sm font-medium text-foreground">{loaderTitle}</p>
          </div>
        ) : state.error ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
                <AlertTriangle size={16} />
                <span>{t('peek.aiErrorTitle')}</span>
              </div>
              <p className="mt-2 break-words text-sm text-muted-foreground">{state.error}</p>
            </div>
          </div>
        ) : content ? (
          <>
            {state.truncated && (
              <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-300">
                {t('peek.aiTruncatedWarning')}
              </div>
            )}
            <MarkdownContent
              content={content}
              variant="chat"
              className="min-h-full px-1 text-sm leading-7 select-text [&_p]:mb-3 [&_p:last-child]:mb-0"
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}
