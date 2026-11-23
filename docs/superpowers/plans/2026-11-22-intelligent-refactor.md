# 智能重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户对某个代码文件发起重构，Claude Agent SDK 在工作区的暂存目录里产出带理由的重构建议与重构后文件，应用逐个文件 diff 对比，并允许在全方案 / 全文件 / 代码块三个粒度上把改动写回源码。

**Architecture:** agent 只用文件说话——它把重构后的文件与一份 `manifest.json` 写进 `.orca/refactor/<jobId>/`，应用读回文件、**自己算 hunk**、组装 `RefactorPlan` 交给渲染层。模型永远不产出行号、不产出 diff、不在回答里贴 JSON，因此绕开了 NES 栽过的"模型数错行"和"模型给对了应用丢了"两个坑。接受时不是打 patch，而是用被接受的 hunk 重算整份文件内容再整体写回。

**Tech Stack:** Electron + React 19 + Zustand + Monaco Editor（`DiffViewer`）+ Zod + Vitest（`pnpm test`）+ `@anthropic-ai/claude-agent-sdk` v0.3.318 + `diff` v8.0.4

**Spec:** `docs/superpowers/specs/2026-11-22-intelligent-refactor-design.md`

## Global Constraints

- 跨平台：不硬编码 `e.metaKey`；快捷键用 `monaco.KeyMod.CtrlCmd`；路径一律用 `path.join` / `path.resolve` / `path.relative`。
- 工作区读写走 runtime RPC，参数用 `worktree` + `relativePath`（沿用 `WorktreeSelector` 形状）。
  渲染层拿到的是**工作区 id**，要经 `toRuntimeWorktreeSelector(worktreeId)` 转成 `id:` 前缀的选择器再传。
  **但本特性只支持本地工作区**：agent 是本地子进程，远端（SSH / WSL）工作区的路径在另一台机器上，
  `refactor.propose` 遇到非 `local` 的 `executionHostId` 直接拒绝（见 Task 8）。
- 类型放 `.ts`，不放 `.d.ts`（`src/shared/` 与 `src/preload/` CI 强制）。
- 新文件不得使用 `helpers` / `utils` / `common` / `misc` 命名；按领域概念命名。
- 注释：只写代码本身没说清的原因，一行，写"为什么"不写"怎么做"。
- UI 文案用 `t('auto.components.editor.<File>.<key>', 'default')`；**key 手写进 `en.json`，不跑 `localize-renderer-strings.mjs`**。
  理由：提取器把 `t` / `translate` / `translateMain` 认作本地化调用并跳过它们里面的字符串
  （`audit-localization-coverage.mjs:13`），所以脚本既不收集也不生成上面这种写法的 key；
  它是**改写器**，跑它只会去改上百个与本特性无关的 renderer 文件。
  `check:changed` 真正会跑的三个本地化闸门（`verify-localization-catalogs.mjs`、
  `audit-localization-coverage.mjs --check`、`verify-localization-extraction.mjs`）对手写的 key 全部通过。
  组件里 `t` 来自 `useTranslate()`（`src/renderer/src/i18n/use-translate`），不要直接 import `translate`——后者不随语言切换刷新。
- **渲染层测试要 mock 翻译**：`vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))`。
  不 mock 的话，语言包里的真实译文会把断言里的默认文案换掉，测试就在跟语言包较劲。
- 不默认加测试。本计划列出的测试都是纯逻辑、会在改动被回退时失效、且硬编码期望值的。
- 测试用 `pnpm test <path> --maxWorkers=2`，不要裸跑 vitest。
- 类型检查 `pnpm tc:node`（main + shared）与 `pnpm tc:web`（renderer）。
- 整条分支跑完前必须跑一次 `pnpm check:changed`，不得 `--no-verify`。
  **基线用 `pnpm check:changed --base=9127b3837e`**（本分支起点，merge-base 就是它）。
  不要用默认的 `origin/main`：origin/main 停在 `f90dab5edf`，不含本分支历史里那个 NES 大提交，
  changed 集合会混进别人的几千个文件，vitest 的 "related" 步骤要跑 19 分钟。
  单个任务只跑自己路径的测试、类型检查与 lint；整轮门禁由控制者在分支末尾统一跑。
- 改了 RPC 方法后必须跑 `pnpm generate:rpc-params-catalog` 并提交生成物。
- 不在本计划内新增仓库根目录条目。
- **UI 走设计系统**（`docs/STYLEGUIDE.md`）：
  - 先用 `src/renderer/src/components/ui/` 里的原语，不要自己重造。
    审查 tab 要用到的是 `button`、`checkbox`（方案/文件/代码块三级勾选）、
    `collapsible`（树的展开收起）、`badge`（状态）、`sonner`（toast）。
  - 按钮语义：`default` 是唯一的肯定动作，`secondary` 挨着它，`outline` 给工具栏，
    `ghost` 给图标按钮和行触发器。**「丢弃」是 ghost、不带颜色**——退路不该看起来像破坏性操作。
  - 图标只用 `lucide-react`，默认 `size-4`，颜色继承文字。
  - 滚动条用 `.scrollbar-sleek`（不要自己写第四种）。
  - 文案不能夸大：进行中说中性的话（「正在生成」），结果动词只在真发生时用。
  - toast 只放瞬时结果；用户需要读、需要重试的错误就内联显示。
  - 原语根节点保留 `data-slot`，用 `cn()` 合并并把调用方的 `className` 放在最后。

## Review Focus

规格没有明说、但最可能伤到真实使用者的输入类别。每一条都已挂到拥有该代码的任务里，由该任务自己的测试钉住。

1. **编辑器缓冲区有未保存修改**（B ≠ D）——重构必须基于 B；写盘会连带把这些未保存修改一起保存，界面必须写明。→ Task 8
2. **写闸门被路径穿越绕过**——`..` 逃逸、绝对路径、大小写差异、工具入参里根本没有路径字段。→ Task 3
3. **清单里的相对路径越界**——agent 写进 manifest 的 `files` 可能是 `../../etc/passwd`。→ Task 6
4. **CRLF 行尾与空文件**——hunk 的行号必须对得上原文的切片，否则改错地方。→ Task 2
5. **agent 写了文件却没写进清单，或清单报了文件却不存在**——两种不一致都要有确定行为。→ Task 6
6. **一个方案改多个文件**——hunk 的 id 必须在整个方案里唯一，否则用户在一个文件里勾一个代码块，
   另一个文件的同名代码块也被一起接受。→ Task 2（id 前缀）+ Task 6（builder 传前缀）
7. **机器上有 IT 托管的 Claude 策略**——设置层里的 `permissions.allow` 会让写操作不再经过
   `canUseTool`，闸门必须挂在 allow 规则遮不住的 PreToolUse hook 上。→ Task 5
8. **大小写不同的同一个文件**——macOS 与 Windows 上 `src/Foo.ts` 与 `src/foo.ts` 是同一个文件，
   两个方案各认一个就会互相覆盖。→ Task 6

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
    - `RefactorStatusResult`：`{ state: 'running' | 'done' | 'failed' | 'timed_out' | 'cancelled'; progress: string; warnings: string[] }`
      —— **`timed_out` 是独立取值**：计划 Global Constraints 要求"这一轮是怎么结束的必须体现在 `state` 里"，
      而超时与 SDK 报错若都落在 `'failed'`，用户界面上看到的就都是"失败"，
      只有 warnings 里的文字不同——那不算体现在 `state` 里。
      Task 5 / 7 / 8 / 13 都按这个五值集合走，不要各自重抄。
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
  - `computeRefactorHunks(original: string, modified: string, idPrefix?: string): RefactorHunk[]` —— 位于 `refactor-hunk-computation.ts`
  - `applyRefactorHunks(original: string, hunks: readonly RefactorHunk[]): string` —— 位于 `refactor-hunk-application.ts`
  - hunk 的 `id` 形如 `h1`、`h2`，按 `originalStartLine` 升序编号。
    **`idPrefix` 是可选的，默认空串**（原来的行为不变），但**整个方案里的 hunk id 必须全局唯一**——
    接受集合 `acceptedHunkIds` 是一个扁平的 `Set<string>`，应用时按 id 逐文件匹配，
    两个文件都出现 `h1` 的话，用户在 A 文件勾了 `h1`，B 文件的 `h1` 也会被一起接受。
    所以 Task 6 的 builder 传**文件相对路径**做前缀：id 形如 `src/a.ts:h1`。
    （前缀只在末尾跟 `hN` 这段是唯一的，不需要再解析；id 只做相等比较。）

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

