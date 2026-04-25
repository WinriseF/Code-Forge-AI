import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  Code2,
  Database,
  Eye,
  Languages,
  Layers3,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OcrServiceCard } from '@/components/settings/sections/OcrServiceCard';
import { SettingsSurface } from '@/components/settings/SettingsUi';
import {
  AI_MODEL_CATEGORIES,
  AI_MODEL_CATEGORY_LABELS,
  createAIModel,
  deleteAIModel,
  importLegacyAIModelsIfNeeded,
  listAIModels,
  normalizeJsonObject,
  setDefaultAIModel,
  updateAIModel,
} from '@/lib/aiModels';
import { cn } from '@/lib/utils';
import type {
  AIModelCategory,
  AIModelRecord,
  CreateAIModelInput,
  UpdateAIModelInput,
} from '@/types/model';

type CategoryFilter = AIModelCategory | 'all';
type EditorMode = 'empty' | 'create' | 'edit';

interface AIModelDraft {
  id?: string;
  name: string;
  category: AIModelCategory;
  providerName: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
  capabilitiesJson: string;
  paramsJson: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: string;
  remark: string;
}

interface JsonErrors {
  capabilitiesJson?: string;
  paramsJson?: string;
}

const DEFAULT_CAPABILITIES_JSON = JSON.stringify(
  {
    stream: true,
    tools: false,
    vision: false,
    reasoning: false,
  },
  null,
  2,
);

const DEFAULT_PARAMS_JSON = '{}';

function categoryIcon(category: AIModelCategory) {
  const iconClass = 'h-4 w-4';
  switch (category) {
    case 'translation':
      return <Languages className={iconClass} />;
    case 'coding':
      return <Code2 className={iconClass} />;
    case 'vision':
      return <Eye className={iconClass} />;
    case 'embedding':
      return <Database className={iconClass} />;
    case 'rerank':
      return <Layers3 className={iconClass} />;
    case 'other':
      return <Sparkles className={iconClass} />;
    case 'chat':
    default:
      return <Bot className={iconClass} />;
  }
}

function createBlankDraft(sortOrder: number): AIModelDraft {
  return {
    name: '',
    category: 'chat',
    providerName: '',
    baseUrl: '',
    modelId: '',
    apiKey: '',
    temperature: '0.7',
    maxTokens: '',
    capabilitiesJson: DEFAULT_CAPABILITIES_JSON,
    paramsJson: DEFAULT_PARAMS_JSON,
    enabled: true,
    isDefault: false,
    sortOrder: String(sortOrder),
    remark: '',
  };
}

function draftFromRecord(model: AIModelRecord): AIModelDraft {
  return {
    id: model.id,
    name: model.name,
    category: model.category,
    providerName: model.providerName,
    baseUrl: model.baseUrl,
    modelId: model.modelId,
    apiKey: model.apiKey,
    temperature: model.temperature === null ? '' : String(model.temperature),
    maxTokens: model.maxTokens === null ? '' : String(model.maxTokens),
    capabilitiesJson: prettyJson(model.capabilitiesJson),
    paramsJson: prettyJson(model.paramsJson),
    enabled: model.enabled,
    isDefault: model.isDefault,
    sortOrder: String(model.sortOrder),
    remark: model.remark,
  };
}

function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw || '{}';
  }
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseOptionalInteger(value: string): number | null {
  const parsed = parseOptionalNumber(value);
  if (parsed === null || Number.isNaN(parsed)) {
    return parsed;
  }
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function buildInputFromDraft(draft: AIModelDraft): CreateAIModelInput {
  const temperature = parseOptionalNumber(draft.temperature);
  const maxTokens = parseOptionalInteger(draft.maxTokens);
  const sortOrder = parseOptionalInteger(draft.sortOrder);

  return {
    name: draft.name.trim(),
    category: draft.category,
    providerName: draft.providerName.trim(),
    baseUrl: draft.baseUrl.trim(),
    modelId: draft.modelId.trim(),
    apiKey: draft.apiKey.trim(),
    temperature: Number.isNaN(temperature) ? null : temperature,
    maxTokens: Number.isNaN(maxTokens) ? null : maxTokens,
    capabilitiesJson: normalizeJsonObject(draft.capabilitiesJson),
    paramsJson: normalizeJsonObject(draft.paramsJson),
    enabled: draft.enabled,
    isDefault: draft.isDefault,
    sortOrder: Number.isNaN(sortOrder) || sortOrder === null ? 0 : sortOrder,
    remark: draft.remark.trim(),
  };
}

function summarizeJson(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    return keys.length === 0 ? 'empty' : keys.slice(0, 4).join(', ');
  } catch {
    return 'invalid';
  }
}

