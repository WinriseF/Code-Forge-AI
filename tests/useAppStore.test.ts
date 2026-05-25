import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  emitMock,
  invokeMock,
  fetchFromMirrorsMock,
  changeLanguageMock,
  storageMap,
} = vi.hoisted(() => ({
  emitMock: vi.fn(),
  invokeMock: vi.fn(),
  fetchFromMirrorsMock: vi.fn(),
  changeLanguageMock: vi.fn(),
  storageMap: new Map<string, string>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/lib/network', () => ({
  fetchFromMirrors: fetchFromMirrorsMock,
  MODEL_MIRROR_BASES: ['https://mirror.local'],
}));

vi.mock('@/i18n/config', () => ({
  default: {
    changeLanguage: changeLanguageMock,
  },
}));

vi.mock('@/lib/storage', () => ({
  fileStorage: {
    getItem: vi.fn(async (name: string) => storageMap.get(name) ?? null),
    setItem: vi.fn(async (name: string, value: string) => {
      storageMap.set(name, value);
    }),
    removeItem: vi.fn(async (name: string) => {
      storageMap.delete(name);
    }),
  },
}));

type AppStore = typeof import('@/store/useAppStore')['useAppStore'];

async function importFreshAppStore(): Promise<AppStore> {
  vi.resetModules();
  const mod = await import('@/store/useAppStore');
  return mod.useAppStore;
}