**hunk 的 id 要能带前缀**：`computeRefactorHunks(original, modified, idPrefix?)`，
id 是 `${idPrefix}h1`、`${idPrefix}h2`……，`idPrefix` 默认空串（行为与原来一样）。
前缀是必需的，因为**接受集合是扁平的 `Set<string>`**：一个方案改两个文件时，
两个文件各自都有 `h1`，用户在 A 文件勾 `h1` 会把 B 文件的 `h1` 一起接受。
Task 6 的 builder 传文件相对路径做前缀（`src/a.ts:h1`）。

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
import {
  isPathInsideScratch,
  isPathInsideWorkspace,
  refactorToolAllowed,
  refactorToolTargetPath
} from './refactor-write-gate'

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

  it('rejects a path that escapes once the trailing space is stripped', () => {
    expect(isPathInsideScratch(scratchRoot, '/repo/.orca/refactor/job-1/.. /../evil.ts')).toBe(
      false
    )
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

  it('denies a write whose escape only appears once the trailing space is stripped', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Write',
        toolInput: { file_path: '/repo/.. /../evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })

  it('denies a read whose escape only appears once the trailing space is stripped', () => {
    expect(
      refactorToolAllowed({
        toolName: 'Read',
        toolInput: { file_path: '/repo/.. /../evil.ts' },
        scratchRoot,
        workspaceRoot
      })
    ).toBe(false)
  })
})

describe('refactorToolTargetPath', () => {
  it('reads the camel-cased path key', () => {
    expect(refactorToolTargetPath({ filePath: '/repo/src/foo.ts' })).toBe('/repo/src/foo.ts')
  })

  it('reads the bare path key', () => {
    expect(refactorToolTargetPath({ path: '/repo/src/foo.ts' })).toBe('/repo/src/foo.ts')
  })
})

describe('isPathInsideWorkspace', () => {
  it('rejects a path that escapes once the trailing space is stripped', () => {
    expect(isPathInsideWorkspace('/repo', '/repo/.. /../evil.ts')).toBe(false)
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
- **Windows 的盘符相对路径（`D:foo`）也必须拒绝**。`path.win32.isAbsolute('D:foo')` 是 **false** ——
  Windows 按 D 盘的**当前目录**解析它，所以它命名的文件不在工作区里，
  而闸门会把它当成工作区根下的一个普通相对路径放行。
  逐段用 `/^[A-Za-z]:/` 识别；判定必须再加一个 `!path.isAbsolute(target)` ——
  那个正则同样匹配**绝对**的 Windows 路径（`C:\repo\src\foo.ts` 也以 `C:` 开头），
  少了这一半，Windows 上每一次读和每一次写都会被拒掉。
  **在所有平台上一致**：POSIX 上 `D:foo` 只是工作区里的一个怪文件名，同样不是用户要的路径，
  宁可拒掉一条没人需要的路径，也不要让同一条规则在两个平台上给不同的答案。
  导出 `isWindowsDriveRelativePath(relativePath: string): boolean`，
  **闸门模块和路径规则模块共用这一份**（`refactor-path-rules.ts` 从这里 import）——
  两层各写一遍正则，它们迟早会分叉。
- **这条规则必须作用在「原始路径」上，不能只查解析之后的路径**。原因是一个具体的抵消例子：
  原始路径 `/repo/.. /../evil.ts` 里，`path.resolve` 只折叠**精确**的 `..`，于是 `.. ` 是个普通分段，
  紧跟其后的 `..` 把它弹掉，结果是 `/repo/evil.ts`——**看着在根内**；
  但 Windows 先把 `.. ` 的尾空格剥掉，它就变成 `..`，整条路径实际落在 `/evil`。
  所以：先在原始路径上查这条规则，再解析，再做包含判断。
- 导出 `hasUnsafePathSegment(targetPath: string): boolean`（这条规则本身）。
  **两个包含判断函数里也要查一遍**，因为它们是导出的、会被直接调用：
  - `isPathInsideScratch(scratchRoot, targetPath)` —— **targetPath 必须是绝对路径**
    （调用方自己按工作区根解析相对路径；这里不解析相对路径，因为相对路径的基准根在两个函数里不一样）。
    依次：① `hasUnsafePathSegment(targetPath)` 命中就 `false`；② `path.resolve` 两边，
    判断 `resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)`。
  - `isPathInsideWorkspace(workspaceRoot, targetPath)` —— 同一套逻辑，根换成工作区根。
  - **比较区分大小写**——大小写不敏感的文件系统上这会拒掉一个大小写不同的合法路径，那是安全的方向；agent 总是用 prompt 里给的原样路径写。
  - **不要改用仓库里的 `isPathInsideOrEqual`**（`src/shared/cross-platform-path.ts:159`）——它的
    `normalizeRuntimePathForComparison` 会把 Windows 风格路径小写化，与上面的大小写敏感要求冲突。
    写一行注释说明为什么不用它，免得后人"顺手去重"时把大小写敏感的围栏改回大小写不敏感。
- `refactorToolAllowed`：
  - `toolName` 是 `Write` / `Edit` / `MultiEdit` → 取路径；取不到就**拒绝**（fail-closed）；
    **在原始路径上**查 `hasUnsafePathSegment`，命中就拒绝；再 `path.resolve(workspaceRoot, target)`
    （相对路径按工作区根解析）后交给 `isPathInsideScratch`。
    **放行 `MultiEdit` 是必须的**：它是 Claude Code 真实存在的编辑工具，拒掉它等于堵死一条正当的编辑路径，agent 可能转去找 `Bash` 之类的绕路（那些也被拒），功能就废了。
  - `toolName` 是 `Read` → 取路径；**取不到就拒绝**；同样先查原始路径的分段规则，再要求它落在**工作区根内**。
  - `toolName` 是 `Grep` / `Glob` → 路径可选（不给就从 cwd 搜，而 cwd 就是工作区根）；给了就同样处理。
  - 其它工具名 → **拒绝**。`Bash` 必须在拒绝名单里，否则 agent 能用 `mv` 绕过写闸门。

**读也要圈在工作区里**，不只是写。读工具放行机器上任何路径，等于让 agent 能读 `~/.ssh/id_rsa`
或 `~/.aws/credentials`——而这个 agent 处理的正是**不可信的**文件内容（提示注入的入口）。
工作区根的判定用同一套 `path.resolve` + 分隔符边界，只是根换成 `workspaceRoot`；
暂存目录在工作区里，所以自然可读。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-write-gate.test.ts --maxWorkers=2`
Expected: PASS，31 个用例全过。

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
  - `REFACTOR_PERMISSION_SETTINGS`：传给 SDK `options.settings` 的围栏设置
    （`{ permissions: { blockReadsOutsideWorkingDirectories, blockWritesOutsideWorkingDirectories, disableBypassPermissionsMode, disableAutoMode } }`）——
    理由见 Step 4。这是闸门之外 CLI 自己那一层的围栏，managed 设置抬不起来。
  - `REFACTOR_DISALLOWED_TOOLS`：`readonly string[]` = `['Bash', 'PowerShell', 'Task', 'Agent', 'NotebookEdit', 'WebFetch', 'WebSearch']`
    —— 这些是**脱离路径模型**的工具，从模型的上下文里直接去掉（写闸门本来也拒它们，这是第二道）：
    - `Bash` / `PowerShell`：两个 shell。`Bash` 能 `mv`/`cp`，`PowerShell` 在 Windows 上是同一个洞。
    - `Task` / `Agent`：派生子 agent。SDK 文档里这个工具叫 "Agent/Task tool"
      （`sdk.d.ts:6664`），**两个名字都要列**——只列一个的话另一个名字的工具照样出现在模型面前。
      子 agent 的工具调用未必走我们的闸门，所以这个洞要在模型看不见的地方堵。
    - `NotebookEdit`：写文件。
    - `WebFetch` / `WebSearch`：**能把用户的源码发到网络上**。这个 agent 的工作内容就是读用户的私有代码，
      给它联网工具等于给了它一条外传通道。
    - SDK 的 `BUILTIN_TOOL_NAMES`（`sdk.d.ts:214`）列了这些名字；列表里出现一个当前平台没有的工具是安全的
      （文档写明"A name is listed even where a platform or setting turns its tool off"）。
  - **`options.allowedTools` 一律不给**（保持 `undefined`）。SDK 对 `allowedTools` 的定义是"自动放行、不再询问"，
    而 `canUseTool` 是"每次工具执行前调用"——把 `Write`/`Edit` 列进 `allowedTools`，CLI 可能就绕过闸门直接放行写操作。
    不给这个选项，所有工具调用都走 `canUseTool`。
    **注意这还不够**：设置层里的 allow 规则同样会遮蔽 `canUseTool`
    （SDK 原话："Allow rules from settings files can also shadow the callback"），
    所以闸门的最终形态是 Task 5 的 PreToolUse hook，`canUseTool` 只是第二层。

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-agent-launch.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  REFACTOR_DISALLOWED_TOOLS,
  REFACTOR_PERMISSION_SETTINGS,
  resolveRefactorAgentLaunch
} from './refactor-agent-launch'

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

  it('keeps the shell, the subagent and the network out of reach', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    for (const tool of ['Bash', 'PowerShell', 'Task', 'Agent', 'WebFetch', 'WebSearch']) {
      expect(launch.options.disallowedTools).toContain(tool)
    }
  })

  it('refuses reads and writes outside the working directory at the cli level', async () => {
    const launch = await resolveRefactorAgentLaunch({
      cwd: '/repo',
      deps: {
        resolveCommand: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
        resolveAuthPolicy: () => ({ account: 'system' })
      }
    })
    expect(launch.options.settings).toBe(REFACTOR_PERMISSION_SETTINGS)
    expect(REFACTOR_PERMISSION_SETTINGS.permissions.blockReadsOutsideWorkingDirectories).toBe(true)
    expect(REFACTOR_PERMISSION_SETTINGS.permissions.blockWritesOutsideWorkingDirectories).toBe(true)
    expect(REFACTOR_PERMISSION_SETTINGS.permissions.disableBypassPermissionsMode).toBe('disable')
    expect(REFACTOR_PERMISSION_SETTINGS.permissions.disableAutoMode).toBe('disable')
  })
})
```

若 `resolveCommand` 的实际返回形状与这里不同，以 `ClaudeEnvDeps['resolveCommand']` 的定义为准（`StructuredAgentCommand`），测试按真实形状写。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-agent-launch.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 加上 SDK 选项字段**

在 `claude-structured-launch-resolution.ts` 的 `ClaudeStructuredSdkOptions` 的 Pick 列表里加 `'allowedTools'` 与 `'disallowedTools'`，
**外加 `'hooks'`**（Task 5 的闸门要挂成 PreToolUse hook，见 Task 5）。
SDK 的 `Options` 上确实有这三个字段（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1660` 与 `:1680`，
`hooks` 在 `:1807`），`allowedTools` / `disallowedTools` 类型都是 `string[]`——
所以 `disallowedTools` 要写 `[...REFACTOR_DISALLOWED_TOOLS]`（展开成新数组），
不能直接把 `readonly string[]` 赋过去。
`hooks` 的类型是 `Partial<Record<HookEvent, HookCallbackMatcher[]>>`，
它在 SDK 的 `Options` 上是可选的，加进 Pick 不会影响任何既有启动。

- [ ] **Step 4: 实现启动解析**

在 `refactor-agent-launch.ts`：

```ts
export const REFACTOR_DISALLOWED_TOOLS: readonly string[] = [
  'Bash',
  'PowerShell',
  'Task',
  'Agent',
  'NotebookEdit',
  'WebFetch',
  'WebSearch'
]
```

`resolveRefactorAgentLaunch` 调 `resolveClaudeStructuredInvocation(deps)` 拿到 `{ command, prefixArgs, env, account }`，然后返回：

- `pathToClaudeCodeExecutable: invocation.command`
- `prefixArgs: invocation.prefixArgs`
- `env: invocation.env`
- `cwd: input.cwd`
- `options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, permissionMode: 'default', disallowedTools: [...REFACTOR_DISALLOWED_TOOLS], settingSources: [], settings: REFACTOR_PERMISSION_SETTINGS }`

**再加一层 CLI 自己的围栏**（`settings` 选项，等价于 `--settings`）：

```ts
export const REFACTOR_PERMISSION_SETTINGS = {
  permissions: {
    blockReadsOutsideWorkingDirectories: true,
    blockWritesOutsideWorkingDirectories: true,
    disableBypassPermissionsMode: 'disable',
    disableAutoMode: 'disable'
  }
} satisfies Settings
```

`Settings` 从 SDK 导入（`import type { Settings } from '@anthropic-ai/claude-agent-sdk'`）。
用 `satisfies` 而不是 `as const`——仓库的门禁明确放行 `as const`，但 `satisfies` 更贴切：
它检查形状而不把字面量类型压窄。

这四条不是装饰，是补闸门补不到的两个洞：

- **`blockReadsOutsideWorkingDirectories`** —— SDK 文档写得很直白：
  "Refuse file-tool reads (Read, Grep, Glob, LSP) outside the working directories **in every permission mode**;
  **true in any settings source wins. No allow rule lifts it.**"
  这一条堵的是"CLI 在 `default` 模式下对只读工具不询问、于是 `canUseTool` 根本不会被调用"的情况——
  那种情况下我们的读围栏（读只在工作区内）就形同虚设，agent 能读到 `~/.ssh/id_rsa`。
  有了它，读越界由 CLI 自己拒，而且**任何 allow 规则都抬不起来**。
- **`blockWritesOutsideWorkingDirectories`** —— 同理，"Refuse file-tool writes (Write, Edit, NotebookEdit)
  outside the working directories in every permission mode; true in any settings source wins.
  No allow rule lifts it." 它还顺带把 `EnterWorktree` / `ExitWorktree` 从工具列表里拿掉
  （那两个会移动工作目录）。工作目录就是工作区根，暂存目录在工作区根底下，所以闸门放行的写不受影响。
- **`disableBypassPermissionsMode` / `disableAutoMode`** —— 把「跳过权限询问」和「让分类器替我们决定」这两条路堵死。

**为什么必须有这一层**：`settingSources: []` 只关掉 user/project/local 三层设置，
**managed 那一层照旧从磁盘读**（SDK 文档："the managed-settings policy tier is still read from disk"）。
机器上如果被 IT 托管过、`managed-settings.json` 里有 `permissions.allow: ["Write"]`，
那条 allow 规则会让写操作不再经过 `canUseTool` —— 闸门就绕过了。
**`blockWritesOutsideWorkingDirectories` 挡不住这个**：它的 "No allow rule lifts it" 说的是
"工作目录之外的写"这条封锁抬不起来，而用户的真实源码**就在工作目录里面**（工作目录 = 工作区根）。
真正兜住这件事的是 Task 5 的 PreToolUse hook（allow 规则遮不住 hook）。

四处选项各有理由，缺一个闸门就失效：

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
- Create: `src/main/refactor/refactor-tool-hook.ts`
- Create: `src/shared/refactor/refactor-prompt.ts`
- Test: `src/main/refactor/refactor-runner.test.ts`
- Test: `src/main/refactor/refactor-tool-hook.test.ts`

**Interfaces:**

- Consumes: Task 4 的 `RefactorAgentLaunch`；Task 3 的 `refactorToolAllowed`；`openClaudeStreamJsonConnection`（`src/main/claude/claude-stream-json-connection.ts`）；`CanUseTool` / `PermissionResult`（SDK）
- Produces:
  - `src/shared/refactor/refactor-prompt.ts` 导出 `buildRefactorPrompt(input: { relativePath: string; sourceRelativePath: string; scratchRelativeRoot: string; instruction?: string }): { system: string; user: string }`
  - `src/main/refactor/refactor-runner.ts` 导出：
    - `RefactorTurnResult`：`{ state: RefactorStatusResult['state']; manifest: RefactorManifest | null; progress: string; warnings: string[] }`
      —— `state` 用 `RefactorStatusResult['state']` 的索引访问，不要把 `'running' | 'done' | 'failed' | 'timed_out' | 'cancelled'`
      重抄一遍（Task 7 的注册表也用这个类型）。
      **这一轮是怎么结束的必须体现在 `state` 里**：Task 8 拿它直接 `update` job 的状态。
      没有它的话，超时、SDK 报错、进程崩溃都会变成"正常结束"——用户看到的是"agent 什么都没产出"，
      而不是"agent 报错了"。
      **超时是独立的 `'timed_out'`**，不是 `'failed'`——两者的处理动作不同（一个要重试，一个要看错误信息），
      混在一起用户就没法只重试超时的那些。
      **所以 `src/shared/rpc-contract/refactor-params.ts` 的 `RefactorStatusResult` 要加这个成员**：
      `state: z.enum(['running', 'done', 'failed', 'timed_out', 'cancelled'])`。
      那个文件是 Task 1 的产出，但 Task 7 的注册表与 Task 8 的 RPC 都用同一个类型，
      枚举在这里加一处，下游全都跟着走（都是索引访问，没有第二份拷贝）。
    - `runRefactorTurn(input: { launch: RefactorAgentLaunch; scratchRoot: string; workspaceRoot: string; prompt: { system: string; user: string }; onProgress?: (text: string) => void; signal: AbortSignal }): Promise<RefactorTurnResult>`
      - **`workspaceRoot` 必须等于 `launch.cwd`**（传 `launch.cwd` 进去，不要另传一个）。
        闸门把相对路径按 `workspaceRoot` 解析，而 SDK 把相对路径按进程的 cwd 解析——
        两者不一致时，闸门可能批准一个 SDK 根本不会写的位置，而 SDK 真正写的地方在暂存目录之外。
        传同一个值就没有这个缺口。
        **这一条要在代码里强制，不要只靠调用方记得**：加一个 `assertRefactorWorkspaceRoot(launch, workspaceRoot)`，
        不相等就抛错。这是安全边界，静默放过等于把闸门的围栏开一个口子。
        （调用方因此必须传 `launch.cwd`——Task 8 就是这么做的。）
      - **`scratchRoot` 必须在 `workspaceRoot` 里面**：prompt 里告诉 agent 的暂存根是**相对**路径
        （`<scratchRelativeRoot>`），而闸门与清单读取用的是**绝对**的 `scratchRoot`。
        两者若不是同一个位置，闸门会拒绝 agent 每一次相对写入（相对路径按 `workspaceRoot` 解析），
        而 runner 去读一个没人写过的清单——一轮看起来像"agent 什么都没产出"的正常失败。
        加一个 `assertRefactorScratchRoot(workspaceRoot, scratchRoot)`：
        `path.relative(workspaceRoot, scratchRoot)` 不得以 `..` 开头、不得是绝对路径。
        Task 8 那边必须用 `path.join(workspaceRoot, scratchRelativeRoot)` 算这个值，不要各算各的。
      - **闸门的权威性要在 runner 里再断言一次**：`launch.options.permissionMode` 必须是 `'default'`，
        且 `launch.options.allowedTools` 里不能有裸工具名。
        SDK 明确警告过（`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`）：
        "Bare allowedTools entries auto-approve the whole tool before the callback is consulted"，
        `permissionMode: 'bypassPermissions'` 更是直接放行一切——
        两种情况下 `canUseTool` 根本不会被调用，整个写闸门形同虚设。
        Task 4 的 launch 今天是安全的，但 runner 是**接线 `canUseTool` 的那个模块**，
        它的安全性不该依赖另一个模块的选项永远不变。
        断言失败就抛错，不要降级成 warning。
    - `parseRefactorToolProgress(message: Record<string, unknown>, workspaceRoot: string): string | null` —— 从一条 SDK 消息里抽出进度文案；没有工具调用时返回 `null`。
      **第二个参数是工作区根**：进度文案里要显示**相对工作区**的路径，而工具入参给的是绝对路径。
      单独导出是为了能脱开 SDK 单测。
    - `src/main/refactor/refactor-tool-hook.ts` 导出
      `createRefactorToolHook(input: { scratchRoot: string; workspaceRoot: string }): HookCallbackMatcher[]`
      —— 闸门挂成 SDK 的 **PreToolUse hook**（这是唯一不被设置层 allow 规则遮蔽的裁决点，见下）。
      返回值直接塞进 `launch.options.hooks.PreToolUse`。
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
  it('names the file a write tool is writing, relative to the workspace', () => {
    const text = parseRefactorToolProgress(
      {
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
      },
      '/repo'
    )
    expect(text).toBe('正在写入 .orca/refactor/job-1/p1/src/foo.ts')
  })

  it('returns null for a message with no tool use', () => {
    expect(
      parseRefactorToolProgress(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hi' }] }
        },
        '/repo'
      )
    ).toBeNull()
  })
})
```

同一个测试文件里还要补上这几组用例（审查指出"判定逻辑不可测"是这一轮唯一的产品级缺陷）：

- `describe('classifyRefactorResult')`
  - `subtype: 'success'` 且 `is_error` 不为 true → `state: 'done'`，warnings 为空。
  - `subtype: 'success'` 且 `is_error: true` → `state: 'failed'`，warnings 里带 `is_error` 的错误文本。
  - 四种错误 subtype 各一条 → `state: 'failed'`，warnings 里同时有 `subtype` 与 `stop_reason`。
- `describe('decideRefactorTurnOutcome')`
  - 结果先到、之后才取消 → 采信结果（`'done'`），**后来的取消不回滚已完成的 turn**。
  - 取消先到 → `'cancelled'`，warnings 含"任务已取消"。
  - 没有结果、超时先到 → `'timed_out'`，warnings 含"任务超时"。
  - 没有结果、崩溃先到 → `'failed'`，warnings 带崩溃信息。
  - 没有结果、什么都没发生 → `'failed'`（不能默认成 `'done'`）。
- `describe('parseRefactorToolProgress')` 补上四条分支：
  `Read` 工具、`Edit`/`MultiEdit` 工具、未知工具名、`input` 里没有路径字段。
  未知工具与缺路径都返回 `null`（不编造进度文案）；`Read` 与 `Write` 的文案不同。
- **prompt 的断言不能只靠 `toContain` 子串**：上面 `buildRefactorPrompt` 的四条用例要改成
  断**整句**（例如用正则匹配"只能写"与暂存根同现的那一句），
  否则删掉"禁止写暂存目录以外"这句话、只要别处还出现过那个路径，测试照样通过。
  断言要能在那句话被删掉时真的失败。

另开一个 `src/main/refactor/refactor-tool-hook.test.ts`，钉住 hook 本身：

- 放行的工具（`Read` 工作区内的路径）→ hook 返回**不**带 `permissionDecision: 'deny'` 的结果。
- 越界的写（`Write` 到暂存目录之外）→ 返回 `deny`，且 `permissionDecisionReason` 非空
  （理由不给用户看就是静默拒绝，agent 只会换个写法再试）。
- 越界的读（`Read` 工作区之外）→ 返回 `deny`。
- 未知工具（`Bash`）→ 返回 `deny`。
- `tool_input` 不是对象（`null` / 字符串 / 数组）→ **返回 `deny`**，
  裁决函数拿不到路径就没法证明它落在允许范围内，所以失败即拒绝。
- 裁决函数抛异常 → **返回 `deny`**（失败即拒绝，不要让异常冒到 CLI 那边变成放行）。
  这条要用一个会抛异常的输入打掉它，不许靠"回调里没有抛异常的路径"蒙混过去。

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
  `files` 里是**相对工作区根**的路径，不带 `./` 前缀、不带暂存目录前缀——
  清单里的路径会被拼成 `<scratchRelativeRoot>/<proposalId>/<路径>` 去读暂存文件，
  所以它必须正好是相对工作区根的那一份。
  （带 `./` 前缀的路径会被路径检查拒掉，整个方案连带被丢弃。）
- `rationale` 说清**为什么**这么改，不是改了什么。
- 最多 5 个方案，每个方案最多 5 个文件；两个方案不能改同一个文件。
- **不要**在回答里贴文件内容或 JSON，一切通过写文件产出。

user 段包含目标文件的相对路径、暂存根的相对路径、用户的可选指令原文。

- [ ] **Step 4: 实现 runner**

在 `refactor-runner.ts`：

- `parseRefactorToolProgress(message: Record<string, unknown>, workspaceRoot: string): string | null` —— 从 SDK 消息里找 `message.content` 数组中的 `type === 'tool_use'` 的块，用 `name` 与 `input` 拼一句中文进度：
  - `Write` / `Edit` / `MultiEdit` → `正在写入 <相对路径>`
  - `Read` → `正在读取 <相对路径>`
  - 其它工具名 → `正在使用 <name>`
  - 路径取 `input.file_path`，显示时用 `path.relative(workspaceRoot, p)`（所以要传 workspaceRoot）；
    取不到路径就只用工具名。
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
     **必须显式返回 deny 对象，不能返回 `null`** —— SDK 文档在 `CanUseTool` 的注释里写明：
     `Return null ONLY after the consumer has already sent the control_response out-of-band`，
     而且 "an accidental null means no control_response is sent and the tool stays blocked
     indefinitely — permission prompts have no park deadline"。
     也就是返回 `null` 的话那次工具调用会**永远挂着**，整个 turn 就卡死了。
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
     成功的帧是 `subtype: 'success'` → `state: 'done'`；
     失败的帧是
     `subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'`，
     带 `is_error` 和 `stop_reason` → `state: 'failed'`，并把 `subtype` 与 `stop_reason`
     写进 `warnings` —— 否则这一轮报错会被当成正常结束，用户看到的是"agent 什么都没产出"，
     而不是"agent 报错了"。失败时如果暂存目录里已经有文件，仍然照常读清单（可能有部分产出），
     但警告里必须说明这一轮是失败结束的。
     **`subtype: 'success'` 但 `is_error: true` 仍然是失败**：SDK 文档写得很清楚
     （sdk.d.ts:6066）——"subtype \"success\" carries the final assistant text in result —
     **or, with is_error true, the error text when the turn ended on an API error**"。
     也就是说这一轮是死在 API 错误上的，只是错误 subtype 还没来得及标出来。
     只看 subtype 会把 API 错误报成"正常完成"，用户看到的是空白的审查界面。
     所以判定是：`subtype === 'success' && !is_error` 才算 `'done'`。
     **也要接 `handlers.onFault` 与 `handlers.onExit`**：CLI 崩了或被杀掉的时候不会有 `result` 帧，
     只等 `result` 就会一路挂到 5 分钟超时才罢休。两者任一触发就结束等待，
     `state: 'failed'`，并把错误信息写进 `warnings`（`onExit` 的 `expected` 为 false 时说明是非预期退出，更该写明）。
  5. 结束后读 `<scratchRoot>/manifest.json`，用 `RefactorManifest.safeParse` 解析；解析失败返回 `manifest: null` 并在 `warnings` 里写明原因。
     读它也要带大小上限（清单是 agent 写的外部输入）：用 `readNodeFileWithinLimit(path, 1 * 1024 * 1024)`（`src/shared/file-content/node-bounded-file-reader.ts`），超限按"解析失败"处理。
  6. 超时：`REFACTOR_TURN_TIMEOUT_MS = 300_000`（5 分钟）。到点中止并关连接，
     **`state: 'timed_out'`**，warnings 写明"任务超时"。
     超时不是 `'failed'`：超时值得单独重试，SDK 报错要看错误信息，混在一起就分不出该重试哪一个。
  7. `signal` 触发时同样中止并关连接，**`state: 'cancelled'`**，`warnings: ['任务已取消']`。
  8. 无论成功失败都要关闭连接（`close()` 走现成的退出证明 ladder）。
     **判定结果之前先把连接排空**：`close()` 返回 true 之后再定这一轮是成功还是失败。
     CLI 退出得比它自己的 result 帧快时（一次很短的 turn 就是这样），
     不排空就先看到退出事件，一次成功的 turn 会被报成失败。
     `close()` 返回 false 表示还没拿到退出证明，这时要读 `connection.exitVerdict` 看清根进程与后代树的证据，
     再决定这一轮算不算失败。
     **`close()` 自己抛出时不能把判定结果一起丢掉**：把它包在 try/catch 里，
     把异常写进 warnings 然后**照常返回已经算好的 verdict**——
     连接关不掉是另一件事（进程可能还活着），它不该抹掉这一轮到底成功没成功的结论。
     `close()` 返回 false 也要写一条 warning（"子进程未确认退出"），它同样是"没拿到退出证明"。
  9. **闸门必须挂成 PreToolUse hook，不能只挂在 `canUseTool` 上**。
     SDK 文档原话："Bare allowedTools entries auto-approve the whole tool before the callback is
     consulted. To gate every tool call, use a PreToolUse hook instead; or remove the bare names
     from allowedTools so they fall through to canUseTool. **Allow rules from settings files can also
     shadow the callback.**"
     也就是说设置层里的 `permissions.allow: ["Write"]` 会让写操作**根本不再调用 `canUseTool`**，
     而 `settingSources: []` 关不掉 managed 层（它照旧从磁盘读），
     `blockWritesOutsideWorkingDirectories` 又只管"工作目录之外"——用户的真实源码就在工作区根底下。
     所以机器上若被 IT 托管过，闸门会被整个绕开。
     **实测结论**（本机 claude 2.1.319 + SDK 0.3.318）：
     设置里带 `permissions.allow: ["Write"]` 时，PreToolUse hook 照样被调用，
     hook 的 `deny` 照样把写操作挡住；走 SDK 的 `options.hooks`（进程内回调）也一样。
     hook 跑在权限判定之前，allow 规则遮不住它。
     实现要求：
     - `refactor-tool-hook.ts` 里注册一个 PreToolUse 回调，`matcher` 不设（匹配所有工具），
       拿 `tool_name` / `tool_input` 走**同一个** `refactorToolAllowed`，
       不允许就返回 `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: ... } }`。
     - **matcher 必须设 `onFailure: 'block'`**。SDK 的契约（`sdk.d.ts:1014-1020` 与 `:5490`）：
       默认的 `'continue'` 是"hook 失败了就报告一声，动作照做"——
       回调送不到、CLI 侧超时、或者 CLI 根本不认 initialize 里的 `hooks` 字段，
       闸门就一次都不会拒绝，工具照写。而此时设置层的 allow 规则又让 `canUseTool` 也不被问，
       整个闸门等于没有。`'block'` 把这条也堵上：
       "the query fails at startup on a Claude Code that does not support the option …
       and the first prompt is sent only once those checks have passed."
       也就是说**跑不了的 CLI 干脆不许跑这一轮**（回合失败，警告里带着 SDK 自己的话），
       而不是让它在闸门缺席的情况下跑。
     - **回调的入参是 `HookInput`（一个联合类型）**，只有 `PreToolUseHookInput` 变体上才有
       `tool_name` / `tool_input`。所以要先判 `input.hook_event_name === 'PreToolUse'`，
       不是就放行（注册在 PreToolUse 下时轮不到别的变体，但类型上要收窄）。
     - **失败即拒绝**：回调里抛异常时返回 deny，不要让异常冒到 CLI 那边变成"放行"。
     - hook 的 `tool_input` 是 `unknown`，要先判断它是不是对象再交给裁决函数。
     - 拒绝的理由里要带上**工具名与它想写的路径**，否则 agent 只能回去重读 prompt 才知道为什么被拒。
     - `canUseTool` 保留为第二层，两者共用同一个裁决函数。
     - 在 `runRefactorTurn` 里把 hook 挂上去：`launch.options` 是只读的，
       所以用 `{ ...launch, options: { ...launch.options, hooks: { PreToolUse: createRefactorToolHook({ scratchRoot, workspaceRoot }) } } }`
       组成新的 launch 再传给 `openClaudeStreamJsonConnection`——
       连接层会把 `launch.options` 整个展开进 SDK 的 query options，hook 因此能到达 CLI。
  10. **判定逻辑要能被测试直接钉住**：把"这一轮怎么结束的"抽成**纯函数**并导出，
      transport（开连接、发帧、等结果）留在 `runRefactorTurn` 里。
      没有这一步，"排空再判定"这种一行重排就能把成功的 turn 全报成失败的地方，
      没有任何一个测试会响。
      两个纯函数：
  - `classifyRefactorResult(result: SDKResultMessage): { state: 'done' | 'failed'; warnings: string[] }`
    —— 收成功帧与四种错误帧，返回 `'done'` 或 `'failed'` 及 warnings。
  - `decideRefactorTurnOutcome(input: { result: { state: 'done' | 'failed'; warnings: string[] } | null; cancelled: boolean; timedOut: boolean; fault: string | null }): { state: RefactorStatusResult['state']; warnings: string[] }`
    —— 决定最终 state 与 warnings。**取消优先于结果**：取消先到就是 `'cancelled'`；
    结果先到就采信结果（后来的取消不回滚一个已完成的 turn）；
    结果没有而超时了就 `'timed_out'`；再没有而崩溃了就 `'failed'`。

- [ ] **Step 5: 跑测试确认它通过**

Run: `pnpm test src/main/refactor --maxWorkers=2`
Expected: PASS。

- [ ] **Step 6: 类型检查与提交**

```bash
pnpm tc:node
git add src/main/refactor src/shared/refactor/refactor-prompt.ts src/shared/rpc-contract/refactor-params.ts
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
      `{ id: 目录名, files: 目录里的文件相对「方案目录」的路径 }`。
      暂存目录内部那层结构照搬工作区的相对路径，所以 `<scratchRoot>/p1/src/foo.ts` → `files: ['src/foo.ts']`，
      `scratchFiles(id, file)` 读到的就是 `<scratchRoot>/<id>/<file>`。
      **注意不是相对工作区根**（那是 `.orca/refactor/<jobId>/p1/src/foo.ts`，多了一层，拼出来读不到）。
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

  it('keeps the disk content aside for the staleness check', async () => {
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
    expect(result.diskContents.get('src/foo.ts')).toBe('a\n')
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

审查之后补的用例（每一条都要能打掉对应的实现）：

- **hunk id 在整个方案里唯一**：一个方案改两个文件，两个文件各有 hunk 时，
  两个 hunk 的 id 不许相同（断言 `id` 形如 `src/a.ts:h1` / `src/b.ts:h1`）。
  这条打掉的是"每个文件各自从 `h1` 开始编号"。
- **大小写不同的同一个文件算冲突**：`p1` 改 `src/Foo.ts`、`p2` 改 `src/foo.ts` → 只留 `p1`，并有警告。
- **重复的方案 id**：清单里两个 id 相同的方案 → 后一个被丢掉并有警告。
- **清单里 id 为 `_source` 的方案被忽略**，并留下一条 warning（不是静默丢弃）。
- **被丢弃的方案不留痕迹**：两个方案冲突时，被丢弃那个方案的**另一个**文件
  也不能进 `diskContents`（断言 `diskContents.has('src/other.ts')` 为 false）。
  只断言被丢弃方案与保留方案共用的那个文件是不够的——那条值两个方案都会写。
- **"agent 未给出理由"只对保留下来的方案发**：清单缺失时若某个重建方案被丢弃，
  warnings 里就不该出现这条。

- [ ] **Step 2: 跑测试确认它失败**

Run: `pnpm test src/main/refactor/refactor-plan-builder.test.ts --maxWorkers=2`
Expected: FAIL，报模块不存在。

- [ ] **Step 3: 实现 plan builder**

在 `refactor-plan-builder.ts`：

- `isSafeRelativeRefactorPath(relativePath)`：**两道都要过**。
  1. `isSafeMobileRelativePath(relativePath)`（从 `src/main/runtime/files/mobile-file-kind.ts` 导入）——
     它拒绝绝对路径、Windows 盘符前缀，以及任何 `..` / `.` / 空路径段。不要自己重写这段检查。
  2. `!hasUnsafePathSegment(relativePath)`（Task 3 的导出）——**查原始路径**。
     清单里的路径会被拼成 `<scratchRoot>/<proposalId>/<path>` 去读暂存文件，
     而 `.. ` 在 Windows 上就是"上一级目录"；`isSafeMobileRelativePath` 不管末尾点/空格。
     路径解析还会把 `.. ` 和后面的 `..` 抵消掉（`.. /../evil` 解析后看着在根内，实际落在根外），
     所以必须在解析之前查。
- `buildRefactorPlan`：
  1. 遍历 manifest 的 proposals，维护一个 `claimedPaths: Map<string, string>`（**小写的路径 → 拥有它的方案 id**）。
     **键要小写**：macOS 与 Windows 默认不区分大小写，`src/Foo.ts` 与 `src/foo.ts` 是同一个文件；
     按原样比较的话两个方案会各自"拥有"同一个文件，最后一次写把前一次静默盖掉。
     误判成冲突的代价是丢掉一个方案，漏判成冲突的代价是用户的文件被静默覆盖——所以往严的一边偏。
  2. **一个方案要么整个留下，要么整个丢掉**——不要半留半丢，否则审查界面里会出现一个缺文件的方案。
     所以先把这个方案的所有文件校验完，再一次性提交到 `claimedPaths`。
  3. **方案 id 也要占坑**：同一个 id 出现两次时，后一个丢掉并给警告——
     审查界面按 id 认方案，两个同 id 的方案没法区分。
  4. 每个 proposal 的每个 file，依次：
     a. 过 `isSafeRelativeRefactorPath`——不过就记 warning 并丢掉整个 proposal。
     b. 若 `claimedPaths` 已含该 path（小写比较），记 warning（"方案 X 与方案 Y 改同一个文件，已丢弃后者"）并丢掉整个 proposal。
     **这个检查放在读文件之前**：先读完再发现冲突，`diskContents` 里已经多了一条被丢弃方案的磁盘内容。
     c. 读暂存文件 `scratchFiles(proposal.id, path)`；读不到（`null`）就记 warning 并丢掉整个 proposal。
     d. 读基准文本 `readBaseline(path)`；读不到就记 warning 并丢掉整个 proposal。
     e. 读磁盘内容 `readDiskContent(path)`；读不到就记 warning 并丢掉整个 proposal。
  5. 这个方案的所有文件都过了，才把它们的路径加进 `claimedPaths`，并把每个文件变成
     `{ path, originalContent: baseline, hunks }`，其中 `hunks = computeRefactorHunks(baseline, scratchContent, `${path}:`)`；
     磁盘内容存进 `diskContents`（path → D）。
     **第三个参数是 hunk id 的前缀**：接受集合 `acceptedHunkIds` 是一个扁平的 `Set<string>`，
     不加前缀的话两个文件都会出现 `h1`，用户在 A 文件勾了 `h1`，B 文件的 `h1` 也被一起接受。
  6. **空 hunks 的方案也要保留**——内容没变的方案不是错误，只是没有可接受的东西。
  7. manifest 为 `null` 时：调 `listScratchProposals()`，**排除 id 为 `_source` 的那一项**，
     其余每一项当作一个方案：`id` 用目录名，`files` 用它返回的文件列表，
     `title` 用目录名，`rationale` 留空串，并在 warnings 里写"agent 未给出理由"。
     之后走与上面一样的校验流程（路径安全、暂存文件可读、基准可读、磁盘可读、同文件冲突）。
     **必须排除 `_source`**——它是发起时写下的基准副本，不是某个方案的重构产物；
     把它当成方案会在审查界面里多出一个叫 `_source` 的空方案。
     **排除它的时候要留一条 warning**（"方案 _source 是基准副本，已忽略"）——
     别的丢弃都有警告，只有它悄悄消失的话，用户会以为计划里没有那个东西。
     **"agent 未给出理由"这条警告只对保留下来的方案发**——被丢掉的方案已经不在计划里了，
     再提它没有理由只会让人困惑。
  8. 返回 `{ plan: { jobId, sourcePath, proposals }, warnings, diskContents }`。

**基准文本 B 与磁盘内容 D 是两回事**：B 是用户眼前（编辑器缓冲区）的内容，D 是磁盘上的内容。用户有未保存修改时 B ≠ D。`diskContents` 里的 D 只给接受时的陈旧判定用，不进 plan。

- [ ] **Step 4: 跑测试确认它通过**

Run: `pnpm test src/main/refactor/refactor-plan-builder.test.ts --maxWorkers=2`
Expected: PASS，9 个 brief 用例 + 6 个审查补的用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/main/refactor/refactor-plan-builder.ts src/main/refactor/refactor-plan-builder.test.ts src/shared/refactor/refactor-hunk-computation.ts src/shared/refactor/refactor-hunk-computation.test.ts
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
    - `state` 用 `RefactorStatusResult['state']` 的索引访问，不要把 `'running' | 'done' | 'failed' | 'timed_out' | 'cancelled'` 重抄一遍——两份拷贝会漂。
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
  - **模块底部导出单例** `export const refactorJobRegistry = createRefactorJobRegistry()`。
    Task 8 的五个 RPC 方法共用它——每个方法各建一个注册表的话，
    `refactor.propose` 建好的 job 在 `refactor.status` 里根本查不到。

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
      // The keys are the file's identity on disk: the path it was named by, the path the
      // filesystem calls it, and its inode.
      baselines: new Map([
        ['/repo/src/foo.ts', { content: 'a\n', witness: 'a\n' }],
        ['inode:16777225-13181744224', { content: 'a\n', witness: 'a\n' }]
      ])
    })
    expect(job.baselines.get('/repo/src/foo.ts')?.content).toBe('a\n')
    expect(job.baselines.get('inode:16777225-13181744224')?.content).toBe('a\n')
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
**`update` 一个不存在的 job 是静默 no-op，不抛错**——后台那一段跑完时用户可能已经把任务丢了，
那时候再抛一个错只会让整个主进程看到一次没被接住的异常。

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
- Create: `src/main/refactor/refactor-scratch-cleanup.ts`
- Modify: `src/main/runtime/rpc/methods/rpc-method-registry.ts`
- Test: `src/main/refactor/refactor-apply.test.ts`
- Test: `src/main/refactor/refactor-scratch-cleanup.test.ts`

**Interfaces:**

- Consumes: Task 1 的全部 RPC 参数与结果 schema；Task 5 的 `runRefactorTurn` 与 `buildRefactorPrompt`；Task 6 的 `buildRefactorPlan`；Task 7 的注册表；Task 2 的 `applyRefactorHunks`
- Produces:
  - `REFACTOR_METHODS`：注册 5 个方法 `refactor.propose` / `refactor.status` / `refactor.plan` / `refactor.apply` / `refactor.discard`，`permission: 'workspace'`
  - `src/main/refactor/refactor-apply.ts` 导出 `applyRefactorSelection(input: { plan: RefactorPlan; diskContents: ReadonlyMap<string, string>; acceptedHunkIds: readonly string[]; readCurrent: (path: string) => Promise<RefactorFileReadResult>; write: (path: string, content: string, precondition: { expectedSignature: string; allowMissing: boolean }) => Promise<boolean>; signal?: AbortSignal }): Promise<{ applied: { path: string; hunksApplied: number }[]; refusals: { path: string; reason: string }[] }>`
    —— **`readCurrent` 返回一个可区分的结果，不是一个 `string | null`**：
    `RefactorFileReadResult` = `{ status: 'read'; content: string }` | `{ status: 'missing' }` | `{ status: 'unreadable'; reason: string }`。
    原因是"读不到"有两种：**文件没了**（`missing`）和**文件读不了**（`unreadable`：超过 2 MB 上限、不是普通文件、权限错误）。
    两者都说成"文件已被删除"是撒谎——一个 3 MB 的源文件会被报成被删了。
    `signal` 是新增的：`refactor.apply` 必须观察调用方的 `ctx.signal`，
    取消后**不再开始新的写入**（已经发出去的写无法撤回），没写的文件进 `refusals`，理由说清是取消。
  - `src/main/refactor/refactor-scratch.ts` 导出 `refactorScratchRoot(workspaceRoot: string, jobId: string): string` 与 `refactorScratchRelativeRoot(jobId: string): string`（`.orca/refactor/<jobId>`）
  - `src/main/refactor/refactor-scratch-cleanup.ts` 导出
    `cleanExpiredRefactorScratch(input: { scratchParentRoot: string; excludeJobId?: string; now?: number; maxAgeMs?: number }): Promise<string[]>`
    —— 删掉暂存根目录下**修改时间超过一天**的子目录，返回被删掉的目录名。
    `now` 与 `maxAgeMs` 是注入的（默认 `Date.now()` 与 `24 * 60 * 60 * 1000`），所以"哪些算过期"是可测的。

- [ ] **Step 1: 写失败的测试**

`src/main/refactor/refactor-apply.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { applyRefactorSelection } from './refactor-apply'
import { computeRefactorHunks } from '../../shared/refactor/refactor-hunk-computation'
import { getDiskBaselineSignature } from '../../shared/file-write/disk-baseline-signature'

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
    const preconditions: { expectedSignature: string; allowMissing: boolean }[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => original,
      write: async (path, content, precondition) => {
        writes.push({ path, content })
        preconditions.push(precondition)
        return true
      }
    })
    expect(writes).toEqual([{ path: 'src/foo.ts', content: 'A\nb\nc\n' }])
    expect(result.applied).toEqual([{ path: 'src/foo.ts', hunksApplied: 1 }])
    // 前置条件描述的是**读到的**那份磁盘内容，不是要写进去的新内容——
    // 写错的话每次写都会被拒，功能直接废掉。
    expect(preconditions[0].expectedSignature).toBe(getDiskBaselineSignature(original))
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

（暂存目录清理的测试写在 Step 5，实现写在 Step 6。）

- [ ] **Step 3: 实现落地逻辑**

在 `refactor-apply.ts`：

1. 把 `acceptedHunkIds` 收成 `Set`。
   **hunk 的 id 是整串比较的不透明字符串**（形如 `src/a.ts:h1`——文件路径加该文件内的位置），
   **不要去解析末尾的 `hN`**：接受集合是一个扁平的 `Set<string>`，
   两个文件的 hunk 必须各有各的 id，否则在一个文件里勾一个会把另一个文件的同名块一起接受。
2. 按文件分组：遍历 plan 的每个 proposal 的每个 file，收集该文件里**被接受**的 hunk。
3. 没有被接受的 hunk 的文件跳过。
4. 对每个要写的文件：
   - `current = await readCurrent(path)`；`status === 'missing'` → 记 refusal"文件已被删除"，跳过；
     `status === 'unreadable'` → 记 refusal**它自己的理由**（"文件过大，无法安全读取"之类），跳过。
     **"读不到"有两种，"文件已被删除"只回答其中一种**——把一个 3 MB 的源文件报成被删了是撒谎。
   - **陈旧判定**：`disk = diskContents.get(path)`。当 `current !== disk` **且** `current !== file.originalContent` 时 → 记 refusal"文件在评审期间被改动过，请重新生成重构建议"，跳过。
     两条都放行，是因为磁盘上可能仍是建 plan 时的内容（用户没存盘），也可能已经变成用户存盘的基准文本（用户存了盘）。只有两者都不符才说明有人真的改过它。
   - **取消检查**：`signal?.aborted` 为真时**不再开始新的写入**（已经发出去的写无法撤回），
     当前文件和后面的文件都记 refusal"重构任务已取消，该文件未写入"，然后停。
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

**`expectedExecutionHostId` 不能传 `undefined`**：`assertRuntimeFileMutationExpectation`
（`src/main/runtime/files/file-mutation-expectation.ts:16-22`）在 `expectedExecutionHostId` 为空时
直接抛 "Remote file changes require a newer Orca client."——传 `undefined` 会让**每一次写都失败**。
本地工作区也要把 `target.executionHostId`（`'local'`）传进去；
`expectedSshTargetId` 与 `expectedSshConnectionGeneration` 本地没有，可以传 `undefined`。

**写盘会连带保存用户的未保存修改**：因为 `newContent` 是从基准文本 B 算出来的，而 B 含用户那些还没存盘的编辑。这不是副作用而是语义的一部分（重构基于用户眼前的内容，落盘理应包含它），但界面必须写明这一点。

- [ ] **Step 4: 实现 RPC 方法**

在 `src/main/runtime/rpc/methods/refactor/refactor-methods.ts` 用 `defineMethod`（从 `'../../core'` 导入）注册 5 个方法：

- `refactor.propose`：
  1. `const target = await runtime.resolveRuntimeFileTarget(params.worktree)` → `target.worktree.path` 是工作区绝对路径。
  2. **只支持本地工作区**：`target.executionHostId` 必须是 `LOCAL_EXECUTION_HOST_ID`（`'local'`，
     `src/shared/execution-host.ts:5`），否则**拒绝这次请求**，理由写清楚"远程主机上的重构暂不支持"。
     理由不是偷懒，是结构性的：agent 是在**这台机器上**跑的本地子进程
     （`openClaudeStreamJsonConnection` 只 spawn 本地子进程），它的 cwd 必须是本机上的目录；
     而 SSH / WSL 工作区的 `worktree.path` 是**远端机器上的路径**，本地进程拿它当 cwd 起不来，
     也读不到远端的源文件。仓库自己的结构化 Claude 也是同样的拒绝：
     `src/main/runtime/agent-session/launch/structured-agent-launch-composition.ts:122-128`
     写着 "structured sessions run on the local host, not <hostId>"。
     远端要支持，得让**远端那台机器上的 orcad** 来跑这个特性（把方法注册进远端的运行时并转发过去），
     那是另一个工作量的特性，不在本次范围内。
  3. **校验 `params.relativePath`**：它会直接拼进暂存目录的写入路径（`_source/<relativePath>`），
     所以必须先过三道：
     - `isSafeMobileRelativePath(params.relativePath)`（`src/main/runtime/files/mobile-file-kind.ts`）——
       拒绝对路径、Windows 盘符前缀，以及 `..` / `.` / 空路径段。Task 6 的 `isSafeRelativeRefactorPath`
       委托的就是它，**两个任务共用这一份实现，不要各写一遍**。
     - `hasUnsafePathSegment(params.relativePath)`（Task 3 的导出）——**查原始路径**。
       `isSafeMobileRelativePath` 不管末尾点/空格，而 `.. ` 在 Windows 上就是"上一级目录"；
       而且路径解析会把它和后面的 `..` 抵消掉（`.. /../evil` 解析后看着在根内，实际落在根外），
       所以必须在解析之前查。
     - `isPathInsideWorkspace(target.worktree.path, path.resolve(target.worktree.path, params.relativePath))`
       （Task 3 的导出）——解析之后仍然要确认落点在工作区内。
       **Windows 的盘符相对路径（`C:foo`）在这个检查里被拒**：它按另一个盘的当前目录解析，
       命中的不是本工作区的任何文件。前两道检查放它过去，所以这一道是承重的。
       这个判定在**所有平台**上都得一致（POSIX 上 `C:foo` 只是工作区里的一个怪文件名，
       但它同样不是用户要的路径），否则同一条规则没法用一条测试钉住。
       任一条不过就**直接拒绝这次请求**（抛错），不要先建暂存目录再报错。
  4. `jobId` 用 `crypto.randomUUID()`。
  5. `scratchRoot = refactorScratchRoot(target.worktree.path, jobId)`，用 `fs.mkdir(scratchRoot, { recursive: true })` 建出来。
     **prompt 里的 `scratchRelativeRoot` 必须取自 `refactorScratchRelativeRoot(jobId)`**——
     它和 `scratchRoot` 是同一个目录的两种写法（相对 / 绝对），
     两者一旦对不上，闸门会拒掉 agent 每一次写入、runner 又去读一个没人写过的清单，
     表现为一轮"agent 什么都没产出"的正常失败。
     `src/main/refactor/refactor-scratch.ts` 里加一条测试断言
     `refactorScratchRoot(root, jobId) === path.join(root, refactorScratchRelativeRoot(jobId))`，
     把这个约定钉住，别让两个函数各走各的。
  6. 写基准副本：`fs.writeFile(path.join(scratchRoot, '_source', params.relativePath), params.content)`，父目录先 `mkdir recursive`。
  7. **建 job**（Task 7 的注册表），建的时候就把目标文件的**基准文本**带上：
     `baselines: new Map([[<目标文件的规范路径>, { content: params.content, witness: <发起时目标文件的磁盘内容> }], ...])`——
     同一份缓冲区要放在**这个文件回答的每一个键**下面（见下面「基准表的键」）。
     这张表只在主进程里（`RefactorJob.baselines`），**不上线**，所以值的形状可以按需要改，
     RPC 契约和参数目录都不动。
     其它文件的基准文本就是它们当时的磁盘内容。
     顺序很重要：基准在发起那一刻就已知，所以要在建 job 时就给，不能等 job 建好再补——
     那时候注册表里还没有这个 job，也没有地方放它。
     **基准表的键是文件的身份，不是路径的写法**：清单里的路径可能把同一个文件写成不同的样子
     （`src\foo.ts`、`src/foo.ts`、`src/Foo.ts`），而**它们是不是同一个文件只有文件系统知道**——
     macOS 和 Windows 上 `src/Foo.ts` 与 `src/foo.ts` 是一个文件，Linux 上是两个。
     一个文件回答**两个**问题，键就得同时带上两个答案：
     - **路径**回答"是不是同一个名字"：用 `fs.promises.realpath`（**不是 `realpathSync`**：
       同步的那个保留给定的写法，在不区分大小写的卷上分不开两个拼法）算出来的规范路径，
       外加发起时用的那个绝对路径。编辑器用"改名保存"换掉文件时，路径没变而 inode 变了，
       只有路径键能认出来。**路径命中不需要见证**：路径指的就是用户说的那个文件。
     - **inode**（`stat` 的 `dev` + `ino`）回答"是不是同一个文件"：硬链接的另一个名字路径不同、
       inode 相同，只有 inode 键能认出来。不区分大小写的卷上两种拼法也落到同一个 inode。
       **inode 命中还要对一下"见证"**：inode 本身不是身份——文件被删了，文件系统会把它的 inode
       发给下一个建出来的文件。所以发起时记下**目标文件当时的磁盘内容**当见证，
       命中 inode 键时再读那个文件现在的内容，见证对得上才算命中。**两种情形**：
       硬链接的另一个名字，同一个 inode，**内容也一样**，见证对得上，照样拿到缓冲区；
       回收的 inode，那个文件有它自己的内容，见证对不上，inode 键不回答，
       那个文件退回它自己的磁盘内容——**用户没保存的修改不会被写进无关的文件**。
       这道门（回收的 inode）就是这么关上的：它需要删除 + inode 被回收 + 清单点名那个新文件，
       而现在就算凑齐了，缓冲区也不会落到那个文件上。
       两个键都存、都查：路径键命中就是命中，inode 键命中还要对一下见证。只用其中一个，
       另一个方向的漏查就会重新变成"用户没保存的修改被悄悄抹掉"。
       **查不到就是另一个文件**，退回它自己的磁盘内容——这时用户的缓冲区不参与。
       **写法不同已经不再是入口**：不区分大小写的卷上两种拼法，规范路径和 inode 都认得出来，
       用户没保存的修改不会再被悄悄抹掉。
       **回收的 inode 这道门已经关上，但见证分不开"字节一样"的那一种**：见证就是目标文件当时的
       磁盘内容，所以一个**内容与它一模一样**的文件（`git stash` 那种把同一份内容恢复到别的路径）
       如果刚好拿到了被回收的 inode，见证就对得上，缓冲区还是会落到它身上。
       内容就是见证本身，**分不开字节相同的副本**；能分开的只有 inode，而 inode 正是会被回收的那个。
       **还开着的那道门是路径键**：路径键不看见证——用户评审期间保存了文件时那次保存就换了 inode，
       路径键必须继续回答——所以目标文件在 turn 里被删掉又**在同一个路径上重建**时，
       它会通过路径键拿到缓冲区，写回时旧缓冲区会落进新文件。
       这是裁决本身带来的，不是键的问题；它和 inode 那道门不同，也不依赖分配器。
       **还开着的那道门是另一个文件**：RPC 只带**一个**文件的缓冲区（`relativePath` + `content`），
       所以清单里**别的**文件拿到的基准只能是它自己的磁盘内容——这是契约的形状（一次一个缓冲区），
       不是键的问题。用户如果在那个文件里也有没保存的修改，应用根本没见过这部分内容，
       部分接受时它会被磁盘内容覆盖。
  8. 把 `.orca/refactor/` 加进仓库本地的 exclude 文件（见下面「暂存目录不进版本库」）。
  9. 清理过期暂存目录（见下面「暂存目录清理」），并把被清理掉的 job 从注册表里摘掉。
  10. **立刻返回** `{ jobId }`。
  11. 后台异步跑：解析 agent 启动（Task 4）→ 跑 turn（Task 5）→ 建 plan（Task 6）→ `update` job 的 `plan` 与 `diskContents`。
      **启动参数（Task 4 的 `resolveRefactorAgentLaunch`）要用同一个 Claude CLI、同一个账号**——
      用户在原生聊天里用的是哪个，重构 agent 就该是哪个，否则托管账号的用户会直接撞上登录失败。
      `deps` 的具体构造（`ClaudeEnvDeps` 的成员除 `resolveAuthPolicy` 外都有默认值，
      所以最少只要给 `resolveAuthPolicy`；但只给最少的那份会落到 PATH 里随便一个 claude，
      绕开用户在设置里配的 Command）：
      ```ts
      const settings = runtime.requireStore().getSettings()
      const launch = await resolveRefactorAgentLaunch({
        cwd: workspaceRoot,
        deps: {
          // 跟原生聊天同一条解析路径：设置里配了 Command 就用它，没配就按 agent 名解析。
          resolveCommand: (options) => resolveStructuredAgentCommand('claude', settings, options),
          // 只用于给登录失败标账号，不决定用哪个可执行文件。
          resolveAuthPolicy: () => claudeStructuredAuthPolicyForSettings(settings),
          // 用户自己配的 per-agent 环境 + 当前托管账号的环境。
          resolveEnv: () => ({
            ...resolveTuiAgentLaunchEnv('claude', settings),
            ...runtime.getHostAgentLaunchEnv('claude')
          })
        }
      })
      ```
      导入：`resolveStructuredAgentCommand` 来自 `src/main/native-chat/structured-agent-command-resolution.ts`，
      `claudeStructuredAuthPolicyForSettings` 来自 `src/main/claude-accounts/runtime-auth/claude-structured-auth-policy.ts`，
      `resolveTuiAgentLaunchEnv` 来自 `src/shared/agent-launch/choices/tui-agent-launch-defaults`。
      **`runtime.getHostAgentLaunchEnv` 现在还没有**——账号控制器是 runtime 的 protected 成员，
      服务面（`src/main/runtime/construction/runtime-service-command-surface.ts`）只挑了几个方法暴露出来。
      本任务要往那个面上加两个方法（类型与安装处各一行）：
      ```ts
      // RuntimeServiceCommandSurface 类型里
      getHostAgentLaunchEnv: RuntimeAccountController['hostLaunchEnvFor']
      prepareHostAgentLaunch: RuntimeAccountController['prepareHostAgentLaunch']
      // installRuntimeServiceCommandSurface 里
      getHostAgentLaunchEnv: accounts.hostLaunchEnvFor.bind(accounts),
      prepareHostAgentLaunch: accounts.prepareHostAgentLaunch.bind(accounts),
      ```
      `prepareHostAgentLaunch` 要在起 agent **之前**调一次：它的职责是"起这个 agent 之前先推一次账号、
      再刷新一次 Claude"（`runtime-account-controller.ts:100-104`），不调的话账号环境可能是旧的。
      **这两行是纯新增**，不改任何既有行为。
      **同一个 `scratchRoot` 要同时给闸门和 runner**：闸门用它判断写操作落在不在暂存目录内，
      runner 用它读 `manifest.json` 和暂存文件。两个值不一致的话，agent 写在一个目录、
      应用去另一个目录读，manifest 永远读不到。
      **把 `onProgress` 接到 job 上**：`onProgress: (text) => registry.update(jobId, { progress: text })`。
      `refactor.status` 返回的就是这份 progress，渲染层靠它显示「正在写入 src/foo.ts」。
      **后台这段必须自己 catch**：`void runInBackground().catch((error) => registry.update(jobId, { state: 'failed', warnings: [...] }))`。
      Node 对未处理的 promise rejection 是直接终止进程的 —— handler 返回之后就没有人接这个 promise 了，
      一次没被 catch 的异常会把整个主进程带走。
      **目标工作区必须在 handler 里解析**（第 1 步），不能推到后台：后台开始时 handler 的上下文已经结束了。
      账号策略可以在后台取——`runtime.requireStore().getSettings()` 拿的是长驻 store 的设置，不随 handler 结束而失效。
      **job 的 `state` 直接取 turn 的 `state`**（Task 5 的 `RefactorTurnResult.state`）：
      turn 是 `'done'` 才建 plan 并把 job 标成 `'done'`；turn 是 `'failed'` / `'timed_out'` / `'cancelled'` 就直接把那个状态
      和 turn 的 warnings 写进 job，**不要建 plan**（没有可信的产出）。
      把所有结束方式都当成 `'done'` 会让用户面对一个空白的审查界面。
      建 plan 时传的 `readBaseline` 是 `(path) => 按身份查 baselines ?? 磁盘内容`——目标文件用用户眼前的缓冲区内容，其余文件用当时的磁盘内容。
      「按身份查」的意思是：把这个路径的**每一个键**（规范路径、原路径、inode）都试一遍，
      路径键命中就是命中，**inode 键命中还要对一下见证**（发起时目标文件的磁盘内容，
      见上面第 7 步的「基准表的键」）；`readDiskContent` 是 `(path) => 磁盘内容`。
      `listScratchProposals` 要**连每个方案目录里的文件一起返回**：
      `(await fs.readdir(scratchRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())`
      拿到目录名后，对每个目录再递归列一次文件，组成 `{ id: 目录名, files: [...] }`。
      **每个文件路径是相对「方案目录」`<scratchRoot>/<id>/` 的**，
      也就是暂存目录内部那层结构照搬工作区的相对路径：
      `<scratchRoot>/p1/src/foo.ts` → `files: ['src/foo.ts']`。
      这样 `scratchFiles('p1', 'src/foo.ts')` 读到的正是 `<scratchRoot>/p1/src/foo.ts`。
      **别写成相对工作区根的路径**（那会得到 `.orca/refactor/<jobId>/p1/src/foo.ts`）——
      拼出来多了一层目录，兜底路径里的每个方案都会读不到自己的文件，
      最后变成"清单缺失 → 一个方案都没有"。
      只返回目录名是不够的——清单缺失时 builder 要靠它还原方案，
      知道有 `p1` 这个目录却不知道里面有哪些文件，兜底路径就无从下手。
      `scratchFiles` 读暂存文件时**必须带大小上限**：用 `readNodeFileWithinLimit(filePath, maxBytes)`（`src/shared/file-content/node-bounded-file-reader.ts`），超限抛 `NodeFileReadTooLargeError`。
      **`scratchFiles(proposalId, relativePath)` 必须先确认拼出来的路径还在暂存目录里**：
      `proposalId` 来自 agent 写的 manifest，是外部输入；`..` 或绝对路径会拼到暂存目录外面去。
      用 Task 3 的 `isPathInsideScratch(scratchRoot, path.resolve(scratchRoot, proposalId, relativePath))`
      判一次，越界就当作读不到（返回 `null`），不要去读。
      清单里的 `files` 路径另有 `isSafeRelativeRefactorPath` 兜底，但方案 id 这一层是它管不到的。
      上限取 **2 MB**（与运行时 `files.formatText` 的 `z.string().max(2 * 1024 * 1024)` 一致）。
      agent 写的文件是外部输入，不设上限就是让 agent 用一个巨型文件把主进程内存吃光；
      这个读取器还会挡住把路径换成 FIFO 的替换攻击。
  12. 失败时 `update` 成 `state: 'failed'` 并把原因写进 `warnings`。抛错时 `state: 'failed'`。
  13. 每一步都要尊重 job 的 `controller.signal`。

- `refactor.status`：从注册表取 job，返回 `{ state, progress, warnings }`。job 不存在时返回 `{ state: 'failed', progress: '', warnings: ['任务不存在'] }`。
  **五个方法共用 Task 7 的模块级单例 `refactorJobRegistry`**，不要各建各的。

- `refactor.plan`：从注册表取 job，返回 `{ plan: job.plan }`。

- `refactor.apply`：从注册表取 job。**job 不存在或没有 plan 就直接抛错**（让 RPC 变成一次失败），
  不要返回一个"空成功"——`RefactorApplyResult.refusals` 是必填数组，而每条 refusal 的 `path` 是
  `min(1)` 的非空串，凑不出一个假的路径来表达"没有可写的文件"。
  有 plan 就调 `applyRefactorSelection`，把 job 上的 `diskContents` 传进去。
  **返回值里的 `refusals` 原样带回 RPC 结果**——spec §8.2 要求把"文件在评审期间被改动过"告诉用户，
  这个通道就是 `RefactorApplyResult.refusals`。
  写回用 `runtime.writeFileExplorerFile(worktree, relativePath, content, ...sshArgs, diskPrecondition)`。
  `worktree` 用 job 上存的原始 `worktree` 选择器字符串。
  **写回的结果要分三种**（`FileWriteResult` = `{ ok: true; unchanged?: boolean } | { ok: false; diskConflict }`）：
  - `ok: true` → 记进 `applied`。
  - `ok: false` 且 `diskConflict === 'changed'` → 记进 `refusals`，理由写"文件在评审期间被改动过，请重新生成重构建议"。
    这是**比对与写入之间**又被人动了一次（磁盘前置条件挡住了），和前面的陈旧判定是同一个意思，
    但发生得更晚——所以也要给用户看得见的理由。
  - `ok: false` 且是别的 conflict（`missing` / `not-utf8`）→ 记进 `refusals`，理由按 conflict 说。
    写回用的 `relativePath` 来自 plan，而 plan 的路径来自清单，已经过 Task 6 的
    `isSafeRelativeRefactorPath` 校验；不要在这里重写一套路径检查。
  - **handler 要观察 `ctx.signal`**（`RpcContext.signal`，core.ts:115）：渲染层 60 秒到了会
    abort → `runtime:cancelCall` → 主进程 abort，dispatcher **只把 signal 传下去，不会拿它跟 handler 赛跑**
    （dispatcher.ts:98-102），所以 handler 不看就等于没人管。
    abort 的语义是"**不要再开始新的写**"——已经在飞的那次写撤不回来（文件要么在盘上要么不在）。
    abort 之后剩下的文件进 `refusals`，理由说"已取消"；被磁盘冲突拒绝的文件**保留它自己的理由**，
    别让"已取消"盖掉。
    这不是可选的：渲染层放弃回复之后主进程还在写，界面会说"超时"而文件其实被改了。
    **写成功之后再点一次接受必须被拒绝**（磁盘内容既不等于基线也不等于 originalContent），
    不许写第二遍——这条要有测试钉住。

- `refactor.discard`：**无条件** `controller.abort()`；然后删掉 `scratchRoot` 目录（`fs.rm(scratchRoot, { recursive: true, force: true })`），从注册表 `remove`，返回 `{ discarded: true }`。
  无条件是有原因的：**能落盘的 job 一定已经 `done`**（plan 和 `state: 'done'` 是同一次 update 写的），
  所以"只在 running 时 abort"永远轮不到一个能落盘的 job——
  用户点完"应用"再点"放弃"，剩下的文件还会继续被写下去。
  turn 已经结束的 job 被 abort 是无害的。
  turn 超时或被取消的 job 没有 plan，`refactor.apply` 直接抛错，不能静悄悄地当成空成功。

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

- 命令失败（不是 git 仓库的 folder workspace）→ **catch 掉跳过这步**，不要让它把整个 propose 拖垮。
  `gitExecFileAsync` 在命令非零退出时会抛错（`src/main/git/command-runner/git-exec-file.ts`），
  而 `rev-parse --git-path` 在非 git 目录里正是非零退出。
- 追加前先读一遍该文件，**已存在 `.orca/refactor/` 这行就跳过**，不要重复追加。
- 文件不存在就直接写（`info/exclude` 是 Git 自己保证存在的，父目录也在 common dir 里）。
- **整步都不能让 propose 失败**：暂存目录没被 exclude 只是让 `git status` 多几行未跟踪文件，
  而让用户发不起重构是更大的问题。任何异常都跳过这步。

**暂存目录清理**：发起新任务时调 `cleanExpiredRefactorScratch({ scratchParentRoot: path.join(workspaceRoot, '.orca', 'refactor'), excludeJobId: jobId })`。
当前 job 的目录不动（`excludeJobId`），父目录不存在就当没有暂存目录（不是错误）。
**清理掉的目录名要用来摘掉对应的 job**：注册表里只有 `discard` 会删 job，
不清的话注册表会随着每次清理无限增长（暂存目录一天就过期，job 可是一直留着）。
所以清理返回的目录名逐个 `registry.remove(name)`——目录名就是 jobId。

- [ ] **Step 5: 写暂存目录清理的测试**

`src/main/refactor/refactor-scratch-cleanup.test.ts`（用真实临时目录，`os.tmpdir()` 下的随机目录）：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanExpiredRefactorScratch } from './refactor-scratch-cleanup'

const DAY_MS = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000
const roots: string[] = []

async function scratchRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-scratch-'))
  roots.push(root)
  return root
}

async function jobDir(root: string, name: string, ageMs: number): Promise<string> {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'file.ts'), 'x')
  const when = new Date(now - ageMs)
  await fs.utimes(dir, when, when)
  return dir
}

