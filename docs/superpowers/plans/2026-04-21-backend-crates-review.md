# CtxRun 后端 Crates 全面审查实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 CtxRun 的 16 个 Rust crate + 主应用入口进行逐模块深度审查，产出结构化审查报告。

**Architecture:** 按依赖关系从底层到上层审查。每个审查任务由独立 Agent 执行，读取源码并按 5 个维度评估（代码质量、安全性、架构设计、性能、可维护性）。主线程汇总所有 Agent 结果生成最终报告。

**Tech Stack:** Rust crates in Tauri workspace (`src-tauri/crates/`), main app in `src-tauri/src/`.

---

## 审查维度说明

每个 crate 按以下 5 个维度评估，问题按 4 级严重度分类：

**维度：**
1. **代码质量** — 命名规范、错误处理、复杂度、unwrap/expect 滥用、死代码
2. **安全性** — 命令注入、SQL 注入、路径遍历、unsafe 块、敏感数据
3. **架构设计** — 单一职责、公共 API、依赖合理性、抽象层次
4. **性能** — 异步模式、内存分配（clone 滥用）、锁竞争
5. **可维护性** — 测试覆盖、文档注释、配置硬编码

**严重度：**
- 🔴 严重 — 安全漏洞、数据丢失、崩溃风险
- 🟠 高 — 可靠性问题（特定条件触发）
- 🟡 中 — 设计不合理但不影响当前功能
- 🔵 低 — 代码风格、建议性改进

---

## 第一批：基础层（无内部依赖）

### Task 1: 审查 db crate

**Files:**
- Review: `src-tauri/crates/db/src/lib.rs` (14 lines)
- Review: `src-tauri/crates/db/src/error.rs` (102 lines)
- Review: `src-tauri/crates/db/src/models.rs` (110 lines)
- Review: `src-tauri/crates/db/src/init.rs` (189 lines)
- Review: `src-tauri/crates/db/src/prompts.rs` (592 lines)
- Review: `src-tauri/crates/db/src/url_history.rs` (169 lines)
- Review: `src-tauri/crates/db/src/shell_history.rs` (138 lines)
- Review: `src-tauri/crates/db/src/project_config.rs` (142 lines)
- Review: `src-tauri/crates/db/src/apps.rs` (108 lines)
- Review: `src-tauri/crates/db/src/secrets.rs` (89 lines)

- [ ] **Step 1: 读取 db crate 所有源文件**

读取上述全部 10 个文件，重点关注：
- `init.rs` — 数据库初始化和迁移逻辑
- `prompts.rs` — 最大的文件（592 行），SQL 查询密集
- `secrets.rs` — 敏感数据存储

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：SQL 查询是否使用参数化？是否有字符串拼接构造 SQL？
- **错误处理**：rusqlite 错误是否正确传播？
- **性能**：是否有 N+1 查询模式？索引使用是否合理？
- **架构**：模块划分是否合理？公共 API 是否最小化？

- [ ] **Step 3: 输出审查结果到报告文件**

追加结果到 `docs/superpowers/reports/2026-04-21-backend-crates-review-report.md` 的 db 章节。

---

### Task 2: 审查 runtime-utils crate

**Files:**
- Review: `src-tauri/crates/runtime-utils/src/lib.rs` (12 lines)
- Review: `src-tauri/crates/runtime-utils/src/idle.rs` (164 lines)
- Review: `src-tauri/crates/runtime-utils/src/tasks.rs` (193 lines)
- Review: `src-tauri/crates/runtime-utils/src/wait.rs` (158 lines)
- Review: `src-tauri/crates/runtime-utils/src/time.rs` (59 lines)

- [ ] **Step 1: 读取 runtime-utils 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **性能**：异步定时器实现是否高效？是否有不必要的轮询？
- **架构**：作为共享工具库，公共 API 是否精简？
- **安全性**：idle 检测是否有竞态条件？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 3: 审查 process-utils crate

**Files:**
- Review: `src-tauri/crates/process-utils/src/lib.rs` (69 lines)

- [ ] **Step 1: 读取 process-utils 源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **架构**：功能是否足够独立为单独 crate？69 行是否值得独立？
- **安全性**：进程操作是否安全？

- [ ] **Step 3: 输出审查结果到报告文件**

---

## 第二批：核心功能层

### Task 4: 审查 git crate

