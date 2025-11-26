export interface Prompt {
  id: string;
  title: string;
  content: string;      
  group: string;        
  description?: string; 
  tags?: string[];      
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
  
  source?: 'local' | 'official'; 
  packId?: string;               
  originalId?: string;
  
  type?: 'command' | 'prompt'; 
}

export const DEFAULT_GROUP = 'Default';

export interface PackManifestItem {
  id: string;        
  language: string;  
  platform: string;  
  name: string;      
  description: string;
  count: number;
  size_kb: number;
  url: string;       
  category?: 'command' | 'prompt'; 
}

export interface PackManifest {
  updated_at: number;
  version: string;
  packages: PackManifestItem[];
}