describe('cleanExpiredRefactorScratch', () => {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('removes a scratch directory older than a day', async () => {
    const root = await scratchRoot()
    const old = await jobDir(root, 'old-job', DAY_MS + 1000)
    const removed = await cleanExpiredRefactorScratch({ scratchParentRoot: root, now })
    expect(removed).toEqual(['old-job'])
    await expect(fs.stat(old)).rejects.toThrow()
  })

  it('keeps a scratch directory from today', async () => {
    const root = await scratchRoot()
    const fresh = await jobDir(root, 'fresh-job', 1000)
    const removed = await cleanExpiredRefactorScratch({ scratchParentRoot: root, now })
    expect(removed).toEqual([])
    await expect(fs.stat(fresh)).resolves.toBeTruthy()
  })

  it('keeps the current job even when it looks old', async () => {
    const root = await scratchRoot()
    await jobDir(root, 'current-job', DAY_MS + 1000)
    const removed = await cleanExpiredRefactorScratch({
      scratchParentRoot: root,
      excludeJobId: 'current-job',
      now
    })
    expect(removed).toEqual([])
  })

  it('does nothing when there is no scratch directory yet', async () => {
    const root = await scratchRoot()
    const removed = await cleanExpiredRefactorScratch({
      scratchParentRoot: path.join(root, 'missing'),
      now
    })
    expect(removed).toEqual([])
  })
})
```

- [ ] **Step 6: 实现暂存目录清理**

在 `refactor-scratch-cleanup.ts`：

- `fs.readdir(scratchParentRoot, { withFileTypes: true })`，只取目录；父目录不存在就返回 `[]`（不是错误）。
- 对每个目录 `fs.stat` 拿 `mtimeMs`；`now - mtimeMs > maxAgeMs` 就 `fs.rm(dir, { recursive: true, force: true })`。
- 名字等于 `excludeJobId` 的跳过。
- 返回被删掉的目录名。
- **`mtime` 是目录自己的修改时间**——agent 在里面写文件会更新它，所以"最近还在用的任务"不会被误删。

- [ ] **Step 7: 注册方法并重新生成目录**

在 `src/main/runtime/rpc/methods/rpc-method-registry.ts` 里 import `REFACTOR_METHODS` 并展开进 `ALL_RPC_METHODS`。

然后：

```bash
pnpm generate:rpc-params-catalog
```

把生成物一起提交。

- [ ] **Step 8: 跑测试确认它通过**

Run: `pnpm test src/main/refactor --maxWorkers=2`
Expected: PASS。

- [ ] **Step 9: 类型检查与提交**

```bash
pnpm tc:node
git add src/main/refactor src/main/runtime/rpc/methods/refactor src/main/runtime/rpc/methods/rpc-method-registry.ts src/shared/rpc-contract
git commit -m "feat(refactor): expose the refactoring runtime methods"
```

**这一任务很大（六个新文件 + 一处共享改动），建议分三次提交**，
让审查能分别否决其中一块而不必推翻整块：
① `refactor-scratch.ts` + `refactor-scratch-cleanup.ts` + 它们的测试 —— 纯路径计算，没有 I/O 风险；
② `refactor-apply.ts` + 它的测试 —— 写回路径，安全边界在这里；
③ `refactor-methods.ts` + 注册表 + 生成物 —— RPC 接线。
（`refactor-scratch.ts` 里的 `refactorScratchRoot` 与 `refactorScratchRelativeRoot` 必须相等，
这条断言放在 ① 里。）

---

### Task 9: 渲染层客户端与轮询

**Files:**

- Create: `src/renderer/src/components/editor/refactor/refactor-runtime-client.ts`
- Create: `src/renderer/src/components/editor/refactor/refactor-job-poller.ts`
- Test: `src/renderer/src/components/editor/refactor/refactor-job-poller.test.ts`

**Interfaces:**

- Consumes: Task 1 的 RPC 参数与结果类型；`callRuntimeRpc`（`src/renderer/src/runtime/rpc/calls/runtime-rpc-call.ts`）
  - `callRuntimeRpc<TResult>(target, method, params?, options?)` 的第一个参数是 **target**，
    不是方法名：`{ kind: 'local' }` 或 `{ kind: 'environment', environmentId }`。
    本特性只支持本地工作区，所以**一律用 `{ kind: 'local' }`**。
    它已经把 RPC 信封拆开了：成功时返回 `result`，失败时**抛错**——
    所以 `proposeRefactor` 是在这里 catch 之后把错误变成 `RefactorProposeOutcome`。
- Produces:
  - `type RefactorProposeOutcome = { jobId: string } | { failure: 'refused'; reason: string } | { failure: 'unreachable' }`
  - `proposeRefactor(input: { worktreeId: string; relativePath: string; content: string; instruction?: string }): Promise<RefactorProposeOutcome>` —— 返回 jobId 或**失败的原因**，不要把异常抛到 UI
    - **为什么是"结果"而不是 `null`**：调用方开的是 tab 加 toast，**发起失败的时候没有 tab 可以显示错误**，
      所以理由必须跟着答案一起回来，不能躺在栈上等一个没人接的 catch。
      `'refused'` 是运行时自己拒绝的（例如远端工作区），`reason` 带着运行时给的那句话；
      `'unreachable'` 是请求本身没成功（超时、解析失败、传输断了）。
      用 `RuntimeRpcCallError` 把运行时自己的拒绝理由带出来，不要自己编一句通用文案。
    - 入参是**工作区 id**，但 RPC 的 `worktree` 参数要的是 **runtime 选择器**：
      客户端内部用 `toRuntimeWorktreeSelector(worktreeId)` 转换
      （`src/renderer/src/runtime/rpc/targets/runtime-worktree-selector.ts:7-13`，加 `id:` 前缀）。
      仓库里所有 `files.*` 的调用都是这么做的（见 `runtime-file-search-client.ts:66`）。
      **不要把裸的 worktree id 直接塞进 `worktree` 参数**。
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
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
```

