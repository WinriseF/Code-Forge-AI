import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, Bot, Zap, AppWindow, Terminal, Sparkles, X, MessageSquare, CornerDownRight, Calculator, ClipboardList, Paperclip, FileText, FolderOpen, Image as ImageIcon, MoreVertical } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';
import { useSpotlight } from './SpotlightContext';
import { useCollapsedItems, useSmartContextMenu } from '@/lib/hooks';
import { ChatCommandMenu } from './ChatCommandMenu';
import { Prompt } from '@/types/prompt';
import { usePromptStore } from '@/store/usePromptStore';
import { SearchScope } from '@/types/spotlight';
import { SearchEngineIcon } from '@/components/ui/SearchEngineIcon';
import type { ChatAttachmentError } from '@/lib/chat_attachment';
import { CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_COLLAPSE_THRESHOLD } from '@/lib/chat_attachment';

interface SearchBarProps {
  onKeyDown?: (e: React.KeyboardEvent) => void;
  isResizeMode?: boolean;
}

const FOLDER_IMPORT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  'target',
  'bin',
  'obj',
  '.venv',
  'venv',
  '__pycache__'
]);

const FOLDER_IMPORT_MAX_DEPTH = 5;
const FOLDER_IMPORT_SCAN_CAP = 3000;
const CHAT_COMMAND_MENU_LIMIT = 8;

type FolderImportSkipReason = 'excluded_dir' | 'too_deep';

interface FolderImportStats {
  accepted: number;
  excluded: number;
  tooDeep: number;
  capped: number;
}

function filterChatTemplates(templates: Prompt[], keyword: string): Prompt[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return templates.slice(0, CHAT_COMMAND_MENU_LIMIT);
  }

  return templates
    .filter((template) => {
      const title = template.title.toLowerCase();
      const group = (template.group || '').toLowerCase();
      const description = (template.description || '').toLowerCase();
      return (
        title.includes(normalized) ||
        group.includes(normalized) ||
        description.includes(normalized)
      );
    })
    .slice(0, CHAT_COMMAND_MENU_LIMIT);
}

function getFolderImportSkipReason(file: File): FolderImportSkipReason | null {
  const rel = (file.webkitRelativePath || '').replace(/\\/g, '/');
  if (!rel) return null;
  const dirs = rel.split('/').slice(0, -1).map(segment => segment.toLowerCase());
  if (dirs.some(dir => FOLDER_IMPORT_EXCLUDE_DIRS.has(dir))) return 'excluded_dir';
  const nestedDepth = Math.max(0, dirs.length - 1);
  if (nestedDepth > FOLDER_IMPORT_MAX_DEPTH) return 'too_deep';
  return null;
}

