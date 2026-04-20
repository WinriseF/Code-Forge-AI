import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Factory,
  FileJson,
  GitMerge,
  Globe,
  MousePointerClick,
} from 'lucide-react';

export const PRIMARY_APP_VIEWS = [
  'prompts',
  'context',
  'patch',
  'refinery',
  'automator',
  'miner',
] as const;

export type PrimaryAppView = (typeof PRIMARY_APP_VIEWS)[number];

interface AppNavigationItem {
  id: PrimaryAppView;
  icon: LucideIcon;
  accentClass: string;
  accentColor: string;
}

export const APP_NAVIGATION_ITEMS: AppNavigationItem[] = [
  { id: 'prompts', icon: BookOpen, accentClass: 'text-pink-400', accentColor: '#f472b6' },
  { id: 'context', icon: FileJson, accentClass: 'text-sky-400', accentColor: '#38bdf8' },
  { id: 'patch', icon: GitMerge, accentClass: 'text-indigo-400', accentColor: '#818cf8' },
  { id: 'refinery', icon: Factory, accentClass: 'text-emerald-400', accentColor: '#34d399' },
  { id: 'automator', icon: MousePointerClick, accentClass: 'text-orange-400', accentColor: '#fb923c' },
  { id: 'miner', icon: Globe, accentClass: 'text-yellow-400', accentColor: '#facc15' },
];

export function isPrimaryAppView(view: string): view is PrimaryAppView {
  return PRIMARY_APP_VIEWS.includes(view as PrimaryAppView);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  );
}