`proposeRefactor` 要传的 `worktree` 是**选择器**，不是裸 id：
`{ worktree: toRuntimeWorktreeSelector(input.worktreeId), relativePath, content, instruction }`。

**超时必须由渲染层自己兜**：`callRuntimeRpc` 走 `{ kind: 'local' }` 时会把 `timeoutMs` 和 `signal`
一起丢掉（`runtime-rpc-call.ts:62-63` 的 local 分支只调 `window.api.runtime.call`，
只有 environment 分支才把 timeoutMs 传下去）。NES 的注释写得很直白：
"The local branch of the transport drops the signal and the timeout, so the renderer keeps its own."
所以照 NES 的做法：自己建一个 `AbortController`，用 `setTimeout` 到点 abort，
再用一个 `settleBeforeDeadline(call, timeoutMs, signal)` 把调用和截止时间赛跑。
（NES 的 `settleBeforeDeadline` 是那个文件里的私有函数，这个文件要自己带一份，
或者放到 `runtime/rpc/calls/` 下共用——不要 import 别人的私有函数。）

超时：`refactor.propose` 用 35s；`refactor.status` 用 35s；`refactor.plan` 用 35s；
`refactor.apply` 用 60s（写盘可能慢）。

**结果要过一遍 zod**：NES 用 `NesEditPlan.safeParse(response.plan)` 解析 RPC 返回值。
这里对应地用 `RefactorStatusResult.safeParse` / `RefactorPlanResult.safeParse` /
`RefactorApplyResult.safeParse`，解析失败就当"没有结果"。

