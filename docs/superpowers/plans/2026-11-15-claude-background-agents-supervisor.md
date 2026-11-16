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
2. **agent 在详情屏里死掉** —— `claude attach` 的进程退出后 shell 还在，终端看起来像"还活着" → Task 9 的「attach 进程退出」用例 + Task 7 的 header state 来自轮询。
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
import { resolveCommandOnLocalPath } from '../../ipc/command-path/command-path-resolver'
import { hostShellEnvironment } from '../../runtime/agent-session/environment/structured-agent-shell-environment'

/** `claude attach`/`stop`/`rm` accept a name; the panel only ever knows the short id. */
const BACKGROUND_AGENT_ID = /^[0-9a-f]{8}$/
```

三个命令共用一个内部 helper：解析 `claude` 的可执行文件 → 跑 `runProcess` → 看退出码。

- `dispatchClaudeBackgroundAgent`：
  - `args` 组装成 `['--bg', ...(model ? ['--model', model] : []), ...(permissionMode ? ['--permission-mode', permissionMode] : []), prompt]`。
  - `cwd` 传给 `runProcess`（`claude --bg` 没有 `--cwd`，工作目录来自进程）。
  - stdout 用 `/^backgrounded\s*·\s*([0-9a-f]{8})/m` 取 id。**取不到 id 就是失败**，不是成功。
  - 失败时 `message` 用 stderr；stderr 为空时用 `'the CLI did not report why'`。
- `stopClaudeBackgroundAgent` / `removeClaudeBackgroundAgent`：
  - **先**校验 `id` 匹配 `BACKGROUND_AGENT_ID`，不匹配直接返回 `{ ok: false, message: 'not a background agent id' }`，**不跑任何命令**。
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

### Task 7: 屏 1（列表）

**Files:**

- Create: `src/renderer/src/components/background-agents/BackgroundAgentListScreen.tsx`
- Modify: `src/renderer/src/components/background-agents/BackgroundAgentRow.tsx`（重写）
- Create: `src/renderer/src/components/background-agents/BackgroundAgentListScreen.test.tsx`

**Interfaces:**

- Consumes: Task 5 的纯函数、Task 6 的 slice、Task 4 的 `window.api.claudeAgents`
- Produces:

  ```ts
  // src/renderer/src/components/background-agents/BackgroundAgentRow.tsx
  export function BackgroundAgentRowView(props: {
    row: BackgroundAgentListRow
    selected: boolean
    onSelect: (row: BackgroundAgentListRow) => void
  }): React.JSX.Element
  ```

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/components/background-agents/BackgroundAgentListScreen.test.tsx`：

```tsx
it('moves the selection with the arrow keys', () => { ... })
it('enters the selected agent on Enter', () => { ... })
it('asks for the stop to be confirmed twice', () => { ... })
it('dispatches the composed prompt', () => { ... })
```

每个用例用 `createTestStore()` 预置 `backgroundAgentsAgents`，用 `@testing-library/react` 渲染 `BackgroundAgentListScreen`，用 `fireEvent.keyDown(root, { key: 'ArrowDown' })` 驱动。

断言要具体：

- ArrowDown 之后被选中的行的 `data-selected="true"` 落在第二行。
- Enter 之后 `store.getState().backgroundAgentsScreen` 是 `{ kind: 'agent', agentId: 'bbbb2222' }`。
- Ctrl+X 第一次之后，行内出现 `ctrl+x again to stop` 的文字，且 `window.api.claudeAgents.stop` **没有被调用**；第二次之后它被调用了一次，且参数是 `{ id: 'bbbb2222' }`。
- composer 里输入 `do the thing` 并 Enter 之后，`window.api.claudeAgents.dispatch` 被调用，参数含 `prompt: 'do the thing'`。

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
- **elapsed 刷新**：一个 `useEffect` + `setInterval(1000)` 存 `now`，只为了重算 elapsed。行本身不重建。
- **轮询**：另一个 `useEffect`：
  - 慢层：`setInterval(15_000)` 调 `window.api.claudeAgents.list()` → `publishBackgroundAgentsListing`；挂载时也立刻调一次。
  - 快层：`setInterval(2_000)` 调 `window.api.claudeAgents.readDetails(ids)` → `publishBackgroundAgentDetails`。`ids` 来自当前的 `backgroundAgentsAgents`。
  - **两个 interval 都在面板卸载时清掉。**
- **键盘**：照 `src/renderer/src/components/right-sidebar/ai-vault/session-list/use-ai-vault-session-keyboard-navigation.ts:117` 的 `aiVaultPanelKeyboardRootProps` 模式 —— 根节点 `tabIndex={-1}`，`onKeyDown` 只在 `event.target === event.currentTarget` 时处理。
  - `ArrowDown` / `ArrowUp`：移动选择，`event.preventDefault()`。
  - `Enter`：有选中行且 composer 为空 → `openBackgroundAgent(row.id)`。composer 有内容 → 派发。
  - `Control+x`：停止/删除的两步确认。
  - `/`：聚焦 composer。
  - `Escape`：composer 有内容就清空，否则把焦点还给面板根。
- **composer**：一个受控 input。Enter 提交 `prompt` + 当前工作区路径；`cwd` 取自 `findFirstIndexedWorktree(selectWorktreesByRepo(state), state.activeWorktreeId)?.path`（照 `src/renderer/src/components/right-sidebar/ai-vault/session-actions/ai-vault-session-launch-target.ts:32`），拿不到就不传。
- **两步确认**：第一次 Ctrl+X 记下 `{ id, kind: 'stop' | 'delete', at: Date.now() }`；3s 内第二次 Ctrl+X 且 id 相同才真的执行。行内显示 `ctrl+x again to stop` 或 `ctrl+x again to delete`。
- **删除的提示语**：删除会连 worktree 一起删，确认文案必须写明这一点。

