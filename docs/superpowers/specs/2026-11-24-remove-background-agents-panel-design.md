# Removing the Background Agents sidebar panel — 设计

> 日期：2026-11-24 · 状态：待评审 · 范围：删除 Orca 右侧边栏 `background-agents` tab 及其专属代码，保留 AI Vault 会话恢复依赖的 agent 列表能力

## 1. 目标

从 Orca 右侧边栏的活动栏中移除 "Background agents" 入口，并删除只为这个面板存在的代码。
**保留** AI Vault 会话恢复流程依赖的 `claude agents --json` 列表能力 —— 它的作用是判断「这个会话是不是已经在跑了」，
避免 CLI 把一个正在运行的会话复制成第二个同名会话（用户会看到重复的 agent）。

用户已确认的删除深度：**删除面板 + 仅面板使用的代码**，保留 AI Vault 的列表路径。

## 2. 关键发现：耦合点只有一处

整个特性里，**只有两个文件**同时被面板和 AI Vault 使用：

| 文件                                                                       | 面板用途                                                         | AI Vault 用途                                     | 处置                    |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- | ----------------------- |
| `src/shared/claude-background-agents.ts`                                   | agent 名单 + 详情 + 命令参数类型                                 | agent 名单类型 + `FINISHED_STATES`                | **裁剪**（保留名单侧）  |
| `src/main/claude/background-agents/claude-background-agent-list.ts`        | `listClaudeBackgroundAgentsOrNull`（面板要知道「本机没有 CLI」） | `listClaudeBackgroundAgents`（AI Vault 只要名单） | **裁剪**（删 `OrNull`） |
| `src/main/claude/background-agents/claude-background-agent-environment.ts` | `claude --bg` 派发                                               | `claude agents --json` 列表                       | **保留**                |

其余所有文件都只服务面板，可以整目录删除。

### 2.1 AI Vault 的完整依赖链（必须存活）

```
renderer  lib/agent-session/resume/history/claude-running-agent.ts
   └─ window.api.aiVault.listRunningAgents
      └─ preload/api/ai-vault-bridge.ts
         └─ IPC  aiVault:listRunningAgents
            └─ main/ipc/ai-vault/ai-vault-resume.ts
               ├─ listRunningAgentsForHost  (ai-vault-running-agents.ts)
               ├─ listClaudeBackgroundAgents      ← claude-background-agent-list.ts
               └─ listRuntimeClaudeBackgroundAgents ← main/ai-vault/runtime-claude-background-agents.ts
                  └─ RPC aiVault.listRunningAgents  (runtime/rpc/methods/history/ai-vault.ts)
                     └─ 配对主机自己回答：listClaudeBackgroundAgents()
```

**注意最后一环**：`aiVault.listRunningAgents` 是一个 **RPC 契约方法**，配对的 runtime 主机通过它向桌面查询。
它已在 `src/shared/rpc-contract/rpc-params-catalog.generated.ts` 中登记，**不能删除**，
因此 **不需要重新生成 RPC catalog**。

## 3. 删除清单

### 3.1 整目录删除

