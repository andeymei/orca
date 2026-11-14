# 注释驱动的智能体代码生成 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在源码里写 `// @ai <指令>`，Orca 在行号槽识别它、把它交给智能体生成代码，并记录每条指令的派发/完成状态。

**Architecture:** 指令存在**源码文件**里（规格源），状态存在 **Orca 侧工作区 notes 列表**里（状态源），两者按 `filePath + 指令正文` 对齐。派发链路 100% 复用现有的 `ReviewNotesSendMenuContent → sendMessageToAgent / launchAgentInNewTab`，不新建智能体启动通道。识别用 Monaco 分词器，语言无关。

**Tech Stack:** Electron + React 19 + Zustand + Monaco Editor + Zod + Vitest（`pnpm test`）

**Spec:** `docs/superpowers/specs/2026-11-14-comment-driven-agent-code-generation-design.md`

## Global Constraints

- 注释标记固定为 `@ai`，定义在 `src/shared/ai-instruction-types.ts` 的 `AI_INSTRUCTION_MARKER`，任何地方不得再写死字面量。
- 指令正文为空（`// @ai` 单独一行）不构成指令。
- 标记必须出现在注释文本开头（剥掉注释定界符后），`@aider`、`email@ai.com` 不匹配。
- AI 指令记录复用 `DiffComment`，`source: 'ai-instruction'`；不得新建第二套工作区持久化管道。
- 派发链路必须复用 `ReviewNotesSendMenuContent`，不得直接调用 `sendMessageToAgent` 绕过目标选择。
- 新增 UI 文案一律用 `t('auto.components.editor.<File>.<key>', 'default')` 形式；`auto.` 段落的 key 由 `config/scripts/localization/source-extraction/localize-renderer-strings.mjs` 生成（跑 `node config/scripts/localization/source-extraction/localize-renderer-strings.mjs` 后再提交）。
- 新增文件不得使用 `helpers` / `utils` / `common` / `misc` 命名。
- 类型放 `.ts`，不放 `.d.ts`。
- 跨平台：不硬编码 `e.metaKey`；Monaco 快捷键用 `monaco.KeyMod.CtrlCmd`。
- 本计划的所有文件在 `src/renderer` / `src/shared` 下，不新增仓库根目录条目。
- 提交前必须跑 `pnpm check:changed`（基线 `origin/main`），不得 `--no-verify`。
- 按 AGENTS.md：**不默认加测试**。本计划列出的测试都是纯逻辑、会随改动失效、且硬编码期望值的；装饰与菜单接线不加测试。

## Review Focus

以下五类输入/状况规格没有明说，但最可能伤到真实使用者。每一条都已挂到拥有该代码的任务里，由该任务自己的测试钉住。

1. **字符串字面量里的 `@ai`** —— `const s = "// @ai 修一下"` 不是指令。→ Task 4
2. **注释定界符残留** —— `/* @ai 修一下 */` 的指令正文不能带上结尾的 `*/`；`<!-- @ai 修一下 -->` 同理。→ Task 2
3. **同文件两条正文完全相同的指令** —— 一条已完成不能让另一条也显示已完成。→ Task 5
4. **指令正文被改写** —— 改写后是**新指令**（回到待派发），旧指令的完成状态不能继承到新指令上。→ Task 5
5. **普通 diff 评论的写入与发送** —— notes 数组里混着 AI 指令记录，写/读/发 diff 评论时不能把它们渲染成评论卡、发进智能体、或在「全部未发送」里带上。→ Task 6

---

### Task 1: 共享数据模型

**Files:**

- Modify: `src/shared/diff-comment-types.ts`
- Modify: `src/shared/diff-comment-schema.ts`
- Modify: `src/shared/telemetry-property-schemas.ts`
- Create: `src/shared/ai-instruction-types.ts`
- Test: `src/shared/diff-comment-schema.test.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  - `DiffCommentSource = 'diff' | 'markdown' | 'ai-instruction'`
  - `DiffComment.completedAt?: number`（智能体完成该轮工作的时刻）
  - `DiffComment.dispatchedPaneKey?: string`（接收派发的智能体面板，`${tabId}:${leafId}`）
  - `LaunchSource` 新增 `'ai_instruction_send'`
  - `src/shared/ai-instruction-types.ts` 导出：
    ```ts
    export const AI_INSTRUCTION_MARKER = '@ai'
    export type AiInstructionStatus = 'pending' | 'dispatched' | 'completed'
    export type AiInstruction = {
      lineNumber: number
      instruction: string
      commentText: string
      contextExcerpt: string
      contextStartLine: number
      contextEndLine: number
    }
    ```

- [ ] **Step 1: 写失败的测试**

`src/shared/diff-comment-schema.test.ts`（新建）：

```ts
import { describe, expect, it } from 'vitest'
import { DiffCommentSchema } from './diff-comment-schema'

