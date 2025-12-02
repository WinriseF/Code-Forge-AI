import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { writeText } from '@tauri-apps/api/clipboard';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  language: string;
  children: string;
  className?: string;
}

export function CodeBlock({ language, children, className }: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await writeText(children);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  // 简单的语言名称格式化
  const displayLang = language === 'typescript' || language === 'ts' ? 'TS' 
    : language === 'javascript' || language === 'js' ? 'JS'
    : language === 'bash' || language === 'sh' ? 'Terminal'
    : language;

  return (
    <div className={cn(
        "relative group rounded-lg overflow-hidden my-3 border border-border/40 bg-[#1e1e1e] shadow-sm", // 外层容器负责边框和背景底色
        className
    )}>
      {/* 滚动条样式注入 */}
      <style>{`
        .code-block-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
        .code-block-scroll::-webkit-scrollbar-track { background: transparent; }
        .code-block-scroll::-webkit-scrollbar-thumb { background-color: rgba(128, 128, 128, 0.2); border-radius: 3px; }
        .code-block-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(128, 128, 128, 0.4); }
        .code-block-scroll::-webkit-scrollbar-corner { background: transparent; }
      `}</style>

      {/* 顶部标题栏 (The "Wrapper" Header) */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5 select-none">
        
        {/* 左侧：语言标识 (小突起/Tab感) */}
        <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
            {/* 终端命令，显示个小图标 */}
            {(language === 'bash' || language === 'sh' || language === 'shell') && (
                <Terminal size={12} />
            )}
            <span className="text-[11px] font-mono font-medium uppercase tracking-wider text-muted-foreground/80">
                {displayLang}
            </span>
        </div>

        {/* 右侧：复制按钮 */}
        <button
            onClick={handleCopy}
            className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded transition-all duration-200",
                "text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/10",
                isCopied && "text-green-500 hover:text-green-500"
            )}
        >
            {isCopied ? (
                <>
                    <Check size={12} />
                    <span>Copied</span>
                </>
            ) : (
                <>
                    <Copy size={12} />
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">Copy</span>
                </>
            )}
        </button>
      </div>

      {/* 代码内容区域 */}
      <div className="relative">
        <SyntaxHighlighter
            style={vscDarkPlus}
            language={language}
            PreTag="div"
            className="code-block-scroll"
            customStyle={{
                margin: 0,
                padding: '1rem', 
                fontSize: '0.875rem',
                lineHeight: '1.6',
                background: 'transparent',
            }}
            codeTagProps={{
                style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }
            }}
        >
            {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}