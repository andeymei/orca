# OpenSpec × Superpowers 规格看板 — 设计

日期：2026-11-25
状态：待评审

## 1. 背景与问题

同时使用 OpenSpec（规格驱动开发）与 Superpowers（流程方法论）时，两者各自维护一套产物，
彼此没有对齐信号，表现为：

- 只能看到单条线的状态：`tasks.md` 勾了多少，或 plan 勾了多少，看不到两者是否一致。
- 一个变更在 OpenSpec 里走到"实现中"，在 Superpowers 里可能还停在"只写了设计"，没人发现。
- 两个框架的"全貌"（阶段划分、产物文件、判据）散落在各自的文档里，需要反复翻。

已有的真实数据印证了这个问题：本仓库 `docs/superpowers/{specs,plans}/` 各有 5 份产物，
而 `openspec/` 目录在本仓库尚不存在；远程 Windows 主机（`yolocalc`、`192.168.50.151`）
上则存在项目级 `openspec/` 目录。也就是说，**两条线分布在不同机器上**。

## 2. 目标与非目标

### 目标

1. 在一个地方看到两个框架的**全貌**：阶段、产物、判据、两者的对应关系。
2. 看到**每个工作项在两条线上的位置**，以及两者之间的**缺口**（谁掉队了）。
3. 覆盖本地与远程项目。
4. 简单、明确、易操作：一个侧边栏面板，一个刷新按钮，不需要配置文件也能用。
5. **能直接从看板执行两个框架的命令**：OpenSpec 的 `validate` / `archive` 等，
   Superpowers 的 brainstorming / writing-plans / executing-plans 等。

### 非目标

- **插件自己不改任何文件**。它不写 `tasks.md`、不改勾选框、不替 `openspec archive`
  挪目录。它只**发起**动作：OpenSpec 走它自己的 CLI，Superpowers 走技能调用，
  由这些工具按各自的规则改状态。
- 不做横向多列拖拽看板（侧边栏宽度不够，见 §7）。
- 不替代 `openspec` CLI 或 Superpowers 的技能；看板是入口，不是实现。
- 不在 v1 支持 `runtime:<environmentId>` 类型的远程主机（见 §9）。

## 3. 已核实的技术事实

这些事实决定了架构，写在这里避免后续反复验证。

| 事实                                                                                                                                | 出处                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 插件 host API **没有任何文件读取方法**（连本地都没有）。唯一的 `files.*` 是 `files.saveAs`。                                        | `src/shared/plugins/workers/plugin-host-api.ts`、`docs/reference/plugin-host-api.md`                            |
| `trusted-worker` 的 `main` 是普通 Node 子进程（`ELECTRON_RUN_AS_NODE`），有本地文件系统与子进程能力，环境变量保留 `SSH_AUTH_SOCK`。 | `src/main/plugins/workers/parent-process/plugin-host-process.ts`、`plugin-worker-env.ts`                        |
| 插件文档明确说明 worker 的环境过滤**不是沙箱**：worker 以用户身份运行，能读用户文件与 SSH 密钥。                                    | `docs/reference/plugin-authoring.md:205-207`                                                                    |
| `workspace.list` 返回**每台主机**上的 workspace，含 `path` 与 `hostId`（`local` / `ssh:…` / `runtime:…`）。                         | `docs/reference/plugin-host-api.md` §`workspace.list`                                                           |
| `agent.launch({ workspaceId, agent, prompt })` 可在指定 workspace 启动 agent。                                                      | `docs/reference/plugin-host-api.md` §`agent.launch`                                                             |
| 组件面板目录里有 `Card`/`Badge`/`Progress`/`Tabs`/`Grid`/`Collapsible`/`EmptyState`/`Markdown` 等，可用原生组件画出看板。           | `resources/plugins/declarative/orca-components.d.ts`                                                            |
| `bundled-plugins.json` 只接受 publisher 为 `stablyai` 的插件。                                                                      | `src/main/plugins/bootstrap/plugin-bundled-bootstrap.ts`、`src/shared/plugins/catalog/plugin-marketplace.ts:21` |
| 打包校验会**重算目录哈希**并与 `bundled-plugins.json` 的 `contentHash` 比对，且要求 `manifest.publisher` 显式存在。                 | `config/scripts/desktop-distribution/runtime-verification/verify-packaged-plugin-resources.cjs:88-107`          |
| `resources/` 不在任何 tsconfig 工程内，也不在 oxlint 范围内。                                                                       | `config/tsconfig*.json`、`package.json` 的 lint 脚本                                                            |
| 远程主机 `yolocalc`、`192.168.50.151` 是 Windows / PowerShell 环境（`head`、`find` 不可用）。                                       | 实测                                                                                                            |
| 两台远程主机上都存在 `codder13.openspec` VS Code 扩展与项目级 `openspec/` 目录。                                                    | 实测                                                                                                            |

