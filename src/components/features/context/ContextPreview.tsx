import { useState, useEffect } from 'react';
import { Copy, FileText, Loader2, AlertCircle } from 'lucide-react';
import { FileNode } from '@/types/context';
import { generateContext } from '@/lib/context_assembler';
import { writeText } from '@tauri-apps/api/clipboard';

interface ContextPreviewProps {
  fileTree: FileNode[];
}

export function ContextPreview({ fileTree }: ContextPreviewProps) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);

  // 当组件挂载或文件树变化时，生成预览内容
  useEffect(() => {
    let isMounted = true;
    
    const loadPreview = async () => {
      setIsLoading(true);
      try {
        // 这里不需要 Token 计算，只需要文本，所以解构出 text
        const { text } = await generateContext(fileTree);
        if (isMounted) setContent(text);
      } catch (err) {
        console.error("Preview generation failed", err);
        if (isMounted) setContent("Error generating preview.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    // 防抖：避免稍微勾选一下就疯狂重算
    const timer = setTimeout(loadPreview, 300);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [fileTree]);

  const handleCopy = async () => {
    await writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Loader2 size={24} className="animate-spin text-primary" />
        <p className="text-sm">Generating Preview...</p>
      </div>
    );
  }

  if (!content.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 opacity-60">
        <AlertCircle size={32} />
        <p>No files selected.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      {/* Preview Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-secondary/10 shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText size={16} className="text-primary" />
          <span>Content Preview</span>
          <span className="text-xs text-muted-foreground font-normal ml-2">
            ({content.length.toLocaleString()} characters)
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          {isCopied ? (
            <span className="text-green-500">Copied!</span>
          ) : (
            <>
              <Copy size={14} /> Copy
            </>
          )}
        </button>
      </div>

      {/* Code Area */}
      <div className="flex-1 overflow-hidden relative group">
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-muted-foreground font-medium">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}