describe('useAppStore', () => {
  beforeEach(() => {
    emitMock.mockReset();
    invokeMock.mockReset();
    fetchFromMirrorsMock.mockReset();
    changeLanguageMock.mockReset();
    storageMap.clear();
    emitMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(undefined);
  });

  it('updates theme and emits theme-changed by default', async () => {
    const useAppStore = await importFreshAppStore();

    useAppStore.getState().setTheme('light');
    await Promise.resolve();

    expect(useAppStore.getState().theme).toBe('light');
    expect(emitMock).toHaveBeenCalledWith('theme-changed', 'light');
  });

  it('updates theme without emit when skipEmit is true', async () => {
    const useAppStore = await importFreshAppStore();

    useAppStore.getState().setTheme('black', true);
    await Promise.resolve();

    expect(useAppStore.getState().theme).toBe('black');
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('setProjectRoot normalizes path, keeps latest 5 roots, and broadcasts once', async () => {
    const useAppStore = await importFreshAppStore();

    useAppStore.getState().setProjectRoot('  /a  ');
    useAppStore.getState().setProjectRoot('/b');
    useAppStore.getState().setProjectRoot('/c');
    useAppStore.getState().setProjectRoot('/d');
    useAppStore.getState().setProjectRoot('/e');
    useAppStore.getState().setProjectRoot('/f');
    useAppStore.getState().setProjectRoot('/d');
    await Promise.resolve();

    const state = useAppStore.getState();
    expect(state.projectRoot).toBe('/d');
    expect(state.recentProjectRoots).toEqual(['/d', '/f', '/e', '/c', '/b']);
    expect(invokeMock).toHaveBeenLastCalledWith(
      'plugin:ctxrun-plugin-tool-runtime|agent_set_workspace_root',
      { rootDir: '/d' }
    );
    expect(emitMock).toHaveBeenLastCalledWith('app-store:project-root-changed', {
      projectRoot: '/d',
      recentProjectRoots: ['/d', '/f', '/e', '/c', '/b'],
    });
  });

  it('clearProjectRoot clears current root, keeps recent history, and broadcasts null', async () => {
    const useAppStore = await importFreshAppStore();

    useAppStore.getState().setProjectRoot('/workspace-a');
    useAppStore.getState().setProjectRoot('/workspace-b');
    useAppStore.getState().clearProjectRoot();
    await Promise.resolve();

    const state = useAppStore.getState();
    expect(state.projectRoot).toBeNull();
    expect(state.recentProjectRoots).toEqual(['/workspace-b', '/workspace-a']);
    expect(invokeMock).toHaveBeenLastCalledWith(
      'plugin:ctxrun-plugin-tool-runtime|agent_set_workspace_root',
      { rootDir: null }
    );
    expect(emitMock).toHaveBeenLastCalledWith('app-store:project-root-changed', {
      projectRoot: null,
      recentProjectRoots: ['/workspace-b', '/workspace-a'],
    });
  });

  it('updates language and global ignore lists with add/duplicate/remove paths', async () => {
    const useAppStore = await importFreshAppStore();

    useAppStore.getState().setLanguage('en');
    useAppStore.getState().updateGlobalIgnore('extensions', 'add', 'tmp');
    useAppStore.getState().updateGlobalIgnore('extensions', 'add', 'tmp');
    useAppStore.getState().updateGlobalIgnore('extensions', 'remove', 'tmp');

    expect(useAppStore.getState().language).toBe('en');
    expect(changeLanguageMock).toHaveBeenCalledWith('en');
    expect(useAppStore.getState().globalIgnore.extensions.includes('tmp')).toBe(false);
  });

  it('syncModels updates state on success and logs on failure', async () => {
    const useAppStore = await importFreshAppStore();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchFromMirrorsMock.mockResolvedValueOnce({
      data: [
        {
          id: 'model-1',
          name: 'Model 1',
          provider: 'Other',
          contextLimit: 1000,
          inputPricePerMillion: 1,
          color: 'bg-gray-500',
        },
      ],
      sourceUrl: 'https://mirror.local/',
    });

    await useAppStore.getState().syncModels();
    expect(useAppStore.getState().models).toEqual([
      {
        id: 'model-1',
        name: 'Model 1',
        provider: 'Other',
        contextLimit: 1000,
        inputPricePerMillion: 1,
        color: 'bg-gray-500',
      },
    ]);
    expect(useAppStore.getState().lastUpdated).toBe(1700000000000);

    fetchFromMirrorsMock.mockRejectedValueOnce(new Error('mirror failed'));
    await useAppStore.getState().syncModels();
    expect(errorSpy).toHaveBeenCalledWith(
      '[AppStore] Failed to sync models from mirrors:',
      expect.any(Error)
    );

    const { DEFAULT_MODELS } = await import('@/store/useAppStore');
    useAppStore.getState().resetModels();
    expect(useAppStore.getState().models).toEqual(DEFAULT_MODELS);

    nowSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('merges search, refinery, spotlight appearance, guard, and window settings', async () => {
    const useAppStore = await importFreshAppStore();

    useAppStore.getState().setProjectRoot('/workspace-a');
    useAppStore.getState().setSearchSettings({ defaultEngine: 'bing' });
    useAppStore.getState().setRefinerySettings({ strategy: 'both', maxCount: 1234 });
    useAppStore.getState().setSpotlightAppearance({ width: 700 });
    useAppStore.getState().setGuardSettings({ idleTimeoutSecs: 5, preventSleep: false, keepDisplayOn: true });
    useAppStore.getState().setWindowDestroyDelay(120);
    useAppStore.getState().setLanguage('en');
    await Promise.resolve();

    const state = useAppStore.getState();
    expect(state.projectRoot).toBe('/workspace-a');
    expect(state.searchSettings.defaultEngine).toBe('bing');
    expect(state.refinerySettings.strategy).toBe('both');
    expect(state.refinerySettings.maxCount).toBe(1234);
    expect(state.spotlightAppearance.width).toBe(700);
    expect(state.guardSettings.idleTimeoutSecs).toBe(15);
    expect(state.guardSettings.preventSleep).toBe(false);
    expect(state.guardSettings.keepDisplayOn).toBe(false);
    expect(state.windowDestroyDelay).toBe(120);
    expect(state.language).toBe('en');

    expect(emitMock).toHaveBeenCalledWith('app-store:search-settings-changed', {
      defaultEngine: 'bing',
      customUrl: 'https://search.bilibili.com/all?keyword=%s',
    });
    expect(emitMock).toHaveBeenCalledWith('app-store:spotlight-appearance-changed', {
      width: 700,
      defaultHeight: 400,
      maxChatHeight: 600,
    });
    expect(emitMock).toHaveBeenCalledWith('app-store:language-changed', {
      language: 'en',
    });
  });
});
