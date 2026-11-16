# Claude 后台 agent 监管器 — 设计

> 日期：2026-11-15 · 状态：待评审 · 范围：Orca 右侧边栏 `background-agents` tab 重做

## 1. 为什么要重做

2026-11-13 的实现把「后台 agent」当成了「前台 agent」：面板列的是 Orca 自己的三类对象（结构化会话 / 终端 tab / AI Vault 磁盘 transcript），行里从来没有 Claude Code 后台 agent 的短 id，于是「进入」只能退化成「另起终端跑 `claude attach` / `claude --resume`」，也就**没有「返回列表」这个状态**。

用户在终端里的真实体验是 `claude agents` 打开一个 TUI：方向键选、回车进入、左方向键退回列表。上次实现没有复刻这个模型。

### 1.1 实测事实（claude 2.1.319，本机）

| 事实                                                          | 证据                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后台 agent 是**活着的独立进程**，不是会话记录                 | `claude agents --json` → `{id, sessionId, name, cwd, kind:"background", startedAt, state, status}`；`state ∈ {working, done, stopped}`，`status ∈ {busy, idle}`（只有活进程有 `pid`/`status`） |
| 每个 agent 有自己的 job 目录                                  | `~/.claude/jobs/<agentId>/state.json` → `detail`、`tempo`、`inFlight{tasks,queued,kinds}`、`fan`（子 agent/shell）、`tokens`、`needs`、`block.questions`；`timeline.jsonl` 是状态流水          |
| job 目录名 == agent 短 id                                     | `~/.claude/jobs/4f5d4302/`、`~/.claude/jobs/43f0ca87/`                                                                                                                                         |
| `state.json` 的 `detail` **就是** TUI 行里那行灰字            | `43f0ca87` 的 detail = `Task 10 send menu and batch controls underway` = TUI 抓屏那一行，逐字一致                                                                                              |
| agent 的 `name` 会自己变                                      | 实测：`Wait 20 seconds, then reply exactly: PROBE2_OK` → `bash sleep command`                                                                                                                  |
| TUI 列表分两段                                                | `Working` / `Completed`；header 写 `0 awaiting input · 2 working · 16 completed`                                                                                                               |
| TUI 行结构                                                    | 指针 ❯ + 状态图标 + 状态词（`Working` / `Needs input` / `Ready for review` / `Completed`）+ name + 细节列 + 右侧 elapsed                                                                       |
| TUI 底部有派发输入框                                          | `❯ describe a task for a new session`                                                                                                                                                          |
| TUI 底部有快捷键条                                            | `enter to return · space to reply · ctrl+x to delete · ? for shortcuts`                                                                                                                        |
| 「进入」= `claude attach <id>`，渲染**完整 Claude Code TUI**  | 抓屏：对话 + 输入框 + `⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents`                                                                                                           |
| ← 切回列表是**真的**                                          | tmux 抓屏：按 ← 后整屏变成上面那张列表                                                                                                                                                         |
| ← 需要**按两次**                                              | 源码：第一次只 arm，toast `Press ← again to go back to agents`，3s 超时；输入框刚被编辑过（2s 内）首次也只 arm                                                                                 |
| `claude attach` 断开后会**把自己 re-exec 成 `claude agents`** | 源码：detach 成功且走 APC 时 `A8({args:["agents"], env:{CLAUDE_AGENTS_SELECT:a}})`                                                                                                             |
| 杀掉 attach 客户端**不会**停掉后台 agent                      | 实测：杀 `claude attach <id>` 客户端后 `claude agents --json` 仍显示该 agent `pid` 存活、`state: working`                                                                                      |
| 底层是 daemon 的 `{"op":"attach"}`                            | daemon NDJSON over `/tmp/cc-daemon-<uid>/<hash>/control.sock`；PTY 字节走 `…/pty/<short>.sock`；协议未公开                                                                                     |

### 1.2 其它可用的公开 CLI

```
claude agents [--json] [--all] [--cwd <path>]   列后台会话
claude attach <id|name>                         在当前终端打开后台会话
claude logs <id|name>                           打印后台会话最近的终端输出
claude stop <id>                                停止（会话保留）
claude rm <id>                                  删除会话及其 worktree
claude respawn [id|--all]                       重启后台会话
claude --bg "<prompt>"                          派发后台会话并打印短 id
```