失败的处理照 NES 的做法：请求失败时 `console.error` 并把错误转成"没有结果"，不让异常冒到 UI。
`proposeRefactor` 失败返回 `{ failure: 'unreachable' }`（运行时自己拒绝的返回 `{ failure: 'refused', reason }`）；
`fetchRefactorPlan` 失败返回 `null`；
`discardRefactor` 失败返回 `false`；`applyRefactor` 失败要**抛出去**——
用户点了"接受"，静默失败是最糟的结果，调用方必须能告诉用户"没写成功"。

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
  - `EditorTabView` 新增成员 `{ mode: 'refactor-review'; refactorReview?: { jobId: string; worktreeId: string; relativePath: string } }`
  - `OpenFile` 新增字段 `refactorReview?: { jobId: string; worktreeId: string; relativePath: string }`
    —— 存的是**工作区 id**（渲染层手上就是这个），不是 runtime 选择器；转换发生在调用 RPC 的客户端里（Task 9）。
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
- `open-file.ts`：`mode` 联合类型加 `'refactor-review'`；加 `refactorReview?: { jobId: string; worktreeId: string; relativePath: string }` 字段。
- `editor-tab-view-types.ts`：`EditorTabView` 联合类型加 `{ mode: 'refactor-review'; refactorReview?: { jobId: string; worktreeId: string; relativePath: string } }`。
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

