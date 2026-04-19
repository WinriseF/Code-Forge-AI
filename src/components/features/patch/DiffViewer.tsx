import { useEffect, useLayoutEffect, useRef } from 'react';
import { DiffEditor, DiffOnMount } from '@monaco-editor/react';
import { FileCode, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useTranslation } from 'react-i18next';
import { getMonacoLanguage } from '@/lib/langs';
import { ensureMonacoThemes, getMonacoTheme } from '@/lib/monaco';

interface DiffViewerProps {
  original: string;
  modified: string;
  fileName?: string;
  placeholder?: string;
}

export function DiffViewer({ original, modified, fileName = '', placeholder }: DiffViewerProps) {
  const theme = useAppStore((state) => state.theme);
  const { t } = useTranslation();
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  const monacoLanguage = getMonacoLanguage(fileName);

  const handleEditorDidMount: DiffOnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    ensureMonacoThemes(monaco);
    monaco.editor.setTheme(getMonacoTheme(theme));
  };

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(getMonacoTheme(theme));
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
      <div className="flex-1 relative group">
         <DiffEditor
            height="100%"
            language={monacoLanguage}
            original={original}
            modified={modified}
            onMount={handleEditorDidMount}
            theme={getMonacoTheme(theme)}
            loading={
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <Loader2 className="animate-spin" size={20} />
                    <span className="text-xs">{t('common.loadingDiff')}</span>
                </div>
            }
            options={{
                readOnly: true, 
                renderSideBySide: true,
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