`claude --bg` 是**程序化派发**通道，Orca 用它；`claude attach` 是**程序化进入**通道，Orca 用它。二者都不需要逆向 daemon 协议。

## 2. 目标与非目标

### 目标

1. 面板列的是 **Claude Code 的后台 agent**，不是 Orca 的前台会话。
2. **两屏导航**：列表屏 ⇄ 详情屏，`Enter` 进入、`←`（或按钮）返回。
3. 详情屏内嵌**可交互**的 `claude attach` 终端 —— 能打字、能批准权限。
4. 列表反映**活着的** agent：分段（Working / Needs input / Completed）、计数、每行的 detail 与 elapsed 实时更新。
5. 能**派发**新 agent、能**停止/删除** agent。
6. 返回列表**不影响**后台 agent（它继续跑）。

### 非目标

- 不逆向 Claude Code 的 daemon 协议（`control.sock` 的 `attach`/`reply`/`dispatch` op）。公开 CLI 已经封装掉了。
- 不做 Claude FleetView 的分组视图 / pin / 重命名 / `space to reply` / 目录视图。
- 不做原生只读 transcript 视图（用户已选「内嵌 attach 终端」）。
- **v1 只支持本机宿主**。远程配对宿主留到 v2（数据层已按宿主切分，见 §5.4）。
- 不把面板做成第二个 AI Vault。AI Vault 继续管磁盘 transcript；本面板只管**活着的后台 agent**。

## 3. 用户可见行为

### 3.1 屏 1：列表

```
 ▐▛███▛█   Claude Code
▝▜██████▀  0 awaiting input · 2 working · 16 completed
Working
 ❯ ● claude agents cli        已确认旧面板对象不符，正实测…      4m
   ● ai-source-annotations    Task 10 send menu and batch…      17h
Needs input
   ◐ waiting-for-decision      answer: 选 A 还是 B？                2m
Completed
   ✔ probe_ok response validation   replied exactly PROBE_OK      10s
   ✔ orca v1.4.258 integration      本地 Orca 应用已从…            1h
────────────────────────────────────────────────────────────
❯ describe a task for a new session
────────────────────────────────────────────────────────────
  ↑↓ select · enter enter · ctrl+x stop · / task
```

- **分段**：`Working` / `Needs input` / `Completed`。判定规则（写死，不留歧义）：
  - `Needs input`：**名单里的** `state === "blocked"`。这个判断由 CLI 自己算（`tempo === "blocked" || status === "waiting"` → blocked），所以它是最权威的信号。
  - `Working`：其余 `state === "working"` 的条目。
  - `Completed`：`state ∈ {done, stopped, failed}`。
  - 名单里的 `state` 缺失时（更旧的 CLI）：`working` → Working，其余 → Completed。
  - **不要**用 `state.json` 的 `needs` / `block.questions` 来分段。那两个字段是**条件字段** —— 只有 agent 被卡住等决定时才写（实测：本机 18 个 job 一个都没被卡过，全都没有这两个字段）。它们只用来在行里显示"它在问你什么"，不参与分段。
- **行**：`❯` 指针（仅选中行）+ 状态点 + name + detail + 右侧 elapsed。
  - detail 取自 `state.json` 的 `detail`；缺失时该格留空。
  - elapsed 从 `startedAt`（`--json`）起算，`--json` 不可用时用 `state.json` 的 `createdAt`。
- **header 计数**：`N awaiting input · N working · N completed`。
- **底部 composer**：输入一句话 → `Enter` 派发一个新后台 agent（见 §6.1）。
- **键盘**：

  | 键                           | 行为                                                                                                |
  | ---------------------------- | --------------------------------------------------------------------------------------------------- |
  | `↑` / `↓`                    | 移动选择                                                                                            |
  | `Enter`                      | 进入选中的 agent（屏 2）                                                                            |
  | `Ctrl+X`                     | 停止（Working/Needs input）或删除（Completed）；**两步确认**，第一次行内显示 `ctrl+x again to stop` |
  | `/`                          | 聚焦 composer（写一句话派发新 agent）                                                               |
  | `Esc`                        | composer 有内容就清空；否则把焦点还给面板根                                                         |
  | `Enter`（composer 有内容时） | 派发                                                                                                |

  **v1 不做文本过滤。** Claude Code 的 TUI 本身没有 `/` 搜索（实测它的快捷键条是 `enter to return · space to reply · ctrl+x to delete · ? for shortcuts`），而这个面板的全部意义就是**镜像 CLI 的那个 TUI** —— 它的底部就是一个随时可以写任务的输入框，不是搜索框。`/` 只是把焦点送到那个输入框的快捷键。

