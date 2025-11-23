import { useState } from 'react';
import { X, Monitor, Moon, Sun, Languages, Check, Filter } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getText } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { FilterManager } from '../features/context/FilterManager';

export function SettingsModal() {
  const { 
    isSettingsOpen, setSettingsOpen, 
    theme, setTheme, 
    language, setLanguage,
    globalIgnore, updateGlobalIgnore
  } = useAppStore();

  // 增加 Tab 切换状态
  const [activeSection, setActiveSection] = useState<'appearance' | 'language' | 'filters'>('appearance');

  if (!isSettingsOpen) return null;

  return (
    // 背景遮罩
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
      
      {/* 弹窗主体 */}
      <div className="w-[600px] h-[500px] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* 标题栏 */}
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
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

        <div className="flex flex-1 overflow-hidden">
            {/* Sidebar Navigation */}
            <div className="w-40 bg-secondary/5 border-r border-border p-2 space-y-1">
                <NavBtn active={activeSection === 'appearance'} onClick={() => setActiveSection('appearance')} icon={<Monitor size={14} />} label={getText('settings', 'navAppearance', language)}  />
                <NavBtn active={activeSection === 'language'} onClick={() => setActiveSection('language')} icon={<Languages size={14} />} label={getText('settings', 'navLanguage', language)} />
                <NavBtn active={activeSection === 'filters'} onClick={() => setActiveSection('filters')} icon={<Filter size={14} />} label={getText('settings', 'navFilters', language)} />
            </div>

            {/* Content Area */}
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                
                {/* 1. 外观设置 */}
                {activeSection === 'appearance' && (
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                            {getText('settings', 'appearance', language)}
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            <ThemeCard active={theme === 'dark'} onClick={() => setTheme('dark')} icon={<Moon size={24} />} label={getText('settings', 'themeDark', language)} />
                            <ThemeCard active={theme === 'light'} onClick={() => setTheme('light')} icon={<Sun size={24} />} label={getText('settings', 'themeLight', language)} />
                        </div>
                    </div>
                )}
                
                {/* 2. 语言设置 */}
                {activeSection === 'language' && (
                     <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                            {getText('settings', 'language', language)}
                        </h3>
                        <div className="space-y-2">
                            <LangItem active={language === 'zh'} onClick={() => setLanguage('zh')} label={getText('settings', 'langZh', language)} subLabel="Chinese Simplified" />
                            <LangItem active={language === 'en'} onClick={() => setLanguage('en')} label={getText('settings', 'langEn', language)} subLabel="English" />
                        </div>
                     </div>
                )}

                {/* 3. ✨ 全局过滤器 */}
                {activeSection === 'filters' && (
                    <div className="h-full flex flex-col">
                        <div className="mb-4">
                            <h3 className="text-sm font-medium text-foreground">{getText('settings', 'filtersTitle', language)}</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                                {getText('settings', 'filtersDesc', language)}
                            </p>
                        </div>
                        <div className="flex-1 border border-border rounded-lg p-4 bg-secondary/5 overflow-hidden flex flex-col">
                            {/* 这里不传 globalConfig，表示这是最顶层，没有锁定逻辑 */}
                            <FilterManager 
                                localConfig={globalIgnore} 
                                onUpdate={updateGlobalIgnore}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}

// --- 子组件保持不变 ---
function ThemeCard({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick} className={cn("relative flex flex-col items-center justify-center gap-3 p-4 rounded-lg border-2 transition-all duration-200", active ? "border-primary bg-primary/5 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:border-border/80")}>
      {active && <div className="absolute top-2 right-2 text-primary"><Check size={16} strokeWidth={3} /></div>}
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}

function LangItem({ active, onClick, label, subLabel }: any) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-200", active ? "border-primary bg-primary/5 text-primary" : "border-border bg-background text-foreground hover:bg-secondary/40")}>
      <div className="flex flex-col items-start"><span className="font-medium text-sm">{label}</span><span className="text-xs text-muted-foreground opacity-70">{subLabel}</span></div>
      {active && <Check size={18} strokeWidth={2.5} />}
    </button>
  );
}

function NavBtn({ active, onClick, icon, label }: any) {
    return (
        <button onClick={onClick} className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors", active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
            {icon} {label}
        </button>
    )
}

function SettingsIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
}