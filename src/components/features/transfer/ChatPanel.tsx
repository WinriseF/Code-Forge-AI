import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Paperclip, Send, FileText, MonitorSmartphone, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { TransferDevice, TransferMessage } from '@/types/transfer';
import { cn } from '@/lib/utils';
import { buildPreviewUrl } from '@/lib/previewUrl';
import uploadAnimationUrl from '@/assets/upload-files.lottie';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';

interface ChatPanelProps {
  isRunning: boolean;
  isBusy: boolean;
  selectedDevice: TransferDevice | null;
  messages: TransferMessage[];
  onSendMessage: (content: string) => Promise<void>;
  onAttachFile: () => Promise<void>;
  onDropFiles: (paths: string[]) => Promise<void>;
  onOpenFolder: (path: string) => Promise<void>;
  onPreviewFile: (path: string) => Promise<void>;
  onRespondFileRequest: (deviceId: string, fileId: string, accept: boolean) => Promise<void>;
}

function formatFileSize(value?: number | null) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatClock(timestampMs: number) {
  return new Date(timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dirnameFromPath(path: string) {
  const normalized = path.replace(/[\\/]+$/, '');
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : path;
}

function isImageFile(path?: string | null, fileName?: string | null) {
  const target = (path || fileName || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(target);
}

export function ChatPanel({ isRunning, isBusy, selectedDevice, messages, onSendMessage, onAttachFile, onDropFiles, onOpenFolder, onPreviewFile, onRespondFileRequest }: ChatPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canInteractRef = useRef(false);
  const onDropFilesRef = useRef(onDropFiles);
  onDropFilesRef.current = onDropFiles;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, selectedDevice?.id]);

  const handleSend = async () => {
    const next = draft.trim();
    if (!next || !selectedDevice) return;
    await onSendMessage(next);
    setDraft('');
  };

  const isReconnecting = selectedDevice?.presence === 'reconnecting';
  const canInteract = Boolean(selectedDevice && isRunning && !isBusy && !isReconnecting);
  canInteractRef.current = canInteract;

  // Hide overlay when interaction is disabled mid-drag
  useEffect(() => {
    if (!canInteract) setIsDragActive(false);
  }, [canInteract]);

  // Listen to Tauri native drag-drop events (provides file system paths)
  useEffect(() => {
    const webview = getCurrentWebview();
    let dragActive = false;

    const unlistenPromise = webview.onDragDropEvent((event) => {
      const payload = event.payload;

      if (payload.type === 'enter') {
        if (!canInteractRef.current || !panelRef.current) return;
        const rect = panelRef.current.getBoundingClientRect();
        const scale = window.devicePixelRatio;
        const x = payload.position.x / scale;
        const y = payload.position.y / scale;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          dragActive = true;
          setIsDragActive(true);
        }
      } else if (payload.type === 'over') {
        if (!canInteractRef.current || !panelRef.current) {
          if (dragActive) { dragActive = false; setIsDragActive(false); }
          return;
        }
        const rect = panelRef.current.getBoundingClientRect();
        const scale = window.devicePixelRatio;
        const x = payload.position.x / scale;
        const y = payload.position.y / scale;
        const inPanel = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (inPanel !== dragActive) {
          dragActive = inPanel;
          setIsDragActive(inPanel);
        }
      } else if (payload.type === 'drop') {
        if (dragActive && canInteractRef.current && payload.paths.length > 0) {
          onDropFilesRef.current(payload.paths);
        }
        dragActive = false;
        setIsDragActive(false);
      } else if (payload.type === 'leave') {
        dragActive = false;
        setIsDragActive(false);
      }
    });

    return () => { unlistenPromise.then((fn) => fn()); };
  }, []);

  if (!selectedDevice) {
    return (
      <div className="flex-1 flex items-center justify-center bg-secondary/5">
        <div className="text-center text-muted-foreground/50 flex flex-col items-center gap-3">
          <MonitorSmartphone size={48} className="opacity-20" />
          <p className="text-sm">{t('transfer.selectDevice')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex-1 flex flex-col h-full bg-secondary/5 transition-colors duration-200",
        isDragActive && "bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.12),transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.02),rgba(34,197,94,0.08))]"
      )}
    >
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-none bg-[linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.12))]">
          <div className="absolute inset-0 border border-emerald-500/18 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.10),transparent_34%),linear-gradient(180deg,rgba(240,253,244,0.50),rgba(236,253,245,0.46)_46%,rgba(220,252,231,0.50))]" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(187,247,208,0.18),transparent_24%,transparent_76%,rgba(167,243,208,0.18))]" />
          <div className="relative flex h-full items-center justify-center px-10 py-12">
            <DotLottieReact
              src={uploadAnimationUrl}
              autoplay
              loop
              className="h-auto max-h-[58vh] w-[380px] max-w-[78%] select-none"
            />
          </div>
        </div>
      )}

      {/* 顶部标题栏 */}
      <div className="h-14 px-6 border-b border-border bg-background/50 backdrop-blur flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">{selectedDevice.name}</span>
          <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{selectedDevice.ipAddress}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              isReconnecting ? "text-amber-700 bg-amber-500/10" : "text-emerald-700 bg-emerald-500/10"
            )}
          >
            {isReconnecting ? t('transfer.statusReconnecting') : t('transfer.statusConnected')}
          </span>
        </div>
      </div>

      {isReconnecting && (
        <div className="shrink-0 border-b border-amber-500/15 bg-amber-500/6 px-6 py-3 text-xs text-amber-800">
          {t('transfer.reconnectingHint')}
        </div>
      )}

      {/* 消息流区域 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground mt-10">{t('transfer.emptyChat')}</div>
        ) : (
          messages.map((msg) => {
            if (msg.kind === 'system') {
              return (
                <div key={msg.id} className="flex justify-center my-4">
                  <span className="bg-secondary/50 text-muted-foreground text-[10px] px-3 py-1 rounded-full">{msg.content}</span>
                </div>
              );
            }

            const isOut = msg.direction === 'sent';
            const fileId = msg.fileId;
            const canPreview = Boolean(msg.savedPath && msg.status === 'completed' && !isOut);
            const showImagePreview = canPreview && isImageFile(msg.savedPath, msg.fileName);
            return (
              <div key={msg.id} className={cn("flex w-full", isOut ? "justify-end" : "justify-start")}>
                <div className={cn("flex flex-col max-w-[70%]", isOut ? "items-end" : "items-start")}>
                  <div className={cn(
                    "px-4 py-2.5 rounded-2xl shadow-sm text-[14px] leading-relaxed break-words whitespace-pre-wrap select-text",
                    isOut 
                      ? "bg-primary text-primary-foreground rounded-tr-sm" 
                      : "bg-background border border-border text-foreground rounded-tl-sm"
                  )}>
                    {msg.kind === 'text' ? (
                      msg.content
                    ) : (
                      // 文件卡片
                      <div className="flex flex-col gap-3 min-w-[200px]">
                        {showImagePreview && msg.savedPath && (
                          <button
                            type="button"
                            onClick={() => void onPreviewFile(msg.savedPath!)}
                            className="overflow-hidden rounded-xl border border-border bg-secondary/20"
                          >
                            <img
                              src={buildPreviewUrl(msg.savedPath)}
                              alt={msg.fileName ?? 'image'}
                              className="max-h-56 w-full object-cover"
                            />
                          </button>
                        )}

                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg shrink-0", isOut ? "bg-primary-foreground/20" : "bg-secondary")}>
                            <FileText size={20} className={isOut ? "text-primary-foreground" : "text-muted-foreground"} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-sm">{msg.fileName}</div>
                            <div className="text-xs opacity-70 mt-0.5">{formatFileSize(msg.fileSize)}</div>
                          </div>
                        </div>

                        {/* 极简进度条 */}
                        {msg.status !== 'pending_approval' && msg.status !== 'rejected' && (
                          <div className="w-full h-1 bg-black/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-current transition-all duration-300 opacity-50" 
                              style={{ width: `${Math.max(msg.progressPercent ?? 0, msg.status === 'completed' ? 100 : 0)}%` }} 
                            />
                          </div>
                        )}

                        {/* 大文件请求的 接受 / 拒绝 按钮 */}
                        {msg.status === 'pending_approval' && !isOut && fileId && (
                          <div className="flex gap-2 mt-1">
                            <button
                              onClick={() => void onRespondFileRequest(msg.deviceId, fileId, true)}
                              className="flex-1 bg-green-500 text-white rounded py-1.5 text-xs font-medium hover:bg-green-600 transition-colors"
                            >
                              {t('transfer.accept')}
                            </button>
                            <button
                              onClick={() => void onRespondFileRequest(msg.deviceId, fileId, false)}
                              className="flex-1 bg-white/20 text-current rounded py-1.5 text-xs font-medium hover:bg-white/30 transition-colors"
                            >
                              {t('transfer.reject')}
                            </button>
                          </div>
                        )}

                        {msg.status === 'rejected' && (
                          <div className="text-red-500/80 text-xs font-bold bg-red-500/10 px-2 py-1 rounded">{t('transfer.rejected')}</div>
                        )}

                        {canPreview && msg.savedPath && (
                          <div className="flex items-center gap-3 mt-1">
                            <button
                              onClick={() => void onPreviewFile(msg.savedPath!)}
                              className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100 hover:underline"
                            >
                              <Eye size={12} /> {t('transfer.preview')}
                            </button>
                            <button 
                              onClick={() => onOpenFolder(dirnameFromPath(msg.savedPath!))}
                              className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100 hover:underline"
                            >
                              <FolderOpen size={12} /> {t('transfer.openFolder')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 mx-1">{formatClock(msg.timestampMs)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部输入法区域 (IM 风格) */}
      <div className="h-40 border-t border-border bg-background flex flex-col shrink-0">
        {/* 工具栏 */}
        <div className="flex items-center gap-1 px-3 py-2">
          <button onClick={onAttachFile} disabled={!canInteract} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors disabled:opacity-50" title={t('transfer.attachFile')}>
            <Paperclip size={18} />
          </button>
        </div>
        {/* 文本输入区 */}
        <textarea
          className="flex-1 w-full resize-none bg-transparent outline-none px-4 py-1 text-sm text-foreground placeholder:text-muted-foreground/40 custom-scrollbar"
          placeholder={t('transfer.inputPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canInteract}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        {/* 发送按钮栏 */}
        <div className="flex justify-end px-4 py-2">
          <button 
            onClick={handleSend} 
            disabled={!canInteract || !draft.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all active:scale-95"
          >
            <Send size={14} /> {t('transfer.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
