# Third-Party Notices

This document contains attributions and license information for third-party components used in CtxRun.

## Project License

CtxRun is distributed under the **GNU General Public License v3.0 (GPL-3.0)**. See [LICENSE](LICENSE) for full details.

---

## Open Source Libraries

### Frontend Dependencies (JavaScript/TypeScript)

| Package | License | Author |
|---------|---------|--------|
| **React** | MIT | Meta Platforms, Inc. |
| **React DOM** | MIT | Meta Platforms, Inc. |
| **Zustand** | MIT | pmndrs |
| **Monaco Editor** | MIT | Microsoft Corporation |
| **@monaco-editor/react** | MIT | Suren A. Chilingaryan |
| **Tailwind CSS** | MIT | Tailwind Labs |
| **Vite** | MIT | Vue.js Team |
| **Framer Motion** | MIT | Framer Motion, Inc. |
| **Lucide React** | MIT | Lucide Contributors |
| **React Markdown** | MIT | Espen Hovlandsdal |
| **remark-gfm** | MIT | Titus Wormer |
| **tailwind-merge** | MIT | dcastil |
| **i18next** | MIT | Jan Mühlemann |
| **react-i18next** | MIT | Jan Mühlemann |
| **@xyflow/react** | BUSL-1.1 | xyflow GmbH (formerly React Flow) |
| **clsx** | MIT | Sergey Sova |
| **react-virtuoso** | MIT | Petyo Ivanov |
| **react-window** | MIT | Brian Vaughn |
| **react-virtualized-auto-sizer** | MIT | bvaughn |
| **react-icons** | MIT | Gonçalo Marques |
| **tailwindcss-animate** | MIT | Hero Labs |
| **@m-lab/ndt7** | Apache-2.0 | Measurement Lab |
| **@spaceymonk/react-radial-menu** | MIT | spaceymonk |
| **docx-preview** | MIT | Volodymyr Bay |
| **github-markdown-css** | MIT | Sindre Sorhus |
| **hast-util-to-jsx-runtime** | MIT | Titus Wormer |
| **papaparse** | MIT | Matthew Holt |
| **react-zoom-pan-pinch** | MIT | Przemyslaw Zyla |
| **rehype-autolink-headings** | MIT | Titus Wormer |
| **rehype-slug** | MIT | Titus Wormer |
| **@wooorm/starry-night** | MIT | Titus Wormer |
| **vscode-oniguruma** | MIT | Microsoft Corporation |
| **xml-formatter** | MIT | Cheton Wu |
| **@lottiefiles/dotlottie-react** | MIT | LottieFiles |
| **uuid** | MIT | Robert Kieffer |

### Backend Dependencies (Rust)

| Crate | License | Description |
|-------|---------|-------------|
| **tauri** | MIT OR Apache-2.0 | Core application framework |
| **tauri-build** | MIT OR Apache-2.0 | Tauri build tools |
| **tauri-plugin-shell** | MIT OR Apache-2.0 | Shell command execution |
| **tauri-plugin-fs** | MIT OR Apache-2.0 | File system access |
| **tauri-plugin-dialog** | MIT OR Apache-2.0 | Native dialogs |
| **tauri-plugin-http** | MIT OR Apache-2.0 | HTTP client |
| **tauri-plugin-clipboard-manager** | MIT OR Apache-2.0 | Clipboard access |
| **tauri-plugin-os** | MIT OR Apache-2.0 | OS information |
| **tauri-plugin-single-instance** | MIT OR Apache-2.0 | Single instance app |
| **tauri-plugin-global-shortcut** | MIT OR Apache-2.0 | Global keyboard shortcuts |
| **rusqlite** | MIT | SQLite bindings |
| **sysinfo** | MIT | System information |
| **git2** | MIT OR Apache-2.0 | Git bindings |
| **reqwest** | MIT OR Apache-2.0 | HTTP client |
| **tokio** | MIT | Async runtime |
| **futures** | MIT OR Apache-2.0 | Future utilities |
| **serde** | MIT OR Apache-2.0 | Serialization |
| **serde_json** | MIT OR Apache-2.0 | JSON serialization |
| **refinery** | MIT OR Apache-2.0 | Database migrations |
| **regex** | MIT OR Apache-2.0 | Regular expressions |
| **rayon** | MIT OR Apache-2.0 | Parallelism |
| **enigo** | MIT | Mouse/Keyboard input simulation |
| **arboard** | MIT OR Apache-2.0 | Clipboard access |
| **entropy** | MIT | Shannon entropy calculation |
| **ignore** | MIT OR Apache-2.0 | .gitignore parsing |
| **tiktoken-rs** | MIT | OpenAI token counting |
| **which** | MIT | Find executable in PATH |
| **uuid** | MIT OR Apache-2.0 | UUID generation |
| **chrono** | MIT OR Apache-2.0 | Date and time |
| **clipboard-rs** | MIT OR Apache-2.0 | Clipboard monitoring |
| **image** | MIT OR Apache-2.0 | Image encoding |
| **xxhash-rust** | BSD-2-Clause | Fast hashing |
| **crossbeam-channel** | MIT OR Apache-2.0 | Multi-producer multi-consumer channels |
| **x-win** | MIT | Windows window manipulation |
| **walkdir** | MIT OR Apache-2.0 | Directory traversal |
| **once_cell** | MIT OR Apache-2.0 | Lazy static initialization |
| **ocr-rs** | MIT | OCR functionality |
| **similar** | MIT | Text diffing |
| **thiserror** | MIT OR Apache-2.0 | Error handling |
| **axum** | MIT | HTTP framework (Transfer server) |
| **tokio-util** | MIT | Async utilities (io, rt) |
| **qrcode** | MIT OR Apache-2.0 | QR code generation |
| **percent-encoding** | MIT OR Apache-2.0 | Percent encoding |
| **serde_rusqlite** | MIT | Serde integration for rusqlite |
| **windows** | MIT OR Apache-2.0 | Windows API bindings |
| **xcap** | MIT OR Apache-2.0 | Screen capture |
| **uiautomation** | MIT | Windows UI Automation bindings |
| **csv** | MIT OR Apache-2.0 | CSV parsing |
| **starship-battery** | ISC | Battery information |
| **mime_guess** | MIT | MIME type detection |
| **infer** | MIT | File type detection |
| **base64** | MIT OR Apache-2.0 | Base64 encoding |
| **url** | MIT OR Apache-2.0 | URL parsing |
| **genai** | Apache-2.0 | Generative AI |
| **headless_chrome** | MIT OR Apache-2.0 | Headless Chrome control |
| **listeners** | MIT | Event listeners |
| **wait-timeout** | MIT | Timeout wait |
| **sanitize-filename** | MIT | Filename sanitization |