describe('DiffCommentSchema', () => {
  it('keeps an AI instruction record with its dispatch state', () => {
    const parsed = DiffCommentSchema.parse({
      id: 'a1',
      worktreeId: 'w1',
      filePath: 'src/foo.ts',
      source: 'ai-instruction',
      selectedText: 'async function f() {}',
      startLine: 42,
      lineNumber: 42,
      body: '指数退避重试，最多 5 次',
      createdAt: 1_700_000_000_000,
      sentAt: 1_700_000_001_000,
      completedAt: 1_700_000_009_000,
      dispatchedPaneKey: 'tab-1:leaf-1',
      side: 'modified'
    })
    expect(parsed.source).toBe('ai-instruction')
    expect(parsed.completedAt).toBe(1_700_000_009_000)
    expect(parsed.dispatchedPaneKey).toBe('tab-1:leaf-1')
  })

  it('still rejects an unknown source', () => {
    expect(() =>
      DiffCommentSchema.parse({
        id: 'a2',
        worktreeId: 'w1',
        filePath: 'src/foo.ts',
        source: 'agent-instruction',
        lineNumber: 1,
        body: 'x',
        createdAt: 1,
        side: 'modified'
      })
    ).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/shared/diff-comment-schema.test.ts --maxWorkers=2`
Expected: FAIL —— `source: 'ai-instruction'` 被 Zod 枚举拒绝。

- [ ] **Step 3: 改数据模型**

`src/shared/diff-comment-types.ts`：`DiffCommentSource` 加 `'ai-instruction'`；`DiffComment` 加
`completedAt?: number` 与 `dispatchedPaneKey?: string`（各带一行中文注释说明用途）。

`src/shared/diff-comment-schema.ts`：`source: z.enum(['diff', 'markdown', 'ai-instruction']).optional()`，
并加 `completedAt: z.number().finite().optional()`、`dispatchedPaneKey: z.string().optional()`。

`src/shared/telemetry-property-schemas.ts`：`launchSourceSchema` 的枚举里加 `'ai_instruction_send'`。

新建 `src/shared/ai-instruction-types.ts`，内容即上面 Interfaces 段给出的类型与常量。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/shared/diff-comment-schema.test.ts --maxWorkers=2`
Expected: PASS（2 passed）。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/shared/diff-comment-types.ts src/shared/diff-comment-schema.ts src/shared/diff-comment-schema.test.ts src/shared/telemetry-property-schemas.ts src/shared/ai-instruction-types.ts
git commit -m "feat(ai-instruction): add the AI instruction record shape"
```

---

### Task 2: 标记解析

**Files:**

- Create: `src/renderer/src/components/editor/ai-instructions/ai-instruction-marker.ts`
- Test: `src/renderer/src/components/editor/ai-instructions/ai-instruction-marker.test.ts`

**Interfaces:**

- Consumes: `AI_INSTRUCTION_MARKER`（Task 1）
- Produces:

  ```ts
  // 传入一段注释 token 的原始文本；返回指令正文，不是指令则返回 null。
  export function parseAiInstructionComment(commentText: string): string | null
  ```

- [ ] **Step 1: 写失败的测试**

`ai-instruction-marker.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseAiInstructionComment } from './ai-instruction-marker'

describe('parseAiInstructionComment', () => {
  it('reads the instruction from a line comment', () => {
    expect(parseAiInstructionComment('// @ai 指数退避重试，最多 5 次')).toBe(
      '指数退避重试，最多 5 次'
    )
  })

  it('reads the instruction from a hash comment', () => {
    expect(parseAiInstructionComment('# @ai 用 asyncio 改写')).toBe('用 asyncio 改写')
  })

  it('drops the closing delimiter of a block comment', () => {
    expect(parseAiInstructionComment('/* @ai 修一下 */')).toBe('修一下')
  })

  it('drops the closing delimiter of an html comment', () => {
    expect(parseAiInstructionComment('<!-- @ai 修一下 -->')).toBe('修一下')
  })

  it('ignores a marker that is not at the start of the comment', () => {
    expect(parseAiInstructionComment('// TODO: @ai 修一下')).toBeNull()
  })

  it('ignores a marker that is part of a longer word', () => {
    expect(parseAiInstructionComment('// @aider 修一下')).toBeNull()
  })

  it('ignores a marker with no instruction body', () => {
    expect(parseAiInstructionComment('// @ai')).toBeNull()
  })

  it('ignores a comment with no marker', () => {
    expect(parseAiInstructionComment('// 普通注释')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions/ai-instruction-marker.test.ts --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `parseAiInstructionComment`**

新建 `ai-instruction-marker.ts`。算法固定为三步，顺序不可换：

1. `trimStart()` 后剥掉**前导注释装饰字符**（只含 `/ * < > ! - # % ;` 与空白）——这样 `//`、`/*`、`<!--`、`#`、`--`、`;`、`%`、`*` 都能剥掉，而 `@` 不在剥除集里（否则 `@ai` 会被剥成 `ai`）。
2. 剥掉**结尾的注释闭合符**：`\s*(\*\/|-->)\s*$`。
3. 用 `AI_INSTRUCTION_MARKER` 匹配开头：必须 `=== marker`、或后跟 `:`、或后跟空白；后一种情况取剩余部分 `replace(/^[:\s]+/, '').trim()` 作为正文。剩余为空则返回 `null`。

注意第 1 步的前导字符集**不能包含 `@`、`_` 或字母数字**。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions/ai-instruction-marker.test.ts --maxWorkers=2`
Expected: PASS（8 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/editor/ai-instructions/ai-instruction-marker.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-marker.test.ts
git commit -m "feat(ai-instruction): parse the @ai marker out of a comment"
```

---

### Task 3: Prompt 拼装

**Files:**

- Create: `src/shared/ai-instruction-prompt.ts`
- Test: `src/shared/ai-instruction-prompt.test.ts`

**Interfaces:**

- Consumes: `AI_INSTRUCTION_MARKER`（Task 1）
- Produces:

  ```ts
  export function formatAiInstructionPrompt(args: {
    filePath: string
    lineNumber: number
    instruction: string
    contextStartLine: number
    contextEndLine: number
    contextExcerpt: string
  }): string

  export function formatAiInstructionBatchPrompt(args: {
    filePath: string
    instructions: readonly { lineNumber: number; instruction: string }[]
  }): string
  ```

- [ ] **Step 1: 写失败的测试**

`src/shared/ai-instruction-prompt.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { formatAiInstructionBatchPrompt, formatAiInstructionPrompt } from './ai-instruction-prompt'

describe('formatAiInstructionPrompt', () => {
  it('states the file, the line, the instruction and the context', () => {
    expect(
      formatAiInstructionPrompt({
        filePath: 'src/foo.ts',
        lineNumber: 42,
        instruction: '指数退避重试，最多 5 次',
        contextStartLine: 38,
        contextEndLine: 70,
        contextExcerpt: 'async function f() {}'
      })
    ).toBe(
      [
        'Implement the AI instruction at src/foo.ts:42.',
        '',
        'Instruction: 指数退避重试，最多 5 次',
        '',
        'Context (src/foo.ts:38-70):',
        'async function f() {}',
        '',
        'Keep the `// @ai` comment in place.'
      ].join('\n')
    )
  })
})

describe('formatAiInstructionBatchPrompt', () => {
  it('lists every instruction with its line', () => {
    expect(
      formatAiInstructionBatchPrompt({
        filePath: 'src/foo.ts',
        instructions: [
          { lineNumber: 42, instruction: '指数退避重试' },
          { lineNumber: 88, instruction: '提取成独立 schema' }
        ]
      })
    ).toBe(
      [
        'Implement the following AI instructions in src/foo.ts.',
        '',
        '1. Line 42: 指数退避重试',
        '2. Line 88: 提取成独立 schema',
        '',
        'Keep every `// @ai` comment in place.'
      ].join('\n')
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/shared/ai-instruction-prompt.test.ts --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现两个格式化函数**

新建 `src/shared/ai-instruction-prompt.ts`。两个函数的输出**逐字符**等于测试里的期望字符串（换行用 `\n`，行尾无多余空格）。

- 单条：`Implement the AI instruction at <filePath>:<lineNumber>.` → 空行 → `Instruction: <instruction>` → 空行 →
  `Context (<filePath>:<start>-<end>):` → `<contextExcerpt>` → 空行 → `Keep the \`// @ai\` comment in place.`
- 批量：`Implement the following AI instructions in <filePath>.` → 空行 → 逐条 `N. Line <lineNumber>: <instruction>` → 空行 →
  `Keep every \`// @ai\` comment in place.`

末句里的标记取 `AI_INSTRUCTION_MARKER` 常量拼进模板，不要写死 `@ai` 字面量。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/shared/ai-instruction-prompt.test.ts --maxWorkers=2`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ai-instruction-prompt.ts src/shared/ai-instruction-prompt.test.ts
git commit -m "feat(ai-instruction): build the single and batch prompts"
```

---

### Task 4: 扫描与上下文片段

**Files:**

- Create: `src/renderer/src/components/editor/ai-instructions/ai-instruction-scan.ts`
- Create: `src/renderer/src/components/editor/ai-instructions/ai-instruction-context.ts`
- Test: `src/renderer/src/components/editor/ai-instructions/ai-instruction-scan.test.ts`
- Test: `src/renderer/src/components/editor/ai-instructions/ai-instruction-context.test.ts`

**Interfaces:**

- Consumes: `parseAiInstructionComment`（Task 2）、`AiInstruction`（Task 1）
- Produces:

  ```ts
  // ai-instruction-scan.ts
  export type AiInstructionToken = { text: string; type: string }
  // 纯函数：给定每一行的 token，产出指令清单（不含上下文）。
  export function collectAiInstructions(
    lineTokens: readonly (readonly AiInstructionToken[])[]
  ): { lineNumber: number; instruction: string; commentText: string }[]
  // Monaco 适配层：读 model 的 token 后调用上面的纯函数。
  export function scanAiInstructions(model: editor.ITextModel): AiInstruction[]

  // ai-instruction-context.ts
  export type AiInstructionFoldingRange = { startLineNumber: number; endLineNumber: number }
  // 纯函数：在折叠区间里挑出包含该行的最内层区间；没有就退回 ±CONTEXT_FALLBACK_LINES 行。
  export function resolveAiInstructionContextRange(
    ranges: readonly AiInstructionFoldingRange[],
    lineNumber: number,
    lineCount: number
  ): { startLine: number; endLine: number }
  // Monaco 适配层：读 model 的折叠区间与文本，拼出片段。
  export function buildAiInstructionContext(
    model: editor.ITextModel,
    lineNumber: number
  ): { excerpt: string; startLine: number; endLine: number }
  ```

- [ ] **Step 1: 写失败的测试**

`ai-instruction-scan.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { collectAiInstructions } from './ai-instruction-scan'

describe('collectAiInstructions', () => {
  it('finds an instruction in a line comment', () => {
    expect(
      collectAiInstructions([
        [{ text: 'const a = 1', type: 'identifier' }],
        [{ text: '// @ai 修一下', type: 'comment' }]
      ])
    ).toEqual([{ lineNumber: 2, instruction: '修一下', commentText: '// @ai 修一下' }])
  })

  it('ignores a marker inside a string literal', () => {
    expect(
      collectAiInstructions([[{ text: 'const s = "// @ai 修一下"', type: 'string' }]])
    ).toEqual([])
  })

  it('ignores a comment whose token type is not a comment', () => {
    expect(collectAiInstructions([[{ text: '// @ai 修一下', type: 'string' }]])).toEqual([])
  })

  it('accepts every comment token flavour', () => {
    expect(
      collectAiInstructions([
        [{ text: '/* @ai 甲 */', type: 'comment.block' }],
        [{ text: '<!-- @ai 乙 -->', type: 'comment' }]
      ]).map((item) => item.instruction)
    ).toEqual(['甲', '乙'])
  })
})
```

`ai-instruction-context.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { resolveAiInstructionContextRange } from './ai-instruction-context'

describe('resolveAiInstructionContextRange', () => {
  it('picks the innermost folding range containing the line', () => {
    expect(
      resolveAiInstructionContextRange(
        [
          { startLineNumber: 1, endLineNumber: 100 },
          { startLineNumber: 30, endLineNumber: 60 }
        ],
        42,
        100
      )
    ).toEqual({ startLine: 30, endLine: 60 })
  })

  it('falls back to a window around the line when no range covers it', () => {
    expect(resolveAiInstructionContextRange([], 42, 100)).toEqual({ startLine: 32, endLine: 52 })
  })

  it('never starts before the first line', () => {
    expect(resolveAiInstructionContextRange([], 3, 100)).toEqual({ startLine: 1, endLine: 13 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions --maxWorkers=2`
Expected: FAIL —— 两个模块都不存在。

- [ ] **Step 3: 实现扫描**

新建 `ai-instruction-scan.ts`：

- `collectAiInstructions(lineTokens)`：逐行遍历 token；**只认 token 类型名以 `comment` 开头的**（`comment`、`comment.line`、`comment.block`、`comment.doc` 等）；对每个注释 token 调 `parseAiInstructionComment(token.text)`，非 null 就产出一条 `{ lineNumber: <行号，1-based>, instruction, commentText: token.text.trim() }`。
- `scanAiInstructions(model)`：用 `model.getLineTokens(line)` 逐行取 token 喂给 `collectAiInstructions`，再为每条指令调 `buildAiInstructionContext(model, lineNumber)` 补上 `contextExcerpt` / `contextStartLine` / `contextEndLine`，返回 `AiInstruction[]`。

新建 `ai-instruction-context.ts`：

- `CONTEXT_FALLBACK_LINES = 10`，`CONTEXT_MAX_LINES = 60`。
- `resolveAiInstructionContextRange(ranges, lineNumber, lineCount)`：先筛出 `startLineNumber <= lineNumber <= endLineNumber` 的区间，取跨度最小的一个；跨度超过 `CONTEXT_MAX_LINES` 就按 `lineNumber` 居中裁到 `CONTEXT_MAX_LINES` 行。没有命中就退回 `lineNumber ± CONTEXT_FALLBACK_LINES`，并夹到 `[1, lineCount]`。
- `buildAiInstructionContext(model, lineNumber)`：用 `model.getFoldingRanges()`（可能返回 `undefined`，当空数组处理）求区间，再用
  `model.getValueInRange({ startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine) })` 取文本。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions --maxWorkers=2`
Expected: PASS（7 passed）。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/editor/ai-instructions/ai-instruction-scan.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-scan.test.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-context.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-context.test.ts
git commit -m "feat(ai-instruction): scan a file for @ai instructions"
```

---

### Task 5: 指令与记录的状态对齐

**Files:**

- Create: `src/renderer/src/components/editor/ai-instructions/ai-instruction-status.ts`
- Test: `src/renderer/src/components/editor/ai-instructions/ai-instruction-status.test.ts`

**Interfaces:**

- Consumes: `AiInstruction`、`AiInstructionStatus`（Task 1）、`DiffComment`（Task 1）
- Produces:

  ```ts
  export type ResolvedAiInstruction = AiInstruction & {
    status: AiInstructionStatus
    recordId?: string
  }
  // instructions：当前文件扫描出的指令；records：该文件已有的 AI 指令记录。
  export function resolveAiInstructionStatuses(
    instructions: readonly AiInstruction[],
    records: readonly DiffComment[]
  ): ResolvedAiInstruction[]
  ```

- [ ] **Step 1: 写失败的测试**

`ai-instruction-status.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { resolveAiInstructionStatuses } from './ai-instruction-status'

const instruction = (lineNumber: number, text: string) => ({
  lineNumber,
  instruction: text,
  commentText: `// @ai ${text}`,
  contextExcerpt: '',
  contextStartLine: lineNumber,
  contextEndLine: lineNumber
})

const record = (body: string, lineNumber: number, extra: Record<string, unknown> = {}) => ({
  id: `id-${body}-${lineNumber}`,
  worktreeId: 'w1',
  filePath: 'src/foo.ts',
  source: 'ai-instruction' as const,
  startLine: lineNumber,
  lineNumber,
  body,
  createdAt: 1,
  side: 'modified' as const,
  ...extra
})

describe('resolveAiInstructionStatuses', () => {
  it('marks an instruction with no record as pending', () => {
    expect(resolveAiInstructionStatuses([instruction(10, '甲')], [])[0].status).toBe('pending')
  })

  it('marks an instruction with a sent record as dispatched', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲')],
      [record('甲', 10, { sentAt: 2 })]
    )
    expect(resolved[0].status).toBe('dispatched')
  })

  it('marks an instruction with a completed record as completed', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲')],
      [record('甲', 10, { sentAt: 2, completedAt: 3 })]
    )
    expect(resolved[0].status).toBe('completed')
  })

  it('does not let one completed record complete a twin instruction elsewhere', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲'), instruction(90, '甲')],
      [record('甲', 10, { sentAt: 2, completedAt: 3 })]
    )
    expect(resolved.map((item) => item.status)).toEqual(['completed', 'pending'])
  })

  it('does not carry a completed state onto a rewritten instruction', () => {
    const resolved = resolveAiInstructionStatuses(
      [instruction(10, '甲改')],
      [record('甲', 10, { sentAt: 2, completedAt: 3 })]
    )
    expect(resolved[0].status).toBe('pending')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions/ai-instruction-status.test.ts --maxWorkers=2`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `resolveAiInstructionStatuses`**

新建 `ai-instruction-status.ts`：

1. 先按 `body`（指令正文）把 `records` 分组。
2. 对每条 instruction，在同 `body` 的记录里挑**行号最近**的那条（`Math.abs(record.lineNumber - instruction.lineNumber)` 最小；平手时取行号小的那条）。
3. 挑到记录后：没有 `sentAt` → `pending`；有 `sentAt` 没有 `completedAt` → `dispatched`；有 `completedAt` → `completed`。
4. 没挑到记录 → `pending`，`recordId` 为 `undefined`。
5. 返回的每项保留 `AiInstruction` 的全部字段，并带上 `status` 与 `recordId`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions/ai-instruction-status.test.ts --maxWorkers=2`
Expected: PASS（5 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/editor/ai-instructions/ai-instruction-status.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-status.test.ts
git commit -m "feat(ai-instruction): match instructions against their records"
```

---

### Task 6: notes 读取过滤与 AI 记录访问器

**Files:**

- Modify: `src/renderer/src/lib/source-control/review/comments/diff-comment-compat.ts`
- Modify: `src/renderer/src/components/diff-comments/use-diff-comment-owner.ts`
- Modify: `src/renderer/src/components/diff-comments/use-visible-worktree-diff-comments.ts`
- Modify: `src/renderer/src/store/slices/diff-comments/create-diff-comments-slice.ts`
- Modify: `src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts`
- Test: `src/renderer/src/components/diff-comments/use-diff-comment-owner.test.tsx`

**Interfaces:**

- Consumes: `DiffCommentSource` 含 `'ai-instruction'`（Task 1）
- Produces:

  ```ts
  // diff-comment-compat.ts
  export function isAiInstructionComment(comment: Pick<DiffComment, 'source'>): boolean
  // getDiffCommentSource 必须把 'ai-instruction' 原样返回，不能再归一成 'diff'。

  // use-diff-comment-owner.ts
  export function useAiInstructionComments(
    worktreeId: string | null | undefined,
    source: WorkspaceCopySource
  ): { owner: DiffCommentOwner | null; comments: DiffComment[] | undefined }
  // useDiffCommentView 的 comments 不再包含 source === 'ai-instruction' 的记录。

  // create-diff-comments-slice.ts
  getDiffComments(worktreeId) 不再返回 source === 'ai-instruction' 的记录。
  getAiInstructionComments(worktreeId): DiffComment[]
  ```

- [ ] **Step 1: 写失败的测试**

在 `src/renderer/src/components/diff-comments/use-diff-comment-owner.test.tsx` 追加一个用例。该文件已经
import 了 `renderHook`、`useAppStore`、`useDiffCommentView`（需补进 import）、`makeWorktree` 与本地的
`seedTwins` / `note` 辅助函数，直接复用：

```ts
it('keeps AI instruction records out of the review notes a surface renders', () => {
  seedTwins('local', [note('r1'), { ...note('a1'), source: 'ai-instruction' }])
  const { result } = renderHook(() => useDiffCommentView(WT, 'selection'))
  expect(result.current.comments?.map((c) => c.id)).toEqual(['r1'])
  expect(
    useAppStore
      .getState()
      .getDiffComments(WT)
      .map((c) => c.id)
  ).toEqual(['r1'])
  expect(
    useAppStore
      .getState()
      .getAiInstructionComments(WT)
      .map((c) => c.id)
  ).toEqual(['a1'])
})
```

（`note('a1')` 默认返回 `{ id: 'a1', worktreeId: WT, filePath: 'a.ts', lineNumber: 1, body: 'a1', createdAt: 1, side: 'modified' }`，
展开后加 `source: 'ai-instruction'` 即可；`seedTwins('local', [...])` 会把这两条记录放进本地那份工作区副本。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/components/diff-comments/use-diff-comment-owner.test.tsx --maxWorkers=2`
Expected: FAIL —— `getAiInstructionComments` 不存在。

- [ ] **Step 3: 实现过滤**

`diff-comment-compat.ts`：

- `getDiffCommentSource` 改成三分支：`'markdown'` → `'markdown'`；`'ai-instruction'` → `'ai-instruction'`；其余 → `'diff'`。
- 新增 `isAiInstructionComment(comment)`：`getDiffCommentSource(comment) === 'ai-instruction'`。

`use-diff-comment-owner.ts`：

- `useDiffCommentView` 返回的 `comments` 过滤掉 `isAiInstructionComment` 的记录。
- 新增 `useAiInstructionComments(worktreeId, source)`：复用 `selectDiffCommentView` 拿到 owner 与全量记录，返回只含 `isAiInstructionComment` 的子集。

`use-visible-worktree-diff-comments.ts`：在它已有的可见性过滤里排除 `isAiInstructionComment` 的记录（这样右侧 notes 侧栏看不到它们）。

`create-diff-comments-slice.ts`：

- `getDiffComments` 过滤掉 `isAiInstructionComment`。
- 新增 `getAiInstructionComments(worktreeId)`：返回该工作区全部 `isAiInstructionComment` 的记录。

`diff-comment-persistence.ts` 的 `normalizeDiffComment`：source 白名单加上 `'ai-instruction'`；并清洗 `completedAt`（有限正数）与 `dispatchedPaneKey`（非空字符串）。

**注意**：`readOwnedDiffComments`（内部读取）**不要**过滤——增删改记录时必须拿到完整数组，否则会把 AI 指令记录抹掉。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/components/diff-comments/use-diff-comment-owner.test.tsx --maxWorkers=2`
Expected: PASS。

再跑一遍既有 notes 相关测试，确认没打破原有行为：

Run: `pnpm test src/renderer/src/store/slices/diff-comments --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/lib/source-control/review/comments/diff-comment-compat.ts src/renderer/src/components/diff-comments/use-diff-comment-owner.ts src/renderer/src/components/diff-comments/use-visible-worktree-diff-comments.ts src/renderer/src/store/slices/diff-comments/create-diff-comments-slice.ts src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts src/renderer/src/components/diff-comments/use-diff-comment-owner.test.tsx
git commit -m "feat(ai-instruction): keep AI records out of the review notes"
```

---

### Task 7: 派发打戳与完成补戳

**Files:**

- Modify: `src/renderer/src/store/slices/diff-comments/create-diff-comments-slice.ts`
- Test: `src/renderer/src/store/slices/diff-comments/ai-instruction-records.test.ts`

**Interfaces:**

- Consumes: `DiffCommentOwner`、`mutateDiffComments`、`enqueueDiffCommentPersist`（既有）、`DiffComment` 新字段（Task 1）
- Produces:

  ```ts
  // 派发：写入或更新一条 AI 指令记录（按 filePath + lineNumber + body 定位）。
  markAiInstructionsDispatched: (
    owner: DiffCommentOwner,
    records: readonly {
      filePath: string
      lineNumber: number
      body: string
      selectedText?: string
      dispatchedPaneKey?: string
    }[],
    options?: {
      sentAt?: number
      // 该文件当前的指令清单。给了就把不在清单里的旧记录剔除（孤儿清理）。
      currentInstructions?: readonly { lineNumber: number; instruction: string }[]
    }
  ) => Promise<boolean>

  // 完成：给已派发的记录补 completedAt。
  markAiInstructionsCompleted: (
    owner: DiffCommentOwner,
    recordIds: readonly string[],
    completedAt?: number
  ) => Promise<boolean>
  ```

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/store/slices/diff-comments/ai-instruction-records.test.ts`。**照抄**
`src/renderer/src/store/slices/diff-comments/folder-workspace-diff-comments.test.ts` 的骨架（局部 zustand store +
`globalThis.window.api.folderWorkspaces.update` mock + `folderWorkspaceKey`），只是把被测对象换成新动作：

```ts
import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../types'
import { createDiffCommentsSlice } from './create-diff-comments-slice'
import { folderWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { FolderWorkspace } from '../../../../../shared/folder-workspaces/folder-workspace-types'

const folderWorkspacesUpdate = vi.fn()
globalThis.window = {
  api: { folderWorkspaces: { update: folderWorkspacesUpdate } }
} as never

function createStore() {
  return create<AppState>()((...args) => {
    const slice = createDiffCommentsSlice(...args)
    return {
      ...slice,
      settings: null,
      activeWorktreeId: folderWorkspaceKey('folder-1'),
      activeWorkspaceExecutionHostId: 'local',
      folderWorkspaces: [
        {
          id: 'folder-1',
          projectGroupId: 'group-1',
          folderPath: '/workspace',
          executionHostId: 'local',
          diffComments: []
        } as FolderWorkspace
      ],
      projectGroups: [],
      runtimeEnvironments: [],
      restoredRuntimeHostIdByWorkspaceSessionKey: {},
      worktreesByRepo: {}
    } as unknown as AppState
  })
}
```

三个用例：

```ts
it('stamps a dispatched AI instruction and keeps it', async () => {
  const store = createStore()
  const owner = selectDiffCommentView(
    store.getState(),
    folderWorkspaceKey('folder-1'),
    'selection'
  ).owner!
  const ok = await store
    .getState()
    .markAiInstructionsDispatched(owner, [
      { filePath: 'src/foo.ts', lineNumber: 42, body: '指数退避重试' }
    ])
  expect(ok).toBe(true)
  const records = store.getState().getAiInstructionComments(folderWorkspaceKey('folder-1'))
  expect(records).toHaveLength(1)
  expect(records[0].source).toBe('ai-instruction')
  expect(records[0].sentAt).toBeGreaterThan(0)
  expect(records[0].completedAt).toBeUndefined()
})

it('completes an AI instruction without deleting it', async () => {
  const store = createStore()
  const owner = selectDiffCommentView(
    store.getState(),
    folderWorkspaceKey('folder-1'),
    'selection'
  ).owner!
  await store
    .getState()
    .markAiInstructionsDispatched(owner, [
      { filePath: 'src/foo.ts', lineNumber: 42, body: '指数退避重试' }
    ])
  const id = store.getState().getAiInstructionComments(folderWorkspaceKey('folder-1'))[0].id
  await store.getState().markAiInstructionsCompleted(owner, [id])
  const records = store.getState().getAiInstructionComments(folderWorkspaceKey('folder-1'))
  expect(records).toHaveLength(1)
  expect(records[0].completedAt).toBeGreaterThan(0)
})

it('drops records whose instruction no longer exists in the file', async () => {
  const store = createStore()
  const owner = selectDiffCommentView(
    store.getState(),
    folderWorkspaceKey('folder-1'),
    'selection'
  ).owner!
  await store
    .getState()
    .markAiInstructionsDispatched(owner, [
      { filePath: 'src/foo.ts', lineNumber: 42, body: '旧指令' }
    ])
  await store
    .getState()
    .markAiInstructionsDispatched(
      owner,
      [{ filePath: 'src/foo.ts', lineNumber: 42, body: '新指令' }],
      { currentInstructions: [{ lineNumber: 42, instruction: '新指令' }] }
    )
  const records = store.getState().getAiInstructionComments(folderWorkspaceKey('folder-1'))
  expect(records.map((r) => r.body)).toEqual(['新指令'])
})
```

（`selectDiffCommentView` 从 `./diff-comment-owner` import。第三个用例覆盖设计稿 §4.4 的孤儿清理：
指令正文被改写后，旧记录在下一次派发写入时被剔除。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/store/slices/diff-comments/ai-instruction-records.test.ts --maxWorkers=2`
Expected: FAIL —— 两个动作不存在。

- [ ] **Step 3: 实现两个动作**

在 `create-diff-comments-slice.ts` 里实现：

- `markAiInstructionsDispatched`：
  1. 先按 `filePath + lineNumber + body` 在现有 AI 记录里找同一条；找到就更新（`sentAt`、`dispatchedPaneKey`、
     `selectedText`），找不到就新增一条
     `{ id: createNonSecureContextUuid(), worktreeId: owner.worktreeId, filePath, source: 'ai-instruction', startLine: lineNumber, lineNumber, body, selectedText, createdAt, sentAt, dispatchedPaneKey, side: 'modified' }`。
  2. **孤儿清理**：若 `options.currentInstructions` 给了，就把「同一 `filePath` 下、`body` 不在当前指令正文清单里」的
     AI 记录从列表里剔除。
  3. 复用 `mutateDiffComments` + `enqueueDiffCommentPersist`，一次写入同时完成新增与剔除。
- `markAiInstructionsCompleted`：把匹配 `recordIds` 的记录补上 `completedAt`，同样走 `mutateDiffComments` +
  `enqueueDiffCommentPersist`。
- 两个动作都**不要**调用 `recordReviewNoteInteraction`（AI 指令的写入不是 review-notes 交互）。
- 两个动作在 `readOwnedDiffComments(get(), owner)` 返回 undefined（副本没了）时返回 `false`，与既有动作一致。
- 注意：清理只作用于 `options.currentInstructions` 覆盖的那个 `filePath`，其他文件的记录不动（设计稿 §9 已知限制）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/store/slices/diff-comments --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/store/slices/diff-comments/create-diff-comments-slice.ts src/renderer/src/store/slices/diff-comments/ai-instruction-records.test.ts
git commit -m "feat(ai-instruction): record dispatch and completion"
```

---

### Task 8: ai-instructions store slice

**Files:**

- Create: `src/renderer/src/store/slices/ai-instructions/ai-instruction-entries.ts`
- Create: `src/renderer/src/store/slices/ai-instructions/create-ai-instructions-slice.ts`
- Modify: `src/renderer/src/store/types.ts`
- Modify: `src/renderer/src/store/testing/app-store-test-fixture.ts`
- Test: `src/renderer/src/store/slices/ai-instructions/ai-instruction-entries.test.ts`

**Interfaces:**

- Consumes: `ResolvedAiInstruction`（Task 5）
- Produces:

  ```ts
  // ai-instruction-entries.ts
  export function aiInstructionFileKey(worktreeId: string, relativePath: string): string

  // create-ai-instructions-slice.ts
  export type AiInstructionsSlice = {
    aiInstructionEntriesByFile: Record<string, ResolvedAiInstruction[]>
    publishAiInstructionEntries: (
      key: string,
      entries: readonly ResolvedAiInstruction[] | null
    ) => void
    getAiInstructionEntries: (key: string) => ResolvedAiInstruction[]
  }
  ```

- [ ] **Step 1: 写失败的测试**

新建 `src/renderer/src/store/slices/ai-instructions/ai-instruction-entries.test.ts`：

```ts
it('keeps the published entries under the file key and clears them on null', () => {
  const { store } = createTestStore()
  const key = aiInstructionFileKey('w1', 'src/foo.ts')
  store.getState().publishAiInstructionEntries(key, [
    {
      lineNumber: 42,
      instruction: '甲',
      commentText: '// @ai 甲',
      contextExcerpt: '',
      contextStartLine: 42,
      contextEndLine: 42,
      status: 'pending'
    }
  ])
  expect(store.getState().getAiInstructionEntries(key)).toHaveLength(1)
  store.getState().publishAiInstructionEntries(key, null)
  expect(store.getState().getAiInstructionEntries(key)).toEqual([])
})

it('separates two workspaces that share a relative path', () => {
  const { store } = createTestStore()
  expect(aiInstructionFileKey('w1', 'src/foo.ts')).not.toBe(
    aiInstructionFileKey('w2', 'src/foo.ts')
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/store/slices/ai-instructions --maxWorkers=2`
Expected: FAIL —— slice 还不存在。

- [ ] **Step 3: 实现 slice**

`ai-instruction-entries.ts`：`aiInstructionFileKey(worktreeId, relativePath)` 返回 `${worktreeId}\u0000${relativePath}`
（用 `\u0000` 分隔，避免 id 里含分隔符时撞车）。

`create-ai-instructions-slice.ts`：按 zustand `StateCreator<AppState>` 写：

- `aiInstructionEntriesByFile: {}`
- `publishAiInstructionEntries(key, entries)`：`entries === null` 时删掉该 key，否则写入。
- `getAiInstructionEntries(key)`：返回 `aiInstructionEntriesByFile[key] ?? []`。

`src/renderer/src/store/types.ts`：把 `AiInstructionsSlice` 并进 `AppState`（与 `DiffCommentsSlice` 同样的写法）。
`src/renderer/src/store/testing/app-store-test-fixture.ts`：注册 `createAiInstructionsSlice`（与
`createDiffCommentsSlice` 同样的写法）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/store/slices/ai-instructions --maxWorkers=2`
Expected: PASS（2 passed）。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/store/slices/ai-instructions src/renderer/src/store/types.ts src/renderer/src/store/testing/app-store-test-fixture.ts
git commit -m "feat(ai-instruction): add the AI instruction store slice"
```

---

### Task 9: Monaco 集成（行号槽与扫描发布）

**Files:**

- Create: `src/renderer/src/components/editor/ai-instructions/use-monaco-ai-instructions.ts`
- Modify: `src/renderer/src/components/editor/MonacoEditor.tsx`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: `scanAiInstructions`（Task 4）、`resolveAiInstructionStatuses`（Task 5）、
  `useAiInstructionComments`（Task 6）、`aiInstructionFileKey` / `publishAiInstructionEntries`（Task 8）、
  `DiffCommentOwner`（既有）
- Produces:

  ```ts
  export type AiInstructionGlyph = {
    lineNumber: number
    status: AiInstructionStatus
    instruction: string
  }

  export function useMonacoAiInstructions(params: {
    mountedEditor: editor.IStandaloneCodeEditor | null
    model: editor.ITextModel | null
    relativePath: string
    worktreeId: string | undefined
    noteSource: WorkspaceResource
    enabled: boolean
  }): {
    glyphs: AiInstructionGlyph[]
    onGlyphClick: (lineNumber: number) => void
  }
  ```

- [ ] **Step 1: 实现 hook**

新建 `use-monaco-ai-instructions.ts`：

1. **扫描**：一个 effect 依赖 `model` 与 `model.getValue()`（用 `model.onDidChangeContent` 订阅），每次变化调
   `scanAiInstructions(model)` 得到 `AiInstruction[]`。
2. **对齐状态**：用 `useAiInstructionComments(worktreeId, noteSource)` 拿到该副本的 AI 记录，过滤出
   `filePath === relativePath` 的，用 `resolveAiInstructionStatuses(instructions, records)` 得到带状态的清单。
3. **发布到 store**：`publishAiInstructionEntries(aiInstructionFileKey(worktreeId, relativePath), resolved)`；
   卸载时发布 `null`。
4. **行号槽装饰**：用 `editor.createDecorationsCollection()` 建一个集合，每个指令一条装饰：
   - `range` = 该行整行（`new monaco.Range(lineNumber, 1, lineNumber, 1)`）
   - `options.glyphMarginClassName` 按状态取三个类名之一：
     `ai-instruction-glyph--pending` / `ai-instruction-glyph--dispatched` / `ai-instruction-glyph--completed`
   - `options.glyphMarginHoverMessage` = `{ value: instruction }`
   - `options.isWholeLine = false`
     装饰集合在 effect 里 `.set(...)` 更新，卸载时 `.clear()`。
5. **点击**：注册 `editor.onMouseDown((e) => { if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) { const line = e.target.position?.lineNumber; if (line) onGlyphClick(line) } })`，
   订阅在卸载时 dispose。`monaco` 从 `use-monaco-editor-mount.ts` 的 `OnMount` 第二参数拿，或直接
   `import * as monaco from 'monaco-editor'`（与仓库里 `install-monaco-context-menu-paste.ts` 同样做法）。

- [ ] **Step 2: 挂到 MonacoEditor**

`src/renderer/src/components/editor/MonacoEditor.tsx`：

- 引入 `useMonacoAiInstructions`。
- `enabled` 传 `Boolean(worktreeId) && !readOnly && !passiveMirror`（只读镜像与被动镜像不显示指令）。
- 把 hook 返回的 `glyphs` 与 `onGlyphClick` 交给 Task 10 的弹层组件。

- [ ] **Step 3: 加 CSS**

`src/renderer/src/assets/main.css` 里加三个类，用 `docs/STYLEGUIDE.md` 规定的 token（不要硬编码颜色）：

```css
.ai-instruction-glyph--pending {
  background: ...;
}
.ai-instruction-glyph--dispatched {
  background: ...;
}
.ai-instruction-glyph--completed {
  background: ...;
}
```

三个类分别用 `main.css` 里已有的 token 表达「待派发 / 进行中 / 已完成」三档（用 `--muted-foreground` 与
`--primary` 之类的既有变量，不新增颜色值）。图标形状可用内联的 SVG data URI 或伪元素；保持三个类在小尺寸下可区分。

- [ ] **Step 4: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/components/editor/ai-instructions/use-monaco-ai-instructions.ts src/renderer/src/components/editor/MonacoEditor.tsx src/renderer/src/assets/main.css
git commit -m "feat(ai-instruction): show AI instructions in the editor gutter"
```

---

### Task 10: 发送菜单与头部批量按钮

**Files:**

- Create: `src/renderer/src/components/editor/ai-instructions/ai-instruction-send-menu.tsx`
- Modify: `src/renderer/src/components/editor/EditorPanelHeader.tsx`
- Modify: `src/renderer/src/components/editor/MonacoEditor.tsx`
- Modify: `src/renderer/src/components/editor/review-note-delivery/ReviewNotesSendMenuContent.tsx`

**Interfaces:**

- Consumes: `formatAiInstructionPrompt` / `formatAiInstructionBatchPrompt`（Task 3）、
  `ResolvedAiInstruction`（Task 5）、`markAiInstructionsDispatched`（Task 7）、
  `ReviewNotesSendMenuContent`（既有）、`useAiInstructionComments`（Task 6）
- Produces:

  ```ts
  // ReviewNotesSendMenuContent.tsx —— onPromptDelivered 现在带一个可选的派发上下文。
  export type AiInstructionDeliveryContext = { paneKey?: string; tabId?: string }
  // onPromptDelivered?: (context?: AiInstructionDeliveryContext) => void

  // ai-instruction-send-menu.tsx
  export function AiInstructionSendMenu(props: {
    worktreeId: string
    groupId: string
    owner: DiffCommentOwner | null
    /** 指令所属文件的相对路径；用于 prompt 里的文件定位。 */
    filePath: string
    entries: readonly ResolvedAiInstruction[]
    scope: 'single' | 'batch'
    onDelivered: (entries: readonly ResolvedAiInstruction[]) => void
    trigger?: React.ReactNode
  }): React.JSX.Element
  ```

- [ ] **Step 1: 让 `onPromptDelivered` 带上派发上下文**

`ReviewNotesSendMenuContent.tsx`：

- `onPromptDelivered?: (context?: { paneKey?: string; tabId?: string }) => void`。
- 在 `sendToAgentTarget` 的成功分支里改成 `onPromptDelivered?.({ paneKey: target.paneKey, tabId: target.tabId })`。
- 既有调用方（`DiffNotesSendMenu`、`NotesSendMenu`）传的是无参函数，签名放宽后不受影响。

- [ ] **Step 2: 写 `AiInstructionSendMenu`**

新建 `ai-instruction-send-menu.tsx`：

- 构造 prompt：
  - `scope === 'single'` → `formatAiInstructionPrompt({ filePath: props.filePath, lineNumber, instruction, contextStartLine, contextEndLine, contextExcerpt })`（用 `entries[0]`）
  - `scope === 'batch'` → `formatAiInstructionBatchPrompt({ filePath: props.filePath, instructions: entries.map(...) })`
- `props.filePath` 是该文件的相对路径（调用方保证 entries 属于同一文件）。
- 渲染一个 `DropdownMenu`，内容放 `ReviewNotesSendMenuContent`（props：`worktreeId`、`groupId`、`prompt`、
  `promptDelivery="submit-after-ready"`、`launchSource="ai_instruction_send"`、
  `onPromptDelivered`、`onPromptHandedOff`）。
- `onPromptDelivered` 里调用外部传入的 `onDelivered(entries)`。

- [ ] **Step 3: 行号槽弹层**

在 `MonacoEditor.tsx` 的 AI 指令 hook 旁边渲染弹层：

- 点击行号槽图标 → 打开一个锚定在该行的浮层（定位复用
  `getDiffCommentPopoverTop` / `getDiffCommentPopoverLeft`，见
  `src/renderer/src/components/diff-comments/diff-comment-popover-position.ts`）。
- 浮层内容：指令正文（只读）+ 一个「发送给智能体」的 `AiInstructionSendMenu`（`scope="single"`）+ 已派发时的
  「标记为已完成」「重新派发」。

- [ ] **Step 4: 头部批量按钮**

`EditorPanelHeader.tsx`：在现有 `DiffNotesSendMenu`（"AI notes" 按钮）那块之后、同一个 flex 容器里加一个按钮：

- 文案 `AI 指令 (N)`，`N` = 当前文件的**待派发**数量（`status === 'pending'` 的条目数）。
- 数量为 0 时不渲染。
- 计数来源：`useAppStore((s) => s.getAiInstructionEntries(aiInstructionFileKey(activeFile.worktreeId, activeFile.relativePath)))`
  —— 注意这是 selector 调用，会每次渲染新建数组；用 `useAppStateValue` 或
  `useAppStore` + 浅比较（仓库里 `NotesSendMenu` 用 `useAppStateValue` 的模式）避免无谓重渲染。
- 点击 → `AiInstructionSendMenu`（`scope="batch"`）。
- 按钮样式沿用现有 "AI notes" 那个圆角胶囊 + 计数徽标的写法（`triggerClassName` 同一套 class）。

批量默认只带**待派发**的条目；菜单里再加一个子项「同时包含已派发的 (M)」，勾上后把 `status === 'dispatched'`
的条目也带上。

- [ ] **Step 5: 派发后写记录**

`AiInstructionSendMenu` 的 `onDelivered` 回调里：

- 调 `markAiInstructionsDispatched(owner, entries.map(...), { currentInstructions })`，每条带上 `filePath`、
  `lineNumber`、`body: instruction`、`selectedText: contextExcerpt`、`dispatchedPaneKey`（来自 `onPromptDelivered`
  传回的上下文）。
- `currentInstructions` 传**该文件当前全部指令**（不只是这次发出的那几条），这样才能顺带做孤儿清理
  （设计稿 §4.4）。调用方（行号槽弹层与头部批量按钮）都持有该文件的完整指令清单。
- `owner` 从 `useAiInstructionComments(worktreeId, noteSource)` 拿；拿不到就不写记录（并 `console.error` 一行）。

- [ ] **Step 6: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/editor/ai-instructions/ai-instruction-send-menu.tsx src/renderer/src/components/editor/EditorPanelHeader.tsx src/renderer/src/components/editor/review-note-delivery/ReviewNotesSendMenuContent.tsx src/renderer/src/components/editor/MonacoEditor.tsx
git commit -m "feat(ai-instruction): send instructions to an agent"
```

---

### Task 11: 完成判定接线

**Files:**

- Create: `src/renderer/src/components/editor/ai-instructions/use-ai-instruction-completion.ts`
- Modify: `src/renderer/src/components/editor/ai-instructions/use-monaco-ai-instructions.ts`

**Interfaces:**

- Consumes: `useAiInstructionComments`（Task 6）、`markAiInstructionsCompleted`（Task 7）、
  `agentStatusByPaneKey`（既有 store 字段）、`AgentStatusEntry`（既有）
- Produces:

  ```ts
  export function useAiInstructionCompletion(params: {
    worktreeId: string | undefined
    noteSource: WorkspaceResource
    relativePath: string
    enabled: boolean
  }): void
  ```

- [ ] **Step 1: 写测试**

完成判定本身是**接线**（依赖 store 与 Monaco 联动），按 AGENTS.md 不给它写测试。但判定规则是纯逻辑，
必须抽成一个可测的纯函数，放进 `ai-instruction-status.ts`：

```ts
export function isAiInstructionCompletedByStatus(args: {
  sentAt: number | undefined
  completedAt: number | undefined
  status: { state: string; updatedAt: number } | undefined
}): boolean
```

判定规则：`completedAt` 已有 → `false`（已完成过）；没有 `sentAt` → `false`；没有 `status` → `false`；
`status.state !== 'done'` → `false`；`status.updatedAt < sentAt` → `false`；否则 `true`。

在 `ai-instruction-status.test.ts` 里补三个用例（并入 Task 5 的测试文件）：

```ts
it('completes only on a done status that arrived after the dispatch', () => {
  expect(
    isAiInstructionCompletedByStatus({
      sentAt: 100,
      completedAt: undefined,
      status: { state: 'done', updatedAt: 150 }
    })
  ).toBe(true)
})

it('does not complete on a done status from before the dispatch', () => {
  expect(
    isAiInstructionCompletedByStatus({
      sentAt: 100,
      completedAt: undefined,
      status: { state: 'done', updatedAt: 50 }
    })
  ).toBe(false)
})

it('does not complete while the agent is waiting', () => {
  expect(
    isAiInstructionCompletedByStatus({
      sentAt: 100,
      completedAt: undefined,
      status: { state: 'waiting', updatedAt: 150 }
    })
  ).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions/ai-instruction-status.test.ts --maxWorkers=2`
Expected: FAIL —— `isAiInstructionCompletedByStatus` 未导出。

- [ ] **Step 3: 实现纯函数与 hook**

在 `ai-instruction-status.ts` 里实现 `isAiInstructionCompletedByStatus`（规则见 Step 1）。

新建 `use-ai-instruction-completion.ts`：

- 用 `useAiInstructionComments(worktreeId, noteSource)` 拿该文件的 AI 记录。
- 用 `useAppStore((s) => s.agentStatusByPaneKey)` 拿状态表。
- 一个 effect：找出所有「有 `sentAt`、无 `completedAt`、有 `dispatchedPaneKey`」的记录，对每条调
  `isAiInstructionCompletedByStatus`；命中就调 `markAiInstructionsCompleted(owner, [record.id])`。
- `owner` 从 `useAiInstructionComments` 拿；拿不到就跳过。

在 `use-monaco-ai-instructions.ts` 里调用这个 hook。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions --maxWorkers=2`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `pnpm tc:web`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/editor/ai-instructions/use-ai-instruction-completion.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-status.ts src/renderer/src/components/editor/ai-instructions/ai-instruction-status.test.ts src/renderer/src/components/editor/ai-instructions/use-monaco-ai-instructions.ts
git commit -m "feat(ai-instruction): complete an instruction when its agent finishes"
```

---

### Task 12: 收尾

**Files:**

- Modify: 视需要调整 `src/renderer/src/assets/main.css`（i18n key 由脚本生成后可能需要调整 import 顺序）

**Interfaces:**

- Consumes: 全部前置任务
- Produces: 可发布的实现

- [ ] **Step 1: 生成 i18n key**

Run: `node config/scripts/localization/source-extraction/localize-renderer-strings.mjs`
Expected: 脚本改写新增的 `t(...)` 调用为 `auto.<path>.<hash>` 形式，并更新 locale 目录。

- [ ] **Step 2: 全量跑本功能的测试**

Run: `pnpm test src/renderer/src/components/editor/ai-instructions --maxWorkers=2`
Expected: PASS。

Run: `pnpm test src/shared/ai-instruction-prompt.test.ts src/shared/diff-comment-schema.test.ts --maxWorkers=2`
Expected: PASS。

- [ ] **Step 3: 全量类型检查**

Run: `pnpm tc`
Expected: 无错误。

- [ ] **Step 4: 手工验证**

Run: `pnpm dev`
在打开的文件里写 `// @ai 加一个空数组守卫`，确认：

1. 行号槽出现待派发图标；
2. 点图标弹出菜单，能选智能体；
3. 指令发出后图标变成已派发；
4. 智能体报完成后图标变成已完成；
5. 头部出现「AI 指令 (1)」按钮。

（`pnpm dev` 是 agent 启动的应用，按 AGENTS.md 必须带 `ORCA_BACKGROUND_LAUNCH=1`。）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(ai-instruction): refresh localization keys"
```

- [ ] **Step 6: 推送前闸门**

Run: `pnpm check:changed`
Expected: 通过。不得 `--no-verify`。

## 附：与设计稿的一处偏差

**Task 6 把过滤点收敛到 3 个访问器**（`useDiffCommentView`、`useOwnedDiffComments`、`getDiffComments`），
而不是设计稿 §4.5 列的 4 个渲染点逐一加过滤。效果等价且改动面更小；
`use-visible-worktree-diff-comments.ts` 仍会显式再过滤一次，因为它还管 markdown 笔记的可见性。

其余部分与设计稿一致，包括：

- 文件落位（`src/shared/ai-instruction-types.ts`、`src/shared/ai-instruction-prompt.ts` 在 shared；
  `ai-instruction-marker.ts`、`ai-instruction-scan.ts`、`ai-instruction-context.ts`、
  `ai-instruction-status.ts` 在渲染进程的 `components/editor/ai-instructions/`）。
- 设计稿 §4.4 的孤儿清理落在 `markAiInstructionsDispatched` 的 `options.currentInstructions` 上：
  派发写入顺带剔除同文件里正文已不在当前指令清单中的旧记录，与设计稿「下一次针对该文件的派发写入时剔除」一致。