### 3.1 两个框架的"命令"是什么（实测）

| 主机                  | `openspec` CLI                                                 | Node / npx      |
| --------------------- | -------------------------------------------------------------- | --------------- |
| 远程 `yolocalc`       | 可用：`@fission-ai/openspec` 1.8.0（PATH 上有 `openspec.ps1`） | 可用            |
| 远程 `192.168.50.151` | 可用：同一路径的 `openspec.ps1`                                | 可用            |
| 本地 macOS            | **不可用**                                                     | 可用（Node 24） |

两个结论：

1. **OpenSpec 有真正的 shell 命令**：`list`、`show`、`validate --strict`、`archive`。
   有 CLI 的主机可以直接在终端里跑；本地缺 CLI，只能在 agent 里按 `openspec/AGENTS.md`
   手工执行，或先 `npm i -g @fission-ai/openspec`。
2. **Superpowers 没有 shell 命令**：它的"命令"就是技能调用
   （`brainstorming` / `writing-plans` / `executing-plans` …），只能由 agent 执行。

所以动作执行必须分成两条通道，见 §4.11。

## 4. 架构

### 4.1 交付形态

一个随应用打包的 Orca 插件：

```
resources/plugins/launch/stablyai.spec-board/
├── orca-plugin.json
├── tsconfig.json            extends ./.orca/types/tsconfig.json
├── src/
│   ├── panel.tsx            组件面板：看板 / 全貌 / 项目 三个 Tab
│   ├── panel.check.ts       orca plugin check 的场景
│   ├── panel.fixture.ts     测试与 check 共用的样例负载
│   ├── worker.ts            trusted-worker：合并、刷新、执行动作
│   ├── protocol.ts          panel ↔ worker 请求与事件契约
│   ├── model.ts             共享类型（快照 / 工作项 / 动作 / 阶段）
│   ├── board-schema.ts      快照校验（parseBoardSnapshot）
│   ├── stage.ts             统一阶段推导（deriveStage）
│   ├── gaps.ts              缺口判定（detectGaps）
│   ├── markdown-tasks.ts    勾选框计数（countCheckboxes）
│   ├── correlation.ts       topic 归一化与配对（correlate）
│   ├── local-scan.ts        本地确定性扫描（node:fs）
│   ├── workspace-match.ts   路径归一化、worktree 折叠、workspace 定位
│   ├── actions.ts           动作推导（actionsForItem / frameworkActions）
│   ├── framework-map.ts     两个框架的全貌静态知识（手写）
│   ├── store-paths.ts       ~/.orca/spec-board 路径（测试可覆盖）
│   └── refresh-prompt.ts    交给 agent 的采集指令
└── README.md
```

并在 `resources/plugins/launch/bundled-plugins.json` 增加一条：

```json
{
  "pluginKey": "stablyai.spec-board",
  "path": "stablyai.spec-board",
  "contentHash": "<sha256 of tree>"
}
```