### 3.2 屏 2：详情（内嵌 attach 终端）

```
┌ ← 返回 │ claude agents cli │ working │ ~/ctjt/test/aieditor │ 4m ┐
│ ┌────────────────────────────────────────────────────────────┐ │
│ │  ▐▛███▛█ Claude Code v2.1.319                               │ │
│ │  ❯ 跟这个 agent 说点什么…                                  │ │
│ │  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents │ │
│ └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- 上方是 Orca 自己的 header：← 返回按钮 + name + state + cwd + elapsed。
- 下方是**内嵌 xterm**，跑 `claude attach <id>`，是**完整的 Claude Code TUI**，可打字、可批准权限。
- **← 由 Orca 拦截**：不转发给 Claude Code，而是销毁 attach 客户端 → 回屏 1。实测该 agent 继续跑。
  - 代价：输入框里不能用 ← 左移光标。用 `Home` / `⌘←` 代替；header 上有可见的「← 返回」按钮作为等价入口。
- `Esc` 同样返回屏 1（当焦点不在终端输入框时）。

### 3.3 旧内容的去向

面板里 Orca 的三类前台对象（结构化会话 / 终端 tab / AI Vault transcript）**全部移除**。理由：

- 终端 tab 就在眼前；AI Vault 已经在管磁盘 transcript（activity bar 里的 `Agents` tab）。
- 保留它们就等于继续把后台 agent 当前台 agent 对待 —— 这次重做的核心正是拆掉这个混淆。

## 4. 架构

### 4.1 模块

```
┌─ main 进程 ──────────────────────────────────────────────────────┐
│ claude/background-agents/                                        │
│   claude-background-agent-list.ts     （已有）claude agents --json │
│   claude-background-agent-job-state.ts（新）读 ~/.claude/jobs/    │
│   claude-background-agent-commands.ts （新）--bg / stop / rm      │
│ ipc/claude-agents/                                               │
│   claude-agents-listing.ts            （新）IPC: 列出 + 详情      │
│   claude-agents-command.ts            （新）IPC: 派发/停止/删除    │
└───────────────────────────────────────────────────────────────────┘
┌─ renderer ────────────────────────────────────────────────────────┐
│ components/background-agents/                                     │
│   BackgroundAgentsPanel.tsx        屏 1 ⇄ 屏 2 的路由            │
│   BackgroundAgentListScreen.tsx    （新）屏 1                     │
│   BackgroundAgentRow.tsx           （改）行                       │
│   BackgroundAgentAgentScreen.tsx   （新）屏 2                     │
│   embedded-agent-terminal.tsx       （新）内嵌 xterm + 传输        │
│   background-agent-list-rows.ts    （新）合并/分段的纯函数         │
│ store/slices/background-agents/    （新）屏状态 + 列表数据        │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 为什么新写内嵌终端而不复用 TerminalPane

`TerminalPane` 绑死在 tab/pane 拓扑上（`tabId` / `worktreeId` / `isActive` 必填，25 个 controller 文件）。

但 Orca **已经有一个与拓扑解耦的活终端**：`src/renderer/src/components/standalone-terminal/open-standalone-terminal.ts:47`。它持有 xterm 实例、装 IME/键盘/粘贴/链接/kitty 策略，**调用方自带传输层**。既有两个生产用法：

- `src/renderer/src/components/plain-ssh-terminal/PlainSshTerminalView.tsx:81` —— 主窗口里的浮动活终端
- `src/renderer/src/components/dashboard-popout/AgentTerminalPreview.tsx:203` —— 抽屉里的活预览终端（**不是**只读快照，它有活流也能输入）

所以屏 2 复用 `openStandaloneTerminal` + `preview-terminal-*` 那 15 个策略插件，**新写量约 200–300 行**，零协议改动。

### 4.3 传输层：起一个游离 PTY

屏 2 用 `window.api.pty.spawn({...})` 起一个**不属于任何 tab** 的 PTY，再用 `subscribeToPtyData` / `pty.write` / `pty.resize` / `pty.kill` 驱动。

spawn 参数：

