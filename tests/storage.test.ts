import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readTextFileMock,
  writeTextFileMock,
  mkdirMock,
  existsMock,
  readDirMock,
  removeMock,
  renameMock,
  copyFileMock,
} = vi.hoisted(() => ({
  readTextFileMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  existsMock: vi.fn(),
  readDirMock: vi.fn(),
  removeMock: vi.fn(),
  renameMock: vi.fn(),
  copyFileMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: readTextFileMock,
  writeTextFile: writeTextFileMock,
  mkdir: mkdirMock,
  exists: existsMock,
  readDir: readDirMock,
  remove: removeMock,
  rename: renameMock,
  copyFile: copyFileMock,
  BaseDirectory: { AppLocalData: 'AppLocalData' },
}));

type FileStorage = typeof import('@/lib/storage')['fileStorage'];

async function importFreshStorage(): Promise<FileStorage> {
  vi.resetModules();
  const mod = await import('@/lib/storage');
  return mod.fileStorage;
}

describe('fileStorage', () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    mkdirMock.mockReset();
    existsMock.mockReset();
    readDirMock.mockReset();
    removeMock.mockReset();
    renameMock.mockReset();
    copyFileMock.mockReset();
  });

  it('getItem returns null when file does not exist', async () => {
    existsMock.mockResolvedValue(false);
    const fileStorage = await importFreshStorage();

    const result = await fileStorage.getItem('app-config');
    expect(result).toBeNull();
    expect(readTextFileMock).not.toHaveBeenCalled();
  });

  it('setItem writes to a temp file and renames it into place', async () => {
    existsMock.mockResolvedValue(false);
    writeTextFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    const fileStorage = await importFreshStorage();

    await fileStorage.setItem('app-config', '{"theme":"dark"}');

    const tempPath = writeTextFileMock.mock.calls[0]?.[0];
    expect(tempPath).toMatch(/^app-config\.json\.[a-z0-9-]+\.tmp$/);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      tempPath,
      '{"theme":"dark"}',
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
    expect(renameMock).toHaveBeenCalledWith(
      tempPath,
      'app-config.json',
      expect.objectContaining({
        oldPathBaseDir: 'AppLocalData',
        newPathBaseDir: 'AppLocalData',
      })
    );
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it('setItem keeps a backup when overwriting an existing file', async () => {
    existsMock.mockResolvedValue(true);
    writeTextFileMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    const fileStorage = await importFreshStorage();

    await fileStorage.setItem('app-config', '{"theme":"light"}');

    expect(copyFileMock).toHaveBeenCalledWith(
      'app-config.json',
      'app-config.json.bak',
      expect.objectContaining({
        fromPathBaseDir: 'AppLocalData',
        toPathBaseDir: 'AppLocalData',
      })
    );
  });

  it('removeItem removes existing primary and related files', async () => {
    existsMock.mockImplementation(async (path: string) =>
      path === 'app-config.json' ||
      path === 'app-config.json.bak' ||
      /^app-config\.json\.[a-z0-9-]+\.tmp$/.test(path)
    );
    removeMock.mockResolvedValue(undefined);
    const fileStorage = await importFreshStorage();

    await fileStorage.removeItem('app-config');
    await fileStorage.removeItem('missing');

    expect(removeMock).toHaveBeenCalledTimes(3);
    expect(removeMock).toHaveBeenCalledWith(
      'app-config.json',
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
    expect(removeMock).toHaveBeenCalledWith(
      'app-config.json.bak',
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
    expect(removeMock).toHaveBeenCalledWith(
      expect.stringMatching(/^app-config\.json\.[a-z0-9-]+\.tmp$/),
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
  });

  it('removeItem ignores files that disappear between exists and remove', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    existsMock.mockResolvedValue(true);
    removeMock.mockRejectedValue(new Error('not found'));
    const fileStorage = await importFreshStorage();

    await fileStorage.removeItem('app-config');

    expect(removeMock).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('packs listInstalled filters only json files', async () => {
    existsMock.mockResolvedValue(true);
    readDirMock.mockResolvedValue([
      { name: 'a.json' },
      { name: 'b.txt' },
      { name: undefined },
      { name: 'c.json' },
    ]);
    const fileStorage = await importFreshStorage();

    const files = await fileStorage.packs.listInstalled();
    expect(files).toEqual(['a.json', 'c.json']);
  });

  it('packs save/read/remove use packs subdir paths', async () => {
    existsMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    writeTextFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    readTextFileMock.mockResolvedValue('{"name":"Pack"}');
    removeMock.mockResolvedValue(undefined);
    const fileStorage = await importFreshStorage();

    await fileStorage.packs.savePack('demo.json', '{"name":"Pack"}');
    const content = await fileStorage.packs.readPack('demo.json');
    await fileStorage.packs.removePack('demo.json');

    const tempPath = writeTextFileMock.mock.calls[0]?.[0];
    expect(tempPath).toMatch(/^packs\/demo\.json\.[a-z0-9-]+\.tmp$/);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      tempPath,
      '{"name":"Pack"}',
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
    expect(content).toBe('{"name":"Pack"}');
    expect(removeMock).toHaveBeenCalledWith(
      'packs/demo.json',
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
  });

  it('getItem falls back to backup when primary content is corrupted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    existsMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    readTextFileMock
      .mockResolvedValueOnce('{invalid')
      .mockResolvedValueOnce('{"theme":"backup"}');
    writeTextFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    const fileStorage = await importFreshStorage();

    const result = await fileStorage.getItem('app-config');

    const tempPath = writeTextFileMock.mock.calls[0]?.[0];
    expect(tempPath).toMatch(/^app-config\.json\.[a-z0-9-]+\.tmp$/);
    expect(result).toBe('{"theme":"backup"}');
    expect(writeTextFileMock).toHaveBeenCalledWith(
      tempPath,
      '{"theme":"backup"}',
      expect.objectContaining({ baseDir: 'AppLocalData' })
    );
    expect(renameMock).toHaveBeenCalledWith(
      tempPath,
      'app-config.json',
      expect.objectContaining({
        oldPathBaseDir: 'AppLocalData',
        newPathBaseDir: 'AppLocalData',
      })
    );
    errorSpy.mockRestore();
  });
});