插件 key 用 `stablyai.spec-board` 而不是 `stablyai.orca-spec-board`：`orca-` 前缀的 id
只能从官方 catalog 安装，会让本地开发安装（`local.spec-board`）失败。

### 4.2 清单（orca-plugin.json）

```jsonc
{
  "manifestVersion": 2,
  "id": "spec-board",
  "publisher": "stablyai",
  "name": "OpenSpec × Superpowers 看板",
  "version": "0.1.0",
  "description": "把 OpenSpec 的规格变更与 Superpowers 的设计/计划画在同一块看板上，并标出两者脱节的地方。",
  "engines": { "orca": ">=1.4.256" },
  "execution": "trusted-worker",
  "main": "src/worker.mjs",
  "capabilities": [
    { "kind": "workspace:read" },
    { "kind": "agent:launch" },
    { "kind": "terminal:send" },
    { "kind": "workspace:write" },
    { "kind": "settings:own" }
  ],
  "contributes": {
    "panels": [
      {
        "id": "board",
        "title": "规格看板",
        "entry": "src/panel.tsx",
        "ui": "components",
        "icon": "layers"
      }
    ],
    "settings": [
      { "key": "refreshAgent", "title": "刷新用的 agent", "type": "string", "default": "claude" },
      {
        "key": "refreshWorkspace",
        "title": "刷新在哪个 workspace 运行",
        "type": "string",
        "default": ""
      },
      {
        "key": "scanRoots",
        "title": "额外扫描的本地根目录",
        "type": "string",
        "multiline": true,
        "default": ""
      }
    ]
  }
}
```

`engines.orca` 取 `>=1.4.256`（当前最新发布 tag）。实现时用 `orca plugin check` 确认
所用 host API 方法在该版本可用；不可用就下调到只使用 `workspace.list` + `agent.launch`。

### 4.3 数据流

```
┌──────────────┐   agent.launch(prompt)   ┌────────────────────────────┐
│ 侧边栏面板    │ ───────────────────────▶ │ agent（默认 Claude Code）    │
│ components   │ ◀─────────────────────── │ 在 workspace 终端里运行       │
└──────┬───────┘   panels.post('changed')  └───────────┬────────────────┘
       │ plugin.request('board.get')                  │ 读 openspec/ + docs/superpowers/
       ▼                                              │ ssh 读远程项目
┌──────────────┐                                     ▼
│ worker       │ ◀── fs.watch ── ~/.orca/spec-board/board.json
│ (Node 子进程) │ ◀── read     ── ~/.orca/spec-board/projects.json
└──────────────┘
```

两条数据来源：

1. **本地快路径（确定性）**：worker 直接扫本地项目，面板打开即出，无成本、秒开。
2. **agent 快照（非确定性）**：agent 扫全部项目（含远程）、做配对与摘要，写
   `~/.orca/spec-board/board.json`。

**合并发生在 worker 里**，面板只接收一份已经合并好的负载（面板保持"哑"渲染）：

- 按 `projectId` 归类。
- 同一项目以 agent 快照为准（它更新更全）；agent 没覆盖的项目用本地扫描结果。
- 缺口取并集，按 `code` 去重。
- `board.get` 返回 `{ items, projects, sources: { localAt, agentAt }, warnings }`。

### 4.4 落盘文件

| 路径                                        | 谁写            | 谁读           | 说明                             |
| ------------------------------------------- | --------------- | -------------- | -------------------------------- |
| `~/.orca/spec-board/projects.json`          | agent（可手改） | worker / agent | 项目注册表                       |
| `~/.orca/spec-board/board.json`             | agent           | worker         | 采集快照，可不存在               |
| `~/.orca/spec-board/last-refresh-prompt.md` | worker          | 人             | 最近一次下发的采集指令，便于排查 |

注册表格式：

