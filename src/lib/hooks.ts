import { useCallback } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

interface SmartContextMenuOptions {
  onPaste: (pastedText: string, textarea: HTMLTextAreaElement | null) => void;
}

/**
 * 一个可复用的 React Hook，用于为 textarea 提供智能右键菜单功能。
 * - 如果选中了文本，右键点击会【复制】选中的内容。
 * - 如果没有选中任何文本，右键点击会【粘贴】剪贴板的内容。
 * @param options 包含一个 onPaste 回调函数，用于处理粘贴逻辑。
 */
export function useSmartContextMenu({ onPaste }: SmartContextMenuOptions) {
  
  const handleContextMenu = useCallback(async (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const textarea = e.currentTarget;

    // 1. 复制逻辑
    const selection = window.getSelection()?.toString();
    if (selection && selection.length > 0) {
      await writeText(selection);
      return;
    }

    // 2. 粘贴逻辑
    try {
      const clipboardText = await readText();
      if (!clipboardText) return;
      
      // 将 textarea 引用传递给回调函数
      onPaste(clipboardText, textarea);

    } catch (err) {
      console.error("Paste operation failed:", err);
    }
  }, [onPaste]);

  return { onContextMenu: handleContextMenu };
}