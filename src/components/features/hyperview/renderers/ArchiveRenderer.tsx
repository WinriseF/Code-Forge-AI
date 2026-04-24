import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Archive,
  File,
  FileImage,
  FileText,
  Folder,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatBytes } from '@/lib/utils';
import type {
  ArchiveEntry,
  ArchiveEntryPreview,
  ArchiveListing,
  FileMeta,
} from '@/types/hyperview';

import { CodeRenderer } from './CodeRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';

function createInnerMeta(meta: FileMeta, entry: ArchiveEntry, mime: string): FileMeta {
  return {
    path: `${meta.path}::${entry.path}`,
    name: entry.name,
    size: entry.size ?? 0,
    previewType: 'code',
    supportedModes: ['default'],
    defaultMode: 'default',
    mime,
  };
}

function entryIcon(entry: ArchiveEntry) {
  if (entry.isDir) {
    return <Folder size={15} className="text-amber-500" />;
  }

  if (!entry.isSafePath) {
    return <ShieldAlert size={15} className="text-destructive" />;
  }

  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(entry.name)) {
    return <FileImage size={15} className="text-sky-500" />;
  }

  if (/\.(txt|md|json|xml|csv|tsv|log|rs|js|ts|tsx|jsx|css|html?|py|java|c|cpp|h|sql|toml|ya?ml|ini|conf)$/i.test(entry.name)) {
    return <FileText size={15} className="text-emerald-500" />;
  }

  return <File size={15} className="text-muted-foreground" />;
}

function ArchiveEntryPreviewPanel({
  meta,
  preview,
  loading,
  error,
}: {
  meta: FileMeta;
  preview: ArchiveEntryPreview | null;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <AlertTriangle size={24} className="text-amber-500" />
        <div>
          <p className="text-sm font-semibold text-foreground">{t('peek.archivePreviewFailed')}</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <Archive size={26} />
        <div>
          <p className="text-sm font-semibold text-foreground">{t('peek.archiveEmptySelection')}</p>
          <p className="mt-1 text-sm">{t('peek.archiveOpenHint')}</p>
        </div>
      </div>
    );
  }

  if (preview.kind === 'image' && preview.dataUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-black/95 p-4">
        <img
          src={preview.dataUrl}
          alt={preview.entry.name}
          className="block max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  if (preview.kind === 'text' && preview.text !== null) {
    const innerMeta = createInnerMeta(meta, preview.entry, preview.mime);
    if (preview.language === 'markdown') {
      return <MarkdownRenderer meta={innerMeta} content={preview.text} />;
    }

    return <CodeRenderer meta={innerMeta} content={preview.text} language={preview.language ?? undefined} />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <File size={24} />
      <div>
        <p className="text-sm font-semibold text-foreground">{preview.entry.name}</p>
        <p className="mt-1 text-xs font-mono">{preview.mime}</p>
        <p className="mt-3 text-sm">{preview.message ?? t('peek.archiveUnsupportedEntry')}</p>
      </div>
    </div>
  );
}

export function ArchiveRenderer({ meta }: { meta: FileMeta }) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<ArchiveEntryPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setListing(null);
    setSelectedIndex(null);
    setPreview(null);
    setPreviewError(null);
    previewRequestIdRef.current += 1;

    const load = async () => {
      try {
        const nextListing = await invoke<ArchiveListing>('list_archive_entries', { path: meta.path });
        if (!cancelled) {
          setListing(nextListing);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      previewRequestIdRef.current += 1;
    };
  }, [meta.path]);

  const selectedEntry = useMemo(() => {
    if (!listing || selectedIndex === null) {
      return null;
    }

    return listing.entries.find((entry) => entry.index === selectedIndex) ?? null;
  }, [listing, selectedIndex]);

  const openEntryPreview = async (entry: ArchiveEntry) => {
    const previewRequestId = ++previewRequestIdRef.current;
    setSelectedIndex(entry.index);
    setPreview(null);
    setPreviewError(null);

    if (entry.isDir) {
      setPreviewError(t('peek.archiveDirectoryNotPreviewable'));
      return;
    }

    if (!entry.isSafePath) {
      setPreviewError(t('peek.archiveUnsafeEntry'));
      return;
    }

    if (!entry.previewable) {
      setPreviewError(t('peek.archiveEntryTooLarge', { limit: formatBytes(listing?.maxPreviewBytes ?? 1024 * 1024) }));
      return;
    }

    setPreviewLoading(true);
    try {
      const nextPreview = await invoke<ArchiveEntryPreview>('preview_archive_entry', {
        path: meta.path,
        entryIndex: entry.index,
      });
      if (previewRequestId === previewRequestIdRef.current) {
        setPreview(nextPreview);
      }
    } catch (loadError) {
      if (previewRequestId === previewRequestIdRef.current) {
        setPreviewError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (previewRequestId === previewRequestIdRef.current) {
        setPreviewLoading(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <Archive size={28} />
        <div>
          <p className="text-sm font-semibold text-foreground">{t('peek.archivePreviewUnsupported')}</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!listing) {
    return null;
  }

  const archiveDisplaySize =
    listing.totalSize > 0 ? listing.totalSize : listing.totalCompressedSize;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(280px,42%)_1fr] overflow-hidden border-t border-border bg-background">
      <div className="flex min-w-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {t('peek.archiveEntries', { count: listing.entries.length })}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {listing.format}
              {archiveDisplaySize !== null ? ` · ${formatBytes(archiveDisplaySize)}` : ''}
              {listing.truncated ? ` · ${t('peek.archiveTruncated')}` : ''}
            </div>
          </div>
          <Archive size={18} className="shrink-0 text-muted-foreground" />
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{t('peek.archiveName')}</th>
                <th className="w-24 px-3 py-2 text-right font-medium">{t('peek.archiveSize')}</th>
              </tr>
            </thead>
            <tbody>
              {listing.entries.map((entry) => {
                const selected = selectedEntry?.index === entry.index;
                return (
                  <tr
                    key={`${entry.index}:${entry.path}`}
                    tabIndex={0}
                    className={`cursor-default border-b border-border/50 outline-none transition-colors hover:bg-secondary/60 focus:bg-secondary/70 ${
                      selected ? 'bg-secondary/70' : ''
                    }`}
                    onClick={() => {
                      setSelectedIndex(entry.index);
                    }}
                    onDoubleClick={() => {
                      void openEntryPreview(entry);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void openEntryPreview(entry);
                      }
                    }}
                  >
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0">{entryIcon(entry)}</span>
                        <span className="truncate" title={entry.path}>
                          {entry.path}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {entry.isDir ? '-' : entry.size === null ? t('peek.archiveUnknownSize') : formatBytes(entry.size)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="min-w-0 min-h-0">
        <ArchiveEntryPreviewPanel
          meta={meta}
          preview={preview}
          loading={previewLoading}
          error={previewError}
        />
      </div>
    </div>
  );
}
