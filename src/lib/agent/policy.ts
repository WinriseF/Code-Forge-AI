import { AgentToolPolicy } from './types';

export const DEFAULT_AGENT_TOOL_POLICY: AgentToolPolicy = {
  mode: 'allowList',
  toolNames: ['fs.list_directory', 'fs.search_files', 'fs.read_file', 'fs.grep', 'web.search', 'web.extract_page', 'shell_command'],
};

export function isToolAllowed(name: string, policy: AgentToolPolicy = DEFAULT_AGENT_TOOL_POLICY): boolean {
  const names = policy.toolNames ?? [];

  if (policy.mode === 'allowAll') return true;
  if (policy.mode === 'allowList') return names.includes(name);
  if (policy.mode === 'denyList') return !names.includes(name);

  return false;
}
