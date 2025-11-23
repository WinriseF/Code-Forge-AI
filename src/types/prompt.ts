export interface Prompt {
  id: string;
  title: string;
  content: string;      // 命令或 Prompt 模板
  group: string;        // 所属分组ID或名称
  description?: string; // 简短描述
  tags?: string[];      // 标签
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
  
  // ✨ 新增字段
  source?: 'local' | 'official'; // 来源
  packId?: string;               // 所属包ID (仅 official 有)
  originalId?: string;           // ✨ 关键修复：记录克隆自哪个官方指令 ID
}

export const DEFAULT_GROUP = 'Default';

// 商店清单数据结构
export interface PackManifestItem {
  id: string;        // e.g. "zh-linux"
  language: string;  // "zh"
  platform: string;  // "linux"
  name: string;      // "Linux 运维"
  description: string;
  count: number;
  size_kb: number;
  url: string;       // 相对路径 "packs/zh/linux.json"
}

export interface PackManifest {
  updated_at: number;
  version: string;
  packages: PackManifestItem[];
}