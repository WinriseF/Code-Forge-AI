import { FilePatch, PatchOperation } from '@/types/patch';

export interface ApplyResult {
  modified: string;
  success: boolean;
  errors: string[];
}

export function parseMultiFilePatch(text: string): FilePatch[] {
  const filePatches: FilePatch[] = [];

  const fileRegex = /(?:^|\n)#{0,3}\s*File:\s*(.+?)(?=\n|$)/gi;
  let match;

  const fileMatches: { path: string, start: number }[] = [];
  while ((match = fileRegex.exec(text)) !== null) {
    fileMatches.push({ path: match[1].trim(), start: match.index });
  }

  if (fileMatches.length === 0) {
    const ops = parseOperations(text);
    if (ops.length > 0) {
      filePatches.push({ filePath: 'current_file', operations: ops });
    }
    return filePatches;
  }

  const patchesMap = new Map<string, PatchOperation[]>();

  for (let i = 0; i < fileMatches.length; i++) {
    const current = fileMatches[i];
    const next = fileMatches[i+1];
    const end = next ? next.start : text.length;

    const content = text.substring(current.start, end);
    const ops = parseOperations(content);

    if (ops.length > 0) {
        const existing = patchesMap.get(current.path) || [];
        patchesMap.set(current.path, existing.concat(ops));
    }
  }

  for (const [filePath, operations] of patchesMap.entries()) {
      filePatches.push({ filePath, operations });
  }

  return filePatches;
}

function parseOperations(content: string): PatchOperation[] {
  const ops: PatchOperation[] = [];
  const blockRegex = /<{5,}\s*SEARCH\s*([\s\S]*?)\s*={5,}\s*([\s\S]*?)\s*>{5,}\s*REPLACE/gi;

  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    ops.push({
      originalBlock: match[1],
      modifiedBlock: match[2]
    });
  }
  return ops;
}

export function applyPatches(originalCode: string, operations: PatchOperation[]): ApplyResult {
  let currentCode = originalCode;
  const errors: string[] = [];

  for (const op of operations) {
    const searchBlock = op.originalBlock;
    const replaceBlock = op.modifiedBlock;

    if (currentCode.includes(searchBlock)) {
      currentCode = currentCode.replace(searchBlock, replaceBlock);
      continue;
    }

    const normalizedCode = currentCode.replace(/\r\n/g, '\n');
    const normalizedSearch = searchBlock.replace(/\r\n/g, '\n');
    if (normalizedCode.includes(normalizedSearch)) {
       currentCode = normalizedCode.replace(normalizedSearch, replaceBlock);
       continue;
    }

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

function fuzzyReplace(source: string, search: string, replacement: string): { success: boolean, newCode: string } {
    const sourceMap: number[] = [];
    let sourceStream = '';

    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (!/\s/.test(char)) {
            sourceStream += char;
            sourceMap.push(i);
        }
    }

    const searchStream = search.replace(/\s/g, '');

    if (searchStream.length === 0) return { success: false, newCode: source };

    const streamIndex = sourceStream.indexOf(searchStream);

    if (streamIndex === -1) {
        return { success: false, newCode: source };
    }

    const originalStartIndex = sourceMap[streamIndex];

    const lastCharIndexInStream = streamIndex + searchStream.length - 1;

    const originalEndIndex = sourceMap[lastCharIndexInStream] + 1;

    let finalEndIndex = originalEndIndex;
    while (finalEndIndex < source.length && /[ \t]/.test(source[finalEndIndex])) {
        finalEndIndex++;
    }

    const newCode = source.slice(0, originalStartIndex) + replacement + source.slice(finalEndIndex);

    return { success: true, newCode };
}