| 目录                                               | 文件数                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/background-agents/`   | 34（含 11 个测试 + 1 个 fixture）                                                                                                                                                       |
| `src/renderer/src/store/slices/background-agents/` | 2                                                                                                                                                                                       |
| `src/main/ipc/claude-agents/`                      | 2                                                                                                                                                                                       |
| `src/main/claude/background-agents/` 中的 4 个文件 | `claude-background-agent-commands.ts(+test)`、`claude-background-agent-job-state.ts(+test)`、`claude-background-agent-remote-list.ts(+test)`、`claude-background-agent-remote-state.ts` |

### 3.2 单文件删除

- `src/preload/api/claude-agents-api.ts`
- `src/preload/api/claude-agents-bridge.ts`
- `src/renderer/src/web/preload-api/web-claude-agents-api.ts`
- `tests/e2e/claude-background-agents.spec.ts`

### 3.3 摘线（编辑既有文件）

| 文件                                                                            | 改动                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/main/ipc/register-core-handlers/register-core-handlers.ts`                 | 删 `registerClaudeAgentsHandlers` 的 import 与调用（:37 / :294） |
| `src/preload/api-types.ts`                                                      | 删 `ClaudeAgentsApi` import 与 `claudeAgents` 字段（:54 / :150） |
| `src/preload/index.ts`                                                          | 删 `claudeAgentsApi` import 与注册（:78 / :186）                 |
| `src/renderer/src/web/web-preload-api.ts`                                       | 删 `createWebClaudeAgentsApi` import 与注册（:17 / :125）        |
| `src/renderer/src/store/types.ts`                                               | 删 `BackgroundAgentsSlice` import 与交叉类型成员（:33 / :89）    |
| `src/renderer/src/store/index.ts`                                               | 删 slice import 与展开（:38 / :140）                             |
| `src/renderer/src/store/testing/app-store-test-fixture.ts`                      | 删 slice import 与展开（:36 / :109）                             |
| `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx`     | 删 lazy import 与渲染分支（:13 / :61）                           |
| `src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts` | 删活动项与 `Bot` import（:2 / :89-94）                           |

## 4. Tab id 的四处表示

`'background-agents'` 这个字符串在四个地方独立出现。**必须四处同改**，否则要么类型报错，要么 tab 卡住。

| #   | 位置                                                                            | 改动   | 漏掉的后果         |
| --- | ------------------------------------------------------------------------------- | ------ | ------------------ |
| 1   | `src/shared/ui-chrome-types.ts:101`（`RightSidebarTab` 联合类型）               | 删成员 | 类型不一致         |
| 2   | `src/renderer/src/store/slices/right-sidebar/right-sidebar-route.ts:40`         | 删分支 | 渲染端不认这个 tab |
| 3   | `src/main/persistence/applying-settings/ui-selection-normalization.ts:67`       | 删分支 | 持久化状态不认     |
| 4   | `src/shared/rpc-contract/client-ui-params.ts:44`（`STATIC_RIGHT_SIDEBAR_TABS`） | 删条目 | 见 §5              |

### 4.1 已验证的降级行为

第 2、3 处删除后，**旧 profile 里存的 `'background-agents'` 会自动落到 `'explorer'`**：
`normalizeRightSidebarTab` 的兜底是 `getDefaultUIState().rightSidebarTab`（`src/shared/constants.ts:170` = `'explorer'`），
`normalizeRightSidebarRoute` 的兜底同样是 `'explorer'`。**不需要显式迁移代码。**

## 5. 线上协议兼容性（实测结论）

第 4 处 `STATIC_RIGHT_SIDEBAR_TABS` 喂给 `RightSidebarTabParam`（一个 `z.custom`），
最终进入 `UiUpdate`。`UiUpdate` 通过 `tolerateUnknownValues`（`src/shared/rpc-contract/ui-update-value-tolerance-params.ts`）
给**每个字段**套了 `.catch(() => undefined)`。

**实测（Node + zod 复现同一套 schema）：**

```
schema 保留该 tab  -> ACCEPTED, data={"rightSidebarTab":"background-agents","sidebarWidth":300}
schema 删除该 tab  -> ACCEPTED, data={"sidebarWidth":300}
```

即：**删除该条目是安全的**。旧版客户端发来的 `'background-agents'` 只会被当作「这个字段没填」丢弃，
其余字段照常生效，**不会**让整个 `ui.set` 载荷被拒。

> 这纠正了初版分析中「旧客户端整个载荷被拒」的判断 —— 那个结论没有考虑 `.catch()` 的存在。

保留该条目反而更糟：桌面端收到后仍会把它当作已知 tab 存进持久化状态。

**结论：第 4 处照常删除。**

## 6. 共享模块的裁剪

`src/shared/claude-background-agents.ts` 里 AI Vault 需要的只有名单侧的类型：

