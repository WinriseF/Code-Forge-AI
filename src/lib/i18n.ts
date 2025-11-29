import { AppView } from "@/store/useAppStore";

export type LangKey = 'zh' | 'en';

const translations = {
  en: {
    menu: {
      prompts: "Prompt Verse",
      context: "Context Forge",
      patch: "Patch Weaver",
      settings: "Settings"
    },
    sidebar: {
      library: "LIBRARY",
      all: "All Prompts",
      favorites: "Favorites",
      groups: "GROUPS",
      newGroup: "New Group"
    },
    prompts: {
      searchPlaceholder: "Search prompts (cmd, desc...)",
      new: "New",
      noResults: "No prompts found",
      copySuccess: "Copied to clipboard!",
      deleteTitle: "Delete Prompt?",
      deleteMessage: "Are you sure you want to delete \"{name}\"? This action cannot be undone.",
      confirmDelete: "Delete",
      cancel: "Cancel",
      official: "Official",
      local: "Local" // Added
    },
    context: {
      searchPlaceholder: "Paste path or browse...",
      browse: "Browse...",
      scanning: "Scanning...",
      scan: "Scan",
      explorer: "EXPLORER",
      selectedCount: "{count} selected",
      filters: "Filters",
      emptyDir: "Empty directory",
      enterPath: "Enter a path to open",
      tabDashboard: "Dashboard",
      tabPreview: "Preview",
      toastCopied: "Context copied to clipboard!",
      toastCopyFail: "Failed to copy context",
      toastSaved: "Context saved to file!",
      toastSaveFail: "Failed to save file",
      filterDirs: "Folders",
      filterFiles: "Files",
      filterExts: "Exts",
      filterPlaceholder: "Ignore {type}...",
      noFilters: "No filters active",
      previewTitle: "Content Preview",
      chars: "{count} characters",
      generating: "Generating Preview...",
      noFiles: "No files selected.",
      copied: "Copied!",
      statSelected: "Selected Files",
      statSize: "Total Size",
      statTokens: "Est. Tokens",
      langBreakdown: "Language Breakdown",
      bySize: "By Size",
      estCost: "Est. API Cost (Input)",
      costNote: "Calculated based on current token count and synced pricing.",
      contextUsage: "Context Usage",
      topFiles: "Top Token Hogs",
      largestFiles: "Largest Files",
      tipSelect: "Select files from the left tree",
      btnCopy: "Copy to Clipboard",
      btnSave: "Save to File...",
      processing: "Processing...",
      removeComments: "Remove Comments"
    },
    editor: {
      titleNew: "New Prompt",
      titleEdit: "Edit Prompt",
      labelTitle: "TITLE",
      labelGroup: "GROUP",
      labelContent: "CONTENT TEMPLATE",
      placeholderTitle: "e.g. Git Undo Commit",
      placeholderGroup: "New group name...",
      placeholderContent: "Enter command or prompt. Use {{variable}} for slots.",
      tip: "Tip: Use {{variable}} to create fillable slots",
      btnSave: "Save Prompt",
      btnCancel: "Cancel",
      btnNewGroup: "New Group"
    },
    filler: {
      title: "Fill Variables",
      preview: "PREVIEW RESULT",
      btnCopy: "Copy Result",
      btnCancel: "Cancel"
    },
    settings: {
      title: "Settings",
      navAppearance: "Appearance",
      navLanguage: "Language",
      navFilters: "Global Filters",
      navLibrary: "Library",
      navAI: "AI Configuration",
      appearance: "Appearance",
      language: "Language",
      themeDark: "Dark Theme",
      themeLight: "Light Theme",
      langEn: "English",
      langZh: "Chinese (Simplified)",
      filtersTitle: "Global Ignore Rules",
      filtersDesc: "Files matching these rules will be excluded from ALL projects by default.",
      close: "Close",
      spotlightSize: "Spotlight Window Size",
      width: "Width",
      widthTip: "Adjust the width of the command palette (500px - 1000px).",
      chatHeight: "Max Chat Height",
      aiTitle: "AI Provider Settings",
      aiDesc: "Configure your LLM provider to enable Spotlight AI Chat.",
      provider: "Provider",
      apiKey: "API Key",
      apiKeyTip: "Your key is stored locally and never synced.",
      temp: "Temperature",
      tempTip: "Controls randomness: Lower values are more deterministic, higher values are more creative.",
      baseUrl: "Base URL (Optional)",
      modelId: "Model ID"
    },
    library: {
      title: "Official Library",
      desc: "Download offline prompt packs. Data source: ",
      update: "Update",
      download: "Download",
      installed: "Installed",
      uninstall: "Uninstall",
      prompts: "prompts",
      noPacks: "No packs available for current language.",
      loading: "Loading library..."
    },
    spotlight: {
      searchPlaceholder: "Search commands...",
      chatPlaceholder: "Ask AI anything...",
      noCommands: "No matching commands.",
      aiReady: "AI Assistant Ready",
      aiDesc: "Type your question and press Enter to start chatting with",
      ephemeral: "Ephemeral Mode (History not saved)",
      thinking: "Thinking Process",
      results: "results",
      console: "AI Console",
      nav: "Navigate",
      enter: "Enter",
      copy: "Copy",
      clear: "Clear",
      send: "Send",
      close: "Close"
    },
    actions: {
      collapse: "Collapse Sidebar",
      expand: "Expand Sidebar",
      edit: "Edit",
      delete: "Delete",
      copy: "Copy"
    }
  },
  zh: {
    menu: {
      prompts: "提词库",
      context: "文件整合",
      patch: "代码织补机",
      settings: "设置"
    },
    sidebar: {
      library: "资料库",
      all: "全部指令",
      favorites: "我的收藏",
      groups: "分组列表",
      newGroup: "新建分组"
    },
    prompts: {
      searchPlaceholder: "搜索指令 (名称、描述、代码)...",
      new: "新建指令",
      noResults: "没有找到相关指令",
      copySuccess: "已复制到剪贴板",
      deleteTitle: "确认删除?",
      deleteMessage: "您确定要删除指令 “{name}” 吗？此操作无法撤销。",
      confirmDelete: "确认删除",
      cancel: "取消",
      official: "官方",
      local: "本地" // Added
    },
    context: {
      searchPlaceholder: "粘贴路径或浏览...",
      browse: "浏览...",
      scanning: "扫描中...",
      scan: "扫描",
      explorer: "资源管理器",
      selectedCount: "已选 {count} 项",
      filters: "过滤规则",
      emptyDir: "空目录",
      enterPath: "请输入或选择路径",
      tabDashboard: "仪表盘",
      tabPreview: "预览",
      toastCopied: "上下文已复制到剪贴板！",
      toastCopyFail: "复制失败",
      toastSaved: "上下文已保存到文件！",
      toastSaveFail: "保存文件失败",
      filterDirs: "文件夹",
      filterFiles: "文件",
      filterExts: "后缀",
      filterPlaceholder: "忽略 {type}...",
      noFilters: "暂无过滤规则",
      previewTitle: "内容预览",
      chars: "{count} 字符",
      generating: "正在生成预览...",
      noFiles: "未选择任何文件",
      copied: "已复制!",
      statSelected: "选中文件",
      statSize: "总大小",
      statTokens: "预估 Token",
      langBreakdown: "语言分布",
      bySize: "按比例",
      estCost: "预估 API 成本 (输入)",
      costNote: "基于当前 Token 数量和云端价格计算。",
      contextUsage: "上下文窗口占用",
      topFiles: "Token 消耗大户",
      largestFiles: "最大文件 Top 5",
      tipSelect: "请从左侧文件树选择文件",
      btnCopy: "复制上下文",
      btnSave: "保存为文件...",
      processing: "处理中...",
      removeComments: "移除注释"
    },
    editor: {
      titleNew: "新建指令",
      titleEdit: "编辑指令",
      labelTitle: "标题",
      labelGroup: "分类",
      labelContent: "内容模板",
      placeholderTitle: "例如：Git 撤销 Commit",
      placeholderGroup: "输入新分类名称...",
      placeholderContent: "输入命令或 Prompt。支持变量：{{name}}",
      tip: "提示: 使用 {{变量名}} 创建填空位",
      btnSave: "保存指令",
      btnCancel: "取消",
      btnNewGroup: "新建"
    },
    filler: {
      title: "填充变量",
      preview: "预览结果",
      btnCopy: "复制结果",
      btnCancel: "取消"
    },
    settings: {
      title: "设置",
      navAppearance: "外观设置",
      navLanguage: "语言选项",
      navFilters: "全局过滤",
      navLibrary: "指令商店",
      navAI: "AI 配置",
      appearance: "外观与显示",
      language: "语言偏好",
      themeDark: "深色模式",
      themeLight: "亮色模式",
      langEn: "English",
      langZh: "简体中文",
      filtersTitle: "全局忽略规则",
      filtersDesc: "匹配这些规则的文件将默认从所有项目中排除（如 node_modules）。",
      close: "关闭",
      // Appearance Section Added
      spotlightSize: "Spotlight 窗口尺寸",
      width: "宽度",
      widthTip: "调整命令面板的宽度 (500px - 1000px)。",
      chatHeight: "对话最大高度",
      // AI Section Added
      aiTitle: "AI 服务商设置",
      aiDesc: "配置您的大模型服务商以启用 Spotlight AI 对话功能。",
      provider: "服务商",
      apiKey: "API Key",
      apiKeyTip: "您的 Key 仅存储在本地，不会上传到云端。",
      temp: "温度 (Temperature)",
      tempTip: "控制随机性：数值越低越严谨，数值越高越有创造力。",
      baseUrl: "API 地址 (可选)",
      modelId: "模型 ID"
    },
    library: {
      title: "官方指令库",
      desc: "下载离线指令包到本地。数据来源：",
      update: "更新",
      download: "下载",
      installed: "已安装",
      uninstall: "卸载",
      prompts: "条指令",
      noPacks: "当前语言暂无可用数据包。",
      loading: "正在加载商店..."
    },
    spotlight: {
      searchPlaceholder: "搜索指令...",
      chatPlaceholder: "询问 AI...",
      noCommands: "没有匹配的指令。",
      aiReady: "AI 助手就绪",
      aiDesc: "输入问题并按回车键，开始与",
      ephemeral: "即时模式 (不保存历史记录)",
      thinking: "思考过程",
      results: "项结果",
      console: "AI 控制台",
      nav: "选择",
      enter: "确认",
      copy: "复制",
      clear: "清空",
      send: "发送",
      close: "关闭"
    },
    actions: {
      collapse: "收起侧栏",
      expand: "展开侧栏",
      edit: "编辑",
      delete: "删除",
      copy: "复制"
    }
  }
};

export function getMenuLabel(view: AppView, lang: LangKey): string {
  return translations[lang].menu[view];
}

export function getText(
  section: keyof typeof translations['en'], 
  key: string, 
  lang: LangKey,
  vars?: Record<string, string>
): string {
  // @ts-ignore
  let text = translations[lang][section]?.[key] || key;
  
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, v);
    });
  }
  
  return text;
}