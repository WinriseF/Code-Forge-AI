---
name: AI 配置重构计划
description: CtxRun AI 配置系统从 app-config 本地 JSON 迁移到数据库单表模型配置，并同步重做 AI 设置页的详细执行计划
type: plan
---

# CtxRun AI 配置重构计划

## 1. 本次重构的目标

本次重构不做碎片化修补，直接把当前 AI 配置系统从 `useAppStore + app-config.json` 的临时结构，重构成一个以数据库为中心的模型配置系统。

这次要解决的核心问题只有三类：

1. 当前 AI 配置存储不规范  
   API Key、Provider、Model、业务用途、UI 当前选择全部混在 `app-config.json` 里，职责不清晰。

2. 当前配置结构不利于扩展  
   现在的 `providerId + savedProviderSettings` 结构，本质上是在拿“配置键名”兼任“模型条目”和“业务分类”，后面一旦要加分类、默认模型、能力参数，会越来越乱。

3. 当前 AI 设置页已经不适合继续追加字段  
   现有页面是基于“当前激活 provider + 若干保存的 provider 配置”做的，已经不适合演进成模型管理页面，必须整体改版。

本次重构的目标很明确：

- 用数据库单表存 AI 模型配置
- 放弃 `savedProviderSettings` 这套旧结构
- 保留明文 `api_key`，后续再做数据库加密
- 支持模型分类
- 支持通用字段 + 非统一参数 JSON
- AI 设置页整体重做成“模型配置管理页”
- 调用层从“拼接 store 配置”改为“读取模型记录”

## 2. 本次重构明确不做的事情

为了控制范围，本次不做下面这些内容：

- 不接系统钥匙串
- 不做数据库字段加密
- 不做索引优化
- 不做多表拆分
- 不做云同步
- 不做模型能力自动探测
- 不做在线拉取供应商模型列表

这里有一条明确决策：

> 本次数据库表不加索引。原因不是数据库不知道怎么做，而是当前配置量非常少，增加索引只会让方案更重，当前阶段没有收益。

## 3. 当前系统现状

当前 AI 配置主要散落在以下位置：

- `src/store/useAppStore.ts`
- `src/types/model.ts`
- `src/lib/llm.ts`
- `src/components/settings/sections/AISection.tsx`
- `src/components/ui/AiProviderSelect.tsx`
- `src/components/features/spotlight/hooks/useSpotlightChat.ts`
- `src/lib/hooks/useCrossWindowAppStoreSync.ts`
- `src/lib/storage.ts`

当前问题拆解如下：

### 3.1 存储问题

- `aiConfig` 和 `savedProviderSettings` 被持久化进 `app-config.json`
- `apiKey` 明文跟随 UI 配置一起存储
- 当前激活配置与历史配置混在同一个 store 内

### 3.2 建模问题

- `providerId` 既像 provider 名，又像配置 ID，又像模型条目名
- `savedProviderSettings` 以对象 key 的形式存配置，不适合分类、排序、默认项、启停管理
- 模型差异参数无法优雅表达，例如：
  - OpenAI 风格的 `reasoning_effort`
  - 某些供应商的推理模式
  - 某些模型支持 tool / vision / stream，某些不支持

### 3.3 UI 问题

- 当前 AI 页面只是在编辑一组“当前 provider 参数”
- 页面结构不适合管理多模型、多分类
- 双击重命名 provider 这种交互，未来会和模型列表管理冲突

### 3.4 调用问题

- 请求层直接吃 `aiConfig`
- Spotlight、上下文 AI、预览 AI 等功能都默认依赖全局 store 中的当前配置
- 后续若按分类选择默认模型，现有调用方式需要整体改掉

## 4. 本次重构后的最终设计

本次采用单表方案，表名定为 `ai_models`。

### 4.1 表结构

