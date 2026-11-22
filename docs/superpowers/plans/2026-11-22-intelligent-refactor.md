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
- 提交前必须跑 `pnpm check:changed`，不得 `--no-verify`。
  **基线用 `pnpm check:changed --base=9127b3837e`**（本分支起点，merge-base 就是它）。
  不要用默认的 `origin/main`：origin/main 停在 `f90dab5edf`，不含本分支历史里那个 NES 大提交，
  changed 集合会混进别人的几千个文件，vitest 的 "related" 步骤要跑 19 分钟。
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
    - `RefactorApplyResult`：`{ applied: { path: string; hunksApplied: number }[]; refusals: { path: string; reason: string }[] }`
      —— `refusals` 承载"文件在评审期间被改动过"这类拒绝，spec §8.2 要求把原因告诉用户，
      RPC 边界上必须有这个通道，否则用户只看到一个静默的空操作。
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

  it('rejects a hunk whose start line is zero', () => {
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
                  originalStartLine: 0,
                  originalLineCount: 1,
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

行号与行数用 `.int()`：行号按定义就是整数，仓库里既有的行号契约也是 `.int().positive()`
（见 `src/shared/rpc-contract/code-completion-params.ts`）。同一个提交里 `hunksApplied` 已经用了
`.int().nonnegative()`，行号却不带 `.int()` 是不一致的；小数行号会让渲染层切错行。

在 `src/shared/refactor/refactor-manifest.ts` 写 `RefactorManifestProposal` 与 `RefactorManifest`，`files` 用 `z.array(z.string().min(1))`。

在 `src/shared/rpc-contract/refactor-params.ts` 写上面列出的**八个** schema 与类型。`RefactorProposeParams` 的 `worktree` 用 `z.string().min(1)`。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/shared/refactor/refactor-types.test.ts --maxWorkers=2`
Expected: PASS，4 个用例全过。

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

  it('keeps the later hunk anchored when only the earlier one is applied', () => {
    const original = 'a\nb\nc\nd\n'
    const modified = 'A\nb\nC\nd\n'
    const hunks = computeRefactorHunks(original, modified)
    expect(hunks).toHaveLength(2)
    expect(applyRefactorHunks(original, [hunks[0]])).toBe('A\nb\nc\nd\n')
    expect(applyRefactorHunks(original, [hunks[1]])).toBe('a\nb\nC\nd\n')
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
  - `isPathInsideWorkspace(workspaceRoot: string, targetPath: string): boolean` —— 读工具用同一套判定，只是根换成工作区根
  - `refactorToolAllowed(input: { toolName: string; toolInput: Record<string, unknown>; scratchRoot: string; workspaceRoot: string }): boolean`
  - `refactorToolTargetPath(toolInput: Record<string, unknown>): string | null` —— 从工具入参里取路径，依次尝试 `file_path`、`filePath`、`path`，都没有则返回 `null`。这三个键是仓库自己的约定，见 `src/shared/agent-hook-listener/tool-input-preview.ts` 的 `TOOL_INPUT_KEYS_BY_TOOL`（Write / Edit / MultiEdit 都是这三个键）。

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

  it('allows a multi-edit inside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'MultiEdit',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('rejects a path whose segment ends in a space, because Windows strips it', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/.. /.. /evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('rejects a path whose segment ends in a dot, because Windows strips it', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/.../../evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies an unknown tool name', () => {
    expect(
      refactorToolAllowed({
        toolName: 'NotebookEdit',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a write whose path is only whitespace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '   ' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a differently cased path, because the comparison is case sensitive', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.ORCA/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows a read inside the workspace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies a read outside the workspace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/home/mac/.ssh/id_rsa' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a read whose input carries no path', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: {},
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows a grep without a path, because it searches from the workspace root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies a grep pointed outside the workspace', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: '/home/mac' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows an edit inside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Edit',
        toolInput: { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('denies an edit outside the scratch root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Edit',
        toolInput: { file_path: '/repo/src/foo.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('allows a write to the scratch root itself', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: scratchRoot },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(true)
  })

  it('allows a grep rooted at the workspace root', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: workspaceRoot },
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
- **路径分量末尾的点和空格必须拒绝**。Win32 在识别 `.` / `..` **之前**先剥掉每个分量末尾的空格和点，
  所以 `.. `（点-点-空格）对操作系统来说就是"上一级目录"，而 Node 的 `path.win32.resolve` 不剥，
  它把 `.. ` 当成普通子目录——闸门会放行，而 Windows 实际把文件写到了暂存目录之外。
  逐段用仓库自己的正则拒绝：`/[. ]$/.test(segment)`。
  这不是新发明：`src/shared/plugins/frames/plugin-frame-guest.ts:96-105` 就是这么防的，
  注释写着"Windows strips them, so `__orca.` or `app.js ` would name another file than the one checked"。
  POSIX 上这种文件名合法但对 agent 毫无用处，拒绝掉无害。
- **这条规则必须住在两个包含判断函数里面，不能只住在 `refactorToolAllowed` 里**。
  `isPathInsideScratch` 与 `isPathInsideWorkspace` 是导出的，Task 8 会直接调用它们来校验
  用户传进来的 `relativePath`；规则只住在 `refactorToolAllowed` 里的话，那条直接调用路径就绕过了它。
  两个函数的形状：
  - `isPathInsideScratch(scratchRoot, targetPath)` —— **targetPath 必须是绝对路径**（调用方先按工作区根解析）。
    依次：① 对 targetPath 逐段做末尾点/空格的检查，不过就返回 `false`；② 用 `path.resolve` 把两边规约成绝对路径，
    然后判断 `resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)`。
  - `isPathInsideWorkspace(workspaceRoot, targetPath)` —— 同一套逻辑，只是根换成工作区根，同样先做分段检查。
  - `path.resolve` 不会剥末尾的点和空格（剥的是操作系统），所以对**解析后**的路径做这个检查一样有效：
    精确的 `..` 由 resolve 折叠（折叠完就跑到根外面了，包含判断会拒），`.. ` 原样留在分段里被这条规则拒掉。
  - **比较区分大小写**——大小写不敏感的文件系统上这会拒掉一个大小写不同的合法路径，那是安全的方向；agent 总是用 prompt 里给的原样路径写。
  - **不要改用仓库里的 `isPathInsideOrEqual`**（`src/shared/cross-platform-path.ts:159`）——它的
    `normalizeRuntimePathForComparison` 会把 Windows 风格路径小写化，与上面的大小写敏感要求冲突。
    写一行注释说明为什么不用它，免得后人"顺手去重"时把大小写敏感的围栏改回大小写不敏感。
- `refactorToolAllowed`：
  - `toolName` 是 `Write` / `Edit` / `MultiEdit` → 取路径；取不到就**拒绝**（fail-closed）；取到就 `path.resolve(workspaceRoot, target)`（相对路径按工作区根解析）后交给 `isPathInsideScratch`。
    **放行 `MultiEdit` 是必须的**：它是 Claude Code 真实存在的编辑工具，拒掉它等于堵死一条正当的编辑路径，agent 可能转去找 `Bash` 之类的绕路（那些也被拒），功能就废了。
  - `toolName` 是 `Read` → 取路径；**取不到就拒绝**；取到就要求它落在**工作区根内**。
  - `toolName` 是 `Grep` / `Glob` → 路径可选（不给就从 cwd 搜，而 cwd 就是工作区根）；给了就要求它落在**工作区根内**。
  - 其它工具名 → **拒绝**。`Bash` 必须在拒绝名单里，否则 agent 能用 `mv` 绕过写闸门。

**读也要圈在工作区里**，不只是写。读工具放行机器上任何路径，等于让 agent 能读 `~/.ssh/id_rsa`
或 `~/.aws/credentials`——而这个 agent 处理的正是**不可信的**文件内容（提示注入的入口）。
工作区根的判定用同一套 `path.resolve` + 分隔符边界，只是根换成 `workspaceRoot`；
暂存目录在工作区里，所以自然可读。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-write-gate.test.ts --maxWorkers=2`
Expected: PASS，25 个用例全过。

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
  - `REFACTOR_DISALLOWED_TOOLS`：`readonly string[]` = `['Bash', 'Task']` —— 这两个是脱离路径模型的逃逸口（`Bash` 能 `mv`/`cp`，`Task` 能派生子 agent），从模型的上下文里直接去掉。写闸门本来也拒它们，这是第二道。
  - **`options.allowedTools` 一律不给**（保持 `undefined`）。SDK 对 `allowedTools` 的定义是"自动放行、不再询问"，
    而 `canUseTool` 是"每次工具执行前调用"——把 `Write`/`Edit` 列进 `allowedTools`，CLI 可能就绕过闸门直接放行写操作。
    不给这个选项，所有工具调用都走 `canUseTool`，写闸门是唯一裁决者。

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-agent-launch.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { REFACTOR_DISALLOWED_TOOLS, resolveRefactorAgentLaunch } from './refactor-agent-launch'

describe('resolveRefactorAgentLaunch', () => {
  it('runs the agent in the workspace without bypassing the permission gate', async () => {
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
    expect(launch.options.disallowedTools).toEqual(REFACTOR_DISALLOWED_TOOLS)
    expect(launch.options.settingSources).toEqual([])
    expect(launch.options.extraArgs?.['dangerously-skip-permissions']).toBeUndefined()
  })

  it('never auto-allows a write tool, so the gate always gets the decision', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    expect(launch.options.allowedTools).toBeUndefined()
  })
})
```

若 `resolveCommand` 的实际返回形状与这里不同，以 `ClaudeEnvDeps['resolveCommand']` 的定义为准（`StructuredAgentCommand`），测试按真实形状写。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-agent-launch.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 加上 SDK 选项字段**

在 `claude-structured-launch-resolution.ts` 的 `ClaudeStructuredSdkOptions` 的 Pick 列表里加 `'allowedTools'` 与 `'disallowedTools'`。
SDK 的 `Options` 上确实有这两个字段（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1660` 与 `:1680`），
类型都是 `string[]`——所以 `disallowedTools` 要写 `[...REFACTOR_DISALLOWED_TOOLS]`（展开成新数组），
不能直接把 `readonly string[]` 赋过去。

