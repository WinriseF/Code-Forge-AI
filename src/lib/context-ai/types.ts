export interface AiFileSelectionSuggestion {
  path: string;
  kind: 'file' | 'dir';
  reason: string;
}

export interface AiFileSelectionResult {
  summary: string;
  suggestions: AiFileSelectionSuggestion[];
}

export interface AiFileSelectionToolTrace {
  id: string;
  name: string;
  preview?: string;
  status: 'running' | 'success' | 'error';
}
