import { useMemo } from 'react';
import { 
  CheckCircle2, AlertCircle, FileText, Database, Cpu, Save, 
  DollarSign, PieChart, TrendingUp, AlertTriangle, Eraser} from 'lucide-react';
import { ContextStats } from '@/lib/context_assembler';
import { analyzeContext } from '@/lib/context_analytics';
import { FileNode } from '@/types/context';
import { AIModelConfig } from '@/types/model';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';
import { useContextStore } from '@/store/useContextStore';
import { getText } from '@/lib/i18n';

interface TokenDashboardProps {
  stats: ContextStats;
  fileTree: FileNode[];
  models: AIModelConfig[];
  onCopy: () => void;
  onSave: () => void;
  isGenerating: boolean;
}

export function TokenDashboard({ 
  stats, 
  fileTree, 
  models,
  onCopy, 
  onSave, 
  isGenerating 
}: TokenDashboardProps) {
  const { language } = useAppStore();
  // 获取状态和修改器
  const { removeComments, setRemoveComments } = useContextStore();

  const analytics = useMemo(() => {
    return analyzeContext(fileTree, stats.estimatedTokens, models);
  }, [fileTree, stats.estimatedTokens, models]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatCost = (val: number) => {
    if (val < 0.0001 && val > 0) return '< $0.0001';
    return `$${val.toFixed(4)}`; 
  };

  return (
    <div className="flex flex-col min-h-full max-w-6xl w-full mx-auto p-4 md:p-6 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* 1. 核心统计 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={<FileText className="text-blue-500" />} label={getText('context', 'statSelected', language)} value={stats.fileCount} />
        <StatCard icon={<Database className="text-purple-500" />} label={getText('context', 'statSize', language)} value={formatSize(stats.totalSize)} />
        <StatCard icon={<Cpu className="text-orange-500" />} label={getText('context', 'statTokens', language)} value={stats.estimatedTokens.toLocaleString()} highlight />
      </div>

      {/* 功能开关区 */}
      <div className="flex items-center justify-end px-2">
         <button 
           onClick={() => setRemoveComments(!removeComments)}
           className={cn(
             "flex items-center gap-3 px-4 py-2 rounded-lg border transition-all duration-200 shadow-sm",
             removeComments 
               ? "bg-primary/10 border-primary/30 text-primary" 
               : "bg-card border-border text-muted-foreground hover:bg-secondary/50"
           )}
         >
            <div className={cn(
                "w-8 h-4 rounded-full relative transition-colors duration-300",
                removeComments ? "bg-primary" : "bg-slate-300 dark:bg-slate-600"
            )}>
                <div className={cn(
                    "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-300 shadow-sm",
                    removeComments ? "left-4.5 translate-x-0" : "left-0.5"
                )} style={{ left: removeComments ? '18px' : '2px' }} />
            </div>
            <div className="flex items-center gap-2">
                <Eraser size={16} />
                <span className="text-sm font-medium">{getText('context', 'removeComments', language)}</span>
            </div>
         </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 2. 左栏：语言 & 成本 */}
        <div className="space-y-6">
           {/* 语言分布 */}
           <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                 <h3 className="text-sm font-semibold flex items-center gap-2"><PieChart size={16} /> {getText('context', 'langBreakdown', language)}</h3>
                 <span className="text-xs text-muted-foreground">{getText('context', 'bySize', language)}</span>
              </div>
              <div className="h-3 w-full flex rounded-full overflow-hidden bg-secondary">
                 {analytics.languages.map((lang) => (
                    <div key={lang.name} className={cn("h-full", lang.color)} style={{ width: `${lang.percentage}%` }} title={`${lang.name}: ${lang.percentage.toFixed(1)}%`} />
                 ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                 {analytics.languages.map(lang => (
                   <div key={lang.name} className="flex items-center gap-1.5 text-xs">
                      <div className={cn("w-2 h-2 rounded-full", lang.color)} />
                      <span className="text-muted-foreground">{lang.name}</span>
                      <span className="font-mono opacity-50">{Math.round(lang.percentage)}%</span>
                   </div>
                 ))}
              </div>
           </div>

           {/* 动态成本估算 */}
           <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                 <h3 className="text-sm font-semibold flex items-center gap-2"><DollarSign size={16} /> {getText('context', 'estCost', language)}</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                 {analytics.modelCosts.map(model => (
                    <div key={model.modelId} className="p-3 bg-secondary/30 rounded-lg flex flex-col gap-1 overflow-hidden">
                        <span className="text-xs text-muted-foreground truncate" title={model.modelName}>{model.modelName}</span>
                        <span className="text-lg font-bold text-foreground">{formatCost(model.cost)}</span>
                    </div>
                 ))}
              </div>
              <p className="text-[10px] text-muted-foreground opacity-60">{getText('context', 'costNote', language)}</p>
           </div>
        </div>

        {/* 3. 右栏：进度条 & Top Files */}
        <div className="space-y-6">
           {/* 动态上下文窗口 */}
           <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
               <h3 className="text-sm font-semibold flex items-center gap-2"><TrendingUp size={16} /> {getText('context', 'contextUsage', language)}</h3>
               <div className="space-y-3">
                {analytics.modelCosts.map(model => {
                    const percent = Math.min(100, (stats.estimatedTokens / model.limit) * 100);
                    const isOver = stats.estimatedTokens > model.limit;
                    return (
                        <div key={model.modelId} className="space-y-1.5">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{model.modelName}</span>
                                <span className={cn(isOver ? "text-destructive font-bold" : "")}>
                                    {percent.toFixed(1)}% <span className="opacity-50 text-[10px] ml-1">({(model.limit/1000).toFixed(0)}k)</span>
                                </span>
                            </div>
                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full transition-all duration-500", isOver ? "bg-destructive" : "bg-primary")} style={{ width: `${percent}%` }} />
                            </div>
                        </div>
                    )
                })}
               </div>
           </div>

           {/* Top Files */}
           <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between mb-2">
                 <h3 className="text-sm font-semibold flex items-center gap-2"><AlertTriangle size={16} /> {getText('context', 'topFiles', language)}</h3>
                 <span className="text-xs text-muted-foreground">{getText('context', 'largestFiles', language)}</span>
              </div>
              <div className="space-y-2">
                 {analytics.topFiles.length === 0 && <span className="text-xs text-muted-foreground">No files selected</span>}
                 {analytics.topFiles.map((f, i) => (
                   <div key={f.id} className="flex items-center justify-between text-xs group">
                      <div className="flex items-center gap-2 truncate max-w-[70%]">
                         <span className="font-mono text-muted-foreground w-4">{i+1}.</span>
                         <span className="truncate text-foreground group-hover:text-primary transition-colors" title={f.path}>{f.name}</span>
                      </div>
                      <span className="font-mono text-muted-foreground">{formatSize(f.size || 0)}</span>
                   </div>
                 ))}
              </div>
           </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="flex flex-col items-center gap-4 mt-auto">
         {stats.fileCount === 0 ? (
           <div className="text-muted-foreground flex items-center gap-2 bg-secondary/50 px-4 py-2 rounded-full text-sm">
             <AlertCircle size={16} /> {getText('context', 'tipSelect', language)}
           </div>
         ) : (
           <div className="flex flex-wrap items-center gap-3 w-full justify-center">
             <button onClick={onCopy} disabled={isGenerating} className={cn("group relative inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-primary-foreground transition-all duration-200 bg-primary rounded-full shadow-lg shadow-primary/25 hover:bg-primary/90 hover:scale-105 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed disabled:scale-100 min-w-[200px] whitespace-nowrap", isGenerating && "cursor-wait")}>
               {isGenerating ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>{getText('context', 'processing', language)}</span></>) : (<><CheckCircle2 size={20} /><span>{getText('context', 'btnCopy', language)}</span></>)}
             </button>
             <button onClick={onSave} disabled={isGenerating} className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-medium text-foreground bg-secondary/80 border border-border rounded-full hover:bg-secondary hover:border-primary/30 transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap">
               <Save size={20} /><span>{getText('context', 'btnSave', language)}</span>
             </button>
           </div>
         )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, highlight, className }: any) {
    return (
      <div className={cn("bg-card border border-border rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2 shadow-sm transition-all hover:shadow-md hover:border-primary/20", highlight && "bg-primary/5 border-primary/20 ring-1 ring-primary/10", className)}>
        <div className="p-2 bg-background rounded-full shadow-sm border border-border/50">{icon}</div>
        <div className="space-y-0.5 w-full">
          <div className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate w-full px-2" title={String(value)}>{value}</div>
          <div className="text-xs font-medium text-muted-foreground uppercase truncate">{label}</div>
        </div>
      </div>
    );
}