import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, Download, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsSurface } from '@/components/settings/SettingsUi';
import { formatBytes } from '@/lib/utils';
import { getOcrStatus, listenToOcrPrepareProgress, prepareOcr, releaseOcr } from '@/lib/ocr';
import type { OcrPrepareProgress, OcrStatus } from '@/types/ocr';

function buildStatusTone(
  status: OcrStatus | null,
  options: { isLoadingStatus: boolean; isPreparingAction: boolean; hasStatusLoadError: boolean },
) {
  if (options.isPreparingAction || status?.preparing) {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-400';
  }
  if (options.isLoadingStatus && !status) {
    return 'border-border bg-secondary/30 text-muted-foreground';
  }
  if (options.hasStatusLoadError) {
    return 'border-red-500/30 bg-red-500/10 text-red-300';
  }
  if (status?.installed) {
    return 'border-green-500/30 bg-green-500/10 text-green-400';
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-400';
}

export function OcrServiceCard() {
  const { t } = useTranslation();
  const isMountedRef = useRef(false);
  const statusRequestIdRef = useRef(0);
  const prepareRequestIdRef = useRef(0);
  const prepareUnlistenRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [progress, setProgress] = useState<OcrPrepareProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isPreparingAction, setIsPreparingAction] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      statusRequestIdRef.current += 1;
      prepareRequestIdRef.current += 1;
      prepareUnlistenRef.current?.();
      prepareUnlistenRef.current = null;
    };
  }, []);

  const loadStatus = useCallback(async () => {
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    setIsLoadingStatus(true);
    setError(null);

    try {
      const nextStatus = await getOcrStatus();
      if (!isMountedRef.current || statusRequestIdRef.current !== requestId) {
        return;
      }

      setStatus(nextStatus);
    } catch (err) {
      if (!isMountedRef.current || statusRequestIdRef.current !== requestId) {
        return;
      }

      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!isMountedRef.current || statusRequestIdRef.current !== requestId) {
        return;
      }

      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handlePrepare = useCallback(async () => {
    const requestId = prepareRequestIdRef.current + 1;
    prepareRequestIdRef.current = requestId;
    prepareUnlistenRef.current?.();
    prepareUnlistenRef.current = null;
    setIsPreparingAction(true);
    setError(null);
    setProgress(null);

    try {
      const unlisten = await listenToOcrPrepareProgress((event) => {
        if (!isMountedRef.current || prepareRequestIdRef.current !== requestId) {
          return;
        }

        setProgress(event);
      });
      if (!isMountedRef.current || prepareRequestIdRef.current !== requestId) {
        unlisten();
        return;
      }

      prepareUnlistenRef.current = unlisten;

      const nextStatus = await prepareOcr();
      if (!isMountedRef.current || prepareRequestIdRef.current !== requestId) {
        return;
      }

      setStatus(nextStatus);
    } catch (err) {
      if (!isMountedRef.current || prepareRequestIdRef.current !== requestId) {
        return;
      }

      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (prepareRequestIdRef.current === requestId) {
        prepareUnlistenRef.current?.();
        prepareUnlistenRef.current = null;
      }
      if (!isMountedRef.current || prepareRequestIdRef.current !== requestId) {
        return;
      }

      setIsPreparingAction(false);
      setProgress(null);
    }
  }, []);

  const handleRelease = useCallback(async () => {
    setIsReleasing(true);
    setError(null);

    try {
      await releaseOcr();
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!isMountedRef.current) {
        return;
      }

      setIsReleasing(false);
    }

    await loadStatus();
  }, [loadStatus]);

  const progressPercent = useMemo(() => {
    if (!progress || progress.totalBytes <= 0) return 0;
    return Math.max(0, Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100));
  }, [progress]);

  const hasStatusLoadError = Boolean(error && !status && !isLoadingStatus);
  const statusLabel = useMemo(() => {
    if (isPreparingAction || status?.preparing) return t('settings.ocrPreparing');
    if (isLoadingStatus && !status) return t('settings.ocrStatusLoading');
    if (hasStatusLoadError) return t('settings.ocrStatusLoadFailed');
    if (status?.installed) return t('settings.ocrReady');
    return t('settings.ocrNotInitialized');
  }, [hasStatusLoadError, isLoadingStatus, isPreparingAction, status, t]);

  return (
    <SettingsSurface className="space-y-5 lg:col-span-12">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-foreground">{t('settings.ocrTitle')}</h4>
        </div>

        <div
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${buildStatusTone(status, {
            isLoadingStatus,
            isPreparingAction,
            hasStatusLoadError,
          })}`}
        >
          {(isPreparingAction || status?.preparing || (isLoadingStatus && !status)) ? (
            <Loader2 size={14} className="animate-spin" />
          ) : status?.installed ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          <span>{statusLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Cpu size={14} />
            {t('settings.ocrCurrentModel')}
          </div>
          <div className="text-sm font-medium text-foreground">{status?.activeModel ?? 'ppocrv5_mobile'}</div>
        </div>

        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Download size={14} />
            {t('settings.ocrCurrentRelease')}
          </div>
          <div className="break-all text-sm font-medium text-foreground">
            {status?.activeRelease || t('settings.ocrNoActiveRelease')}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <HardDrive size={14} />
            {t('settings.ocrEngineState')}
          </div>
          <div className="text-sm font-medium text-foreground">
            {status?.loaded ? t('settings.ocrEngineLoaded') : t('settings.ocrEngineIdle')}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {t('settings.ocrStoragePath')}
          </div>
          <div className="break-all text-sm text-foreground">{status?.modelDir ?? '-'}</div>
        </div>
      </div>

      {(progress || status?.preparing || isPreparingAction) && (
        <div className="space-y-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span>{progress?.message || t('settings.ocrPreparingHint')}</span>
              </div>
              {progress?.currentFile && (
                <div className="mt-1 truncate text-xs text-muted-foreground">{progress.currentFile}</div>
              )}
            </div>
            <div className="shrink-0 text-xs font-mono text-muted-foreground">
              {Math.round(progressPercent)}%
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary/60">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {progress && (
            <div className="flex flex-col gap-1 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                {t('settings.ocrProgressFiles', {
                  completed: progress.completedFiles,
                  total: progress.totalFiles,
                })}
              </span>
              <span>
                {t('settings.ocrProgressBytes', {
                  downloaded: formatBytes(progress.downloadedBytes),
                  total: formatBytes(progress.totalBytes),
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {!isLoadingStatus && status && !status.installed && status.missingFiles.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
            {t('settings.ocrMissingFiles')}
          </div>
          <div className="flex flex-wrap gap-2">
            {status.missingFiles.map((file) => (
              <span
                key={file}
                className="rounded-full border border-amber-500/20 bg-background/60 px-2.5 py-1 text-xs text-foreground"
              >
                {file}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handlePrepare()}
          disabled={isPreparingAction || status?.preparing}
          className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPreparingAction || status?.preparing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : status?.installed ? (
            <RefreshCw size={16} />
          ) : (
            <Download size={16} />
          )}
          <span>{status?.installed ? t('settings.ocrValidateAction') : t('settings.ocrInitAction')}</span>
        </button>

        <button
          onClick={() => void handleRelease()}
          disabled={isReleasing || !status?.loaded}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isReleasing ? <Loader2 size={16} className="animate-spin" /> : <Cpu size={16} />}
          <span>{t('settings.ocrReleaseAction')}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </SettingsSurface>
  );
}
