import type { GitRef } from './patch_types';

const GIT_REF_PRIORITY: Record<GitRef['kind'], number> = {
  Head: 0,
  Branch: 1,
  DeletedBranch: 2,
  Tag: 3,
  Stash: 4,
  RemoteBranch: 5,
};

export function sortGitRefs(refs: GitRef[]) {
  return [...refs].sort((left, right) => {
    const priorityDelta = GIT_REF_PRIORITY[left.kind] - GIT_REF_PRIORITY[right.kind];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.name.localeCompare(right.name);
  });
}

export function getGitRefLabel(ref: GitRef) {
  return ref.kind === 'Head' ? 'HEAD' : ref.name;
}

export function getGitRefBadgeClass(kind: GitRef['kind']) {
  switch (kind) {
    case 'Head':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'Branch':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'DeletedBranch':
      return 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30 border-dashed';
    case 'Tag':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'Stash':
      return 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40 border-dashed';
    case 'RemoteBranch':
      return 'bg-secondary text-muted-foreground border-border/60';
    default:
      return 'bg-secondary text-muted-foreground border-border/60';
  }
}