| 参数              | 值                                                  | 理由                                                                                                          |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `command`         | `buildClaudeAttachStartup({ agentId, cwd })` 的产物 | 已存在（`src/shared/ai-vault/resume/ai-vault-attach-startup.ts:20`），它把 agent id 正确加引号                |
| `commandDelivery` | `'provider'`                                        | 由 provider 投递命令，渲染器不往 shell 里打字。`src/main/runtime/terminal/launch/terminal-create.ts:147` 同款 |
| `worktreeId`      | `FLOATING_TERMINAL_WORKTREE_ID`                     | 见 §4.3.3                                                                                                     |
| `cwd`             | agent 的 `cwd`                                      | attach 不要求 cwd 一致，但用 agent 自己的更自然                                                               |
| `cols` / `rows`   | 侧栏容器实测尺寸                                    | 由 `FitAddon` + `ResizeObserver` 得出                                                                         |

**注意**：daemon 侧 `opts.command` 走的是 shell（`daemon-pty-session-spawn.ts:241` 解析 `effectiveShellPath`），所以 `claude attach` 退出后 shell 仍在。attach 进程死掉不靠 shell 退出判定 —— 屏 2 header 显示的 state 来自列表轮询，足以让用户看到「已停止」。

### 4.3.1 收数据：必须用 `subscribeToPtyData`，不能用裸 `pty.onData`

`window.api.pty.onData` 只注册一个字节回调，**不装 dispatcher**。dispatcher 才负责握手（`pty:rendererDispatcherReady`）和 **ACK**（`src/renderer/src/components/terminal-pane/pty-transport/delivery/pty-data-sidecar-subscriptions.ts:7`）。没有 ACK，main 侧 `rendererDeliveryAccountingByPty` 的 `sentChars - ackedChars` 会越过 `PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS`，`canSendPtyDataToRenderer` 转为 false —— **终端在几万字节后静默卡死**。

正确 API 是 `subscribeToPtyData(ptyId, cb)`：它装 dispatcher、发握手、自动 `acquirePtyDeliveryInterest(ptyId)`（关掉隐藏投递门），并且挂在 `ptyDataSidecars`（多观察者 Map），**不碰** `ptyDataHandlers` 的主槽位。

顺带澄清两条通道的语义（**与直觉相反**）：

| 通道                           | 观察者数                                                                      | 何时用                   |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------ |
| `pty:data` + `ptyDataHandlers` | **每 ptyId 只有一个**（`ipc-pty-session-handlers.ts:129` 是覆盖式 `Map.set`） | 观察一个 pane 拥有的 pty |
| `terminalPreview:*`            | **多观察者**（main 侧独立订阅表 + 独立 IPC 通道）                             | 第二个观察者             |

我们的 PTY 没有 pane 主人，两条路都不会撞；但**必须走 `pty:data` 系** —— `terminalPreview:connect` 要求该 pty 已有快照，而我们要 attach 的 pty 是我们刚 spawn 的。

### 4.3.2 三个必须显式设置的东西