```jsonc
{
  "schemaVersion": 1,
  "projects": [
    { "name": "prism_orca", "host": "local", "path": "/Users/a1234/ctjt/code/prism_orca" },
    { "name": "yolocalc-app", "host": "ssh:yolocalc", "path": "C:/work/app" }
  ]
}
```

```ts
export type ProjectRef = { name: string; host: string; path: string }
export type Registry = { schemaVersion: 1; projects: ProjectRef[] }
export type ParseResult = { ok: true; value: BoardSnapshot } | { ok: false; error: string }
export type BoardPayload = {
  items: WorkItem[]
  projects: SnapshotProject[]
  sources: { localAt: number | null; agentAt: number | null }
  warnings: string[]
}
```

注册表**不存在时的回退**：worker 调 `workspace.list`，取 `hostId` 为 `local` 或 `null`
的条目。同一个 `projectId` 下的多个 worktree 必须**折叠成一条**（保留最短路径，即主
检出目录）；否则每个 agent worktree 都会变成看板上一个独立项目。首次扫描成功时，
worker 把这份回退结果**写回 `projects.json` 一次**（仅在文件不存在时写），于是项目
Tab 从第一次打开起就有内容，后续由 agent 增删远程条目。

`scanRoots` 设置是**额外的本地根目录**（每行一个绝对路径），用于扫描不在 Orca
workspace 里的仓库；空字符串表示不额外扫描。

### 4.5 快照模型

```ts
type BoardSnapshot = {
  schemaVersion: 1
  generatedAt: string
  generatedBy: { agent: string; workspace?: string; host?: string }
  projects: SnapshotProject[]
  items: SnapshotItem[]
  notes?: string[]
}

type SnapshotProject = {
  id: string // "<host>|<path>"
  name: string
  host: string // "local" | "ssh:<name>" | "runtime:<id>"
  path: string
  openspec: {
    present: boolean
    capabilities: string[]
    activeChanges: number
    archived: number
  } | null
  superpowers: { present: boolean; specs: number; plans: number } | null
  openspecCli: { available: boolean; version?: string; path?: string } | null
  scannedAt: string
  error?: string
}

type UnifiedStage = 'proposal' | 'design' | 'plan' | 'implement' | 'validate' | 'archive'

export type OpenspecFacts = {
  changeId: string
  stage: 'proposed' | 'implementing' | 'validated' | 'archived'
  hasProposal: boolean
  hasDesign: boolean
  hasTasks: boolean
  tasksDone: number
  tasksInProgress: number
  tasksTotal: number
  capabilities: string[]
}

export type SuperpowersFacts = {
  designSpec: string | null
  plan: string | null
  stage: 'designed' | 'planned' | 'executing' | 'done'
  planDone: number
  planInProgress: number
  planTotal: number
}

/** 落盘的快照里只有事实，没有判定：agent 写错判定的风险由此消除。 */
type SnapshotItem = {
  id: string // "<projectId>#<topic>"
  projectId: string
  title: string
  topic: string // 归一化主题键，用于配对
  openspec: OpenspecFacts | null
  superpowers: SuperpowersFacts | null
  summary?: string
  nextAction?: { label: string; detail: string }
}

export type GapCode =
  | 'openspec-only'
  | 'superpowers-only'
  | 'progress-drift'
  | 'no-design'
  | 'tasks-complete-not-archived'
  | 'archived-spec-stale'

export type Gap = { code: GapCode; severity: 'info' | 'warning' | 'error'; message: string }

export type ActionRun = { kind: 'terminal'; command: string } | { kind: 'agent'; prompt: string }

export type Action = {
  id: string
  label: string
  framework: 'openspec' | 'superpowers'
  run: ActionRun
  mutates: boolean
}

/** worker 返回给面板的形态：事实 + 它自己算出来的判定与动作。 */
export type WorkItem = SnapshotItem & {
  stage: UnifiedStage
  gaps: Gap[]
  actions: Action[]
}
```

### 4.6 阶段推导（统一阶段）

按顺序命中第一条：