```sql
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,

  category TEXT NOT NULL CHECK (
    category IN ('chat', 'translation', 'coding', 'vision', 'embedding', 'rerank', 'other')
  ),

  provider_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model_id TEXT NOT NULL,
  api_key TEXT NOT NULL,

  temperature REAL,
  max_tokens INTEGER,

  capabilities_json TEXT NOT NULL DEFAULT '{}',
  params_json TEXT NOT NULL DEFAULT '{}',

  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),

  sort_order INTEGER NOT NULL DEFAULT 0,
  remark TEXT NOT NULL DEFAULT '',

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 4.2 字段职责

- `id`  
  唯一主键，建议 UUID。

- `name`  
  面向 UI 的显示名称，例如“GLM 主模型”“翻译模型”“Qwen 代码模型”。

- `category`  
  业务分类，不代表供应商，也不代表具体模型能力。

- `provider_name`  
  供应商或接入名称，例如 `OpenAI`、`GLM`、`SiliconFlow`、`ModelScope`。

- `base_url`  
  实际请求地址。

- `model_id`  
  实际传给接口的模型标识。

- `api_key`  
  先明文存数据库，后续有需要时再切加密。

- `temperature` / `max_tokens`  
  只保留真正通用的调用参数。

- `capabilities_json`  
  存模型支持能力，例如：

  ```json
  {
    "stream": true,
    "tools": true,
    "vision": false,
    "reasoning": true
  }
  ```

- `params_json`  
  存供应商特有的运行参数，例如：

  ```json
  {
    "reasoning_effort": "high"
  }
  ```

- `enabled`  
  是否启用。

- `is_default`  
  是否为该分类默认模型。

- `sort_order`  
  AI 设置页列表排序。

- `remark`  
  给用户写备注。

## 5. 关键设计原则

这次重构要严格遵守下面几个原则。

### 5.1 一个模型配置就是一条记录

不再保留 `savedProviderSettings[providerId]` 这种对象结构。  
以后任何一个可选模型，数据库里都必须有一条完整记录。

### 5.2 分类和供应商分开

- `category` 表示业务用途
- `provider_name` 表示供应商来源

不能再让一个字段兼任两种语义。

### 5.3 公共字段固定，差异参数进 JSON

不能为了兼容某一家供应商不停给表加列。  
真正通用的字段保留成列，供应商差异参数统一放 `params_json`。

### 5.4 UI 围绕“模型记录”设计，不再围绕“当前 provider”设计

设置页不再展示“当前 provider 配置面板”，而是展示“模型列表 + 编辑面板”。

### 5.5 运行时读取模型记录，不再拼接旧 store

调用层以后只处理完整模型对象，不再从 `aiConfig` 和 `savedProviderSettings` 两处拼数据。

## 6. 数据迁移策略

本次迁移不是一次性删旧逻辑再赌运行成功，而是分阶段切换。

### 阶段 A：先引入数据库表和读写命令

先把数据库表、Rust 模型、Tauri 命令补齐，但先不删除旧 store 结构。

目标：

- 新表可写
- 新表可读
- 可以新增 / 更新 / 删除 / 列表查询模型记录

### 阶段 B：启动时做一次旧配置导入

从 `app-config.json` 中读取：

- `savedProviderSettings`
- `aiConfig`

导入规则：

1. `savedProviderSettings` 中每一项转换成一条 `ai_models` 记录
2. `name` 默认使用原先对象 key
3. `provider_name` 初始值先直接等于原 key，或者基于已知规则标准化
4. `category` 通过启发式映射或默认值填充
5. 当前激活 `aiConfig.providerId` 对应的条目标记为当前使用来源

### 阶段 C：旧配置只读兼容

在迁移初期保留旧字段读取能力，只用于：

- 首次迁移导入
- 防止用户已有旧配置丢失

但新页面和新调用层都不再回写旧结构。

### 阶段 D：完全切断旧写路径

确认新结构稳定后：

- 停止 `setAIConfig` / `savedProviderSettings` 的业务写入职责
- 保留兼容读取一小段时间，或者直接移除

### 阶段 E：最终删除旧结构

最终目标：

- `useAppStore` 不再持有完整 AI 配置数据
- `app-config.json` 不再持有 AI key / provider 详情

## 7. 分类策略

分类不追求特别复杂，但必须稳定。

本次固定使用以下枚举：

- `chat`
- `translation`
- `coding`
- `vision`
- `embedding`
- `rerank`
- `other`

旧配置迁移时建议先这样映射：

- 名称包含 `MT`、`translate`、`translation` -> `translation`
- 名称包含 `code`、`coding` -> `coding`
- 其余默认落到 `chat`

如果当前无法稳定判断，统一先给 `chat`，由设置页人工调整。

## 8. Rust 侧改造计划

### 8.1 数据库层

涉及目录：

- `src-tauri/crates/db/migrations/`
- `src-tauri/crates/db/src/models.rs`
- `src-tauri/crates/db/src/lib.rs`

新增内容：

- 新迁移文件，例如 `V5__ai_models.sql`
- `AiModelRecord` Rust struct
- 基础 CRUD 函数

建议新增模块：

- `src-tauri/crates/db/src/ai_models.rs`

职责：

- `list_ai_models`
- `get_ai_model`
- `create_ai_model`
- `update_ai_model`
- `delete_ai_model`
- `set_default_ai_model`
- `import_legacy_ai_models_if_needed`

### 8.2 命令注册

涉及文件：

- `src-tauri/src/main.rs`

要做的事：

- 注册新的 Tauri commands
- 保持命令命名风格与现有 db 命令一致

### 8.3 旧配置迁移读取

涉及文件：

- `src-tauri/src/app_config.rs`

这里现有逻辑只解析部分 `app-config.json` 字段。  
本次可能需要增加一个只用于迁移的解析结构，专门读取旧 AI 配置。

注意：

- 迁移代码要做到幂等
- 已有数据库记录时不要重复导入
- 不要覆盖用户后来在数据库里改过的新配置

## 9. 前端类型与数据访问改造计划

### 9.1 新类型定义

涉及文件：

- `src/types/model.ts`

这里需要从“provider 配置类型”切换成“模型记录类型”。

建议新增：

- `AIModelCategory`
- `AIModelRecord`
- `AIModelCapabilities`
- `AIModelParams`

旧类型处理原则：

- `AIProviderConfig`
- `AIProviderSetting`
- `DEFAULT_PROVIDER_SETTINGS`
- `DEFAULT_AI_CONFIG`

这些都将逐步退出业务主路径。

### 9.2 前端访问方式

建议不要继续把 AI 配置放进 `useAppStore` 做主存储。  
新的数据主来源应该是 Tauri DB commands。

前端应该引入一层明确的数据访问函数，例如：

- `listAIModels()`
- `createAIModel()`
- `updateAIModel()`
- `deleteAIModel()`
- `setDefaultAIModel()`
- `getDefaultAIModelByCategory(category)`

建议落点：

- 新增 `src/lib/aiModels.ts`

职责：

- 封装 Tauri invoke
- 做 JSON 字段序列化 / 反序列化
- 统一前端拿到的模型记录格式

## 10. useAppStore 改造计划

当前 `useAppStore` 里的 AI 相关状态有：

- `aiConfig`
- `savedProviderSettings`
- `setAIConfig`
- `renameAIProvider`

这些结构要逐步退出。

### 10.1 第一步

先保留旧字段，但不再作为新页面主数据源。

### 10.2 第二步

把 AI 页面改成直接读数据库，不再依赖 store 里的 AI 配置。

### 10.3 第三步

Spotlight、Context AI、Preview AI 等调用路径改为读取“默认模型”或“指定模型记录”。

### 10.4 第四步

确认新链路稳定后删除旧 AI store 结构。

## 11. 请求层改造计划

当前 `src/lib/llm.ts` 直接接受旧的 `AIProviderConfig`。

本次改造后，调用链应该变成：

1. 从数据库取到一个 `AIModelRecord`
2. 前端解析 `capabilities_json` 和 `params_json`
3. 请求层用统一 adapter 组装 payload
4. 按 `provider_name` 和 `params_json` 补充特殊字段

### 11.1 请求层要支持的统一输入

统一输入应该至少包含：

- `provider_name`
- `base_url`
- `model_id`
- `api_key`
- `temperature`
- `max_tokens`
- `capabilities`
- `params`

### 11.2 特殊参数处理策略

例如 OpenAI 风格模型的推理级别：

```json
{
  "reasoning_effort": "low"
}
```

请求层只负责：

- 识别它
- 组装它

不负责把所有供应商参数做成统一数据库列。

## 12. AI 设置页整体改版计划

这部分是本次重构的重点之一，而且不是简单改字段，而是整体重构。

### 12.1 页面定位变化

旧页面：

- 编辑当前 provider
- 临时切换 provider
- 重命名 provider

新页面：

- 管理全部模型配置
- 按分类查看模型
- 新增、编辑、启用、删除模型
- 设置每个分类的默认模型

### 12.2 新页面建议结构

建议把 `AISection` 重做成三栏或双栏结构，核心是“列表 + 详情编辑”。

建议结构：

1. 顶部概览区
- AI 配置说明
- 当前各分类默认模型摘要

2. 左侧模型列表区
- 按分类分组
- 每条显示：
  - 名称
  - 分类
  - provider
  - model_id
  - 启用状态
  - 默认标记

3. 右侧编辑区
- 基础字段编辑
- 通用参数编辑
- 能力 JSON 编辑
- 特殊参数 JSON 编辑
- 保存 / 复制 / 删除

### 12.3 具体交互

建议交互如下：

- 点击左侧模型记录，右侧显示详情
- 顶部有“新增模型”按钮
- 新建时给出空白默认模板
- 每个分类可以设置一个默认模型
- 禁用模型后，不允许成为默认模型

### 12.4 现有组件影响

涉及文件：

- `src/components/settings/sections/AISection.tsx`
- `src/components/settings/SettingsView.tsx`
- `src/components/ui/AiProviderSelect.tsx`

其中：

- `AISection.tsx` 基本会重写
- `AiProviderSelect.tsx` 要么重写为按分类选择默认模型的组件，要么拆成新的 `AiModelSelect`

### 12.5 文案与国际化

涉及文件：

- `src/i18n/locales/zh.json`
- `src/i18n/locales/en.json`

要新增的文案类型：

- 分类名称
- 新增模型
- 默认模型
- 启用 / 禁用
- 能力配置
- 特殊参数
- JSON 格式错误
- 迁移成功提示

## 13. 业务使用侧改造计划

这部分不能漏，否则只是把设置页换皮。

### 13.1 Spotlight

涉及文件：

- `src/components/features/spotlight/hooks/useSpotlightChat.ts`
- `src/components/features/spotlight/modes/chat/ChatMode.tsx`

改造方向：

- 不再直接依赖 `useAppStore().aiConfig`
- 改为读取 `chat` 分类默认模型

### 13.2 Context AI

涉及文件：

- `src/components/features/context/AiSelectionPanel.tsx`
- `src/components/features/hyperview/usePreviewAi.ts`

改造方向：

- 分别确认它们应该吃哪个分类默认模型
- 若没有更细粒度需求，先统一走 `chat`

### 13.3 其他 AI 功能

继续梳理哪些功能用的是：

- `translation`
- `coding`
- `vision`

如果当前业务未真正分开，第一阶段可以先统一走 `chat`，后续再细分。

## 14. 测试计划

本次改动面不小，必须补测试。

### 14.1 Rust 测试

重点覆盖：

- 新表迁移成功
- CRUD 正常
- 默认模型设置逻辑正确
- 旧配置导入幂等
- JSON 字段读写正常

建议放置位置：

- `src-tauri/crates/workspace-tests/tests/`

### 14.2 前端测试

重点覆盖：

- 模型列表展示
- 新增 / 编辑 / 删除模型
- 分类默认模型切换
- JSON 参数校验
- AI 页面从数据库加载而不是从 store 加载

涉及测试可能包括：

- `tests/settingsView.test.tsx`
- 新增 AI 配置页测试
- `tests/useAppStore.test.ts` 中 AI 相关旧测试重写或删除

### 14.3 回归验证

重点检查：

- Spotlight 能正常发起 AI 请求
- Context AI 仍可使用
- 预览 AI 可正常使用
- 切换默认模型后调用目标正确变化

## 15. 执行顺序

本次建议按下面顺序执行，不能乱。

### 第 1 步：落数据库基础能力

- 新增 `ai_models` 表迁移
- 新增 Rust model / CRUD / commands
- 增加前端调用封装

### 第 2 步：实现旧配置导入

- 从 `app-config.json` 导入旧 AI 配置
- 确保导入幂等
- 先不删旧 store

### 第 3 步：先把 AI 设置页改成新数据源

- 新页面直接从数据库读取
- 支持新增 / 编辑 / 删除 / 默认模型
- 保证新配置链路可用

### 第 4 步：切换业务调用层

- Spotlight 改读默认模型
- Context AI 改读默认模型
- Preview AI 改读默认模型

### 第 5 步：清理旧 store 和旧组件

- 删除 `savedProviderSettings`
- 删除 `renameAIProvider`
- 删除围绕旧 provider 设计的 UI 和逻辑

### 第 6 步：补测试和收尾

- 更新测试
- 清理无用类型
- 清理多余 i18n 文案

## 16. 这次重构后的最终状态

完成后，系统应该满足以下状态：

- AI 配置主存储位于数据库 `ai_models`
- `app-config.json` 不再作为 AI 配置主来源
- 每条模型配置都有独立记录
- 模型可以按分类管理
- 通用字段固定，差异参数放 JSON
- AI 设置页变成完整的模型管理页面
- 业务功能通过“默认模型”或“指定模型”读取配置
- 旧 `savedProviderSettings` 结构退出主流程

## 17. 需要锁定的工程决策

以下决策在本次重构中应视为已确认，不反复摇摆：

1. 单表方案，不拆多表
2. 本次不加索引
3. 本次 `api_key` 明文入库
4. 公共字段保留成列，差异参数走 JSON
5. AI 设置页整体重做，不在旧页面上继续打补丁
6. 最终要移除 `useAppStore` 里的旧 AI 配置主逻辑

## 18. 下一阶段落地任务

紧接这份计划之后，实际实施建议拆成三个开发批次：

### 批次 1：数据库与命令

- 建表
- Rust struct
- CRUD commands
- 前端 invoke 封装

### 批次 2：迁移与调用

- 旧配置导入
- 默认模型读取
- 请求层改造

### 批次 3：设置页重做

- 新 AISection
- 新模型编辑体验
- 旧逻辑清理

这三批完成后，再评估是否进入下一轮：

- 数据库存储加密
- 更细的模型分类路由
- 在线探测模型能力
