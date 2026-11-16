# Claude 后台 agent 监管器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Orca 右侧边栏的 `background-agents` 面板从「Orca 前台会话索引」重做成「Claude Code 后台 agent 监管器」——列表屏列出活着的后台 agent，详情屏内嵌一个可交互的 `claude attach` 终端，方向键返回列表。

**Architecture:** 列表由两个来源合并：`claude agents --json`（名单与存活，~1.2s，15s 慢轮询）与 `~/.claude/jobs/<id>/state.json`（那行灰字 detail，~10ms，2s 快轮询）。详情屏在 Orca 里起一个**不属于任何 tab** 的游离 PTY 跑 `claude attach <id>`，用 `openStandaloneTerminal` 渲染 xterm，用 `subscribeToPtyData` 收字节。← 键由 Orca 拦截，销毁 attach 客户端后回列表，后台 agent 继续跑。

**Tech Stack:** Electron main（IPC / `@orca/process-host` / `node:fs`）、React 19 + Zustand（renderer store）、`@xterm/xterm`（内嵌终端）、Vitest（单测）、Playwright（E2E）。

**Spec:** `docs/superpowers/specs/2026-11-15-claude-background-agents-supervisor-design.md`

## Global Constraints

- 面板只列 `kind === "background"` 且有短 id 的 agent；`kind: "interactive"`（用户自己在 iTerm 跑的 claude）不列。
- 短 id 必须是 `/^[0-9a-f]{8}$/`。**永远按短 id 操作，绝不按名字** —— `claude attach`/`stop`/`rm` 都接受名字的部分匹配，同名 agent 会命中错的。
- v1 **只支持本机宿主**。远程 workspace 打开本面板时给明确说明，不假装列表是空的。
- 旧的三类 Orca 前台对象（结构化会话 / 终端 tab / AI Vault transcript）**从本面板全部移除**。
- `claude agents --json` 单次约 **1.2s**，所以它只能做慢轮询；`state.json` 读约 **10ms**，做快轮询。**任何任务都不许把 `--json` 放进 2s 轮询。**
- `~/.claude` 用 `defaultClaudeConfigDir(env)`（`src/main/claude/claude-config-dir-pin.ts:21`）解析，认 `CLAUDE_CONFIG_DIR`，不硬编码 home 路径。
- 收 PTY 字节**必须**用 `subscribeToPtyData`，**不得**用裸 `window.api.pty.onData`（没有 dispatcher 就没有 ACK，几万字节后静默卡死）。
- `openStandaloneTerminal` 的 `answersQueries` 必须传 `true`（没有第二个 emulator）。
- 游离 PTY 的 `worktreeId` 必须是 `FLOATING_TERMINAL_WORKTREE_ID`（`src/shared/constants.ts:67`）—— 这是唯一能拿到 `isUnshown()` 豁免、不会被自动 place 成 tab 的 id。
- 命名：不用 `helpers` / `utils` / `common`；文件名取领域概念。
- 注释：只写「为什么」，不写「怎么做」；一行一条。
- 跨平台：不硬编码 `e.metaKey`；路径用 `path.join`；子进程走 `@orca/process-host`。
- 不新建测试来测「看起来对」的东西；每个测试必须**回退改动就会失败**。
- 提交前跑 `pnpm exec oxlint <files>`、`pnpm exec oxfmt --check <files>`、`pnpm tc:web`；推送前跑 `pnpm check:changed`。

## Review Focus

这五条是 spec 暗示、但没有哪个任务自己的测试覆盖、且最可能真正咬到人的输入。**每一条都在下面指明了归属任务的测试步骤。**

1. **两个同名 agent** —— 用户自己起的名字可以重复（实测 agent 的名字会自己从 prompt 文本变成 "bash sleep command"）。按名字 attach 会命中错的那个 → Task 3 用 id 正则守卫 + Task 3 的同名用例。
2. **agent 在详情屏里死掉** —— `claude attach` 的进程退出后 shell 还在，终端看起来像"还活着" → 靠**名单轮询**发现（spec §4.3：attach 进程死掉不靠 shell 退出判定）：Task 9 的详情屏调 Task 7 的 `useBackgroundAgentRosterRefresh()`，header 的 state 跟着名单变 + Task 11 的 E2E 断言「← 返回后 agent 还在」。
3. **agent 的 name 自己变了** —— 实测名字会自己改（`Wait 20 seconds…` → `bash sleep command`）。行标题必须跟着变，不能冻结 → Task 5 的「详情轮询后 name 更新」用例。
4. **agent 在等你做决定** —— `state: "blocked"` / `needs: "answer: …"`。如果它混在 Working 段里，用户永远不会知道有个 agent 卡在等他 → Task 5 的「blocked 落到 needs-input 段」用例。
5. **慢刷新期间列表闪空** —— `--json` 要 1.2s，这期间旧行必须留在 → Task 6 的「刷新期间保留旧名单」用例。

---

## File Structure

### 新建

| 文件                                                                                | 职责                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/main/claude/background-agents/claude-background-agent-job-state.ts`            | 读 `~/.claude/jobs/<id>/state.json` → detail                  |
| `src/main/claude/background-agents/claude-background-agent-job-state.test.ts`       | 上面那个的测试                                                |
| `src/main/claude/background-agents/claude-background-agent-commands.ts`             | 派发 / 停止 / 删除三个命令                                    |
| `src/main/claude/background-agents/claude-background-agent-commands.test.ts`        | 上面那个的测试                                                |
| `src/main/ipc/claude-agents/claude-agents.ts`                                       | 4 个 IPC handler + 注册函数                                   |
| `src/preload/api/claude-agents-api.ts`                                              | preload 类型                                                  |
| `src/preload/api/claude-agents-bridge.ts`                                           | preload 实现                                                  |
| `src/renderer/src/web/preload-api/web-claude-agents-api.ts`                         | web 端 stub（避免刷警告）                                     |
| `src/renderer/src/components/background-agents/background-agent-list-rows.ts`       | 合并两个来源 → 行；分段；计数；过滤；elapsed 格式化（纯函数） |
| `src/renderer/src/components/background-agents/background-agent-list-rows.test.ts`  | 上面那个的测试                                                |
| `src/renderer/src/components/background-agents/BackgroundAgentListScreen.tsx`       | 屏 1：header + 三段 + 行 + composer + 键盘                    |
| `src/renderer/src/components/background-agents/BackgroundAgentAgentScreen.tsx`      | 屏 2：header + 内嵌终端                                       |
| `src/renderer/src/components/background-agents/background-agent-terminal.tsx`       | 内嵌 xterm：spawn / 订阅 / fit / 输入 / ← 拦截                |
| `src/renderer/src/store/slices/background-agents/create-background-agents-slice.ts` | 屏状态 + 名单 + detail + attach 的 ptyId                      |

### 修改

| 文件                                                                           | 改什么                                                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/claude-background-agents.ts`                                       | `ClaudeBackgroundAgent` 加 4 个字段；新增 `ClaudeBackgroundAgentDetail` / `ClaudeBackgroundAgentState` / `ClaudeBackgroundAgentStatus` |
| `src/shared/claude-background-agents.test.ts`                                  | 跟上新字段                                                                                                                             |
| `src/main/claude/background-agents/claude-background-agent-list.ts`            | 解析时保留新字段                                                                                                                       |
| `src/main/ipc/register-core-handlers/register-core-handlers.ts`                | 注册新 handler                                                                                                                         |
| `src/preload/api-types.ts`                                                     | `PreloadApi` 加 `claudeAgents`                                                                                                         |
| `src/preload/index.ts`                                                         | 把 bridge 挂进 preload 对象                                                                                                            |
| `src/renderer/src/web/web-preload-api.ts`                                      | 把 web stub 挂进去                                                                                                                     |
| `src/renderer/src/store/index.ts`                                              | 挂新 slice                                                                                                                             |
| `src/renderer/src/store/types.ts`                                              | `AppState` 加新 slice                                                                                                                  |
| `src/renderer/src/store/testing/app-store-test-fixture.ts`                     | `createTestStore()` 里也挂新 slice                                                                                                     |
| `src/renderer/src/components/standalone-terminal/open-standalone-terminal.ts`  | 加 `claimKeyEvent` 钩子                                                                                                                |
| `src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts` | 认这个钩子                                                                                                                             |
| `src/renderer/src/components/background-agents/BackgroundAgentsPanel.tsx`      | 重写成两屏路由                                                                                                                         |
| `src/renderer/src/components/background-agents/BackgroundAgentRow.tsx`         | 重写成新行                                                                                                                             |
| `src/renderer/src/i18n/locales/en.json`                                        | 换掉 `auto.components.backgroundAgents.*`                                                                                              |

### 删除

`src/renderer/src/components/background-agents/` 下的
`background-agent-session-list.ts`、`background-agent-terminal-rows.ts`、
`background-agent-terminal-rows.test.ts`、`background-agent-vault-resume.ts`、
`background-agent-vault-rows.ts`、`background-agent-vault-rows.test.ts`、
`background-agent-workspace-scope.ts`、`background-agent-workspace-scope.test.ts`、
`use-background-agent-sessions.ts`

（这 9 个文件只在 `background-agents/` 目录内部被引用，删除不波及别处。）

---

### Task 1: 共享类型与解析

**Files:**

- Modify: `src/shared/claude-background-agents.ts`
- Modify: `src/shared/claude-background-agents.test.ts`
- Modify: `src/main/claude/background-agents/claude-background-agent-list.ts`

**Interfaces:**

- Produces:
  ```ts
  export type ClaudeBackgroundAgentState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
  export type ClaudeBackgroundAgentStatus = 'busy' | 'idle' | 'waiting'

  export type ClaudeBackgroundAgent = {
    id: string
    sessionId: string
    name: string
    cwd: string
    /** 'background' for a daemon-backed agent; 'interactive' for a foreground terminal session. */
    kind?: 'background' | 'interactive'
    /** Epoch ms the agent started. */
    startedAt?: number
    /** The agent's own state word; an older host omits it. */
    state?: ClaudeBackgroundAgentState
    /** 'busy' while the agent is turning; 'waiting' when it needs a decision. */
    status?: ClaudeBackgroundAgentStatus
  }

  /** What the agent's own job state file says; the CLI's listing does not carry it. */
  export type ClaudeBackgroundAgentDetail = {
    /** The gray line under the agent's name. */
    detail: string | null
    /** The agent's own question, when it waits for a decision. */
    needs: string | null
    /** Epoch ms of the last state change. */
    updatedAt: number | null
  }

  /** What the panel gets over IPC. */
  export type ClaudeBackgroundAgentListResult = {
    /** 'unsupported' means this machine has no Claude Code CLI to ask. */
    status: 'ready' | 'unsupported' | 'error'
    agents: ClaudeBackgroundAgent[]
    /** The job state files, keyed by agent id. */
    details: Record<string, ClaudeBackgroundAgentDetail>
    /** Why the listing failed, when status is 'error'. */
    message: string | null
  }

  /** What a dispatch, stop or remove reports back. */
  export type ClaudeBackgroundAgentCommandResult =
    | { ok: true; id: string }
    | { ok: false; message: string }
  ```
  `parseClaudeBackgroundAgents(stdout: string): ClaudeBackgroundAgent[]` 继续返回同名类型，但**多带**上面 4 个可选字段。

**这三个新类型都住在 `src/shared/`** —— preload 和 renderer 都要用它们，而 main 侧的模块不能被 preload import。

**Why the new fields are optional:** 配对的远程宿主可能跑着更旧的 Orca，它的 `aiVault.listRunningAgents` 回的是旧形状。字段可选 = 旧宿主不会让类型撒谎；真正的监管器在本地，字段总是齐的。

- [ ] **Step 1: 写失败的测试**

改 `src/shared/claude-background-agents.test.ts`：第一个用例的期望对象加上 `kind: 'background'`、`startedAt: 14345`、`state: 'blocked'`、`status: 'idle'`，fixture 里补上对应字段。再加两个用例：