**`toggleHunk` 与 `setHunkSelection` 只改 `acceptedHunkIds`，要保留 `selectedHunkId` 与 `selectedFilePath`**——
用户点勾选框的时候，正在看的那个代码块不该从右区消失。改"当前看哪个"用 `setSelection`（整体替换选择）。

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
  - `RefactorHunkView` 组件，props：`{ hunk: RefactorHunk; filePath: string; relativePath: string; ownerKey: string; accepted: boolean; sideBySide: boolean; onToggleAccepted: () => void; disabled?: boolean }`
    - `ownerKey` 是**拥有这批 model 的那个 tab 的 id**（Task 13 的合成 id `${worktreeId}::refactor-review:${jobId}`）。
      它有两个用处，缺一不可：
      1. `modelKey` 必须唯一到「tab + 文件 + 代码块」这一级。而 `modelKey` 会变成 Monaco model 的 URI
         （`diff:original:<encoded modelKey>:<generation>`，见 `diff-monaco-model-disposal.ts:77-92`），
         同 key 就是同一个 model——第二个 diff 会显示第一个文件的内容。
         所以 `modelKey` 用 `refactor-hunk:${ownerKey}:${relativePath}:${hunk.id}`。
         （hunk 的 id 现在已经带上了文件路径前缀——`src/a.ts:h1`——所以这里写相对路径是冗余的，
         但留着它能让 model 的 URI 一眼看出是哪个文件的哪个块。）
      2. `modelOwnerKey` 传 `ownerKey`（不是 `modelKey`）。这样这个 tab 的所有 hunk model 归同一个 owner，
         关掉 tab 时能一次性回收；每个 hunk 各自当 owner 会让 model 留着不释放。
    - `filePath` 是这个文件在工作区里的**绝对路径**，`relativePath` 是相对路径。
      `DiffViewer` 的 `filePath` 槽位在别处（`ChangesModeView.tsx:85`、`EditorDiffFileSurface.tsx:163`）
      收的都是绝对路径；往里塞相对路径，会让将来按工作区根解析这个路径的调用方找错地方。

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
      ownerKey="wt-1::refactor-review:job-1"
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

