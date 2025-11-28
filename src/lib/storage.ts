import { readTextFile, writeTextFile, createDir, exists, readDir, removeFile, BaseDirectory } from '@tauri-apps/api/fs';

// 定义基础目录选项，统一使用 AppLocalData
// 这会自动指向系统的用户数据目录，并在 dev/prod 下保持一致的行为逻辑
const BASE_DIR_OPT = { dir: BaseDirectory.AppLocalData };
const PACKS_SUBDIR = 'packs';

export const fileStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const fileName = `${name}.json`;
    try {
      // 检查文件是否存在
      const fileExists = await exists(fileName, BASE_DIR_OPT);
      if (!fileExists) return null;
      
      // 读取文件
      return await readTextFile(fileName, BASE_DIR_OPT);
    } catch (err) {
      console.warn(`[Storage] Read ${fileName} failed:`, err);
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    const fileName = `${name}.json`;
    try {
      // 确保根目录存在
      if (!(await exists('', BASE_DIR_OPT))) {
         await createDir('', { ...BASE_DIR_OPT, recursive: true });
      }
      
      // 写入文件
      await writeTextFile(fileName, value, BASE_DIR_OPT);
    } catch (err) {
      console.error(`[Storage] Write ${fileName} failed:`, err);
    }
  },

  removeItem: async (name: string): Promise<void> => {
    const fileName = `${name}.json`;
    try {
      if (await exists(fileName, BASE_DIR_OPT)) {
        await removeFile(fileName, BASE_DIR_OPT);
      }
    } catch (err) {
      console.warn(`[Storage] Remove ${fileName} failed:`, err);
    }
  },

  // 扩展包专用存储逻辑
  packs: {
    ensureDir: async () => {
      try {
        if (!(await exists(PACKS_SUBDIR, BASE_DIR_OPT))) {
          await createDir(PACKS_SUBDIR, { ...BASE_DIR_OPT, recursive: true });
        }
      } catch (e) {
        console.error("[Storage] Failed to create packs dir", e);
      }
    },

    savePack: async (filename: string, content: string) => {
      try {
        await fileStorage.packs.ensureDir();
        await writeTextFile(`${PACKS_SUBDIR}/${filename}`, content, BASE_DIR_OPT);
      } catch (e) {
        console.error(`[Storage] Failed to save pack ${filename}`, e);
        throw e;
      }
    },

    readPack: async (filename: string): Promise<string | null> => {
      try {
        const filePath = `${PACKS_SUBDIR}/${filename}`;
        if (await exists(filePath, BASE_DIR_OPT)) {
          return await readTextFile(filePath, BASE_DIR_OPT);
        }
        return null;
      } catch (e) {
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
        console.warn("[Storage] No packs found or dir not exists");
        return [];
      }
    },
    
    removePack: async (filename: string) => {
      try {
        const filePath = `${PACKS_SUBDIR}/${filename}`;
        if(await exists(filePath, BASE_DIR_OPT)) {
            await removeFile(filePath, BASE_DIR_OPT);
        }
      } catch (e) {
        console.error("Failed to delete pack", e);
      }
    }
  }
};