```ts
it('keeps the fields the supervisor needs', () => {
  const agents = parseClaudeBackgroundAgents(
    JSON.stringify([
      {
        pid: 14459,
        id: '8857ad86',
        cwd: '/repos/app',
        kind: 'background',
        sessionId: '8857ad86-88ad-4680-81f9-861c71626bb0',
        name: 'init orca (2)',
        startedAt: 14345,
        status: 'idle',
        state: 'blocked'
      }
    ])
  )
  expect(agents[0]).toMatchObject({
    kind: 'background',
    startedAt: 14345,
    state: 'blocked',
    status: 'idle'
  })
})

it('drops a state word it does not know', () => {
  const agents = parseClaudeBackgroundAgents(
    JSON.stringify([{ id: 'a', sessionId: 's', state: 'nonsense' }])
  )
  expect(agents[0].state).toBeUndefined()
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/shared/claude-background-agents.test.ts --maxWorkers=2`
Expected: FAIL —— `kind`/`startedAt`/`state`/`status` 现在被解析器丢掉了。

- [ ] **Step 3: 扩类型与解析器**

在 `src/shared/claude-background-agents.ts` 里加上面三个类型，给 `ClaudeBackgroundAgent` 加 4 个可选字段。
在 `parseClaudeBackgroundAgentsValue` 的循环里，把 `kind`/`startedAt`/`state`/`status` 一起带出来：

- `kind`：只认 `'background'` 和 `'interactive'`，其它值当 `undefined`。
- `startedAt`：只认 `typeof entry.startedAt === 'number'`，否则 `undefined`。
- `state` / `status`：只认各自那组枚举里的值，否则 `undefined`。

**不要**改变现有的两条规则：没有 `id` 或没有 `sessionId` 的条目照旧被丢掉（`kind: "interactive"` 的条目没有 id，正好被这条规则滤掉）。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/shared/claude-background-agents.test.ts --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 确认 main 侧的解析器也带上新字段**

`src/main/claude/background-agents/claude-background-agent-list.ts` 现在调用 `parseClaudeBackgroundAgents(result.stdout)`，解析器变了它自动跟上，**不需要改这个文件**。跑一次它的测试确认没坏：

Run: `pnpm test src/main/claude/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/shared/claude-background-agents.ts src/shared/claude-background-agents.test.ts
git commit -m "feat(claude-agents): keep the fields the supervisor needs

The listing carried only id/sessionId/name/cwd, so the panel could not
tell a working agent from one waiting for a decision, nor show the
agent's own current activity."
```

---

### Task 2: main 侧读 job 的 state.json

**Files:**

- Create: `src/main/claude/background-agents/claude-background-agent-job-state.ts`
- Create: `src/main/claude/background-agents/claude-background-agent-job-state.test.ts`

**Interfaces:**

- Consumes: `ClaudeBackgroundAgentDetail`（Task 1 产出）
- Produces:
  ```ts
  export type ClaudeBackgroundAgentJobStateOptions = {
    /** Injected so a test reads a fixture instead of the real ~/.claude. */
    readFile?: (path: string) => Promise<string | null>
    /** Injected so a test does not read the real home directory. */
    configDir?: string
  }

  export async function readClaudeBackgroundAgentJobState(
    agentId: string,
    options?: ClaudeBackgroundAgentJobStateOptions
  ): Promise<ClaudeBackgroundAgentDetail | null>
  ```

**Why `null` and not a partial:** 读不到这个文件是**正常**的（旧的 agent、非 daemon 起的 agent、别的 CLI 版本）。返回 `null` 让调用方降级成「没有 detail 那一格」，而不是让整个面板失败。

- [ ] **Step 1: 写失败的测试**

`src/main/claude/background-agents/claude-background-agent-job-state.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { readClaudeBackgroundAgentJobState } from './claude-background-agent-job-state'

describe('readClaudeBackgroundAgentJobState', () => {
  it('reads the agent’s current activity', async () => {
    const detail = await readClaudeBackgroundAgentJobState('4f5d4302', {
      configDir: '/cfg',
      readFile: async (path) => {
        expect(path).toBe('/cfg/jobs/4f5d4302/state.json')
        return JSON.stringify({
          state: 'working',
          detail: '正在核对后台 agent 实现',
          needs: 'answer: 选 A 还是 B？',
          updatedAt: 1794729224070
        })
      }
    })
    expect(detail).toEqual({
      detail: '正在核对后台 agent 实现',
      needs: 'answer: 选 A 还是 B？',
      updatedAt: 1794729224070
    })
  })

  it('reads nothing when the file is gone', async () => {
    expect(
      await readClaudeBackgroundAgentJobState('4f5d4302', {
        configDir: '/cfg',
        readFile: async () => null
      })
    ).toBeNull()
  })

  it('reads nothing from a file it cannot parse', async () => {
    expect(
      await readClaudeBackgroundAgentJobState('4f5d4302', {
        configDir: '/cfg',
        readFile: async () => 'not json'
      })
    ).toBeNull()
  })

  it('copes with a state file that has no fields', async () => {
    expect(
      await readClaudeBackgroundAgentJobState('4f5d4302', {
        configDir: '/cfg',
        readFile: async () => '{}'
      })
    ).toEqual({ detail: null, needs: null, updatedAt: null })
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/claude/background-agents/claude-background-agent-job-state.test.ts --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/main/claude/background-agents/claude-background-agent-job-state.ts`：

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClaudeBackgroundAgentDetail } from '../../../shared/claude-background-agents'
import { defaultClaudeConfigDir } from '../claude-config-dir-pin'

/**
 * The agent's own state file; the CLI's listing does not carry it.
 *
 * A missing or unparsable file is normal — the panel then shows the row without its
 * activity line rather than losing the row.
 */
export async function readClaudeBackgroundAgentJobState(
  agentId: string,
  options: ClaudeBackgroundAgentJobStateOptions = {}
): Promise<ClaudeBackgroundAgentDetail | null> {
  const configDir = options.configDir ?? defaultClaudeConfigDir()
  const read = options.readFile ?? readTextFile
  const raw = await read(join(configDir, 'jobs', agentId, 'state.json'))
  if (raw === null) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const state = parsed as Record<string, unknown>
  return {
    detail: typeof state.detail === 'string' ? state.detail : null,
    needs: typeof state.needs === 'string' ? state.needs : null,
    updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : null
  }
}
```

`readTextFile` 是本文件里的一个私有 helper：`readFile(path, 'utf8')` 成功返回字符串、`ENOENT`/其它错误返回 `null`。

**注意**：`defaultClaudeConfigDir()` 认 `CLAUDE_CONFIG_DIR`。测试通过 `configDir` 注入，不碰真实 home。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/claude/background-agents --maxWorkers=2`
Expected: PASS（4 个新用例 + Task 1 留下的）。

- [ ] **Step 5: 提交**

```bash
git add src/main/claude/background-agents/claude-background-agent-job-state.ts src/main/claude/background-agents/claude-background-agent-job-state.test.ts
git commit -m "feat(claude-agents): read the agent's own activity line

The CLI's listing says which agents live; the job state file says what
each one is doing right now, and that is the line the panel shows."
```

---

### Task 3: main 侧的派发 / 停止 / 删除命令

**Files:**

- Create: `src/main/claude/background-agents/claude-background-agent-commands.ts`
- Create: `src/main/claude/background-agents/claude-background-agent-commands.test.ts`

**Interfaces:**

- Consumes: `ClaudeBackgroundAgentCommandResult`（Task 1 定义在 `src/shared/`）
- Produces:

  ```ts
  export type ClaudeBackgroundAgentCommandDependencies = {
    /** Injected so the tests exercise the parsing without a Claude Code install. */
    runCommand?: typeof runProcess
    resolveCommand?: typeof resolveCommandOnLocalPath
    resolveEnvironment?: () => Promise<NodeJS.ProcessEnv>
  }

  export async function dispatchClaudeBackgroundAgent(
    args: {
      prompt: string
      cwd?: string | null
      model?: string | null
      permissionMode?: string | null
    },
    dependencies?: ClaudeBackgroundAgentCommandDependencies
  ): Promise<ClaudeBackgroundAgentCommandResult>

  export async function stopClaudeBackgroundAgent(
    args: { id: string },
    dependencies?: ClaudeBackgroundAgentCommandDependencies
  ): Promise<ClaudeBackgroundAgentCommandResult>

  export async function removeClaudeBackgroundAgent(
    args: { id: string },
    dependencies?: ClaudeBackgroundAgentCommandDependencies
  ): Promise<ClaudeBackgroundAgentCommandResult>
  ```

  `dispatch` 成功时 `id` 是新 agent 的短 id；`stop` / `remove` 成功时 `id` 是被操作的 agent 的 id。

**实测过的 CLI 输出（不要改这些格式）：**

| 命令                     | stdout                        | 失败                                         |
| ------------------------ | ----------------------------- | -------------------------------------------- |
| `claude --bg "<prompt>"` | `backgrounded · <8-hex>` 开头 | 非零退出                                     |
| `claude stop <id>`       | `stopped <id>`                | 非零退出，stderr 有原因                      |
| `claude rm <id>`         | `removed <id>`                | 非零退出，stderr 是 `No job matching '<id>'` |

- [ ] **Step 1: 写失败的测试**

`src/main/claude/background-agents/claude-background-agent-commands.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  dispatchClaudeBackgroundAgent,
  removeClaudeBackgroundAgent,
  stopClaudeBackgroundAgent
} from './claude-background-agent-commands'

const deps = (stdout: string, code = 0, stderr = '') => ({
  runCommand: async () => ({ code, signal: null, stdout, stderr, timedOut: false }),
  resolveCommand: async () => '/usr/local/bin/claude',
  resolveEnvironment: async () => ({})
})

describe('dispatchClaudeBackgroundAgent', () => {
  it('reads the new agent id out of the CLI output', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'do the thing' },
      deps('backgrounded · 4db4f587\n  claude agents  list sessions\n')
    )
    expect(result).toEqual({ ok: true, id: '4db4f587' })
  })

  it('passes the model and the permission mode', async () => {
    const seen: { args?: readonly string[] } = {}
    await dispatchClaudeBackgroundAgent(
      { prompt: 'x', model: 'opus', permissionMode: 'plan' },
      {
        ...deps('backgrounded · 4db4f587\n'),
        runCommand: async (spec) => {
          seen.args = spec.args
          return {
            code: 0,
            signal: null,
            stdout: 'backgrounded · 4db4f587\n',
            stderr: '',
            timedOut: false
          }
        }
      }
    )
    expect(seen.args).toEqual(['--bg', '--model', 'opus', '--permission-mode', 'plan', 'x'])
  })

  it('reports why the CLI refused', async () => {
    const result = await dispatchClaudeBackgroundAgent(
      { prompt: 'x' },
      deps('', 1, 'not logged in')
    )
    expect(result).toEqual({ ok: false, message: 'not logged in' })
  })
})

describe('the id guard', () => {
  it('refuses a name where an id belongs', async () => {
    // Two agents can share a name; `claude attach` accepts a partial name and would pick the wrong one.
    expect(await stopClaudeBackgroundAgent({ id: 'init orca' }, deps('stopped x'))).toEqual({
      ok: false,
      message: 'not a background agent id'
    })
    expect(await removeClaudeBackgroundAgent({ id: 'init orca' }, deps('removed x'))).toEqual({
      ok: false,
      message: 'not a background agent id'
    })
  })

  it('accepts the short id the CLI prints', async () => {
    expect(await stopClaudeBackgroundAgent({ id: '4db4f587' }, deps('stopped 4db4f587\n'))).toEqual(
      {
        ok: true,
        id: '4db4f587'
      }
    )
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/claude/background-agents/claude-background-agent-commands.test.ts --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/main/claude/background-agents/claude-background-agent-commands.ts`：

```ts
import { runProcess } from '@orca/process-host'
import { CLAUDE_BACKGROUND_AGENT_ID_PATTERN } from '../../../shared/claude-background-agents'
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'
```

**用共享层那个正则，不要自己再定义一份。** Task 2 已经把 `CLAUDE_BACKGROUND_AGENT_ID_PATTERN` 放进 `src/shared/claude-background-agents.ts`（Task 2 的路径守卫与这里的命令守卫共用同一份定义）。

三个命令共用一个内部 helper：解析 `claude` 的可执行文件 → 跑 `runProcess` → 看退出码。