- 顶部一行：绝对行号标签 + 接受按钮（按钮文案随 `accepted` 在"接受"与"已接受"之间切换；
  图标也跟着换：未接受是空心圆 `Circle`，已接受是 `CircleCheck`，不能让勾在未接受时也出现）。
- 下面一个 `DiffViewer`：
  - `originalContent={hunk.originalText}`
  - `modifiedContent={hunk.modifiedText}`
  - `language={detectLanguage(relativePath)}`
  - `filePath` 传工作区的绝对路径，`relativePath` 传相对路径
  - `modelKey={`refactor-hunk:${ownerKey}:${relativePath}:${hunk.id}`}`
  - `modelOwnerKey={ownerKey}`
  - `sideBySide={sideBySide}`
  - `editable={false}`

`DiffViewer` 是 lazy 组件，测试里需要 mock `@monaco-editor/react` 的 `DiffEditor`（参考 `src/renderer/src/components/editor/diff/sections/DiffSectionBody.word-wrap-lifecycle.test.tsx` 的写法）。

- [ ] **Step 4: 写 fixture**

`refactor-hunk-view.fixture.tsx` 用**具名导出** + `defineFixture`，照
`src/renderer/src/components/UpdateCard.fixture.tsx` 的写法：

```tsx
import { defineFixture } from '../../../component-fixtures/component-fixture'
import '@/lib/editor/monaco/monaco-setup'

export const twoHunks = defineFixture({
  width: 1280,
  render: () => <>{/* 一个已接受、一个未接受 */}</>
})
```

导入路径是 `'../../../component-fixtures/component-fixture'`（从 `components/editor/refactor/` 往上三级到 `src/renderer/src/`）。
**`import '@/lib/editor/monaco/monaco-setup'` 也要带上**——`DiffViewer` 自己不装 Monaco 的 worker 与语言，
仓库里带 Monaco 的 fixture（`src/renderer/src/components/editor/code-completion/nes-ghost-text.fixture.tsx`）
都是自己 import 这一行的；不 import 的话截图里 diff 区域是空的。
**用具名导出**：注册表把模块的每个导出各自当成一个 fixture，名字就是 `<组件 id>:<导出名>`
（`src/renderer/src/component-fixtures/component-fixture-registry.ts:31-44`）。
**根容器要给一个确定的高度**（仓库里的惯例是 `flex h-[600px] flex-col`，见
`src/renderer/src/components/right-sidebar/folder-workspace-empty-state.fixture.tsx`）：
组件的高度全靠 `flex-1` 链，`min-h-0` 会把基准高度压成 0，diff 区域就渲染成空白，
截图里只剩两个标题行。

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
- Modify: `src/renderer/src/components/editor/EditorContent.tsx`
- Test: `src/renderer/src/components/editor/refactor/refactor-review-tab.test.tsx`

**Interfaces:**

- Consumes: Task 9 的客户端与轮询；Task 11 的 store；Task 12 的 `RefactorHunkView`；Task 1 的 `RefactorPlan`
- Produces:
  - `RefactorReviewTab` 组件，props：`{ jobId: string; worktreeId: string; relativePath: string }`
  - `openRefactorReviewTab(input: { worktreeId: string; relativePath: string; content: string; instruction?: string }): Promise<void>` —— 发起任务、拿到 jobId、开 tab。
    **发起失败（`proposeRefactor` 返回 `failure`）时用 toast 报错，并且不要开 tab**——
    远端工作区、路径不合法、没有 Claude 登录态都属于这一类。开了空 tab 只会让人以为界面坏了。
    `'refused'` 时**把运行时给的那句 `reason` 告诉用户**（别自己编一句通用文案）；
    `'unreachable'` 时说一句"发起失败"就够。
  - 虚拟 tab 的 id 用合成 id（如 `${worktreeId}::refactor-review:${jobId}`），`filePath` 填这个合成 id
    ——虚拟 tab 没有磁盘上的文件，`isVirtualEditorFile` 靠这一点区分它。照抄
    `src/renderer/src/lib/source-control/graph/git-graph-tab.ts` 里 `openGitGraph`（:120-158）的写法：
    - 先在 `state.unifiedTabsByWorktree?.[worktreeId]` 里找同 id 的 tab；找到了就走
      `openWorkspaceEditorItem(state, id, worktreeId, label, 'refactor-review')` 激活它并返回。
      `openWorkspaceEditorItem` 的签名是
      `(state, fileId, worktreeId, label, contentType, isPreview?, targetGroupId?, selection?, index?)`
      （`src/renderer/src/store/slices/editor/tabs/workspace-editor-item.ts:16-26`），
      `contentType` 是 `EditorTabContentType`，Task 10 加了成员后即可直接传。
    - 没找到就 `state.openFile({ filePath: id, relativePath: label, worktreeId, language: 'plaintext', mode: 'refactor-review', refactorReview: { jobId, worktreeId, relativePath } }, { reopenId: id, preview: false })`。
      **`worktreeId` 要带上**——tab 得归属到工作区，否则布局与归属都对不上。
      **`refactorReview` 也要带上**：编辑器面板是按 `activeFile.mode` 分派的
      （`src/renderer/src/components/editor/EditorContent.tsx:137-185`，
      `git-graph` / `check-details` / `conflict-review` 各有一个分支），
      面板渲染时读的是 `activeFile` 上的那一块数据，不是组件自己带的 props。
      少了 `refactorReview`，面板就不知道这个 tab 是哪次重构的。
      `git-graph` 那份还传了 `runtimeEnvironmentId` 与 `operationProvenance`，那是从它的 scope helper
      （`gitGraphScope(worktreeId)`）拿的；重构 tab 是本地工作区（Task 8 只支持本地），
      不需要远端路由，先不传这两个。

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

`refactor-proposal-tree.tsx`：**Task 11 已经把它做好并提交了**（在 `src/renderer/src/components/editor/refactor/`），
本任务**直接用它，不要重写**。它渲染「方案 → 文件 → 代码块」三级，每级一个复选框：

- 方案级勾选 = 该方案所有 hunk 全选 / 全不选。
- 文件级勾选 = 该文件所有 hunk 全选 / 全不选。
- 代码块级勾选 = 单个 hunk。
- 每个方案节点显示 `title` 与 `rationale`；`rationale` 为空串时显示"未给出理由"。
- 部分接受的节点显示半选状态；点击代码块的标题会让右区切到那一个代码块
  （通过 store 的 `setSelection` 改 `selectedHunkId` / `selectedFilePath`）。
- **spec §8.1 的"部分接受"警告不在这个组件里**，那是本任务的事（见下面的「部分接受警告」）。

`refactor-review-tab.tsx`：

- 左侧 `refactor-proposal-tree.tsx`，右侧当前选中的 hunk 的 `RefactorHunkView`。
  `RefactorHunkView` 的 `ownerKey` 传**这个 tab 的合成 id**（`${worktreeId}::refactor-review:${jobId}`）——
  它决定 Monaco model 的 key 与归属，见 Task 12 的 Interfaces。
- **「查看完整文件」切换**（spec §9.2 要求）：切到整文件视角时，右区显示整个文件的 `DiffViewer`——
  `originalContent` 用 `file.originalContent`（基准文本），
  `modifiedContent` 用 `applyRefactorHunks(file.originalContent, file.hunks)`（Task 2 的函数，渲染层可用）。
  也就是说整文件视角显示的是**该方案改完之后的全文**，不是别的方案的结果。
- 顶部：文件名、「接受全部方案」、「丢弃」按钮、进度文案。
- **清 store 的时机**：Task 11 的 store 是按 jobId 存 Map 的模块级单例，不删就会随着每次重构一直长；
  但**不能在组件卸载时无条件删**——编辑器面板是按 `activeFile` 分派的
  （`src/renderer/src/components/editor/EditorContent.tsx`），用户切到别的 tab 时这个组件就卸载了，
  切回来时计划已经被删掉，审查界面是空的。
  正确的判据是**这个 job 还有没有开着的 tab**：卸载时读
  `useAppStore.getState().openFiles`，若还有哪个文件的 `refactorReview?.jobId === jobId`，
  说明用户只是切走了，**保留** store 里的计划；一个都没有了（tab 真被关掉了），才
  `refactorReviewStore.remove(jobId)`。
  （`useAppStore.getState()` 是这个仓库现成的写法，`src/renderer/src/store/index.ts:173` 就是这么用的。）
  「丢弃」按钮关 tab 时会走到同一条路径。
- 用 Task 9 的 `pollRefactorJob` 轮询状态；`state === 'done'` 后用 `fetchRefactorPlan` 取 plan 并写进 store。
- **`state` 是 `'failed'` / `'timed_out'` 或 `'cancelled'` 时**：把 `warnings` **内联显示在 tab 里**（不是 toast——
  用户得能读、能理解、能重试），并停止轮询。轮询器在状态不是 `'running'` 时就会停，所以
  这一支必须由 tab 自己处理。
  超时要单独给一句「超时了，重试会更快」之类的文案——它是三种结束里唯一值得直接重试的一种，
  混在"失败"里用户会先去查日志。
- 「接受全部方案」把 plan 里所有 hunk 标为接受，然后调 `applyRefactor`，成功后关掉这个 tab（用现成的关闭编辑 tab 的 store action）。
- 「丢弃」调 `discardRefactor` 后关 tab。
- **部分接受警告**：对每个方案，若它有 hunk 但被接受的 hunk 是真子集，在方案节点上显示提示"这个改动由 N 处修改共同组成，只接受其中一处可能无法编译"，并给一个"接受该方案全部改动"的按钮。

`EditorContent.tsx`：加一个 `activeFile.mode === 'refactor-review'` 的分支，
读 `activeFile.refactorReview` 渲染 `<RefactorReviewTab jobId worktreeId relativePath />`。
**`activeFile.refactorReview` 缺失时给一句"重构审查不可用"**（照 `check-details` 分支的写法：
`activeFile.checkRunDetails` 没有时渲染一句说明，而不是整个崩掉）。
少了这个分支，tab 开出来是空白——编辑器面板根本不知道要渲染审查界面。

- 接受成功/失败的提示用 Orca 现成的 toast（查 `src/renderer/src/components/` 里既有的 toast 用法，不要自造）。

- [ ] **Step 4: 加触发入口**

在 `EditorPanelHeader.tsx` 加一个「智能重构」按钮：

- 只在 `mode === 'edit'` 的文件上出现。
- 点击时取当前激活文件的**缓冲区内容**（用 `createEditorPanelDraftSelector`，见 `src/renderer/src/components/editor/editor-panel-draft-selector.ts`），调 `openRefactorReviewTab`。
  用法照 `EditorPanel.tsx:87-90`：
  ```ts
  const editorDraftSelector = useMemo(
    () => createEditorPanelDraftSelector(activeFile),
    [activeFile]
  )
  const editorDrafts = useAppStore(editorDraftSelector)
  ```
  **返回的 map 是按 file id 索引的**（`editorDrafts[fileId]`，不是按路径），
  所以当前文件的缓冲区内容是 `editorDrafts[activeFile.id]`；
  **取不到（有 draft 才取得到）就退回磁盘内容**——没有未保存修改时 draft 是 undefined，
  这时该用文件在磁盘上的内容。
  磁盘内容在 store 的 `fileContents[fileId]` 里（同样是按 file id 索引，
  见 `src/renderer/src/components/editor/save/commands/useEditorCmdSaveRequest.ts:48-70`）：
  `fileContents[activeFile.id]?.content`。
  **取之前要判三件事**：`loaded.isBinary`（二进制文件不重构）、`loaded.loadError`（读失败）、
  `loaded.isStale`（缓存已过期）。三者任一为真就把内容当空串处理，
  别拿一份旧的或半截的内容去让 agent 重构。
  最终内容 = `draft ?? (loaded 可用 ? loaded.content : '')`，
  两者都没有时**禁用按钮**（没有内容可重构）。
- 按钮在没有 Claude 登录态时也要能点——发起失败由 toast 报出来（失败就不开 tab，见 Interfaces）。

- [ ] **Step 5: 写 fixture**

`refactor-review-tab.fixture.tsx` 用**具名导出** + `defineFixture`，照
`src/renderer/src/components/UpdateCard.fixture.tsx` 的写法：

```tsx
import { defineFixture } from '../../../component-fixtures/component-fixture'
import '@/lib/editor/monaco/monaco-setup'

export const withProposals = defineFixture({
  width: 1280,
  setup: () => {
    // 预置一份 plan，让 fixture 直接渲染出左树和右边的 diff
    refactorReviewStore.setPlan('job-1', PLAN)
  },
  render: () => <RefactorReviewTab jobId="job-1" worktreeId="wt-1" relativePath="src/foo.ts" />
})
```

`PLAN` 是你自己写的一份假 plan：两个方案、一个文件两个 hunk。
**预置 plan 用 `setup`**，不要用 `store` 字段——`setup` 在 store 与 `window.api` 就绪之后、渲染之前跑，
而 Task 11 的 store 是模块级单例，不属于 app store 的 slice。

**还要在 `setup` 里 stub 掉 RPC**：审查 tab 会去轮询 `refactor.status`，
fixture 里没有 runtime，那个调用会失败。把 `window.api.runtime.call` 换成
返回「任务已完成」的假响应（照 `src/renderer/src/components/artifacts/ArtifactPublishButton.test.tsx`
里 stub `window.api` 的写法），免得 fixture 截图里是一片错误提示。

- [ ] **Step 6: 跑测试与截图**

Run: `pnpm test src/renderer/src/components/editor/refactor --maxWorkers=2`
Expected: PASS。

Run: `pnpm fixtures:shot editor/refactor/refactor-review-tab`
Expected: PNG 落在 `.cache/fixtures/`。**看图确认**：左树的三级层次清楚、右边的 diff 不是空白。

- [ ] **Step 7: 跑本地化脚本与提交**

