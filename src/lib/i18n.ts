import { AppView } from "@/store/useAppStore";

type LangKey = 'zh' | 'en';

const translations = {
  en: {
    menu: {
      prompts: "Prompt Verse",
      context: "Context Forge",
      patch: "Patch Weaver",
      settings: "Settings"
    },
    actions: {
      collapse: "Collapse",
      expand: "Expand"
    },
    settings: {
      title: "Settings",
      appearance: "Appearance",
      language: "Language",
      themeDark: "Dark Theme",
      themeLight: "Light Theme",
      langEn: "English",
      langZh: "Chinese (Simplified)",
      close: "Close"
    }
  },
  zh: {
    menu: {
      prompts: "灵感指令库",
      context: "上下文熔炉",
      patch: "代码织补机",
      settings: "设置"
    },
    actions: {
      collapse: "收起侧栏",
      expand: "展开侧栏"
    },
    settings: {
      title: "设置",
      appearance: "外观与显示",
      language: "语言偏好",
      themeDark: "深色模式",
      themeLight: "亮色模式",
      langEn: "English",
      langZh: "简体中文",
      close: "关闭"
    }
  }
};

export function getMenuLabel(view: AppView, lang: LangKey): string {
  return translations[lang].menu[view];
}

export function getText(section: 'actions' | 'settings', key: string, lang: LangKey): string {
  // @ts-ignore
  return translations[lang][section][key] || key;
}