- `dispatchClaudeBackgroundAgent`：
  - `args` 组装成 `['--bg', ...(model ? ['--model', model] : []), ...(permissionMode ? ['--permission-mode', permissionMode] : []), prompt]`。
  - `cwd` 传给 `runProcess`（`claude --bg` 没有 `--cwd`，工作目录来自进程）。
  - stdout 用 `/^backgrounded\s*·\s*([0-9a-f]{8})/m` 取 id。**取不到 id 就是失败**，不是成功。
  - 失败时 `message` 用 stderr；stderr 为空时用 `'the CLI did not report why'`。
- `stopClaudeBackgroundAgent` / `removeClaudeBackgroundAgent`：
  - **先**校验 `id` 匹配共享的 `CLAUDE_BACKGROUND_AGENT_ID_PATTERN`，不匹配直接返回 `{ ok: false, message: 'not a background agent id' }`，**不跑任何命令**。
  - 命令分别是 `['stop', id]` 与 `['rm', id]`。
  - 成功返回 `{ ok: true, id }`。

三个命令都用 `resolveCommandOnLocalPath('claude', { platform: process.platform, env })` 找可执行文件；找不到返回 `{ ok: false, message: 'Claude Code CLI not found' }`。

超时给 `CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS`（已存在，5s）；派发要更久（agent 起来要时间），给派发单独用 **30s**。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/claude/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/claude/background-agents/claude-background-agent-commands.ts src/main/claude/background-agents/claude-background-agent-commands.test.ts
git commit -m "feat(claude-agents): dispatch, stop and remove background agents

The CLI accepts a name where an id belongs, and two agents can share a
name, so the panel only ever passes the short id."
```

---

### Task 4: IPC 通道

**Files:**

- Create: `src/main/ipc/claude-agents/claude-agents.ts`
- Create: `src/preload/api/claude-agents-api.ts`
- Create: `src/preload/api/claude-agents-bridge.ts`
- Create: `src/renderer/src/web/preload-api/web-claude-agents-api.ts`
- Modify: `src/main/ipc/register-core-handlers/register-core-handlers.ts`
- Modify: `src/preload/api-types.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/web/web-preload-api.ts`

**Interfaces:**

- Consumes: `listClaudeBackgroundAgents`（已存在于 `src/main/claude/background-agents/claude-background-agent-list.ts`）、`readClaudeBackgroundAgentJobState`（Task 2）、三个命令（Task 3）、`ClaudeBackgroundAgentListResult` 与 `ClaudeBackgroundAgentCommandResult`（Task 1）
- Produces:
  ```ts
  // src/preload/api/claude-agents-api.ts
  export type ClaudeAgentsApi = {
    list: () => Promise<ClaudeBackgroundAgentListResult>
    readDetails: (ids: string[]) => Promise<Record<string, ClaudeBackgroundAgentDetail>>
    dispatch: (args: {
      prompt: string
      cwd?: string | null
      model?: string | null
      permissionMode?: string | null
    }) => Promise<ClaudeBackgroundAgentCommandResult>
    stop: (args: { id: string }) => Promise<ClaudeBackgroundAgentCommandResult>
    remove: (args: { id: string }) => Promise<ClaudeBackgroundAgentCommandResult>
  }
  ```
  `window.api.claudeAgents.*`

**IPC 通道名：** `claudeAgents:list`、`claudeAgents:readDetails`、`claudeAgents:dispatch`、`claudeAgents:stop`、`claudeAgents:remove`。

**为什么 `list` 和 `readDetails` 分开：** `list` 要跑 1.2s 的 CLI；`readDetails` 只读 10ms 的文件。面板的 2s 快轮询只调 `readDetails`，15s 慢轮询才调 `list`。

- [ ] **Step 1: 写失败的测试**

新建 `src/main/ipc/claude-agents/claude-agents.test.ts`。它测「把两个来源合成一个结果」这件事，不测 Electron：

```ts
import { describe, expect, it } from 'vitest'
import { buildClaudeBackgroundAgentListResult } from './claude-agents'

