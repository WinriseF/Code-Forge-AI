import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import i18n from '@/i18n/config';
import {
  consumeProjectRootSync,
  LANGUAGE_SYNC_EVENT,
  PROJECT_ROOT_SYNC_EVENT,
  SEARCH_SETTINGS_SYNC_EVENT,
  SPOTLIGHT_APPEARANCE_SYNC_EVENT,
  subscribeProjectRootSync,
  type LanguageSyncPayload,
  type ProjectRootSyncPayload,
  type SearchSettingsSyncPayload,
} from '@/lib/appStoreEvents';
import type { SpotlightAppearance } from '@/store/useAppStore';
import { useAppStore } from '@/store/useAppStore';
import { useContextStore } from '@/store/useContextStore';

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areSearchSettingsEqual(
  left: SearchSettingsSyncPayload,
  right: SearchSettingsSyncPayload
): boolean {
  return left.defaultEngine === right.defaultEngine && left.customUrl === right.customUrl;
}

function areSpotlightAppearanceEqual(
  left: SpotlightAppearance,
  right: SpotlightAppearance
): boolean {
  return (
    left.width === right.width &&
    left.defaultHeight === right.defaultHeight &&
    left.maxChatHeight === right.maxChatHeight
  );
}

function applyProjectRootSync(payload: ProjectRootSyncPayload): void {
  const state = useAppStore.getState();
  if (
    state.projectRoot !== payload.projectRoot ||
    !areStringArraysEqual(state.recentProjectRoots, payload.recentProjectRoots)
  ) {
    useAppStore.setState({
      projectRoot: payload.projectRoot,
      recentProjectRoots: payload.recentProjectRoots,
    });
  }

  const contextState = useContextStore.getState();
  if (contextState.projectRoot !== payload.projectRoot) {
    void contextState.setProjectRoot(payload.projectRoot);
  }
}

export function useCrossWindowAppStoreSync(): void {
  useEffect(() => {
    const unsubscribeProjectRootSync = subscribeProjectRootSync(applyProjectRootSync);
    const initialState = useAppStore.getState();
    applyProjectRootSync({
      projectRoot: initialState.projectRoot,
      recentProjectRoots: initialState.recentProjectRoots,
    });

    const projectRootUnlisten = listen<ProjectRootSyncPayload>(
      PROJECT_ROOT_SYNC_EVENT,
      ({ payload }) => {
        consumeProjectRootSync(payload);
      }
    );

    const languageUnlisten = listen<LanguageSyncPayload>(LANGUAGE_SYNC_EVENT, ({ payload }) => {
      if (useAppStore.getState().language === payload.language) {
        return;
      }

      useAppStore.setState({ language: payload.language });
      void i18n.changeLanguage(payload.language);
    });

    const searchSettingsUnlisten = listen<SearchSettingsSyncPayload>(
      SEARCH_SETTINGS_SYNC_EVENT,
      ({ payload }) => {
        if (areSearchSettingsEqual(useAppStore.getState().searchSettings, payload)) {
          return;
        }

        useAppStore.setState({ searchSettings: payload });
      }
    );

    const spotlightAppearanceUnlisten = listen<SpotlightAppearance>(
      SPOTLIGHT_APPEARANCE_SYNC_EVENT,
      ({ payload }) => {
        if (areSpotlightAppearanceEqual(useAppStore.getState().spotlightAppearance, payload)) {
          return;
        }

        useAppStore.setState({ spotlightAppearance: payload });
      }
    );

    return () => {
      unsubscribeProjectRootSync();
      projectRootUnlisten.then((unlisten) => unlisten());
      languageUnlisten.then((unlisten) => unlisten());
      searchSettingsUnlisten.then((unlisten) => unlisten());
      spotlightAppearanceUnlisten.then((unlisten) => unlisten());
    };
  }, []);
}