### Internal Workspace Crates

| Crate | License | Description |
|-------|---------|-------------|
| **ctxrun-db** | MIT | Database layer |
| **ctxrun-browser-utils** | MIT | Browser automation utilities |
| **ctxrun-env-probe** | MIT | Environment detection |
| **ctxrun-hyperview** | MIT | Document preview |
| **ctxrun-process-utils** | MIT | Process management |
| **ctxrun-runtime-utils** | MIT | Runtime utilities |
| **ctxrun-plugin-automator** | MIT | Workflow automation engine |
| **ctxrun-plugin-context** | MIT | Context assembly |
| **ctxrun-plugin-git** | MIT | Git diff and patch |
| **ctxrun-plugin-refinery** | MIT | Clipboard history |
| **ctxrun-plugin-miner** | MIT | Web content mining |
| **ctxrun-plugin-ocr** | MIT | OCR processing |
| **ctxrun-plugin-tool-runtime** | MIT | AI tool invocation |
| **ctxrun-plugin-exec-runtime** | MIT | Command execution sandbox |
| **ctxrun-plugin-transfer** | MIT | LAN file transfer |

---

## Data Sources

The following open data projects are partially sourced in this application:

| Project | License | Description |
|---------|---------|-------------|
| **tldr-pages** | CC BY 4.0 | Simplified command line documentation |
| **Awesome ChatGPT Prompts** | CC0 1.0 | Curated AI prompts collection |
| **awesome-gpt-image-2** | CC BY 4.0 | GPT Image 2 prompt library (16 languages) |

> **Note**: The tldr-pages data is licensed under CC BY 4.0. When using or distributing command documentation from this project, please attribute appropriately. See https://github.com/tldr-pages/tldr for details.
>
> **Note**: The awesome-gpt-image-2 data is licensed under CC BY 4.0. All prompts are collected from the community for educational purposes. See https://github.com/YouMind-OpenLab/awesome-gpt-image-2 for details.

---

## Architecture References

The following project was referenced for architecture and implementation patterns:

| Project | License | Usage |
|---------|---------|-------|
| **OpenAI Codex CLI (codex-rs)** | Apache License 2.0 | Inspired tool orchestration, sandbox policy, and patch-runtime design patterns used in `ctxrun-plugin-tool-runtime`. |

> **Compliance note**: CtxRun keeps Apache-2.0 attribution for referenced patterns and avoids direct code copy without preserving required notices.

---

## Font and Icon Resources

| Resource | License | Description |
|----------|---------|-------------|
| **Lucide Icons** | MIT | SVG icon set |

---

## Where to Find Full License Texts

### Frontend Dependencies
Full license texts for all npm packages are available in the `node_modules/*/LICENSE` directories of the project source code.

To view all licenses for frontend dependencies:
```bash
# View a summary
npm list --depth=0

# Check specific package license
cat node_modules/[package-name]/LICENSE
```

### Backend Dependencies
Rust crate license information is documented in:
- `src-tauri/Cargo.toml` - Direct dependencies
- `src-tauri/Cargo.lock` - All transitive dependencies with licenses

To check backend dependencies:
```bash
cd src-tauri
cargo license --summary
```

---

## Acknowledgments

We thank all the maintainers and contributors of the open source projects that make CtxRun possible.

---

*This document was last updated on 2026-04-28.*
