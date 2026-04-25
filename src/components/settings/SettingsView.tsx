import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/useAppStore';
import { AboutSection } from '@/components/settings/AboutSection';
import { PromptLibraryManager } from '@/components/settings/PromptLibraryManager';
import { SettingsNav } from '@/components/settings/SettingsNav';
import {
  getSettingsContentClass,
  SettingsIcon,
  type SettingsContentWidth,
} from '@/components/settings/SettingsUi';
import type { SettingsSection } from '@/components/settings/types';
import { AISection } from '@/components/settings/sections/AISection';
import { DataMaintenanceSection } from '@/components/settings/sections/DataMaintenanceSection';
import { GeneralSection } from '@/components/settings/sections/GeneralSection';
import { SearchWorkspaceSection } from '@/components/settings/sections/SearchWorkspaceSection';
import { SecuritySection } from '@/components/settings/sections/SecuritySection';

const CONTENT_VARIANTS = {
  initial: { opacity: 0, x: 12, scale: 0.99 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -8, scale: 0.995 },
};
const REFINERY_PLUGIN_PREFIX = 'plugin:ctxrun-plugin-refinery|';

const SETTINGS_SECTION_WIDTH: Record<SettingsSection, SettingsContentWidth> = {
  general: 'form',
  searchWorkspace: 'wide',
  library: 'wide',
  ai: 'wide',
  data: 'form',
  security: 'wide',
  about: 'full',
};

export function SettingsView() {
  const { t } = useTranslation();

  const [
    theme,
    setTheme,
    language,
    setLanguage,
    globalIgnore,
    updateGlobalIgnore,
    spotlightShortcut,
    setSpotlightShortcut,
    automatorShortcut,
    setAutomatorShortcut,
    windowDestroyDelay,
    setWindowDestroyDelay,
    spotlightAppearance,
    setSpotlightAppearance,
    searchSettings,
    setSearchSettings,
    refinerySettings,
    setRefinerySettings,
    guardSettings,
    setGuardSettings,
  ] = useAppStore(
    useShallow((state) => [
      state.theme,
      state.setTheme,
      state.language,
      state.setLanguage,
      state.globalIgnore,
      state.updateGlobalIgnore,
      state.spotlightShortcut,
      state.setSpotlightShortcut,
      state.automatorShortcut,
      state.setAutomatorShortcut,
      state.windowDestroyDelay,
      state.setWindowDestroyDelay,
      state.spotlightAppearance,
      state.setSpotlightAppearance,
      state.searchSettings,
      state.setSearchSettings,
      state.refinerySettings,
      state.setRefinerySettings,
      state.guardSettings,
      state.setGuardSettings,
    ]),
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  useEffect(() => {
    void invoke(`${REFINERY_PLUGIN_PREFIX}update_cleanup_config`, {
      config: {
        enabled: refinerySettings.enabled,
        strategy: refinerySettings.strategy,
        days: refinerySettings.days,
        maxCount: refinerySettings.maxCount,
        keepPinned: refinerySettings.keepPinned,
      },
    }).catch((error) => {
      console.error('Failed to update refinery cleanup config:', error);
    });
  }, [
    refinerySettings.enabled,
    refinerySettings.strategy,
    refinerySettings.days,
    refinerySettings.maxCount,
    refinerySettings.keepPinned,
  ]);

  const formatDuration = (seconds: number) => {
    if (seconds === 0) return t('settings.never');
    if (seconds < 60) return `${seconds} ${t('settings.seconds')}`;

    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (remainSeconds === 0) {
      return `${minutes} ${t('settings.minutes')}`;
    }
    return `${minutes} ${t('settings.minutes')} ${remainSeconds} ${t('settings.seconds')}`;
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <GeneralSection
            theme={theme}
            setTheme={setTheme}
            language={language}
            setLanguage={setLanguage}
            spotlightShortcut={spotlightShortcut}
            setSpotlightShortcut={setSpotlightShortcut}
            automatorShortcut={automatorShortcut}
            setAutomatorShortcut={setAutomatorShortcut}
            spotlightAppearance={spotlightAppearance}
            setSpotlightAppearance={setSpotlightAppearance}
            windowDestroyDelay={windowDestroyDelay}
            setWindowDestroyDelay={setWindowDestroyDelay}
            formatDuration={formatDuration}
          />
        );
      case 'searchWorkspace':
        return (
          <SearchWorkspaceSection
            searchSettings={searchSettings}
            setSearchSettings={setSearchSettings}
            globalIgnore={globalIgnore}
            updateGlobalIgnore={updateGlobalIgnore}
          />
        );
      case 'library':
        return <PromptLibraryManager />;
      case 'ai':
        return <AISection />;
      case 'data':
        return (
          <DataMaintenanceSection
            refinerySettings={refinerySettings}
            setRefinerySettings={setRefinerySettings}
          />
        );
      case 'security':
        return (
          <SecuritySection
            guardSettings={guardSettings}
            setGuardSettings={setGuardSettings}
            formatDuration={formatDuration}
          />
        );
      case 'about':
        return <AboutSection />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full bg-background flex flex-col">
      <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <SettingsIcon />
          {t('settings.title')}
        </h2>
        <span className="text-xs text-muted-foreground hidden sm:block">
          {t('settings.pageHint')}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} />

        <div className="flex-1 overflow-hidden relative min-w-0 bg-background/50">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              variants={CONTENT_VARIANTS}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="h-full w-full overflow-y-auto custom-scrollbar px-5 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7"
            >
              <div className={`h-full ${getSettingsContentClass(SETTINGS_SECTION_WIDTH[activeSection])}`}>
                {renderSection()}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
