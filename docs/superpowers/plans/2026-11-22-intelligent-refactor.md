# 智能重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户对某个代码文件发起重构，Claude Agent SDK 在工作区的暂存目录里产出带理由的重构建议与重构后文件，应用逐个文件 diff 对比，并允许在全方案 / 全文件 / 代码块三个粒度上把改动写回源码。

**Architecture:** agent 只用文件说话——它把重构后的文件与一份 `manifest.json` 写进 `.orca/refactor/<jobId>/`，应用读回文件、**自己算 hunk**、组装 `RefactorPlan` 交给渲染层。模型永远不产出行号、不产出 diff、不在回答里贴 JSON，因此绕开了 NES 栽过的"模型数错行"和"模型给对了应用丢了"两个坑。接受时不是打 patch，而是用被接受的 hunk 重算整份文件内容再整体写回。

**Tech Stack:** Electron + React 19 + Zustand + Monaco Editor（`DiffViewer`）+ Zod + Vitest（`pnpm test`）+ `@anthropic-ai/claude-agent-sdk` v0.3.318 + `diff` v8.0.4

**Spec:** `docs/superpowers/specs/2026-11-22-intelligent-refactor-design.md`

## Global Constraints

- 跨平台：不硬编码 `e.metaKey`；快捷键用 `monaco.KeyMod.CtrlCmd`；路径一律用 `path.join` / `path.resolve` / `path.relative`。
- 远端优先：所有工作区读写走 runtime RPC，参数用 `worktree` + `relativePath`（沿用 `WorktreeSelector` 形状），本地 / SSH / WSL 一条路。
- 类型放 `.ts`，不放 `.d.ts`（`src/shared/` 与 `src/preload/` CI 强制）。
- 新文件不得使用 `helpers` / `utils` / `common` / `misc` 命名；按领域概念命名。
- 注释：只写代码本身没说清的原因，一行，写"为什么"不写"怎么做"。
- UI 文案用 `t('auto.components.editor.<File>.<key>', 'default')`；key 由 `node config/scripts/localization/source-extraction/localize-renderer-strings.mjs` 生成后提交。
- 不默认加测试。本计划列出的测试都是纯逻辑、会在改动被回退时失效、且硬编码期望值的。
- 测试用 `pnpm test <path> --maxWorkers=2`，不要裸跑 vitest。
- 类型检查 `pnpm tc:node`（main + shared）与 `pnpm tc:web`（renderer）。
- 提交前必须跑 `pnpm check:changed`（基线 `origin/main`），不得 `--no-verify`。
- 改了 RPC 方法后必须跑 `pnpm generate:rpc-params-catalog` 并提交生成物。
- 不在本计划内新增仓库根目录条目。

## Review Focus

规格没有明说、但最可能伤到真实使用者的五类输入。每一条都已挂到拥有该代码的任务里，由该任务自己的测试钉住。

1. **编辑器缓冲区有未保存修改**（B ≠ D）——重构必须基于 B；写盘会连带把这些未保存修改一起保存，界面必须写明。→ Task 8
2. **写闸门被路径穿越绕过**——`..` 逃逸、绝对路径、大小写差异、工具入参里根本没有路径字段。→ Task 3
3. **清单里的相对路径越界**——agent 写进 manifest 的 `files` 可能是 `../../etc/passwd`。→ Task 6
4. **CRLF 行尾与空文件**——hunk 的行号必须对得上原文的切片，否则改错地方。→ Task 2
5. **agent 写了文件却没写进清单，或清单报了文件却不存在**——两种不一致都要有确定行为。→ Task 6

---

### Task 1: 共享数据契约

**Files:**

- Create: `src/shared/refactor/refactor-types.ts`
- Create: `src/shared/refactor/refactor-manifest.ts`
- Create: `src/shared/rpc-contract/refactor-params.ts`
- Test: `src/shared/refactor/refactor-types.test.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  - `src/shared/refactor/refactor-types.ts` 导出 zod 与同名推断类型：
    - `RefactorHunk`：`{ id: string; originalStartLine: number; originalLineCount: number; modifiedStartLine: number; modifiedLineCount: number; originalText: string; modifiedText: string }`，行号 `positive()`、行数 `nonnegative()`
    - `RefactorFileProposal`：`{ path: string; originalContent: string; hunks: RefactorHunk[] }`
    - `RefactorProposal`：`{ id: string; title: string; rationale: string; files: RefactorFileProposal[] }`
    - `RefactorPlan`：`{ jobId: string; sourcePath: string; proposals: RefactorProposal[] }`
    - `rationale` 允许空串——agent 没给理由时是降级状态，界面据此显示"未给出理由"。
  - `src/shared/refactor/refactor-manifest.ts` 导出 `RefactorManifest`：`{ proposals: RefactorManifestProposal[] }`；`RefactorManifestProposal`：`{ id: string; title: string; rationale: string; files: string[] }`，`files` 是**相对工作区根**的路径。
  - `src/shared/rpc-contract/refactor-params.ts` 导出：
    - `RefactorProposeParams`：`{ worktree: string; relativePath: string; content: string; instruction?: string }`
    - `RefactorProposeResult`：`{ jobId: string }`
    - `RefactorJobIdParams`：`{ jobId: string }`
    - `RefactorStatusResult`：`{ state: 'running' | 'done' | 'failed' | 'cancelled'; progress: string; warnings: string[] }`
    - `RefactorPlanResult`：`{ plan: RefactorPlan | null }`
    - `RefactorApplyParams`：`{ jobId: string; acceptedHunkIds: string[] }`
    - `RefactorApplyResult`：`{ applied: { path: string; hunksApplied: number }[] }`
    - `RefactorDiscardResult`：`{ discarded: boolean }`

- [ ] **Step 1: 写失败的测试**

在 `src/shared/refactor/refactor-types.test.ts` 里用 vitest：

```ts
import { describe, expect, it } from 'vitest'
import { RefactorPlan } from './refactor-types'
import { RefactorManifest } from './refactor-manifest'

describe('RefactorPlan', () => {
  it('parses a plan with one proposal and one hunk', () => {
    const parsed = RefactorPlan.safeParse({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: '提取参数校验',
          rationale: '两处校验规则相同。',
          files: [
            {
              path: 'src/foo.ts',
              originalContent: 'if (!u.id) throw new Error()\n',
              hunks: [
                {
                  id: 'h1',
                  originalStartLine: 1,
                  originalLineCount: 1,
                  modifiedStartLine: 1,
                  modifiedLineCount: 1,
                  originalText: 'if (!u.id) throw new Error()\n',
                  modifiedText: 'assertUser(u)\n'
                }
              ]
            }
          ]
        }
      ]
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a hunk whose original line count is negative', () => {
    const parsed = RefactorPlan.safeParse({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: 't',
          rationale: 'r',
          files: [
            {
              path: 'src/foo.ts',
              originalContent: '',
              hunks: [
                {
                  id: 'h1',
                  originalStartLine: 1,
                  originalLineCount: -1,
                  modifiedStartLine: 1,
                  modifiedLineCount: 1,
                  originalText: '',
                  modifiedText: 'x'
                }
              ]
            }
          ]
        }
      ]
    })
    expect(parsed.success).toBe(false)
  })
})

