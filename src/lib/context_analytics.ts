import { FileNode } from '@/types/context';
import { AIModelConfig } from '@/types/model'; 

export interface LanguageStat {
  name: string;
  count: number;
  size: number;
  color: string;
  percentage: number;
}

// 新的成本结构
export interface ModelCostStat {
  modelId: string;
  modelName: string;
  limit: number;
  cost: number; // 计算出的美元成本
}

export interface AnalyticsData {
  languages: LanguageStat[];
  topFiles: FileNode[];
  modelCosts: ModelCostStat[]; // ✨ 动态数组
}

// 语言颜色映射
const LANG_MAP: Record<string, { name: string; color: string }> = {
  ts: { name: 'TypeScript', color: 'bg-blue-500' },
  tsx: { name: 'TypeScript JSX', color: 'bg-blue-400' },
  js: { name: 'JavaScript', color: 'bg-yellow-400' },
  jsx: { name: 'JavaScript JSX', color: 'bg-yellow-300' },
  json: { name: 'JSON', color: 'bg-gray-400' },
  css: { name: 'CSS', color: 'bg-sky-300' },
  html: { name: 'HTML', color: 'bg-orange-500' },
  rs: { name: 'Rust', color: 'bg-orange-700' },
  py: { name: 'Python', color: 'bg-blue-600' },
  md: { name: 'Markdown', color: 'bg-white' },
  yml: { name: 'YAML', color: 'bg-purple-400' },
  // ... 其他
};

function getFlatSelectedFiles(nodes: FileNode[]): FileNode[] {
  let files: FileNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file' && node.isSelected) {
      files.push(node);
    }
    if (node.children) {
      files = files.concat(getFlatSelectedFiles(node.children));
    }
  }
  return files;
}

/**
 * 动态分析函数
 */
export function analyzeContext(
  nodes: FileNode[], 
  totalTokens: number, 
  models: AIModelConfig[] // 必传参数
): AnalyticsData {
  const files = getFlatSelectedFiles(nodes);
  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

  // 1. 语言分布
  const langStats: Record<string, { count: number; size: number }> = {};
  files.forEach(f => {
    const ext = f.name.split('.').pop()?.toLowerCase() || 'other';
    const key = LANG_MAP[ext] ? ext : 'other';
    if (!langStats[key]) langStats[key] = { count: 0, size: 0 };
    langStats[key].count++;
    langStats[key].size += (f.size || 0);
  });

  const languages: LanguageStat[] = Object.entries(langStats)
    .map(([key, stat]) => {
      const info = LANG_MAP[key] || { name: 'Other', color: 'bg-slate-500' };
      return {
        name: info.name,
        count: stat.count,
        size: stat.size,
        color: info.color,
        percentage: totalSize > 0 ? (stat.size / totalSize) * 100 : 0
      };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);

  // 2. Top Files
  const topFiles = [...files]
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, 5);

  // 3. 动态成本计算
  const millions = totalTokens / 1_000_000;
  const modelCosts: ModelCostStat[] = models.map(model => ({
    modelId: model.id,
    modelName: model.name,
    limit: model.contextLimit,
    cost: millions * model.inputPricePerMillion
  }));
  
  return {
    languages,
    topFiles,
    modelCosts
  };
}