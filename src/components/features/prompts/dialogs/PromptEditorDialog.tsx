import { useState, useEffect } from 'react';
import { X, Save, Tag, FileText, Folder, ChevronDown, Check, Plus, Sparkles, Terminal } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore } from '@/store/useAppStore'; 
import { Prompt, DEFAULT_GROUP, ShellType } from '@/types/prompt';
import { cn } from '@/lib/utils';
import { getText } from '@/lib/i18n';

interface PromptEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Prompt | null;
}

const SHELL_OPTIONS: { value: ShellType; label: string }[] = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'cmd', label: 'Command Prompt (cmd)' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'bash', label: 'Bash' },
  { value: 'zsh', label: 'Zsh' },
];

export function PromptEditorDialog({ isOpen, onClose, initialData }: PromptEditorDialogProps) {
  const { groups, addPrompt, updatePrompt, addGroup } = usePromptStore();
  const { language } = useAppStore();
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [group, setGroup] = useState(DEFAULT_GROUP);
  const [type, setType] = useState<'command' | 'prompt'>('prompt');
  const [isExecutable, setIsExecutable] = useState(false);
  const [shellType, setShellType] = useState<ShellType>('auto');
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isGroupOpen, setIsGroupOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title);
        setContent(initialData.content);
        setGroup(initialData.group);
        setType(initialData.type || 'prompt');
        // 只有当类型是 command 时，才可能恢复 isExecutable
        setIsExecutable(initialData.type === 'command' && (initialData.isExecutable || false));
        setShellType(initialData.shellType || 'auto');
      } else {
        setTitle('');
        setContent('');
        setGroup(DEFAULT_GROUP);
        setType('prompt');
        setIsExecutable(false);
        setShellType('auto');
      }
      setNewGroupMode(false);
      setNewGroupName('');
      setIsGroupOpen(false);
    }
  }, [isOpen, initialData]);
  
  // --- 当类型切换为 'prompt' 时，强制取消可执行状态 ---
  useEffect(() => {
    if (type === 'prompt') {
      setIsExecutable(false);
    }
  }, [type]);


  if (!isOpen) return null;

  const handleSave = () => {
    if (!title.trim() || !content.trim()) return;

    let finalGroup = group;
    if (newGroupMode && newGroupName.trim()) {
      addGroup(newGroupName.trim());
      finalGroup = newGroupName.trim();
    }

    const data = { 
        title, 
        content, 
        group: finalGroup,
        type: type,
        isExecutable: isExecutable,
        shellType: shellType,
    };

    if (initialData) {
      updatePrompt(initialData.id, data);
    } else {
      addPrompt(data);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200 p-4">
      <div className="w-full max-w-[600px] bg-background border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            {initialData ? getText('editor', 'titleEdit', language) : getText('editor', 'titleNew', language)}
          </h2>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1 pb-24 custom-scrollbar">
          
          {/* 类型选择器 */}
          <div className="flex gap-2 p-1 bg-secondary/30 rounded-lg border border-border/50">
             <button
                onClick={() => setType('prompt')}
                className={cn( "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all duration-200", type === 'prompt' ? "bg-background text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground" )}
             >
                <Sparkles size={16} />
                <span>Prompt</span>
             </button>
             <button
                onClick={() => setType('command')}
                className={cn( "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all duration-200", type === 'command' ? "bg-background text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground" )}
             >
                <Terminal size={16} />
                <span>Command</span>
             </button>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"> <Tag size={14} /> {getText('editor', 'labelTitle', language)} </label>
            <input  autoFocus className="w-full bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all placeholder:text-muted-foreground/40" placeholder={getText('editor', 'placeholderTitle', language)} value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          {/* Group */}
          <div className="space-y-2 relative">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"> <Folder size={14} /> {getText('editor', 'labelGroup', language)} </label>
            {!newGroupMode ? ( <div className="flex gap-2"> <div className="relative flex-1"> <button type="button" onClick={() => setIsGroupOpen(!isGroupOpen)} className={cn( "w-full flex items-center justify-between bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm text-left outline-none transition-all", isGroupOpen ? "ring-2 ring-primary/50 border-primary/50" : "hover:border-primary/30" )} > <span className="truncate">{group}</span> <ChevronDown size={16} className={cn("text-muted-foreground transition-transform duration-200", isGroupOpen && "rotate-180")} /> </button> {isGroupOpen && ( <> <div className="fixed inset-0 z-10" onClick={() => setIsGroupOpen(false)} /> <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-lg shadow-xl z-20 max-h-60 overflow-y-auto py-1 animate-in fade-in zoom-in-95 duration-100"> {groups.map(g => ( <button key={g} type="button" onClick={() => { setGroup(g); setIsGroupOpen(false); }} className={cn("w-full flex items-center justify-between px-3 py-2 text-sm transition-colors", group === g ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-secondary/50")} > <span>{g}</span> {group === g && <Check size={14} />} </button> ))} </div> </> )} </div> <button onClick={() => setNewGroupMode(true)} className="px-3 flex items-center gap-1 text-xs font-medium border border-border rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"> <Plus size={14} /> {getText('editor', 'btnNewGroup', language)} </button> </div> ) : ( <div className="flex gap-2 animate-in fade-in duration-200"> <input className="flex-1 bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 outline-none" placeholder={getText('editor', 'placeholderGroup', language)} autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} /> <button onClick={() => setNewGroupMode(false)} className="px-4 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg border border-transparent hover:border-border transition-all"> {getText('editor', 'btnCancel', language)} </button> </div> )}
          </div>
          
          {/* --- 只在 Command 类型下显示可执行选项 --- */}
          {type === 'command' && (
            <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                  <label htmlFor="executable-toggle" className="flex items-center gap-2 cursor-pointer">
                      <Terminal size={14} className="text-muted-foreground" />
                      <div className="flex flex-col">
                          <span className="font-medium text-sm text-foreground">Executable Command</span>
                          <span className="text-xs text-muted-foreground">Run this in the system terminal instead of copying.</span>
                      </div>
                  </label>
                  <div onClick={() => setIsExecutable(!isExecutable)} id="executable-toggle" className={cn( "w-10 h-5 rounded-full relative transition-colors duration-300 cursor-pointer", isExecutable ? "bg-primary" : "bg-slate-300 dark:bg-slate-600" )}>
                      <div className={cn( "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 shadow", isExecutable ? "translate-x-5" : "translate-x-0.5" )} />
                  </div>
              </div>
              
              {isExecutable && (
                  <div className="space-y-2 pl-6 animate-in fade-in slide-in-from-top-2 duration-300">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider"> Execution Shell </label>
                      <div className="relative">
                          <select value={shellType} onChange={(e) => setShellType(e.target.value as ShellType)} className="w-full appearance-none bg-secondary/20 border border-border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none transition-all" >
                              {SHELL_OPTIONS.map(opt => ( <option key={opt.value} value={opt.value}>{opt.label}</option> ))}
                          </select>
                          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                      <p className="text-[10px] text-muted-foreground/70"> 'Auto' is recommended. Choose a specific shell if your command requires it (e.g., PowerShell syntax). </p>
                  </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className="space-y-2 pt-4 border-t border-border/50">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"> <FileText size={14} /> {getText('editor', 'labelContent', language)} </label>
            <div className="relative">
              <textarea className="w-full h-48 bg-secondary/20 border border-border rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-primary/50 focus:border-primary/50 outline-none resize-none leading-relaxed placeholder:text-muted-foreground/40" placeholder={type === 'command' && isExecutable ? "e.g. cd {{path}} && npm install" : "Enter command or prompt. Use {{variable}} for slots."} value={content} onChange={e => setContent(e.target.value)} />
              <div className="absolute bottom-3 right-3 text-xs text-muted-foreground/60 bg-background/50 px-2 py-1 rounded border border-border/50 backdrop-blur-sm">
                {type === 'command' && isExecutable ? "Use '&&' to chain commands" : "Tip: Use {{variable}} to create fillable slots"}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border bg-secondary/5 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-secondary text-muted-foreground transition-colors"> {getText('editor', 'btnCancel', language)} </button>
          <button onClick={handleSave} disabled={!title || !content} className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-primary/20" > <Save size={16} /> {getText('editor', 'btnSave', language)} </button>
        </div>
      </div>
    </div>
  );
}