**保留** — `ClaudeBackgroundAgent`（类型）、`ClaudeBackgroundAgentKind` / `State` / `Status`（字段类型）、
`CLAUDE_BACKGROUND_AGENT_FINISHED_STATES`、`ClaudeRunningAgentLookup`、`ClaudeBackgroundAgentRequest`、
`parseClaudeBackgroundAgentsValue`、`readClaudeBackgroundAgentsListing` / `ClaudeBackgroundAgentsListing`、
`readClaudeBackgroundAgentFailureMessage`、`CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES`、
`parseClaudeBackgroundAgents`（被 `src/shared/claude-background-agents.test.ts` 使用）、
以及 `isRecord`（`parseClaudeBackgroundAgentsValue` 依赖）。

**删除** — `ClaudeBackgroundAgentDetail`、`ClaudeAgentsScope` / `readClaudeAgentsScope`、
`ClaudeBackgroundAgentListResult`、`ClaudeBackgroundAgentCommandResult`、
`ClaudeBackgroundAgentDispatchArgs`、`ClaudeBackgroundAgentIdArgs`、
`CLAUDE_BACKGROUND_AGENT_ID_PATTERN`、`CLAUDE_BACKGROUND_AGENT_DISPATCH_LINE_PATTERN`、
`readClaudeBackgroundAgentDispatchedId`、`CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE`。

> `isRecord` 在 `src/shared/` 下有 4 份副本，本文件这份被删除的测试引用过，
> 但它在本文件内部被 `parseClaudeBackgroundAgentsValue` 使用（第 90、207 行），
> 所以保留导出不会触发 `knip` 的未使用导出报告（`config/knip.json` 开启了 `ignoreExportsUsedInFile`）。
> **无需改成模块私有函数。**
>
> 补充：`knip`（`audit:dead-code`）**不在** `pnpm lint` 的 46 步闸门里，也不在
> `pnpm check:changed` 里，CI workflow 同样不跑它 —— 它是独立的手动审计脚本。
> 即便如此，也按上面的裁剪清单保持共享模块干净。

`src/main/claude/background-agents/claude-background-agent-list.ts`：
删 `listClaudeBackgroundAgentsOrNull`（面板专属），**保留** `listClaudeBackgroundAgents`（AI Vault 入口）。
相应地删掉 `claude-background-agent-list.test.ts` 里 `describe('listClaudeBackgroundAgentsOrNull')` 整块。

## 7. i18n

面板的文案键全部在 `auto.components.backgroundAgents.*`（34 个）+ `auto.components.right.sidebar.index.backgroundAgents`（1 个）。

**只在 `en.json` 里有**（其余 10 个语言文件 0 命中），所以：

- 从 `en.json` 删掉 `auto.components.backgroundAgents` 整个对象 + `auto.components.right.sidebar.index.backgroundAgents`
- `en-runtime-required.json` 里**没有**这些键（已用 JSON 遍历确认：0 命中，
  `auto.components.right.sidebar.index` 这个子对象在运行时 catalog 里是空的），**无需重新生成**

> `auto.` 键由 `localize-renderer-strings.mjs` 按 `filePath:text` 的 SHA-1 生成。
> 组件删除后这些字符串在源码里不复存在，`verify:localization-extraction` 会把它们报成
> 「Catalog keys no source references」并失败 —— 所以必须删键，不能留。

**不要碰**这些名字里带 "background" 但属于别的功能的键：
`components.native-chat.backgroundTasks.*`、`auto.components.native-chat.writeNotice.backgroundTasksRunning`、
`auto.components.settings.*`、`auto.components.workspace.cleanup.backgroundRemoval.*`、
`auto.lib.launch.agent.background.session.*`、`auto.components.right.sidebar.FileExplorerBackgroundMenu`。

## 8. 文档

删除三份只描述这个面板的设计/计划文档（仓库有先例：`56b69f8d8f docs: remove stale design docs`）：

- `docs/superpowers/specs/2026-11-15-claude-background-agents-supervisor-design.md`
- `docs/superpowers/specs/2026-11-20-background-agents-remote-hosts-design.md`
- `docs/superpowers/plans/2026-11-15-claude-background-agents-supervisor.md`

**保留** `docs/superpowers/specs/2026-11-18-terminal-agent-rich-text-composer-design.md`
（终端 composer 的设计，只是顺带提到 background agents；本次工作树的未提交改动也在这份文件里）。

