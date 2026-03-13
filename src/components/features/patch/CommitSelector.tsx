import { useState, useMemo, useRef, useEffect } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { GitCommit } from '@/types/git';

interface CommitSelectorProps {
  commits: GitCommit[];
  selectedValue: string;
  onSelect: (hash: string) => void;
  disabled?: boolean;
}

export function CommitSelector({ commits, selectedValue, onSelect, disabled }: CommitSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const selectedCommit = useMemo(() => 
    commits.find(c => c.hash === selectedValue),
    [commits, selectedValue]
  );

  const filteredCommits = useMemo(() =>
    search.trim() === ''
      ? commits
      : commits.filter(c =>
          c.message.toLowerCase().includes(search.toLowerCase()) ||
          c.hash.toLowerCase().startsWith(search.toLowerCase()) ||
          c.author.toLowerCase().includes(search.toLowerCase())
        ),
    [commits, search]
  );
  
  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);


  const handleSelect = (hash: string) => {
    onSelect(hash);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 text-left text-xs bg-secondary/50 border border-border/50 rounded-md outline-none transition-all",
          "hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed",
          isOpen && "ring-1 ring-primary/50 border-primary/50"
        )}
      >
        {selectedCommit ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="truncate font-medium text-foreground">{selectedCommit.message}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatCommitMeta(selectedCommit)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">{t('patch.commitSelectPlaceholder')}</span>
        )}
        <ChevronsUpDown size={14} className="ml-2 text-muted-foreground shrink-0" />
      </button>

      {isOpen && (
        <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1.5 w-full bg-popover border border-border rounded-lg shadow-xl z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('patch.commitSearchPlaceholder')}
                className="w-full bg-background border border-border/50 rounded-md pl-8 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
            {filteredCommits.map(commit => (
              <button
                key={commit.hash}
                onClick={() => handleSelect(commit.hash)}
                className={cn(
                  "w-full text-left p-2 rounded-md transition-colors flex items-start justify-between gap-2",
                  "hover:bg-secondary",
                  selectedValue === commit.hash && "bg-primary/10"
                )}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className={cn("text-xs truncate", selectedValue === commit.hash ? "text-primary font-bold" : "text-foreground font-medium")}>
                    {commit.message}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{formatCommitMeta(commit)}</span>
                </div>
                {selectedValue === commit.hash && <Check size={14} className="text-primary mt-0.5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCommitMeta(commit: GitCommit) {
  if (commit.hash.startsWith('__')) {
    return `${commit.author}, ${commit.date}`;
  }

  return `${commit.hash.slice(0, 7)} - ${commit.author}, ${commit.date}`;
}
