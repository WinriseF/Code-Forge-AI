import { useEffect, useState } from 'react';
import { Download, Trash2, RefreshCw, Box, Check, Loader2, Globe, Sparkles, Terminal, AlertCircle } from 'lucide-react';
import { usePromptStore } from '@/store/usePromptStore';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import { getText } from '@/lib/i18n';

export function PromptLibraryManager() {
  const { 
    manifest, fetchManifest, installPack, uninstallPack, 
    installedPackIds, isStoreLoading 
  } = usePromptStore();
  
  const { language } = useAppStore();
  const [activeTab, setActiveTab] = useState<'prompt' | 'command'>('prompt');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest();
  }, []);

  const handleInstall = async (pack: any) => {
      try {
          setErrorMsg(null); // 清除旧错误
          await installPack(pack);
      } catch (err: any) {
          // 显示错误信息
          const msg = err.message || "Unknown error";
          setErrorMsg(msg);
          
          // 5秒后自动消失，或者保留直到用户点击
          setTimeout(() => setErrorMsg(null), 8000);
      }
  };

  // 过滤：当前语言 + 当前 Tab 分类
  const availablePacks = manifest?.packages.filter(p => 
      p.language === language && 
      (p.category || 'command') === activeTab // 兼容旧数据，没 category 默认为 command
  ) || [];

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 flex items-center justify-between shrink-0">
         <div>
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Globe size={16} className="text-primary"/> 
                {getText('library', 'title', language)}
            </h3>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                <span>{getText('library', 'desc', language)}</span>
            </div>
         </div>
         
         <button 
           onClick={() => fetchManifest()} 
           disabled={isStoreLoading}
           className="p-2 hover:bg-secondary rounded-full transition-colors"
           title="Refresh"
         >
            <RefreshCw size={16} className={cn(isStoreLoading && "animate-spin")} />
         </button>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex gap-3 items-start animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={16} className="text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-destructive mb-0.5">Error</h4>
                <p className="text-xs text-destructive/80 break-all whitespace-pre-wrap">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-destructive/60 hover:text-destructive text-xs">✕</button>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4 border-b border-border/50">
          <button 
              onClick={() => setActiveTab('prompt')}
              className={cn(
                  "px-4 py-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-2",
                  activeTab === 'prompt' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
          >
              <Sparkles size={14} /> Prompts
          </button>
          <button 
              onClick={() => setActiveTab('command')}
              className={cn(
                  "px-4 py-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-2",
                  activeTab === 'command' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
          >
              <Terminal size={14} /> Commands
          </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
        {isStoreLoading && !manifest && (
            <div className="flex justify-center py-10 text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="animate-spin" />
                    <span className="text-xs">{getText('library', 'loading', language)}</span>
                </div>
            </div>
        )}
        
        {!isStoreLoading && availablePacks.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-xs">
                {getText('library', 'noPacks', language)}
            </div>
        )}

        {availablePacks.map(pack => {
            const isInstalled = installedPackIds.includes(pack.id);
            
            return (
                <div key={pack.id} className="border border-border rounded-lg p-3 bg-card flex items-center justify-between group hover:border-primary/30 transition-all">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", isInstalled ? "bg-green-500/10 text-green-500" : "bg-secondary text-muted-foreground")}>
                            {isInstalled ? <Check size={20} /> : <Box size={20} />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium truncate">{pack.name}</h4>
                            <p className="text-xs text-muted-foreground truncate" title={pack.description}>{pack.description}</p>
                            <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground/70">
                                <span>{pack.count} {getText('library', 'prompts', language)}</span>
                                <span>•</span>
                                <span>{pack.size_kb} KB</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {isInstalled ? (
                            <>
                                <button 
                                    onClick={() => handleInstall(pack)}
                                    disabled={isStoreLoading}
                                    className="px-3 py-1.5 text-xs font-medium bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                                >
                                    {getText('library', 'update', language)}
                                </button>
                                <button 
                                    onClick={() => uninstallPack(pack.id)}
                                    disabled={isStoreLoading}
                                    className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                                    title={getText('library', 'uninstall', language)}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </>
                        ) : (
                            <button 
                                onClick={() => handleInstall(pack)}
                                disabled={isStoreLoading}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors shadow-sm"
                            >
                                <Download size={14} />
                                {getText('library', 'download', language)}
                            </button>
                        )}
                    </div>
                </div>
            )
        })}
      </div>
    </div>
  );
}