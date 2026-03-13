import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DiffEditor, DiffOnMount } from '@monaco-editor/react';
import { Columns, Rows, FileCode, Loader2, Search } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getMonacoLanguage } from '@/lib/langs';

interface DiffViewerProps {
  original: string;
  modified: string;
  fileName?: string;
  placeholder?: string;
}

export function DiffViewer({ original, modified, fileName = '', placeholder }: DiffViewerProps) {
  const { theme } = useAppStore();
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const { t } = useTranslation();
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  const monacoLanguage = getMonacoLanguage(fileName);

  const handleEditorDidMount: DiffOnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme('codeforge-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#161b2e',
        'editor.lineHighlightBackground': '#1e2540',
        'scrollbarSlider.background': '#2d3555',
        'scrollbarSlider.hoverBackground': '#3a4368',
        'editor.selectionBackground': '#0078d440',
        'editorGutter.background': '#161b2e',
        'diffEditor.insertedTextBackground': '#22c55e15',
        'diffEditor.removedTextBackground': '#ef444415',
        'diffEditor.diagonalFill': '#2d355540',
        'editorWidget.background': '#1a2038',
        'editorWidget.border': '#2d3555',
      }
    });

    monaco.editor.defineTheme('codeforge-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#fbfaf5',
        'editor.lineHighlightBackground': '#f2f0ea',
        'scrollbarSlider.background': '#c8c4bc50',
        'editor.selectionBackground': '#d8f0fa70',
        'editorGutter.background': '#fbfaf5',
        'diffEditor.insertedTextBackground': '#d8f0fa25',
        'diffEditor.removedTextBackground': '#f5d0cc25',
      }
    });

    // 修复：只要不是 light 模式，都使用深色主题
    const targetTheme = theme === 'light' ? 'codeforge-light' : 'codeforge-dark';
    monaco.editor.setTheme(targetTheme);
  };

  useEffect(() => {
    if (monacoRef.current) {
      // 修复：只要不是 light 模式，都使用深色主题
      const targetTheme = theme === 'light' ? 'codeforge-light' : 'codeforge-dark';
      monacoRef.current.editor.setTheme(targetTheme);
    }
  }, [theme]);

  useLayoutEffect(() => {
    return () => {
      const editor = editorRef.current;
      const model = editor?.getModel?.();

      if (!editor || !model) {
        return;
      }

      try {
        editor.setModel(null);
      } catch (error) {
        console.warn('Failed to detach diff editor model before unmount:', error);
      }

      try {
        model.original?.dispose?.();
        model.modified?.dispose?.();
      } catch (error) {
        console.warn('Failed to dispose diff editor models during unmount:', error);
      }
    };
  }, []);

  if (!modified && !original) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 gap-3 bg-background animate-in fade-in duration-300">
        <div className="p-4 bg-secondary/30 rounded-full">
            <FileCode size={48} className="opacity-20" />
        </div>
        <p className="text-xs font-medium">{placeholder || "Select a file to compare"}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <style>{`
        .monaco-editor .find-widget {
          top: -35px !important;
          right: 18px !important;
          border-radius: 6px !important;
          box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
          border: 1px solid var(--border) !important;
          transition: top 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
          visibility: visible;
        }

        .monaco-editor .find-widget.visible {
          top: 18px !important;
        }

        .monaco-editor .find-widget.hidden {
          top: -60px !important;
          visibility: hidden;
        }
      `}</style>

      <div className="flex items-center justify-between px-6 py-2 border-b border-border/50 bg-secondary/5 shrink-0 h-12">
         <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <FileCode size={14} className="text-primary" />
            <span className="opacity-80">{fileName || 'Unsaved Draft'}</span>
            <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-mono">
                {monacoLanguage}
            </span>
         </div>

         <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => editorRef.current?.trigger('source', 'actions.find')}
              className="flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/30 px-3 py-1.5 text-[10px] font-medium text-muted-foreground transition-all hover:text-foreground"
            >
              <Search size={12} />
              {t('common.search')}
            </button>

            <div className="flex bg-secondary/30 rounded-lg p-0.5 border border-border/50">
             <button 
               onClick={() => setRenderSideBySide(true)}
               className={cn(
                   "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium transition-all",
                  renderSideBySide ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
                <Columns size={12} /> Split
            </button>
            <button 
              onClick={() => setRenderSideBySide(false)}
              className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium transition-all",
                  !renderSideBySide ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
                <Rows size={12} /> Unified
             </button>
            </div>
         </div>
      </div>

      <div className="flex-1 relative group">
         <DiffEditor
            height="100%"
            language={monacoLanguage}
            original={original}
            modified={modified}
            onMount={handleEditorDidMount}
            loading={
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <Loader2 className="animate-spin" size={20} />
                    <span className="text-xs">{t('common.loadingDiff')}</span>
                </div>
            }
            options={{
                readOnly: true, 
                renderSideBySide: renderSideBySide,
                minimap: { enabled: true, scale: 0.75, renderCharacters: false }, 
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
                lineHeight: 1.6,
                padding: { top: 16, bottom: 16 },
                automaticLayout: true, 
                diffWordWrap: 'off',
                wordWrap: 'on', 
                ignoreTrimWhitespace: false,
                renderLineHighlight: 'none',
                matchBrackets: 'never',
                folding: false,
            }}
         />
      </div>
    </div>
  );
}