**Files:**
- Review: `src-tauri/crates/git/src/lib.rs` (23 lines)
- Review: `src-tauri/crates/git/src/error.rs` (75 lines)
- Review: `src-tauri/crates/git/src/models.rs` (85 lines)
- Review: `src-tauri/crates/git/src/commands.rs` (760 lines)
- Review: `src-tauri/crates/git/src/export.rs` (227 lines)

- [ ] **Step 1: 读取 git crate 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：文件路径是否验证？是否防止路径遍历？
- **性能**：git2 操作是否在异步上下文中正确使用？是否有阻塞操作混入 async？
- **代码质量**：commands.rs 760 行是否过大？是否需要拆分？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 5: 审查 context crate

**Files:**
- Review: `src-tauri/crates/context/src/lib.rs` (29 lines)
- Review: `src-tauri/crates/context/src/error.rs` (68 lines)
- Review: `src-tauri/crates/context/src/core.rs` (101 lines)
- Review: `src-tauri/crates/context/src/scanner.rs` (347 lines)
- Review: `src-tauri/crates/context/src/commands.rs` (158 lines)
- Review: `src-tauri/crates/context/src/processing.rs` (29 lines)
- Review: `src-tauri/crates/context/src/tokenizer.rs` (9 lines)
- Review: `src-tauri/crates/context/src/gitleaks/mod.rs` (267 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rule.rs` (26 lines)
- Review: `src-tauri/crates/context/src/gitleaks/allowlist.rs` (85 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rules_ai.rs` (71 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rules_cloud.rs` (155 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rules_communication.rs` (143 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rules_package.rs` (194 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rules_payment.rs` (118 lines)
- Review: `src-tauri/crates/context/src/gitleaks/rules_remaining.rs` (184 lines)

- [ ] **Step 1: 读取 context crate 所有源文件（16 个文件）**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：gitleaks 规则的正则表达式是否有 ReDoS 风险？secret 检测是否可靠？
- **性能**：rayon 并行扫描实现是否高效？大文件处理是否有内存问题？
- **架构**：gitleaks 子模块（1,243 行）是否应该独立为单独 crate？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 6: 审查 exec-runtime crate（安全敏感）

**Files:**
- Review: `src-tauri/crates/exec-runtime/src/lib.rs` (29 lines)
- Review: `src-tauri/crates/exec-runtime/src/utils.rs` (10 lines)
- Review: `src-tauri/crates/exec-runtime/src/models.rs` (167 lines)
- Review: `src-tauri/crates/exec-runtime/src/safety.rs` (580 lines)
- Review: `src-tauri/crates/exec-runtime/src/manager.rs` (501 lines)
- Review: `src-tauri/crates/exec-runtime/src/commands.rs` (62 lines)

- [ ] **Step 1: 读取 exec-runtime 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

**⚠️ 高安全敏感度 — 重点审查：**
- **安全性**：命令注入防护是否完整？安全检查（safety.rs 580 行）是否可绕过？是否有 shell metacharacter 过滤不完整的情况？
- **安全性**：是否允许执行任意命令？白名单/黑名单机制是否健壮？
- **性能**：进程管理的生命周期是否正确？是否有僵尸进程风险？
- **架构**：安全策略与执行逻辑是否充分分离？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 7: 审查 tool-runtime crate

**Files:**
- Review: `src-tauri/crates/tool-runtime/src/lib.rs` (32 lines)
- Review: `src-tauri/crates/tool-runtime/src/models.rs` (103 lines)
- Review: `src-tauri/crates/tool-runtime/src/commands.rs` (18 lines)
- Review: `src-tauri/crates/tool-runtime/src/runtime.rs` (224 lines)
- Review: `src-tauri/crates/tool-runtime/src/sandbox.rs` (134 lines)
- Review: `src-tauri/crates/tool-runtime/src/fs_tools.rs` (670 lines)
- Review: `src-tauri/crates/tool-runtime/src/agent_fs.rs` (538 lines)
- Review: `src-tauri/crates/tool-runtime/src/miner_tools.rs` (683 lines)

- [ ] **Step 1: 读取 tool-runtime 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：sandbox.rs 沙箱实现是否可靠？fs_tools 和 agent_fs 的文件操作是否有路径遍历防护？
- **性能**：大文件读写是否有流式处理？内存使用是否可控？
- **架构**：fs_tools.rs (670 行) 和 miner_tools.rs (683 行) 是否需要拆分？
- **代码质量**：工具注册和分发机制是否清晰？

- [ ] **Step 3: 输出审查结果到报告文件**

---

## 第三批：功能模块层

### Task 8: 审查 browser-utils crate

**Files:**
- Review: `src-tauri/crates/browser-utils/src/lib.rs` (295 lines)
- Review: `src-tauri/crates/browser-utils/src/error.rs` (24 lines)

- [ ] **Step 1: 读取 browser-utils 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：浏览器路径检测是否可被利用？是否验证可执行文件真实性？
- **架构**：作为 automator 和 miner 的共享依赖，API 是否稳定？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 9: 审查 env-probe crate

**Files:**
- Review: `src-tauri/crates/env-probe/src/lib.rs` (239 lines)
- Review: `src-tauri/crates/env-probe/src/error.rs` (77 lines)
- Review: `src-tauri/crates/env-probe/src/commands/mod.rs` (11 lines)
- Review: `src-tauri/crates/env-probe/src/commands/monitoring.rs` (1,182 lines)
- Review: `src-tauri/crates/env-probe/src/commands/environment.rs` (112 lines)
- Review: `src-tauri/crates/env-probe/src/commands/system_info.rs` (61 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/mod.rs` (61 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/binaries.rs` (293 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/network.rs` (803 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/scanners.rs` (363 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/browsers.rs` (126 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/common.rs` (120 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/ides.rs` (135 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/sdks.rs` (72 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/npm.rs` (74 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/scan_logic.rs` (135 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/system.rs` (53 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/identity.rs` (38 lines)
- Review: `src-tauri/crates/env-probe/src/env_probe/traits.rs` (39 lines)

- [ ] **Step 1: 读取 env-probe 所有源文件（19 个文件）**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **代码质量**：monitoring.rs (1,182 行) 和 network.rs (803 行) 是否需要拆分？
- **性能**：系统探测是否缓存结果？是否有不必要的重复扫描？
- **架构**：模块划分是否合理？traits 定义是否恰当？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 10: 审查 ocr crate

**Files:**
- Review: `src-tauri/crates/ocr/src/lib.rs` (141 lines)
- Review: `src-tauri/crates/ocr/src/error.rs` (100 lines)
- Review: `src-tauri/crates/ocr/src/models.rs` (133 lines)
- Review: `src-tauri/crates/ocr/src/paths.rs` (157 lines)
- Review: `src-tauri/crates/ocr/src/download.rs` (701 lines)
- Review: `src-tauri/crates/ocr/src/service.rs` (324 lines)
- Review: `src-tauri/crates/ocr/src/commands.rs` (74 lines)
- Review: `src-tauri/crates/ocr/src/utils.rs` (7 lines)

- [ ] **Step 1: 读取 ocr crate 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：download.rs (701 行) — 模型下载是否验证来源和完整性？sha2 校验实现是否正确？
- **性能**：OCR 推理是否在独立线程？是否阻塞主线程？
- **可维护性**：硬编码的模型 URL 和路径？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 11: 审查 miner crate

**Files:**
- Review: `src-tauri/crates/miner/src/lib.rs` (25 lines)
- Review: `src-tauri/crates/miner/src/error.rs` (35 lines)
- Review: `src-tauri/crates/miner/src/models.rs` (179 lines)
- Review: `src-tauri/crates/miner/src/commands.rs` (73 lines)
- Review: `src-tauri/crates/miner/src/core/mod.rs` (9 lines)
- Review: `src-tauri/crates/miner/src/core/driver.rs` (186 lines)
- Review: `src-tauri/crates/miner/src/core/extractor.rs` (182 lines)
- Review: `src-tauri/crates/miner/src/core/queue.rs` (269 lines)
- Review: `src-tauri/crates/miner/src/core/single_page.rs` (171 lines)
- Review: `src-tauri/crates/miner/src/core/storage.rs` (107 lines)
- Review: `src-tauri/crates/miner/src/core/postprocess.rs` (115 lines)
- Review: `src-tauri/crates/miner/src/core/scope.rs` (51 lines)
- Review: `src-tauri/crates/miner/src/core/web_search.rs` (1,378 lines)

- [ ] **Step 1: 读取 miner crate 所有源文件（13 个文件）**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **代码质量**：web_search.rs (1,378 行) 是最大的单文件，是否需要拆分？
- **安全性**：外部 URL 输入是否验证？是否有 SSRF 风险？
- **性能**：爬取队列的并发控制是否合理？是否有内存泄露风险？
- **架构**：core 子模块划分是否合理？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 12: 审查 hyperview crate

**Files:**
- Review: `src-tauri/crates/hyperview/src/lib.rs` (7 lines)
- Review: `src-tauri/crates/hyperview/src/error.rs` (1 line)
- Review: `src-tauri/crates/hyperview/src/commands.rs` (8 lines)
- Review: `src-tauri/crates/hyperview/src/peek.rs` (518 lines)
- Review: `src-tauri/crates/hyperview/src/protocol.rs` (165 lines)
- Review: `src-tauri/crates/hyperview/src/sniffer.rs` (146 lines)

- [ ] **Step 1: 读取 hyperview 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：peek.rs 文件预览是否有路径遍历防护？
- **安全性**：protocol.rs 自定义协议处理是否有注入风险？
- **架构**：sniffer.rs 文件类型嗅探是否可靠？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 13: 审查 refinery crate

**Files:**
- Review: `src-tauri/crates/refinery/src/lib.rs` (51 lines)
- Review: `src-tauri/crates/refinery/src/error.rs` (121 lines)
- Review: `src-tauri/crates/refinery/src/models.rs` (66 lines)
- Review: `src-tauri/crates/refinery/src/commands.rs` (535 lines)
- Review: `src-tauri/crates/refinery/src/worker.rs` (430 lines)
- Review: `src-tauri/crates/refinery/src/storage.rs` (215 lines)
- Review: `src-tauri/crates/refinery/src/cleanup_worker.rs` (94 lines)

- [ ] **Step 1: 读取 refinery crate 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **性能**：clipboard 监听 worker 的 CPU 使用是否合理？轮询间隔？
- **安全性**：clipboard 数据中是否可能包含敏感信息（密码）？是否有清理策略？
- **架构**：worker + cleanup_worker + storage 的分工是否清晰？
- **代码质量**：commands.rs (535 行) 是否需要拆分？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 14: 审查 automator crate

**Files:**
- Review: `src-tauri/crates/automator/src/lib.rs` (170 lines)
- Review: `src-tauri/crates/automator/src/error.rs` (41 lines)
- Review: `src-tauri/crates/automator/src/models.rs` (238 lines)
- Review: `src-tauri/crates/automator/src/commands.rs` (93 lines)
- Review: `src-tauri/crates/automator/src/browser.rs` (1,468 lines)
- Review: `src-tauri/crates/automator/src/engine.rs` (1,037 lines)
- Review: `src-tauri/crates/automator/src/inspector.rs` (349 lines)
- Review: `src-tauri/crates/automator/src/screen.rs` (105 lines)

- [ ] **Step 1: 读取 automator crate 所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **安全性**：enigo 键盘/鼠标模拟是否有安全边界？是否可能被滥用？
- **代码质量**：browser.rs (1,468 行) 和 engine.rs (1,037 行) 是最大的两个文件，是否需要拆分？
- **性能**：屏幕截图和浏览器自动化的资源管理？
- **架构**：engine 与 browser 的职责划分是否清晰？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 15: 审查 transfer crate（安全敏感）

**Files:**
- Review: `src-tauri/crates/transfer/src/lib.rs` (35 lines)
- Review: `src-tauri/crates/transfer/src/error.rs` (90 lines)
- Review: `src-tauri/crates/transfer/src/models.rs` (260 lines)
- Review: `src-tauri/crates/transfer/src/commands.rs` (372 lines)
- Review: `src-tauri/crates/transfer/src/server.rs` (405 lines)
- Review: `src-tauri/crates/transfer/src/network.rs` (403 lines)
- Review: `src-tauri/crates/transfer/src/device.rs` (569 lines)
- Review: `src-tauri/crates/transfer/src/ws.rs` (443 lines)
- Review: `src-tauri/crates/transfer/src/transfer.rs` (138 lines)
- Review: `src-tauri/crates/transfer/src/qr.rs` (30 lines)
- Review: `src-tauri/crates/transfer/src/mobile.rs` (7 lines)

- [ ] **Step 1: 读取 transfer crate 所有源文件（11 个文件）**

- [ ] **Step 2: 按维度评估并记录发现**

**⚠️ 高安全敏感度 — 重点审查：**
- **安全性**：Axum HTTP server 是否绑定到 0.0.0.0？是否有认证机制？LAN 内其他设备是否可未授权访问？
- **安全性**：WebSocket 通信是否加密？文件传输是否有完整性校验？
- **安全性**：设备发现和认证机制是否安全？
- **性能**：大文件传输的内存使用？是否有流式传输？
- **架构**：server/network/device/ws 四个模块的职责划分？

- [ ] **Step 3: 输出审查结果到报告文件**

---

## 第四批：测试层与主应用

### Task 16: 审查 workspace-tests crate

**Files:**
- Review: `src-tauri/crates/workspace-tests/src/lib.rs` (1 line)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_db_query_behaviors.rs` (1,474 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_db_commands.rs` (460 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_db_migrations.rs` (315 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_context_scanner_and_commands.rs` (381 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_context_core.rs` (91 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_context_gitleaks.rs` (80 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_refinery_commands.rs` (399 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_refinery_storage.rs` (184 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_env_probe_commands.rs` (369 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_git_commands.rs` (389 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_git_export.rs` (67 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_runtime_and_miner.rs` (515 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_process_utils_and_shell.rs` (172 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_automator_safety.rs` (35 lines)
- Review: `src-tauri/crates/workspace-tests/tests/centralized_sql_safety.rs` (49 lines)

- [ ] **Step 1: 读取 workspace-tests 所有测试文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **测试覆盖**：哪些 crate 有测试覆盖？哪些缺失？
- **测试质量**：测试是否覆盖边界情况和错误路径？还是仅覆盖 happy path？
- **测试隔离**：测试之间是否有依赖？是否可独立运行？
- **代码质量**：centralized_db_query_behaviors.rs (1,474 行) 是否有大量重复？

- [ ] **Step 3: 输出审查结果到报告文件**

---

### Task 17: 审查主应用入口 (src-tauri/src/)

**Files:**
- Review: `src-tauri/src/main.rs` (381 lines)
- Review: `src-tauri/src/guard.rs` (640 lines)
- Review: `src-tauri/src/apps.rs` (263 lines)
- Review: `src-tauri/src/shortcuts.rs` (111 lines)
- Review: `src-tauri/src/monitor.rs` (45 lines)
- Review: `src-tauri/src/error.rs` (61 lines)
- Review: `src-tauri/src/window_styling.rs` (62 lines)
- Review: `src-tauri/src/fs_commands.rs` (70 lines)
- Review: `src-tauri/src/app_config.rs` (53 lines)
- Review: `src-tauri/src/tray_support.rs` (19 lines)

- [ ] **Step 1: 读取主应用所有源文件**

- [ ] **Step 2: 按维度评估并记录发现**

重点审查：
- **架构**：main.rs 作为应用入口，插件注册和初始化逻辑是否清晰？
- **安全性**：shortcuts.rs 全局快捷键是否有冲突风险？guard.rs 屏幕锁定是否安全？
- **代码质量**：guard.rs (640 行) 是否职责过多？
- **性能**：应用启动时间？是否有不必要的同步初始化？

- [ ] **Step 3: 输出审查结果到报告文件**

---

## 汇总阶段

### Task 18: 生成汇总报告

**Files:**
- Read: `docs/superpowers/reports/2026-04-21-backend-crates-review-report.md`
- Write: `docs/superpowers/reports/2026-04-21-backend-crates-review-report.md` (追加汇总章节)

- [ ] **Step 1: 汇总所有 crate 审查结果**

从所有 17 个审查任务中收集问题，按严重度和类别统计。

- [ ] **Step 2: 识别跨模块系统性问题**

分析：
- 多个 crate 共有的设计问题
- 重复的错误处理模式
- 统一的依赖版本管理
- 安全策略的一致性

- [ ] **Step 3: 生成 Top 10 优先修复建议**

按风险 × 影响排序，给出具体修复方向。

- [ ] **Step 4: 写入最终汇总并提交**

更新报告文件，提交 git commit。

---

## 并行执行策略

```
Batch 1 (并行): Task 1 (db) + Task 2 (runtime-utils) + Task 3 (process-utils)
  → 无内部依赖，可完全并行

Batch 2 (并行): Task 4 (git) + Task 5 (context) + Task 6 (exec-runtime) + Task 7 (tool-runtime)
  → 依赖 Batch 1 的结果（了解依赖方向），但审查本身可并行

Batch 3 (并行): Task 8-15 (所有功能模块)
  → 可完全并行，共 8 个任务

Batch 4 (并行): Task 16 (tests) + Task 17 (main app)
  → 可完全并行

Final: Task 18 (汇总)
  → 等待所有前置任务完成
```

**预计 Agent 调度：**
- Batch 1: 3 个并行 Agent
- Batch 2: 4 个并行 Agent
- Batch 3: 8 个并行 Agent（可分两轮，每轮 4 个）
- Batch 4: 2 个并行 Agent
- 汇总: 主线程