export function AISection() {
  const { t } = useTranslation();
  const [models, setModels] = useState<AIModelRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIModelDraft>(() => createBlankDraft(0));
  const [mode, setMode] = useState<EditorMode>('empty');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<JsonErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshModels();
  }, []);

  async function refreshModels(preferredId?: string) {
    setLoading(true);
    setError(null);
    try {
      await importLegacyAIModelsIfNeeded().catch(() => 0);
      const nextModels = await listAIModels();
      setModels(nextModels);

      const target =
        nextModels.find((model) => model.id === preferredId) ??
        nextModels.find((model) => model.id === selectedId) ??
        nextModels.find((model) => model.isDefault && model.enabled) ??
        nextModels[0];

      if (target) {
        selectModel(target);
      } else {
        setMode('empty');
        setSelectedId(null);
        setDraft(createBlankDraft(0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function selectModel(model: AIModelRecord) {
    setMode('edit');
    setSelectedId(model.id);
    setDraft(draftFromRecord(model));
    setJsonErrors({});
    setMessage(null);
    setError(null);
  }

  function startCreate(category: AIModelCategory = categoryFilter === 'all' ? 'chat' : categoryFilter) {
    const maxOrder = models.reduce((max, model) => Math.max(max, model.sortOrder), 0);
    setMode('create');
    setSelectedId(null);
    setDraft({ ...createBlankDraft(maxOrder + 1), category });
    setJsonErrors({});
    setMessage(null);
    setError(null);
  }

  function validateDraft() {
    const nextErrors: JsonErrors = {};
    setJsonErrors({});

    if (!draft.name.trim()) {
      return t('settings.aiModelNameRequired');
    }
    if (!draft.providerName.trim()) {
      return t('settings.aiModelProviderRequired');
    }
    if (!draft.baseUrl.trim()) {
      return t('settings.aiModelBaseUrlRequired');
    }
    if (!draft.modelId.trim()) {
      return t('settings.aiModelIdRequired');
    }
    if (!draft.apiKey.trim()) {
      return t('settings.aiModelApiKeyRequired');
    }
    if (!draft.enabled && draft.isDefault) {
      return t('settings.aiModelDisabledDefaultError');
    }
    if (Number.isNaN(parseOptionalNumber(draft.temperature))) {
      return t('settings.aiModelTemperatureInvalid');
    }
    if (Number.isNaN(parseOptionalInteger(draft.maxTokens))) {
      return t('settings.aiModelMaxTokensInvalid');
    }
    if (Number.isNaN(parseOptionalInteger(draft.sortOrder))) {
      return t('settings.aiModelSortOrderInvalid');
    }

    try {
      normalizeJsonObject(draft.capabilitiesJson);
    } catch (err) {
      nextErrors.capabilitiesJson = err instanceof Error ? err.message : String(err);
    }
    try {
      normalizeJsonObject(draft.paramsJson);
    } catch (err) {
      nextErrors.paramsJson = err instanceof Error ? err.message : String(err);
    }

    setJsonErrors(nextErrors);
    if (nextErrors.capabilitiesJson || nextErrors.paramsJson) {
      return t('settings.aiModelJsonInvalid');
    }
    return null;
  }

  async function handleSave() {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const baseInput = buildInputFromDraft(draft);
      const saved =
        mode === 'edit' && draft.id
          ? await updateAIModel({
              ...baseInput,
              id: draft.id,
              enabled: draft.enabled,
              isDefault: draft.isDefault,
            } satisfies UpdateAIModelInput)
          : await createAIModel(baseInput);

      const feedback = t('settings.aiModelSaved');
      await refreshModels(saved.id);
      setMessage(feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(model: AIModelRecord) {
    if (!model.enabled) {
      setError(t('settings.aiModelDisabledDefaultError'));
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await setDefaultAIModel(model.id);
      const feedback = t('settings.aiModelDefaultUpdated');
      await refreshModels(updated.id);
      setMessage(feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) {
      return;
    }
    const confirmed = window.confirm(t('settings.aiModelDeleteConfirm', { name: draft.name }));
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await deleteAIModel(draft.id);
      const feedback = t('settings.aiModelDeleted');
      await refreshModels();
      setMessage(feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const filteredModels = models.filter((model) => {
    const matchesCategory = categoryFilter === 'all' || model.category === categoryFilter;
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery =
      !normalizedQuery ||
      [model.name, model.providerName, model.modelId, model.baseUrl]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });

  const selectedModel = models.find((model) => model.id === selectedId) ?? null;
  const categoryCounts = AI_MODEL_CATEGORIES.reduce<Record<AIModelCategory, number>>((acc, category) => {
    acc[category] = models.filter((model) => model.category === category).length;
    return acc;
  }, {} as Record<AIModelCategory, number>);

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t('settings.aiModelWorkbenchTitle')}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t('settings.aiModelWorkbenchDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label={t('settings.aiModelRefresh')}
            onClick={() => void refreshModels()}
            disabled={loading || saving}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </IconButton>
          <button
            type="button"
            onClick={() => startCreate()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('settings.aiModelNew')}
          </button>
        </div>
      </div>

      <SettingsSurface className="overflow-hidden p-0">
        <div className="grid min-h-[640px] grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="border-b border-border/60 lg:border-b-0 lg:border-r">
            <div className="space-y-3 border-b border-border/60 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('settings.aiModelSearchPlaceholder')}
                  className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                />
              </div>

              <div className="flex gap-1 overflow-x-auto pb-1 custom-scrollbar">
                <FilterButton
                  active={categoryFilter === 'all'}
                  label={t('settings.aiModelAllCategories')}
                  count={models.length}
                  onClick={() => setCategoryFilter('all')}
                />
                {AI_MODEL_CATEGORIES.map((category) => (
                  <FilterButton
                    key={category}
                    active={categoryFilter === category}
                    label={t(`settings.aiModelCategory.${category}`, AI_MODEL_CATEGORY_LABELS[category])}
                    count={categoryCounts[category]}
                    onClick={() => setCategoryFilter(category)}
                  />
                ))}
              </div>
            </div>

            <div className="max-h-[560px] overflow-y-auto p-2 custom-scrollbar lg:max-h-none">
              {loading ? (
                <StatePanel
                  icon={<RefreshCw className="h-4 w-4 animate-spin" />}
                  title={t('settings.aiModelLoading')}
                />
              ) : filteredModels.length === 0 ? (
                <StatePanel
                  icon={<Bot className="h-4 w-4" />}
                  title={t('settings.aiModelEmpty')}
                  actionLabel={t('settings.aiModelNew')}
                  onAction={() => startCreate()}
                />
              ) : (
                <div className="space-y-1">
                  {filteredModels.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      active={selectedId === model.id}
                      categoryLabel={t(
                        `settings.aiModelCategory.${model.category}`,
                        AI_MODEL_CATEGORY_LABELS[model.category],
                      )}
                      defaultLabel={t('settings.aiModelDefault')}
                      disabledLabel={t('settings.aiModelDisabled')}
                      onSelect={() => selectModel(model)}
                    />
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="min-w-0">
            {mode === 'empty' ? (
              <div className="flex min-h-[520px] items-center justify-center p-6">
                <StatePanel
                  icon={<Bot className="h-4 w-4" />}
                  title={t('settings.aiModelEditorEmpty')}
                  body={t('settings.aiModelEditorEmptyDesc')}
                  actionLabel={t('settings.aiModelNew')}
                  onAction={() => startCreate()}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[640px] flex-col">
                <div className="border-b border-border/60 px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs text-muted-foreground">
                          {categoryIcon(draft.category)}
                          {t(`settings.aiModelCategory.${draft.category}`, AI_MODEL_CATEGORY_LABELS[draft.category])}
                        </span>
                        {draft.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                            <Star className="h-3.5 w-3.5 fill-current" />
                            {t('settings.aiModelDefault')}
                          </span>
                        )}
                        {!draft.enabled && (
                          <span className="rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs text-muted-foreground">
                            {t('settings.aiModelDisabled')}
                          </span>
                        )}
                      </div>
                      <h4 className="mt-3 truncate text-base font-semibold text-foreground">
                        {mode === 'create'
                          ? t('settings.aiModelCreateTitle')
                          : draft.name || t('settings.aiModelEditTitle')}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {mode === 'create'
                          ? t('settings.aiModelCreateDesc')
                          : t('settings.aiModelEditDesc')}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {mode === 'edit' && selectedModel && !selectedModel.isDefault && (
                        <button
                          type="button"
                          onClick={() => void handleSetDefault(selectedModel)}
                          disabled={saving || !selectedModel.enabled}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Star className="h-4 w-4" />
                          {t('settings.aiModelSetDefault')}
                        </button>
                      )}
                      {mode === 'edit' && (
                        <IconButton
                          label={t('common.delete')}
                          onClick={() => void handleDelete()}
                          disabled={saving}
                          danger
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {t('settings.aiModelSave')}
                      </button>
                    </div>
                  </div>

                  {(message || error) && (
                    <FeedbackBanner tone={error ? 'error' : 'success'}>
                      {error ?? message}
                    </FeedbackBanner>
                  )}
                </div>

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 custom-scrollbar">
                  <FormSection title={t('settings.aiModelSectionBasics')}>
                    <FormGrid>
                      <Field label={t('settings.aiModelName')} className="sm:col-span-2">
                        <TextInput
                          value={draft.name}
                          onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
                          placeholder={t('settings.aiModelNamePlaceholder')}
                        />
                      </Field>
                      <Field label={t('settings.aiModelCategoryLabel')}>
                        <select
                          value={draft.category}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              category: event.target.value as AIModelCategory,
                            }))
                          }
                          className={inputClassName}
                        >
                          {AI_MODEL_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {t(`settings.aiModelCategory.${category}`, AI_MODEL_CATEGORY_LABELS[category])}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t('settings.provider')}>
                        <TextInput
                          value={draft.providerName}
                          onChange={(value) => setDraft((current) => ({ ...current, providerName: value }))}
                          placeholder="OpenAI / DeepSeek"
                        />
                      </Field>
                      <Field label={t('settings.aiModelBaseUrlLabel')} className="sm:col-span-2">
                        <TextInput
                          value={draft.baseUrl}
                          onChange={(value) => setDraft((current) => ({ ...current, baseUrl: value }))}
                          placeholder="https://api.example.com/v1"
                        />
                      </Field>
                      <Field label={t('settings.modelId')}>
                        <TextInput
                          value={draft.modelId}
                          onChange={(value) => setDraft((current) => ({ ...current, modelId: value }))}
                          placeholder="gpt-4o / deepseek-chat"
                        />
                      </Field>
                      <Field label={t('settings.apiKey')}>
                        <TextInput
                          type="password"
                          value={draft.apiKey}
                          onChange={(value) => setDraft((current) => ({ ...current, apiKey: value }))}
                          placeholder="sk-..."
                        />
                      </Field>
                    </FormGrid>
                  </FormSection>

                  <FormSection title={t('settings.aiModelSectionRuntime')}>
                    <FormGrid>
                      <Field label={t('settings.temp')}>
                        <TextInput
                          value={draft.temperature}
                          onChange={(value) => setDraft((current) => ({ ...current, temperature: value }))}
                          placeholder="0.7"
                        />
                      </Field>
                      <Field label={t('settings.aiModelMaxTokens')}>
                        <TextInput
                          value={draft.maxTokens}
                          onChange={(value) => setDraft((current) => ({ ...current, maxTokens: value }))}
                          placeholder="4096"
                        />
                      </Field>
                      <Field label={t('settings.aiModelSortOrder')}>
                        <TextInput
                          value={draft.sortOrder}
                          onChange={(value) => setDraft((current) => ({ ...current, sortOrder: value }))}
                          placeholder="0"
                        />
                      </Field>
                      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
                        <CheckboxField
                          checked={draft.enabled}
                          label={t('settings.aiModelEnabledToggle')}
                          description={t('settings.aiModelEnabledHint')}
                          onChange={(enabled) =>
                            setDraft((current) => ({
                              ...current,
                              enabled,
                              isDefault: enabled ? current.isDefault : false,
                            }))
                          }
                        />
                        <CheckboxField
                          checked={draft.isDefault}
                          disabled={!draft.enabled}
                          label={t('settings.aiModelDefaultToggle')}
                          description={t('settings.aiModelDefaultHint')}
                          onChange={(isDefault) => setDraft((current) => ({ ...current, isDefault }))}
                        />
                      </div>
                    </FormGrid>
                  </FormSection>

                  <FormSection title={t('settings.aiModelSectionAdvanced')}>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <JsonEditor
                        label={t('settings.aiModelCapabilities')}
                        summary={summarizeJson(draft.capabilitiesJson)}
                        value={draft.capabilitiesJson}
                        error={jsonErrors.capabilitiesJson}
                        onChange={(value) => setDraft((current) => ({ ...current, capabilitiesJson: value }))}
                      />
                      <JsonEditor
                        label={t('settings.aiModelParams')}
                        summary={summarizeJson(draft.paramsJson)}
                        value={draft.paramsJson}
                        error={jsonErrors.paramsJson}
                        onChange={(value) => setDraft((current) => ({ ...current, paramsJson: value }))}
                      />
                    </div>
                  </FormSection>

                  <Field label={t('settings.aiModelRemark')}>
                    <textarea
                      value={draft.remark}
                      onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))}
                      placeholder={t('settings.aiModelRemarkPlaceholder')}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                    />
                  </Field>
                </div>
              </div>
            )}
          </section>
        </div>
      </SettingsSurface>

      <OcrServiceCard />
    </div>
  );
}

const inputClassName =
  'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-primary/50 focus:ring-2 focus:ring-primary/15';

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{count}</span>
    </button>
  );
}

function ModelRow({
  model,
  active,
  categoryLabel,
  defaultLabel,
  disabledLabel,
  onSelect,
}: {
  model: AIModelRecord;
  active: boolean;
  categoryLabel: string;
  defaultLabel: string;
  disabledLabel: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-3 py-3 text-left transition-colors',
        active
          ? 'border-primary/40 bg-primary/10'
          : 'border-transparent bg-transparent hover:border-border hover:bg-secondary/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
            {model.isDefault && (
              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label={defaultLabel} />
            )}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {model.providerName} / {model.modelId}
          </div>
        </div>
        <span
          className={cn(
            'mt-1 h-2 w-2 shrink-0 rounded-full',
            model.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/40',
          )}
        />
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{categoryLabel}</span>
        <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/35" />
        <span className="truncate">{model.enabled ? summarizeJson(model.capabilitiesJson) : disabledLabel}</span>
      </div>
    </button>
  );
}

function StatePanel({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center p-6 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
      {body && <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{body}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary/50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h5 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h5>
      {children}
    </section>
  );
}

function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-2', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={inputClassName}
    />
  );
}

function CheckboxField({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex gap-3 rounded-lg border border-border bg-background px-3 py-3',
        disabled && 'opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-primary"
      />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function JsonEditor({
  label,
  summary,
  value,
  error,
  onChange,
}: {
  label: string;
  summary: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="truncate text-[11px] text-muted-foreground/70">{summary}</span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        spellCheck={false}
        className={cn(
          'w-full resize-none rounded-lg border bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none transition-colors focus:ring-2',
          error
            ? 'border-red-400/60 focus:ring-red-400/15'
            : 'border-border focus:border-primary/50 focus:ring-primary/15',
        )}
      />
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

function FeedbackBanner({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        tone === 'error'
          ? 'border-red-400/25 bg-red-400/10 text-red-200'
          : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
      )}
    >
      {tone === 'error' ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'border-red-400/25 bg-red-400/10 text-red-300 hover:bg-red-400/15'
          : 'border-border bg-background text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
