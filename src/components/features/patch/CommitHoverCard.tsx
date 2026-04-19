import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, GitCommit, Tag, User } from 'lucide-react';
import { GitRefBadges } from './GitRefBadges';
import type { GraphCommit } from './patch_types';

interface CommitHoverCardProps {
  anchorRect: DOMRect | null;
  commit: GraphCommit | null;
  isOpen: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function CommitHoverCard({
  anchorRect,
  commit,
  isOpen,
  onMouseEnter,
  onMouseLeave,
}: CommitHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRect || !cardRef.current) {
      setIsPositioned(false);
      return;
    }

    const cardRect = cardRef.current.getBoundingClientRect();
    const padding = 12;

    let left = anchorRect.right + padding;
    let top = anchorRect.top - 6;

    if (left + cardRect.width > window.innerWidth - padding) {
      left = anchorRect.left - cardRect.width - padding;
    }
    if (top + cardRect.height > window.innerHeight - padding) {
      top = window.innerHeight - cardRect.height - padding;
    }
    if (top < padding) {
      top = padding;
    }

    setPosition({ top, left });
    setIsPositioned(true);
  }, [anchorRect, isOpen, commit]);

  if (!isOpen || !anchorRect || !commit) {
    return null;
  }

  return createPortal(
    <div
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`fixed z-[120] w-[320px] transition-opacity duration-150 ${
        isPositioned ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{ top: position.top, left: position.left }}
    >
      <div className="rounded-xl border border-border/70 bg-popover shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60 bg-secondary/10">
          <h3 className="text-sm font-semibold leading-snug break-words">{commit.message}</h3>
          <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
            <span className="font-mono text-green-500">{commit.short_hash}</span>
            <span>&middot;</span>
            <span>{commit.date}</span>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <User size={12} />
            <span>{commit.author}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar size={12} />
            <span>{commit.date}</span>
          </div>
          {commit.refs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Tag size={12} />
                <span>Refs</span>
              </div>
              <GitRefBadges refs={commit.refs} />
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <GitCommit size={12} />
            <span>{commit.parent_hashes.length} parent{commit.parent_hashes.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