## 9. 保留不动的共享能力

`claude agents --json` 这个 CLI 能力**必须保留**，它是 `aiVault.listRunningAgents` 的唯一数据来源。

| 符号                                      | 位置                                                    | 为什么保留                                   |
| ----------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `listClaudeBackgroundAgents`              | `claude-background-agent-list.ts`                       | AI Vault 入口                                |
| `backgroundAgentCommandEnvironment`       | `claude-background-agent-environment.ts`                | 上面那个函数在用                             |
| `buildClaudeAttachStartup`                | `src/shared/ai-vault/resume/ai-vault-attach-startup.ts` | 面板和 AI Vault **共用**，删了会破坏恢复流程 |
| `aiVault.listRunningAgents`               | RPC + IPC + preload                                     | 运行时契约，配对主机在用                     |
| `ClaudeBackgroundAgent`                   | `src/shared/claude-background-agents.ts`                | 名单类型                                     |
| `CLAUDE_BACKGROUND_AGENT_FINISHED_STATES` | 同上                                                    | 判断「还在跑」                               |

**消失的 CLI 能力**（仅面板使用，可安全删除）：`claude --bg` 派发、`claude stop <id>`、
`claude rm <id>`、远端 `claude --bg` shell 路径、面板内嵌的 `claude attach` 终端。

## 10. 工作树里已有的未提交改动

本次删除会**连带丢弃**以下未提交改动（它们只服务于要删的面板）：

- `src/renderer/src/components/background-agents/BackgroundAgentComposer.tsx`（Enter 发送 / Shift+Enter 换行）
- `src/renderer/src/components/background-agents/BackgroundAgentComposer.test.tsx`
- `src/renderer/src/components/background-agents/BackgroundAgentListScreen.test.tsx`
- `en.json` 等 11 个语言文件里 `auto.components.backgroundAgents.shortcuts` 的那一行
  （`↑↓ select · ↵ send · ⇧↵ newline · ctrl+x stop · / task`）

**保留**的未提交改动（与终端 composer 有关，不属于面板）：
`PromptEditor.tsx(+test)`、`TerminalComposerField.tsx(+test)`、
`tests/e2e/terminal-composer-prompt.spec.ts`、各语言文件里 `terminalComposer.enterHint` 那一行、
以及 `src/main/code-completion/*`、`src/shared/code-completion/*` 的改动。

> `terminalComposer.enterHint` 与 `auto.components.backgroundAgents.shortcuts` 在同一个 JSON 对象附近，
> 改 locale 文件时**只删后者**，前者是本次工作树的另一项成果。

## 11. 验证

```bash
pnpm tc:node && pnpm tc:web && pnpm tc:cli      # 类型
pnpm test src/shared/claude-background-agents.test.ts --maxWorkers=2
pnpm test src/main/claude/background-agents --maxWorkers=2
pnpm test src/main/ipc/ai-vault --maxWorkers=2
pnpm test src/renderer/src/lib/agent-session/resume --maxWorkers=2
pnpm lint                                     # 含 verify:localization-extraction
pnpm check:changed
```

另外需要人工确认：

1. 侧边栏活动栏不再出现 "Background agents"。
2. AI Vault 里恢复一个**正在运行**的 Claude 会话时，仍然是「打开」而不是「复制」。
3. 旧 profile（存过 `rightSidebarTab: 'background-agents'`）启动后落在 Explorer 而不是空白侧边栏。

## 12. 风险

| 风险                                                | 缓解                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 误删 AI Vault 需要的名单能力                        | §2.1 的依赖链是删除前的核对清单；AI Vault 的 4 个测试文件必须仍通过                      |
| 共享类型裁剪过头                                    | `ClaudeBackgroundAgent` 及其字段类型全部保留；只删「详情/命令/作用域」这几组面板专属类型 |
| i18n 孤儿键让 `verify:localization-extraction` 失败 | §7 明确列出要删与不要碰的键                                                              |
| 丢掉工作树里未提交的 composer 改动                  | §10 已记录哪些会丢、哪些会留                                                             |
