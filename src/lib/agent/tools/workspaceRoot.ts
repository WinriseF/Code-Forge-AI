import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '@/store/useAppStore';
import { useContextStore } from '@/store/useContextStore';

const TOOL_RUNTIME_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-tool-runtime|';

export function getWorkspaceRoot(): string {
  const appRoot = useAppStore.getState().projectRoot?.trim();
  if (appRoot) {
    return appRoot;
  }

  const contextRoot = useContextStore.getState().projectRoot?.trim();
  if (contextRoot) {
    return contextRoot;
  }

  throw new Error('projectRoot is not configured. Please select a workspace folder first.');
}

export async function setAgentWorkspaceRoot(rootDir: string | null): Promise<string | null> {
  const normalizedRoot = rootDir?.trim() || null;
  return invoke<string | null>(`${TOOL_RUNTIME_PLUGIN_PREFIX}agent_set_workspace_root`, {
    rootDir: normalizedRoot,
  });
}

export async function ensureWorkspaceRootAuthorized(): Promise<string> {
  const rootDir = getWorkspaceRoot();
  await setAgentWorkspaceRoot(rootDir);
  return rootDir;
}
