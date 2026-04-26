import { emit } from '@tauri-apps/api/event';
import type { AppLang, SearchEngineType, SpotlightAppearance } from '@/store/useAppStore';

export const PROJECT_ROOT_SYNC_EVENT = 'app-store:project-root-changed';
export const LANGUAGE_SYNC_EVENT = 'app-store:language-changed';
export const SEARCH_SETTINGS_SYNC_EVENT = 'app-store:search-settings-changed';
export const SPOTLIGHT_APPEARANCE_SYNC_EVENT = 'app-store:spotlight-appearance-changed';

export interface ProjectRootSyncPayload {
  projectRoot: string | null;
  recentProjectRoots: string[];
}

export interface LanguageSyncPayload {
  language: AppLang;
}

export interface SearchSettingsSyncPayload {
  defaultEngine: SearchEngineType;
  customUrl: string;
}

async function emitAppStoreEvent<T>(eventName: string, payload: T, label: string): Promise<void> {
  try {
    await emit(eventName, payload);
  } catch (err) {
    console.error(`[AppStoreEvents] Failed to emit ${label}:`, err);
  }
}

export function broadcastProjectRootSync(payload: ProjectRootSyncPayload): void {
  void emitAppStoreEvent(PROJECT_ROOT_SYNC_EVENT, payload, 'project root sync');
}

export function broadcastLanguageSync(payload: LanguageSyncPayload): void {
  void emitAppStoreEvent(LANGUAGE_SYNC_EVENT, payload, 'language sync');
}

export function broadcastSearchSettingsSync(payload: SearchSettingsSyncPayload): void {
  void emitAppStoreEvent(SEARCH_SETTINGS_SYNC_EVENT, payload, 'search settings sync');
}

export function broadcastSpotlightAppearanceSync(payload: SpotlightAppearance): void {
  void emitAppStoreEvent(
    SPOTLIGHT_APPEARANCE_SYNC_EVENT,
    payload,
    'spotlight appearance sync'
  );
}