| 条件                                                                                             | 统一阶段    |
| ------------------------------------------------------------------------------------------------ | ----------- |
| 项目里已归档（`changes/archive/` 有对应条目）                                                    | `archive`   |
| 存在的进度对里，非空的那些全部勾完（`done === total`，进行中不算完成），且至少有一对非空；未归档 | `validate`  |
| tasks 或 plan 存在且已开始（`done + inProgress > 0`；OpenSpec 的 `- [-]` / `- [~]` 即进行中）    | `implement` |
| tasks 或 plan 存在但零勾选                                                                       | `plan`      |
| 有 `design.md` 或 Superpowers design spec，无 tasks/plan                                         | `design`    |
| 只有 `proposal.md`                                                                               | `proposal`  |

### 4.7 配对规则

`topic` 归一化：去掉 `YYYY-MM-DD-` 前缀、`-design` 后缀，转小写 kebab。

1. `topic` 完全相等 → 配对，置信度 1.0。
2. 否则按 kebab token 计算 Jaccard 相似度，`≥ 0.6` → 配对，置信度 = 相似度。
3. 其余 → 进入 `unmatched`。

### 4.8 缺口规则（纯函数，可单测）

| 代码                          | 触发条件                                                                  | 严重度  |
| ----------------------------- | ------------------------------------------------------------------------- | ------- |
| `openspec-only`               | 有 OpenSpec 变更，无对应 Superpowers 设计                                 | warning |
| `superpowers-only`            | 有 Superpowers 设计/计划，无对应 OpenSpec 变更                            | warning |
| `progress-drift`              | `tasksDone/tasksTotal` 与 `planDone/planTotal` 差 > 0.30 且两边进度都 > 0 | warning |
| `no-design`                   | 有 `tasks.md` 但缺 `design.md`（OpenSpec 自身要求）                       | info    |
| `tasks-complete-not-archived` | tasks 全勾但仍在 `changes/<id>/`                                          | info    |
| `archived-spec-stale`         | 已归档但 `openspec/specs/` 中无对应能力目录（能力清单未知时不报）         | info    |

规则只在 worker 里跑，输入是已校验的快照 + 本地扫描结果，输出附加到 `WorkItem.gaps`。
agent 也可以在快照里直接写 `gaps`，worker 与 agent 的缺口取并集，按 `code` 去重。

**已完成的工作项只报 `archived-spec-stale`**：OpenSpec 变更已归档、或 Superpowers 计划已完成时，
其余缺口描述的是"进行中的工作"。对已经发布的东西报警只是噪音，会稀释真正要看的信号。

判定"能力清单未知"用的是 `existingSpecCapabilities` 是否提供——它就是这个项目
`openspec/specs/` 下的能力目录列表。没提供就不报 `archived-spec-stale`，而不是默认每个已归档
变更都"规格未同步"。

### 4.9 框架全貌（静态内容）

`src/framework-map.ts` 手写，内容来自实测的两份权威文档
（`openspec/AGENTS.md` 与 superpowers 的 15 个 `SKILL.md`）：

- **OpenSpec**：三阶段（创建变更 / 实现变更 / 归档变更），每阶段的产物文件
  （`proposal.md` / `design.md` / `tasks.md` / `specs/<capability>/spec.md` / `archive/`）、
  CLI 命令（`list` / `show` / `validate --strict` / `archive`），
  以及"什么时候该写 proposal、什么时候直接改"的判定树。
- **Superpowers**：15 个技能按过程排序，标注每个技能产出什么、门禁在哪
  （例如"设计未批准不得写代码"、"spec 批准后才允许写实施计划"）。
- **对应关系**：`proposal.md ↔ design spec 的 Context/Goals`、
  `design.md ↔ design spec 的 Decisions/Risks`、`tasks.md ↔ plan`、
  增量 spec ↔ 验收标准。这一栏是"接轨"的参考答案。

