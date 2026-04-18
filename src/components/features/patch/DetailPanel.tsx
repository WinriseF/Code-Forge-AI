import { useMemo, useState, useEffect } from 'react';
import { useGitGraphStore, WORKING_TREE_HASH } from '@/store/useGitGraphStore';
import { buildPatchFileTree, flattenPatchTree, allDirIds } from '@/lib/patch_tree_utils';
import { PatchFileTreeNode } from './PatchFileTreeNode';
import { FileDown, FolderOpen, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DetailPanelProps {
  onExport: () => void;
}

export function DetailPanel({ onExport }: DetailPanelProps) {
  const commits = useGitGraphStore((s) => s.commits);
  const selectedCommitHash = useGitGraphStore((s) => s.selectedCommitHash);
  const diffFiles = useGitGraphStore((s) => s.diffFiles);
  const selectedFilePath = useGitGraphStore((s) => s.selectedFilePath);
  const selectFile = useGitGraphStore((s) => s.selectFile);
  const isCompareView = useGitGraphStore((s) => s.isCompareView);
  const compareTargetHash = useGitGraphStore((s) => s.compareTargetHash);
  const isLoading = useGitGraphStore((s) => s.isLoading);
  const selectedExportPaths = useGitGraphStore((s) => s.selectedExportPaths);
  const toggleExportPath = useGitGraphStore((s) => s.toggleExportPath);

  const { t } = useTranslation();

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === selectedCommitHash),
    [commits, selectedCommitHash],
  );
  const compareTargetCommit = useMemo(
    () => commits.find((c) => c.hash === compareTargetHash),
    [commits, compareTargetHash],
  );

  const fileTree = useMemo(() => {
    if (diffFiles.length === 0) return null;
    return buildPatchFileTree(diffFiles);
  }, [diffFiles]);

  useEffect(() => {
    if (!fileTree) return;
    setExpandedDirs(new Set(allDirIds(fileTree)));
  }, [fileTree]);

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

  const baseShortHash = isWorkingTree
    ? t('patch.workingTree', 'Working Tree')
    : selectedCommit?.short_hash ?? selectedCommitHash?.slice(0, 7);

  const targetShortHash = compareTargetCommit?.short_hash ?? compareTargetHash?.slice(0, 7);
  const targetIsWorkingTree = compareTargetHash === WORKING_TREE_HASH;

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        {isCompareView ? (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="font-mono text-green-500">{baseShortHash}</span>
              <ArrowRight size={14} className="text-muted-foreground shrink-0" />
              <span className={`font-mono ${targetIsWorkingTree ? 'text-orange-400' : 'text-green-500'}`}>
                {targetIsWorkingTree ? t('patch.workingTree', 'Working Tree') : targetShortHash}
              </span>
            </div>
            {compareTargetCommit && (
              <>
                <p className="text-xs text-muted-foreground mt-1 truncate">{compareTargetCommit.message}</p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                  <span>{compareTargetCommit.author}</span>
                  <span>&middot;</span>
                  <span>{compareTargetCommit.date}</span>
                </div>
              </>
            )}
            {targetIsWorkingTree && (
              <p className="text-[11px] text-orange-400 mt-1">
                {t('patch.unstagedChanges')}
              </p>
            )}
          </>
        ) : isWorkingTree ? (
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

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-secondary/20">
        <span className="text-[10px] text-muted-foreground mr-auto">
          {isLoading ? t('patch.loadingCommits', 'Loading...') : t('patch.filesChanged', '{{count}} file(s) changed').replace('{{count}}', String(fileCount))}
        </span>

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
          displayedNodes.map(({ node, depth }) => {
            const isDisabled = node.kind === 'file' && !!(node.fileData?.isBinary || node.fileData?.isLarge);
            return (
            <PatchFileTreeNode
              key={node.id}
              node={node}
              depth={depth}
              isExpanded={expandedDirs.has(node.id)}
              isSelected={selectedFilePath === node.path}
              isChecked={selectedExportPaths.has(node.path)}
              isDisabled={isDisabled}
              showCheckbox={node.kind === 'file'}
              onSelectFile={() => {
                if (node.kind === 'file' && node.fileData) {
                  selectFile(node.fileData.path);
                }
              }}
              onToggleExpand={() => toggleExpand(node.id)}
              onToggleExport={(path, checked) => toggleExportPath(path, checked)}
            />
            );
          })
        )}
      </div>
    </div>
  );
}
