// src/lib/context_assembler.ts
import { readTextFile } from '@tauri-apps/api/fs';
import { FileNode } from '@/types/context';
import { countTokens, estimateTokens } from './tokenizer';

export interface ContextStats {
  fileCount: number;
  totalSize: number;
  estimatedTokens: number;
}

/**
 * 递归获取所有被选中的文件节点（扁平化）
 */
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

/**
 * 快速估算统计信息（不读取文件内容）
 */
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
 * 生成最终的上下文文本
 * 格式采用 XML 标签风格，这是目前 Claude/GPT-4 最容易理解的格式
 */
export async function generateContext(nodes: FileNode[]): Promise<{ text: string, tokenCount: number }> {
  const files = getSelectedFiles(nodes);
  const parts: string[] = [];
  
  // 头部说明
  parts.push(`# Project Context`);
  parts.push(`Total Files: ${files.length}\n`);

  // 并发读取文件内容
  const filePromises = files.map(async (file) => {
    try {
      const content = await readTextFile(file.path);
      // 构建单个文件的格式块
      return `
<file path="${file.path}">
${content}
</file>
`;
    } catch (err) {
      console.warn(`Failed to read file: ${file.path}`, err);
      return `
<file path="${file.path}">
[Error: Unable to read file content]
</file>
`;
    }
  });

  const fileContents = await Promise.all(filePromises);
  parts.push(...fileContents);

  const fullText = parts.join('\n');
  
  // 计算精确 Token
  const finalTokens = countTokens(fullText);

  return {
    text: fullText,
    tokenCount: finalTokens
  };
}