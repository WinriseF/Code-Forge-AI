import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Select } from './select';
import { useAppStore } from '@/store/useAppStore';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
};

type SelectSize = 'sm' | 'default' | 'lg';

interface AiProviderSelectProps {
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  size?: SelectSize;
  onProviderChange?: (providerId: string) => void;
}

export function getAiProviderLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

export function useConfiguredAiProviderOptions() {
  const savedProviders = useAppStore(useShallow((state) => state.savedProviderSettings));

  return useMemo(() => (
    Object.keys(savedProviders)
      .filter((providerId) => savedProviders[providerId]?.apiKey)
      .map((providerId) => ({
        value: providerId,
        label: getAiProviderLabel(providerId),
      }))
  ), [savedProviders]);
}

export function AiProviderSelect({
  disabled = false,
  className,
  placeholder,
  size = 'default',
  onProviderChange,
}: AiProviderSelectProps) {
  const [aiConfig, savedProviders] = useAppStore(
    useShallow((state) => [state.aiConfig, state.savedProviderSettings])
  );
  const setAIConfig = useAppStore((state) => state.setAIConfig);
  const providerOptions = useConfiguredAiProviderOptions();

  const handleProviderChange = useCallback((providerId: string) => {
    const saved = savedProviders[providerId];
    if (!saved) {
      return;
    }

    setAIConfig({
      providerId,
      modelId: saved.modelId,
      baseUrl: saved.baseUrl,
      apiKey: saved.apiKey,
      temperature: saved.temperature,
    });
    onProviderChange?.(providerId);
  }, [onProviderChange, savedProviders, setAIConfig]);

  return (
    <Select
      value={aiConfig.providerId}
      onChange={handleProviderChange}
      options={providerOptions}
      placeholder={placeholder}
      disabled={disabled || providerOptions.length === 0}
      className={className}
      size={size}
    />
  );
}