export function SearchBar({ onKeyDown, isResizeMode = false }: SearchBarProps) {
  const { t } = useTranslation();
  const {
    mode, query, chatInput, searchScope, activeTemplate,
    setQuery, setChatInput, inputRef, setSearchScope, setActiveTemplate, toggleMode,
    attachments, attachmentErrors, addAttachments, removeAttachment, clearAttachmentError
  } = useSpotlight();

  const { aiConfig, setAIConfig, savedProviderSettings, searchSettings } = useAppStore(
    useShallow((state) => ({
      aiConfig: state.aiConfig,
      setAIConfig: state.setAIConfig,
      savedProviderSettings: state.savedProviderSettings,
      searchSettings: state.searchSettings,
    })),
  );
  const chatTemplates = usePromptStore((state) => state.chatTemplates);

  const [menuSelectedIndex, setMenuSelectedIndex] = useState(0);
  const [folderImportStats, setFolderImportStats] = useState<FolderImportStats | null>(null);
  const [isChatActionsVisible, setIsChatActionsVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const chatActionsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getAttachmentErrorText = (error: ChatAttachmentError) => {
    switch (error.type) {
      case 'too_many':
        return t('spotlight.attachmentTooMany', { max: error.max });
      case 'total_size_exceeded':
        return t('spotlight.attachmentTotalSizeExceeded');
      case 'image_too_large':
        return t('spotlight.attachmentImageTooLarge', { name: error.fileName });
      case 'file_too_large':
        return t('spotlight.attachmentFileTooLarge', { name: error.fileName });
      case 'unsupported_type':
        return t('spotlight.attachmentUnsupportedType', { name: error.fileName });
      case 'parse_failed':
        return t('spotlight.attachmentParseFailed', { name: error.fileName });
      default:
        return '';
    }
  };

  const slashCommandMatch = mode === 'chat' && !activeTemplate
    ? chatInput.match(/^\/([^\s]*)$/)
    : null;
  const showCommandMenu = Boolean(slashCommandMatch);
  const commandKeyword = slashCommandMatch?.[1] ?? '';
  const filteredPrompts = showCommandMenu
    ? filterChatTemplates(chatTemplates, commandKeyword)
    : [];
  const {
    expanded: showAllAttachments,
    setExpanded: setShowAllAttachments,
    shouldCollapse: shouldCollapseAttachmentTray,
    visibleItems: visibleAttachments,
    hiddenCount: hiddenAttachmentCount,
    hiddenPreview: hiddenAttachmentPreview
  } = useCollapsedItems({
    items: attachments,
    threshold: CHAT_ATTACHMENT_COLLAPSE_THRESHOLD,
    getPreviewText: item => item.name
  });
  const visibleAttachmentErrors = attachmentErrors.slice(0, 3);
  const hiddenAttachmentErrorCount = Math.max(0, attachmentErrors.length - visibleAttachmentErrors.length);

  const clearChatActionsHideTimer = () => {
    if (!chatActionsHideTimerRef.current) return;
    clearTimeout(chatActionsHideTimerRef.current);
    chatActionsHideTimerRef.current = null;
  };

  const showChatActions = () => {
    clearChatActionsHideTimer();
    setIsChatActionsVisible(true);
  };

  const hideChatActions = () => {
    clearChatActionsHideTimer();
    chatActionsHideTimerRef.current = setTimeout(() => {
      setIsChatActionsVisible(false);
    }, 120);
  };

  useEffect(() => {
    return () => {
      clearChatActionsHideTimer();
    };
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    if (mode === 'search' && searchScope === 'global') {
      const match = inputValue.match(/^([=]|>|》|\?|？)/);

      if (match) {
        const trigger = match[1];
        let targetScope: SearchScope | null = null;

        if (trigger === '=') targetScope = 'math';
        else if (trigger === '>' || trigger === '》') targetScope = 'shell';
        else if (trigger === '?' || trigger === '？') targetScope = 'web';

        if (targetScope) {
            setSearchScope(targetScope);
            const cleanQuery = inputValue.substring(trigger.length);
            setTimeout(() => {
                setQuery(cleanQuery);
            }, 0);
            return;
        }
      }

      if (inputValue.startsWith('/app ')) { setSearchScope('app'); setQuery(''); return; }
      if (inputValue.startsWith('/cmd ')) { setSearchScope('command'); setQuery(''); return; }
      if (inputValue.startsWith('/pmt ')) { setSearchScope('prompt'); setQuery(''); return; }
    }

    setQuery(inputValue);
  };

  const handleChatInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setChatInput(val);
      if (/^\/([^\s]*)$/.test(val)) {
          setMenuSelectedIndex(0);
      }
  };

  const handlePaste = (pastedText: string, input: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (!input || !(input instanceof HTMLInputElement)) return;
    const { selectionStart, selectionEnd } = input;
    const currentValue = mode === 'search' ? query : chatInput;
    const newValue = currentValue.substring(0, selectionStart ?? 0) + pastedText + currentValue.substring(selectionEnd ?? 0);

    if (mode === 'search') setQuery(newValue);
    else setChatInput(newValue);

    setTimeout(() => {
      const newCursorPos = (selectionStart ?? 0) + pastedText.length;
      input.focus();
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const { onContextMenu } = useSmartContextMenu({ onPaste: handlePaste });

  const cycleProvider = () => {
    const providers = Object.keys(savedProviderSettings).filter(
      (id) => savedProviderSettings[id]?.apiKey,
    );
    const currentIndex = providers.indexOf(aiConfig.providerId);

    if (providers.length > 0) {
        const nextIndex = (currentIndex + 1) % providers.length;
        setAIConfig({ providerId: providers[nextIndex] });
    }
  };

  const handleTemplateSelect = (prompt: Prompt) => {
      setActiveTemplate(prompt);
      setChatInput('');
      setMenuSelectedIndex(0);
  };

  const handleAttachClick = () => {
    clearAttachmentError();
    setFolderImportStats(null);
    fileInputRef.current?.click();
  };

  const handleAttachFolderClick = () => {
    clearAttachmentError();
    setFolderImportStats(null);
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setFolderImportStats(null);
    await addAttachments(files);
    e.target.value = '';
  };

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    const filteredFiles: File[] = [];
    let excludedCount = 0;
    let tooDeepCount = 0;

    for (const file of selectedFiles) {
      const skipReason = getFolderImportSkipReason(file);
      if (skipReason === 'excluded_dir') {
        excludedCount += 1;
        continue;
      }
      if (skipReason === 'too_deep') {
        tooDeepCount += 1;
        continue;
      }
      if (filteredFiles.length >= FOLDER_IMPORT_SCAN_CAP) {
        continue;
      }
      filteredFiles.push(file);
    }

    const cappedCount = Math.max(
      0,
      selectedFiles.length - excludedCount - tooDeepCount - filteredFiles.length
    );
    if (excludedCount > 0 || tooDeepCount > 0 || cappedCount > 0) {
      setFolderImportStats({
        accepted: filteredFiles.length,
        excluded: excludedCount,
        tooDeep: tooDeepCount,
        capped: cappedCount
      });
    } else {
      setFolderImportStats(null);
    }

    if (filteredFiles.length > 0) {
      await addAttachments(filteredFiles);
    }
    e.target.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (isResizeMode) {
          if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) {
              e.preventDefault();
          }
          return;
      }

      if (mode === 'chat' && activeTemplate && chatInput === '' && e.key === 'Backspace') {
          e.preventDefault();
          setActiveTemplate(null);
          setChatInput(`/${activeTemplate.title}`);
          return;
      }

      if (showCommandMenu && filteredPrompts.length > 0) {
          if (e.key === 'ArrowDown') {
              e.preventDefault();
              setMenuSelectedIndex(prev => (prev + 1) % filteredPrompts.length);
              return;
          }
          if (e.key === 'ArrowUp') {
              e.preventDefault();
              setMenuSelectedIndex(prev => (prev - 1 + filteredPrompts.length) % filteredPrompts.length);
              return;
          }
          if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();

              if (!e.shiftKey) {
                  handleTemplateSelect(filteredPrompts[menuSelectedIndex]);
              }
              return;
          }
      }

      if (mode === 'search' && searchScope !== 'global' && e.key === 'Backspace' && query === '') {
        e.preventDefault();
        setSearchScope('global');
        return;
      }

      onKeyDown?.(e);
  };

  const renderLeftTag = () => {
    if (mode === 'chat' && activeTemplate) {
        return (
            <div className="flex items-center gap-1.5 pl-2 pr-3 py-1 bg-blue-600 text-white rounded-md text-xs font-bold transition-all duration-300 animate-in zoom-in-95 group relative z-10 shrink-0 select-none shadow-sm shadow-blue-500/20">
                <MessageSquare size={14} className="fill-current" />
                <span className="truncate max-w-[100px]">{activeTemplate.title}</span>
                <button
                  onClick={() => { setActiveTemplate(null); setChatInput(`/${activeTemplate.title}`); }}
                  className="ml-1 p-0.5 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X size={10} />
                </button>
            </div>
        );
    }

    if (mode === 'search' && searchScope !== 'global') {
        let IconComponent;
        let bgColor = 'bg-secondary/30';
        let textColor = 'text-muted-foreground';
        let borderColor = 'border-transparent';

        switch (searchScope) {
            case 'app':
                IconComponent = AppWindow;
                bgColor = 'bg-cyan-500/10'; textColor = 'text-cyan-500'; borderColor = 'border-cyan-500/20';
                break;
            case 'command':
                IconComponent = Terminal;
                bgColor = 'bg-orange-500/10'; textColor = 'text-orange-500'; borderColor = 'border-orange-500/20';
                break;
            case 'prompt':
                IconComponent = Sparkles;
                bgColor = 'bg-purple-500/10'; textColor = 'text-purple-500'; borderColor = 'border-purple-500/20';
                break;
            case 'math':
                IconComponent = Calculator;
                bgColor = 'bg-emerald-500/10'; textColor = 'text-emerald-500'; borderColor = 'border-emerald-500/20';
                break;
            case 'shell':
                IconComponent = Terminal;
                bgColor = 'bg-slate-500/10'; textColor = 'text-foreground'; borderColor = 'border-slate-500/20';
                break;
            case 'web':
                return (
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/20 animate-in zoom-in-95">
                        <SearchEngineIcon engine={searchSettings.defaultEngine} size={18} />
                    </div>
                );
            default: return null;
        }

        return (
            <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 animate-in zoom-in-95 group relative z-10 shrink-0 border",
                bgColor, textColor, borderColor
            )}>
                <IconComponent size={18} />
            </div>
        );
    }
    return null;
  };

  return (
    <div data-tauri-drag-region className={cn(
        "min-h-16 shrink-0 flex flex-col justify-center px-6 py-2 gap-2 border-b transition-all duration-500 cursor-move",
        mode === 'chat' ? "bg-purple-500/5" :
        mode === 'clipboard' ? "bg-blue-500/5" : // 剪贴板模式背景色
        "bg-background/50"
    )}>
      <div className="w-full flex items-center gap-4 relative">

      {/* 模式切换按钮 - 单按钮循环切换，支持 Alt+1/2/3 快捷键 */}
      <button
        onClick={toggleMode}
        className="w-6 h-6 flex items-center justify-center relative outline-none group mr-4 cursor-pointer"
        title={t('spotlight.toggleMode')}
      >
        <SearchIcon
          strokeWidth={1.5}
          className={cn(
            "absolute transition-all duration-300 text-muted-foreground/70 group-hover:text-foreground",
            mode === 'search' ? "scale-100 opacity-100" : "scale-50 opacity-0 rotate-90"
          )}
          size={24}
        />
        <Bot
          strokeWidth={1.5}
          className={cn(
            "absolute transition-all duration-300 text-purple-500",
            mode === 'chat' ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 -rotate-90"
          )}
          size={24}
        />
        <ClipboardList
          strokeWidth={1.5}
          className={cn(
            "absolute transition-all duration-300 text-blue-500",
            mode === 'clipboard' ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 -rotate-90"
          )}
          size={24}
        />
      </button>

      {renderLeftTag()}

      <div className="flex-1 relative h-full flex items-center">
          {mode === 'chat' && activeTemplate && !chatInput && (
              <div className="absolute left-0 text-muted-foreground/30 text-xl pointer-events-none flex items-center gap-2 animate-in fade-in duration-300">
                  <CornerDownRight size={16} />
                  <span className="text-sm italic font-medium">Input parameter...</span>
              </div>
          )}

          <input
            ref={inputRef}
            onContextMenu={onContextMenu}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent border-none outline-none text-xl font-light placeholder:text-muted-foreground/30 h-full text-foreground caret-primary relative z-10"
            style={{ letterSpacing: '-0.02em' }}
            placeholder={
                mode === 'search'
                    ? (searchScope === 'global' ? t('spotlight.searchPlaceholder') :
                       searchScope === 'math' ? "Expression..." :
                       searchScope === 'shell' ? "Shell Command..." :
                       searchScope === 'web' ? "Search..." :
                       `${t('spotlight.filterPlaceholder')}...`)
                    : mode === 'chat'
                        ? (activeTemplate ? "" : t('spotlight.chatPlaceholder'))
                        : t('spotlight.clipboardPlaceholder')
            }
            value={mode === 'search' || mode === 'clipboard' ? query : chatInput}
            onChange={mode === 'search' || mode === 'clipboard' ? handleQueryChange : handleChatInputChange}
            autoFocus
            spellCheck={false}
          />

       </div>

      <div className="flex items-center gap-2 relative z-10">
         {mode === 'chat' && (
            <div
              className="relative h-8 w-8"
              onMouseEnter={showChatActions}
              onMouseLeave={hideChatActions}
              onFocusCapture={showChatActions}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                hideChatActions();
              }}
            >
              <button
                className={cn(
                  "absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md border border-border/50 bg-secondary/50",
                  "inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-300 ease-out",
                  isChatActionsVisible ? "opacity-0 pointer-events-none scale-95" : "opacity-100 scale-100"
                )}
                title="Quick actions"
                onMouseEnter={showChatActions}
              >
                <MoreVertical strokeWidth={2} size={14} />
                {attachments.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] leading-none inline-flex items-center justify-center font-semibold">
                    {attachments.length > 99 ? '99+' : attachments.length}
                  </span>
                )}
              </button>

              <div
                className={cn(
                  "absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center gap-2 transition-all duration-300 ease-out",
                  isChatActionsVisible
                    ? "opacity-100 translate-x-0 scale-100 pointer-events-auto"
                    : "opacity-0 translate-x-2 scale-[0.98] pointer-events-none"
                )}
              >
                <button
                  onClick={handleAttachClick}
                  className="relative flex items-center justify-center px-2 py-1 rounded-md text-[10px] font-mono font-medium transition-colors border border-border/50 bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground group"
                  title={t('spotlight.attachFiles')}
                >
                    <Paperclip strokeWidth={2} size={14} />
                    {attachments.length > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] leading-none inline-flex items-center justify-center font-semibold">
                        {attachments.length}
                      </span>
                    )}
                </button>

                <button
                  onClick={handleAttachFolderClick}
                  className="flex items-center justify-center px-2 py-1 rounded-md text-[10px] font-mono font-medium transition-colors border border-border/50 bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground group"
                  title={t('spotlight.attachFolder')}
                >
                    <FolderOpen strokeWidth={2} size={14} />
                </button>

                <button onClick={cycleProvider} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-[10px] font-mono font-medium transition-colors border border-border/50 group" title={t('spotlight.currentProvider', { provider: aiConfig.providerId })}>
                    <Zap strokeWidth={2} size={10} className={cn(
                        aiConfig.providerId.toLowerCase().includes('deepseek') ? "text-blue-500" :
                        aiConfig.providerId.toLowerCase().includes('openai') ? "text-green-500" :
                        aiConfig.providerId.toLowerCase().includes('anthropic') ? "text-purple-500" :
                        "text-orange-500"
                    )} />
                    <span className="opacity-70 group-hover:opacity-100 uppercase truncate max-w-[80px]">
                        {aiConfig.providerId}
                    </span>
                </button>
              </div>
            </div>
         )}
         <div className="flex items-center gap-2 pointer-events-none opacity-50">
              {mode === 'search' && query && <span className="px-2 py-1 rounded-md bg-secondary/50 border border-border/50 text-[10px] font-mono text-muted-foreground">ESC {t('spotlight.clear')}</span>}
        </div>

      </div>

      {showCommandMenu && (
          <ChatCommandMenu
              prompts={filteredPrompts}
              keyword={commandKeyword}
              selectedIndex={menuSelectedIndex}
              onSelect={handleTemplateSelect}
              className="left-0 right-0 top-[calc(100%-1px)]"
          />
      )}
      </div>

      {mode === 'chat' && attachments.length > 0 && (
        <div className="w-full pl-14 pr-2 flex flex-wrap gap-1.5">
          {visibleAttachments.map(item => (
            <div
              key={item.id}
              className="group/attachment max-w-[240px] flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 bg-background/70 text-[10px] text-muted-foreground"
              title={item.name}
            >
              {item.kind === 'image' ? <ImageIcon size={11} className="shrink-0" /> : <FileText size={11} className="shrink-0" />}
              <span className="truncate">{item.name}</span>
              <button
                className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={() => removeAttachment(item.id)}
                title={t('spotlight.removeAttachment')}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {!showAllAttachments && hiddenAttachmentCount > 0 && (
            <button
              onClick={() => setShowAllAttachments(true)}
              className="px-2 py-1 rounded-md border border-border/60 bg-background/70 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              title={hiddenAttachmentPreview || `+${hiddenAttachmentCount}`}
            >
              +{hiddenAttachmentCount}
            </button>
          )}
          {showAllAttachments && shouldCollapseAttachmentTray && (
            <button
              onClick={() => setShowAllAttachments(false)}
              className="px-2 py-1 rounded-md border border-border/60 bg-background/70 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              {t('actions.collapse')}
            </button>
          )}
        </div>
      )}

      {mode === 'chat' && attachmentErrors.length > 0 && (
        <div className="w-full pl-14 pr-2 text-[10px] text-destructive/90 leading-snug">
          {visibleAttachmentErrors.map((error, index) => (
            <div key={`${error.type}-${index}`}>{getAttachmentErrorText(error)}</div>
          ))}
          {hiddenAttachmentErrorCount > 0 && (
            <div>{t('spotlight.attachmentMoreErrors', { count: hiddenAttachmentErrorCount })}</div>
          )}
        </div>
      )}

      {mode === 'chat' && folderImportStats && (
        <div className="w-full pl-14 pr-2 text-[10px] text-muted-foreground/80 leading-snug">
          {t('spotlight.folderImportSummary', {
            accepted: folderImportStats.accepted,
            excluded: folderImportStats.excluded,
            tooDeep: folderImportStats.tooDeep,
            capped: folderImportStats.capped,
            maxDepth: FOLDER_IMPORT_MAX_DEPTH,
            scanCap: FOLDER_IMPORT_SCAN_CAP
          })}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept={CHAT_ATTACHMENT_ACCEPT}
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={handleFolderChange}
      />
    </div>
  );
}
