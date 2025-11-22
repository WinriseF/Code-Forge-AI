import { useMemo } from 'react';
import { 
  CheckCircle2, AlertCircle, FileText, Database, Cpu, Save, 
  DollarSign, PieChart, TrendingUp, AlertTriangle 
} from 'lucide-react';
import { ContextStats } from '@/lib/context_assembler';
import { analyzeContext } from '@/lib/context_analytics';
import { FileNode } from '@/types/context';
import { AIModelConfig } from '@/types/model';
import { cn } from '@/lib/utils';

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
    return `$${val.toFixed(4)}`; // 高精度，适应 DeepSeek 等便宜模型
  };

  return (
    <div className="flex flex-col min-h-full max-w-6xl w-full mx-auto p-4 md:p-6 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* 1. 核心统计 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={<FileText className="text-blue-500" />} label="Selected Files" value={stats.fileCount} />
        <StatCard icon={<Database className="text-purple-500" />} label="Total Size" value={formatSize(stats.totalSize)} />
        <StatCard icon={<Cpu className="text-orange-500" />} label="Est. Tokens" value={stats.estimatedTokens.toLocaleString()} highlight />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* 2. 左栏：语言 & 成本 */}
        <div className="space-y-6">
           {/* 语言分布 */}
           <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                 <h3 className="text-sm font-semibold flex items-center gap-2"><PieChart size={16} /> Language Breakdown</h3>
                 <span className="text-xs text-muted-foreground">By Size</span>
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
                 <h3 className="text-sm font-semibold flex items-center gap-2"><DollarSign size={16} /> Est. API Cost (Input)</h3>
              </div>
              {/* 这里的 Grid 会根据卡片数量自动换行 */}
              <div className="grid grid-cols-2 gap-3">
                 {analytics.modelCosts.map(model => (
                    <div key={model.modelId} className="p-3 bg-secondary/30 rounded-lg flex flex-col gap-1 overflow-hidden">
                        <span className="text-xs text-muted-foreground truncate" title={model.modelName}>{model.modelName}</span>
                        <span className="text-lg font-bold text-foreground">{formatCost(model.cost)}</span>
                    </div>
                 ))}
              </div>
              <p className="text-[10px] text-muted-foreground opacity-60">Calculated based on current token count and synced pricing.</p>
           </div>
        </div>

        {/* 3. 右栏：进度条 & Top Files */}
        <div className="space-y-6">
           {/* 动态上下文窗口 */}
           <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
               <h3 className="text-sm font-semibold flex items-center gap-2"><TrendingUp size={16} /> Context Usage</h3>
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
                 <h3 className="text-sm font-semibold flex items-center gap-2"><AlertTriangle size={16} /> Top Token Hogs</h3>
                 <span className="text-xs text-muted-foreground">Largest Files</span>
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
             <AlertCircle size={16} /> Select files from the left tree
           </div>
         ) : (
           <div className="flex flex-wrap items-center gap-3 w-full justify-center">
             <button onClick={onCopy} disabled={isGenerating} className={cn("group relative inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-primary-foreground transition-all duration-200 bg-primary rounded-full shadow-lg shadow-primary/25 hover:bg-primary/90 hover:scale-105 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed disabled:scale-100 min-w-[200px] whitespace-nowrap", isGenerating && "cursor-wait")}>
               {isGenerating ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Processing...</span></>) : (<><CheckCircle2 size={20} /><span>Copy to Clipboard</span></>)}
             </button>
             <button onClick={onSave} disabled={isGenerating} className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-medium text-foreground bg-secondary/80 border border-border rounded-full hover:bg-secondary hover:border-primary/30 transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap">
               <Save size={20} /><span>Save...</span>
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