import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Copy, Maximize2, Minus, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { PreviewModal } from '@/components/features/hyperview';
import { TransferView } from '@/components/features/transfer/TransferView';
import { useCrossWindowAppStoreSync } from '@/lib/hooks/useCrossWindowAppStoreSync';
import { applyThemeToDocument } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { AppTheme, useAppStore } from '@/store/useAppStore';

const appWindow = getCurrentWebviewWindow();

function TransferWindowChrome() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const syncMaximized = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };

    const unlistenPromise = appWindow.onResized(syncMaximized);
    void syncMaximized();

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const btnClass =
    'h-7 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary/50';

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <div className="h-8 bg-background flex items-center justify-between select-none border-b border-border shrink-0 transition-colors duration-300 relative">
      <div data-tauri-drag-region className="absolute inset-0" />

      <div className="relative z-10 flex items-center gap-2 px-4 h-full pointer-events-none">
        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10 text-cyan-400">
          <Upload size={14} />
        </div>
        <span className="text-xs font-medium tracking-wide text-foreground/90">
          {t('menu.transfer')}
        </span>
      </div>

      <div className="flex h-full items-center px-1 gap-1 relative z-10">
        <button onClick={() => appWindow.minimize()} className={btnClass}>
          <Minus size={14} />
        </button>
        <button onClick={toggleMaximize} className={btnClass}>
          {isMaximized ? <Copy size={12} /> : <Maximize2 size={12} />}
        </button>
        <button
          onClick={() => void appWindow.close()}
          className={cn(btnClass, 'hover:bg-destructive/80 hover:text-destructive-foreground')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default function TransferWindowApp() {
  useCrossWindowAppStoreSync();

  const [theme, setTheme] = useAppStore(
    useShallow((state) => [state.theme, state.setTheme]),
  );

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const themeUnlisten = listen<AppTheme>('theme-changed', (event) => {
      setTheme(event.payload, true);
    });

    return () => {
      themeUnlisten.then((unlisten) => unlisten());
    };
  }, [setTheme]);

  return (
    <div className="h-screen w-full bg-background text-foreground overflow-hidden flex flex-col transition-colors duration-300 relative">
      <TransferWindowChrome />
      <div className="flex-1 min-h-0">
        <TransferView />
      </div>
      <PreviewModal />
    </div>
  );
}
