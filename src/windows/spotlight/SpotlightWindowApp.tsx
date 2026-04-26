import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { message } from '@tauri-apps/plugin-dialog';
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

import { useAppStore, AppTheme, type SpotlightAppearance } from '@/store/useAppStore';
import { useContextStore } from '@/store/useContextStore';
import { usePromptStore } from '@/store/usePromptStore';
import { useTranslation } from 'react-i18next';
import { parseVariables } from '@/lib/template';
import { executeCommand } from '@/lib/command_executor';
import { GlobalConfirmDialog } from "@/components/ui/GlobalConfirmDialog";
import { ExecApprovalSheet } from '@/components/features/spotlight/exec/ExecApprovalSheet';
import { useExecStore } from '@/store/useExecStore';
import { useCrossWindowAppStoreSync } from '@/lib/hooks/useCrossWindowAppStoreSync';

import { SpotlightProvider, useSpotlight } from '@/components/features/spotlight/core/SpotlightContext';
import { SpotlightLayout } from '@/components/features/spotlight/core/SpotlightLayout';
import { SearchBar } from '@/components/features/spotlight/core/SearchBar';

import { useSpotlightSearch } from '@/components/features/spotlight/hooks/useSpotlightSearch';
import { useSpotlightChat } from '@/components/features/spotlight/hooks/useSpotlightChat';
import { SearchMode } from '@/components/features/spotlight/modes/search/SearchMode';
import { ChatMode } from '@/components/features/spotlight/modes/chat/ChatMode';
import { SpotlightItem } from '@/types/spotlight';
import { ShellType } from '@/types/prompt';
import { applyThemeToDocument } from '@/lib/theme';
import { listAIModels } from '@/lib/aiModels';
import type { AIModelRecord } from '@/types/model';
import {
  DEFAULT_SPOTLIGHT_APPEARANCE,
  SPOTLIGHT_RESIZE_FAST_STEP,
  SPOTLIGHT_RESIZE_STEP,
  applyResizeDelta,
  areSpotlightAppearancesEqual,
  formatSpotlightSizeLabel,
  getSpotlightWindowHeight,
  normalizeSpotlightAppearance,
} from './resizeMode';

const appWindow = getCurrentWebviewWindow();
const REFINERY_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-refinery|';
const SPOTLIGHT_CHAT_MODEL_CATEGORIES = ['chat', 'coding', 'vision'] as const;