```bash
node config/scripts/localization/source-extraction/localize-renderer-strings.mjs
pnpm tc:web
pnpm exec oxlint src/renderer/src/components/editor/refactor src/renderer/src/components/editor/EditorPanelHeader.tsx src/renderer/src/components/editor/EditorContent.tsx
git add src/renderer/src/components/editor/refactor src/renderer/src/components/editor/EditorPanelHeader.tsx src/renderer/src/components/editor/EditorContent.tsx src/renderer/src/i18n
git commit -m "feat(refactor): review the proposals and accept them by plan, file, or hunk"
```

**这里不要跑 `pnpm check:changed`**（Global Constraints 说了：整轮门禁由控制者在分支末尾统一跑，
中途跑会把几十个无关文件的 related 测试拖进来）。

---

### Task 14: 闸门按物理位置判（真跑才发现的那个洞）

**Files:**

- Create: `src/main/refactor/refactor-physical-path.ts`
- Test: `src/main/refactor/refactor-physical-path.test.ts`
- Modify: `src/main/refactor/refactor-write-gate.ts`、`refactor-tool-hook.ts`、`refactor-runner.ts`、
  `refactor-file-reads.ts`、`refactor-path-rules.ts`、
  `src/main/runtime/rpc/methods/refactor/refactor-methods.ts`
- Create: `src/main/refactor/refactor-tool-progress.ts`（进度文案从 runner 里搬出来，见下）

**为什么会有这个任务：** Task 3 的闸门按**路径字符串**比较。分支末尾的一次真跑（对着真的 `claude` CLI）
发现了一个单测永远发现不了的洞：macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，
**CLI 把它自己的工作目录解析成了真实路径**，而闸门拿 `workspaceRoot` 的字面写法做前缀比较 ——
于是它把**物理上就在工作区里**的文件判成了工作区外，第一次读目标文件就被拒。
写方向更糟：CLI 若把写路径也规范化，agent **连方案都写不出来**，那一轮没有 manifest、没有方案，
失败看起来像"模型什么都没干"。

**Interfaces:**

- Produces:
  - `resolvePhysicalPath(targetPath: string): Promise<string | null>` —— 一个路径**真正所在的位置**。
    `null` 表示解不出来，调用方一律**拒绝**。
  - `resolveRefactorGateRoots(input: { scratchRoot: string; workspaceRoot: string }): Promise<RefactorGateRoots>`
    —— 两个根的**物理**位置。解析一次，之后每次工具调用都复用。
- **改签名（调用方要跟着改）**：
  - `isPathInsideScratch(scratchRoot: string, targetPath: string): Promise<boolean>`
  - `isPathInsideWorkspace(workspaceRoot: string, targetPath: string): Promise<boolean>`
  - `refactorToolAllowed(input: { toolName: string; toolInput: Record<string, unknown>; roots: RefactorGateRoots }): Promise<boolean>`
    —— 参数从 `scratchRoot`/`workspaceRoot` 换成**已经解析好的** `roots`。

- [ ] **Step 1: 写失败的测试**

  `src/main/refactor/refactor-physical-path.test.ts`：

  - `applies '..' to the directory a link points at, the way the kernel does` ——
    内核**先跟符号链接、再套 `..`**，所以 `/ws/link/../secret` 在 `link → /etc` 时落在 `/secret`。
    **不能对整条路径调用 `realpath`**：目标可能**还不存在**（写操作要写新文件），
    `realpath` 对这种路径以 ENOENT 失败，回答不了它；所以要把路径按 `..` 切成若干段，
    每段（不含 `..`）用 OS 的解析器解（`fs/promises.realpath` 就是 OS 的解析器，与内核一致），
    段与段之间的 `..` 由自己套：内核的规则是 `..` 作用在**前一段真正落到**的那个目录上。
  - `puts a file that is not there where the part of the path that is says` ——
    写操作要写还不存在的文件，内核把它放在**确实存在的那一段**说的位置。
  - `keeps the spelling of a path the disk has never seen`
  - `refuses a path that is not absolute`

  `src/main/refactor/refactor-write-gate.test.ts` 里加**成对**的两条：

  - `allows a read of a file the CLI names by its real path` ——
    **工作区根本身是符号链接时，读必须被允许**（这正是真跑踩到的那一类）。
  - `denies a write through a link that leaves the scratch root` ——
    **暂存根里指向外面的符号链接必须被拒**（这条也关掉了"暂存根检查是字面的"那条遗留）。

- [ ] **Step 2: 跑测试确认它们失败**

  Run: `pnpm test src/main/refactor --maxWorkers=2`
  Expected: FAIL（新用例），其余照旧。

- [ ] **Step 3: 实现**

  `src/main/refactor/refactor-physical-path.ts`：

  - `splitPhysicalPath(rawPath)` —— `path.parse` 是唯一把各段**按原样**留下的路径函数，
    而 `..` 原样留着正是重点。
  - `resolvePhysicalPath(targetPath)` —— 按 `..` 把路径切成若干"段"，
    每段用 `realpath` 解（`realpath` 失败且是"确实不存在"时，逐步缩短前缀试，
    最后退回字面拼接 —— 因为写操作要写还不存在的文件）。
  - **解不出来就返回 `null`，调用方一律拒绝**：fail closed。

  `refactor-write-gate.ts`：两个根解析成物理位置，比较也用物理位置；
  比较必须带**分隔符**（`/ws/scratch` 与 `/ws/scratch-evil` 不是一回事）。
  `refactor-tool-hook.ts` 与 runner 的 `canUseTool` 都改成 async，接收 `roots`。

- [ ] **Step 4: 进度文案也按物理位置算**

  真跑的第二个发现：进度文案用 `path.relative(workspaceRoot, target)` 算相对路径，
  而 CLI 要的是规范化后的路径，于是用户在界面上看到
  `正在读取 ../../../private/tmp/.../src/inventory.ts` —— 一串没用的 `../..`。
  把这段搬进 `src/main/refactor/refactor-tool-progress.ts`（runner 撞上了仓库 300 行的 lint 上限），
  先按**物理**工作区根算相对路径，再按字面写法算，最后才退回绝对路径。

- [ ] **Step 5: 跑测试确认它们通过**

  Run: `pnpm test src/main/refactor src/main/claude src/main/runtime/rpc/methods/refactor --maxWorkers=2`
  Expected: PASS。

- [ ] **Step 6: 用真的 CLI 再跑一次**

  这一步**不能用单元测试代替**：真跑发现的正是"CLI 的路径处理"与"我们的"之间的不一致。
  见 `.superpowers/sdd/2026-11-22-intelligent-refactor/end-to-end-run.md`。

---

## 修复轮：整枝复审之后改了什么（计划与代码的对齐）

计划原本的"完成标准"里没有这几条；它们是**整枝复审**和**控制器自己的一次真跑**带出来的。
这一节把改动写进计划，让计划和代码说同一件事。

**1. 清单按方案逐个解析，缺 `files` 时从暂存目录取。**
原计划把 `manifest.json` 当成"要么整份对、要么整份丢"的东西（`RefactorManifest.safeParse`）。
真跑证明它不是那样：agent 漏写一个 `files` 字段，整份清单连**每个方案的标题和理由**一起被扔掉，
计划构建器退回"从暂存目录还原"，那条路知道文件、**不知道理由** —— 于是界面告诉用户
"agent 未给出理由"，而 agent 其实给了 400 多字的理由。
改法：`files` 变成可缺省，缺了就问暂存目录（目录本来就知道这个方案写了哪些文件）；
清单按方案逐个解析，一个方案不合格只丢那一个；提示词写明 `files` 必填。

**但"每个方案都不合格"是另一回事。**
逐个解析守的是"agent 的工作不能因为清单的缺陷被扔掉"，而"全部都不合格"恰好把它反过来：
读者返回 `{ proposals: [] }`（不是 `null`），计划构建器于是走**清单路径**，
写出**零个**方案，暂存目录一眼都不看 —— 界面上一条方案都没有，
而 agent 写的那棵树就躺在那里。改法：读者分清两种"没有方案"：
**清单本来就是空的**（`{"proposals": []}`，agent 说它没什么可展示，这个意思要留着，
不能偷偷退回暂存目录）和**清单被清空了**（agent 写了 N 个方案、N 个都不合格）：
后者返回 `manifest: null`，走"清单缺失"那条兜底路径，让暂存目录说话；
丢弃每个方案的警告照旧留给用户，所以用户仍然知道 agent 写错了什么。
**为什么守卫放在读者而不是计划构建器**：计划构建器拿到的只是一个 `null` 或一份清单，
它分不出"清单是空的"和"清单被清空了"；只有读者同时知道两个数字
（agent 写了几个方案、活下来几个）。

**2. "还原"有两种，文案必须分开。**
规格 §13 写的是"清单**缺失**时按目录结构兜底还原方案列表，并在界面上标记'agent 未给出理由'"——
那条保留。但"清单在、只是缺了 `files`"是另一回事：它有标题有理由，只是文件列表来自暂存目录。
这两种情况的提示语不能是同一句。

**3. 主进程的话也要本地化。**
原计划只管了渲染层的文案（`en.json` 放英文、`zh.json` 放中文）。
但主进程产生的消息（拒绝理由、方案被丢弃的警告、进度行……）是**原样送到界面上的**，
而界面默认语言是英文 —— 英文用户点一下按钮，弹出来的是中文。
改法：主进程用 `translateMain`（`src/main/i18n/main-i18n.ts`，`src/main/crash-reporting/**`
已有先例），键进 `en.json` / `zh.json`，命名空间 `refactor.*`。
**一个例外**：写闸门给 **agent** 看的那句拒绝理由保持中文 —— 提示词本身就是中文，
那是给 agent 的契约的一部分，而且用户看不到（审查 tab 不显示 agent 的 transcript）。

**英文文案要说人话。** 两条规矩：
句子里的数字要**带单位** —— "每个方案最多展示 5 个文件，2 个方案无法展示"里的 `{{dropped}}`
数的是**方案**（计划构建器每丢掉一个方案加一次），英文把名词省掉的话，
用户会以为少了一个文件，而实际上少的是一整个方案（连标题和理由一起没了）；
还有不要把**实现的词**端给用户 —— 界面从头到尾说的是"重构"，没有"一轮"，
所以那句 "The turn did not end" 要改成 "The refactoring did not finish"。

**4. 成功落地之后要回收 job 和暂存目录。**
原来只有 `refactor.discard` 会把 job 从注册表里摘掉，而成功落地之后没人调它。
于是主进程里留着每个被重构文件的**全文**，工作区里留着用户**未保存缓冲区**的副本，
唯一的回收是 24 小时的清扫 —— 而清扫只在这个工作区**下一次发起重构**时才跑。
改法：渲染层在成功落地之后调 `discardRefactor(jobId)`。
**为什么不放在 apply 的 handler 里**：那会改掉"第二次接受被拒"的行为，
而计划把那条钉住了（"写成功之后再点一次接受必须被拒绝…不许写第二遍"）。

**5. 方案数和文件数由代码管住。**
规格把上限写成事实（"一次任务最多 5 分钟、方案数与文件数有上限"）。
5 分钟是代码管的（`REFACTOR_TURN_TIMEOUT_MS`），数量原来只写在提示词里 ——
而"没有清单"的那条兜底路径**什么上限都没有**：agent 写 500 个暂存目录加一个坏清单，
应用就把 500 个目录当 500 个方案读进来渲染。
改法：上限放在 `src/shared/refactor/refactor-limits.ts`（提示词和计划构建器共用一份），
两条路径都管，丢掉的方案**带警告**。

**6. 成功任务的警告要显示在界面上。**
原计划让审查 tab 只渲染**失败**任务的警告（`unfinishedJob(job)` 对 `done` 返回 `null`）。
但规格 §13 要求的那个标记（"agent 未给出理由"）恰恰**只在任务成功时**才会产生 ——
所以规格要求的那句话**从来没有人见过**；同样，被上限丢掉的方案会**静悄悄地消失**。
改法：成功任务的警告也渲染，**读起来像信息，不像故障**；
被**数量**上限丢掉的方案合成**一行**汇总（500 个目录就是 495 行，不能淹掉界面），
因为**用户能据此行动**的原因（id 不安全、两个方案抢同一个文件、暂存文件读不到）仍然各自一行。

**7. 闸门拒绝 Windows 的盘符相对路径。**
Task 3 的闸门原本把 `D:foo` 当成工作区根下的普通相对路径放行，而 Windows 按 D 盘的当前目录解析它 ——
它命名的文件在工作区之外。改法：闸门在**原始路径**上拒绝盘符相对形状，
规则放在闸门模块里、路径规则模块共用同一份（见 Task 3 那一节）。

**8. 解析器为什么按段走 —— 理由不是 Node 的 `realpath`。**
Task 14 原来写"Node 的 `realpath` 会先把 `..` 折掉"。**那是假的**：
`fs/promises.realpath`（这个模块用的那个）**就是**操作系统的解析器，与内核一致；
折 `..` 的是 `fs.realpathSync` 的 JS 实现。
**真正需要手动处理 `..` 的理由是：目标可能还不存在** —— `realpath` 对不存在的路径以 ENOENT 失败，
回答不了它。所以路径要按段切开、每段（不含 `..`）用 OS 的解析器解。

**9. 已知限制：分不清"用户没保存"和"用户把旧内容又存了一遍"。**
落地前的检查接受两种情况：磁盘内容等于**做方案时的磁盘快照**（"用户没保存"），
或者等于**用户当时看到的基准**（"用户在评审期间保存了"）。
有一种情况两者分不开：用户改了未保存的内容 `B` 之后发起重构（基准 = `B`，磁盘 = `D`），
评审期间把那个改动**撤销并保存**了（磁盘又变回 `D`）。这时候检查放行，
文件被写成 `applyRefactorHunks(B, hunks)` —— 用户自己刚撤掉的改动又回来了。
**这一条不在本分支修**：要分清这两种情况，渲染层必须把**当前缓冲区**一起带进 apply，
而那会改掉"文件在评审期间变了"时"接受重构"到底是什么意思 ——
hunk 是按 `B` 算出来的，把它们写到 `D` 上和写到 `B` 上不是同一件事。
那是**设计变更**（RPC 契约 + 语义），不是一次修复，要先有规格上的决定。
常见情况是覆盖的（规格 §6：按基准写盘本来就会把用户未保存的修改一起存进去）。

---

## 完成标准

- `pnpm check:changed --base=9127b3837e` 通过。
- `pnpm tc` 通过。
- `pnpm test src/shared/refactor src/main/refactor src/renderer/src/components/editor/refactor --maxWorkers=2` 通过。
- 人工验证：在一个真实文件上发起重构，agent 在 `.orca/refactor/<jobId>/` 写出暂存文件与 `manifest.json`；审查 tab 里能看到方案、理由和逐个代码块的 diff；分别用「全方案」「全文件」「单个代码块」接受各一次，源码文件按预期被改写；评审期间改动文件后接受会被拒绝。
