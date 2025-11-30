import yaml from 'js-yaml';
import { PatchOperation, FilePatch } from '@/components/features/patch/patch_types';

interface YamlPatchItem {
  file?: string;
  replace?: {
    original: string;
    modified: string;
    context_before?: string;
    context_after?: string;
  };
  insert_after?: {
    anchor: string;
    content: string;
  };
}

/**
 * 解析多文件 YAML Patch (保持不变)
 */
export function parseMultiFilePatch(yamlContent: string): FilePatch[] {
  const filePatches: FilePatch[] = [];
  let currentFile: FilePatch | null = null;

  try {
    const doc = yaml.load(yamlContent);
    if (!Array.isArray(doc)) return [];

    for (const item of doc as YamlPatchItem[]) {
      if (item.file) {
        let existing = filePatches.find(f => f.filePath === item.file);
        if (!existing) {
          existing = { filePath: item.file, operations: [] };
          filePatches.push(existing);
        }
        currentFile = existing;
      }

      if (!currentFile && (item.replace || item.insert_after)) {
         currentFile = { filePath: 'unknown_file', operations: [] };
         filePatches.push(currentFile);
      }

      if (item.replace && currentFile) {
        const { original, modified, context_before = '', context_after = '' } = item.replace;
        const originalBlock = `${context_before}\n${original}\n${context_after}`.trim();
        const modifiedBlock = `${context_before}\n${modified}\n${context_after}`.trim();
        
        currentFile.operations.push({
          type: 'replace',
          originalBlock, // 注意：这里的 block 可能会被 parser 去掉首尾空行，下面 apply 时会处理
          modifiedBlock,
        });
      } else if (item.insert_after && currentFile) {
        const { anchor, content } = item.insert_after;
        const originalBlock = anchor.trim();
        const modifiedBlock = `${anchor}\n${content}`.trim();

        currentFile.operations.push({
          type: 'insert_after',
          originalBlock,
          modifiedBlock,
        });
      }
    }
  } catch (e) {
    console.error("YAML Parse Error", e);
  }

  return filePatches;
}

/**
 * 增加了换行符标准化和容错匹配
 */
export function applyPatches(originalCode: string, operations: PatchOperation[]): string {
  // 1. 统一原代码的换行符为 LF (\n)，解决 Windows CRLF 问题
  let resultCode = originalCode.replace(/\r\n/g, '\n');

  for (const op of operations) {
    // 2. 同样标准化补丁块的换行符
    const searchBlock = op.originalBlock.replace(/\r\n/g, '\n');
    const replaceBlock = op.modifiedBlock.replace(/\r\n/g, '\n');

    // 3. 尝试严格匹配
    if (resultCode.includes(searchBlock)) {
      resultCode = resultCode.replace(searchBlock, replaceBlock);
    } 
    // 4. 容错匹配：如果严格匹配失败，尝试忽略首尾空白进行匹配
    // (AI 生成的代码块经常在末尾多一个换行或少一个空格)
    else {
      const trimmedSearch = searchBlock.trim();
      // 在代码中查找去掉首尾空白的版本
      const idx = resultCode.indexOf(trimmedSearch);
      
      if (idx !== -1) {
        // 找到了！构建新的字符串
        const before = resultCode.substring(0, idx);
        // 跳过原文中对应长度的内容
        const after = resultCode.substring(idx + trimmedSearch.length);
        
        // 插入修改后的块 (也建议 trim 一下以防 AI 引入多余空行，或者根据情况保留)
        // 这里选择 trim() 后的 replaceBlock 以保持紧凑，通常更加安全
        resultCode = before + replaceBlock.trim() + after;
        
        console.log(`[Patch] Applied fuzzy match for block starting with: ${trimmedSearch.substring(0, 20)}...`);
      } else {
        console.warn(`[Patch] Failed to match block. Strict and fuzzy search failed.\nBlock:\n${searchBlock}`);
      }
    }
  }
  return resultCode;
}