describe('buildClaudeBackgroundAgentListResult', () => {
  it('pairs each agent with its own detail', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => [{ id: '4db4f587', sessionId: 's', name: 'a', cwd: '/w' }],
      async (id) => ({ detail: `working on ${id}`, needs: null, updatedAt: 1 })
    )
    expect(result.status).toBe('ready')
    expect(Object.keys(result.details)).toEqual(['4db4f587'])
    expect(result.details['4db4f587'].detail).toBe('working on 4db4f587')
  })

  it('says so when this machine has no Claude Code CLI', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => null,
      async () => ({ detail: null, needs: null, updatedAt: null })
    )
    expect(result.status).toBe('unsupported')
  })

  it('keeps the agents whose detail file cannot be read', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => [{ id: '4db4f587', sessionId: 's', name: 'a', cwd: '/w' }],
      async () => null
    )
    expect(result.status).toBe('ready')
    expect(result.agents).toHaveLength(1)
    expect(result.details['4db4f587']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/ipc/claude-agents --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 main 侧**

`src/main/ipc/claude-agents/claude-agents.ts`：

```ts
export type ClaudeBackgroundAgentListResult = { ... }   // 放 src/shared/，见上

export async function buildClaudeBackgroundAgentListResult(
  listAgents: () => Promise<ClaudeBackgroundAgent[] | null>,
  readDetail: (id: string) => Promise<ClaudeBackgroundAgentDetail | null>
): Promise<ClaudeBackgroundAgentListResult>
```

- `listAgents` 返回 `null` 表示「这台机器没有 Claude Code CLI」→ `status: 'unsupported'`。
- 每个 agent 的 detail 用 `readDetail(id)` 取；取不到就不放进 `details`（**不**放一个全 null 的占位）。
- 抛异常 → `status: 'error'`，`message` 是异常信息，`agents` 为空。

`registerClaudeAgentsHandlers()` 里注册 5 个 `ipcMain.handle`：

- `claudeAgents:list` → `buildClaudeBackgroundAgentListResult(() => listClaudeBackgroundAgents(), (id) => readClaudeBackgroundAgentJobState(id))`
- `claudeAgents:readDetails` → 对 `ids` 逐个读 detail，返回一个 map（读不到就不放）
- `claudeAgents:dispatch` / `claudeAgents:stop` / `claudeAgents:remove` → 直接转调 Task 3 的三个命令

在 `src/main/ipc/register-core-handlers/register-core-handlers.ts` 里加：

```ts
import { registerClaudeAgentsHandlers } from '../claude-agents/claude-agents'
```

并在 `registerAiVaultHandlers({...})` 那一段之后调用 `registerClaudeAgentsHandlers()`。

- [ ] **Step 4: 实现 preload**

`src/preload/api/claude-agents-api.ts` —— 照 `src/preload/api/ai-vault-api.ts` 的形态声明 `ClaudeAgentsApi`。

`src/preload/api/claude-agents-bridge.ts` —— 照 `src/preload/api/ai-vault-bridge.ts`，**结尾要 `satisfies PreloadApi['claudeAgents']`**（编译期保证与类型一致）：

```ts
export const claudeAgentsApi = {
  list: () => ipcRenderer.invoke('claudeAgents:list'),
  readDetails: (ids) => ipcRenderer.invoke('claudeAgents:readDetails', ids),
  dispatch: (args) => ipcRenderer.invoke('claudeAgents:dispatch', args),
  stop: (args) => ipcRenderer.invoke('claudeAgents:stop', args),
  remove: (args) => ipcRenderer.invoke('claudeAgents:remove', args)
} satisfies PreloadApi['claudeAgents']
```

**三处必须一起改，漏一处 `window.api.claudeAgents` 就是 undefined：**

1. `src/preload/api-types.ts`：加 import，在 `PreloadApi` 里加 `claudeAgents: ClaudeAgentsApi`。
2. `src/preload/index.ts`：加 `import { claudeAgentsApi } from './api/claude-agents-bridge'`，并在那个 `} satisfies PreloadApi` 的对象里加 `claudeAgents: claudeAgentsApi,`。
3. `src/renderer/src/web/web-preload-api.ts` + 新建 `src/renderer/src/web/preload-api/web-claude-agents-api.ts`：web 端不需要真的实现，但**要有 stub**，否则 web 客户端每次调用都刷 `[web] window.api.claudeAgents.list has no web implementation` 警告。照 `src/renderer/src/web/preload-api/web-ai-vault-api.ts` 的形态导出 `createWebClaudeAgentsApi()`，让 `list` 返回空名单、`readDetails` 返回空 map、三个命令返回 `{ ok: false, message: 'not available on the web' }`。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/main/ipc/claude-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查**

Run: `pnpm tc:node && pnpm tc:web`
Expected: 两个都通过（preload 的类型是 CI 强制的）。

- [ ] **Step 7: 提交**

```bash
git add src/main/ipc/claude-agents src/preload/api/claude-agents-api.ts src/preload/api/claude-agents-bridge.ts src/preload/api-types.ts src/preload/index.ts src/renderer/src/web/preload-api/web-claude-agents-api.ts src/renderer/src/web/web-preload-api.ts src/main/ipc/register-core-handlers/register-core-handlers.ts
git commit -m "feat(claude-agents): expose the background agent listing over IPC

The listing and the per-agent activity live behind separate calls: the
CLI takes 1.2s, the job state file takes 10ms, and the panel needs both
at different rates."
```

---

### Task 5: renderer 的纯函数（合并、分段、计数、过滤、elapsed）

**Files:**

- Create: `src/renderer/src/components/background-agents/background-agent-list-rows.ts`
- Create: `src/renderer/src/components/background-agents/background-agent-list-rows.test.ts`

**Interfaces:**

- Consumes: `ClaudeBackgroundAgent` / `ClaudeBackgroundAgentDetail`（Task 1）
- Produces:

  ```ts
  export type BackgroundAgentListRow = {
    id: string
    name: string
    cwd: string
    /** The section the row belongs to. */
    section: 'working' | 'needs-input' | 'completed'
    /** The CLI's own state word. */
    state: ClaudeBackgroundAgentState
    /** The gray line under the agent's name. */
    detail: string | null
    /** The agent's question, when it waits for a decision. */
    needs: string | null
    /** Epoch ms the agent started. */
    startedAt: number
    /** Epoch ms of the last state change; null when unknown. */
    updatedAt: number | null
  }

  export type BackgroundAgentListGroups = {
    working: BackgroundAgentListRow[]
    needsInput: BackgroundAgentListRow[]
    completed: BackgroundAgentListRow[]
  }

  export function buildBackgroundAgentListRows(
    agents: readonly ClaudeBackgroundAgent[],
    details: Readonly<Record<string, ClaudeBackgroundAgentDetail>>
  ): BackgroundAgentListRow[]

  export function groupBackgroundAgentListRows(
    rows: readonly BackgroundAgentListRow[]
  ): BackgroundAgentListGroups

  export function filterBackgroundAgentListRows(
    rows: readonly BackgroundAgentListRow[],
    query: string
  ): BackgroundAgentListRow[]

  export function countBackgroundAgentListRows(rows: readonly BackgroundAgentListRow[]): {
    awaitingInput: number
    working: number
    completed: number
  }

  export function formatBackgroundAgentElapsed(elapsedMs: number): string
  ```

- [ ] **Step 1: 写失败的测试**

`src/renderer/src/components/background-agents/background-agent-list-rows.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  buildBackgroundAgentListRows,
  countBackgroundAgentListRows,
  filterBackgroundAgentListRows,
  formatBackgroundAgentElapsed,
  groupBackgroundAgentListRows
} from './background-agent-list-rows'

describe('buildBackgroundAgentListRows', () => {
  it('puts a blocked agent in the section that needs a decision', () => {
    const rows = buildBackgroundAgentListRows(
      [
        {
          id: 'aaaa1111',
          sessionId: 's',
          name: 'waiting',
          cwd: '/w',
          state: 'blocked',
          status: 'waiting'
        },
        {
          id: 'bbbb2222',
          sessionId: 's',
          name: 'busy',
          cwd: '/w',
          state: 'working',
          status: 'busy'
        },
        { id: 'cccc3333', sessionId: 's', name: 'done', cwd: '/w', state: 'done' }
      ],
      {
        aaaa1111: { detail: 'answer: 选 A 还是 B？', needs: 'answer: 选 A 还是 B？', updatedAt: 5 }
      }
    )
    expect(rows.map((row) => row.section)).toEqual(['needs-input', 'working', 'completed'])
  })

  it('leaves out a session that is not a background agent', () => {
    const rows = buildBackgroundAgentListRows(
      [
        { id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', kind: 'background' },
        { id: 'bbbb2222', sessionId: 's', name: 'fg', cwd: '/w', kind: 'interactive' }
      ],
      {}
    )
    expect(rows.map((row) => row.id)).toEqual(['aaaa1111'])
  })

  it('takes the agent name from the listing, not from the detail file', () => {
    // The agent renames itself while it works; the row title must follow the listing.
    const rows = buildBackgroundAgentListRows(
      [{ id: 'aaaa1111', sessionId: 's', name: 'bash sleep command', cwd: '/w', state: 'working' }],
      { aaaa1111: { detail: 'Waiting 20 seconds', needs: null, updatedAt: 5 } }
    )
    expect(rows[0].name).toBe('bash sleep command')
    expect(rows[0].detail).toBe('Waiting 20 seconds')
  })

  it('keeps a row whose activity file cannot be read', () => {
    const rows = buildBackgroundAgentListRows(
      [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
      {}
    )
    expect(rows[0].detail).toBeNull()
  })

  it('treats a missing state as finished rather than as working', () => {
    const rows = buildBackgroundAgentListRows(
      [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w' }],
      {}
    )
    expect(rows[0].section).toBe('completed')
  })
})

describe('groupBackgroundAgentListRows', () => {
  it('keeps each section in its own list', () => {
    const groups = groupBackgroundAgentListRows([
      {
        id: 'a',
        name: 'a',
        cwd: '/w',
        section: 'working',
        state: 'working',
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'b',
        name: 'b',
        cwd: '/w',
        section: 'needs-input',
        state: 'blocked',
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'c',
        name: 'c',
        cwd: '/w',
        section: 'completed',
        state: 'done',
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      }
    ])
    expect(groups.working.map((r) => r.id)).toEqual(['a'])
    expect(groups.needsInput.map((r) => r.id)).toEqual(['b'])
    expect(groups.completed.map((r) => r.id)).toEqual(['c'])
  })
})

describe('filterBackgroundAgentListRows', () => {
  const rows = [
    {
      id: 'a',
      name: 'fix the parser',
      cwd: '/repos/app',
      section: 'working' as const,
      state: 'working' as const,
      detail: 'reading the file',
      needs: null,
      startedAt: 0,
      updatedAt: null
    },
    {
      id: 'b',
      name: 'other work',
      cwd: '/repos/other',
      section: 'working' as const,
      state: 'working' as const,
      detail: null,
      needs: null,
      startedAt: 0,
      updatedAt: null
    }
  ]
  it('matches the name, the activity line and the directory', () => {
    expect(filterBackgroundAgentListRows(rows, 'parser').map((r) => r.id)).toEqual(['a'])
    expect(filterBackgroundAgentListRows(rows, 'reading').map((r) => r.id)).toEqual(['a'])
    expect(filterBackgroundAgentListRows(rows, 'other').map((r) => r.id)).toEqual(['b'])
  })
  it('keeps everything for an empty query', () => {
    expect(filterBackgroundAgentListRows(rows, '  ')).toHaveLength(2)
  })
})

describe('formatBackgroundAgentElapsed', () => {
  it('reads like the list the CLI draws', () => {
    expect(formatBackgroundAgentElapsed(10_000)).toBe('10s')
    expect(formatBackgroundAgentElapsed(4 * 60_000)).toBe('4m')
    expect(formatBackgroundAgentElapsed(47 * 60_000)).toBe('47m')
    expect(formatBackgroundAgentElapsed(60 * 60_000)).toBe('1h')
    expect(formatBackgroundAgentElapsed(17 * 60 * 60_000)).toBe('17h')
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/background-agents/background-agent-list-rows.test.ts --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/renderer/src/components/background-agents/background-agent-list-rows.ts`：

- `buildBackgroundAgentListRows`：
  - 滤掉 `kind === 'interactive'` 的条目（`kind` 缺失的当 background，因为没有 id 的 interactive 本来就被 CLI 的解析器丢了）。
  - `section`：`state === 'blocked'` → `'needs-input'`；`state === 'working'` → `'working'`；其余（含 `state` 缺失）→ `'completed'`。
  - `detail` / `needs` / `updatedAt` 从 `details[id]` 取，缺失就是 `null`。
  - `startedAt` 从 listing 取，缺失用 `0`。
  - 排序：先按 section（working → needs-input → completed），同段内按 `startedAt` 降序（新的在前）。
- `groupBackgroundAgentListRows`：按 `section` 分三组，保持传入顺序。
- `countBackgroundAgentListRows`：`awaitingInput` = needs-input 的条数，`working` = working 的条数，`completed` = completed 的条数。
- `filterBackgroundAgentListRows`：query 去空格后转小写，对 `name` / `detail` / `cwd` 做 `includes`；空 query 原样返回。
- `formatBackgroundAgentElapsed`：`< 60_000` → `${Math.floor(ms/1000)}s`；`< 3_600_000` → `${Math.floor(ms/60_000)}m`；`< 86_400_000` → `${Math.floor(ms/3_600_000)}h`；否则 `${Math.floor(ms/86_400_000)}d`。负数当 0。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/components/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/background-agents/background-agent-list-rows.ts src/renderer/src/components/background-agents/background-agent-list-rows.test.ts
git commit -m "feat(background-agents): merge the two sources into rows

The CLI says which agents live; the job state file says what each is
doing. A blocked agent lands in the section that needs a decision, so
it is not buried under the working ones."
```

---

### Task 6: renderer 的 store slice

**Files:**

- Create: `src/renderer/src/store/slices/background-agents/create-background-agents-slice.ts`
- Modify: `src/renderer/src/store/index.ts`
- Modify: `src/renderer/src/store/types.ts`
- Modify: `src/renderer/src/store/testing/app-store-test-fixture.ts`

**Interfaces:**

- Consumes: `ClaudeBackgroundAgent` / `ClaudeBackgroundAgentDetail` / `ClaudeBackgroundAgentListResult`（Task 1 / Task 4）
- Produces:
  ```ts
  export type BackgroundAgentsScreen = { kind: 'list' } | { kind: 'agent'; agentId: string }

  export type BackgroundAgentsSlice = {
    backgroundAgentsScreen: BackgroundAgentsScreen
    backgroundAgentsStatus: 'loading' | 'ready' | 'unsupported' | 'error'
    backgroundAgentsMessage: string | null
    backgroundAgentsAgents: ClaudeBackgroundAgent[]
    backgroundAgentsDetails: Record<string, ClaudeBackgroundAgentDetail>
    backgroundAgentsAttachedPtyId: string | null
    openBackgroundAgent: (agentId: string) => void
    closeBackgroundAgent: () => void
    publishBackgroundAgentsListing: (result: ClaudeBackgroundAgentListResult) => void
    publishBackgroundAgentDetails: (details: Record<string, ClaudeBackgroundAgentDetail>) => void
    setBackgroundAgentsAttachedPty: (ptyId: string | null) => void
  }
  ```

**这个 slice 不持久化。** 它只进 `AppState`，不进 `persisted-ui-write-baseline.ts` 的白名单——那些 key 会被写进磁盘，我们这个是运行时状态。

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/store/slices/background-agents/create-background-agents-slice.test.ts`，用 `createTestStore()`（`src/renderer/src/store/testing/app-store-test-fixture.ts`）：

```ts
it('keeps the previous agents while a slow refresh runs', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  // A refresh that fails must not empty the list.
  store.getState().publishBackgroundAgentsListing({
    status: 'error',
    agents: [],
    details: {},
    message: 'the CLI timed out'
  })
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
  expect(store.getState().backgroundAgentsStatus).toBe('error')
  expect(store.getState().backgroundAgentsMessage).toBe('the CLI timed out')
})

it('replaces the details without touching the agents', () => {
  const store = createTestStore()
  store.getState().publishBackgroundAgentsListing({
    status: 'ready',
    agents: [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
    details: {},
    message: null
  })
  store.getState().publishBackgroundAgentDetails({
    aaaa1111: { detail: 'now doing X', needs: null, updatedAt: 7 }
  })
  expect(store.getState().backgroundAgentsDetails.aaaa1111.detail).toBe('now doing X')
  expect(store.getState().backgroundAgentsAgents).toHaveLength(1)
})

it('opens and closes an agent', () => {
  const store = createTestStore()
  store.getState().openBackgroundAgent('aaaa1111')
  expect(store.getState().backgroundAgentsScreen).toEqual({ kind: 'agent', agentId: 'aaaa1111' })
  store.getState().closeBackgroundAgent()
  expect(store.getState().backgroundAgentsScreen).toEqual({ kind: 'list' })
})
```

**注意**：第一个用例是 Review Focus 第 5 条（慢刷新期间列表闪空）。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/store/slices/background-agents --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 slice**

照 `src/renderer/src/store/slices/ai-instructions/create-ai-instructions-slice.ts` 的形态：

```ts
export const createBackgroundAgentsSlice: StateCreator<AppState, [], [], BackgroundAgentsSlice> = (
  set
) => ({
  backgroundAgentsScreen: { kind: 'list' },
  backgroundAgentsStatus: 'loading',
  backgroundAgentsMessage: null,
  backgroundAgentsAgents: [],
  backgroundAgentsDetails: {},
  backgroundAgentsAttachedPtyId: null,
  openBackgroundAgent: (agentId) => set({ backgroundAgentsScreen: { kind: 'agent', agentId } }),
  closeBackgroundAgent: () => set({ backgroundAgentsScreen: { kind: 'list' } }),
  publishBackgroundAgentsListing: (result) =>
    set((state) => ({
      backgroundAgentsStatus: result.status,
      backgroundAgentsMessage: result.message,
      // Why a copy: the caller may reuse the array.
      backgroundAgentsDetails: { ...result.details },
      // A failed refresh keeps the rows it already had; only a host with no CLI at all empties them.
      ...(result.status === 'unsupported'
        ? { backgroundAgentsAgents: [] }
        : result.status === 'ready'
          ? { backgroundAgentsAgents: [...result.agents] }
          : {})
    })),
  publishBackgroundAgentDetails: (details) =>
    set((state) => ({ backgroundAgentsDetails: { ...state.backgroundAgentsDetails, ...details } })),
  setBackgroundAgentsAttachedPty: (ptyId) => set({ backgroundAgentsAttachedPtyId: ptyId })
})
```

**`publishBackgroundAgentsListing` 的关键**：`status === 'error'` 时**不清空** `backgroundAgentsAgents`（Review Focus 第 5 条）。`'unsupported'` 时清空（这台机器确实没有 agent）。

- [ ] **Step 4: 挂进 store**

**三处都要改，漏了测试 fixture 就跑不起来：**

- `src/renderer/src/store/types.ts`：加 `import type { BackgroundAgentsSlice } from './slices/background-agents/create-background-agents-slice'`，并在 `AppState` 的交叉类型里加 `BackgroundAgentsSlice &`。
- `src/renderer/src/store/index.ts`：加 import，并在 `create(...)` 的展开列表里加 `...createBackgroundAgentsSlice(...a),`。
- `src/renderer/src/store/testing/app-store-test-fixture.ts`：**同样**加 import 和 `...createBackgroundAgentsSlice(...a),`。`createTestStore()` 自己拼了一遍 slice —— 不加这一行，`AppState` 的类型要求这个 slice 存在，但运行时它不存在，本任务的测试直接炸。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/store/slices/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查**

Run: `pnpm tc:web`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/store/slices/background-agents src/renderer/src/store/index.ts src/renderer/src/store/types.ts src/renderer/src/store/testing/app-store-test-fixture.ts
git commit -m "feat(background-agents): keep the supervisor state in the store

A slow refresh must not empty the list, and the screen has to survive
the panel unmounting when the user switches sidebar tabs."
```

---

### Task 06.5: 派发取消通道

**为什么插这一节：** spec §6.1 要求派发时在列表顶部插一行 `opening… · esc to cancel` 的占位行，`Esc` 要**真的能取消**。原来的 Task 7 只有「派发」没有「取消」—— 计划漏了 spec 的一处。取消要在 main 侧中止 `claude --bg` 那个子进程，所以这条通道得先建好，Task 7 的占位行才有东西可调。

**编号写成 `06.5`（带前导零）是刻意的**：brief 抽取脚本按 `Task <数字>` 切分，`Task 6.5` 会被它当成 `Task 6` 的一部分；`06.5` 不会。执行顺序是 6 → 06.5 → 7。

**Files:**

- Modify: `src/main/claude/background-agents/claude-background-agent-commands.ts`
- Modify: `src/main/claude/background-agents/claude-background-agent-commands.test.ts`
- Modify: `src/main/ipc/claude-agents/claude-agents.ts`
- Modify: `src/main/ipc/claude-agents/claude-agents.test.ts`
- Modify: `src/preload/api/claude-agents-api.ts`
- Modify: `src/preload/api/claude-agents-bridge.ts`
- Modify: `src/renderer/src/web/preload-api/web-claude-agents-api.ts`

**Interfaces:**

- Consumes: Task 3 的 `dispatchClaudeBackgroundAgent(args, dependencies)`；Task 4 的 `claudeAgents:dispatch` 通道
- Produces:

  ```ts
  // src/preload/api/claude-agents-api.ts
  cancelDispatch: () => Promise<void>

  // src/main/ipc/claude-agents/claude-agents.ts
  export type ClaudeAgentsHandlerDependencies = {
    dispatch?: typeof dispatchClaudeBackgroundAgent
    stop?: typeof stopClaudeBackgroundAgent
    remove?: typeof removeClaudeBackgroundAgent
  }
  export function registerClaudeAgentsHandlers(dependencies?: ClaudeAgentsHandlerDependencies): void
  ```

- [ ] **Step 1: 写失败的测试**

`src/main/claude/background-agents/claude-background-agent-commands.test.ts` 加两个用例：

```ts
it('hands the abort signal to the CLI', ...)
it('says the dispatch was cancelled when the process was killed', ...)
```

- 第一个：注入的 `runCommand` 把 `spec` 存下来，断言 `spec.signal` **就是**传进来的那个 `AbortSignal`（不是另一个）。
- 第二个：注入的 `runCommand` 回 `{ code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: false }`，断言结果是 `{ ok: false, message: 'the dispatch was cancelled' }`。**不是** stderr 的原文 —— 被取消不是 CLI 的错，不该把 CLI 的话当成失败原因。

`src/main/ipc/claude-agents/claude-agents.test.ts` 加两个用例：

```ts
it('aborts the dispatch that is still opening', ...)
it('does nothing when no dispatch is opening', ...)
```

- 第一个：用可注入的 `dispatch`（一个把 `dependencies.signal` 存下来的假实现）跑 `claudeAgents:dispatch`，然后调 `claudeAgents:cancelDispatch`，断言那个 signal 已经 `aborted`。
- 第二个：直接调 `claudeAgents:cancelDispatch`，断言它 resolve（不抛）。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/ipc/claude-agents src/main/claude/background-agents --maxWorkers=2`
Expected: FAIL —— `cancelDispatch` 通道不存在，`signal` 没往下传。

- [ ] **Step 3: 实现**

**命令层** (`claude-background-agent-commands.ts`)：

- `ClaudeBackgroundAgentCommandDependencies` 加 `signal?: AbortSignal`。
- `runClaudeCommand` 的 `options` 加 `signal?: AbortSignal`，传给 `runProcess` 的 spec —— `ProcessSpec.signal` 已经有了（`src/packages/process-host/src/process-spec.ts:30`），语义是「中止后仍然 resolve 出进程结果」。
- `failureMessage` 的分支**顺序**（先看是不是我们自己中止的）：
  - `signal?.aborted` → `'the dispatch was cancelled'`（是我们按 Esc 中止的）。
  - `result.timedOut` → `'the CLI timed out'`（**超时不是取消**）。
  - `result.signal !== null`（被别的信号杀掉）→ `'the CLI was stopped before it finished'`。
  - 其余 → 走共享截断 helper。

  **为什么不能只看 `result.signal !== null`**：超时的时候进程也是被信号杀死的 —— `runProcess` 的超时路径会 kill 子进程，退出事件带 `signal: 'SIGTERM'`（`src/packages/process-host/src/run-process.ts:236-239`）。所以 `claude rm` 超时 30s 会被说成「派发被取消」：**既说错了原因，又用错了词** —— stop/rm 不是派发。

**IPC 层** (`claude-agents.ts`)：

- `registerClaudeAgentsHandlers` 接受一个可选的 `ClaudeAgentsHandlerDependencies`，三个命令从它取（默认就是现在直接调的那三个函数）。**这是为了让 IPC 层可测** —— 现在它直接 import 命令函数，测试换不掉它们。
- 用 `registerClaudeAgentsHandlers` 内部的一个闭包变量 `let inFlightDispatch: AbortController | null = null` 持有在飞的派发。**不要用模块级变量** —— 模块级状态跨注册实例共享，测试之间会互相污染。
- `claudeAgents:dispatch` handler：建一个 `AbortController`，挂到 `inFlightDispatch`，用它调 `dispatch`（`{ signal: controller.signal }`），`finally` 里清掉。
- 新 handler `claudeAgents:cancelDispatch`：`inFlightDispatch?.abort()` 然后 resolve。**没有 in-flight 时是 no-op，不抛。**
- **同一时刻只有一个派发在飞**：面板的 composer 在派发期间不接受新的派发（Task 7 负责拦），所以 main 侧只需要记住一个 controller。**不要**做成 Map —— 没有第二个派发要记。

**preload**：

- `claude-agents-api.ts` 加 `cancelDispatch: () => Promise<void>`。
- `claude-agents-bridge.ts` 实现它（`ipcRenderer.invoke('claudeAgents:cancelDispatch')`）。

**web stub**：

- `cancelDispatch: () => Promise.resolve()` —— 浏览器里没有派发在飞，没有可取消的。**它不返回任何文案，所以不涉及本地化。**

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/ipc/claude-agents src/main/claude/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm tc:node && pnpm tc:web && pnpm exec oxlint src/main/ipc/claude-agents src/main/claude/background-agents src/preload`
Expected: 都通过。

- [ ] **Step 6: 提交**

```bash
git add src/main/ipc/claude-agents src/main/claude/background-agents src/preload src/renderer/src/web/preload-api/web-claude-agents-api.ts
git commit -m "feat(claude-agents): let the panel cancel a dispatch that is still opening"
```

---

### Task 7: 屏 1（列表）

**Files:**

- Create: `src/renderer/src/components/background-agents/BackgroundAgentListScreen.tsx`
- Modify: `src/renderer/src/components/background-agents/BackgroundAgentRow.tsx`（重写）
- Create: `src/renderer/src/components/background-agents/BackgroundAgentListScreen.test.tsx`
- Create: `src/renderer/src/components/background-agents/use-background-agent-roster-refresh.ts`（慢层轮询的 hook，两屏共用）
- Modify: `src/renderer/src/store/slices/background-agents/create-background-agents-slice.ts`（加派发占位行的字段）
- Modify: `src/renderer/src/store/slices/background-agents/create-background-agents-slice.test.ts`（占位行状态的测试）

**Interfaces:**

- Consumes: Task 5 的纯函数、Task 6 的 slice、Task 4 的 `window.api.claudeAgents`、Task 06.5 的 `window.api.claudeAgents.cancelDispatch`
- Produces:

  ```ts
  // src/renderer/src/components/background-agents/BackgroundAgentRow.tsx
  export function BackgroundAgentRowView(props: {
    row: BackgroundAgentListRow
    selected: boolean
    onSelect: (row: BackgroundAgentListRow) => void
  }): React.JSX.Element

  // src/renderer/src/components/background-agents/use-background-agent-roster-refresh.ts
  /** Refreshes the roster (the slow layer). Both screens call it; only one is mounted at a time. */
  export function useBackgroundAgentRosterRefresh(): void
  ```

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/components/background-agents/BackgroundAgentListScreen.test.tsx`：

```tsx
it('moves the selection with the arrow keys', () => { ... })
it('enters the selected agent on Enter', () => { ... })
it('asks for the stop to be confirmed twice', () => { ... })
it('dispatches the composed prompt', () => { ... })
it('shows an opening row while the dispatch is on its way', () => { ... })
it('cancels the opening dispatch when Escape is pressed', () => { ... })
it('says so when the dispatch fails', () => { ... })
it('says the panel lists this machine when the workspace runs elsewhere', () => { ... })
```

每个用例用 `@testing-library/react` 渲染 `BackgroundAgentListScreen`，用 `fireEvent.keyDown(root, { key: 'ArrowDown' })` 驱动。

**脚手架照 `src/renderer/src/components/right-sidebar/ai-vault/accounts/ai-vault-session-account-render.test.tsx`**（组件测试的既有做法，不要另创一套）：

- 文件头 `// @vitest-environment happy-dom`。
- `vi.mock('@/i18n/i18n', async (importOriginal) => ({ ...(await importOriginal<typeof I18n>()), translate: (_key: string, fallback: string) => fallback }))` —— 文案走 fallback，断言里就能直接写英文。
- **喂名单**：`createTestStore()` **不接受初始状态**（它只接一个 `isClaudeAgent` 参数），组件测试的既有做法是直接喂全局 store：`useAppStore.setState({ backgroundAgentsAgents: [...], backgroundAgentsDetails: {...} })`，或者走 store 自己的动作 `useAppStore.getState().publishBackgroundAgentsListing({ status: 'ready', agents: [...], details: {...}, message: null })`。从 `src/renderer/src/components/background-agents/` 出发，store 的相对路径是 `../../store/index`。
- **stub API**：`window.api.claudeAgents = { ...window.api.claudeAgents, dispatch: vi.fn(async () => ({ ok: true, id: 'aaaa1111' })) }`。
- **每个用例之间把 store 复位** —— `useAppStore.setState` 改的是全局 store，不复位会串味。

断言要具体：

- ArrowDown 之后被选中的行的 `data-selected="true"` 落在第二行。
- Enter 之后 `store.getState().backgroundAgentsScreen` 是 `{ kind: 'agent', agentId: 'bbbb2222' }`。
- Ctrl+X 第一次之后，行内出现 `ctrl+x again to stop` 的文字，且 `window.api.claudeAgents.stop` **没有被调用**；第二次之后它被调用了一次，且参数是 `{ id: 'bbbb2222' }`。
- composer 里输入 `do the thing` 并 Enter 之后，`window.api.claudeAgents.dispatch` 被调用，参数含 `prompt: 'do the thing'`。
- 派发在飞时，列表**顶部**有一行写着 `opening… · esc to cancel`。
- 在那行上按 `Escape` 之后，`window.api.claudeAgents.cancelDispatch` 被调用了一次，**并且派发 promise 落定为「被取消」之后那一行消失**（按 Esc 的当下这一行**不消失** —— `cancelDispatch` 只是把中止信号送到，进程还没死）。
- 派发失败之后，那一行变成失败态（写着失败原因），并且 `toast.error` 被调用过一次。
- 活动 worktree 的 `executionHostId` 是 `ssh:...` 时，列表上方出现「这台机器」的说明，**而且名单照常显示**（不换成空列表）。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/background-agents/BackgroundAgentListScreen.test.tsx --maxWorkers=2`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现列表屏**

`BackgroundAgentListScreen.tsx` 的结构：

```
<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="background-agents-list">
  <header>  {counts}  </header>
  <div className="flex-1 overflow-y-auto">
    {groups.working.map(...)}        // 段头 "Working"
    {groups.needsInput.map(...)}     // 段头 "Needs input"
    {groups.completed.map(...)}      // 段头 "Completed"
  </div>
  <composer />
  <footer>  {shortcut hints}  </footer>
</div>
```

- **数据**：从 store 取 `backgroundAgentsAgents` + `backgroundAgentsDetails`，用 `buildBackgroundAgentListRows` 合并，再用 `groupBackgroundAgentListRows` 分组，用 `countBackgroundAgentListRows` 计数。
- **远程 workspace 的说明**（Global Constraints 里的「v1 只支持本机」**目前没有任何任务实现它**，这一条补上）：活动 worktree 不在本机时，面板**照常列本机的 agent**，但在列表上方加一条说明 —— 这个面板列的是**这台机器**上的后台 agent，不是远程 workspace 的。
  - 判法：`state.activeWorkspaceExecutionHostId` 不等于 `LOCAL_EXECUTION_HOST_ID`（`src/shared/execution-host.ts:7`）就是远程。**不要**用 `selectKnownWorktreeById(state, state.activeWorktreeId)` —— 它在活动 workspace 所在的那台主机上找，找不到就返回 `null`，而 `null` 会被当成「本机」，远程 workspace 的说明就被吞掉了。
  - **不要**因此把名单藏起来或换成空列表 —— 用户要看见的是「这台机器上真的有这些 agent」，附带一句它属于哪台机器。
  - 文案走 i18n key `auto.components.backgroundAgents.localOnlyNotice`（Task 10 建）。
- **elapsed 刷新**：一个 `useEffect` + `setInterval(1000)` 存 `now`，只为了重算 elapsed。行本身不重建。
- **轮询**：
  - **慢层抽成一个导出的 hook**：`useBackgroundAgentRosterRefresh()` —— `setInterval(15_000)` 调 `window.api.claudeAgents.list()` → `publishBackgroundAgentsListing`；挂载时也立刻调一次；卸载时清掉 interval。
    **为什么抽出来**：慢层不只列表屏要 —— 屏 2 的 header（name / state / cwd / elapsed）也靠它更新。轮询写在列表屏里的话，**进屏 2 时列表屏卸载，header 就永远停在进屏那一刻的样子**（agent 在屏 2 里死了，header 还写着 working）。Task 9 的详情屏也调这个 hook。
    两屏**不会同时挂载**（Task 10 的面板是二选一渲染），所以不会有两个 interval 抢着轮询。
  - **快层**留在列表屏自己的 `useEffect` 里：`setInterval(2_000)` 调 `window.api.claudeAgents.readDetails(ids)` → `publishBackgroundAgentDetails`。`ids` 来自当前的 `backgroundAgentsAgents`。屏 2 不需要快层（header 不显示灰字活动行）。
  - **两个 interval 都在面板卸载时清掉。**
  - **派发成功后立刻再刷一次慢层** —— 用户刚派发的 agent 不该等最多 15s 才出现在名单里。快层只读**已知** agent 的 state 文件，新 agent 不在名单里就永远读不到。
- **键盘**：照 `src/renderer/src/components/right-sidebar/ai-vault/session-list/use-ai-vault-session-keyboard-navigation.ts:117` 的 `aiVaultPanelKeyboardRootProps` 模式 —— 根节点 `tabIndex={-1}`，`onKeyDown` 只在 `event.target === event.currentTarget` 时处理。
  - **焦点在哪儿，决定谁能按什么键。** root 的 `onKeyDown` 带 `event.target === event.currentTarget` 守卫（照 AI Vault 的 `aiVaultPanelKeyboardRootProps`），所以**只有 root 自己有焦点时它才处理**；composer 有自己的 `onKeyDown`。两个处理器**共用同一套动作** —— 焦点在谁身上，行为都一样。
  - **行不能获得焦点**（照 AI Vault 的「Clicked rows cannot focus」）：行是 `<button>`，默认在 Tab 顺序里 —— **Tab 落到行上之后，root 的守卫会拒绝事件（target 不是 root）、composer 的 handler 又看不到，↑↓ / Ctrl+X / Esc / `/` 就全都死了**。所以行要 `tabIndex={-1}`，并且**行自己的 `onKeyDown` 也要跑那套共享动作**（万一它还是拿到了焦点）。
  - **挂载时聚焦 composer**（CLI 的 TUI 打开就能直接写任务）。**不聚焦的话整个面板的键盘是死的**：root 没焦点 → 守卫挡住；composer 没焦点 → 收不到事件。
  - `ArrowDown` / `ArrowUp`：移动选择，`event.preventDefault()`。**composer 也要转发这两个键** —— 单行输入框里 ↑↓ 本来就没有光标含义。
  - `Enter`：有选中行且 composer 为空 → `openBackgroundAgent(row.id)`。composer 有内容 → 派发。
  - `Control+x`：停止/删除的两步确认。**composer 也要转发** —— 但**输入框里有选区时不要 `preventDefault`**，让系统剪切（Windows/Linux 上 `Ctrl+X` 本来就是剪切；macOS 的 `⌘X` 一直是剪切，不受影响）。没有选区时才是停止/删除。
  - `/`：聚焦 composer。**只有 root 有焦点时 `/` 才是这个键** —— 在 composer 里 `/` 就是一个普通字符。
  - `Escape`：composer 有内容就清空，否则把焦点还给面板根。

  **v1 不做文本过滤**：`/` 只把焦点送到 composer，**不**切换到过滤模式。（spec §3.1 的键盘表原来写「/ 搜索」，那是旧面板留下的，**Claude Code 的 TUI 本身没有 `/` 搜索** —— 实测它的快捷键条是 `enter to return · space to reply · ctrl+x to delete · ? for shortcuts`。这个面板的全部意义就是镜像 CLI 的那个 TUI，所以照它来。）Task 5 的 `filterBackgroundAgentListRows` 因此成了死代码，Task 10 把它连同测试一起删掉。

- **composer**：一个受控 input。Enter 提交 `prompt` + 当前工作区路径；`cwd` 取自 `findFirstIndexedWorktree(selectWorktreesByRepo(state), state.activeWorktreeId)?.path`（照 `src/renderer/src/components/right-sidebar/ai-vault/session-actions/ai-vault-session-launch-target.ts:32`），拿不到就不传。
- **派发占位行**（spec §6.1）：派发在飞时，列表**顶部**（Working 段之前）插一行 `opening… · esc to cancel`。
  - **这行的状态住在 store 里，不在组件的 local state 里** —— 右侧边栏切 tab 时面板是**卸载**的（`right-sidebar-panel-content.tsx:61` 是 `{effectiveTab === 'background-agents' && <BackgroundAgentsPanel />}`），local state 会跟着一起没。Task 6 的 slice 因此要加一个字段：
    ```ts
    // src/renderer/src/store/slices/background-agents/create-background-agents-slice.ts
    export type BackgroundAgentsDispatch = {
      state: 'opening' | 'cancelling' | 'failed' | 'started'
      /** The short id the CLI gave, when the dispatch won the race against the cancel. */
      agentId: string | null
      /** Why the dispatch failed. */
      message: string | null
    }
    // slice 的字段
    backgroundAgentsDispatch: BackgroundAgentsDispatch | null
    publishBackgroundAgentsDispatch: (dispatch: BackgroundAgentsDispatch | null) => void
    ```
  - 派发期间按 `Esc` → 调 `window.api.claudeAgents.cancelDispatch()`，**把这次派发标成「正在取消」**。**这一行先不要消失** —— `cancelDispatch` 只是把中止信号送到，进程还没死（`abort()` 立刻返回，子进程是异步杀的），这一行的下场由**派发那个 promise 落定**：
    - 派发 promise 回 `{ ok: false, message: 'the dispatch was cancelled' }` → 这行消失（什么都没建起来）。
    - 派发 promise 回 `{ ok: true, id }` → **agent 真的建成了**（CLI 抢在中止之前就把 id 打印出来了）→ 这行变成 `started · <短 id>`，2 秒后自己消失。**不许假装取消成功** —— 用户按了取消却看到 agent 冒出来，比不说清楚更糟。
    - 派发 promise 回别的失败 → 这行变成失败态（写着失败原因），并且调 `toast.error(reason)`（`sonner`）。
  - 派发正常成功 → 这行直接消失（agent 会在下一次轮询里出现在名单上）。
  - **派发被中止时，CLI 可能已经把 agent id 打印出来了但那次调用返回的是失败** —— 那个 id 被丢掉了，panel 手里没有一个叫得出名字的 agent。**靠名单轮询兜底**：被中止的那次派发之后，慢层会把这个 agent 收进名单。这不是 bug，是「派发中按 Esc」这条路的固有代价。
  - 这行**不是 agent**：不参与 `countBackgroundAgentListRows` 的计数，也不参与 `↑↓` 的选择移动。
  - **派发在飞时，composer 的 Enter 不接受新的派发**（同一时刻只允许一个派发在飞，Task 06.5 的 main 侧只记一个 controller）。
    **这条 guard 是唯一的保证**：main 侧**不**强制 —— 第二个派发会把第一个的 controller 顶掉，第一个就再也取消不了（Task 06.5 评审的 Minor 2）。所以 composer 的 guard 必须真的挡住。
- **两步确认**：第一次 Ctrl+X 记下 `{ id, kind: 'stop' | 'delete', at: Date.now() }`；3s 内第二次 Ctrl+X 且 id 相同才真的执行。行内显示 `ctrl+x again to stop` 或 `ctrl+x again to delete`。
- **删除的提示语**：删除会连 worktree 一起删，确认文案必须写明这一点。

`BackgroundAgentRow.tsx` 重写成：状态点 + name + detail + elapsed，`selected` 时显示 `❯` 指针。点击调用 `onSelect`。

**「Needs input」那一段的活动行要显示 agent 在问什么。** `BackgroundAgentListRow.needs`（来自 `state.json`）就是「它在问你什么」—— spec §3.1 明说这个字段**只**用在一件事上：在行里显示它。所以：**在 needs-input 段，行里的灰字显示 `needs`（有的话），否则显示 `detail`**；别的段照旧显示 `detail`。一个卡住等决定的 agent 如果只显示名字和一句活动说明，用户根本不知道它在等他回答什么。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/components/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm tc:web && pnpm exec oxlint src/renderer/src/components/background-agents`
Expected: 都通过。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/background-agents
git commit -m "feat(background-agents): draw the agent list

Working, needs input and completed are separate sections, each row
carries the agent's own activity line, and the arrow keys move the
selection the way the CLI's list does."
```

---

### Task 8: 给共享终端层加 `claimKeyEvent` 钩子

**Files:**

- Modify: `src/renderer/src/components/standalone-terminal/open-standalone-terminal.ts`
- Modify: `src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts`

**Interfaces:**

- Produces:
  ```ts
  // open-standalone-terminal.ts, added to StandaloneTerminalArgs
  /**
   * Claims a key before xterm encodes it; returning true stops xterm from handling it.
   *
   * The hook sees every event type the custom handler sees — keydown, keyup and keypress. A caller
   * must claim a whole chord consistently: claiming the press but not the release lets the release
   * reach xterm's Kitty encoder, and the release bytes go out to the terminal.
   */
  claimKeyEvent?: (event: KeyboardEvent) => boolean
  ```

**为什么必须改共享层：** xterm 只有**一个** custom key handler 槽位（`this._customKeyEventHandler = e`，覆盖式）。`openStandaloneTerminal` 内部已经用 `installPreviewTerminalKeyHandler` 占用了。再调一次 `attachCustomKeyEventHandler` 会把复制/粘贴/快捷键/IME 全顶掉。

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.test.ts`（若已存在同名文件则加进去）。测法：

```ts
it('lets the caller claim a key before xterm encodes it', () => {
  const claimed: string[] = []
  const terminal = new Terminal()
  const dispose = installPreviewTerminalKeyHandler({
    terminal,
    claimImeKeyEvent: () => false,
    claimKeyEvent: (event) => {
      if (event.key === 'ArrowLeft') {
        claimed.push(event.key)
        return true
      }
      return false
    },
    pasteClipboardText: () => {},
    sendInput: () => {},
    getShortcutContext: () => ({ clientPlatform: 'darwin', macOptionAsAlt: 'false', keybindings: {}, terminalInput: null, getKittyKeyboardFlags: () => 0, terminalShortcutPolicy: undefined })
  })
  // Drive the custom handler the way xterm does and assert the claimed key never reaches it.
  ...
  expect(claimed).toEqual(['ArrowLeft'])
  dispose()
})
```

**如果 xterm 的 custom handler 不好直接驱动**（真实 xterm 不暴露它注册进去的 handler）：更稳的测法是**在 `installPreviewTerminalKeyHandler` 这一层测** —— 把 `terminal` 换成一个只记录 `attachCustomKeyEventHandler` 参数的假对象，断言传进来的 handler 对被 claim 的键返回 `false`。

**假对象不许用 `as` 断言造出来**：仓库的 changed-code 门禁用 `typescript/consistent-type-assertions` 的 `assertionStyle: "never"`（`config/oxlint-code-quality-casting.json`），**任何 `as` 都不行**。正确做法是**把 installer 的 `terminal` 参数类型收窄成它真正用的那几个方法**（它直接用了 5 个，另外 `readTerminalClipboardSelection(terminal)` 还要一个 `getSelection`，一共 6 个）：

```ts
terminal: Pick<
  Terminal,
  'attachCustomKeyEventHandler' | 'hasSelection' | 'scrollToTop' | 'scrollToBottom' | 'selectAll'
>
```

`Pick` 是类型标注，不是断言 —— 假对象直接传进去就行，**一行 `as` 都不需要**。真实的 `Terminal` 满足这个 `Pick`，所以现有调用方（dashboard 的 preview 终端、`openStandaloneTerminal`）**行为不变**。

```ts
it('does not let a claimed key reach xterm', () => {
  let handler: ((event: KeyboardEvent) => boolean) | null = null
  const terminal = {
    attachCustomKeyEventHandler: (h: (event: KeyboardEvent) => boolean) => {
      handler = h
    },
    hasSelection: () => false,
    scrollToTop: () => {},
    scrollToBottom: () => {},
    selectAll: () => {}
  }
  installPreviewTerminalKeyHandler({
    terminal,
    claimImeKeyEvent: () => false,
    claimKeyEvent: (event) => event.key === 'ArrowLeft',
    pasteClipboardText: () => {},
    sendInput: () => {},
    getShortcutContext: () => ({ ... })
  })
  const claimed = new KeyboardEvent('keydown', { key: 'ArrowLeft' })
  const other = new KeyboardEvent('keydown', { key: 'a' })
  expect(handler?.(claimed)).toBe(false)
  expect(handler?.(other)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.test.ts --maxWorkers=2`
Expected: FAIL —— `claimKeyEvent` 还不认。

- [ ] **Step 3: 实现**

`preview-terminal-key-handler.ts` 的 args 加 `claimKeyEvent?: (event: KeyboardEvent) => boolean`，并在 handler 的**最前面**（`claimImeKeyEvent` 之前）加：

```ts
if (args.claimKeyEvent?.(event)) {
  return false
}
```

**同时把 installer 的 `terminal` 参数类型收窄成 `Pick<Terminal, 'attachCustomKeyEventHandler' | 'hasSelection' | 'scrollToTop' | 'scrollToBottom' | 'selectAll' | 'getSelection'>`**（Step 1 里假对象要靠它才不用 `as`）。只收窄类型，不改运行时行为。

`open-standalone-terminal.ts` 的 `StandaloneTerminalArgs` 加 `claimKeyEvent?: (event: KeyboardEvent) => boolean`，并在 `installPreviewTerminalKeyHandler({...})` 的调用里传 `claimKeyEvent: args.claimKeyEvent`。

**注意**：这两个文件也被 dashboard 的 preview 终端用。钩子是可选的，不传就是现在的行为——**不能改变现有调用方的行为**。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/components/dashboard-popout --maxWorkers=2`
Expected: PASS —— 既有测试也必须过（这是这个任务存在的原因：不能碰坏别人）。

- [ ] **Step 5: 类型检查 + 提交**

```bash
pnpm tc:web
git add src/renderer/src/components/standalone-terminal/open-standalone-terminal.ts src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts
git commit -m "feat(terminal): let a caller claim a key before xterm encodes it

xterm keeps one custom key handler and the standalone terminal already
owns it, so a second attach would break copy, paste and IME."
```

---

### Task 9: 屏 2（内嵌 attach 终端）

**Files:**

- Create: `src/renderer/src/components/background-agents/background-agent-terminal.tsx`
- Create: `src/renderer/src/components/background-agents/BackgroundAgentAgentScreen.tsx`

**Interfaces:**

- Consumes: Task 8 的 `claimKeyEvent`、Task 4 的 `window.api.claudeAgents`、已有的 `window.api.pty.*`、`openStandaloneTerminal`、`subscribeToPtyData`

**现成的 API，别重写（都已核实存在）：**

| 要用的东西                      | 在哪                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `subscribeToPtyData`            | `src/renderer/src/components/terminal-pane/pty-transport/delivery/pty-data-sidecar-subscriptions.ts`              |
| `FLOATING_TERMINAL_WORKTREE_ID` | `src/shared/constants.ts`                                                                                         |
| `buildClaudeAttachStartup`      | `src/shared/ai-vault/resume/ai-vault-attach-startup.ts`（返回 `{ command, cwd? }`，它已经把 agent id 正确加引号） |
| `openStandaloneTerminal`        | `src/renderer/src/components/standalone-terminal/open-standalone-terminal.ts`                                     |
| `window.api.pty.spawn`          | 参数形状：`{ cols, rows, cwd?, command?, commandDelivery?: 'renderer' \| 'provider', worktreeId? }`               |

- Produces:

  ```ts
  // src/renderer/src/components/background-agents/background-agent-terminal.tsx
  export function BackgroundAgentTerminal(props: {
    agentId: string
    cwd: string | null
    onBack: () => void
  }): React.JSX.Element
  ```

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/components/background-agents/background-agent-terminal.test.tsx`。测**编排**，不测像素：

```tsx
it('spawns one detached PTY for the agent and kills it when the user leaves the screen', async () => {
  const spawn = vi.fn(async () => ({ id: 'pty-1' }))
  const kill = vi.fn(async () => {})
  vi.stubGlobal('window', { api: { pty: { spawn, kill, write: vi.fn(), resize: vi.fn(), setRendererPtyVisible: vi.fn() } } })
  const { unmount } = render(<BackgroundAgentTerminal agentId="aaaa1111" cwd="/w" onBack={() => {}} />)
  await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
  expect(spawn.mock.calls[0][0]).toMatchObject({
    commandDelivery: 'provider',
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID
  })
  expect(spawn.mock.calls[0][0].command).toContain('attach')
  // 用户离开了屏 2（store 的屏状态不再是这个 agent）→ 卸载时杀掉这个 pty
  useAppStore.getState().closeBackgroundAgent()
  unmount()
  await waitFor(() => expect(kill).toHaveBeenCalledWith('pty-1'))
})

it('keeps the attach alive when the sidebar tab is switched', async () => {
  // 屏状态还是这个 agent，只是侧栏切了 tab → 卸载**不能**杀 pty（spec §4.4）
  // 切回来时要复用同一个 ptyId，不重新 spawn
})

it('returns to the list when the left arrow is pressed', async () => {
  const onBack = vi.fn()
  // 挂上 xterm 后派发一个 ArrowLeft 的 keydown
  ...
  expect(onBack).toHaveBeenCalled()
})
```

**注意**：这个测试要 stub `window.api.pty`。`openStandaloneTerminal` 需要真实的 DOM 容器，jsdom 下 xterm 能开（仓库里已有 xterm 的测试做法，照抄 `src/renderer/src/components/settings/terminal/appearance/TerminalSettingsPreview.tsx` 附近的写法）。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/background-agents/background-agent-terminal.test.tsx --maxWorkers=2`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现 `background-agent-terminal.tsx`**

```
useEffect(() => {
  let disposed = false
  let ptyId: string | null = null
  let unsubscribe: (() => void) | null = null
  let standalone: StandaloneTerminal | null = null
  let fit: FitAddon | null = null
  let observer: ResizeObserver | null = null
  let resizeListener: { dispose: () => void } | null = null

  void (async () => {
    const container = containerRef.current
    if (!container) return
    const command = buildClaudeAttachStartup({ platform: navigator.platform, agentId }).command
    const spawned = await window.api.pty.spawn({
      cols: 80, rows: 24,
      cwd: cwd ?? undefined,
      command,
      commandDelivery: 'provider',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID
    })
    if (disposed) { void window.api.pty.kill(spawned.id); return }
    ptyId = spawned.id
    setBackgroundAgentsAttachedPty(spawned.id)

    const kittyKeyboardModes = new TerminalKittyKeyboardModeTracker({ kittyKeyboard: true })
    standalone = openStandaloneTerminal({
      container,
      options: buildPreviewTerminalOptions({ ... }),
      kittyKeyboardModes,
      sessionKey: spawned.id,
      sendInput: (data) => { window.api.pty.write(spawned.id, data, 'terminal-input'); return true },
      answersQueries: true,
      getSettings: () => settingsRef.current,
      getMacOptionAsAlt: () => macOptionAsAltRef.current,
      getTerminalInput: () => null,
      claimKeyEvent: (event) => {
        // Why: 钩子对 keydown / keyup / keypress 都会来。**只 claim 按下**会让抬起的那一下落到
        // xterm 的 Kitty 编码器上，release 字节就进了 `claude attach` 的 PTY。所以**按键 claim、
        // 只在按下时动作**。
        if (event.key !== 'ArrowLeft') return false
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
        if (event.type === 'keydown' && !event.repeat) {
          event.preventDefault()
          event.stopPropagation()
          onBackRef.current()
        }
        return true
      }
    })
    if (!standalone) { /* 报「终端打不开」 */ return }

    // 首帧：pty:data 是裸流，先补一次权威快照。
    const snapshot = await window.api.pty.getMainBufferSnapshot(spawned.id, { scrollbackRows: 500 })
    if (snapshot?.data) standalone.write(snapshot.data, { live: false })

    unsubscribe = subscribeToPtyData(spawned.id, (data) => standalone?.write(data, { live: true }))
    window.api.pty.setRendererPtyVisible(spawned.id, true)

    fit = new FitAddon()
    standalone.terminal.loadAddon(fit)
    resizeListener = standalone.terminal.onResize(({ cols, rows }) => window.api.pty.resize(spawned.id, cols, rows))
    observer = new ResizeObserver(() => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) fit?.fit()
    })
    observer.observe(container)
  })()

  return () => {
    disposed = true
    observer?.disconnect()
    resizeListener?.dispose()
    unsubscribe?.()
    standalone?.dispose()
    // Why: 离开屏 2 要杀掉这个 pty，但**侧栏切 tab 导致的卸载不能杀** ——
    // spec §4.4 说切走再切回来要重新挂同一个 ptyId。两种卸载在 React 里长得一样，
    // 只能问 store：屏状态还是这个 agent，说明是侧栏切 tab，不是用户离开了屏 2。
    if (ptyId && !stillShowingThisAgent(agentId)) {
      void window.api.pty.kill(ptyId)
      setBackgroundAgentsAttachedPty(null)
    }
  }
}, [agentId])
```

**复用已有的 pty（切走再切回来）**：挂载时先问 store 有没有现成的 ptyId —— 有就**不要重新 spawn**，直接拿它重新订阅 + 重新取快照：

```ts
const existing = selectBackgroundAgentsAttachedPtyId(state)
const spawned = existing
  ? { id: existing }
  : await window.api.pty.spawn({ ... })