判定树是**第四个导出**，不塞进 `FrameworkStage`：阶段是"变更怎么流转"，判定树是"要不要开变更"，
两件事分开存才不会互相挤。

```ts
export type DecisionRule = { situation: string; action: string }
export const OPENSPEC_DECISION_TREE: readonly DecisionRule[]
```

六条规则来自 `openspec/AGENTS.md` 的判定树：修 bug（行为本就符合 spec）、改错别字/格式/注释
→ 直接改；新增功能或能力、破坏性变更（API/schema）、架构或模式变更 → 写 proposal；拿不准
→ 写 proposal（更安全）。

全貌不依赖任何扫描，**没有快照时也能看**。

### 4.10 面板结构

侧边栏窄，所以是"阶段导轨 + 卡片流"，不是横向六列。

| Tab      | 内容                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **看板** | 顶部 `Tabs`/`Row` 阶段导轨：`提案 → 设计 → 计划 → 实现 → 校验 → 归档`，每项带计数；下方当前阶段的卡片流。卡片含：标题、项目/主机 `Badge`、两条 `Progress`（OpenSpec / Superpowers）、缺口 `Badge`、`nextAction` 主按钮 + 「更多」折叠里的其余动作。 |
| **全貌** | 左右两栏 `Grid`：OpenSpec 与 Superpowers 各自的阶段与产物；下方对应关系。每个阶段下列出该框架的可执行命令（▶ 按钮），顶部一个项目 `Select`。用 `Markdown`/`Card`/`Badge` 渲染。                                                                     |
| **项目** | 注册表清单，每行：名称、`hostId`、openspec/superpowers 是否存在、`openspec` CLI 是否可用、扫描时间（`RelativeTime`）、错误标记。「刷新」按钮。                                                                                                      |

空状态：`EmptyState` + 一句"点刷新让 agent 采集"。

### 4.11 动作执行（命令入口）

**动作模型**（`src/actions.ts`，纯函数推导，不落盘）：

```ts
type Action = {
  id: string
  label: string
  framework: 'openspec' | 'superpowers'
  run:
    | { kind: 'terminal'; command: string } // 需要该主机有 openspec CLI
    | { kind: 'agent'; prompt: string } // 技能调用 / 无 CLI 时的降级
  mutates: boolean
}
```

**两条通道**

| 通道     | 何时用                                      | 主机调用                                                                       | 能力                                |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- |
| terminal | OpenSpec CLI 动作，且目标项目所在主机有 CLI | `terminal.create({ workspaceId, command })` → `terminal.focus({ terminalId })` | `terminal:send` + `workspace:write` |
| agent    | Superpowers 技能；OpenSpec 动作但主机无 CLI | `agent.launch({ workspaceId, agent, prompt })`                                 | `agent:launch`                      |

`terminal.create` 在后台打开终端，所以必须跟一次 `terminal.focus`，否则用户看不到命令和输出。

**OpenSpec 动作集**

| 动作     | 执行                                                                     | 改状态 |
| -------- | ------------------------------------------------------------------------ | ------ |
| 列出变更 | `openspec list`                                                          | 否     |
| 校验     | `openspec validate <id> --strict`                                        | 否     |
| 看增量   | `openspec show <id> --json --deltas-only`                                | 否     |
| 归档     | `openspec archive <id> --yes`                                            | **是** |
| 新建提案 | agent：按 `openspec/AGENTS.md` Stage 1 生成 proposal + tasks + 增量 spec | **是** |

**Superpowers 动作集**（全部走 agent，因为它没有 shell 命令）

| 动作       | prompt 要点                                               |
| ---------- | --------------------------------------------------------- |
| 设计       | 用 `superpowers:brainstorming` 为 `<topic>` 产出设计 spec |
| 写实施计划 | 用 `superpowers:writing-plans` 基于 `<spec>` 写计划       |
| 执行计划   | 用 `superpowers:executing-plans` 执行 `<plan>`            |
| 代码评审   | 用 `superpowers:requesting-code-review` 审本次改动        |
| 验证完成   | 用 `superpowers:verification-before-completion` 验证      |