- [ ] **Step 4: 实现启动解析**

在 `refactor-agent-launch.ts`：

```ts
export const REFACTOR_DISALLOWED_TOOLS: readonly string[] = ['Bash', 'Task']
```

`resolveRefactorAgentLaunch` 调 `resolveClaudeStructuredInvocation(deps)` 拿到 `{ command, prefixArgs, env, account }`，然后返回：

- `pathToClaudeCodeExecutable: invocation.command`
- `prefixArgs: invocation.prefixArgs`
- `env: invocation.env`
- `cwd: input.cwd`
- `options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, permissionMode: 'default', disallowedTools: [...REFACTOR_DISALLOWED_TOOLS], settingSources: [] }`

三处选项各有理由，缺一个闸门就失效：

- **`permissionMode: 'default'`** —— `'acceptEdits'` 会自动接受编辑（`claudeStructuredPermissionOptions` 的映射里写明了），
  `'auto'` 由分类器决定，`'bypassPermissions'` 什么都不问。只有 `'default'` 会把每个工具调用交给 `canUseTool`。
- **不给 `allowedTools`** —— 见 Interfaces 里的说明。写工具一旦被自动放行，闸门就形同虚设。
- **`settingSources: []`** —— SDK 文档写的是"disable filesystem settings (SDK isolation mode)"。
  默认的 `['user','project','local']` 会加载用户自己的 Claude 设置；用户若在 `settings.json` 里写了
  `permissions.allow: ["Write"]`，写操作就会被自动放行，**同样绕过闸门**。隔离掉，
  这次运行的权限只来自我们传进去的东西。（副作用是用户的 CLAUDE.md 和自定义设置这次不生效——
  对一个只读的临时重构 agent 来说这是可接受的。）

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
      - **`workspaceRoot` 必须等于 `launch.cwd`**（传 `launch.cwd` 进去，不要另传一个）。
        闸门把相对路径按 `workspaceRoot` 解析，而 SDK 把相对路径按进程的 cwd 解析——
        两者不一致时，闸门可能批准一个 SDK 根本不会写的位置，而 SDK 真正写的地方在暂存目录之外。
        传同一个值就没有这个缺口。
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
  1. 用 `openClaudeStreamJsonConnection` 建立连接。**它的第一个参数就是 launch 对象**
     （`ClaudeStreamJsonLaunch` = `{ pathToClaudeCodeExecutable, prefixArgs?, options, cwd, env?, envToDelete? }`），
     Task 4 的 `RefactorAgentLaunch` 结构上正好对得上，直接把 `launch` 传进去即可，不要拆开重组。
     第二个参数是 handlers：`{ onMessage?, canUseTool?, onFault?, onExit?, ... }`。
     **`canUseTool` 属于 handlers，不是 options** —— 它由连接层转给 SDK 的 `canUseTool` 选项。
  2. `canUseTool` 回调：`CanUseTool = (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<PermissionResult>`。
     调 `refactorToolAllowed({ toolName, toolInput: input, scratchRoot, workspaceRoot })`，
     允许返回 `{ behavior: 'allow' }`，拒绝返回 `{ behavior: 'deny', message: '该工具在此任务中不可用。' }`。
     **必须显式返回 deny 对象，不能返回 `null`** —— SDK 的文档说 `null` 表示"不发响应"，
     那个 elicitation 会永远挂起（sdk.d.ts:1558）。
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
  4. 监听 SDK 消息（`handlers.onMessage`）：收到 `tool_use` 就更新进度并 `onProgress?.(text)`；收到 `type === 'result'` 就结束等待。
     **结果帧要分成功与失败**：`SDKResultMessage = SDKResultSuccess | SDKResultError`。
     成功的帧是 `subtype: 'success'`；失败的帧是
     `subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'`，
     带 `is_error` 和 `stop_reason`。失败的那一种要结束等待并把 `subtype` 与 `stop_reason`
     写进 `warnings` —— 否则这一轮报错会被当成正常结束，用户看到的是"agent 什么都没产出"，
     而不是"agent 报错了"。失败时如果暂存目录里已经有文件，仍然照常读清单（可能有部分产出），
     但警告里必须说明这一轮是失败结束的。
     **也要接 `handlers.onFault` 与 `handlers.onExit`**：CLI 崩了或被杀掉的时候不会有 `result` 帧，
     只等 `result` 就会一路挂到 5 分钟超时才罢休。两者任一触发就结束等待，
     并把错误信息写进 `warnings`（`onExit` 的 `expected` 为 false 时说明是非预期退出，更该写明）。
  5. 结束后读 `<scratchRoot>/manifest.json`，用 `RefactorManifest.safeParse` 解析；解析失败返回 `manifest: null` 并在 `warnings` 里写明原因。
     读它也要带大小上限（清单是 agent 写的外部输入）：用 `readNodeFileWithinLimit(path, 1 * 1024 * 1024)`（`src/shared/file-content/node-bounded-file-reader.ts`），超限按"解析失败"处理。
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
  - `buildRefactorPlan(input: { jobId: string; sourcePath: string; manifest: RefactorManifest | null; scratchRoot: string; workspaceRoot: string; readBaseline: (relativePath: string) => Promise<string | null>; readDiskContent: (relativePath: string) => Promise<string | null>; scratchFiles: (proposalId: string, relativePath: string) => Promise<string | null>; listScratchProposals: () => Promise<{ id: string; files: string[] }[]> }): Promise<{ plan: RefactorPlan; warnings: string[]; diskContents: Map<string, string> }>`
    - `listScratchProposals` 返回暂存目录下每个**一级子目录**及其中的文件：
      `{ id: 目录名, files: 目录里的文件相对工作区的路径 }`。`files` 必须是工作区相对路径
      （与 manifest 里的 `files` 同一坐标系），这样 `scratchFiles(id, file)` 读到的就是
      `<scratchRoot>/<id>/<file>`。
      **必须连文件一起返回**：只返回目录名的话，"清单缺失时从目录还原方案"这条兜底路径无从下手——
      builder 知道有个方案目录叫 `p1`，却不知道它里面有哪些文件。
      结果里**含 `_source`**（发起时写下的基准副本），由 builder 负责排除。
      它是注入的，所以这条兜底路径可测，builder 本身不碰 fs。
  - `diskContents` 是每个文件在**建 plan 那一刻**的磁盘内容（D）。它不进 plan（plan 只带渲染 diff 用的基准文本 B），由 job 留在主进程侧，供接受时做陈旧判定。
  - `isSafeRelativeRefactorPath(relativePath: string): boolean` —— 清单里的路径必须在工作区内。
    **委托给仓库既有的 `isSafeMobileRelativePath`**（`src/main/runtime/files/mobile-file-kind.ts`），
    不要自己重写一遍路径段检查。路径守卫是安全边界，两份实现就是两个可能出错的地方；
    那个函数被 `file-access` / `file-reads` / `terminal-path-resolver` 三处通用文件 API 使用，
    语义（拒绝绝对路径、Windows 盘符前缀、`..` / `.` / 空段）比本任务要的更严，正好够用。

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
      listScratchProposals: async () => [],
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
      listScratchProposals: async () => [],
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
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('drops a proposal whose scratch file is missing and warns about it', async () => {
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
      listScratchProposals: async () => [],
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
      listScratchProposals: async () => [
        { id: '_source', files: ['src/foo.ts'] },
        { id: 'p1', files: ['src/foo.ts'] }
      ],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-plan-builder.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现 plan builder**

在 `refactor-plan-builder.ts`：

- `isSafeRelativeRefactorPath(relativePath)`：直接 `return isSafeMobileRelativePath(relativePath)`，从 `src/main/runtime/files/mobile-file-kind.ts` 导入。它拒绝绝对路径、Windows 盘符前缀，以及任何 `..` / `.` / 空路径段——比本任务要求的更严，正好覆盖。不要自己重写这段检查。
- `buildRefactorPlan`：
  1. 遍历 manifest 的 proposals，维护一个 `claimedPaths: Set<string>`。
  2. **一个方案要么整个留下，要么整个丢掉**——不要半留半丢，否则审查界面里会出现一个缺文件的方案。
     所以先把这个方案的所有文件校验完，再一次性提交到 `claimedPaths`。
  3. 每个 proposal 的每个 file，依次：
     a. 过 `isSafeRelativeRefactorPath`——不过就记 warning 并丢掉整个 proposal。
     b. 若 `claimedPaths` 已含该 path，记 warning（"方案 X 与方案 Y 改同一个文件，已丢弃后者"）并丢掉整个 proposal。
     **这个检查放在读文件之前**：先读完再发现冲突，`diskContents` 里已经多了一条被丢弃方案的磁盘内容。
     c. 读暂存文件 `scratchFiles(proposal.id, path)`；读不到（`null`）就记 warning 并丢掉整个 proposal。
     d. 读基准文本 `readBaseline(path)`；读不到就记 warning 并丢掉整个 proposal。
     e. 读磁盘内容 `readDiskContent(path)`；读不到就记 warning 并丢掉整个 proposal。
  4. 这个方案的所有文件都过了，才把它们的路径加进 `claimedPaths`，并把每个文件变成
     `{ path, originalContent: baseline, hunks }`，其中 `hunks = computeRefactorHunks(baseline, scratchContent)`；
     磁盘内容存进 `diskContents`（path → D）。
  5. **空 hunks 的方案也要保留**——内容没变的方案不是错误，只是没有可接受的东西。
  6. manifest 为 `null` 时：调 `listScratchProposals()`，**排除 id 为 `_source` 的那一项**，
     其余每一项当作一个方案：`id` 用目录名，`files` 用它返回的文件列表，
     `title` 用目录名，`rationale` 留空串，并在 warnings 里写"agent 未给出理由"。
     之后走与上面一样的校验流程（路径安全、暂存文件可读、基准可读、磁盘可读、同文件冲突）。
     **必须排除 `_source`**——它是发起时写下的基准副本，不是某个方案的重构产物；
     把它当成方案会在审查界面里多出一个叫 `_source` 的空方案。
  7. 返回 `{ plan: { jobId, sourcePath, proposals }, warnings, diskContents }`。

**基准文本 B 与磁盘内容 D 是两回事**：B 是用户眼前（编辑器缓冲区）的内容，D 是磁盘上的内容。用户有未保存修改时 B ≠ D。`diskContents` 里的 D 只给接受时的陈旧判定用，不进 plan。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-plan-builder.test.ts --maxWorkers=2`
Expected: PASS，8 个用例全过（3 个路径安全 + 5 个 builder）。

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
  - `RefactorJob`：`{ jobId: string; state: RefactorStatusResult['state']; progress: string; warnings: string[]; plan: RefactorPlan | null; diskContents: Map<string, string>; baselines: Map<string, string>; worktree: string; controller: AbortController; scratchRoot: string }`
    - `state` 用 `RefactorStatusResult['state']` 的索引访问，不要把 `'running' | 'done' | 'failed' | 'cancelled'` 重抄一遍——两份拷贝会漂。
    - `baselines` 是每个文件的**基准文本 B**（目标文件是编辑器缓冲区，其余文件是当时的磁盘内容）。
    - `diskContents` 是每个文件在**建 plan 那一刻**的磁盘内容 D，供接受时做陈旧判定。
    - `worktree` 是原始的 worktree 选择器字符串，写回时要用。
  - `createRefactorJobRegistry()`：
    - `create(input: { jobId: string; scratchRoot: string; worktree: string; baselines?: Map<string, string> }): RefactorJob`
      —— `baselines` 在**建 job 时**就要带上：发起时就知道目标文件的基准文本（编辑器缓冲区内容），
      等 job 建好再补就晚了。
    - `get(jobId: string): RefactorJob | null`
    - `update(jobId: string, patch: Partial<Pick<RefactorJob, 'state' | 'progress' | 'warnings' | 'plan' | 'diskContents' | 'baselines'>>): void`
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
    registry.create({ jobId: 'job-1', scratchRoot: '/repo/.orca/refactor/job-1', worktree: 'wt-1' })
    registry.update('job-1', { progress: '正在读取 src/foo.ts', warnings: ['w'] })
    expect(registry.get('job-1')?.progress).toBe('正在读取 src/foo.ts')
    expect(registry.get('job-1')?.warnings).toEqual(['w'])
  })

  it('carries the baseline of the target file from the start', () => {
    const registry = createRefactorJobRegistry()
    const job = registry.create({
      jobId: 'job-1',
      scratchRoot: '/repo/.orca/refactor/job-1',
      worktree: 'wt-1',
      baselines: new Map([['src/foo.ts', 'a\n']])
    })
    expect(job.baselines.get('src/foo.ts')).toBe('a\n')
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
Expected: PASS，5 个用例全过。

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

precondition 用 `FileWriteDiskPreconditionParam` 的形状：`{ expectedSignature, allowMissing }`。`expectedSignature` 用 `getDiskBaselineSignature(content)`（`src/shared/file-write/disk-baseline-signature.ts`）——它对**内容**求签名，与 `files.writeIfUnchanged` 的前置条件语义一致（`src/main/ipc/filesystem/local-disk-write-precondition.ts` 就是拿它跟磁盘内容比的）。

签名要对着**当前磁盘内容**算（也就是 `readCurrent` 返回的那份），不是对着要写进去的新内容。
`getDiskBaselineSignature` 永远返回 `<hex>-<hex>-<hex>` 形状的非空串，长度远小于 RPC 参数的 64 字符上限。

写回的运行时 API（`src/main/runtime/files/file-mutations.ts:51-59`）：

```ts
writeFileExplorerFile(
  worktreeSelector: string,
  relativePath: string,
  content: string,
  expectedSshConnectionGeneration?: number,
  expectedSshTargetId?: string,
  expectedExecutionHostId?: string,
  diskPrecondition?: FileWriteDiskPrecondition
): Promise<FileWriteResult>
```

本地工作区那三个可选参数传 `undefined` 即可；传 `undefined` 与不传是同一件事。

**写盘会连带保存用户的未保存修改**：因为 `newContent` 是从基准文本 B 算出来的，而 B 含用户那些还没存盘的编辑。这不是副作用而是语义的一部分（重构基于用户眼前的内容，落盘理应包含它），但界面必须写明这一点。

- [ ] **Step 4: 实现 RPC 方法**

在 `src/main/runtime/rpc/methods/refactor/refactor-methods.ts` 用 `defineMethod`（从 `'../../core'` 导入）注册 5 个方法：

- `refactor.propose`：
  1. `const target = await runtime.resolveRuntimeFileTarget(params.worktree)` → `target.worktree.path` 是工作区绝对路径。
     1.2. **只支持本地工作区**：`target.executionHostId` 必须是 `LOCAL_EXECUTION_HOST_ID`（`'local'`，
     `src/shared/execution-host.ts:5`），否则**拒绝这次请求**，理由写清楚"远程主机上的重构暂不支持"。
     理由不是偷懒，是结构性的：agent 是在**这台机器上**跑的本地子进程
     （`openClaudeStreamJsonConnection` 只 spawn 本地子进程），它的 cwd 必须是本机上的目录；
     而 SSH / WSL 工作区的 `worktree.path` 是**远端机器上的路径**，本地进程拿它当 cwd 起不来，
     也读不到远端的源文件。仓库自己的结构化 Claude 也是同样的拒绝：
     `src/main/runtime/agent-session/launch/structured-agent-launch-composition.ts:122-128`
     写着 "structured sessions run on the local host, not <hostId>"。
     远端要支持，得让**远端那台机器上的 orcad** 来跑这个特性（把方法注册进远端的运行时并转发过去），
     那是另一个工作量的特性，不在本次范围内。
     1.5. **校验 `params.relativePath`**：它会直接拼进暂存目录的写入路径（`_source/<relativePath>`），
     所以必须先过两道：
     - `isSafeMobileRelativePath(params.relativePath)`（`src/main/runtime/files/mobile-file-kind.ts`）——
       拒绝对路径、Windows 盘符前缀，以及 `..` / `.` / 空路径段。Task 6 的 `isSafeRelativeRefactorPath`
       委托的就是它，**两个任务共用这一份实现，不要各写一遍**。
     - `isPathInsideWorkspace(target.worktree.path, path.resolve(target.worktree.path, params.relativePath))`
       （Task 3 的导出）——`isSafeMobileRelativePath` 不管末尾点/空格，而 `.. ` 在 Windows 上就是"上一级目录"。
       Task 3 的包含判断里已经含了这条分段规则，所以这一道是必须的。
       任一条不过就**直接拒绝这次请求**（抛错），不要先建暂存目录再报错。
  2. `jobId` 用 `crypto.randomUUID()`。
  3. `scratchRoot = refactorScratchRoot(target.worktree.path, jobId)`，用 `fs.mkdir(scratchRoot, { recursive: true })` 建出来。
  4. 写基准副本：`fs.writeFile(path.join(scratchRoot, '_source', params.relativePath), params.content)`，父目录先 `mkdir recursive`。
  5. **建 job**（Task 7 的注册表），建的时候就把目标文件的**基准文本**带上：
     `baselines: new Map([[params.relativePath, params.content]])`。
     其它文件的基准文本就是它们当时的磁盘内容。
     顺序很重要：基准在发起那一刻就已知，所以要在建 job 时就给，不能等 job 建好再补——
     那时候注册表里还没有这个 job，也没有地方放它。
  6. 把 `.orca/refactor/` 加进工作区的 `.git/info/exclude`（见下面「暂存目录不进版本库」）。
  7. 清理过期暂存目录（见下面「暂存目录清理」）。
  8. **立刻返回** `{ jobId }`。
  9. 后台异步跑：解析 agent 启动（Task 4）→ 跑 turn（Task 5）→ 建 plan（Task 6）→ `update` job 的 `state: 'done'`、`plan` 与 `diskContents`。
     建 plan 时传的 `readBaseline` 是 `(path) => baselines.get(path) ?? 磁盘内容`——目标文件用用户眼前的缓冲区内容，其余文件用当时的磁盘内容。`readDiskContent` 是 `(path) => 磁盘内容`。
     `listScratchProposals` 要**连每个方案目录里的文件一起返回**：
     `(await fs.readdir(scratchRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())`
     拿到目录名后，对每个目录再递归列一次文件，得到相对**工作区**的路径列表，组成
     `{ id: 目录名, files: [...] }`。只返回目录名是不够的——清单缺失时 builder 要靠它还原方案，
     知道有 `p1` 这个目录却不知道里面有哪些文件，兜底路径就无从下手。
     `scratchFiles` 读暂存文件时**必须带大小上限**：用 `readNodeFileWithinLimit(filePath, maxBytes)`（`src/shared/file-content/node-bounded-file-reader.ts`），超限抛 `NodeFileReadTooLargeError`。
     上限取 **2 MB**（与运行时 `files.formatText` 的 `z.string().max(2 * 1024 * 1024)` 一致）。
     agent 写的文件是外部输入，不设上限就是让 agent 用一个巨型文件把主进程内存吃光；
     这个读取器还会挡住把路径换成 FIFO 的替换攻击。
  10. 失败时 `update` 成 `state: 'failed'` 并把原因写进 `warnings`。抛错时 `state: 'failed'`。
  11. 每一步都要尊重 job 的 `controller.signal`。

- `refactor.status`：从注册表取 job，返回 `{ state, progress, warnings }`。job 不存在时返回 `{ state: 'failed', progress: '', warnings: ['任务不存在'] }`。

- `refactor.plan`：从注册表取 job，返回 `{ plan: job.plan }`。

- `refactor.apply`：从注册表取 job（没有 plan 就返回空 applied），调 `applyRefactorSelection`，把 job 上的 `diskContents` 传进去。**返回值里的 `refusals` 原样带回 RPC 结果**——spec §8.2 要求把"文件在评审期间被改动过"告诉用户，这个通道就是 `RefactorApplyResult.refusals`。写回用 `runtime.writeFileExplorerFile(worktree, relativePath, content, ...sshArgs, diskPrecondition)`。`worktree` 用 job 上存的原始 `worktree` 选择器字符串。

- `refactor.discard`：job 还在 running 就 `controller.abort()`；然后删掉 `scratchRoot` 目录（`fs.rm(scratchRoot, { recursive: true, force: true })`），从注册表 `remove`，返回 `{ discarded: true }`。

**暂存目录不进版本库**：工作区是 git 仓库时，把 `.orca/refactor/` 追加到仓库的 `info/exclude`——
它只在本仓库本地生效，不动被跟踪的 `.gitignore`。

**不能直接写 `<worktree>/.git/info/exclude`**：Orca 的工作区绝大多数是 **linked worktree**，
那里的 `.git` 是一个**文件**（内容是 `gitdir: ...`），不是目录，写进去会 ENOTDIR。
而且 `info/` 不在 per-worktree 目录里——Git 把 `hooks/`、`info/`、`objects/`、`refs/`、`config`
这些放在 **common dir**（和主仓库共享），只有真正的 Git 知道 common dir 在哪。
仓库自己的 `readWorktreeGitPath`（`src/main/git/worktrees/catalog/worktree-git-path.ts:14-22`）
明确列了哪些是 per-worktree 的（`orca`/`HEAD`/`ORIG_HEAD`/`FETCH_HEAD`/`MERGE_HEAD`/`index`/`logs`），
`info/exclude` 不在其中，它的注释写着"which only real Git resolves"。

所以要问 Git 要路径：用 `gitExecFileAsync(['rev-parse', '--git-path', 'info/exclude'], { cwd: worktreePath })`
（`src/main/git/command-runner/git-exec-file.ts:187`），拿 `stdout` 拼成绝对路径再追加。

- 命令失败（不是 git 仓库的 folder workspace）→ 跳过这步，不算错误。
- 追加前先读一遍该文件，**已存在 `.orca/refactor/` 这行就跳过**，不要重复追加。
- 文件不存在就直接写（`info/exclude` 是 Git 自己保证存在的，父目录也在 common dir 里）。

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
import type { RefactorStatusResult } from '../../../../../shared/rpc-contract/refactor-params'

describe('pollRefactorJob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls until the job leaves the running state', async () => {
    vi.useFakeTimers()
    const states: RefactorStatusResult['state'][] = ['running', 'running', 'done']
    let call = 0
    const seen: string[] = []
    const stop = pollRefactorJob({
      jobId: 'job-1',
      intervalMs: 1000,
      fetchStatus: async () => ({ state: states[call++], progress: '', warnings: [] }),
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

`refactor-hunk-view.fixture.tsx` 用**具名导出** + `defineFixture`，照
`src/renderer/src/components/UpdateCard.fixture.tsx` 的写法：

```tsx
import { defineFixture } from '../../../component-fixtures/component-fixture'

export const twoHunks = defineFixture({
  width: 1280,
  render: () => <>{/* 一个已接受、一个未接受 */}</>
})
```

导入路径是 `'../../../component-fixtures/component-fixture'`（从 `components/editor/refactor/` 往上三级到 `src/renderer/src/`）。
**用具名导出**：注册表把模块的每个导出各自当成一个 fixture，名字就是 `<组件 id>:<导出名>`
（`src/renderer/src/component-fixtures/component-fixture-registry.ts:31-44`）。

- [ ] **Step 5: 跑测试与截图**

Run: `pnpm test src/renderer/src/components/editor/refactor/refactor-hunk-view.test.tsx --maxWorkers=2`
Expected: PASS。

Run: `pnpm fixtures:shot editor/refactor/refactor-hunk-view`
Expected: PNG 落在 `.cache/fixtures/`。**看图确认** diff 渲染正常（两侧都有内容、行号不空）。

**fixture 的 id 是 `editor/refactor/refactor-hunk-view:<导出名>`**：注册表把 `src/renderer/src/` 下的路径去掉
`components/` 前缀和 `.fixture.tsx` 后缀（`component-fixture-registry.ts:16-21`），
所以路径前缀是 `editor/refactor/`，不是 `refactor/`。不带 `:` 的裸 id 会匹配该组件的**全部** fixture。

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
  - 虚拟 tab 的 id 用合成 id（如 `${worktreeId}::refactor-review:${jobId}`），`filePath` 填这个合成 id
    ——虚拟 tab 没有磁盘上的文件，`isVirtualEditorFile` 靠这一点区分它。照抄
    `src/renderer/src/lib/source-control/graph/git-graph-tab.ts` 里 `openGitGraph` 的写法：
    `filePath: id`、`relativePath: label`、`language: 'plaintext'`、`mode: 'refactor-review'`、
    `openFile(..., { reopenId: id, preview: false })`；已经开着同一个 tab 时走
    `openWorkspaceEditorItem(state, id, worktreeId, label, 'refactor-review')` 激活它。
    `openWorkspaceEditorItem` 的 `contentType` 参数是 `EditorTabContentType`，Task 10 加了成员后即可直接传。

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
- **「查看完整文件」切换**（spec §9.2 要求）：切到整文件视角时，右区显示整个文件的 `DiffViewer`——
  `originalContent` 用 `file.originalContent`（基准文本），
  `modifiedContent` 用 `applyRefactorHunks(file.originalContent, file.hunks)`（Task 2 的函数，渲染层可用）。
  也就是说整文件视角显示的是**该方案改完之后的全文**，不是别的方案的结果。
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

Run: `pnpm fixtures:shot editor/refactor/refactor-review-tab`
Expected: PNG 落在 `.cache/fixtures/`。**看图确认**：左树的三级层次清楚、右边的 diff 不是空白。

- [ ] **Step 6: 跑本地化脚本与提交**

```bash
node config/scripts/localization/source-extraction/localize-renderer-strings.mjs
pnpm tc:web
pnpm check:changed --base=9127b3837e
git add src/renderer/src/components/editor/refactor src/renderer/src/components/editor/EditorPanelHeader.tsx src/renderer/src/i18n
git commit -m "feat(refactor): review the proposals and accept them by plan, file, or hunk"
```

**`check:changed` 必须带 `--base=9127b3837e`**：默认基线是 `origin/main`，而 origin/main 不含本分支历史里
那个大提交，changed 集合会混进几千个无关文件，vitest 的 "related" 步骤跑不完（实测 19 分钟仍未结束）。

---

## 完成标准

- `pnpm check:changed --base=9127b3837e` 通过。
- `pnpm tc` 通过。
- `pnpm test src/shared/refactor src/main/refactor src/renderer/src/components/editor/refactor --maxWorkers=2` 通过。
- 人工验证：在一个真实文件上发起重构，agent 在 `.orca/refactor/<jobId>/` 写出暂存文件与 `manifest.json`；审查 tab 里能看到方案、理由和逐个代码块的 diff；分别用「全方案」「全文件」「单个代码块」接受各一次，源码文件按预期被改写；评审期间改动文件后接受会被拒绝。