```

**必须遵守的四条**（都在 spec §4.3 里踩过坑）：

1. 收字节用 `subscribeToPtyData`，**不是** `pty.onData`。
2. `answersQueries: true`。
3. `pty.setRendererPtyVisible(id, true)`。
4. `worktreeId: FLOATING_TERMINAL_WORKTREE_ID` + `commandDelivery: 'provider'`。

**← 键的修饰键规则**：只拦**不带** ctrl/meta/alt/shift 的 `ArrowLeft`。带修饰键的（`⌘←` = 行首）放给 xterm，这样光标左移的能力没有全丢。

- [ ] **Step 4: 实现 `BackgroundAgentAgentScreen.tsx`**

```
<div className="flex min-h-0 flex-1 flex-col" data-testid="background-agents-agent">
  <header className="flex items-center gap-2 px-2 py-1">
    <button aria-label="Back to the agent list" onClick={closeBackgroundAgent}>←</button>
    <span>{name}</span>
    <span>{state}</span>
    <span>{cwd}</span>
    <span>{elapsed}</span>
  </header>
  <BackgroundAgentTerminal agentId={agentId} cwd={cwd} onBack={closeBackgroundAgent} />
</div>
```

header 的 name/state/cwd/elapsed 来自 store 的当前行（所以它跟着轮询变）。

**详情屏也要跑慢层轮询**：调 Task 7 导出的 `useBackgroundAgentRosterRefresh()`。**不调的话，进屏 2 时列表屏已经卸载，轮询停了，header 就永远停在进屏那一刻的样子** —— agent 在屏 2 里死了，header 还写着 working，用户看不出来。列表屏和详情屏**不会同时挂载**（Task 10 的面板二选一渲染），所以不会有两个 interval 抢着轮询。

**测试**：轮询刷新后，header 的 state 跟着变（用一个假 timer 或直接调 store 的 `publishBackgroundAgentsListing` 后断言 header 重新渲染出新状态）。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/components/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查 + lint + 提交**

```bash
pnpm tc:web && pnpm exec oxlint src/renderer/src/components/background-agents
git add src/renderer/src/components/background-agents
git commit -m "feat(background-agents): enter a running agent