**降级规则**：`project.openspecCli.available === false` 时，OpenSpec 动作的 `run` 从
`terminal` 换成 `agent`，prompt 改成"按 `openspec/AGENTS.md` 执行 <动作>"，卡片上标
`无 CLI` badge。

**执行位置**：动作必须落在**拥有该项目的 workspace** 上。worker 用 `workspace.list`
按 `path` 匹配 `project.path` 得到 `workspaceId`；匹配不到则禁用动作并提示
"该项目不在 Orca workspace 里"，不猜。

**确认**：`mutates: true` 的动作要二次确认——按钮第一次按下变成"确认执行？"，
3 秒内再按才真的执行；`mutates: false` 一键执行。

**结果反馈**：terminal 通道执行后卡片显示"已在终端打开"；agent 通道显示"已派发给
&lt;agent&gt;"。插件不申请 `terminal:read`，结果以终端/agent 自身为准。

**全貌 Tab 兼作命令面板**：每个阶段下列出该框架的命令，带 ▶ 按钮；顶部一个项目
`Select` 决定在哪个项目/主机上执行。

## 5. 刷新流程

1. 面板「刷新」→ `plugin.request('board.refresh')`。
2. worker 读设置 `refreshAgent`（默认 `claude`）与 `refreshWorkspace`；后者为空时取
   当前聚焦 workspace（`workspace.readContext`）。没有可用 workspace → 返回
   `invalid_params`，面板显示原因。
3. worker 把 `refresh-prompt.ts` 的内容（含快照 schema 与注册表格式）写入
   `last-refresh-prompt.md`，然后 `agent.launch({ workspaceId, agent, prompt })`。
4. agent 扫描 → 写 `board.json`（先写 `.tmp` 再 rename）→ 结束。
5. worker `fs.watch` 目录，检测到 `board.json` 变化后重新校验并
   `panels.post('board.changed', { generatedAt })`。
6. 面板重新 `board.get` 并重绘。

刷新是**手动**的，不自动轮询（agent 有成本）。

## 6. 错误处理

| 情况                                       | 表现                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `board.json` 不存在                        | 看板 Tab 用本地扫描结果；全貌 Tab 正常；项目 Tab 显示"尚无 agent 快照"                 |
| `board.json` 非法 JSON / 不合 schema       | 顶部错误卡：文件路径 + 解析错误 + 上次有效时间；其余 Tab 仍可用                        |
| `projects.json` 非法                       | 回退到 `workspace.list` 本地扫描，并在项目 Tab 标一条警告                              |
| `agent.launch` 被拒（能力未批准 / 未登录） | 错误卡显示 host API 的 `code` 原文，不做二次包装                                       |
| 某个远程项目扫描失败                       | 该项目 `error` 字段有值，卡片上显示 error badge，其他项目照常渲染                      |
| 扫描目录过大                               | 跳过 `node_modules` / `.git` / `dist` / `out` / `.cross-version-checkouts`，最大深度 4 |
| 动作的目标项目找不到对应 workspace         | 动作按钮禁用，提示"该项目不在 Orca workspace 里"，不猜一个 workspace 执行              |
| `terminal.create` 失败（主机断开）         | 错误卡显示 host API 的 `code`，不自动重试                                              |
| agent 未配置 / 未登录                      | 错误卡显示 `code`，提示去 Settings 检查 agent 账号                                     |
| 本地没有 `openspec` CLI                    | 自动降级成 agent 动作，卡片上标 `无 CLI`                                               |

## 7. 为什么不做横向六列看板

侧边栏宽度通常不足以并排放下六个阶段列；强行做会需要 HTML 面板 + CSS grid，
同时失去 Orca 组件目录的明暗主题与焦点规则。v1 采用"阶段导轨 + 卡片流"，
在窄栏里可读性最好。若以后需要宽看板，再增加一个 HTML 面板作为第二种视图，
数据层不变。