function SpotlightContent() {
  const {
    mode, toggleMode, focusInput, inputRef,
    query, setQuery,
    chatInput, setChatInput,
    searchScope, setSearchScope,
    activeTemplate, setActiveTemplate,
    attachments, clearAttachments,
    setMode
  } = useSpotlight();
  const spotlightAppearance = useAppStore((state) => state.spotlightAppearance);
  const setSpotlightAppearance = useAppStore((state) => state.setSpotlightAppearance);
  const projectRoot = useContextStore((state) => state.projectRoot);
  const { t } = useTranslation();

  const [chatModels, setChatModels] = useState<AIModelRecord[]>([]);
  const [selectedChatModelId, setSelectedChatModelId] = useState<string | null>(null);

  const refreshChatModels = useCallback(async () => {
    try {
      const modelGroups = await Promise.all(
        SPOTLIGHT_CHAT_MODEL_CATEGORIES.map((category) =>
          listAIModels({ category, enabledOnly: true })
        )
      );
      const nextModels = modelGroups.flat();
      setChatModels(nextModels);
      setSelectedChatModelId((currentId) => {
        if (currentId && nextModels.some((model) => model.id === currentId)) {
          return currentId;
        }
        return nextModels.find((model) => model.isDefault)?.id ?? nextModels[0]?.id ?? null;
      });
    } catch (err) {
      console.error('Failed to refresh spotlight chat models:', err);
      setChatModels([]);
      setSelectedChatModelId(null);
    }
  }, []);

  const search = useSpotlightSearch(t);
  const chat = useSpotlightChat(selectedChatModelId);
  const initExecListeners = useExecStore((state) => state.initListeners);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isResizeMode, setIsResizeMode] = useState(false);
  const [resizeDraft, setResizeDraft] = useState<SpotlightAppearance | null>(null);

  const hasChatMessages = chat.messages.length > 0;
  const effectiveAppearance = normalizeSpotlightAppearance(resizeDraft ?? spotlightAppearance);
  const effectiveHeight = getSpotlightWindowHeight(effectiveAppearance, mode, hasChatMessages);
  const resizeSizeLabel = formatSpotlightSizeLabel(
    effectiveAppearance.width,
    effectiveHeight,
  );

  useEffect(() => {
    void initExecListeners();
  }, [initExecListeners]);

  useEffect(() => {
    void refreshChatModels();
  }, [refreshChatModels]);

  useEffect(() => {
    const unlisten = appWindow.onFocusChanged(({ payload: isFocused }) => {
      if (isFocused) {
        focusInput();
        void refreshChatModels();
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [focusInput, refreshChatModels]);

  useLayoutEffect(() => {
    appWindow.setSize(new LogicalSize(effectiveAppearance.width, effectiveHeight));
  }, [effectiveAppearance.width, effectiveHeight]);

  const enterResizeMode = () => {
    setResizeDraft(normalizeSpotlightAppearance(spotlightAppearance));
    setIsResizeMode(true);
  };

  const exitResizeMode = () => {
    setIsResizeMode(false);
    setResizeDraft(null);
    focusInput();
  };

  const commitResizeMode = () => {
    if (resizeDraft && !areSpotlightAppearancesEqual(spotlightAppearance, resizeDraft)) {
      setSpotlightAppearance(resizeDraft);
    }
    exitResizeMode();
  };

  const cancelResizeMode = () => {
    exitResizeMode();
  };

  const adjustResizeMode = (direction: 'up' | 'down' | 'left' | 'right', fast: boolean) => {
    const baseAppearance = resizeDraft ?? normalizeSpotlightAppearance(spotlightAppearance);
    const step = fast ? SPOTLIGHT_RESIZE_FAST_STEP : SPOTLIGHT_RESIZE_STEP;
    setResizeDraft(applyResizeDelta(baseAppearance, direction, mode, hasChatMessages, step));
  };

  const resetResizeMode = () => {
    setResizeDraft(DEFAULT_SPOTLIGHT_APPEARANCE);
  };

  const handleItemSelect = async (item: SpotlightItem) => {
    if (!item) return;

    if (item.type === 'clipboard') {
        try {
            await invoke(`${REFINERY_PLUGIN_PREFIX}spotlight_paste`, { itemId: item.id });
            setQuery('');
        } catch (e) {
            console.error("Paste failed", e);
        }
        return;
    }

    if (item.type === 'shell_history') {
      const command = item.historyCommand?.trim() || '';
      if (command) {
        setSearchScope('shell');
        setQuery(command);

        setTimeout(() => {
          const input = inputRef.current;
          if (input) {
            input.focus();
            const pos = command.length;
            input.setSelectionRange(pos, pos);
          }
        }, 0);

        search.setSelectedIndex(0);
      }
      return;
    }

    if (item.type === 'app' && item.appPath) {
        try {
            await invoke('open_app', { path: item.appPath });
            await appWindow.hide();
            setQuery('');
        } catch (e) {
            await message(t('common.failedToLaunch', { error: String(e) }), { kind: 'error' });
        }
        return;
    }

    if (item.type === 'url' && item.url) {
        try {
            await open(item.url);
            void invoke('record_url_visit', { url: item.url }).catch((err) => {
              console.error('Failed to record URL visit:', err);
            });
            await appWindow.hide();
            setQuery('');
        } catch (e) {
            await message(t('common.failedToOpenUrl', { error: String(e) }), { kind: 'error' });
        }
        return;
    }

    if (item.type === 'web_search' && item.url) {
        try {
            await open(item.url);
            void invoke('record_url_visit', { url: item.url }).catch((err) => {
              console.error('Failed to record web search visit:', err);
            });
            await appWindow.hide();
            setQuery('');
        } catch (e) {
            console.error('Failed to open web search URL:', e);
        }
        return;
    }

    if (item.isExecutable || item.type === 'shell') {
      const content = item.content || '';
      const vars = parseVariables(content);
      if (vars.length > 0) {
        await message(t('spotlight.commandHasVariables'), {
          title: t('spotlight.actionRequired'),
          kind: 'info'
        });
        return;
      }

      const executionTask = executeCommand(content, (item.shellType as ShellType) || 'auto', projectRoot);

      let recordTask: Promise<void> | null = null;
      if (item.type === 'shell') {
        recordTask = invoke<void>('record_shell_command', { command: content });
      }

      if (recordTask) {
        await Promise.all([executionTask, recordTask]);
      } else {
        await executionTask;
      }

      await appWindow.hide();
      setQuery('');
    } else {
      try {
        await writeText(item.content || '');
        setCopiedId(item.id);

        setTimeout(async () => {
          await appWindow.hide();
          setCopiedId(null);
          if (item.type === 'math') {
            setQuery('');
          }
        }, 300);
      } catch (err) {
        console.error('Failed to copy spotlight item:', err);
      }
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (e.isComposing) return;

      if (e.key === 'F8') {
        e.preventDefault();
        if (isResizeMode) {
          commitResizeMode();
        } else {
          enterResizeMode();
        }
        return;
      }

      if (isResizeMode) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelResizeMode();
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          commitResizeMode();
          return;
        }

        if (e.key === '0') {
          e.preventDefault();
          resetResizeMode();
          return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          adjustResizeMode(
            e.key === 'ArrowDown'
              ? 'down'
              : e.key === 'ArrowUp'
                ? 'up'
                : e.key === 'ArrowLeft'
                  ? 'left'
                  : 'right',
            e.shiftKey,
          );
          return;
        }

        if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        toggleMode();
        return;
      }

      const isModifierPressed = navigator.platform.includes('Mac') ? e.metaKey : e.altKey;

      if (isModifierPressed) {
        if (e.key === '1') {
          e.preventDefault();
          setMode('search');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          setMode('chat');
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          setMode('clipboard');
          return;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();

        if (mode === 'search' || mode === 'clipboard') {
            if (query.length > 0) {
                setQuery('');
                return;
            }
            if (mode === 'search' && searchScope !== 'global') {
                setSearchScope('global');
                return;
            }
        } else {
            if (chatInput.length > 0) {
                setChatInput('');
                return;
            }
            if (attachments.length > 0) {
                clearAttachments();
                return;
            }
            if (activeTemplate) {
                setActiveTemplate(null);
                return;
            }
        }

        await appWindow.hide();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (mode === 'chat' && !chat.isStreaming) {
          chat.clearChat();
        }
        return;
      }

      if (mode === 'search' || mode === 'clipboard') { // 允许 clipboard 模式导航
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            search.handleNavigation(e);
            return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          const item = search.results[search.selectedIndex];
          if (item) handleItemSelect(item);
        }
      } else {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          chat.sendMessage();
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    isResizeMode,
    mode,
    query, chatInput, searchScope, activeTemplate, attachments.length,
    search.results,
    search.selectedIndex,
    chat.isStreaming,
    hasChatMessages,
    resizeDraft,
    chat.sendMessage,
    toggleMode,
    setMode,
    spotlightAppearance,
    setSpotlightAppearance,
  ]);

  const resizeFooterActions = isResizeMode ? (
    <>
      <span>{t('spotlight.resizeModeAdjust')} ↑↓←→</span>
      <span>{t('spotlight.resizeModeAccelerate')} Shift</span>
      <span>{t('spotlight.resizeModeReset')} 0</span>
      <span>{t('spotlight.resizeModeSave')} Enter/F8</span>
      <span>{t('spotlight.resizeModeCancel')} Esc</span>
    </>
  ) : undefined;

  const resizeFooterStatus = isResizeMode ? (
    <span className="px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-medium">
      {t('spotlight.resizeModeActive')}
    </span>
  ) : null;

  const resizeOverlay = isResizeMode ? (
    <div className="absolute right-4 bottom-12 z-20 pointer-events-none rounded-lg border border-emerald-500/30 bg-background/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
        {t('spotlight.resizeModeActive')}
      </div>
      <div className="mt-1 font-mono text-sm text-foreground">
        {resizeSizeLabel}
      </div>
    </div>
  ) : null;

  return (
    <SpotlightLayout
      header={
        <SearchBar
          isResizeMode={isResizeMode}
          chatModels={chatModels}
          selectedChatModelId={selectedChatModelId}
          onSelectChatModel={setSelectedChatModelId}
        />
      }
      resultCount={search.results.length}
      isStreaming={chat.isStreaming}
      footerStatusAddon={resizeFooterStatus}
      footerActions={resizeFooterActions}
      overlay={resizeOverlay}
    >
      {(mode === 'search' || mode === 'clipboard') ? (
        <SearchMode
          results={search.results}
          selectedIndex={search.selectedIndex}
          setSelectedIndex={search.setSelectedIndex}
          onSelect={handleItemSelect}
          copiedId={copiedId}
          hasMore={search.hasMore}
          loadMore={search.loadMore}
          isLoading={search.isLoading}
        />
      ) : (
        <ChatMode
          messages={chat.messages}
          isStreaming={chat.isStreaming}
          chatEndRef={chat.chatEndRef}
          containerRef={chat.containerRef}
          onScrollPositionChange={chat.setIsUserAtBottom}
        />
      )}
    </SpotlightLayout>
  );
}

export default function SpotlightApp() {
  useCrossWindowAppStoreSync();

  const initialTheme = useAppStore((state) => state.theme);
  const [theme, setTheme] = useState<AppTheme>(initialTheme);
  const fetchChatTemplates = usePromptStore((state) => state.fetchChatTemplates);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const unlistenPromise = appWindow.onFocusChanged(async ({ payload: isFocused }) => {
      if (isFocused) {
        try {
          await fetchChatTemplates();
          await appWindow.setFocus();
        } catch (err) {
          console.error('Failed to refresh spotlight state on focus:', err);
        }
      }
    });

    const themeUnlisten = listen<AppTheme>('theme-changed', (event) => {
        setTheme(event.payload);
    });

    return () => {
        unlistenPromise.then(f => f());
        themeUnlisten.then(f => f());
    };
  }, [fetchChatTemplates, setTheme]);

  return (
    <div className="spotlight-window h-full">
      <SpotlightProvider>
        <SpotlightContent />
      </SpotlightProvider>
      <GlobalConfirmDialog />
      <ExecApprovalSheet />
    </div>
  );
}
