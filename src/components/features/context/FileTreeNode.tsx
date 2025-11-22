import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FileCode, Lock } from 'lucide-react'; // 引入 Lock
import { FileNode } from '@/types/context';
import { cn } from '@/lib/utils';

interface FileTreeNodeProps {
  node: FileNode;
  level?: number;
  onToggleSelect: (id: string, checked: boolean) => void;
}

export function FileTreeNode({ node, level = 0, onToggleSelect }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const indent = level * 16 + 12;

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.kind === 'dir') {
      setIsExpanded(!isExpanded);
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (node.isLocked) return; // ✨ 锁定时禁止改变
    onToggleSelect(node.id, e.target.checked);
  };

  const Icon = node.kind === 'dir' ? (isExpanded ? ChevronDown : ChevronRight) : null;
  const TypeIcon = node.kind === 'dir' ? Folder : FileCode;

  return (
    <div>
      <div 
        className={cn(
          "flex items-center py-1 pr-2 cursor-pointer select-none transition-colors text-sm group",
          node.isLocked 
            ? "opacity-40 cursor-not-allowed bg-secondary/20" // ✨ 锁定样式：变淡，不可点
            : "hover:bg-secondary/50",
          !node.isSelected && !node.isLocked && "opacity-60 hover:opacity-100"
        )}
        style={{ paddingLeft: `${indent}px` }}
        onClick={handleExpandClick}
        title={node.isLocked ? "Ignored by filter settings" : node.path} // ✨ 提示
      >
        <div className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground">
          {Icon && <Icon size={14} />}
        </div>

        <div className="mr-2 flex items-center" onClick={e => e.stopPropagation()}>
          {node.isLocked ? (
             // ✨ 如果锁定，显示一个小锁或者禁用的 Checkbox
             <Lock size={12} className="text-muted-foreground" />
          ) : (
             <input 
               type="checkbox" 
               checked={node.isSelected}
               onChange={handleCheckboxChange}
               className="w-3.5 h-3.5 rounded border-slate-600 bg-transparent text-primary focus:ring-0 cursor-pointer accent-primary"
             />
          )}
        </div>

        <TypeIcon 
          size={14} 
          className={cn(
            "mr-2 shrink-0", 
            node.kind === 'dir' ? "text-blue-400" : "text-muted-foreground"
          )} 
        />

        <span className={cn("truncate", node.kind === 'dir' && "font-medium", node.isLocked && "line-through decoration-slate-600")}>
          {node.name}
        </span>
      </div>

      {isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode 
              key={child.id} 
              node={child} 
              level={level + 1} 
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}