<div align="center">
  <a href="https://github.com/WinriseF/CtxRun">
    <img src="images/banner.png" alt="CtxRun" width="100%">
  </a>

  <br />

  <p align="center">
    <a href="https://github.com/WinriseF/CtxRun/actions">
      <img src="https://img.shields.io/github/actions/workflow/status/WinriseF/CtxRun/update-prompts.yml?style=flat-square&logo=github&label=build" alt="Build Status">
    </a>
    <a href="https://tauri.app">
      <img src="https://img.shields.io/badge/built%20with-Tauri-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Built with Tauri">
    </a>
    <a href="https://react.dev">
      <img src="https://img.shields.io/badge/frontend-React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
    </a>
    <a href="https://www.rust-lang.org">
      <img src="https://img.shields.io/badge/backend-Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust">
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/github/license/WinriseF/CtxRun?style=flat-square&color=blue" alt="License">
    </a>
  </p>

  <p><strong>Run with context, AI at your fingertips.</strong></p>
  <p>上下文组装 · 提示词管理 · 全局 AI 终端 · 局域网传输 · 更多</p>
</div>

<br />

**CtxRun** 是一款专为开发者打造的 AI 辅助生产力工具。它集成了代码上下文组装、提示词管理、剪贴板历史、工作流自动化、局域网传输以及一个随时待命的全局 AI 终端，旨在无缝连接你的 IDE 与大语言模型（LLM）。

> **[English Version](./README.md)**

## 核心功能

<table>
  <tr>
    <td width="50%" align="center">
      <img src="images/context.png" alt="Context Forge" width="480"><br>
      <h3>Context Forge (文件整合)</h3>
      <p>智能地将项目文件打包成 LLM 易于理解的格式，支持自动移除注释、过滤二进制文件、实时 Token 预估。支持配置持久化和项目记忆。</p>
    </td>
    <td width="50%" align="center">
      <img src="images/ticiku.png" alt="Prompt Verse" width="480"><br>
      <h3>Prompt Verse (提示词库)</h3>
      <p>高效管理你的 AI 提示词和常用指令。支持变量模板、分组管理，可从官方库下载离线指令包。支持可执行命令和聊天模板配置。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="images/git-diff.png" alt="Patch Weaver" width="480"><br>
      <h3>Patch Weaver (AI 补全 & Git 对比)</h3>
      <p>应用 AI 生成的代码补丁，智能模糊匹配精确定位修改位置。强大的 Git Diff 可视化工具，支持工作目录对比、版本对比及多格式导出（Markdown、JSON、XML、纯文本）。</p>
    </td>
    <td width="50%" align="center">
      <img src="images/auto.png" alt="Automator" width="480"><br>
      <h3>Automator (工作流自动化)</h3>
      <p>可视化节点图工作流引擎，支持条件分支。集成浏览器自动化、键盘/鼠标模拟、颜色检测、循环控制，通过 Windows UIAutomation API 进行语义化 UI 元素定位。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="images/get.png" alt="Transfer" width="480"><br>
      <h3>Transfer (局域网传输)</h3>
      <p>启动本地 HTTP 服务，其他设备扫码即可连接。支持文件传输进度追踪、实时文本聊天，设备连接审批确保安全。</p>
    </td>
    <td width="50%" align="center">
      <img src="images/copy.png" alt="Refinery" width="480"><br>
      <h3>Refinery (剪贴板历史)</h3>
      <p>全面的剪贴板历史管理器，支持文本和图片。具备全文搜索、收藏、笔记、自动清理、日历视图，以及 Spotlight 快捷粘贴集成。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="images/upload.png" alt="Transfer Upload" width="480"><br>
      <h3>Transfer (移动端 Web)</h3>
      <p>移动端友好的 Web 界面，上传文件和发送消息。无需安装 App，扫码即用。</p>
    </td>
    <td width="50%" align="center">
      <img src="images/preview.png" alt="Peek" width="480"><br>
      <h3>Peek (独立预览)</h3>
      <p>弹出式文件预览窗口，支持 DOCX、PDF、HTML、Markdown、图片等多种格式。拖拽文件即可预览，无需离开工作流。</p>
    </td>
  </tr>
</table>

## 更多功能

- **Spotlight (全局 AI 终端)** — 全局快捷键 `Alt+S` 随时唤出。流式 AI 对话、Shell 命令 (`>ls`)、计算器 (`=1+1`)、范围搜索 (`/app`, `/cmd`, `/pmt`)、应用启动。
- **Guard (空闲守护)** — 空闲超时自动锁屏，圆形进度条解锁。Windows 低级钩子全局拦截输入，支持防止系统休眠。
- **Model Miner (网页挖掘)** — 基于 Chromium 的智能网页爬虫，提取页面核心内容并转换为 Markdown，支持并发爬取与深度/页数限制。
- **Agent Tool Runtime** — AI 对话中调用工具（文件系统操作、网页搜索、内容提取），沙箱安全策略配合审批机制。
- **Exec Runtime** — 安全命令执行沙箱，PowerShell AST 分析，审批工作流，完整进程生命周期管理。
- **OCR (文字识别)** — 离线 OCR，基于 PPOCRv5 模型，自动下载模型、SHA-256 校验、空闲资源回收。
- **系统监控** — 电池信息、磁盘详情、网络流量、端口进程监控，文件锁定检测。
- **网络测速** — 集成 M-Lab NDT7 网络速度测试。
- **隐私扫描** — 内置敏感信息检测引擎，白名单管理，防止 API 密钥等机密泄露。

> 想要了解如何使用？**[查看详细使用指南](./USAGE.md)**

## 技术栈

本项目采用现代化的**高性能桌面应用架构**（安装包约 10MB，运行内存约 30MB）：

- **Core**: [Tauri 2](https://tauri.app/) (Rust + WebView2) — 原生级性能，超小安装包，多窗口支持。
- **Frontend**: React 19 + TypeScript + Vite 7 — 现代化前端开发体验。
- **State Management**: Zustand 5 — 轻量强大的状态管理。
- **Internationalization**: i18next + react-i18next — 基于 JSON 的多语言支持（中英文）。
- **Styling**: Tailwind CSS + tailwindcss-animate — 快速构建美观 UI。
- **Database**: SQLite (rusqlite) + Refinery — 本地数据持久化与迁移管理。
- **Editor**: Monaco Editor — VSCode 级代码编辑体验。
- **Testing**: Vitest + Testing Library — 快速单元测试和组件测试（86%+ 覆盖率）。
- **Backend**: 16 个 Rust crate — 模块化架构，覆盖自动化、OCR、爬虫、传输、监控等。
- **Node Graph**: @xyflow/react — Automator 可视化工作流编辑器。
- **Document Preview**: docx-preview、@wooorm/starry-night — DOCX 渲染、语法高亮。

---

## 下载与安装

前往 [Releases](../../releases) 页面下载安装包，或直接下载便携版（**CtxRun.exe**）—— 无需安装，点击即用（数据存储在 `%localappdata%\com.ctxrun`）：

- **Windows**: `.msi` 或 `.exe`

---

## 致谢

- **[tldr-pages](https://github.com/tldr-pages/tldr)** — 命令库数据来源
- **[Awesome ChatGPT Prompts](https://github.com/f/awesome-chatgpt-prompts)** — 提示词库数据来源
- **[gitleaks](https://github.com/gitleaks/gitleaks)** — 敏感信息检测规则参考

---

*CtxRun - Run with context, AI at your fingertips.*
