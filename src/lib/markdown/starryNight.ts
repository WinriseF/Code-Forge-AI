import type { ReactNode } from 'react';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';

type StarryNightModule = typeof import('@wooorm/starry-night');
type StarryNightInstance = Awaited<ReturnType<StarryNightModule['createStarryNight']>>;
type HighlightTree = ReturnType<StarryNightInstance['highlight']>;

const HIGHLIGHT_CACHE_LIMIT = 200;
const languageAliases: Record<string, string> = {
  csharp: 'cs',
  docker: 'dockerfile',
  env: 'bash',
  plaintext: 'text',
  ps: 'powershell',
  ps1: 'powershell',
  shell: 'bash',
  shellscript: 'bash',
  text: 'txt',
  yml: 'yaml',
  zsh: 'bash',
};

let starryNightPromise: Promise<StarryNightInstance> | null = null;
const treeCache = new Map<string, HighlightTree | null>();

function getCacheKey(language: string, value: string): string {
  return `${language}\u0000${value}`;
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return languageAliases[normalized] || normalized;
}

function setCachedTree(cacheKey: string, tree: HighlightTree | null): HighlightTree | null {
  if (treeCache.has(cacheKey)) {
    treeCache.delete(cacheKey);
  }

  if (treeCache.size >= HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = treeCache.keys().next().value;
    if (oldestKey) {
      treeCache.delete(oldestKey);
    }
  }

  treeCache.set(cacheKey, tree);
  return tree;
}

function getCachedTree(cacheKey: string): HighlightTree | null | undefined {
  const cached = treeCache.get(cacheKey);
  if (cached === undefined) {
    return undefined;
  }

  treeCache.delete(cacheKey);
  treeCache.set(cacheKey, cached);
  return cached;
}

async function getStarryNight(): Promise<StarryNightInstance> {
  if (!starryNightPromise) {
    starryNightPromise = (async () => {
      const { common, createStarryNight } = await import('@wooorm/starry-night');
      return createStarryNight(common, {
        async getOnigurumaUrlFetch() {
          return new URL(onigWasmUrl, window.location.href);
        },
      });
    })();
  }

  return starryNightPromise;
}

function resolveScope(starryNight: StarryNightInstance, language: string): string | undefined {
  const normalized = normalizeLanguage(language);
  if (!normalized) {
    return undefined;
  }

  return (
    starryNight.flagToScope(normalized) ||
    starryNight.flagToScope(`.${normalized}`) ||
    starryNight.flagToScope(`file.${normalized}`)
  );
}

export function getCachedHighlightTree(language: string, value: string): HighlightTree | null | undefined {
  return getCachedTree(getCacheKey(language, value));
}

export async function highlightCodeTree(language: string, value: string): Promise<HighlightTree | null> {
  const cacheKey = getCacheKey(language, value);
  const cached = getCachedTree(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const starryNight = await getStarryNight();
  const scope = resolveScope(starryNight, language);

  if (!scope) {
    return setCachedTree(cacheKey, null);
  }

  return setCachedTree(cacheKey, starryNight.highlight(value, scope));
}

export function renderHighlightTree(tree: HighlightTree): ReactNode {
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
  }) as ReactNode;
}
