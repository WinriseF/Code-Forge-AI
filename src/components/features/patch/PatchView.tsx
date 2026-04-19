import { useState, useRef, useEffect } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeText as writeClipboard } from '@tauri-apps/plugin-clipboard-manager';
import { motion, useMotionValue, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { useGitGraphStore, GIT_PLUGIN_PREFIX } from '@/store/useGitGraphStore';
import { CommitGraphPanel } from './CommitGraphPanel';
import { DetailPanel } from './DetailPanel';
import { DiffWorkspace } from './DiffWorkspace';
import { ExportDialog } from './dialogs/ExportDialog';
import { Toast, ToastType } from '@/components/ui/Toast';
import { PatchFileItem, ExportFormat, ExportLayout } from './patch_types';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

const MIN_GIT = 200;
const MAX_GIT = 460;
const DEFAULT_GIT = 300;

export function PatchView() {
  const { t } = useTranslation();
  const projectRoot = useAppStore((state) => state.projectRoot);

  const selectedFilePath = useGitGraphStore((s) => s.selectedFilePath);
  const diffFiles = useGitGraphStore((s) => s.diffFiles);
  const showDiffPanel = useGitGraphStore((s) => s.showDiffPanel);
  const closeDiff = useGitGraphStore((s) => s.closeDiff);
  const diffOldHash = useGitGraphStore((s) => s.diffOldHash);
  const diffNewHash = useGitGraphStore((s) => s.diffNewHash);
  const selectedExportPaths = useGitGraphStore((s) => s.selectedExportPaths);

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [toastState, setToastState] = useState<{ show: boolean; msg: string; type: ToastType }>({
    show: false,
    msg: '',
    type: 'success',
  });

  const gitWidth = useMotionValue(DEFAULT_GIT);
  const containerRef = useRef<HTMLDivElement>(null);
  const gitDragRef = useRef(false);

  // Drag handler
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current || !gitDragRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      gitWidth.set(Math.max(MIN_GIT, Math.min(e.clientX - rect.left, MAX_GIT)));
    };
    const onUp = () => {
      if (gitDragRef.current) {
        gitDragRef.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [gitWidth]);

  const startGitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    gitDragRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const showNotification = (msg: string, type: ToastType = 'success') => {
    setToastState({ show: true, msg, type });
  };

  const selectedFile: PatchFileItem | null = selectedFilePath
    ? diffFiles.find((f) => f.path === selectedFilePath) ?? null
    : null;

  const handleExportTrigger = () => {
    if (selectedExportPaths.size === 0) {
      showNotification(t('patch.selectOne'), 'warning');
      return;
    }
    setIsExportDialogOpen(true);
  };

  const performExport = async (format: ExportFormat, layout: ExportLayout) => {
    setIsExportDialogOpen(false);
    if (!projectRoot || !diffOldHash || !diffNewHash) return;

    try {
      const extMap: Record<ExportFormat, string> = {
        Markdown: 'md',
        Json: 'json',
        Xml: 'xml',
        Txt: 'txt',
      };

      const filePath = await save({
        title: `Export ${layout} Diff as ${format}`,
        defaultPath: `diff_${diffOldHash.slice(0, 7)}_${diffNewHash.slice(0, 7)}.${extMap[format]}`,
        filters: [{ name: format, extensions: [extMap[format]] }],
      });

      if (filePath) {
        const selectedPaths = Array.from(selectedExportPaths);
        await invoke(`${GIT_PLUGIN_PREFIX}export_git_diff`, {
          projectPath: projectRoot,
          oldHash: diffOldHash,
          newHash: diffNewHash,
          format,
          layout,
          savePath: filePath,
          selectedPaths,
        });
        showNotification(t('patch.exportSuccess'), 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(t('common.exportFailed', { msg }), 'error');
    }
  };

  // ESC to close diff popup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showDiffPanel) {
        e.preventDefault();
        e.stopPropagation();
        closeDiff();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showDiffPanel, closeDiff]);

  return (
    <div ref={containerRef} className="h-full flex overflow-hidden bg-background relative">
      {/* Git panel */}
      <motion.div
        className="shrink-0 overflow-hidden border-r border-border"
        style={{ width: gitWidth }}
      >
        <CommitGraphPanel projectRoot={projectRoot ?? undefined} />
      </motion.div>
      <div
        onMouseDown={startGitDrag}
        className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 active:bg-primary z-10"
      />

      {/* Detail panel */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <DetailPanel onExport={handleExportTrigger} />
      </div>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onConfirm={performExport}
        count={selectedExportPaths.size}
      />

      {/* Toast */}
      <Toast
        message={toastState.msg}
        type={toastState.type}
        show={toastState.show}
        onDismiss={() => setToastState((prev) => ({ ...prev, show: false }))}
      />

      {/* Diff popup overlay */}
      <AnimatePresence>
        {showDiffPanel && selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={closeDiff}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-[90vw] h-[85vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <DiffWorkspace
                  selectedFile={selectedFile}
                  onCopy={async (txt) => {
                    await writeClipboard(txt);
                    showNotification(t('patch.copied'), 'success');
                  }}
                />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
