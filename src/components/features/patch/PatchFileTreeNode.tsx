import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileCode,
  FileImage,
  AlertOctagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PatchTreeNode } from '@/lib/patch_tree_utils';
import type { PatchFileItem } from './patch_types';

interface PatchFileTreeNodeProps {
  node: PatchTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isChecked: boolean;
  isDisabled: boolean;
  showCheckbox: boolean;
  onSelectFile: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleExport?: (id: string, checked: boolean) => void;
}

export function PatchFileTreeNode({
  node,
  depth,
  isExpanded,
  isSelected,
  isChecked,
  isDisabled,
  showCheckbox,
  onSelectFile,
  onToggleExpand,
  onToggleExport,
}: PatchFileTreeNodeProps) {
  const indent = depth * 16 + 12;
  const hasChildren = node.kind === 'dir' && node.children.length > 0;

  // ── Directory row ──────────────────────────────────────────────
  if (node.kind === 'dir') {
    return (
      <div
        className={cn(
          'flex items-center py-1 pr-2 cursor-pointer select-none transition-colors text-sm group w-full box-border',
          'hover:bg-secondary/50',
          !isSelected && 'opacity-60 hover:opacity-100',
        )}
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => onToggleExpand(node.id)}
        title={node.path}
      >
        <div className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground">
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : null}
        </div>

        <Folder
          size={14}
          className="mr-2 shrink-0 text-blue-400"
        />

        <span className="truncate flex-1 font-medium">
          {node.name}
        </span>

        {hasChildren && (
          <span className="text-[10px] text-muted-foreground/50 mr-1">
            {node.children.length}
          </span>
        )}
      </div>
    );
  }

  // ── File row ───────────────────────────────────────────────────
  const fileData = node.fileData as PatchFileItem | undefined;
  const gitStatus = fileData?.gitStatus;

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isDisabled && onToggleExport) {
      onToggleExport(node.id, !isChecked);
    }
  };

  return (
    <div
      className={cn(
        'flex items-start py-1 pr-2 cursor-pointer select-none transition-colors text-sm group w-full box-border',
        isSelected
          ? 'bg-secondary/50'
          : 'hover:bg-secondary/50',
        !isSelected && !isDisabled && 'opacity-60 hover:opacity-100',
        isDisabled && 'opacity-30 cursor-not-allowed',
      )}
      style={{ paddingLeft: `${indent}px` }}
      onClick={() => !isDisabled && onSelectFile(node.id)}
      title={node.path}
    >
      {/* Expand spacer (files don't have arrow) */}
      <div className="w-5 h-5 shrink-0 mt-0.5" />

      {/* Checkbox (diff mode export) */}
      {showCheckbox && (
        <div className="mr-2 flex items-center" onClick={handleCheckboxClick}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => {}} // handled by parent div click
            className="w-3.5 h-3.5 rounded border-slate-600 bg-transparent text-primary focus:ring-0 cursor-pointer accent-primary"
          />
        </div>
      )}

      {/* File icon */}
      {fileData?.isBinary ? (
        <FileImage size={14} className="mr-2 mt-0.5 shrink-0 text-orange-400" />
      ) : fileData?.isLarge ? (
        <AlertOctagon size={14} className="mr-2 mt-0.5 shrink-0 text-red-400" />
      ) : (
        <FileCode size={14} className="mr-2 mt-0.5 shrink-0 text-muted-foreground" />
      )}

      {/* File name */}
      <div className="min-w-0 flex-1">
        <span className={cn('block truncate', isSelected && 'font-medium')}>
          {node.name}
        </span>
        {fileData?.renameFrom && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {fileData.renameFrom}
          </span>
        )}
      </div>

      {typeof fileData?.additions === 'number' && typeof fileData?.deletions === 'number' && (
        <div className="mr-2 mt-0.5 flex items-center gap-1 shrink-0 text-[10px] font-mono">
          <span className="text-green-400">+{fileData.additions}</span>
          <span className="text-red-400">-{fileData.deletions}</span>
        </div>
      )}

      {/* Git status badge */}
      {gitStatus && (
        <span
          className={cn(
            'text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded shrink-0 mr-1 mt-0.5',
            gitStatus === 'Added' && 'bg-green-500/20 text-green-500',
            gitStatus === 'Modified' && 'bg-blue-500/20 text-blue-500',
            gitStatus === 'Deleted' && 'bg-red-500/20 text-red-600',
            gitStatus === 'Renamed' && 'bg-purple-500/20 text-purple-500',
          )}
        >
          {gitStatus.charAt(0)}
        </span>
      )}
    </div>
  );
}
