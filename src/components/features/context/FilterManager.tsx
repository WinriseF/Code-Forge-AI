import { useState } from 'react';
import { Lock, Plus, Trash2, Folder, File, FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IgnoreConfig } from '@/types/context';

type FilterType = keyof IgnoreConfig;

interface FilterManagerProps {
  localConfig: IgnoreConfig;
  globalConfig?: IgnoreConfig; // 全局配置（可选，如果有则开启锁定模式）
  onUpdate: (type: FilterType, action: 'add' | 'remove', value: string) => void;
}

export function FilterManager({ localConfig, globalConfig, onUpdate }: FilterManagerProps) {
  const [activeTab, setActiveTab] = useState<FilterType>('dirs');
  const [inputValue, setInputValue] = useState('');

  // 渲染列表项
  const renderList = () => {
    const localItems = localConfig[activeTab];
    const globalItems = globalConfig ? globalConfig[activeTab] : [];
    
    // 合并展示，去重
    const allItems = Array.from(new Set([...globalItems, ...localItems])).sort();

    return (
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 min-h-0 space-y-1">
        {allItems.map(item => {
          const isLocked = globalItems.includes(item);
          const isLocal = localItems.includes(item);
          
          return (
            <div key={item} className="flex items-center justify-between group py-1 px-2 rounded hover:bg-secondary/50 text-xs">
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox"
                  checked={true} // 只要在列表中就是选中（忽略）
                  disabled={isLocked} // 如果是全局的，禁止取消
                  onChange={() => {
                    // 如果在本地列表中，点击则移除；如果不在，点击则添加（虽然这里全是已存在的）
                    if (isLocal) onUpdate(activeTab, 'remove', item);
                  }}
                  className={cn(
                    "rounded border-slate-600 bg-transparent text-primary focus:ring-0",
                    isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  )}
                />
                <span className={cn(isLocked && "opacity-70")}>{item}</span>
              </div>
              
              {isLocked ? (
              <div title="Managed by Global Settings" className="cursor-not-allowed">
                  <Lock size={10} className="text-muted-foreground opacity-50" />
              </div>
              ) : (
              <button 
                  onClick={() => onUpdate(activeTab, 'remove', item)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
              >
                  <Trash2 size={12} />
              </button>
              )}
            </div>
          );
        })}
        {allItems.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 opacity-50">No filters active</div>
        )}
      </div>
    );
  };

  const handleAdd = () => {
    if (!inputValue.trim()) return;
    onUpdate(activeTab, 'add', inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-1 bg-secondary/20 p-1 rounded-lg mb-3 shrink-0">
        <TabButton active={activeTab === 'dirs'} onClick={() => setActiveTab('dirs')} icon={<Folder size={12} />} label="Folders" />
        <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={<File size={12} />} label="Files" />
        <TabButton active={activeTab === 'extensions'} onClick={() => setActiveTab('extensions')} icon={<FileCode size={12} />} label="Exts" />
      </div>

      {/* Input */}
      <div className="flex gap-2 mb-2 shrink-0">
        <input 
          className="flex-1 bg-secondary/30 border border-border/50 rounded px-2 py-1 text-xs outline-none focus:border-primary/50"
          placeholder={`Ignore ${activeTab === 'extensions' ? 'extension (e.g. pdf)' : 'name...'}`}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button 
          onClick={handleAdd}
          disabled={!inputValue.trim()}
          className="p-1 bg-primary/10 text-primary hover:bg-primary/20 rounded disabled:opacity-50"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* List */}
      {renderList()}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-1 text-[10px] font-medium rounded-md transition-all",
        active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:bg-background/50"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}