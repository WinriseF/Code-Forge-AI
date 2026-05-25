import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  readDir,
  remove,
  rename,
  copyFile,
  BaseDirectory
} from '@tauri-apps/plugin-fs';

import { isReadOnlyStorageWindow } from '@/lib/windowContext';

const BASE_DIR_OPT = { baseDir: BaseDirectory.AppLocalData };
const PACKS_SUBDIR = 'packs';
const TEMP_SUFFIX = '.tmp';
const BACKUP_SUFFIX = '.bak';
const WRITE_SESSION_TAG = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const writeQueues = new Map<string, Promise<void>>();

function logStorageError(action: string, fileName: string, err: unknown) {
  console.error(`[fileStorage] Failed to ${action} '${fileName}':`, err);
}

async function hasFile(path: string): Promise<boolean> {
  try {
    return await exists(path, BASE_DIR_OPT);
  } catch {
    return false;
  }
}

function isValidJsonContent(content: string): boolean {
  if (!content.trim()) {
    return false;
  }

  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function isMissingFileError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('not found') ||
    normalized.includes('no such file') ||
    normalized.includes('missing') ||
    normalized.includes('cannot find')
  );
}

function buildTempFileName(fileName: string): string {
  // Multiple windows persist the same stores concurrently, so a shared temp name
  // causes one window to rename away the other's temp file on Windows.
  return `${fileName}.${WRITE_SESSION_TAG}${TEMP_SUFFIX}`;
}

function buildLegacyTempFileName(fileName: string): string {
  return `${fileName}${TEMP_SUFFIX}`;
}

async function readValidatedJsonFile(fileName: string): Promise<string | null> {
  if (!(await hasFile(fileName))) {
    return null;
  }

  try {
    const content = await readTextFile(fileName, BASE_DIR_OPT);
    if (!isValidJsonContent(content)) {
      logStorageError('parse', fileName, new Error('Invalid JSON content'));
      return null;
    }
    return content;
  } catch (err) {
    logStorageError('read', fileName, err);
    return null;
  }
}

async function atomicWriteTextFile(
  fileName: string,
  value: string,
  options?: { skipBackupCopy?: boolean }
): Promise<void> {
  const tempFileName = buildTempFileName(fileName);
  const backupFileName = `${fileName}${BACKUP_SUFFIX}`;

  try {
    await writeTextFile(tempFileName, value, BASE_DIR_OPT);

    if (!options?.skipBackupCopy && (await hasFile(fileName))) {
      await copyFile(fileName, backupFileName, {
        fromPathBaseDir: BaseDirectory.AppLocalData,
        toPathBaseDir: BaseDirectory.AppLocalData,
      });
    }

    await rename(tempFileName, fileName, {
      oldPathBaseDir: BaseDirectory.AppLocalData,
      newPathBaseDir: BaseDirectory.AppLocalData,
    });
  } catch (err) {
    if (await hasFile(tempFileName)) {
      await remove(tempFileName, BASE_DIR_OPT).catch(() => {});
    }
    throw err;
  }
}

function enqueueWrite(fileName: string, task: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(fileName) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (writeQueues.get(fileName) === next) {
        writeQueues.delete(fileName);
      }
    });

  writeQueues.set(fileName, next);
  return next;
}

export const fileStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const fileName = `${name}.json`;
    try {
      const primaryContent = await readValidatedJsonFile(fileName);
      if (primaryContent !== null) {
        return primaryContent;
      }

      const backupContent = await readValidatedJsonFile(`${fileName}${BACKUP_SUFFIX}`);
      if (backupContent !== null) {
        if (!isReadOnlyStorageWindow()) {
          await atomicWriteTextFile(fileName, backupContent, { skipBackupCopy: true }).catch((err) => {
            logStorageError('restore backup to primary', fileName, err);
          });
        }
        return backupContent;
      }
    } catch (err) {
      logStorageError('load', fileName, err);
    }

    return null;
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (isReadOnlyStorageWindow()) {
      return;
    }

    const fileName = `${name}.json`;
    try {
      await enqueueWrite(fileName, async () => {
        await atomicWriteTextFile(fileName, value);
      });
    } catch (err) {
      logStorageError('write', fileName, err);
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (isReadOnlyStorageWindow()) {
      return;
    }

    const fileName = `${name}.json`;
    try {
      const backupFileName = `${fileName}${BACKUP_SUFFIX}`;
      const candidateFileNames = Array.from(new Set([
        fileName,
        buildLegacyTempFileName(fileName),
        buildTempFileName(fileName),
        backupFileName,
      ]));

      const existingFileNames = (
        await Promise.all(
          candidateFileNames.map(async (candidateFileName) =>
            (await hasFile(candidateFileName)) ? candidateFileName : null
          )
        )
      ).filter((candidateFileName): candidateFileName is string => candidateFileName !== null);

      const results = await Promise.allSettled(
        existingFileNames.map(async (candidateFileName) => {
          await remove(candidateFileName, BASE_DIR_OPT);
        })
      );

      for (const result of results) {
        if (result.status === 'rejected' && !isMissingFileError(result.reason)) {
          throw result.reason;
        }
      }
    } catch (err) {
      logStorageError('remove', fileName, err);
    }
  },

  packs: {
    ensureDir: async () => {
      if (isReadOnlyStorageWindow()) {
        return;
      }

      try {
        if (!(await hasFile(PACKS_SUBDIR))) {
          await mkdir(PACKS_SUBDIR, { ...BASE_DIR_OPT, recursive: true });
        }
      } catch (e) {
        logStorageError('ensure directory', PACKS_SUBDIR, e);
      }
    },

    savePack: async (filename: string, content: string) => {
      if (isReadOnlyStorageWindow()) {
        return;
      }

      await fileStorage.packs.ensureDir();
      await enqueueWrite(`${PACKS_SUBDIR}/${filename}`, async () => {
        await atomicWriteTextFile(`${PACKS_SUBDIR}/${filename}`, content);
      });
    },

    readPack: async (filename: string): Promise<string | null> => {
      try {
        const filePath = `${PACKS_SUBDIR}/${filename}`;
        if (await hasFile(filePath)) {
          return await readTextFile(filePath, BASE_DIR_OPT);
        }
        return null;
      } catch (e) {
        logStorageError('read', `${PACKS_SUBDIR}/${filename}`, e);
        return null;
      }
    },

    listInstalled: async (): Promise<string[]> => {
      try {
        await fileStorage.packs.ensureDir();
        const entries = await readDir(PACKS_SUBDIR, BASE_DIR_OPT);
        return entries
          .map(e => e.name || '')
          .filter(n => n.endsWith('.json'));
      } catch (e) {
        return [];
      }
    },

    removePack: async (filename: string) => {
      if (isReadOnlyStorageWindow()) {
        return;
      }

      try {
        const filePath = `${PACKS_SUBDIR}/${filename}`;
        if(await hasFile(filePath)) {
            await remove(filePath, BASE_DIR_OPT);
        }
      } catch (e) {
        logStorageError('remove', `${PACKS_SUBDIR}/${filename}`, e);
      }
    }
  }
};
