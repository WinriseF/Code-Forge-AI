import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeText as writeClipboard } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '@/store/useAppStore';
import { useGitGraphStore, GIT_PLUGIN_PREFIX } from '@/store/useGitGraphStore';
import { CommitGraphPanel } from './CommitGraphPanel';
import { DetailPanel } from './DetailPanel';
import { DiffWorkspace } from './DiffWorkspace';
import { ExportDialog } from './dialogs/ExportDialog';
import { Toast, ToastType } from '@/components/ui/Toast';
import { PatchFileItem, ExportFormat, ExportLayout } from './patch_types';
import { cn } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

export function PatchView() {
  const { t } = useTranslation();
  const projectRoot = useAppStore((state) => state.projectRoot);

  const selectedFilePath = useGitGraphStore((s) => s.selectedFilePath);
  const diffFiles = useGitGraphStore((s) => s.diffFiles);
  const showDiffPanel = useGitGraphStore((s) => s.showDiffPanel);
  const closeDiff = useGitGraphStore((s) => s.closeDiff);
  const diffOldHash = useGitGraphStore((s) => s.diffOldHash);
  const diffNewHash = useGitGraphStore((s) => s.diffNewHash);

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [toastState, setToastState] = useState<{ show: boolean; msg: string; type: ToastType }>({
    show: false,
    msg: '',
    type: 'success',
  });

  const showNotification = (msg: string, type: ToastType = 'success') => {
    setToastState({ show: true, msg, type });
  };

  // Find selected file for DiffWorkspace
  const selectedFile: PatchFileItem | null = selectedFilePath
    ? diffFiles.find((f) => f.path === selectedFilePath) ?? null
    : null;

  // Export handler
  const handleExportTrigger = () => {
    if (diffFiles.length === 0) {
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
        const selectedPaths = diffFiles
          .filter((f) => !f.isBinary && !f.isLarge)
          .map((f) => f.path);

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

  return (
    <div className="h-full flex overflow-hidden bg-background relative">
      {/* Left: Commit Graph */}
      <CommitGraphPanel projectRoot={projectRoot ?? undefined} />

      {/* Middle: Detail Panel */}
      <DetailPanel onExport={handleExportTrigger} projectRoot={projectRoot ?? undefined} />

      {/* Right: Diff Panel (slides in) */}
      <div
        className={cn(
          'shrink-0 overflow-hidden border-l border-border transition-all duration-300 ease-in-out',
          showDiffPanel && selectedFile ? 'w-[50%] opacity-100' : 'w-0 opacity-0 border-none',
        )}
      >
        {selectedFile && (
          <DiffWorkspace
            selectedFile={selectedFile}
            onSave={() => {}}
            onCopy={async (txt) => {
              await writeClipboard(txt);
              showNotification(t('patch.copied'), 'success');
            }}
            isReadOnly={true}
            isSidebarOpen={false}
            onToggleSidebar={closeDiff}
          />
        )}
      </div>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onConfirm={performExport}
        count={diffFiles.filter((f) => !f.isBinary && !f.isLarge).length}
      />

      {/* Toast */}
      <Toast
        message={toastState.msg}
        type={toastState.type}
        show={toastState.show}
        onDismiss={() => setToastState((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
}
