import { readTextFile } from '@tauri-apps/api/fs';
import { FileNode } from '@/types/context';
import { countTokens, estimateTokens } from './tokenizer';
import { generateAsciiTree } from './tree_generator'; // ✨ 引入树生成器

export interface ContextStats {
  fileCount: number;
  totalSize: number;
  estimatedTokens: number;
}

export function getSelectedFiles(nodes: FileNode[]): FileNode[] {
  let files: FileNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file' && node.isSelected) {
      files.push(node);
    }
    if (node.children) {
      files = files.concat(getSelectedFiles(node.children));
    }
  }
  return files;
}

export function calculateStats(nodes: FileNode[]): ContextStats {
  const files = getSelectedFiles(nodes);
  let totalSize = 0;
  for (const f of files) {
    totalSize += f.size || 0;
  }
  return {
    fileCount: files.length,
    totalSize: totalSize,
    estimatedTokens: estimateTokens(totalSize)
  };
}

/**
 * ✨ 升级后的上下文生成器
 * 包含：元数据 + 结构树 + 文件内容
 */
export async function generateContext(nodes: FileNode[]): Promise<{ text: string, tokenCount: number }> {
  const files = getSelectedFiles(nodes);
  const treeString = generateAsciiTree(nodes); // 生成树
  
  const parts: string[] = [];

  // --- 1. System Preamble (引导语) ---
  parts.push(`<project_context>`);
  parts.push(`This is a source code context provided by CodeForge AI.`);
  parts.push(`Total Files: ${files.length}`);
  parts.push(``);

  // --- 2. Project Structure (结构树) ---
  parts.push(`<project_structure>`);
  parts.push(treeString);
  parts.push(`</project_structure>`);
  parts.push(``);

  // --- 3. File Contents (文件内容) ---
  parts.push(`<source_files>`);
  
  const filePromises = files.map(async (file) => {
    try {
      const content = await readTextFile(file.path);
      // 使用 XML 标签包裹文件内容，增加 path 属性方便 AI 定位
      return `
<file path="${file.path}">
${content}
</file>`;
    } catch (err) {
      console.warn(`Failed to read file: ${file.path}`, err);
      return `
<file path="${file.path}">
[Error: Unable to read file content]
</file>`;
    }
  });

  const fileContents = await Promise.all(filePromises);
  parts.push(...fileContents);
  
  parts.push(`</source_files>`);
  parts.push(`</project_context>`);

  const fullText = parts.join('\n');
  const finalTokens = countTokens(fullText);

  return {
    text: fullText,
    tokenCount: finalTokens
  };
}