import { X, Monitor, Moon, Sun, Languages, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getText } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function SettingsModal() {
  const { 
    isSettingsOpen, setSettingsOpen, 
    theme, setTheme, 
    language, setLanguage 
  } = useAppStore();

  if (!isSettingsOpen) return null;

  return (
    // 背景遮罩 (Backdrop)
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
      
      {/* 弹窗主体 */}
      <div className="w-[500px] bg-background border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* 标题栏 */}
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-secondary/10">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <SettingsIcon />
            {getText('settings', 'title', language)}
          </h2>
          <button 
            onClick={() => setSettingsOpen(false)}
            className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-6 space-y-8 overflow-y-auto">
          
          {/* 1. 外观设置 */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Monitor size={14} />
              {getText('settings', 'appearance', language)}
            </h3>
            
            <div className="grid grid-cols-2 gap-3">
              {/* 深色卡片 */}
              <ThemeCard 
                active={theme === 'dark'} 
                onClick={() => setTheme('dark')}
                icon={<Moon size={24} />}
                label={getText('settings', 'themeDark', language)}
              />
              {/* 亮色卡片 */}
              <ThemeCard 
                active={theme === 'light'} 
                onClick={() => setTheme('light')}
                icon={<Sun size={24} />}
                label={getText('settings', 'themeLight', language)}
              />
            </div>
          </section>

          {/* 2. 语言设置 */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Languages size={14} />
              {getText('settings', 'language', language)}
            </h3>
            
            <div className="space-y-2">
              <LangItem 
                active={language === 'zh'} 
                onClick={() => setLanguage('zh')} 
                label={getText('settings', 'langZh', language)} 
                subLabel="Chinese Simplified"
              />
              <LangItem 
                active={language === 'en'} 
                onClick={() => setLanguage('en')} 
                label={getText('settings', 'langEn', language)} 
                subLabel="English"
              />
            </div>
          </section>

        </div>
        
        {/* 底部栏 (可选) */}
        <div className="p-4 border-t border-border bg-secondary/5 text-center text-xs text-muted-foreground">
          CodeForge AI v3.0.0 • Built with Tauri v1 & React
        </div>

      </div>
    </div>
  );
}

// --- 子组件：主题选择卡片 ---
function ThemeCard({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 p-4 rounded-lg border-2 transition-all duration-200",
        active 
          ? "border-primary bg-primary/5 text-primary" 
          : "border-border bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:border-border/80"
      )}
    >
      {active && <div className="absolute top-2 right-2 text-primary"><Check size={16} strokeWidth={3} /></div>}
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}

// --- 子组件：语言选择条目 ---
function LangItem({ active, onClick, label, subLabel }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-200",
        active 
          ? "border-primary bg-primary/5 text-primary" 
          : "border-border bg-background text-foreground hover:bg-secondary/40"
      )}
    >
      <div className="flex flex-col items-start">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-xs text-muted-foreground opacity-70">{subLabel}</span>
      </div>
      {active && <Check size={18} strokeWidth={2.5} />}
    </button>
  );
}

// 小图标组件
function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  )
}