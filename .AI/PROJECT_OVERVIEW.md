---
name: CtxRun 项目概览
description: CtxRun 项目的完整架构、技术栈、模块划分和开发指南，供 AI 快速理解项目
type: project
---

# CtxRun - AI 驱动的开发者生产力工具

---
## AI须知，对于AI非常重要

>不要尝试运行npm run tauri dev或者npm run tauri build，因为在沙箱环境会出现严重的依赖缺失，但是你可以通过模块来运行检查后端模块的编译情况，npm run build来检查前端情况

>默认安装最新的包，无论是前端还是后端包都尽量安装最新的

## 架构总览

**Tauri 2 桌面应用** = React 19 前端 + Rust 后端，多窗口架构。

```
CtxRun/
├── src/                    # 前端 (React 19 + TypeScript)
│   ├── main.tsx            # 入口，按窗口 label 懒加载不同 App
│   ├── windows/            # 5 个窗口应用
│   │   ├── MainWindowApp.tsx       # 主窗口 (7 个视图)
│   │   ├── SpotlightWindowApp.tsx  # 全局 AI 终端 (Alt+S)
│   │   ├── PeekWindowApp.tsx       # 独立预览窗口
│   │   ├── GuardWindowApp.tsx      # 空闲锁屏
│   │   └── TransferWindowApp.tsx   # 局域网传输
│   ├── store/              # 14 个 Zustand 状态仓库
│   ├── components/         # UI 组件 (shadcn/ui)
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具函数
│   └── locales/            # i18n 翻译文件 (中/英)
├── src-tauri/              # 后端 (Rust + Tauri 2)
│   ├── src/main.rs         # 入口：注册 277 个 Tauri 命令、16 个插件
│   └── crates/             # 16 个 Rust crate (模块化)
├── models/                 # OCR 模型文件 (PPOCRv5)
├── tests/                  # 测试文件 (32 个)
└── dist/                   # 构建输出
```

---

## 技术栈

### 前端 (~196 TS/TSX 文件, ~36,330 行)

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | React + TypeScript | 19.2.4 / 5.9.3 |
| 构建 | Vite | 7.2.4 |
| UI | shadcn/ui (new-york) + Tailwind CSS 3.4 | |
| 状态管理 | Zustand | 5.0.11 (14 个 store) |
| 编辑器 | Monaco Editor | 0.55.1 |
| 国际化 | i18next + react-i18next | |
| 节点图 | @xyflow/react | 12.10.0 |
| 动画 | Framer Motion | 12.34.1 |
| 测试 | Vitest + Testing Library | 86%+ 覆盖率 |

### 后端 (16 个 Rust crate, 345 个 .rs 文件)

| 类别 | 技术 | 用途 |
|------|------|------|
| 框架 | Tauri 2.9 | 桌面应用核心 |
| 异步 | Tokio 1.x | 异步运行时 |
| HTTP | reqwest 0.12 + axum 0.8 | 客户端 + 服务器 |
| 数据库 | rusqlite 0.37 + refinery 0.9 | SQLite + 迁移 |
| Git | git2 0.19 + similar 2.6 | Git 操作 + Diff |
| OCR | ocr-rs 2.2.2 | PPOCRv5 离线 OCR |
| 浏览器 | chromiumoxide 0.9.1 | 无头 Chromium 自动化 |
| 输入模拟 | enigo 0.6.1 | 键盘鼠标模拟 |
| 系统 | sysinfo 0.37 | 系统监控 |
| Token | tiktoken-rs 0.9 | Token 计数 |
| Windows | windows 0.61 | 20+ Win32 API |

---

## 10 大功能模块

| # | 模块名 | 功能 | 前端关键文件 | 后端 Crate |
|---|--------|------|-------------|------------|
| 1 | **Context Forge** | 智能打包项目文件为 LLM 友好格式，自动去注释、过滤二进制、实时 Token 估算 | `store/useContextStore.ts` | `context` |
| 2 | **Prompt Verse** | AI Prompt 库管理，支持变量模板、分组、离线 Prompt 包 | `store/usePromptStore.ts` | `db` |
| 3 | **Patch Weaver** | 应用 AI 生成的代码补丁（智能模糊匹配）+ Git Diff 可视化 | `store/useGitOpsStore.ts` | `git` |
| 4 | **Automator** | 可视化节点图工作流引擎，条件分支、浏览器自动化、键鼠模拟 | `store/useAutomatorStore.ts` | `automator` |
| 5 | **Transfer** | 局域网 HTTP 文件传输 + 二维码连接 + 实时聊天 | `store/useTransferStore.ts` | `transfer` |
| 6 | **Refinery** | 剪贴板历史管理，支持文本/图片搜索、置顶、备注、自动清理 | `store/useRefineryStore.ts` | `refinery` |
| 7 | **Spotlight** | 全局 AI 终端 (Alt+S)，流式对话、Shell 命令、计算器、应用启动 | `windows/SpotlightWindowApp.tsx` | `tool-runtime` |
| 8 | **Peek** | 独立文件预览弹窗 (DOCX/PDF/HTML/MD/图片) | `windows/PeekWindowApp.tsx` | `hyperview` |
| 9 | **Guard** | 空闲自动锁屏，圆形进度环解锁，全局输入拦截 | `windows/GuardWindowApp.tsx` | - |
| 10 | **System Monitor** | 电池、磁盘、网络流量、端口/进程监控、网速测试 | 组件内 | `env-probe` |