## 8. 测试与验收

### 单测（纯函数，无依赖）

- `board-schema`：合法/非法快照的校验结果。
- `deriveStage`：六种输入各自落到正确阶段。
- `detectGaps`：每种缺口规则的触发与不触发。
- `correlation`：完全匹配、Jaccard 命中、不匹配三种路径。
- `parseTasksMarkdown`：`- [ ]` / `- [x]` / `- [-]` / 嵌套 / 空文件的计数。
- `actions`：CLI 可用 / 不可用两条分支下 OpenSpec 动作的 `run` 类型；`mutates`
  标记；Superpowers 动作一律是 `agent`。

只保留"回退改动就会失败"的测试；不为 CRUD 式样板写测试。

### 面板

- `orca plugin dev watch --check --shot` 产出 PNG，逐张核对明暗两种主题。
- `orca plugin check` / `orca plugin test` 通过。

### 端到端验收

1. 打包安装后，右侧边栏出现「规格看板」，图标 `layers`。
2. 首次打开（无任何配置文件）：看板 Tab 列出本仓库的工作项（来自本地快路径），
   全貌 Tab 完整可读。
3. 点「刷新」：agent 启动、写出 `board.json`、面板自动更新，远程主机
   `yolocalc` 的项目出现在项目 Tab。
4. 人为写坏 `board.json`：面板出现错误卡，全貌 Tab 仍可用。
5. 在远程项目 `yolocalc` 的卡片上点「校验」：该主机的终端被打开并输出
   `openspec validate` 的结果。
6. 点 Superpowers 的「写实施计划」：agent 在对应 workspace 启动并收到预置 prompt。
7. `pnpm check:changed` 通过；打包校验
   `verify-packaged-plugin-resources` 通过（contentHash 正确）。

## 9. 风险与权衡

| 风险                                  | 应对                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent 写出的 JSON 不合 schema         | worker 校验 + agent 侧"先写 tmp 再 rename" + 错误卡保留上次有效快照                                                                                                                                           |
| `engines.orca` / host API 版本不匹配  | 实现时用 `orca plugin check` 验证；必要时只用 1.3 起就有的方法                                                                                                                                                |
| 插件源码不在仓库 lint/typecheck 内    | 插件内建 `tsconfig.json`（`extends ./.orca/types/tsconfig.json`）+ 手动 `tsc` + `orca plugin check`                                                                                                           |
| `contentHash` 算错导致打包失败        | 用仓库里现成的 `hashPackagedPluginTree` 计算，并在打包前跑一次校验脚本                                                                                                                                        |
| `stablyai` publisher 是 fork 本地决定 | 仅影响本 fork 的构建；不向上游提交。`publisher` 在 manifest 里是"已废弃但打包校验仍读"的字段，实现时先用 `orca plugin validate` 确认两种身份都成立：打包后 `stablyai.spec-board`，本地开发 `local.spec-board` |
| agent 刷新有成本与延迟                | 手动触发；本地快路径保证日常使用时零成本                                                                                                                                                                      |
| `runtime:<environmentId>` 主机不支持  | v1 明确不支持，项目 Tab 标注"需 agent 采集"，不静默失败                                                                                                                                                       |
| 误触变更类命令（archive / 新建提案）  | 二次确认（两段式按钮，3 秒过期）；只有 `mutates` 动作用                                                                                                                                                       |
| 本地没有 `openspec` CLI               | 自动降级为 agent 动作并在卡片上标明；不假装命令能跑                                                                                                                                                           |

## 10. 后续（不在本次范围）

- 跳到工作项所在 workspace（`workspace.open`）。
- 宽看板 HTML 视图。
- 命令执行历史与结果回显（需要 `terminal:read`）。
- 支持 `runtime:<environmentId>` 主机。