The agent's own terminal is attached in place, so it can be talked to
and its permission prompts answered. The left arrow goes back to the
list and leaves the agent running."
```

---

### Task 10: 接线、删旧文件、换文案

**Files:**

- Modify: `src/renderer/src/components/background-agents/BackgroundAgentsPanel.tsx`（重写）
- Delete: 上面 File Structure 里列的 9 个旧文件
- Modify: `src/renderer/src/i18n/locales/en.json`

- [ ] **Step 1: 重写面板成两屏路由**

```tsx
export default function BackgroundAgentsPanel(): React.JSX.Element {
  const screen = useAppStore((state) => state.backgroundAgentsScreen)
  return screen.kind === 'list' ? (
    <BackgroundAgentListScreen />
  ) : (
    <BackgroundAgentAgentScreen agentId={screen.agentId} />
  )
}
```

- [ ] **Step 2: 删掉旧文件**

```bash
git rm src/renderer/src/components/background-agents/background-agent-session-list.ts \
  src/renderer/src/components/background-agents/background-agent-terminal-rows.ts \
  src/renderer/src/components/background-agents/background-agent-terminal-rows.test.ts \
  src/renderer/src/components/background-agents/background-agent-vault-resume.ts \
  src/renderer/src/components/background-agents/background-agent-vault-rows.ts \
  src/renderer/src/components/background-agents/background-agent-vault-rows.test.ts \
  src/renderer/src/components/background-agents/background-agent-workspace-scope.ts \
  src/renderer/src/components/background-agents/background-agent-workspace-scope.test.ts \
  src/renderer/src/components/background-agents/use-background-agent-sessions.ts