describe('RefactorManifest', () => {
  it('accepts a proposal whose rationale is empty', () => {
    const parsed = RefactorManifest.safeParse({
      proposals: [{ id: 'p1', title: 't', rationale: '', files: ['src/foo.ts'] }]
    })
    expect(parsed.success).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/shared/refactor/refactor-types.test.ts --maxWorkers=2`
Expected: FAIL，报模块 `./refactor-types` 不存在。

- [ ] **Step 3: 实现契约**

在 `src/shared/refactor/refactor-types.ts` 写四个 zod 对象并导出同名 `z.infer` 类型。`rationale` 用 `z.string()`（允许空），`id` / `title` / `path` / `jobId` 用 `z.string().min(1)`。

在 `src/shared/refactor/refactor-manifest.ts` 写 `RefactorManifestProposal` 与 `RefactorManifest`，`files` 用 `z.array(z.string().min(1))`。

在 `src/shared/rpc-contract/refactor-params.ts` 写上面列出的**八个** schema 与类型。`RefactorProposeParams` 的 `worktree` 用 `z.string().min(1)`。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/shared/refactor/refactor-types.test.ts --maxWorkers=2`
Expected: PASS，3 个用例全过。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:node`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/shared/refactor src/shared/rpc-contract/refactor-params.ts
git commit -m "feat(refactor): define the shared refactoring contracts"
```

---

### Task 2: hunk 计算与应用

**Files:**

- Create: `src/shared/refactor/refactor-hunk-computation.ts`
- Create: `src/shared/refactor/refactor-hunk-application.ts`
- Test: `src/shared/refactor/refactor-hunk-computation.test.ts`
- Test: `src/shared/refactor/refactor-hunk-application.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `RefactorHunk` 类型
- Produces:
  - `computeRefactorHunks(original: string, modified: string): RefactorHunk[]` —— 位于 `refactor-hunk-computation.ts`
  - `applyRefactorHunks(original: string, hunks: readonly RefactorHunk[]): string` —— 位于 `refactor-hunk-application.ts`
  - hunk 的 `id` 形如 `h1`、`h2`，按 `originalStartLine` 升序编号。

- [ ] **Step 1: 写失败的测试**

`refactor-hunk-computation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { computeRefactorHunks } from './refactor-hunk-computation'

describe('computeRefactorHunks', () => {
  it('reports a pure insertion as one hunk that covers no original line', () => {
    const hunks = computeRefactorHunks('a\n', 'a\nb\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].originalStartLine).toBe(2)
    expect(hunks[0].originalLineCount).toBe(0)
    expect(hunks[0].modifiedText).toBe('b\n')
  })

  it('merges a removal and the replacement that follows it into one hunk', () => {
    const hunks = computeRefactorHunks('a\n', 'b\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].originalLineCount).toBe(1)
    expect(hunks[0].originalText).toBe('a\n')
    expect(hunks[0].modifiedText).toBe('b\n')
  })

  it('keeps two changes separated by an unchanged line in two hunks', () => {
    const hunks = computeRefactorHunks('a\nb\nc\n', 'A\nb\nC\n')
    expect(hunks).toHaveLength(2)
    expect(hunks.map((hunk) => hunk.originalStartLine)).toEqual([1, 3])
  })

  it('counts CRLF line endings as part of the line', () => {
    const hunks = computeRefactorHunks('a\r\nb\r\n', 'a\r\nB\r\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].originalStartLine).toBe(2)
    expect(hunks[0].originalText).toBe('b\r\n')
  })

  it('reports no hunk for identical text', () => {
    expect(computeRefactorHunks('a\n', 'a\n')).toEqual([])
  })
})
```

`refactor-hunk-application.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { computeRefactorHunks } from './refactor-hunk-computation'
import { applyRefactorHunks } from './refactor-hunk-application'

describe('applyRefactorHunks', () => {
  it('applies only the accepted hunk', () => {
    const original = 'a\nb\nc\n'
    const hunks = computeRefactorHunks(original, 'A\nb\nC\n')
    expect(applyRefactorHunks(original, [hunks[0]])).toBe('A\nb\nc\n')
  })

  it('reproduces the modified text when every hunk is applied', () => {
    const original = 'a\nb\nc\n'
    const modified = 'A\nb\nC\n'
    const hunks = computeRefactorHunks(original, modified)
    expect(applyRefactorHunks(original, hunks)).toBe(modified)
  })

  it('keeps the later hunk correct when an earlier one is applied too', () => {
    const original = 'a\nb\nc\nd\n'
    const modified = 'A\nb\nC\nd\n'
    const hunks = computeRefactorHunks(original, modified)
    expect(applyRefactorHunks(original, hunks)).toBe(modified)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/shared/refactor --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现 hunk 计算**

在 `refactor-hunk-computation.ts` 用 `diff` 包的 `diffLines`：

```ts
import { diffLines } from 'diff'
import type { RefactorHunk } from './refactor-types'
```

算法：`diffLines(original, modified)` 给出变更序列；把**相邻的变更段合并成一个变更组**（removed 后面紧跟 added 属于同一组）。遍历时维护 `originalLine` 与 `modifiedLine` 两个 1-based 的"下一个行号"计数器，每遇一段未变更内容两个计数器各前进该段的行数。变更组开始时记下 `originalStartLine` 与 `modifiedStartLine`；组内 removed 段累加 `originalLineCount`、added 段累加 `modifiedLineCount`；`originalText` 是组内 removed 段文本的拼接，`modifiedText` 是组内 added 段文本的拼接。

相邻合并是必须的：`diffLines` 把"删一段 + 加一段"报成两段变更，若不合并，"接受其一"会产出坏代码。

注意 `diffLines` 的每段文本自带行尾，行数用该段文本按 `\n` 切分的长度计算（末尾多出的空元素不计）。

- [ ] **Step 4: 实现 hunk 应用**

在 `refactor-hunk-application.ts`：

把被接受的 hunk 按 `originalStartLine` **降序**排序，然后依次把原文的 `[originalStartLine, originalStartLine + originalLineCount)` 区间替换成 `modifiedText`。降序保证前面 hunk 的行号不因后面的替换而偏移。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/shared/refactor --maxWorkers=2`
Expected: PASS，全部用例通过。

- [ ] **Step 6: 类型检查与提交**

```bash
pnpm tc:node
git add src/shared/refactor
git commit -m "feat(refactor): compute and apply the refactoring hunks"
```

---

### Task 3: 写闸门

**Files:**

- Create: `src/main/refactor/refactor-write-gate.ts`
- Test: `src/main/refactor/refactor-write-gate.test.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  - `isPathInsideScratch(scratchRoot: string, targetPath: string): boolean`
  - `refactorToolAllowed(input: { toolName: string; toolInput: Record<string, unknown>; scratchRoot: string; workspaceRoot: string }): boolean`
  - `refactorToolTargetPath(toolInput: Record<string, unknown>): string | null` —— 从工具入参里取路径，依次尝试 `file_path`、`filePath`、`path`，都没有则返回 `null`。

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-write-gate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { isPathInsideScratch, refactorToolAllowed } from './refactor-write-gate'

const workspaceRoot = '/repo'
const scratchRoot = '/repo/.orca/refactor/job-1'

describe('isPathInsideScratch', () => {
  it('accepts a path inside the scratch root', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/p1/src/foo.ts')).toBe(true)
  })

  it('rejects a path that climbs out with ..', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/../../evil.ts')).toBe(false)
  })

  it('rejects an absolute path outside the scratch root', () => {
    expect(isPathInsideScratch(scratchRoot, '/etc/passwd')).toBe(false)
  })

  it('rejects a sibling directory that shares the prefix', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1x/p1/foo.ts')).toBe(false)
  })
})

describe('refactorToolAllowed', () => {
  it('allows reading', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('allows writing inside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies writing outside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a write whose input carries no path', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { content: 'x' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a shell', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Bash',
        toolInput: { command: 'cp a b' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('resolves a relative write path against the workspace root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-write-gate.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现闸门**

在 `refactor-write-gate.ts`：

- `refactorToolTargetPath` 依次读 `file_path`、`filePath`、`path`，取第一个**非空字符串**；都没有返回 `null`。
- `isPathInsideScratch(scratchRoot, targetPath)`：用 `path.resolve` 把两边都规约成绝对路径（`scratchRoot` 本身已是绝对路径），然后判断 `resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)`。**比较区分大小写**——大小写不敏感的文件系统上这会拒掉一个大小写不同的合法路径，那是安全的方向；agent 总是用 prompt 里给的原样路径写。
- `refactorToolAllowed`：
  - `toolName` 是 `Read` / `Grep` / `Glob` → 允许。
  - `toolName` 是 `Write` / `Edit` → 取路径；取不到就**拒绝**（fail-closed）；取到就 `path.resolve(workspaceRoot, target)`（相对路径按工作区根解析）后交给 `isPathInsideScratch`。
  - 其它工具名 → **拒绝**。`Bash` 必须在拒绝名单里，否则 agent 能用 `mv` 绕过写闸门。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-write-gate.test.ts --maxWorkers=2`
Expected: PASS，9 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/main/refactor/refactor-write-gate.ts src/main/refactor/refactor-write-gate.test.ts
git commit -m "feat(refactor): keep the agent's writes inside the scratch directory"
```

---

### Task 4: agent 启动参数

**Files:**

- Create: `src/main/refactor/refactor-agent-launch.ts`
- Modify: `src/main/claude/structured/launch/claude-structured-launch-resolution.ts`（给 `ClaudeStructuredSdkOptions` 的 Pick 加上 `allowedTools` 与 `disallowedTools`）
- Test: `src/main/refactor/refactor-agent-launch.test.ts`

**Interfaces:**

- Consumes: `resolveClaudeStructuredInvocation`（`src/main/claude/structured/launch/claude-structured-launch-resolution.ts`）、`CLAUDE_STRUCTURED_BASE_OPTIONS`（同一文件）
- Produces:
  - `RefactorAgentLaunch`：`{ pathToClaudeCodeExecutable: string; prefixArgs?: readonly string[]; env: Record<string, string>; cwd: string; options: ClaudeStructuredSdkOptions }`
  - `resolveRefactorAgentLaunch(input: { cwd: string; deps: ClaudeEnvDeps & { resolveAuthPolicy: () => Promise<ClaudeStructuredAuthPolicy> | ClaudeStructuredAuthPolicy }; signal?: AbortSignal }): Promise<RefactorAgentLaunch>`
  - `REFACTOR_ALLOWED_TOOLS`：`readonly string[]` = `['Read', 'Grep', 'Glob', 'Write', 'Edit']`

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-agent-launch.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { REFACTOR_ALLOWED_TOOLS, resolveRefactorAgentLaunch } from './refactor-agent-launch'

describe('resolveRefactorAgentLaunch', () => {
  it('runs the agent in the workspace with only read and write tools', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    expect(launch.cwd).toBe('/repo')
    expect(launch.pathToClaudeCodeExecutable).toBe('/usr/bin/claude')
    expect(launch.options.permissionMode).toBe('default')
    expect(launch.options.allowedTools).toEqual(REFACTOR_ALLOWED_TOOLS)
    expect(launch.options.extraArgs?.['dangerously-skip-permissions']).toBeUndefined()
  })
})
```

若 `resolveCommand` 的实际返回形状与这里不同，以 `ClaudeEnvDeps['resolveCommand']` 的定义为准（`StructuredAgentCommand`），测试按真实形状写。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-agent-launch.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 加上 SDK 选项字段**

在 `claude-structured-launch-resolution.ts` 的 `ClaudeStructuredSdkOptions` 的 Pick 列表里加 `'allowedTools'` 与 `'disallowedTools'`（SDK 的 `Options` 上有这两个字段）。

- [ ] **Step 4: 实现启动解析**

在 `refactor-agent-launch.ts`：

```ts
export const REFACTOR_ALLOWED_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'Write', 'Edit']
```

`resolveRefactorAgentLaunch` 调 `resolveClaudeStructuredInvocation(deps)` 拿到 `{ command, prefixArgs, env, account }`，然后返回：

- `pathToClaudeCodeExecutable: invocation.command`
- `prefixArgs: invocation.prefixArgs`
- `env: invocation.env`
- `cwd: input.cwd`
- `options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, permissionMode: 'default', allowedTools: [...REFACTOR_ALLOWED_TOOLS] }`

`CLAUDE_STRUCTURED_BASE_OPTIONS` 的 `systemPrompt` 保持 `'claude_code'` 预设。**不要**加 `extraArgs['dangerously-skip-permissions']`——那是 full-access。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-agent-launch.test.ts --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查与提交**

```bash
pnpm tc:node
git add src/main/refactor src/main/claude/structured/launch/claude-structured-launch-resolution.ts
git commit -m "feat(refactor): launch the refactoring agent without full access"
```

---

### Task 5: agent runner

**Files:**

- Create: `src/main/refactor/refactor-runner.ts`
- Create: `src/shared/refactor/refactor-prompt.ts`
- Test: `src/main/refactor/refactor-runner.test.ts`

**Interfaces:**

- Consumes: Task 4 的 `RefactorAgentLaunch`；Task 3 的 `refactorToolAllowed`；`openClaudeStreamJsonConnection`（`src/main/claude/claude-stream-json-connection.ts`）；`CanUseTool` / `PermissionResult`（SDK）
- Produces:
  - `src/shared/refactor/refactor-prompt.ts` 导出 `buildRefactorPrompt(input: { relativePath: string; sourceRelativePath: string; scratchRelativeRoot: string; instruction?: string }): { system: string; user: string }`
  - `src/main/refactor/refactor-runner.ts` 导出：
    - `RefactorTurnResult`：`{ manifest: RefactorManifest | null; progress: string; warnings: string[] }`
    - `runRefactorTurn(input: { launch: RefactorAgentLaunch; scratchRoot: string; workspaceRoot: string; prompt: { system: string; user: string }; onProgress?: (text: string) => void; signal: AbortSignal }): Promise<RefactorTurnResult>`
    - `parseRefactorToolProgress(message: Record<string, unknown>): string | null` —— 从一条 SDK 消息里抽出进度文案；没有工具调用时返回 `null`。单独导出是为了能脱开 SDK 单测。
    - `REFACTOR_TURN_TIMEOUT_MS = 300_000`

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-runner.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseRefactorToolProgress } from './refactor-runner'
import { buildRefactorPrompt } from '../../shared/refactor/refactor-prompt'

describe('buildRefactorPrompt', () => {
  const prompt = buildRefactorPrompt({
    relativePath: 'src/foo.ts',
    sourceRelativePath: '_source/src/foo.ts',
    scratchRelativeRoot: '.orca/refactor/job-1',
    instruction: '把重复的校验提出来'
  })

  it('names the scratch directory the agent may write to', () => {
    expect(prompt.system).toContain('.orca/refactor/job-1')
  })

  it('tells the agent the source copy outranks the file on disk', () => {
    expect(prompt.system).toContain('_source/src/foo.ts')
  })

  it('requires the manifest to be written', () => {
    expect(prompt.system).toContain('manifest.json')
  })

  it('carries the user instruction into the prompt', () => {
    expect(prompt.user).toContain('把重复的校验提出来')
  })
})

describe('parseRefactorToolProgress', () => {
  it('names the file a write tool is writing', () => {
    const text = parseRefactorToolProgress({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Write',
            input: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }
          }
        ]
      }
    })
    expect(text).toContain('src/foo.ts')
  })

  it('returns null for a message with no tool use', () => {
    expect(
      parseRefactorToolProgress({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] }
      })
    ).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-runner.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 写 prompt 构造器**

在 `src/shared/refactor/refactor-prompt.ts`：

`buildRefactorPrompt` 返回两段文本。system 段必须写明：

- 你的任务是对一个文件提出重构建议。
- 目标文件的当前内容以 `_source/<相对路径>` 为准（用户可能有未保存修改，那个副本才是权威内容）；磁盘上的版本可能过期。
- 你**只能读**工作区，**只能写** `<scratchRelativeRoot>/` 目录下的文件。
- 每个方案一个子目录：`<scratchRelativeRoot>/<proposalId>/<相对路径>`。
- 必须把方案索引写到 `<scratchRelativeRoot>/manifest.json`，形状是
  `{"proposals":[{"id":"p1","title":"…","rationale":"…","files":["src/foo.ts"]}]}`。
- `rationale` 说清**为什么**这么改，不是改了什么。
- 最多 5 个方案，每个方案最多 5 个文件；两个方案不能改同一个文件。
- **不要**在回答里贴文件内容或 JSON，一切通过写文件产出。

user 段包含目标文件的相对路径、暂存根的相对路径、用户的可选指令原文。

- [ ] **Step 4: 实现 runner**

在 `refactor-runner.ts`：

- `parseRefactorToolProgress(message: Record<string, unknown>): string | null` —— 从 SDK 消息里找 `message.content` 数组中的 `type === 'tool_use'` 的块，用 `name` 与 `input` 拼一句中文进度：
  - `Write` / `Edit` → `正在写入 <相对路径>`
  - `Read` → `正在读取 <相对路径>`
  - 其它工具名 → `正在使用 <name>`
  - 路径取 `input.file_path`，相对路径用 `path.relative(workspaceRoot, p)`；取不到就只用工具名。
  - 没有 tool_use 就返回 `null`。

- `runRefactorTurn`：
  1. 用 `openClaudeStreamJsonConnection` 建立连接，`cwd: launch.cwd`，`options: launch.options`，`env: launch.env`。
  2. `canUseTool` 回调：调用 `refactorToolAllowed({ toolName, toolInput: input, scratchRoot, workspaceRoot })`，允许返回 `{ behavior: 'allow' }`，拒绝返回 `{ behavior: 'deny', message: '该工具在此任务中不可用。' }`。
  3. 发送 prompt：把 system 与 user 两段合成一条 SDK 用户消息帧，用 `connection.send(frame)` 投出去。帧的形状照 `src/main/claude/structured/claude-structured-dispatch.ts` 里已有的那条：
     ```ts
     {
       type: 'user',
       uuid: crypto.randomUUID(),
       message: { role: 'user', content: `${system}\n\n${user}` },
       parent_tool_use_id: null,
       session_id: crypto.randomUUID()
     }
     ```
     system 与 user 合成一条，是因为 SDK 的用户消息只有 `content` 一个入口；两段之间用一个空行分隔。
  4. 监听 SDK 消息：收到 `tool_use` 就更新进度并 `onProgress?.(text)`；收到 `type === 'result'` 就结束等待。
  5. 结束后读 `<scratchRoot>/manifest.json`，用 `RefactorManifest.safeParse` 解析；解析失败返回 `manifest: null` 并在 `warnings` 里写明原因。
  6. 超时：`REFACTOR_TURN_TIMEOUT_MS = 300_000`（5 分钟）。到点中止并关连接。
  7. `signal` 触发时同样中止并关连接，返回 `warnings: ['任务已取消']`。
  8. 无论成功失败都要关闭连接（`close()` 走现成的退出证明 ladder）。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-runner.test.ts --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查与提交**

```bash
pnpm tc:node
git add src/main/refactor src/shared/refactor/refactor-prompt.ts
git commit -m "feat(refactor): drive the agent turn that writes the refactored files"
```

---

### Task 6: plan builder

**Files:**

- Create: `src/main/refactor/refactor-plan-builder.ts`
- Test: `src/main/refactor/refactor-plan-builder.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `RefactorPlan` / `RefactorManifest` / `RefactorHunk`；Task 2 的 `computeRefactorHunks`
- Produces:
  - `buildRefactorPlan(input: { jobId: string; sourcePath: string; manifest: RefactorManifest | null; scratchRoot: string; workspaceRoot: string; readBaseline: (relativePath: string) => Promise<string | null>; readDiskContent: (relativePath: string) => Promise<string | null>; scratchFiles: (proposalId: string, relativePath: string) => Promise<string | null> }): Promise<{ plan: RefactorPlan; warnings: string[]; diskContents: Map<string, string> }>`
  - `diskContents` 是每个文件在**建 plan 那一刻**的磁盘内容（D）。它不进 plan（plan 只带渲染 diff 用的基准文本 B），由 job 留在主进程侧，供接受时做陈旧判定。
  - `isSafeRelativeRefactorPath(relativePath: string): boolean` —— 清单里的路径必须在工作区内。

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-plan-builder.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildRefactorPlan, isSafeRelativeRefactorPath } from './refactor-plan-builder'

const workspaceRoot = '/repo'
const scratchRoot = '/repo/.orca/refactor/job-1'

describe('isSafeRelativeRefactorPath', () => {
  it('accepts a plain relative path', () => {
    expect(isSafeRelativeRefactorPath('src/foo.ts')).toBe(true)
  })

  it('rejects a path that climbs out of the workspace', () => {
    expect(isSafeRelativeRefactorPath('../../etc/passwd')).toBe(false)
  })

  it('rejects an absolute path', () => {
    expect(isSafeRelativeRefactorPath('/etc/passwd')).toBe(false)
  })
})

describe('buildRefactorPlan', () => {
  it('builds a plan with hunks against the baseline', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: '提取校验', rationale: '重复。', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.plan.proposals).toHaveLength(1)
    expect(result.plan.proposals[0].files[0].hunks).toHaveLength(1)
    expect(result.plan.proposals[0].files[0].originalContent).toBe('a\nb\n')
  })

  it('drops a proposal whose path escapes the workspace', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 't', rationale: 'r', files: ['../../etc/passwd'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('drops the later proposal when two proposals touch the same file', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] },
          { id: 'p2', title: 'b', rationale: 'r', files: ['src/foo.ts'] }
        ]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('keeps a proposal whose scratch file is missing but marks the warning', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      scratchFiles: async () => null
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('rebuilds the proposal list from the scratch tree when the manifest is missing', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: null,
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.length).toBeGreaterThan(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-plan-builder.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现 plan builder**

在 `refactor-plan-builder.ts`：

- `isSafeRelativeRefactorPath(relativePath)`：拒绝绝对路径（`path.isAbsolute`）、拒绝任何一段为 `..` 的路径（按 `/` 和 `\` 两种分隔符切分后检查）、拒绝空串。
- `buildRefactorPlan`：
  1. 遍历 manifest 的 proposals，维护一个 `claimedPaths: Set<string>`。
  2. 每个 proposal 的每个 file：先过 `isSafeRelativeRefactorPath`，不过就记 warning 并跳过整个 proposal。
  3. 读暂存文件 `scratchFiles(proposal.id, path)`；读不到（`null`）就记 warning 并跳过整个 proposal。
  4. 读基准文本 `readBaseline(path)`；读不到就记 warning 并跳过整个 proposal。
  5. 读磁盘内容 `readDiskContent(path)`，存进 `diskContents`（path → D）。读不到就记 warning 并跳过整个 proposal。
  6. 若 `claimedPaths` 已含该 path，记 warning（"方案 X 与方案 Y 改同一个文件，已丢弃后者"）并跳过整个 proposal。
  7. 否则 `claimedPaths.add(path)`，用 `computeRefactorHunks(baseline, scratchContent)` 算出 hunks，把 `{ path, originalContent: baseline, hunks }` 放进 proposal 的 `files`。
  8. **空 hunks 的方案也要保留**——内容没变的方案不是错误，只是没有可接受的东西。
  9. manifest 为 `null` 时：扫 `scratchRoot` 下的一级子目录当作 proposalId，每个子目录里的文件当作它的 files，`title` 用子目录名，`rationale` 留空串，并在 warnings 里写"agent 未给出理由"。
  10. 返回 `{ plan: { jobId, sourcePath, proposals }, warnings, diskContents }`。

**基准文本 B 与磁盘内容 D 是两回事**：B 是用户眼前（编辑器缓冲区）的内容，D 是磁盘上的内容。用户有未保存修改时 B ≠ D。`diskContents` 里的 D 只给接受时的陈旧判定用，不进 plan。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-plan-builder.test.ts --maxWorkers=2`
Expected: PASS，7 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/main/refactor/refactor-plan-builder.ts src/main/refactor/refactor-plan-builder.test.ts
git commit -m "feat(refactor): assemble the plan from the scratch files"
```

---

### Task 7: job 注册表

**Files:**

- Create: `src/main/refactor/refactor-job-registry.ts`
- Test: `src/main/refactor/refactor-job-registry.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `RefactorStatusResult` 的 `state` 取值
- Produces:
  - `RefactorJob`：`{ jobId: string; state: 'running' | 'done' | 'failed' | 'cancelled'; progress: string; warnings: string[]; plan: RefactorPlan | null; diskContents: Map<string, string>; baselines: Map<string, string>; worktree: string; controller: AbortController; scratchRoot: string }`
    - `baselines` 是每个文件的**基准文本 B**（目标文件是编辑器缓冲区，其余文件是当时的磁盘内容）。
    - `diskContents` 是每个文件在**建 plan 那一刻**的磁盘内容 D，供接受时做陈旧判定。
    - `worktree` 是原始的 worktree 选择器字符串，写回时要用。
  - `createRefactorJobRegistry()`：
    - `create(input: { jobId: string; scratchRoot: string; worktree: string }): RefactorJob`
    - `get(jobId: string): RefactorJob | null`
    - `update(jobId: string, patch: Partial<Pick<RefactorJob, 'state' | 'progress' | 'warnings' | 'plan' | 'diskContents'>>): void`
    - `remove(jobId: string): void`

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-job-registry.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createRefactorJobRegistry } from './refactor-job-registry'

describe('the refactor job registry', () => {
  it('starts a job in the running state', () => {
    const registry = createRefactorJobRegistry()
    const job = registry.create({
      jobId: 'job-1',
      scratchRoot: '/repo/.orca/refactor/job-1',
      worktree: 'wt-1'
    })
    expect(job.state).toBe('running')
    expect(registry.get('job-1')).toBe(job)
  })

  it('updates the progress and the warnings', () => {
    const registry = createRefactorJobRegistry()
    registry.create({ jobId: 'job-1', scratchRoot: '/repo/.orca/refactor/job-1' })
    registry.update('job-1', { progress: '正在读取 src/foo.ts', warnings: ['w'] })
    expect(registry.get('job-1')?.progress).toBe('正在读取 src/foo.ts')
    expect(registry.get('job-1')?.warnings).toEqual(['w'])
  })

  it('returns null for an unknown job', () => {
    expect(createRefactorJobRegistry().get('nope')).toBeNull()
  })

  it('removes a job', () => {
    const registry = createRefactorJobRegistry()
    registry.create({ jobId: 'job-1', scratchRoot: '/x', worktree: 'wt-1' })
    registry.remove('job-1')
    expect(registry.get('job-1')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-job-registry.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现注册表**

在 `refactor-job-registry.ts` 用一个 `Map<string, RefactorJob>`。`create` 造一个 `new AbortController()` 挂上。`update` 合并字段（`warnings` 整体替换，不追加）。`remove` 从 map 删掉。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-job-registry.test.ts --maxWorkers=2`
Expected: PASS，4 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/main/refactor/refactor-job-registry.ts src/main/refactor/refactor-job-registry.test.ts
git commit -m "feat(refactor): track the refactoring jobs"
```

---

### Task 8: RPC 方法与落地

**Files:**

- Create: `src/main/runtime/rpc/methods/refactor/refactor-methods.ts`
- Create: `src/main/refactor/refactor-apply.ts`
- Create: `src/main/refactor/refactor-scratch.ts`
- Modify: `src/main/runtime/rpc/methods/rpc-method-registry.ts`
- Test: `src/main/refactor/refactor-apply.test.ts`

**Interfaces:**

- Consumes: Task 1 的全部 RPC 参数与结果 schema；Task 5 的 `runRefactorTurn` 与 `buildRefactorPrompt`；Task 6 的 `buildRefactorPlan`；Task 7 的注册表；Task 2 的 `applyRefactorHunks`
- Produces:
  - `REFACTOR_METHODS`：注册 5 个方法 `refactor.propose` / `refactor.status` / `refactor.plan` / `refactor.apply` / `refactor.discard`，`permission: 'workspace'`
  - `src/main/refactor/refactor-apply.ts` 导出 `applyRefactorSelection(input: { plan: RefactorPlan; diskContents: ReadonlyMap<string, string>; acceptedHunkIds: readonly string[]; readCurrent: (path: string) => Promise<string | null>; write: (path: string, content: string, precondition: { expectedSignature: string; allowMissing: boolean }) => Promise<boolean> }): Promise<{ applied: { path: string; hunksApplied: number }[]; refusals: { path: string; reason: string }[] }>`
  - `src/main/refactor/refactor-scratch.ts` 导出 `refactorScratchRoot(workspaceRoot: string, jobId: string): string` 与 `refactorScratchRelativeRoot(jobId: string): string`（`.orca/refactor/<jobId>`）

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-apply.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { applyRefactorSelection } from './refactor-apply'
import { computeRefactorHunks } from '../../shared/refactor/refactor-hunk-computation'

const original = 'a\nb\nc\n'
const modified = 'A\nb\nC\n'
const hunks = computeRefactorHunks(original, modified)

const plan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: 't',
      rationale: 'r',
      files: [{ path: 'src/foo.ts', originalContent: original, hunks }]
    }
  ]
}

describe('applyRefactorSelection', () => {
  it('writes the file when the accepted hunk matches the current content', async () => {
    const writes: { path: string; content: string }[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => original,
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes).toEqual([{ path: 'src/foo.ts', content: 'A\nb\nc\n' }])
    expect(result.applied).toEqual([{ path: 'src/foo.ts', hunksApplied: 1 }])
  })

  it('writes the file when the disk still holds the content the plan was built against', async () => {
    // 缓冲区有未保存修改：基准文本 B 与磁盘内容 D 不同，但磁盘没被人动过。
    const writes: { path: string; content: string }[] = []
    await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', 'disk\n']]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => 'disk\n',
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes).toHaveLength(1)
  })

  it('writes the file when the user saved the buffer during the review', async () => {
    const writes: { path: string; content: string }[] = []
    await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', 'disk\n']]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => original,
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes).toHaveLength(1)
  })

  it('refuses to write when the file changed since the plan was built', async () => {
    const writes: string[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => 'a\nCHANGED\nc\n',
      write: async (path) => {
        writes.push(path)
        return true
      }
    })
    expect(writes).toEqual([])
    expect(result.refusals.length).toBe(1)
  })

  it('applies only the accepted hunks of a file', async () => {
    const writes: { path: string; content: string }[] = []
    await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[1].id],
      readCurrent: async () => original,
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes[0].content).toBe('a\nb\nC\n')
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-apply.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现落地逻辑**

在 `refactor-apply.ts`：

1. 把 `acceptedHunkIds` 收成 `Set`。
2. 按文件分组：遍历 plan 的每个 proposal 的每个 file，收集该文件里**被接受**的 hunk。
3. 没有被接受的 hunk 的文件跳过。
4. 对每个要写的文件：
   - `current = await readCurrent(path)`；读不到（`null`）→ 记 refusal"文件已被删除"，跳过。
   - **陈旧判定**：`disk = diskContents.get(path)`。当 `current !== disk` **且** `current !== file.originalContent` 时 → 记 refusal"文件在评审期间被改动过，请重新生成重构建议"，跳过。
     两条都放行，是因为磁盘上可能仍是建 plan 时的内容（用户没存盘），也可能已经变成用户存盘的基准文本（用户存了盘）。只有两者都不符才说明有人真的改过它。
   - `newContent = applyRefactorHunks(file.originalContent, acceptedHunks)`。**用基准文本算，不是用 `current`**——diff 是对着基准文本的，重构结果也必须从基准文本算起。
   - `await write(path, newContent, precondition)`；写失败记 refusal"写入失败"。
5. 返回 `{ applied, refusals }`。

precondition 用 `FileWriteDiskPreconditionParam` 的形状：`{ expectedSignature, allowMissing }`。`expectedSignature` 取当前磁盘内容的签名——用 `src/main/filesystem/file-stat-signature.ts` 里现成的签名函数，具体导出名以该文件为准。

**写盘会连带保存用户的未保存修改**：因为 `newContent` 是从基准文本 B 算出来的，而 B 含用户那些还没存盘的编辑。这不是副作用而是语义的一部分（重构基于用户眼前的内容，落盘理应包含它），但界面必须写明这一点。

- [ ] **Step 4: 实现 RPC 方法**

在 `src/main/runtime/rpc/methods/refactor/refactor-methods.ts` 用 `defineMethod`（从 `'../../core'` 导入）注册 5 个方法：

- `refactor.propose`：
  1. `const target = await runtime.resolveRuntimeFileTarget(params.worktree)` → `target.worktree.path` 是工作区绝对路径。
  2. `jobId` 用 `crypto.randomUUID()`。
  3. `scratchRoot = refactorScratchRoot(target.worktree.path, jobId)`，用 `fs.mkdir(scratchRoot, { recursive: true })` 建出来。
  4. 写基准副本：`fs.writeFile(path.join(scratchRoot, '_source', params.relativePath), params.content)`，父目录先 `mkdir recursive`。
  5. 把目标文件的**基准文本**记进 job：`baselines.set(params.relativePath, params.content)`。其它文件的基准文本就是它们当时的磁盘内容。
  6. 把 `.orca/refactor/` 加进工作区的 `.git/info/exclude`（见下面「暂存目录不进版本库」）。
  7. 清理过期暂存目录（见下面「暂存目录清理」）。
  8. 建 job（Task 7 的注册表），**立刻返回** `{ jobId }`。
  9. 后台异步跑：解析 agent 启动（Task 4）→ 跑 turn（Task 5）→ 建 plan（Task 6）→ `update` job 的 `state: 'done'`、`plan` 与 `diskContents`。
     建 plan 时传的 `readBaseline` 是 `(path) => baselines.get(path) ?? 磁盘内容`——目标文件用用户眼前的缓冲区内容，其余文件用当时的磁盘内容。`readDiskContent` 是 `(path) => 磁盘内容`。
  10. 失败时 `update` 成 `state: 'failed'` 并把原因写进 `warnings`。抛错时 `state: 'failed'`。
  11. 每一步都要尊重 job 的 `controller.signal`。

- `refactor.status`：从注册表取 job，返回 `{ state, progress, warnings }`。job 不存在时返回 `{ state: 'failed', progress: '', warnings: ['任务不存在'] }`。

- `refactor.plan`：从注册表取 job，返回 `{ plan: job.plan }`。

- `refactor.apply`：从注册表取 job（没有 plan 就返回空 applied），调 `applyRefactorSelection`，把 job 上的 `diskContents` 传进去。写回用 `runtime.writeFileExplorerFile(worktree, relativePath, content, ...sshArgs, diskPrecondition)`。`worktree` 用 job 上存的原始 `worktree` 选择器字符串。

- `refactor.discard`：job 还在 running 就 `controller.abort()`；然后删掉 `scratchRoot` 目录（`fs.rm(scratchRoot, { recursive: true, force: true })`），从注册表 `remove`，返回 `{ discarded: true }`。

**暂存目录不进版本库**：工作区是 git 仓库时，把 `.orca/refactor/` 追加到 `<worktree>/.git/info/exclude`——它只在本仓库本地生效，不动被跟踪的 `.gitignore`。已存在该行就跳过；`.git` 目录不存在（非 git 的 folder workspace）就跳过这步。

**暂存目录清理**：发起新任务时，扫 `<worktree>/.orca/refactor/` 下的子目录，把**修改时间超过一天**的删掉（`fs.readdir` + `fs.stat` + `fs.rm`）。当前 job 的目录不动。

- [ ] **Step 5: 注册方法并重新生成目录**

在 `src/main/runtime/rpc/methods/rpc-method-registry.ts` 里 import `REFACTOR_METHODS` 并展开进 `ALL_RPC_METHODS`。

然后：

```bash
pnpm generate:rpc-params-catalog
```

把生成物一起提交。

- [ ] **Step 6: 跑测试确认它通过**

Run: `pnpm test src/main/refactor --maxWorkers=2`
Expected: PASS。

- [ ] **Step 7: 类型检查与提交**

```bash
pnpm tc:node
git add src/main/refactor src/main/runtime/rpc/methods/refactor src/main/runtime/rpc/methods/rpc-method-registry.ts src/shared/rpc-contract
git commit -m "feat(refactor): expose the refactoring runtime methods"
```

---

### Task 9: 渲染层客户端与轮询

**Files:**

- Create: `src/renderer/src/components/editor/refactor/refactor-runtime-client.ts`
- Create: `src/renderer/src/components/editor/refactor/refactor-job-poller.ts`
- Test: `src/renderer/src/components/editor/refactor/refactor-job-poller.test.ts`

**Interfaces:**

- Consumes: Task 1 的 RPC 参数与结果类型；`callRuntimeRpc`（`src/renderer/src/runtime/rpc/calls/runtime-rpc-call.ts`）
- Produces:
  - `proposeRefactor(input: { worktree: string; relativePath: string; content: string; instruction?: string }): Promise<string>` —— 返回 jobId
  - `fetchRefactorStatus(jobId: string): Promise<RefactorStatusResult>`
  - `fetchRefactorPlan(jobId: string): Promise<RefactorPlan | null>`
  - `applyRefactor(jobId: string, acceptedHunkIds: readonly string[]): Promise<RefactorApplyResult>`
  - `discardRefactor(jobId: string): Promise<boolean>`
  - `pollRefactorJob(input: { jobId: string; intervalMs?: number; fetchStatus: (jobId: string) => Promise<RefactorStatusResult>; onStatus: (status: RefactorStatusResult) => void }): () => void` —— 返回一个停止函数。`fetchStatus` 是注入的，轮询器自己不碰客户端。

- [ ] **Step 1: 写失败的测试**

`refactor-job-poller.test.ts`（用 vitest 的 fake timers）：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollRefactorJob } from './refactor-job-poller'

describe('pollRefactorJob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls until the job leaves the running state', async () => {
    vi.useFakeTimers()
    const states = ['running', 'running', 'done']
    let call = 0
    const seen: string[] = []
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => ({ state: states[call++] as 'running', progress: '', warnings: [] }),
      onStatus: (status) => seen.push(status.state)
    })
    await vi.advanceTimersByTimeAsync(3500)
    stop()
    expect(seen).toEqual(['running', 'running', 'done'])
  })

  it('stops polling once the job is done', async () => {
    vi.useFakeTimers()
    let calls = 0
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => {
        calls += 1
        return { state: 'done', progress: '', warnings: [] }
      },
      onStatus: () => {}
    })
    await vi.advanceTimersByTimeAsync(5000)
    stop()
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-job-poller.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现客户端**

在 `refactor-runtime-client.ts`，照抄 `src/renderer/src/components/editor/code-completion/nes-runtime-client.ts` 的形状：

```ts
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
```

每个方法用 `callRuntimeRpc<Result>({ kind: 'local' }, 'refactor.<method>', params, { timeoutMs })`。

超时：`refactor.propose` 立刻返回，用 35s；`refactor.status` 用 35s；`refactor.plan` 用 35s；`refactor.apply` 用 60s（写盘可能慢）。

失败的处理照 NES 的做法：请求失败时 `console.error` 并把错误转成"没有结果"，不让异常冒到 UI。

- [ ] **Step 4: 实现轮询**

在 `refactor-job-poller.ts`：

```ts
export function pollRefactorJob(input: {
  jobId: string
  intervalMs?: number
  fetchStatus: (jobId: string) => Promise<RefactorStatusResult>
  onStatus: (status: RefactorStatusResult) => void
}): () => void
```

默认 `intervalMs = 1500`。第一次立即取一次；之后按间隔取。状态**不是** `'running'` 时通知一次就停。返回的停止函数清掉定时器。请求失败时停掉轮询并把失败通过 `onStatus` 报出去（`state: 'failed'`）。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-job-poller.test.ts --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查与提交**

```bash
pnpm tc:web
git add src/renderer/src/components/editor/refactor
git commit -m "feat(refactor): call the refactoring runtime from the renderer"
```

---

### Task 10: 审查 tab 的类型接线

**Files:**

- Modify: `src/renderer/src/store/slices/editor/types/open-file.ts`
- Modify: `src/shared/editor-tab-view-types.ts`
- Modify: `src/shared/tab-types.ts`
- Modify: `src/renderer/src/store/slices/editor/tabs/editor-tab-content-type.ts`
- Modify: `src/renderer/src/store/slices/editor/tabs/open-file-layout-view.ts`
- Test: `src/renderer/src/store/slices/editor/tabs/editor-tab-content-type.test.ts`（新建；若已有同名测试文件则在其中加用例）

**Interfaces:**

- Consumes: 无（tab 只存 jobId 与路径，不存 plan）
- Produces:
  - `OpenFile['mode']` 新增 `'refactor-review'`
  - `EditorTabView` 新增成员 `{ mode: 'refactor-review'; refactorReview?: { jobId: string; worktree: string; relativePath: string } }`
  - `OpenFile` 新增字段 `refactorReview?: { jobId: string; worktree: string; relativePath: string }`
  - `EditorTabContentType` 新增 `'refactor-review'`
  - `TabContentType`（`src/shared/tab-types.ts`）新增 `'refactor-review'` —— `EditorTabContentType` 由它 `Extract` 而来，不加就取不到

- [ ] **Step 1: 写失败的测试**

在 `editor-tab-content-type.test.ts`（新建）里：

```ts
import { describe, expect, it } from 'vitest'
import { editorTabContentTypeForMode, isVirtualEditorFile } from './editor-tab-content-type'

describe('the refactor review tab', () => {
  it('is its own tab content type', () => {
    expect(editorTabContentTypeForMode('refactor-review')).toBe('refactor-review')
  })

  it('is a virtual editor file, not a file on disk', () => {
    expect(isVirtualEditorFile({ mode: 'refactor-review' })).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/store/slices/editor/tabs/editor-tab-content-type.test.ts --maxWorkers=2`
Expected: FAIL（类型不匹配或断言不成立）。

- [ ] **Step 3: 接线**

- `src/shared/tab-types.ts`：**`TabContentType` 是封闭联合类型，必须先把它加上 `'refactor-review'`**。`EditorTabContentType` 是 `Extract<Tab['contentType'], …>` 算出来的，不先加这个成员，`Extract` 会静默把它丢掉，类型就废了。
- `open-file.ts`：`mode` 联合类型加 `'refactor-review'`；加 `refactorReview?: { jobId: string; worktree: string; relativePath: string }` 字段。
- `editor-tab-view-types.ts`：`EditorTabView` 联合类型加 `{ mode: 'refactor-review'; refactorReview?: { jobId: string; worktree: string; relativePath: string } }`。
- `editor-tab-content-type.ts`：`EditorTabContentType` 的 Extract 联合加 `'refactor-review'`；`isEditorTabContentType` 的判断加它；`isVirtualEditorFile` 返回 `file.mode === 'check-details' || file.mode === 'git-graph' || file.mode === 'refactor-review'`；`editorTabContentTypeForMode` 的三元链加它。
- `open-file-layout-view.ts`：`editorTabViewOf` 的 switch 加 `case 'refactor-review': return { mode: 'refactor-review', ...pickStoredFields(file, ['refactorReview']) }`。
- 新增一个 content type 后，**搜一遍把 contentType 映射成图标或标题的地方**（`grep -rn "contentType ===" src/renderer/src`），确认新成员不会渲染成空白标签。仓库里没有对 contentType 的穷尽 switch，所以不会有编译错误，但可能有显示缺口。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/store/slices/editor/tabs --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 类型检查与提交**

```bash
pnpm tc:web
git add src/renderer/src/store/slices/editor src/shared/editor-tab-view-types.ts
git commit -m "feat(refactor): add the refactoring review tab type"
```

---

### Task 11: 审查 store 与方案树

**Files:**

- Create: `src/renderer/src/components/editor/refactor/refactor-review-store.ts`
- Create: `src/renderer/src/components/editor/refactor/refactor-proposal-tree.tsx`
- Test: `src/renderer/src/components/editor/refactor/refactor-review-store.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `RefactorPlan` / `RefactorProposal` / `RefactorFileProposal` / `RefactorHunk`
- Produces:
  - `RefactorReviewSelection`：`{ acceptedHunkIds: Set<string>; selectedHunkId: string | null; selectedFilePath: string | null }`
  - `refactorReviewStore`（模块级单例，形状对齐 `src/renderer/src/components/editor/code-completion/nes-plan-store.ts`）：
    - `setPlan(jobId: string, plan: RefactorPlan): void`
    - `getPlan(jobId: string): RefactorPlan | null`
    - `setSelection(jobId: string, selection: RefactorReviewSelection): void`
    - `getSelection(jobId: string): RefactorReviewSelection`
    - `toggleHunk(jobId: string, hunkId: string): void`
    - `setHunkSelection(jobId: string, hunkIds: readonly string[], accepted: boolean): void`
    - `remove(jobId: string): void`
  - `refactorHunksOfProposal(proposal: RefactorProposal): RefactorHunk[]`
  - `refactorHunksOfFile(proposal: RefactorProposal, path: string): RefactorHunk[]`

- [ ] **Step 1: 写失败的测试**

`refactor-review-store.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createRefactorReviewStore } from './refactor-review-store'

const plan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: 't',
      rationale: 'r',
      files: [
        {
          path: 'src/foo.ts',
          originalContent: 'a\n',
          hunks: [
            {
              id: 'h1',
              originalStartLine: 1,
              originalLineCount: 1,
              modifiedStartLine: 1,
              modifiedLineCount: 1,
              originalText: 'a\n',
              modifiedText: 'b\n'
            }
          ]
        }
      ]
    }
  ]
}

describe('the refactor review store', () => {
  it('starts with nothing accepted', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    expect(store.getSelection('job-1').acceptedHunkIds.size).toBe(0)
  })

  it('toggles one hunk', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.toggleHunk('job-1', 'h1')
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(true)
    store.toggleHunk('job-1', 'h1')
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(false)
  })

  it('accepts every hunk of a file at once', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.setHunkSelection('job-1', ['h1'], true)
    expect(store.getSelection('job-1').acceptedHunkIds.has('h1')).toBe(true)
  })

  it('drops the selection with the plan', () => {
    const store = createRefactorReviewStore()
    store.setPlan('job-1', plan)
    store.remove('job-1')
    expect(store.getPlan('job-1')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-review-store.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现 store**

在 `refactor-review-store.ts`：

```ts
export function createRefactorReviewStore(): RefactorReviewStore
```

内部两个 `Map`：`plans` 与 `selections`。`getSelection` 对不存在的 job 返回空选择（`acceptedHunkIds: new Set()`，`selectedHunkId: null`，`selectedFilePath: null`）。`toggleHunk` 与 `setHunkSelection` 都要先确保 plan 存在（没有 plan 就什么都不做）。模块底部导出 `export const refactorReviewStore = createRefactorReviewStore()`。

同时导出 `refactorHunksOfProposal` 与 `refactorHunksOfFile`（把 proposal / file 里的 hunks 摊平）。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-review-store.test.ts --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/editor/refactor
git commit -m "feat(refactor): track what the user accepts in the review"
```

---

### Task 12: 代码块的 diff 视图

**Files:**

- Create: `src/renderer/src/components/editor/refactor/refactor-hunk-view.tsx`
- Create: `src/renderer/src/components/editor/refactor/refactor-hunk-view.fixture.tsx`
- Test: `src/renderer/src/components/editor/refactor/refactor-hunk-view.test.tsx`

**Interfaces:**

- Consumes: Task 1 的 `RefactorHunk`；`DiffViewer`（**从 `src/renderer/src/components/editor/editor-lazy-views.ts` 导入**，不要直接从 `diff/monaco-view/DiffViewer` 导入——仓库里同一个模块套第二层 lazy 会造成独立的边界和重挂载，参见该文件的注释）；`detectLanguage`（`src/shared/editor-language/editor-language-detect.ts`，签名 `detectLanguage(filePath: string, content?: string): string`）
- Produces:
  - `RefactorHunkView` 组件，props：`{ hunk: RefactorHunk; filePath: string; relativePath: string; accepted: boolean; sideBySide: boolean; onToggleAccepted: () => void; disabled?: boolean }`

- [ ] **Step 1: 写失败的测试**

`refactor-hunk-view.test.tsx`：用 `@testing-library/react` 渲染一个 `RefactorHunkView`，断言：

```tsx
it('shows the absolute line range of the hunk', () => {
  render(
    <RefactorHunkView
      hunk={{
        id: 'h1',
        originalStartLine: 42,
        originalLineCount: 17,
        modifiedStartLine: 42,
        modifiedLineCount: 3,
        originalText: 'old\n',
        modifiedText: 'new\n'
      }}
      filePath="/repo/src/foo.ts"
      relativePath="src/foo.ts"
      accepted={false}
      sideBySide
      onToggleAccepted={() => {}}
    />
  )
  expect(screen.getByText(/第 42-58 行/)).toBeTruthy()
})

it('shows an accept control that reports the click', () => {
  const onToggleAccepted = vi.fn()
  render(/* 同上，accepted={false} */)
  screen.getByRole('button', { name: /接受/ }).click()
  expect(onToggleAccepted).toHaveBeenCalled()
})
```

行号的算法：`originalStartLine` 到 `originalStartLine + originalLineCount - 1`；`originalLineCount` 为 0（纯插入）时显示 `第 <originalStartLine> 行`。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-hunk-view.test.tsx --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现组件**

在 `refactor-hunk-view.tsx`：

- 顶部一行：绝对行号标签 + 接受按钮（按钮文案随 `accepted` 在"接受"与"已接受"之间切换）。
- 下面一个 `DiffViewer`：
  - `originalContent={hunk.originalText}`
  - `modifiedContent={hunk.modifiedText}`
  - `language={detectLanguage(relativePath)}`
  - `filePath` / `relativePath` 传相对路径
  - `modelKey={`refactor-hunk:${hunk.id}`}`
  - `sideBySide={sideBySide}`
  - `editable={false}`

`DiffViewer` 是 lazy 组件，测试里需要 mock `@monaco-editor/react` 的 `DiffEditor`（参考 `src/renderer/src/components/editor/diff/sections/DiffSectionBody.word-wrap-lifecycle.test.tsx` 的写法）。

- [ ] **Step 4: 写 fixture**

`refactor-hunk-view.fixture.tsx` 导出一个默认组件，渲染两个 hunk：一个已接受、一个未接受。

- [ ] **Step 5: 跑测试与截图**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-hunk-view.test.tsx --maxWorkers=2`
Expected: PASS。

Run: `pnpm fixtures:shot refactor/refactor-hunk-view`
Expected: PNG 落在 `.cache/fixtures/`。**看图确认** diff 渲染正常（两侧都有内容、行号不空）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/editor/refactor
git commit -m "feat(refactor): show one diff per refactoring hunk"
```

---

### Task 13: 审查 tab 与触发入口

**Files:**

- Create: `src/renderer/src/components/editor/refactor/refactor-review-tab.tsx`
- Create: `src/renderer/src/components/editor/refactor/refactor-review-tab.fixture.tsx`
- Modify: `src/renderer/src/components/editor/EditorPanelHeader.tsx`
- Test: `src/renderer/src/components/editor/refactor/refactor-review-tab.test.tsx`

**Interfaces:**

- Consumes: Task 9 的客户端与轮询；Task 11 的 store；Task 12 的 `RefactorHunkView`；Task 1 的 `RefactorPlan`
- Produces:
  - `RefactorReviewTab` 组件，props：`{ jobId: string; worktree: string; relativePath: string }`
  - `openRefactorReviewTab(input: { worktree: string; relativePath: string; content: string; instruction?: string }): Promise<void>` —— 发起任务、拿到 jobId、开 tab

- [ ] **Step 1: 写失败的测试**

`refactor-review-tab.test.tsx`：

```tsx
it('shows the proposal title and its rationale', () => {
  // 预置 store 里的 plan（Task 11），渲染 RefactorReviewTab
  expect(screen.getByText('提取参数校验')).toBeTruthy()
  expect(screen.getByText(/两处校验规则相同/)).toBeTruthy()
})

it('warns when only part of a proposal is accepted', () => {
  // 方案 p1 有两个 hunk，只接受一个
  expect(screen.getByText(/只接受其中一处可能无法编译/)).toBeTruthy()
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-review-tab.test.tsx --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现方案树与 tab**

`refactor-proposal-tree.tsx`：渲染「方案 → 文件 → 代码块」三级，每级一个复选框：

- 方案级勾选 = 该方案所有 hunk 全选 / 全不选。
- 文件级勾选 = 该文件所有 hunk 全选 / 全不选。
- 代码块级勾选 = 单个 hunk。
- 每个方案节点显示 `title` 与 `rationale`；`rationale` 为空串时显示"未给出理由"。

`refactor-review-tab.tsx`：

- 左侧 `refactor-proposal-tree.tsx`，右侧当前选中的 hunk 的 `RefactorHunkView`。
- 顶部：文件名、「接受全部方案」、「丢弃」按钮、进度文案。
- 用 Task 9 的 `pollRefactorJob` 轮询状态；`state === 'done'` 后用 `fetchRefactorPlan` 取 plan 并写进 store。
- 「接受全部方案」把 plan 里所有 hunk 标为接受，然后调 `applyRefactor`，成功后关掉这个 tab（用现成的关闭编辑 tab 的 store action）。
- 「丢弃」调 `discardRefactor` 后关 tab。
- **部分接受警告**：对每个方案，若它有 hunk 但被接受的 hunk 是真子集，在方案节点上显示提示"这个改动由 N 处修改共同组成，只接受其中一处可能无法编译"，并给一个"接受该方案全部改动"的按钮。
- 接受成功/失败的提示用 Orca 现成的 toast（查 `src/renderer/src/components/` 里既有的 toast 用法，不要自造）。

- [ ] **Step 4: 加触发入口**

在 `EditorPanelHeader.tsx` 加一个「智能重构」按钮：

- 只在 `mode === 'edit'` 的文件上出现。
- 点击时取当前激活文件的**缓冲区内容**（用 `createEditorPanelDraftSelector`，见 `src/renderer/src/components/editor/editor-panel-draft-selector.ts`），调 `openRefactorReviewTab`。
- 按钮在没有 Claude 登录态时也要能点（由后端报错后在 tab 里显示）。

- [ ] **Step 5: 跑测试与截图**

Run: `pnpm test src/renderer/src/components/editor/refactor --maxWorkers=2`
Expected: PASS。

Run: `pnpm fixtures:shot refactor/refactor-review-tab`
Expected: PNG 落在 `.cache/fixtures/`。**看图确认**：左树的三级层次清楚、右边的 diff 不是空白。

- [ ] **Step 6: 跑本地化脚本与提交**

```bash
node config/scripts/localization/source-extraction/localize-renderer-strings.mjs
pnpm tc:web
pnpm check:changed
git add src/renderer/src/components/editor/refactor src/renderer/src/components/editor/EditorPanelHeader.tsx src/renderer/src/i18n
git commit -m "feat(refactor): review the proposals and accept them by plan, file, or hunk"
```

---

## 完成标准

- `pnpm check:changed` 通过。
- `pnpm tc` 通过。
- `pnpm test src/shared/refactor src/main/refactor src/renderer/src/components/editor/refactor --maxWorkers=2` 通过。
- 人工验证：在一个真实文件上发起重构，agent 在 `.orca/refactor/<jobId>/` 写出暂存文件与 `manifest.json`；审查 tab 里能看到方案、理由和逐个代码块的 diff；分别用「全方案」「全文件」「单个代码块」接受各一次，源码文件按预期被改写；评审期间改动文件后接受会被拒绝。
