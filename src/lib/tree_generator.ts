import { FileNode } from '@/types/context';

/**
 * 生成 ASCII 格式的项目结构树
 * 注意：只包含用户勾选 (isSelected) 的节点
 */
export function generateAsciiTree(nodes: FileNode[]): string {
  let output = '';

  // 递归函数
  const traverse = (nodeList: FileNode[], prefix: string, isLastParent: boolean) => {
    // 1. 过滤出需要显示的节点 (被选中)
    const activeNodes = nodeList.filter(n => n.isSelected);
    
    activeNodes.forEach((node, index) => {
      const isLast = index === activeNodes.length - 1;
      
      // 构建当前行的前缀
      const connector = isLast ? '└── ' : '├── ';
      output += `${prefix}${connector}${node.name}${node.kind === 'dir' ? '/' : ''}\n`;
      
      // 递归处理子节点
      if (node.children && node.children.length > 0) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        traverse(node.children, childPrefix, isLast);
      }
    });
  };

  traverse(nodes, '', true);
  
  if (!output.trim()) return '(No files selected)';
  return output;
}