```

**不要**删 `src/main/ai-vault/` 下的东西 —— AI Vault 面板还在用它的 resume 机器。

**另外删掉一个现在没人用的导出**：`filterBackgroundAgentListRows`（在 `src/renderer/src/components/background-agents/background-agent-list-rows.ts`，连同它在 `background-agent-list-rows.test.ts` 里的那个 `describe` 块）。v1 不做文本过滤（见下面的裁决），所以它成了死代码 —— 仓库的死代码审计会报一个没人引用的导出。**留下一个没人用的函数比删掉它更糟**。

- [ ] **Step 3: 换 i18n**

在 `src/renderer/src/i18n/locales/en.json` 里，把 `auto.components.backgroundAgents` 整块换成新的 key：

```json
"backgroundAgents": {
  "title": "Background agents",
  "workingSection": "Working",
  "needsInputSection": "Needs input",
  "completedSection": "Completed",
  "counts": "{{awaiting}} awaiting input · {{working}} working · {{completed}} completed",
  "composerPlaceholder": "Describe a task for a new session",
  "composerLabel": "New background agent",
  "loading": "Loading background agents",
  "empty": "No background agents",
  "unsupported": "Claude Code CLI not found",
  "error": "Could not read the background agents",
  "localOnlyNotice": "This panel lists background agents running on this machine",
  "stopConfirm": "ctrl+x again to stop",
  "deleteConfirm": "ctrl+x again to delete",
  "deleteWarning": "Deleting an agent also deletes its worktree",
  "back": "Back to the agent list",
  "dispatching": "opening… · esc to cancel",
  "dispatchingCancelling": "cancelling…",
  "dispatchStarted": "started · {{id}}",
  "dispatchFailed": "The agent could not be started",
  "shortcuts": "↑↓ select · enter enter · ctrl+x stop · / task"
}
```

**`dispatching` / `dispatchStarted` 是 Task 7 实现时加的两个 key**（计划原来的 key 表里没有给派发占位行留位置）：`dispatching` = `opening… · esc to cancel`，`dispatchStarted` = `started · {{id}}`（**双花括号** —— 仓库的 i18next 用 `{{name}}` 插值，单花括号是字面文本）。
**没有 `searchLabel`** —— v1 不做文本过滤（见下面的裁决）。

**其它 10 个语言文件：只删旧的 `auto.components.backgroundAgents` 块，不加新的。**

- **新的 key 只进 en.json。** 目标语言缺翻译走 i18next fallback —— 校验脚本的原话是「Feature PRs own English declarations; missing target translations use i18next fallback until localization supplies them」（`verify-localization-catalog.mjs:436`）。所以「其它 10 个文件不用加新 key」是对的。
- **但旧的 key 必须从全部 11 个文件里删掉。** 校验脚本把「locale 里有、en.json 里没有」的 key 报成 `extra` 并**直接失败**（`verify-localization-catalog.mjs:293` 的 `extraInLocale`，失败条件在 `:439`）。所以那 10 个文件里的 `auto.components.backgroundAgents.stateRunning` / `stateInterrupted` / `stateSlept` / `stateIdle` / `untitled` / `searchPlaceholder` / `searchLabel` / `loading` / `empty` / `refresh` **都要删掉**（旧面板不再用），否则门禁报 extra。
- **别删** `auto.components.right.sidebar.index.backgroundAgents`（那是右侧栏 tab 的标题，在另一个块里，与本块无关）。

**注意**：

- `loading` / `empty` 在新块里保留了同名 key，值改成新的。（`searchLabel` 没有了 —— v1 不做文本过滤。）
- i18n 的 key **不能带点**（必须是嵌套对象），也不能让两个语义不同的 key 共用同一个 fallback 字符串。

**跑一遍目录校验**（`verify:localization-catalog` 强制每个 `t('key', ...)` 的 key 存在于 en.json）：

```bash
pnpm run sync:localization-catalog   # 补齐缺失的 key
pnpm run verify:localization-catalog
```

Expected: 两者都通过。

- [ ] **Step 4: 类型检查 + lint + 格式 + i18n**

```bash
pnpm tc:web
pnpm exec oxlint src/renderer/src/components/background-agents
pnpm exec oxfmt --check src/renderer/src/components/background-agents src/renderer/src/i18n/locales/en.json
pnpm run sync:localization-catalog && pnpm run verify:localization-catalog
```

Expected: 都通过。

- [ ] **Step 5: 跑全量 renderer 单测**

Run: `pnpm test src/renderer/src/components/background-agents src/renderer/src/store/slices/background-agents --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/background-agents src/renderer/src/i18n/locales/en.json
git commit -m "refactor(background-agents): the panel supervises background agents

