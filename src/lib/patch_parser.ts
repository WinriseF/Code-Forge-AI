import { FilePatch, PatchOperation } from '@/components/features/patch/patch_types';

export interface ApplyResult {
  modified: string;
  success: boolean;
  errors: string[];
}

/**
 * 解析 SEARCH/REPLACE 格式
 * 格式示例:
 * <<<<<<< SEARCH
 * original code
 * =======
 * new code
 * >>>>>>> REPLACE
 */
export function parseMultiFilePatch(text: string): FilePatch[] {
  const filePatches: FilePatch[] = [];
  
  // 1. 按文件块分割 (支持 ### File: path 或 File: path)
  const fileRegex = /(?:^|\n)#{0,3}\s*File:\s*(.+?)(?=\n|$)/gi;
  let match;
  
  // 找出所有文件的起始位置
  const fileMatches: { path: string, start: number }[] = [];
  while ((match = fileRegex.exec(text)) !== null) {
    fileMatches.push({ path: match[1].trim(), start: match.index });
  }

  if (fileMatches.length === 0) {
    // 没找到文件标记，尝试当做单文件处理（或者是纯 Block）
    const ops = parseOperations(text);
    if (ops.length > 0) {
      filePatches.push({ filePath: 'current_file', operations: ops });
    }
    return filePatches;
  }

  // 2. 解析每个文件的内容 (修复：使用 Map 聚合，防止同文件多次出现被覆盖)
  const patchesMap = new Map<string, PatchOperation[]>();

  for (let i = 0; i < fileMatches.length; i++) {
    const current = fileMatches[i];
    const next = fileMatches[i+1];
    const end = next ? next.start : text.length;
    
    const content = text.substring(current.start, end);
    const ops = parseOperations(content);
    
    if (ops.length > 0) {
        // 如果已存在该文件的补丁，则追加操作
        const existing = patchesMap.get(current.path) || [];
        patchesMap.set(current.path, existing.concat(ops));
    }
  }

  // 3. 转换为数组
  for (const [filePath, operations] of patchesMap.entries()) {
      filePatches.push({ filePath, operations });
  }

  return filePatches;
}

function parseOperations(content: string): PatchOperation[] {
  const ops: PatchOperation[] = [];
  // 匹配 Search/Replace 块
  // 允许 <<<<<<< SEARCH 或 <<<<<<< search
  const blockRegex = /<{5,}\s*SEARCH\s*([\s\S]*?)\s*={5,}\s*([\s\S]*?)\s*>{5,}\s*REPLACE/gi;
  
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    ops.push({
      originalBlock: match[1], // 不trim，保留内部结构，外层空白在apply时处理
      modifiedBlock: match[2]
    });
  }
  return ops;
}

/**
 * 核心算法：基于 Token 映射的模糊替换
 */
export function applyPatches(originalCode: string, operations: PatchOperation[]): ApplyResult {
  let currentCode = originalCode; // 不要在循环外统一 replace 换行符，保持原样最好
  const errors: string[] = [];

  for (const op of operations) {
    const searchBlock = op.originalBlock;
    const replaceBlock = op.modifiedBlock;

    // 1. 尝试精确匹配 (最快，最安全)
    if (currentCode.includes(searchBlock)) {
      currentCode = currentCode.replace(searchBlock, replaceBlock);
      continue;
    }

    // 2. 尝试标准化换行符匹配 (解决 Windows/Linux 差异)
    const normalizedCode = currentCode.replace(/\r\n/g, '\n');
    const normalizedSearch = searchBlock.replace(/\r\n/g, '\n');
    if (normalizedCode.includes(normalizedSearch)) {
       // 如果匹配到了，我们需要用正则去替换，因为 currentCode 可能包含 \r
       // 简单的做法是把 currentCode 也转成 LF (这通常是可以接受的)
       currentCode = normalizedCode.replace(normalizedSearch, replaceBlock);
       continue;
    }

    // 3. 终极武器：基于无空白 Token 流的锚点匹配 (Fuzzy Anchor)
    // 这能解决缩进、空行不一致的问题
    const matchResult = fuzzyReplace(currentCode, searchBlock, replaceBlock);
    if (matchResult.success) {
        currentCode = matchResult.newCode;
    } else {
        errors.push(`Could not locate block:\n${searchBlock.substring(0, 50)}...`);
    }
  }

  return {
    modified: currentCode,
    success: errors.length === 0,
    errors
  };
}

/**
 * 模糊替换算法
 * 原理：生成无空白的字符流，并记录映射关系。在流中找到位置后，映射回原字符串的索引。
 */
function fuzzyReplace(source: string, search: string, replacement: string): { success: boolean, newCode: string } {
    // 1. 构建源文件的 Token 映射表
    // map[i] = j 表示：去除空白后的第 i 个字符，对应原字符串的索引 j
    const sourceMap: number[] = [];
    let sourceStream = '';
    
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (!/\s/.test(char)) { // 如果不是空白字符
            sourceStream += char;
            sourceMap.push(i);
        }
    }

    // 2. 构建搜索块的 Token 流
    const searchStream = search.replace(/\s/g, '');

    if (searchStream.length === 0) return { success: false, newCode: source };

    // 3. 在流中查找
    const streamIndex = sourceStream.indexOf(searchStream);

    if (streamIndex === -1) {
        return { success: false, newCode: source };
    }

    // 4. 映射回原字符串索引
    // 开始索引：流中匹配到的第一个字符在原字符串的位置
    const originalStartIndex = sourceMap[streamIndex];
    
    // 结束索引：流中匹配到的最后一个字符在原字符串的位置 + 1
    // 注意：searchStream.length 是流长度
    const lastCharIndexInStream = streamIndex + searchStream.length - 1;
    
    // 我们需要包含最后一个字符，所以 slice 的 end 应该是索引+1
    const originalEndIndex = sourceMap[lastCharIndexInStream] + 1;

    // 5. 执行替换
    // 进阶优化：尝试扩展 originalEndIndex 到行尾（如果后面只有空白）
    // 这样可以避免留下奇怪的空行
    let finalEndIndex = originalEndIndex;
    while (finalEndIndex < source.length && /[ \t]/.test(source[finalEndIndex])) {
        finalEndIndex++;
    }

    const newCode = source.slice(0, originalStartIndex) + replacement + source.slice(finalEndIndex);
    
    return { success: true, newCode };
}