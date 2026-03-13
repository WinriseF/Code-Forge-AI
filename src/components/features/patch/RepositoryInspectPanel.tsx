import type { ReactNode } from 'react';
import { Clock3, FileText, GitCommitHorizontal, Info, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { summarizeDiffFiles } from '@/lib/git_insights';
import type { GitCommitDetails, GitDiffFileItem, GitRepositorySummary } from '@/types/git';

interface RepositoryInspectPanelProps {
  repositorySummary: GitRepositorySummary | null;
  commitDetails: GitCommitDetails | null;
  selectedFile: GitDiffFileItem | null;
  files: GitDiffFileItem[];
}

export function RepositoryInspectPanel({
  repositorySummary,
  commitDetails,
  selectedFile,
  files,
}: RepositoryInspectPanelProps) {
  const { t } = useTranslation();
  const stats = summarizeDiffFiles(files);

  return (
    <aside className="hidden w-[320px] shrink-0 border-l border-border bg-secondary/10 xl:flex xl:flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t('patch.inspect')}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {commitDetails ? (
          <>
            <InspectCard
              icon={<GitCommitHorizontal size={14} />}
              title={t('patch.commitDetails')}
              rows={[
                { label: t('patch.summary'), value: commitDetails.summary || commitDetails.hash.slice(0, 7) },
                { label: 'SHA', value: commitDetails.hash },
                { label: t('patch.parents'), value: `${commitDetails.parentHashes.length}` },
              ]}
            />

            <InspectCard
              icon={<UserRound size={14} />}
              title={t('patch.authorInfo')}
              rows={[
                { label: t('patch.author'), value: commitDetails.author },
                { label: t('patch.email'), value: commitDetails.email || '-' },
                { label: t('patch.date'), value: commitDetails.date },
              ]}
            />

            <div className="rounded-xl border border-border bg-background/70 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText size={14} />
                {t('patch.changedFiles')}
              </div>
              <div className="space-y-2">
                {commitDetails.changedFiles.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('patch.noChangedFiles')}</div>
                ) : (
                  commitDetails.changedFiles.map((file) => (
                    <div key={`${file.path}-${file.status}`} className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium text-foreground">{file.path}</span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {file.status}
                        </span>
                      </div>
                      {file.oldPath && (
                        <div className="mt-1 truncate text-[10px] text-muted-foreground">
                          {t('patch.previousPath')}: {file.oldPath}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <InspectCard
            icon={<Clock3 size={14} />}
            title={t('patch.selectionSummary')}
            rows={[
              { label: t('patch.totalChanges'), value: `${stats.total}` },
              { label: t('patch.diffableFiles'), value: `${stats.diffable}` },
              { label: t('patch.binaryBlocked'), value: `${stats.binary}` },
              { label: t('patch.largeBlocked'), value: `${stats.large}` },
            ]}
          />
        )}

        {selectedFile && (
          <div className="rounded-xl border border-border bg-background/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Info size={14} />
              {t('patch.fileDetails')}
            </div>
            <div className="space-y-2 text-xs">
              <InspectRow label={t('patch.path')} value={selectedFile.path} />
              <InspectRow label={t('patch.statusLabel')} value={selectedFile.gitStatus} />
              {selectedFile.oldPath ? (
                <InspectRow label={t('patch.previousPath')} value={selectedFile.oldPath} />
              ) : null}
              <InspectRow label={t('patch.binaryFile')} value={selectedFile.isBinary ? t('common.yes') : t('common.no')} />
              <InspectRow label={t('patch.largeFile')} value={selectedFile.isLarge ? t('common.yes') : t('common.no')} />
            </div>
          </div>
        )}

        {repositorySummary && !commitDetails && (
          <div className="rounded-xl border border-dashed border-border bg-background/60 p-4 text-xs text-muted-foreground">
            {repositorySummary.lastCommitMessage || t('patch.repositoryReady')}
          </div>
        )}
      </div>
    </aside>
  );
}

function InspectCard({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <InspectRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  );
}

function InspectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-foreground">{value}</span>
    </div>
  );
}
