import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileCode,
  FileImage,
  AlertOctagon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PatchTreeNode } from '@/lib/patch_tree_utils';
import type { PatchFileItem } from './patch_types';

const PATCH_EXPORT_SIZE_LIMIT_LABEL = '2 MB';

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
  onDirectoryContextMenu?: (node: PatchTreeNode, event: React.MouseEvent<HTMLDivElement>) => void;
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
  onDirectoryContextMenu,
}: PatchFileTreeNodeProps) {
  const { t } = useTranslation();
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
        onContextMenu={(event) => onDirectoryContextMenu?.(node, event)}
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
  const disabledReason = fileData?.isBinary
    ? t('patch.binaryFileExportDisabled', 'Binary files cannot be exported')
    : fileData?.isLarge
      ? t('patch.largeFileExportDisabled', {
          size: PATCH_EXPORT_SIZE_LIMIT_LABEL,
          defaultValue: 'Files larger than {{size}} cannot be exported',
        })
      : undefined;
  const disabledLabel = fileData?.isBinary
    ? t('patch.binaryFileExportDisabledShort', 'Binary')
    : fileData?.isLarge
      ? t('patch.largeFileExportDisabledShort', 'Too large')
      : undefined;

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
      title={disabledReason ? `${node.path}\n${disabledReason}` : node.path}
    >
      {/* Expand spacer (files don't have arrow) */}
      <div className="w-5 h-5 shrink-0" />

      {/* Checkbox (diff mode export) */}
      {showCheckbox && (
        <div
          className="mr-2 flex h-5 w-4 shrink-0 items-center justify-center"
          data-testid="patch-file-checkbox-slot"
          onClick={handleCheckboxClick}
        >
          <input
            type="checkbox"
            checked={isChecked}
            disabled={isDisabled}
            title={disabledReason}
            aria-label={disabledReason ?? node.path}
            onChange={() => {}} // handled by parent div click
            className="block h-3.5 w-3.5 rounded border-slate-600 bg-transparent text-primary accent-primary focus:ring-0 disabled:cursor-not-allowed"
          />
        </div>
      )}

      {/* File icon */}
      <div
        className="mr-2 flex h-5 w-4 shrink-0 items-center justify-center"
        data-testid="patch-file-icon-slot"
        title={disabledReason}
      >
        {fileData?.isBinary ? (
          <FileImage size={14} className="shrink-0 text-orange-400" />
        ) : fileData?.isLarge ? (
          <AlertOctagon size={14} className="shrink-0 text-red-400" />
        ) : (
          <FileCode size={14} className="shrink-0 text-muted-foreground" />
        )}
      </div>

      {/* File name */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('min-w-0 truncate', isSelected && 'font-medium')}>
            {node.name}
          </span>
          {disabledReason && disabledLabel && (
            <span
              className="inline-flex h-4 shrink-0 items-center rounded border border-border/70 bg-secondary/50 px-1.5 text-[10px] leading-none text-muted-foreground"
              title={disabledReason}
            >
              {disabledLabel}
            </span>
          )}
        </div>
        {fileData?.renameFrom && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {fileData.renameFrom}
          </span>
        )}
      </div>

      {typeof fileData?.additions === 'number' && typeof fileData?.deletions === 'number' && (
        <div className="mr-2 flex h-5 shrink-0 items-center gap-1 text-[10px] font-mono">
          <span className="text-green-400">+{fileData.additions}</span>
          <span className="text-red-400">-{fileData.deletions}</span>
        </div>
      )}

      {/* Git status badge */}
      {gitStatus && (
        <span
          className={cn(
            'mr-1 flex h-5 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold',
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
