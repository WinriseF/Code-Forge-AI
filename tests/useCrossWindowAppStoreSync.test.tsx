import React, { useEffect } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_SYNC_EVENT,
  PROJECT_ROOT_SYNC_EVENT,
  SEARCH_SETTINGS_SYNC_EVENT,
  SPOTLIGHT_APPEARANCE_SYNC_EVENT,
} from '@/lib/appStoreEvents';

const {
  listenMock,
  emitMock,
  listeners,
  unlistenFns,
  changeLanguageMock,
  useAppStoreSetStateMock,
  useAppStoreState,
  useContextStoreState,
} = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: any }) => void>();
  const unlistenFns: Array<ReturnType<typeof vi.fn>> = [];
  const appStoreState = {
    aiConfig: {
      providerId: 'openai',
      apiKey: '',
      baseUrl: '',
      modelId: 'gpt-4o-mini',
      temperature: 0.7,
    },
    savedProviderSettings: {
      openai: { apiKey: '', baseUrl: '', modelId: 'gpt-4o-mini', temperature: 0.7 },
    },
    projectRoot: '/repo',
    recentProjectRoots: ['/repo'],
    language: 'zh',
    searchSettings: { defaultEngine: 'google', customUrl: 'https://example.com?q=%s' },
    spotlightAppearance: { width: 640, defaultHeight: 400, maxChatHeight: 600 },
  };
  const contextState = {
    projectRoot: '/repo',
    setProjectRoot: vi.fn(async (path: string | null) => {
      contextState.projectRoot = path;
    }),
  };

  return {
    listeners,
    unlistenFns,
    emitMock: vi.fn(),
    listenMock: vi.fn(async (event: string, handler: (event: { payload: any }) => void) => {
      listeners.set(event, handler);
      const unlisten = vi.fn();
      unlistenFns.push(unlisten);
      return unlisten;
    }),
    useAppStoreState: appStoreState,
    useContextStoreState: contextState,
    useAppStoreSetStateMock: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(appStoreState, partial);
    }),
    changeLanguageMock: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
  emit: emitMock,
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: {
    getState: () => useAppStoreState,
    setState: useAppStoreSetStateMock,
  },
}));

vi.mock('@/store/useContextStore', () => ({
  useContextStore: {
    getState: () => useContextStoreState,
  },
}));

vi.mock('@/i18n/config', () => ({
  default: {
    changeLanguage: changeLanguageMock,
  },
}));

type UseCrossWindowAppStoreSync = typeof import('@/lib/hooks/useCrossWindowAppStoreSync')['useCrossWindowAppStoreSync'];
type BroadcastProjectRootSync = typeof import('@/lib/appStoreEvents')['broadcastProjectRootSync'];

let useCrossWindowAppStoreSyncFn: UseCrossWindowAppStoreSync | undefined;
let broadcastProjectRootSyncFn: BroadcastProjectRootSync | undefined;

async function importFreshHook(): Promise<UseCrossWindowAppStoreSync> {
  vi.resetModules();
  const events = await import('@/lib/appStoreEvents');
  broadcastProjectRootSyncFn = events.broadcastProjectRootSync;
  const mod = await import('@/lib/hooks/useCrossWindowAppStoreSync');
  return mod.useCrossWindowAppStoreSync;
}

function Harness() {
  useCrossWindowAppStoreSyncFn?.();
  return null;
}

describe('useCrossWindowAppStoreSync', () => {
  beforeEach(() => {
    listenMock.mockClear();
    emitMock.mockClear();
    useAppStoreSetStateMock.mockClear();
    changeLanguageMock.mockClear();
    listeners.clear();
    unlistenFns.length = 0;
    useContextStoreState.projectRoot = '/repo';
    useContextStoreState.setProjectRoot.mockClear();
    useCrossWindowAppStoreSyncFn = undefined;
    broadcastProjectRootSyncFn = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('syncs store changes from window events and disposes listeners', async () => {
    useCrossWindowAppStoreSyncFn = await importFreshHook();

    render(<Harness />);

    await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(4));

    listeners.get(PROJECT_ROOT_SYNC_EVENT)?.({
      payload: {
        projectRoot: '/repo',
        recentProjectRoots: ['/repo'],
      },
    });
    expect(useContextStoreState.setProjectRoot).not.toHaveBeenCalled();

    listeners.get(PROJECT_ROOT_SYNC_EVENT)?.({
      payload: {
        projectRoot: '/repo-next',
        recentProjectRoots: ['/repo-next', '/repo'],
      },
    });
    expect(useAppStoreSetStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/repo-next',
        recentProjectRoots: ['/repo-next', '/repo'],
      })
    );
    expect(useContextStoreState.setProjectRoot).toHaveBeenCalledWith('/repo-next');

    useAppStoreSetStateMock.mockClear();
    useContextStoreState.setProjectRoot.mockClear();
    broadcastProjectRootSyncFn?.({
      projectRoot: '/repo-local',
      recentProjectRoots: ['/repo-local', '/repo-next', '/repo'],
    });
    expect(useAppStoreSetStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/repo-local',
        recentProjectRoots: ['/repo-local', '/repo-next', '/repo'],
      })
    );
    expect(useContextStoreState.setProjectRoot).toHaveBeenCalledWith('/repo-local');
    expect(emitMock).toHaveBeenCalledWith('app-store:project-root-changed', {
      projectRoot: '/repo-local',
      recentProjectRoots: ['/repo-local', '/repo-next', '/repo'],
    });

    listeners.get(LANGUAGE_SYNC_EVENT)?.({
      payload: { language: 'zh' },
    });
    expect(changeLanguageMock).not.toHaveBeenCalled();

    listeners.get(LANGUAGE_SYNC_EVENT)?.({
      payload: { language: 'en' },
    });
    expect(useAppStoreSetStateMock).toHaveBeenCalledWith({ language: 'en' });
    expect(changeLanguageMock).toHaveBeenCalledWith('en');

    listeners.get(SEARCH_SETTINGS_SYNC_EVENT)?.({
      payload: {
        defaultEngine: 'google',
        customUrl: 'https://example.com?q=%s',
      },
    });
    expect(useAppStoreSetStateMock).not.toHaveBeenCalledWith({
      searchSettings: expect.anything(),
    });

    listeners.get(SEARCH_SETTINGS_SYNC_EVENT)?.({
      payload: {
        defaultEngine: 'bing',
        customUrl: 'https://bing.com/search?q=%s',
      },
    });
    expect(useAppStoreSetStateMock).toHaveBeenCalledWith({
      searchSettings: {
        defaultEngine: 'bing',
        customUrl: 'https://bing.com/search?q=%s',
      },
    });

    listeners.get(SPOTLIGHT_APPEARANCE_SYNC_EVENT)?.({
      payload: useAppStoreState.spotlightAppearance,
    });
    expect(useAppStoreSetStateMock).not.toHaveBeenCalledWith({
      spotlightAppearance: expect.anything(),
    });

    listeners.get(SPOTLIGHT_APPEARANCE_SYNC_EVENT)?.({
      payload: { width: 700, defaultHeight: 420, maxChatHeight: 650 },
    });
    expect(useAppStoreSetStateMock).toHaveBeenCalledWith({
      spotlightAppearance: { width: 700, defaultHeight: 420, maxChatHeight: 650 },
    });

    cleanup();
    await waitFor(() => {
      expect(unlistenFns).toHaveLength(4);
      expect(unlistenFns.every((fn) => fn.mock.calls.length === 1)).toBe(true);
    });
  });
});