### 额外功能

- **Model Miner** - 无头 Chromium 驱动的网页抓取器 (`miner` crate)
- **Agent Tool Runtime** - AI 对话中的工具调用，沙箱安全 (`tool-runtime` crate)
- **Exec Runtime** - 安全命令执行，PowerShell AST 分析 (`exec-runtime` crate)
- **OCR** - 基于 PPOCRv5 的离线 OCR (`ocr` crate)
- **Privacy Scan** - 内置敏感信息检测引擎 (`context` crate, gitleaks 集成)

---

## Rust Crate 结构 (src-tauri/crates/)

| Crate | 职责 |
|-------|------|
| `automator` | 工作流自动化引擎 |
| `browser-utils` | 浏览器检测工具 |
| `context` | 文件上下文组装 + gitleaks 集成 |
| `db` | 数据库操作 + 迁移 |
| `env-probe` | 环境探测 + 系统监控 |
| `exec-runtime` | 安全命令执行沙箱 |
| `git` | Git 操作 + 导出 |
| `hyperview` | 文件预览工具 |
| `miner` | 网页抓取 |
| `ocr` | OCR 服务 |
| `process-utils` | 进程辅助 |
| `refinery` | 剪贴板历史管理 |
| `runtime-utils` | 运行时辅助 |
| `tool-runtime` | Agent 工具运行时 |
| `transfer` | 局域网文件传输 |
| `workspace-tests` | 集成测试 |

---

## 开发命令

```bash
npm install           # 安装依赖
npm run dev           # 启动前端开发服务器 (port 1420)
npm run tauri dev     # 启动完整 Tauri 开发模式，但是在沙箱无法运行成功

npx tsc --noEmit      # TypeScript 类型检查
npm run build         # 构建前端 (tsc && vite build)
npm run tauri build   # 构建发布版 (生成安装包)，在沙箱无法运行成功

npm run test          # 运行测试
npm run test:coverage # 测试 + 覆盖率报告
npm run test:watch    # 测试监听模式

npm run deadcode      # 前端死代码检测 (knip)
npm run deadcode:rust # Rust 死代码检测 (cargo machete)
npm run lint:rust     # Rust lint (cargo clippy)
```

---

## CI/CD (GitHub Actions)

| 工作流 | 用途 |
|--------|------|
| `ci.yml` | 前端 + Rust 检查、类型检查、测试覆盖率 |
| `update-prompts.yml` | 每周自动更新 Prompt 库 (tldr + Awesome ChatGPT Prompts) |
| `sync-ocr-models.yml` | OCR 模型同步 |
| `release.yml` | 发布自动化 |

---

## 状态管理 (Zustand Stores)

14 个 store 位于 `src/store/`:

- `useAppStore` - 全局设置 (主题、语言、模型)
- `useAutomatorStore` - 工作流自动化
- `useContextStore` - 文件组装
- `useExecStore` - 命令执行
- `usePromptStore` - Prompt 库
- `useRefineryStore` - 剪贴板历史
- `useGitOpsStore` - Git 操作
- `useMinerStore` - 网页抓取
- `useTransferStore` - 局域网传输
- 以及 5 个其他专用 store

---

## 国际化

- 框架: i18next + react-i18next
- 支持语言: 中文 (zh)、英文 (en)
- 翻译文件: `src/locales/`
- 文档: README / USAGE / DEV 均有中英双语

---

## 测试

- 框架: Vitest + Testing Library
- 覆盖率目标: 70%+ (vitest.config.ts 配置)
- 实际覆盖率: 86%+
- 测试文件: 32 个，位于 `tests/` 目录
- 死代码检测: knip (前端) + cargo machete (Rust)
