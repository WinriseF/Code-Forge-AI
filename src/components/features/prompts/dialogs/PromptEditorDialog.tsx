import { useState, useEffect } from 'react';
import { X, Save, Tag, FileText, Folder, ChevronDown, Check, Plus } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { Prompt, DEFAULT_GROUP } from '@/types/prompt';
import { cn } from '@/lib/utils';

interface PromptEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Prompt | null;
}

export function PromptEditorDialog({ isOpen, onClose, initialData }: PromptEditorDialogProps) {
  const { groups, addPrompt, updatePrompt, addGroup } = usePromptStore();
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [group, setGroup] = useState(DEFAULT_GROUP);
  
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  const [isGroupOpen, setIsGroupOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title);
        setContent(initialData.content);
        setGroup(initialData.group);
      } else {
        setTitle('');
        setContent('');
        setGroup(DEFAULT_GROUP);
      }
      setNewGroupMode(false);
      setNewGroupName('');
      setIsGroupOpen(false);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!title.trim() || !content.trim()) return;

    let finalGroup = group;
    if (newGroupMode && newGroupName.trim()) {
      addGroup(newGroupName.trim());
      finalGroup = newGroupName.trim();
    }

    if (initialData) {
      updatePrompt(initialData.id, { title, content, group: finalGroup });
    } else {
      addPrompt({ title, content, group: finalGroup });
    }
    onClose();
  };

  return (
    // 遮罩：增加 p-4 防止在极小屏幕贴边
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200 p-4">
      
      {/* 弹窗主体 */}
      {/* 修复：max-h-[85vh] 限制最大高度，flex-col 启用弹性布局 */}
      <div className="w-full max-w-[600px] bg-background border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        
        {/* Header: shrink-0 防止被压缩 */}
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            {initialData ? '编辑指令' : '新建指令'}
          </h2>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body: flex-1 overflow-y-auto 关键！让内容区在剩余空间内滚动 */}
        {/* pb-24 是为了给下拉菜单留出滚动空间，防止被遮挡 */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 pb-24 custom-scrollbar">
          
          {/* Title Input */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag size={14} /> 标题
            </label>
            <input 
              autoFocus
              className="w-full bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-muted-foreground/40"
              placeholder="例如：Git 撤销 Commit"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* Group Select */}
          <div className="space-y-2 relative">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Folder size={14} /> 分类
            </label>
            
            {!newGroupMode ? (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <button 
                    type="button"
                    onClick={() => setIsGroupOpen(!isGroupOpen)}
                    className={cn(
                      "w-full flex items-center justify-between bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm text-left outline-none transition-all",
                      isGroupOpen ? "ring-2 ring-primary/50 border-primary/50" : "hover:border-primary/30"
                    )}
                  >
                    <span className="truncate">{group}</span>
                    <ChevronDown size={16} className={cn("text-muted-foreground transition-transform duration-200", isGroupOpen && "rotate-180")} />
                  </button>

                  {isGroupOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsGroupOpen(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-lg shadow-xl z-20 max-h-60 overflow-y-auto py-1 animate-in fade-in zoom-in-95 duration-100">
                        {groups.map(g => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => {
                              setGroup(g);
                              setIsGroupOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2 text-sm transition-colors",
                              group === g 
                                ? "bg-primary/10 text-primary font-medium" 
                                : "text-foreground hover:bg-secondary/50"
                            )}
                          >
                            <span>{g}</span>
                            {group === g && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <button 
                  onClick={() => setNewGroupMode(true)}
                  className="px-3 flex items-center gap-1 text-xs font-medium border border-border rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  <Plus size={14} /> 新建
                </button>
              </div>
            ) : (
              <div className="flex gap-2 animate-in fade-in duration-200">
                <input 
                  className="flex-1 bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 outline-none"
                  placeholder="输入新分类名称..."
                  autoFocus
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                />
                <button 
                  onClick={() => setNewGroupMode(false)}
                  className="px-4 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg border border-transparent hover:border-border transition-all"
                >
                  取消
                </button>
              </div>
            )}
          </div>

          {/* Content Textarea */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={14} /> 内容模板
            </label>
            <div className="relative">
              <textarea 
                className="w-full h-48 bg-secondary/20 border border-border rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none resize-none leading-relaxed placeholder:text-muted-foreground/40"
                placeholder="输入命令或 Prompt。支持变量：{{name}}"
                value={content}
                onChange={e => setContent(e.target.value)}
              />
              <div className="absolute bottom-3 right-3 text-xs text-muted-foreground/60 bg-background/50 px-2 py-1 rounded border border-border/50 backdrop-blur-sm">
                Tip: 使用 {"{{变量名}}"} 创建填空位
              </div>
            </div>
          </div>

        </div>

        {/* Footer: shrink-0 防止被压缩 */}
        <div className="p-4 border-t border-border bg-secondary/5 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-secondary text-muted-foreground transition-colors">
            取消
          </button>
          <button 
            onClick={handleSave}
            disabled={!title || !content}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-primary/20"
          >
            <Save size={16} />
            保存指令
          </button>
        </div>

      </div>
    </div>
  );
}