The panel listed Orca's own foreground sessions. It now lists Claude
Code's background agents and nothing else; the AI Vault keeps the
transcripts and the terminal tabs stay where they were."
```

---

### Task 11: E2E 与收口

**Files:**

- Create: `tests/e2e/claude-background-agents.spec.ts`

- [ ] **Step 1: 写 E2E**

`tests/e2e/claude-background-agents.spec.ts`：

```
前置：ORCA_BACKGROUND_LAUNCH=1 启动（仓库既有做法）。
```

用例：

1. **前置检查**：从测试里跑一次 `claude agents --json`。**没有活着的后台 agent 就 `test.skip()`** —— CI 上没有 agent 是正常的，跳过比假装通过好。
2. 打开右侧边栏 → 点 `Background agents` activity item。
3. 断言列表出现：找到那个 agent 的名字（`getByText(name)`）。
4. 用 `ArrowDown`/`ArrowUp` 移动选择，断言选中的行变了。
5. `Enter` 进入详情屏：断言出现「← 返回」按钮，且 xterm 容器里有内容（用 `data-testid="background-agents-agent"` 与 xterm 的 `.xterm-screen` 判断）。
6. 按 `ArrowLeft`：断言回到列表屏（`background-agents-list` 出现）。
7. **断言 agent 还活着**：再跑一次 `claude agents --json`，断言那个 id 还在。

第 7 步是这个功能的核心承诺：**返回列表不杀 agent**。

- [ ] **Step 2: 跑 E2E**

Run: `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e -- tests/e2e/claude-background-agents.spec.ts`
Expected: PASS；本机有活 agent 时跑真流程，没有就 SKIP。

**如果本机的 agent 名字在跑测试期间变了** —— agent 会自己改名（实测）。所以测试**不要**断言名字，改成断言「列表里至少有一行」+「用第 1 行的 id 进入」。

- [ ] **Step 3: 跑 parity 护栏**

Run: `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e:terminal-layout-parity`
Expected: PASS。游离 PTY 记在 `global-floating-terminal` 名下，`terminal.list` 按 worktree 过滤，不该影响 parity。

**如果 parity 失败**：先确认是不是我们的 PTY 被算进去了（`terminal.list` 不带 worktree 时会）。修法是让 E2E 在结束时把 attach PTY 杀干净。

- [ ] **Step 4: 跑全套护栏**

```bash
pnpm exec oxlint src/main/claude/background-agents src/main/ipc/claude-agents src/renderer/src/components/background-agents src/renderer/src/store/slices/background-agents
pnpm exec oxfmt --check src/main/claude/background-agents src/main/ipc/claude-agents src/renderer/src/components/background-agents src/renderer/src/store/slices/background-agents src/preload/api/claude-agents-api.ts src/preload/api/claude-agents-bridge.ts
pnpm tc:node && pnpm tc:web && pnpm tc:cli
pnpm test src/main/claude/background-agents src/main/ipc/claude-agents src/renderer/src/components/background-agents src/renderer/src/store/slices/background-agents --maxWorkers=2
```

Expected: 全绿。

- [ ] **Step 5: 跑改动门禁**

Run: `pnpm check:changed`
Expected: PASS。**注意**：本仓库在 `origin/main` 基线上本来就有几个失败的测试（见记忆 `upstream-related-tests-fail-at-base`）。如果失败项能在 `origin/main` 上复现，它不是我们引入的 —— 在提交信息里说明。

- [ ] **Step 6: 提交**

```bash
git add tests/e2e/claude-background-agents.spec.ts
git commit -m "test(background-agents): enter a running agent and come back

The point of the screen is that the agent keeps running while the
user looks at something else, so the test checks that the agent is
still there after the left arrow."
```

---

## 自审

**Spec 覆盖**：§1/§2 背景与目标 → Task 1-11 的整体；§3.1 列表屏 → Task 5/7；§3.2 详情屏 → Task 8/9；§3.3 删旧 → Task 10；§4.1 模块 → File Structure；§4.2 不复用 TerminalPane → Task 9；§4.3 传输层 → Task 9 + Task 8（键钩子）；§4.4 生命周期 → Task 9（**离开屏 2 杀 pty，侧栏切 tab 保留** —— 两种卸载在 React 里长得一样，靠 store 的屏状态区分）；§5.1/5.2 数据与刷新 → Task 2/4/7；§5.3 过滤 → Task 5；§5.4 远程 → 明确 out of scope（Global Constraints）；§6.1 派发 → Task 3（命令）+ Task 06.5（取消通道）+ Task 7（占位行/失败态/toast）；§6.2 停止/删除 → Task 3/7；§7 键盘 → Task 7/8/9；§8 降级 → Task 4（unsupported/error）+ Task 5（detail 缺失）+ Task 7；§9 测试 → Task 5/7/9/11；§10.1 三件必验 → Task 9（长输出不卡、DA/DSR、cwd 守卫）。

**类型一致性**：`ClaudeBackgroundAgent` / `ClaudeBackgroundAgentDetail` / `ClaudeBackgroundAgentListResult` 在 Task 1 定义、Task 4/5/6 消费；`BackgroundAgentListRow` 在 Task 5 定义、Task 7/9 消费；`BackgroundAgentsScreen` 在 Task 6 定义、Task 7/9 消费。

**Review Focus 五条**的归属：1 → Task 3 的 id 守卫用例；2 → Task 9 的 attach 退出用例；3 → Task 5 的「名字取自 listing」用例；4 → Task 5 的「blocked 落到 needs-input」用例；5 → Task 6 的「刷新期间保留旧名单」用例。

**比例**：11 个任务、346 行 spec。计划比 spec 长，但每个任务给的是签名与断言，不是代码体。