| 调用                                                    | 时机             | 理由                                                                                                                                |
| ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pty.setRendererPtyVisible(id, true)`                   | spawn 成功后立刻 | ① 让 main 交出 startup 查询权威，DA/DSR 由我们的 xterm 作答；② daemon 不 throttle 它。**绝不要**调 `setHiddenRendererPty(id, true)` |
| `answersQueries: true`（`openStandaloneTerminal` 参数） | 建 xterm 时      | 我们的 pty 没有第二个 emulator；`false` 会丢弃 xterm 对查询的自动回复，Claude Code TUI 的终端探测就答不上来                         |
| `pty.getMainBufferSnapshot(id, { scrollbackRows })`     | 挂 xterm 后立即  | `pty:data` 是裸流，没有 `terminalPreview:connect` 的原子快照；首帧可能缺失或截在半个转义序列里，用快照补一次                        |

`setPtyDeliveryInterest` 由 `subscribeToPtyData` 自动完成，不要重复调。

### 4.3.3 两个副作用（接受，但要知情）

1. **状态栏会多一条「N without a tab」。** `FLOATING_TERMINAL_WORKTREE_ID` 是 Orca 自己的浮动工作区 id，我们的 pty 会被记到它名下（`pty-terminal-summary.ts:67, 86, 93-95` 标成 `orphaned: true`）。这是**唯一**能拿到 `isUnshown()` 豁免的 id，换成自己的哨兵就会被自动 place，所以接受。
2. **Orca 会把 `claude attach` 认成「Claude agent 启动」。** `isClaudeLaunchCommand`（`src/main/ipc/pty/host-env/fresh-spawn-routing.ts:6`）匹配到 `claude` → Claude 账号 env 会被注入（**这是好事**），但这个 pty 也会出现在 Orca 的 agent 状态面里。

### 4.4 生命周期

> **对既有护栏的影响：无。** `tests/e2e/terminal-layout-parity.spec.ts` 的 `waitForHostTerminals` 用 `terminal.list { worktree: 'id:<id>' }` 查询，而 `runtime-terminal-list.ts:152-154` 会按 `pty.worktreeId !== targetId` 过滤 —— 我们的 pty 记在 `global-floating-terminal` 名下，不计入任何具体 workspace 的终端数。parity 断言不受影响。

| 事件                       | 动作                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| 进入屏 2                   | `pty.spawn('claude attach <id>')` → 拿到 ptyId → 挂 xterm                                    |
| 离开屏 2（← / Esc / 按钮） | `pty.kill(id)` → 回屏 1。**后台 agent 不受影响**（实测）                                     |
| 重新进入                   | 重新 spawn + attach（daemon attach 实测 ~22ms）                                              |
| 侧栏 tab 切走              | 面板卸载 → **保留** attach（屏状态在 store slice 里），切回来时重新挂 xterm 订阅同一个 ptyId |
| 应用退出                   | PTY 随 main 进程结束；后台 agent 是 Claude Code 的进程，不受影响                             |

**Orca 的浮动终端生命周期只做存活探测、不负责 kill**（`src/main/runtime/terminal/lifecycle/floating-session-liveness.ts`）。我们的 PTY 没有 pane 主人，所以**只有我们自己的 `pty.kill` 或 main 进程退出**能结束它 —— 卸载时必须 kill，否则会留下孤儿进程。

## 5. 数据层

### 5.1 列表 = 两个来源合并

| 来源                                  | 给出                                                                                           | 成本                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| `claude agents --json`                | `id` / `sessionId` / `name` / `cwd` / `kind` / `startedAt` / `state` / `status` / `pid`        | **~1.2s**（进程启动） |
| `~/.claude/jobs/<agentId>/state.json` | `detail` / `tempo` / `inFlight` / `fan` / `tokens` / `needs` / `block.questions` / `updatedAt` | **~10ms**（fs 读）    |

`state.json` 的 `detail` 已实测与 FleetView 的灰字逐字一致，所以它就是那一列的来源。

### 5.2 刷新策略（由实测成本决定）

`claude agents --json` 要 1.2s，**不能** 2s 轮询。所以分两层：

- **快层（每 2s）**：读已知的 agent 的 `state.json` → 更新 detail / tokens / inFlight / state。纯 fs，成本可忽略。
- **慢层（每 15s，面板可见时）+ 手动刷新 + 面板打开时**：跑 `claude agents --json` → 对齐名单、存活（`pid`/`status`）、新出现的 agent。

`state.json` 读不到或字段缺失时**降级**：行仍在，只是没有 detail 那一格。任何来源出错都不得让面板变空白。

### 5.3 过滤

- **只列 `kind === "background"` 且有 `id` 的条目。** `kind: "interactive"`（用户自己在 iTerm 里跑的 `claude`）没有短 id，`claude attach` 吃不了它，FleetView 也不列。它们仍归 AI Vault 管。
- **不做 workspace 目录过滤。** FleetView 是 host 级的；`claude agents --cwd <path>` 这个参数存在但那是启动期参数，TUI 里没有对应 UI。v1 跟随 FleetView：host 级。

### 5.4 远程宿主（v2 预留）

`listRunningAgentsForHost`（`src/main/ipc/ai-vault/ai-vault-running-agents.ts:20`）已经示范了「按 executionHost 选本机 / 配对 runtime」的路由。v2 沿用它：远程的 `state.json` 由宿主侧读、两个来源在宿主侧合并后回传。**v1 只答本机**，远程 workspace 打开本面板时给一条明确说明，不假装列表是空的。

## 6. 派发 / 停止 / 删除

### 6.1 派发（composer）

`claude --bg "<prompt>"` 打印短 id 并后台起会话 —— 这是程序化派发通道。走 `@orca/process-host`（`runProcess`），继承现有 Claude 账号/代理环境。

- 派发参数：`claude --bg [--model <m>] [--permission-mode <p>] [--cwd <dir>] "<prompt>"`。`cwd` 默认当前 workspace 目录。
- 派发中先在列表顶部插一行 `opening… · esc to cancel` 的占位行（对齐 FleetView）。
- 失败：占位行变成失败态 + toast，不静默。

### 6.2 停止 / 删除

| 目标状态              | 动作                | 命令               |
| --------------------- | ------------------- | ------------------ |
| Working / Needs input | 停止（会话保留）    | `claude stop <id>` |
| Completed             | 删除（连 worktree） | `claude rm <id>`   |

两步确认：第一次按 `Ctrl+X` 只 arm，行内显示 `ctrl+x again to stop`；3s 内再按才执行。删除是**不可逆**的（连 worktree 一起删），确认文案必须写明。

## 7. 键盘与焦点

- **屏 1** 自己处理 `keydown`；面板根节点 `tabIndex={-1}` + `onKeyDown`，只在自己是 `event.target` 时才处理。**直接复用 AI Vault 面板已有的模式**（`src/renderer/src/components/right-sidebar/ai-vault/session-list/use-ai-vault-session-keyboard-navigation.ts:117` 的 `aiVaultPanelKeyboardRootProps`）。
- **屏 2** 拦 `←`：**不能**再调一次 `terminal.attachCustomKeyEventHandler` —— xterm 只有**一个** custom key handler 槽位（`this._customKeyEventHandler = e`，覆盖式），而 `openStandaloneTerminal` 内部已经用 `installPreviewTerminalKeyHandler` 占用了（`open-standalone-terminal.ts:93-108`）。再调一次会把复制/粘贴/快捷键/IME 全顶掉。
  - **做法**：给 `openStandaloneTerminal`（或 `installPreviewTerminalKeyHandler`）加一个可选钩子 `claimKeyEvent?: (event: KeyboardEvent) => boolean`，形态照抄已有的 `claimImeKeyEvent`。返回 true 即吞掉该事件。
- **pane 的键盘监听不会抢我们的键**（已确证）：`onKeyDown` 第一件事就是 scope guard（`terminal-keyboard-event-handlers.ts:116-119`）—— `keyboardEventBelongsToScope` 检查事件是否落在 TerminalPane 自己的容器里。侧栏的 xterm 不在 pane 容器内 → 直接 return，**根本走不到** `resolveTerminalKeyboardPane` 的 `getActivePane()` fallback。`PlainSshTerminalView` 就是靠这一条躲开的，不需要任何哨兵。
- **但 app 级全局快捷键会抢**：`isEditableTarget` **明确排除** `.xterm-helper-textarea`（`src/renderer/src/lib/text-input/focus/editable-target.ts:13-16` —— 注释说 xterm 的隐藏 textarea 表示终端焦点，全局快捷键仍要生效），所以在侧栏终端里按 `Cmd+W` 可能关掉一个 tab。
  - **做法**：给侧栏终端容器加 `data-agent-terminal-preview` 哨兵（`isAgentTerminalPreviewTarget` 认它，`use-global-keybindings.ts:171` 用它让关闭类快捷键让路）。
- 终端输入框内 `Esc` 归终端（Claude Code 自己在用 Esc）；焦点不在终端时 `Esc` 回屏 1。

## 8. 失败与降级

| 情况                                        | 表现                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本机没有 `claude`                           | 面板显示「未找到 Claude Code CLI」，而不是空列表                                                                                                                                              |
| `claude agents --json` 超时（5s）/ 非零退出 | 保留上一次的名名单，列表不闪空                                                                                                                                                                |
| `state.json` 读不到                         | 该行没有 detail，其余正常                                                                                                                                                                     |
| `claude attach` 立刻退出（agent 已死）      | 屏 2 显示「该 agent 已停止」+ 返回按钮                                                                                                                                                        |
| attach 的 agent 在别的主机                  | v1：不列出（列表是本机的）                                                                                                                                                                    |
| 侧栏太窄（默认 280px ≈ 35 列）              | **右侧边栏可以拖宽**（`right-sidebar/index.tsx:234` 有 resize 手柄）→ 用户拖宽即可。v1 **不做**「在主区域打开」那个按钮：它要接 Orca 的终端 pane 启动路径，而计划里没有任何任务映射过那条路径 |

## 9. 测试策略

按 `docs/agents-md-refs/test-antipatterns.md`：测试必须在「回退改动就会失败」的那一层，且只测业务逻辑。

| 层     | 测什么                                                                     | 位置                                         |
| ------ | -------------------------------------------------------------------------- | -------------------------------------------- |
| 纯函数 | 两个来源合并成行；Working/Needs input/Completed 分段与计数；elapsed 格式化 | `background-agent-list-rows.test.ts`         |
| 纯函数 | `state.json` → 行的映射，缺字段时的降级                                    | `claude-background-agent-job-state.test.ts`  |
| 组件   | 屏 1 ⇄ 屏 2 的状态机；`Enter` 进入、`←` 返回、`Ctrl+X` 两步确认            | `BackgroundAgentsPanel.test.tsx`             |
| E2E    | 真实 `claude --bg` 派发 → 出现在列表 → 进入 → 返回后 agent 仍活着          | `tests/e2e/claude-background-agents.spec.ts` |

**不做**的测试：不断言 xterm 的像素、不为「列表看起来对」写快照测试。

## 10. 风险与取舍

| 风险                                         | 取舍                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `state.json` 是 Claude Code 的内部格式，会变 | 只当**可选增强**；读不到就少一列，绝不让面板挂掉。名单的权威来源仍是 `claude agents --json` |
| 侧栏默认 280px，Claude Code TUI 挤           | 屏 2 提供「在主区域打开」的逃生舱                                                           |
| ← 被 Orca 拦截，牺牲输入框光标左移           | 用户明确要 ← 返回列表；用 `Home`/`⌘←` 补位，并提供可见按钮                                  |
| 每次进入都重新 spawn `claude attach`         | 实测 daemon attach ~22ms，可接受；换来「返回列表不残留进程」的干净语义                      |
| v1 不支持远程                                | 用户已确认取舍；数据层按宿主切分，v2 补                                                     |

### 10.1 实现期必须验的三件事（代码勘察已定位风险，但没跑过）

1. **终端在几万字节后静默卡死** —— 用裸 `pty.onData` 就没有 ACK，main 会停投递。必须走 `subscribeToPtyData`（§4.3.1）。E2E 里要真的把一段长输出灌进去验证不卡。
2. **Claude Code TUI 的 DA/DSR 终端探测答不上来** —— 取决于 `setRendererPtyVisible(id, true)` 是否真的把 startup 查询权威交给了 xterm（§4.3.2）。
3. **`claude attach` 的 cwd 被 Orca 的 agent 启动守卫拒绝** —— `assertSafeAgentStartupCwd(cwd, command)`（`src/main/providers/local-pty/local-pty-launch-plan.ts:195`）对 `claude attach` 的判定未验。

### 10.2 已知副作用（接受）

- 状态栏的「N without a tab」会多一条（§4.3.3）。
- 这个 pty 会出现在 Orca 的 agent 状态面里（§4.3.3）—— 因为 `claude attach` 被认成 Claude agent 启动。

## 11. 与既有工作的关系

- `src/renderer/src/components/background-agents/` 整个目录重写。旧的
  `use-background-agent-sessions.ts` / `background-agent-session-list.ts` /
  `background-agent-terminal-rows.ts` / `background-agent-vault-rows.ts` /
  `background-agent-vault-resume.ts` / `background-agent-workspace-scope.ts`
  随三类旧行一起删除。
- `src/main/claude/background-agents/claude-background-agent-list.ts` 扩展字段（补 `state`/`status`/`startedAt`/`kind`），不推翻。
- AI Vault 的 resume 机器**不删**：AI Vault 面板自己还在用它。本面板只是不再复用它。
- `aiVault.listRunningAgents` 保留给 AI Vault 用；本面板走新的 IPC。

## 12. 明确的取舍记录

- 用户选择：**详情屏 = 内嵌 attach 终端**（而非原生只读视图 / 原生输入 / 全宽终端页）。
- 用户选择：**位置 = 右侧边栏 tab**（沿用上次的位置）。
- 用户选择：**v1 = 列表 + 内嵌终端 + ← 返回 + 派发 + 停止/删除**，不含远程宿主。
- 用户选择：**旧的 Orca 三类行全部移除**。
