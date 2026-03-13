import { GitMerge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CommitSelector } from './CommitSelector';
import type { GitBranchRef, GitCommit } from '@/types/git';

interface CompareControlsProps {
  selectedBranch: GitBranchRef | null;
  commits: GitCommit[];
  baseHash: string;
  compareHash: string;
  isGitLoading: boolean;
  onSetBaseHash: (hash: string) => void;
  onSetCompareHash: (hash: string) => void;
  onCompare: () => void;
}

const WORK_DIR_OPTION: GitCommit = {
  hash: '__WORK_DIR__',
  author: 'CtxRun',
  date: 'Now',
  message: 'Working Tree',
  parentHashes: [],
  refs: [],
  filesChanged: 0,
  additions: 0,
  deletions: 0,
};

export function CompareControls({
  selectedBranch,
  commits,
  baseHash,
  compareHash,
  isGitLoading,
  onSetBaseHash,
  onSetCompareHash,
  onCompare,
}: CompareControlsProps) {
  const { t } = useTranslation();
  const compareCommits = [WORK_DIR_OPTION, ...commits];

  return (
    <section className="rounded-[20px] border border-border/70 bg-background/90 px-4 py-3 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.7)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t('patch.compareTitle')}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {selectedBranch ? selectedBranch.shortName : t('patch.compareFallbackTitle')}
          </div>
        </div>

        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t('patch.baseVersion')}
          </label>
          <CommitSelector commits={commits} selectedValue={baseHash} onSelect={onSetBaseHash} disabled={isGitLoading} />
        </div>

        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t('patch.compareVersion')}
          </label>
          <CommitSelector
            commits={compareCommits}
            selectedValue={compareHash}
            onSelect={onSetCompareHash}
            disabled={isGitLoading}
          />
        </div>

        <button
          type="button"
          onClick={onCompare}
          disabled={isGitLoading || !baseHash || !compareHash}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <GitMerge size={15} />
          {isGitLoading ? t('patch.comparing') : t('patch.generateDiff')}
        </button>
      </div>
    </section>
  );
}
