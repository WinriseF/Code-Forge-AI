import { useMemo, useState, useEffect } from 'react';
import { useGitGraphStore, WORKING_TREE_HASH } from '@/store/useGitGraphStore';
import { buildPatchFileTree, flattenPatchTree, allDirIds } from '@/lib/patch_tree_utils';
import { PatchFileTreeNode } from './PatchFileTreeNode';
import { CompareModeBanner } from './CompareModeBanner';
import { FileDown, GitCompare, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DetailPanelProps {
  onExport: () => void;
  projectRoot?: string;
}

export function DetailPanel({ onExport, projectRoot }: DetailPanelProps) {
  const commits = useGitGraphStore((s) => s.commits);
  const selectedCommitHash = useGitGraphStore((s) => s.selectedCommitHash);
  const diffFiles = useGitGraphStore((s) => s.diffFiles);
  const selectedFilePath = useGitGraphStore((s) => s.selectedFilePath);
  const selectFile = useGitGraphStore((s) => s.selectFile);
  const selectCommit = useGitGraphStore((s) => s.selectCommit);
  const startCompare = useGitGraphStore((s) => s.startCompare);
  const cancelCompare = useGitGraphStore((s) => s.cancelCompare);
  const compareBaseHash = useGitGraphStore((s) => s.compareBaseHash);
  const isLoading = useGitGraphStore((s) => s.isLoading);

  const { t } = useTranslation();

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === selectedCommitHash),
    [commits, selectedCommitHash],
  );
  const compareBaseCommit = useMemo(
    () => commits.find((c) => c.hash === compareBaseHash),
    [commits, compareBaseHash],
  );

  // Build tree once, derive both auto-expand and display from it
  const fileTree = useMemo(() => {
    if (diffFiles.length === 0) return null;
    return buildPatchFileTree(diffFiles);
  }, [diffFiles]);

  // Auto-expand all dirs when tree changes
  useEffect(() => {
    if (!fileTree) return;
    setExpandedDirs(new Set(allDirIds(fileTree)));
  }, [fileTree]);

  // Flatten tree for rendering
  const displayedNodes = useMemo(() => {
    if (!fileTree) return [];
    return flattenPatchTree(fileTree, expandedDirs, 0);
  }, [fileTree, expandedDirs]);

  const toggleExpand = (id: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Empty state: nothing selected
  if (!selectedCommit && selectedCommitHash !== WORKING_TREE_HASH) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">{t('patch.clickToViewChanges', 'Click a commit to view changes')}</span>
      </div>
    );
  }

  const isWorkingTree = selectedCommitHash === WORKING_TREE_HASH;

  const fileCount = diffFiles.length;
  const compareBaseShortHash = compareBaseCommit?.short_hash ?? compareBaseHash?.slice(0, 7);
  const compareBannerTitle = compareBaseShortHash
    ? t('patch.compareBaseReady', { hash: compareBaseShortHash })
    : '';
  const compareBannerDescription = compareBaseCommit
    ? `${compareBaseCommit.message} - ${t('patch.comparePickTarget', 'Click another commit or the working tree to compare')}`
    : t('patch.comparePickTarget', 'Click another commit or the working tree to compare');
  const canCompareSelectedToBase = Boolean(
    projectRoot
    && selectedCommit
    && !isWorkingTree
    && compareBaseHash
    && compareBaseHash !== selectedCommit.hash,
  );
  const canSetSelectedAsBase = Boolean(selectedCommit && !isWorkingTree && compareBaseHash !== selectedCommit.hash);
  const isSelectedCompareBase = Boolean(selectedCommit && compareBaseHash === selectedCommit.hash);

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        {isWorkingTree ? (
          <>
            <h3 className="text-sm font-semibold leading-snug flex items-center gap-2 text-orange-400">
              <FolderOpen size={14} />
              {t('patch.workingTree', 'Working Tree')}
            </h3>
            <span className="text-[11px] text-muted-foreground mt-1 block">{t('patch.unstagedChanges', 'Unstaged changes')}</span>
          </>
        ) : selectedCommit ? (
          <>
            <h3 className="text-sm font-semibold leading-snug">{selectedCommit.message}</h3>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              <span>{selectedCommit.author}</span>
              <span>&middot;</span>
              <span>{selectedCommit.date}</span>
              <span>&middot;</span>
              <span className="font-mono text-green-500">{selectedCommit.short_hash}</span>
            </div>
            {selectedCommit.refs.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {selectedCommit.refs.map((ref, i) => (
                  <span
                    key={i}
                    className={`text-[9px] px-1.5 py-[2px] rounded-full font-semibold ${
                      ref.kind === 'Head'
                        ? 'bg-red-500/20 text-red-400'
                        : ref.kind === 'Branch'
                          ? 'bg-blue-500/20 text-blue-400'
                          : ref.kind === 'Tag'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {ref.kind === 'Head' ? 'HEAD' : ref.name}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {compareBaseHash && compareBannerTitle && (
        <div className="px-3 py-2 border-b border-border">
          <CompareModeBanner
            title={compareBannerTitle}
            description={compareBannerDescription}
            cancelLabel={t('patch.cancelCompare', 'Cancel compare')}
            onCancel={cancelCompare}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-secondary/20">
        <span className="text-[10px] text-muted-foreground mr-auto">
          {isLoading ? t('patch.loadingCommits', 'Loading...') : t('patch.filesChanged', '{{count}} file(s) changed').replace('{{count}}', String(fileCount))}
        </span>

        {canCompareSelectedToBase && selectedCommit && projectRoot && (
          <button
            onClick={() => void selectCommit(selectedCommit.hash, projectRoot)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors"
          >
            <GitCompare size={12} />
            {t('patch.compareToBase', 'Compare to base')}
          </button>
        )}

        {canSetSelectedAsBase && selectedCommit && (
          <button
            onClick={() => startCompare(selectedCommit.hash)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title={t('patch.setCompareBase', 'Set base')}
          >
            <GitCompare size={12} />
            {t('patch.setCompareBase', 'Set base')}
          </button>
        )}

        {isSelectedCompareBase && (
          <button
            type="button"
            disabled
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-yellow-500/10 text-yellow-500/80 cursor-default"
          >
            <GitCompare size={12} />
            {t('patch.currentCompareBase', 'Current base')}
          </button>
        )}

        <button
          onClick={onExport}
          disabled={diffFiles.length === 0}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export diff"
        >
          <FileDown size={12} />
          {t('patch.export', 'Export')}
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          displayedNodes.map(({ node, depth }) => (
            <PatchFileTreeNode
              key={node.id}
              node={node}
              depth={depth}
              isExpanded={expandedDirs.has(node.id)}
              isSelected={selectedFilePath === node.path}
              isChecked={false}
              isDisabled={false}
              showCheckbox={false}
              onSelectFile={() => {
                if (node.kind === 'file' && node.fileData) {
                  selectFile(node.fileData.path);
                }
              }}
              onToggleExpand={() => toggleExpand(node.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
