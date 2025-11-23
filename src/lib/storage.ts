import { readTextFile, writeTextFile, createDir, exists, readDir, removeFile, BaseDirectory } from '@tauri-apps/api/fs';

// 判断当前环境
const isDev = import.meta.env.DEV;
// 生产环境下的文件夹名 (exe同级)
const PROD_DIR = 'data';
const PACKS_SUBDIR = 'packs';

export const fileStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const fileName = `${name}.json`;
    try {
      if (isDev) {
        const existsFile = await exists(fileName, { dir: BaseDirectory.AppLocalData });
        if (!existsFile) return null;
        return await readTextFile(fileName, { dir: BaseDirectory.AppLocalData });
      } else {
        const path = `${PROD_DIR}/${fileName}`;
        if (!(await exists(path))) return null;
        return await readTextFile(path);
      }
    } catch (err) {
      console.warn(`[Storage] Read ${fileName} failed:`, err);
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    const fileName = `${name}.json`;
    try {
      if (isDev) {
        if (!(await exists('', { dir: BaseDirectory.AppLocalData }))) {
           await createDir('', { dir: BaseDirectory.AppLocalData, recursive: true });
        }
        await writeTextFile(fileName, value, { dir: BaseDirectory.AppLocalData });
      } else {
        if (!(await exists(PROD_DIR))) {
          await createDir(PROD_DIR, { recursive: true });
        }
        const path = `${PROD_DIR}/${fileName}`;
        await writeTextFile(path, value);
      }
    } catch (err) {
      console.error(`[Storage] Write ${fileName} failed:`, err);
    }
  },

  // ✨ 修复：补充 removeItem 方法以满足 Zustand 类型要求
  removeItem: async (name: string): Promise<void> => {
    const fileName = `${name}.json`;
    try {
      if (isDev) {
        if (await exists(fileName, { dir: BaseDirectory.AppLocalData })) {
          await removeFile(fileName, { dir: BaseDirectory.AppLocalData });
        }
      } else {
        const path = `${PROD_DIR}/${fileName}`;
        if (await exists(path)) {
          await removeFile(path);
        }
      }
    } catch (err) {
      console.warn(`[Storage] Remove ${fileName} failed:`, err);
    }
  },

  // 扩展包专用存储逻辑
  packs: {
    ensureDir: async () => {
      try {
        if (isDev) {
          if (!(await exists(PACKS_SUBDIR, { dir: BaseDirectory.AppLocalData }))) {
            await createDir(PACKS_SUBDIR, { dir: BaseDirectory.AppLocalData, recursive: true });
          }
        } else {
          const path = `${PROD_DIR}/${PACKS_SUBDIR}`;
          if (!(await exists(path))) {
            await createDir(path, { recursive: true });
          }
        }
      } catch (e) {
        console.error("[Storage] Failed to create packs dir", e);
      }
    },

    savePack: async (filename: string, content: string) => {
      try {
        await fileStorage.packs.ensureDir();
        if (isDev) {
          await writeTextFile(`${PACKS_SUBDIR}/${filename}`, content, { dir: BaseDirectory.AppLocalData });
        } else {
          await writeTextFile(`${PROD_DIR}/${PACKS_SUBDIR}/${filename}`, content);
        }
      } catch (e) {
        console.error(`[Storage] Failed to save pack ${filename}`, e);
        throw e;
      }
    },

    readPack: async (filename: string): Promise<string | null> => {
      try {
        if (isDev) {
          if (await exists(`${PACKS_SUBDIR}/${filename}`, { dir: BaseDirectory.AppLocalData })) {
            return await readTextFile(`${PACKS_SUBDIR}/${filename}`, { dir: BaseDirectory.AppLocalData });
          }
        } else {
          const path = `${PROD_DIR}/${PACKS_SUBDIR}/${filename}`;
          if (await exists(path)) {
            return await readTextFile(path);
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    },

    listInstalled: async (): Promise<string[]> => {
      try {
        await fileStorage.packs.ensureDir();
        let entries;
        if (isDev) {
          entries = await readDir(PACKS_SUBDIR, { dir: BaseDirectory.AppLocalData });
        } else {
          entries = await readDir(`${PROD_DIR}/${PACKS_SUBDIR}`);
        }
        return entries
          .map(e => e.name || '')
          .filter(n => n.endsWith('.json'));
      } catch (e) {
        console.warn("[Storage] No packs found or dir not exists");
        return [];
      }
    },
    
    removePack: async (filename: string) => {
      try {
        if (isDev) {
            await removeFile(`${PACKS_SUBDIR}/${filename}`, { dir: BaseDirectory.AppLocalData });
        } else {
            await removeFile(`${PROD_DIR}/${PACKS_SUBDIR}/${filename}`);
        }
      } catch (e) {
        console.error("Failed to delete pack", e);
      }
    }
  }
};