`BackgroundAgentRow.tsx` 重写成：状态点 + name + detail + elapsed，`selected` 时显示 `❯` 指针。点击调用 `onSelect`。

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
  /** Claims a key before xterm encodes it; returning true stops xterm from handling it. */
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

**如果 xterm 的 custom handler 不好直接驱动**：退一步，测 `openStandaloneTerminal` 是否把钩子透传下去 —— 建一个真实 xterm，调用 `terminal.attachCustomKeyEventHandler` 拿不到（槽位已被占）。所以更稳的测法是**在 `installPreviewTerminalKeyHandler` 这一层测**：把 `terminal` 换成一个只记录 `attachCustomKeyEventHandler` 参数的假对象，断言传进来的 handler 对被 claim 的键返回 `false`。

```ts
it('does not let a claimed key reach xterm', () => {
  let handler: ((event: KeyboardEvent) => boolean) | null = null
  const terminal = {
    attachCustomKeyEventHandler: (h: (event: KeyboardEvent) => boolean) => { handler = h },
    onData: () => ({ dispose: () => {} }),
    hasSelection: () => false,
    scrollToTop: () => {},
    scrollToBottom: () => {},
    selectAll: () => {}
  } as unknown as Terminal
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
it('spawns one detached PTY for the agent and kills it on the way out', async () => {
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
  unmount()
  await waitFor(() => expect(kill).toHaveBeenCalledWith('pty-1'))
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
        if (event.type !== 'keydown' || event.key !== 'ArrowLeft') return false
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
        event.preventDefault()
        event.stopPropagation()
        onBackRef.current()
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
    if (ptyId) { void window.api.pty.kill(ptyId); setBackgroundAgentsAttachedPty(null) }
  }
}, [agentId])
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

- [ ] **Step 3: 换 i18n**

在 `src/renderer/src/i18n/locales/en.json` 里，把 `auto.components.backgroundAgents` 整块换成新的 key：

```json
"backgroundAgents": {
  "title": "Background agents",
  "workingSection": "Working",
  "needsInputSection": "Needs input",
  "completedSection": "Completed",
  "counts": "{awaiting} awaiting input · {working} working · {completed} completed",
  "composerPlaceholder": "Describe a task for a new session",
  "composerLabel": "Describe a task for a new session",
  "loading": "Loading background agents",
  "empty": "No background agents",
  "unsupported": "Claude Code CLI not found",
  "error": "Could not read the background agents",
  "stopConfirm": "ctrl+x again to stop",
  "deleteConfirm": "ctrl+x again to delete",
  "deleteWarning": "Deleting an agent also deletes its worktree",
  "back": "Back to the agent list",
  "searchLabel": "Search background agents",
  "shortcuts": "↑↓ select · enter enter · ctrl+x stop · / search"
}
```

**其它 10 个语言文件不用改** —— 它们没有这个 key，走 fallback。`auto.components.backgroundAgents.stateRunning` / `stateInterrupted` / `stateSlept` / `stateIdle` / `untitled` / `searchPlaceholder` / `searchLabel` / `loading` / `empty` / `refresh` 一起删掉（旧面板不再用）。

**注意**：

- `searchLabel` 和 `loading` / `empty` 在新块里保留了同名 key，值改成新的。
- **别删** `auto.components.right.sidebar.index.backgroundAgents`（那是右侧栏 tab 的标题，与本块无关）。
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

**Spec 覆盖**：§1/§2 背景与目标 → Task 1-11 的整体；§3.1 列表屏 → Task 5/7；§3.2 详情屏 → Task 8/9；§3.3 删旧 → Task 10；§4.1 模块 → File Structure；§4.2 不复用 TerminalPane → Task 9；§4.3 传输层 → Task 9 + Task 8（键钩子）；§4.4 生命周期 → Task 9（卸载 kill）；§5.1/5.2 数据与刷新 → Task 2/4/7；§5.3 过滤 → Task 5；§5.4 远程 → 明确 out of scope（Global Constraints）；§6.1 派发 → Task 3；§6.2 停止/删除 → Task 3/7；§7 键盘 → Task 7/8/9；§8 降级 → Task 4（unsupported/error）+ Task 5（detail 缺失）+ Task 7；§9 测试 → Task 5/7/9/11；§10.1 三件必验 → Task 9（长输出不卡、DA/DSR、cwd 守卫）。

**类型一致性**：`ClaudeBackgroundAgent` / `ClaudeBackgroundAgentDetail` / `ClaudeBackgroundAgentListResult` 在 Task 1 定义、Task 4/5/6 消费；`BackgroundAgentListRow` 在 Task 5 定义、Task 7/9 消费；`BackgroundAgentsScreen` 在 Task 6 定义、Task 7/9 消费。

**Review Focus 五条**的归属：1 → Task 3 的 id 守卫用例；2 → Task 9 的 attach 退出用例；3 → Task 5 的「名字取自 listing」用例；4 → Task 5 的「blocked 落到 needs-input」用例；5 → Task 6 的「刷新期间保留旧名单」用例。

**比例**：11 个任务、346 行 spec。计划比 spec 长，但每个任务给的是签名与断言，不是代码体。
