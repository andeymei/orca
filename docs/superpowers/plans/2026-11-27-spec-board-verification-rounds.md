# 看板的验证轮次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让看板上一个只有 Superpowers 侧的工作项，在验证通过后离开「校验」栏，进入一个说得清的「已验证」终点，并说得出它被验证过几轮。

**Architecture:** 验证 agent 把每一轮验证写进**计划文件末尾**的「## 验证记录」一节（一行一轮，结论只认 `通过` / `未通过`，**不许写复选框**）。插件只读、只发起，从不改任何文件。本地项目由 `local-scan.ts` 自己读计划文件解析；远程项目由刷新 agent ssh 过去数，写进快照的 `superpowers.verification`，再由 `board-schema.ts` 校验后合并。阶段机多一档 `verified`：清单全勾且最近一轮通过 → `verified`，否则维持 `validate`。

**Tech Stack:** Orca plugin API 1（`orca`、`orca/worker`、`orca/testing`），TypeScript 无构建步骤加载，Orca 的插件测试运行器（`orca plugin test`）。

**Spec:** `docs/superpowers/specs/2026-11-27-spec-board-verification-rounds-design.md`

## Global Constraints

- 插件目录：`resources/plugins/launch/stablyai.spec-board/`。**插件自己不改任何文件**——写记录的是验证 agent，插件只读、只发起（正本：`docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md:30-35`）。
- **记录行的格式是死的**：`- <YYYY-MM-DD> · 通过/未通过 · <跑了什么>`。三个字段用 `·`（U+00B7 前后各一个半角空格）分隔；结论只认 `通过` 和 `未通过` 两个整词；日期必须是真实的 `YYYY-MM-DD`。别的写法一律**不算一轮**（宁可少算，不要数错）。
- 记录只在 `## 验证记录` 这一节里；这一节**不能有复选框**（`- [x]`）——`countCheckboxes` 不分节，一行复选框会把 47/47 变成 48/49，阶段机直接歪掉。
- **刷新提示词有 4096 字符硬上限**（`agent.launch` 拒绝更长的提示词）。超限时**远程刷新根本起不来**，本地扫描那条路不报错——失败方式极其隐蔽。**加进刷新提示词的那条规则**正文必须 ≤ 40 字符，且**必须用真实路径量一遍**：`refresh-prompt.test.ts` 里的短示例路径过了不代表真实路径过得了。（验证动作自己的提示词没有这个约束，它只有一行，量一下就知道。）
- 插件在 `resources/` 下，**不在任何 tsconfig 工程里**（`pnpm tc` 不检查它），但**在根 oxlint 配置的作用域内**。插件内自检：
  - 类型：`node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit`
  - 测试：`node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`（基线 **423/423 通过，35 个测试文件，约 1.5 秒**）
  - 静态检查：`node out/cli/index.js plugin check resources/plugins/launch/stablyai.spec-board`
  - lint：`pnpm exec oxlint resources/plugins/launch/stablyai.spec-board/src`
- **用 `node out/cli/index.js`，不要用 `orca`**：PATH 上的 `orca` 是已打包 app 里的 CLI，它连不上正在运行的 app，会退 3 并报 single-instance。
- **直接在 `main` 上改，不开分支、不开工作树。** 提交前 `pnpm check:changed` 必须过。
- **用 `git commit -- <paths>` 提交，绝不用裸 `git commit`。** 同一个 checkout 里还有别的会话，裸 `git commit` 会把整个索引提交出去，不只是 `git add` 名单里的那些。
- **不加新的缺口**（`gaps.ts` 的 `GapCode` 一个字不动）：验证没通过这件事由 warning 徽标说出来就够，不必再占一条缺口。
- **`board-merge.ts` 不改**：合并是 `agent ?? local` 整块取用（`board-merge.ts:195-198`），新事实挂在 `SuperpowersFacts` 上就跟着整块走了，两条路都不需要额外的合并逻辑。
- UI 文案是中文，标识符、文件名、提交主题是英文。
- 插件内容变了**必须**重算 `resources/plugins/launch/bundled-plugins.json` 里 `stablyai.spec-board` 的 `contentHash`，否则打包校验失败。

## Review Focus

规格暗示、但没有哪条任务的测试正面覆盖的输入与失效模式。每条都由点名的那条任务的测试钉住。

1. **一行 `- 2026-11-27 · 未通过 · …` 绝不能被数成「通过」。** 「未通过」这个串里含着「通过」——先判通过就会把每一次失败都算成成功，卡片从此谎报「已验证」。**先判 `未通过`，再判 `通过`**。（Task 1）
2. **验证 agent 顺手在「## 验证记录」一节里写了 `- [x] 验证通过`。** 一行复选框会被 `countCheckboxes` 算成计划进度，47/47 变成 48/49，阶段机歪掉。解析器必须**只认「·」分隔的行**，复选框行不算一轮；而提示词必须**明文禁止**写复选框——只靠解析器兜不住，计数已经被污染了。（Task 1、Task 6）
3. **刷新提示词超过 4096 字符。** 宿主回 `Too big: expected string to have <=4096 characters`，**远程刷新根本起不来**，而本地扫描那条路一声不吭。规则正文必须 ≤ 40 字符，且用**真实临时路径**（不是测试里的短示例路径）量一遍整条提示词。（Task 5）
4. **最后一轮没过，但前面有一轮过了。** 「最近一轮通过了吗」取的是**文件里最后一条算一轮的行**，不是「最后一次通过」。卡片说「已验证」而最近一次验证其实没过，那是撒谎——必须退回「校验」栏并戴 warning 徽标。（Task 2、Task 9）
5. **agent 写了记录，但格式解析器不认**（缺 `·` 分隔符、结论是「基本通过」、日期写成 `2026/11/27`）。**没有证据就不显示「已验证」**：这一行不算一轮，卡片留在「校验」栏。（Task 1）

---

### Task 1: 验证记录的解析器

**Files:**

- Create: `resources/plugins/launch/stablyai.spec-board/src/verification-records.ts`
- Create: `resources/plugins/launch/stablyai.spec-board/src/verification-records.test.ts`
- Create: `resources/plugins/launch/stablyai.spec-board/src/markdown-fences.ts`

**Interfaces:**

- Produces:

  ```ts
  // model.ts
  export type VerificationFacts = {
    /** 记录里一共有几轮。 */
    rounds: number
    /** 其中通过的几轮。 */
    passed: number
    /** 最近一轮通过了吗；没有记录时为 null。 */
    lastPassed: boolean | null
  }

  // verification-records.ts
  export function parseVerificationRecords(markdown: string): VerificationFacts | null

  // markdown-fences.ts
  export function linesOutsideFences(markdown: string): string[]
  ```

- [ ] **Step 1: 写失败的测试**

`src/verification-records.test.ts`：

````ts
// 计划文件末尾的「验证记录」一节：验证 agent 自己写的每一轮。解析器只认格式，不判断对错。
import { assert, test } from 'orca/testing'
import { parseVerificationRecords } from './verification-records'

test('一节里的一行是一轮', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '', '- 2026-11-27 · 通过 · pnpm tc · 421 tests'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('未通过不是通过', () => {
  // 「未通过」里含着「通过」：先找「通过」的解析器会把每一次失败都数成成功。
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-27 · 未通过 · worker-refresh-project.test.ts flaky'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 0, lastPassed: false })
})

test('最近一轮决定这一份工作算不算验证过', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-26 · 通过 · pnpm tc', '- 2026-11-27 · 未通过 · pnpm lint'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 2, passed: 1, lastPassed: false })
})

test('不认识的结论词不算一轮', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-27 · 基本通过 · pnpm tc'].join('\n')
  )
  assert.equal(facts, null)
})

test('日期不对不算一轮', () => {
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026/11/27 · 通过 · pnpm tc',
      '- 2026-13-01 · 通过 · pnpm tc',
      '- 2026-02-30 · 通过 · pnpm tc'
    ].join('\n')
  )
  assert.equal(facts, null)
})

test('没有这一节就没有记录', () => {
  assert.equal(parseVerificationRecords('# 计划\n\n- [x] 一步\n'), null)
})

test('标题之前的内容不算', () => {
  const facts = parseVerificationRecords(
    ['- 2026-11-27 · 通过 · pnpm tc', '', '## 验证记录', '- 2026-11-28 · 通过 · pnpm tc'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('代码块里的行不算', () => {
  // 一份展示记录格式的计划文件会把自己的例子放进代码块；例子不是事实。
  const facts = parseVerificationRecords(
    ['## 验证记录', '', '```md', '- 2026-11-27 · 通过 · pnpm tc', '```'].join('\n')
  )
  assert.equal(facts, null)
})

test('下一个同级或更高级的标题结束这一节', () => {
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026-11-27 · 通过 · pnpm tc',
      '## 别的节',
      '- 2026-11-28 · 通过 · pnpm tc'
    ].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('更高级的标题（一个井号）也结束这一节', () => {
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026-11-27 · 通过 · pnpm tc',
      '# 标题',
      '- 2026-11-28 · 通过 · pnpm tc'
    ].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('更浅的标题（三个井号）不结束这一节', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '### 小节', '- 2026-11-27 · 通过 · pnpm tc'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('复选框不是一轮', () => {
  // 一行复选框会被 countCheckboxes 算成计划进度；它不是一轮验证。
  const facts = parseVerificationRecords(
    ['## 验证记录', '- [x] 验证通过', '- [ ] 还没验证'].join('\n')
  )
  assert.equal(facts, null)
})

test('跑了什么里面也可以有分隔符', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-27 · 通过 · pnpm tc · 421 tests'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})
````

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— `verification-records` 模块找不到。

- [ ] **Step 3: 实现 `markdown-fences.ts`**

`src/markdown-fences.ts`：

```ts
// 一份 markdown 里不在代码块里的那些行。
//
// 一份展示自己语法的文件会把例子放进代码块，而例子不是事实：一份展示了验证记录长什么样的
// 计划文件，不能把那个例子数成一轮。

/** 文件里不在任何代码块里的那些行。 */
export function linesOutsideFences(markdown: string): string[]
```

围栏的判定**照抄 `src/markdown-tasks.ts:9-10` 的两个常量和 `:18-31` 的围栏处理**：行首三个
以上的反引号或波浪号开一个围栏，同一字符、长度不短于开头那个的收尾行关掉它；**围栏行本身
不返回**（开围栏那一行和关围栏那一行都不在结果里）。

- [ ] **Step 4: 实现 `verification-records.ts`**

`src/verification-records.ts` 的常量（其余按下面的规则实现）：

```ts
import { linesOutsideFences } from './markdown-fences'
import type { VerificationFacts } from './model'

/** 记录所在的那一节的标题。 */
const SECTION_HEADING = /^##[ \t]+验证记录[ \t]*$/

/** 一级或二级的标题：这一节到下一个这样的标题为止。 */
const SECTION_END = /^#{1,2}[ \t]+/

/** 记录行开头的那个项目符号。 */
const BULLET = /^[-*][ \t]+/

/** 记录三个字段之间的分隔符。 */
const SEPARATOR = ' · '

/** 两个结论词。 */
const PASSED = '通过'
const FAILED = '未通过'

/** 记录里日期的样子。 */
const DATE = /^\d{4}-\d{2}-\d{2}$/
```

导出：

```ts
export function parseVerificationRecords(markdown: string): VerificationFacts | null
```

规则（顺序就是实现顺序）：

1. 逐行扫 `linesOutsideFences(markdown)` 的结果——代码块里的行已经不在里面了。
2. 还没进这一节时，遇见 `SECTION_HEADING` 就进这一节；**已经在这一节里**时，遇见
   `SECTION_END` 就出这一节，那一行本身不算记录。
3. 在这一节里的一行：先去掉行首的 `BULLET`，剩下的用 `SEPARATOR` 切开。少于三段 → 不是
   一轮。第一段去空白后必须是**真实的** `YYYY-MM-DD`（月份 1–12，日子不超过那个月的天数）
   → 否则不是一轮。第三段往后用 `SEPARATOR` 拼回去（「跑了什么」里也可以有分隔符），去
   空白后不能是空的 → 否则不是一轮。
4. 第二段去空白后**先比 `FAILED`，再比 `PASSED`**：「未通过」这个串里含着「通过」，先找
   「通过」的解析器会把每一次失败都数成成功。两个结论词都是**整词**比对，所以「基本通过」
   不是「通过」，两个都不匹配 → 这一行不是一轮。
5. 一轮都没有 → 返回 `null`（空的一节不是记录；没有记录就没有「已验证」）。有记录时返回
   `{ rounds, passed, lastPassed }`，其中 `lastPassed` 取**最后一条算一轮的行**的结论。

- [ ] **Step 5: 在 `model.ts` 里加上 `VerificationFacts`**

`src/model.ts`，紧接在 `SuperpowersFacts` 之后：

```ts
/** 计划文件里的验证记录：验证 agent 自己写下的每一轮。 */
export type VerificationFacts = {
  /** 记录里一共有几轮。 */
  rounds: number
  /** 其中通过的几轮。 */
  passed: number
  /** 最近一轮通过了吗；没有记录时为 null。 */
  lastPassed: boolean | null
}
```

- [ ] **Step 6: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 423 + 13 = 436 个测试全过。

- [ ] **Step 7: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src/verification-records.ts \
        resources/plugins/launch/stablyai.spec-board/src/verification-records.test.ts \
        resources/plugins/launch/stablyai.spec-board/src/markdown-fences.ts \
        resources/plugins/launch/stablyai.spec-board/src/model.ts
git commit -- resources/plugins/launch/stablyai.spec-board/src/verification-records.ts \
        resources/plugins/launch/stablyai.spec-board/src/verification-records.test.ts \
        resources/plugins/launch/stablyai.spec-board/src/markdown-fences.ts \
        resources/plugins/launch/stablyai.spec-board/src/model.ts \
  -m "feat(spec-board): the verification records of a plan are read, not guessed"
```

---

### Task 2: 「已验证」这一档阶段

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/model.ts`（`UnifiedStage` 加 `'verified'`；`SuperpowersFacts` 加 `verification`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/stage.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/stage.test.ts`
- Modify（`verification` 变成必填字段，每个构造 `SuperpowersFacts` 的地方都要补 `verification: null`）:
  - `resources/plugins/launch/stablyai.spec-board/src/local-scan.ts`
  - `resources/plugins/launch/stablyai.spec-board/src/gaps.test.ts`
  - `resources/plugins/launch/stablyai.spec-board/src/actions.test.ts`
  - `resources/plugins/launch/stablyai.spec-board/src/item-sources.test.ts`
  - `resources/plugins/launch/stablyai.spec-board/src/board-merge.test.ts`
  - `resources/plugins/launch/stablyai.spec-board/src/worker-open-source.test.ts`
  - `resources/plugins/launch/stablyai.spec-board/src/panel-fixture.ts`

**Interfaces:**

- Consumes: Task 1 的 `VerificationFacts`。
- Produces:

  ```ts
  // model.ts
  export type UnifiedStage =
    | 'proposal'
    | 'design'
    | 'plan'
    | 'implement'
    | 'validate'
    | 'verified'
    | 'archive'

  export type SuperpowersFacts = {
    designSpec: string | null
    plan: string | null
    stage: 'designed' | 'planned' | 'executing' | 'done'
    planDone: number
    planInProgress: number
    planTotal: number
    /** 计划文件里的验证记录；没有记录时是 null。 */
    verification: VerificationFacts | null
  }
  ```

- [ ] **Step 1: 写失败的测试**

`src/stage.test.ts`，把 `superpowers()` 工厂的默认值加上 `verification: null`，再追加：

```ts
test('清单全勾且最近一轮通过，就是「已验证」', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 2,
        planDone: 2,
        verification: { rounds: 2, passed: 1, lastPassed: true }
      })
    }),
    'verified'
  )
})

test('最近一轮没过，就还留在「校验」', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 2,
        planDone: 2,
        verification: { rounds: 2, passed: 1, lastPassed: false }
      })
    }),
    'validate'
  )
})

test('没有记录就还是「校验」', () => {
  // 旧行为不变：没有证据就没有「已验证」。
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({ plan: 'p.md', planTotal: 2, planDone: 2 })
    }),
    'validate'
  )
})

test('验证过了又加了新任务，就退回「实现」', () => {
  // 阶段机先看清单：清单没勾完就不是验证过。
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 3,
        planDone: 2,
        verification: { rounds: 1, passed: 1, lastPassed: true }
      })
    }),
    'implement'
  )
})

test('只有 OpenSpec 一侧的工作项永远不会「已验证」', () => {
  // 记录写在计划文件里；没有计划就没有地方写，也就没有证据。
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksTotal: 4, tasksDone: 4 }),
      superpowers: null
    }),
    'validate'
  )
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— `deriveStage` 返回的是 `'validate'`，不是 `'verified'`。

- [ ] **Step 3: 改 `model.ts`**

`src/model.ts:5`：

```ts
export type UnifiedStage =
  | 'proposal'
  | 'design'
  | 'plan'
  | 'implement'
  | 'validate'
  | 'verified'
  | 'archive'
```

`SuperpowersFacts`（`src/model.ts:31-39`）加最后一项：

```ts
export type SuperpowersFacts = {
  designSpec: string | null
  plan: string | null
  stage: 'designed' | 'planned' | 'executing' | 'done'
  planDone: number
  planInProgress: number
  planTotal: number
  /** 计划文件里的验证记录；没有记录时是 null。 */
  verification: VerificationFacts | null
}
```

- [ ] **Step 4: 改 `stage.ts`**

`src/stage.ts:44-46`，把「全勾 → validate」这一条改成：

```ts
if (informative.length > 0 && informative.every((pair) => pair.done === pair.total)) {
  // 清单全勾完了。这件工作算不算验证过，是另一条事实：最近一轮必须过——
  // 卡片说「已验证」而最近一次验证其实没过，那是撒谎。
  return facts.superpowers?.verification?.lastPassed === true ? 'verified' : 'validate'
}
```

- [ ] **Step 5: 补齐所有构造 `SuperpowersFacts` 的地方**

`verification` 是必填字段，所以每一个字面量都要补上 `verification: null`：

- `src/local-scan.ts:64-87` 的 `superpowersFacts()` —— 加上 `verification: null`（Task 3 会把它换成真的值）。
- `src/gaps.test.ts` 的 `superpowers()` 工厂默认值。
- `src/actions.test.ts` 的 `item` 字面量。
- `src/item-sources.test.ts` 的四处字面量（`:106`、`:123`、`:161`、`:176` 附近）。
- `src/board-merge.test.ts` 的两处字面量（`:188`、`:223` 附近）。
- `src/worker-open-source.test.ts` 的一处字面量（`:417` 附近）。
- `src/panel-fixture.ts` 的 `add-z` 工作项（`:108-125`）。

- [ ] **Step 6: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 436 + 5 = 441 个测试全过。

- [ ] **Step 7: 类型检查**

Run: `node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit`
Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): a ticked checklist whose last round passed is the verified stage"
```

---

### Task 3: 本地扫描读计划文件里的记录

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/local-scan-artifacts.ts`（导出 `readFileText`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/local-scan.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/local-scan.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `parseVerificationRecords(markdown: string): VerificationFacts | null`；Task 2 的 `SuperpowersFacts.verification`。
- Produces:

  ```ts
  // local-scan-artifacts.ts
  export async function readFileText(
    root: string,
    relative: string,
    warnings: string[]
  ): Promise<string | null>
  ```

- [ ] **Step 1: 写失败的测试**

`src/local-scan.test.ts` 追加：

```ts
test('计划文件里的验证记录被读成事实', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-verify-'))
  roots.push(root)
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true })
  await writeFile(
    join(root, 'docs/superpowers/plans/2026-11-20-add-x.md'),
    [
      '- [x] a',
      '- [x] b',
      '',
      '## 验证记录',
      '',
      '- 2026-11-26 · 通过 · pnpm tc',
      '- 2026-11-27 · 未通过 · pnpm lint'
    ].join('\n')
  )
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  const item = result.items[0]!
  assert.deepEqual(item.superpowers?.verification, { rounds: 2, passed: 1, lastPassed: false })
  // 复选框照旧是进度：记录那一节里没有复选框。
  assert.equal(item.superpowers?.planTotal, 2)
  assert.equal(item.superpowers?.planDone, 2)
})

test('没有记录的计划文件没有这项事实', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-noverify-'))
  roots.push(root)
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true })
  await writeFile(join(root, 'docs/superpowers/plans/2026-11-20-add-x.md'), '- [x] a\n- [x] b\n')
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.items[0]!.superpowers?.verification, null)
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— `verification` 是 `null`，而测试要的是两轮记录。

- [ ] **Step 3: 导出 `readFileText`**

`src/local-scan-artifacts.ts:117-121`，把 `async function readFileText` 改成 `export async function readFileText`，其余不动。

- [ ] **Step 4: 让 `local-scan.ts` 读计划文件的正文**

`src/local-scan.ts` 的 import 改成：

```ts
import {
  messageOf,
  NO_CHECKBOXES,
  readFileText,
  rootProblem,
  scanOpenspec,
  scanSuperpowers,
  type ArtifactOnDisk,
  type ChangeOnDisk
} from './local-scan-artifacts'
import { countCheckboxes, type CheckboxCount } from './markdown-tasks'
import { parseVerificationRecords } from './verification-records'
```

`src/local-scan.ts:202-224` 的 `buildItem`：

```ts
const plan = superpowers?.plan ?? null
// 计划文件读一次：它的复选框是进度，它的「## 验证记录」一节是验证历史，两样都出自同一份正文。
const planText = plan === null ? null : await readFileText(root, plan.path, warnings)
const planTasks = planText === null ? NO_CHECKBOXES : countCheckboxes(planText)
const verification = planText === null ? null : parseVerificationRecords(planText)
return {
  id: `${projectId}#${topic}`,
  projectId,
  title: change?.changeId ?? topic,
  topic,
  openspec: change === null ? null : openspecFacts(change),
  superpowers:
    superpowers === null
      ? null
      : superpowersFacts(superpowers.spec, superpowers.plan, planTasks, verification)
}
```

`src/local-scan.ts:64-87` 的 `superpowersFacts` 多一个参数并把它放进事实里：

```ts
function superpowersFacts(
  designSpec: ArtifactOnDisk | null,
  plan: ArtifactOnDisk | null,
  planTasks: CheckboxCount,
  verification: VerificationFacts | null
): SuperpowersFacts {
  ...
  return {
    designSpec: designSpec?.path ?? null,
    plan: plan?.path ?? null,
    stage,
    planDone: done,
    planInProgress: inProgress,
    planTotal: total,
    verification
  }
}
```

（`VerificationFacts` 从 `./model` 一起 import。）

- [ ] **Step 5: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 441 + 2 = 443 个测试全过。

- [ ] **Step 6: 类型检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): a local project reads the verification records of its plan"
```

---

### Task 4: 快照带着验证事实走

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/board-schema.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/snapshot-format.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/board-schema.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `VerificationFacts`。
- Produces: 快照里 `items[].superpowers.verification` 这个字段，形状是
  `{ rounds: number; passed: number; lastPassed: boolean | null }`，缺省或 `null` 都算「没有记录」。

- [ ] **Step 1: 写失败的测试**

`src/board-schema.test.ts` 追加（顶部先加一个 helper，再加四条测试）：

```ts
/** 一份 Superpowers 事实，带不带验证记录由参数说了算。 */
function superpowersFacts(verification?: VerificationFacts) {
  return {
    designSpec: null,
    plan: 'docs/superpowers/plans/2026-11-25-add-x.md',
    stage: 'executing',
    planDone: 1,
    planInProgress: 0,
    planTotal: 3,
    ...(verification === undefined ? {} : { verification })
  }
}

test('接受带验证记录的快照，并读出它的数', () => {
  const item = {
    ...valid.items[0],
    superpowers: superpowersFacts({ rounds: 2, passed: 1, lastPassed: true })
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.deepEqual(result.value.items[0]!.superpowers?.verification, {
    rounds: 2,
    passed: 1,
    lastPassed: true
  })
})

test('没有这个字段的旧快照照旧被接受', () => {
  const item = { ...valid.items[0], superpowers: superpowersFacts() }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  // 旧快照没有这一项：它没有记录，不是坏掉。
  assert.equal(result.value.items[0]!.superpowers?.verification, null)
})

test('拒绝通过数大于轮数的记录', () => {
  const item = {
    ...valid.items[0],
    superpowers: superpowersFacts({ rounds: 1, passed: 2, lastPassed: true })
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  if (result.ok) {
    return
  }
  assert.match(result.error, /\.verification\.passed:/)
})

test('没有轮次的记录也是合法的', () => {
  // agent 也许会写一个空记录：它不是「通过」，也不是坏快照。
  const item = {
    ...valid.items[0],
    superpowers: superpowersFacts({ rounds: 0, passed: 0, lastPassed: null })
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, true)
})
```

import 加上 `VerificationFacts`：

```ts
import type { VerificationFacts } from './model'
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— 校验器不认 `verification`，通过数大于轮数也没人拦。

- [ ] **Step 3: 改 `board-schema.ts`**

`src/board-schema.ts` 加两个 helper（放在 `readCount` 之后）：

```ts
/** 一个允许 null 的布尔值：那里 null 是一个值，不是不存在。 */
function readNullableBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) {
    return null
  }
  return readBoolean(value, field)
}
```

以及读验证记录的那个：

```ts
/** 快照里的验证记录：几轮、几轮通过、最近一轮过没过。 */
function readVerificationFacts(value: unknown, field: string): VerificationFacts {
  const source = readObject(value, field)
  const rounds = readCount(source['rounds'], `${field}.rounds`)
  const passed = readCount(source['passed'], `${field}.passed`)
  const lastPassed = readNullableBoolean(source['lastPassed'], `${field}.lastPassed`)
  if (passed > rounds) {
    fail(`${field}.passed`, `期望不大于 rounds（当前 ${rounds}）`)
  }
  return { rounds, passed, lastPassed }
}
```

`src/board-schema.ts:189-207` 的 `readSuperpowersFacts` 读它并放进结果：

```ts
  const verification = readNullable(
    source['verification'],
    `${field}.verification`,
    readVerificationFacts
  )
  ...
  return { designSpec, plan, stage, planDone, planInProgress, planTotal, verification }
```

（`VerificationFacts` 从 `./model` 一起 import。）

- [ ] **Step 4: 让示例快照带上这个对象**

`src/snapshot-format.ts:43-50`，示例里 `superpowers` 那一块加一行：

```ts
      superpowers: {
        designSpec: 'docs/superpowers/specs/add-x-design.md',
        plan: 'docs/superpowers/plans/add-x.md',
        stage: 'executing',
        planDone: 1,
        planInProgress: 0,
        planTotal: 4,
        verification: { rounds: 2, passed: 1, lastPassed: true }
      }
```

`snapshot-format.test.ts` 会把这个示例整个跑一遍校验器，所以它必须是校验器接受的形状。

- [ ] **Step 5: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 443 + 4 = 447 个测试全过。

- [ ] **Step 6: 类型检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): the snapshot carries the verification records of a work item"
```

---

### Task 5: 刷新提示词里那条数记录的规则

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // refresh-prompt.ts
  export const VERIFICATION_COUNT_RULE: string
  ```

  值恰好是：`「## 验证记录」轮次写进 \`superpowers.verification\``（40 个字符）。

- [ ] **Step 1: 写失败的测试**

`src/refresh-prompt.test.ts` 追加：

```ts
test('告诉 agent 验证记录写进哪里', () => {
  assert.ok(prompt.includes(VERIFICATION_COUNT_RULE))
  assert.ok(projectPrompt.includes(VERIFICATION_COUNT_RULE))
})

test('那条规则短得放得下', () => {
  // 提示词有 4096 字符的硬上限；放不下的规则会让整次刷新起不来。
  assert.ok(VERIFICATION_COUNT_RULE.length <= 40, `${VERIFICATION_COUNT_RULE.length} > 40`)
})

test('真实路径下提示词也放得下', () => {
  // 路径是提示词的一部分，而真实的比例子长：例子放得下，机器上放不下，等于没测。
  const real = buildProjectRefreshPrompt({
    scanListPath:
      '/var/folders/qq/1y2z3x4w5v6t7s8r9q0/T/spec-board-a1b2c3d4/scan-list-ab12cd34ef56ab78.json',
    snapshotPath:
      '/var/folders/qq/1y2z3x4w5v6t7s8r9q0/T/spec-board-a1b2c3d4/project-ab12cd34ef56ab78.json'
  })
  assert.ok(real.length <= PROMPT_MAX_CHARS, `${real.length} > ${PROMPT_MAX_CHARS}`)
})
```

import 改成：

```ts
import {
  buildProjectRefreshPrompt,
  buildRefreshPrompt,
  PROMPT_MAX_CHARS,
  VERIFICATION_COUNT_RULE
} from './refresh-prompt'
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— `VERIFICATION_COUNT_RULE` 不存在。

- [ ] **Step 3: 实现这条规则**

`src/refresh-prompt.ts`，在 `SLUG_RULE`（`src/refresh-prompt.ts:21`）之后加：

```ts
/**
 * 那条告诉 agent 把验证记录写到哪里的规则。
 *
 * 它必须短：提示词有 4096 字符的硬上限，超了整次刷新就起不来——而且失败得很隐蔽，远程刷新
 * 什么都不发生，本地扫描那条路一声不吭。规则是**量**出来的，不是估出来的：测试拿真实路径
 * 量整条提示词。
 */
export const VERIFICATION_COUNT_RULE = '「## 验证记录」轮次写进 `superpowers.verification`'
```

在 `SCAN_RULES`（`src/refresh-prompt.ts:31-55`）里，「变更目录里有 `proposal.md`…」那一段的
**后面**，接一行这条规则（**只接这一行，不另起一段说明文字**——每多一个字符，真实路径下的
提示词就更靠近上限）：

```
变更目录里有 \`proposal.md\`、\`design.md\`、\`tasks.md\` 和 \`specs/<能力>/spec.md\`。\`tasks.md\` 里的复选框就是进度：\`- [ ]\` 未完成，\`- [x]\` 已完成，\`- [-]\` 进行中。代码块里的复选框不算。

${VERIFICATION_COUNT_RULE}
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 447 + 3 = 450 个测试全过。

**如果「真实路径下提示词也放得下」这一条红了**：说明这条规则在这条路径上放不下。**不要把
规则删短到认不出来**，改把规则写进清单文件——`worker.ts` 的 `writeScanList` 写的
`scan-list.json` 已经在 `snapshotFormat` 和 `progress` 旁边，加一个 `verificationRule` 字段
没有长度上限。做法：`refresh-prompt.ts` 里不再带这条规则，`worker.ts` 写清单时多写一个
`verificationRule: VERIFICATION_COUNT_RULE`，然后本步的「告诉 agent 验证记录写进哪里」那条
测试改成断言清单里有这个字段。

- [ ] **Step 5: 类型检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): the refresh asks the agent to count the verification records"
```

---

### Task 6: 验证动作要求 agent 写下这一轮

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/actions.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/actions.test.ts`

**Interfaces:**

- Consumes: 无（这一层不读记录）。
- Produces:

  ```ts
  // action-catalog.ts
  export type SuperpowersSkill = {
    id: string
    label: string
    mutates: boolean
    skill: string
    task: string
    /**
     * 这一步做完之后 agent 要遵守的规则；只有会产生记录的那一步才有。
     * 没有地方写的步骤不给规则。
     */
    recordRule?: string
  }

  export const VERIFICATION_RECORD_RULE: string
  ```

  `VERIFICATION_RECORD_RULE` 的值：

  ```
  验证结束后，在 <plan> 的「## 验证记录」一节末尾追加一行：`- <日期> · 通过/未通过 · <跑了什么>`；没有这一节就新建一节。这一节不要写复选框（`- [x]`），看板把复选框当任务进度数。
  ```

- [ ] **Step 1: 写失败的测试**

`src/actions.test.ts` 追加：

```ts
test('验证这一按钮要求 agent 写下这一轮，并点名计划文件', () => {
  const prompt = promptOf(findAction(actionsForItem(item, true), 'superpowers.verify')!)
  assert.match(prompt, /## 验证记录/)
  assert.match(prompt, /docs\/superpowers\/plans\/x\.md/)
  // 复选框那一句是必需的：agent 写复选框是很自然的事，不说它就会那么写。
  assert.match(prompt, /不要写复选框/)
})

test('没有计划的工作项不要求写记录', () => {
  // 没有地方放记录，要求它写只会让 agent 去找一份不存在的计划。
  const prompt = promptOf(
    findAction(
      actionsForItem({ ...item, superpowers: { ...item.superpowers, plan: null } }, true),
      'superpowers.verify'
    )!
  )
  assert.equal(prompt.includes('## 验证记录'), false)
})

test('调色板里的验证动作不要求写记录', () => {
  // 调色板不知道具体是哪份计划。
  const palette = frameworkActions(false)
  const verify = palette.superpowers.find((action) => action.id === 'superpowers.verify')!
  assert.equal(promptOf(verify).includes('## 验证记录'), false)
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— 验证的提示词里没有「## 验证记录」。

- [ ] **Step 3: 改 `action-catalog.ts`**

`src/action-catalog.ts:114-123` 的 `SuperpowersSkill` 加 `recordRule?: string`，并在
`SUPERPOWERS_SKILLS` 之前加那条规则：

```ts
/**
 * 验证完之后 agent 要写下的那一轮。
 *
 * 记录是 agent 自己写的：插件不改任何文件，所以留下证据的是 agent。规则挂在这一步上，
 * 按钮和规则因此不会各说各话。
 */
export const VERIFICATION_RECORD_RULE =
  '验证结束后，在 <plan> 的「## 验证记录」一节末尾追加一行：`- <日期> · 通过/未通过 · <跑了什么>`；没有这一节就新建一节。这一节不要写复选框（`- [x]`），看板把复选框当任务进度数。'
```

`SUPERPOWERS_SKILLS` 里 `superpowers.verify` 那一行（`src/action-catalog.ts:155-162`）：

```ts
  {
    id: 'superpowers.verify',
    label: '验证',
    mutates: false,
    skill: 'superpowers:verification-before-completion',
    task: '验证本次改动',
    recordRule: VERIFICATION_RECORD_RULE
  }
```

- [ ] **Step 4: 改 `actions.ts`**

`src/actions.ts:33-39` 的 `Subject`：

```ts
type Subject = {
  /** What the work is called: its own topic. */
  topic: string
  /** The design spec the plan is written from. */
  spec: string
  /** The plan that is being executed. */
  plan: string
  /** Whether the work item really has a plan file, and not just the generic label. */
  hasPlan: boolean
}
```

`src/actions.ts:121-128` 的 `superpowersPrompt`：

```ts
/** The prompt one Superpowers skill is dispatched with. */
function superpowersPrompt(skill: SuperpowersSkill, subject: Subject): string {
  const task = skill.task
    .replaceAll('<topic>', subject.topic)
    .replaceAll('<spec>', subject.spec)
    .replaceAll('<plan>', subject.plan)
  // 记录规则点名一个文件，所以只有真有计划时才有它：一条点名通用字样的规则只会让 agent
  // 去找一份不存在的计划。
  const rule =
    skill.recordRule === undefined || !subject.hasPlan
      ? ''
      : ` ${skill.recordRule.replaceAll('<plan>', subject.plan)}`
  return `用 ${skill.skill} ${task}${rule}`
}
```

`src/actions.ts:194-199` 构造 `Subject` 的地方：

```ts
const subject: Subject = {
  topic: safeValue(item.topic, '这个工作项'),
  spec: safePath(item.superpowers.designSpec, '设计 spec'),
  plan: safePath(item.superpowers.plan, '实施计划'),
  hasPlan: item.superpowers.plan !== null
}
```

`src/actions.ts:240-246` 调色板的 `Subject`：

```ts
const subject: Subject = {
  topic: '这个项目要做的改动',
  spec: '设计 spec',
  plan: '实施计划',
  hasPlan: false
}
```

- [ ] **Step 5: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 450 + 3 = 453 个测试全过。

- [ ] **Step 6: 类型检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): the verify action asks the agent to write down the round"
```

---

### Task 7: 「收尾」这个动作

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/framework-map.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/actions.test.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/framework-map.test.ts`

**Interfaces:**

- Consumes: Task 6 之后的 `SUPERPOWERS_SKILLS`。
- Produces: 目录里多一个动作 `superpowers.finish`，标签「收尾」，技能
  `superpowers:finishing-a-development-branch`，`mutates: true`。

- [ ] **Step 1: 写失败的测试**

`src/actions.test.ts` 里已有的清单和表格要改（它们现在列的是五个技能）：

- 「an item offers the commands of its change and the skills of its work」：末尾加 `'superpowers.finish'`。
- 「an item with only Superpowers work offers only the Superpowers skills」：末尾加 `'superpowers.finish'`。
- 「every action carries the label, the framework and the mutates flag of its row」：末尾加 `['superpowers.finish', '收尾', 'superpowers', true]`。
- 「the palette lists every command of both frameworks」：末尾加 `'superpowers.finish'`。
- 「the palette runs the CLI where there is one and leaves the rest to the agent」里的 mutates 表：末尾加 `['superpowers.finish', true]`。
- 「every action id the design lists exists」：这一张是**排好序**的，`'superpowers.finish'` 插在 `'superpowers.execute'` 之后、`'superpowers.plan'` 之前。
- 「an archived change is not offered the archive command」：末尾加 `'superpowers.finish'`。

（除最后一张外，其余清单都按 `SUPERPOWERS_SKILLS` 的次序，所以新动作在末尾。）

`src/framework-map.test.ts`：

- 「the Superpowers steps name the catalog action of the skill they describe」：`['finishing-a-development-branch', null]` 改成 `['finishing-a-development-branch', 'superpowers.finish']`。
- 「every action the map names is an action of the catalog」：`assert.equal(new Set(named).size, 12)` 改成 `13`，注释改成
  `// Thirteen distinct actions: the seven OpenSpec commands of the palette and the six skills.`

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— 清单里没有 `superpowers.finish`。

- [ ] **Step 3: 改 `action-catalog.ts`**

`SUPERPOWERS_SKILLS` 里 `superpowers.verify` 之后加一行：

```ts
  {
    id: 'superpowers.finish',
    label: '收尾',
    mutates: true,
    skill: 'superpowers:finishing-a-development-branch',
    task: '收尾本次改动'
  }
```

- [ ] **Step 4: 改 `framework-map.ts`**

`src/framework-map.ts:195-200` 的 `finishing-a-development-branch` 那一档：

```ts
  {
    skill: 'finishing-a-development-branch',
    role: '收尾：测试全绿后决定怎么合并或清理分支',
    artifact: null,
    gate: null,
    actionId: 'superpowers.finish'
  },
```

- [ ] **Step 5: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS。

- [ ] **Step 6: 类型检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): the finishing skill becomes a button"
```

---

### Task 8: 「已验证」的卡片主按钮是「收尾」，导轨多一栏

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-primary-action.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-primary-action.test.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-board.tsx`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-board.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `'verified'` 阶段；Task 7 的 `superpowers.finish`。
- Produces: `PREFERRED_BY_STAGE.verified = ['superpowers.finish']`；导轨标签「已验证」。

- [ ] **Step 1: 写失败的测试**

`src/panel-primary-action.test.ts` 追加：

```ts
test('已验证的卡片主按钮是收尾', () => {
  const card = item('verified', ['superpowers.verify', 'superpowers.finish'])
  assert.equal(primaryAction(card)?.id, 'superpowers.finish')
  // 再验证一轮仍然可以，所以验证留在「更多」里。
  assert.deepEqual(
    otherActions(card).map((entry) => entry.id),
    ['superpowers.verify']
  )
})
```

`src/panel-board.test.tsx` 追加：

```ts
test('导轨有一栏「已验证」，排在校验和归档之间', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  const rail = view
    .findAll({ type: 'Button' })
    .map((button) => String(button.props.children))
    .filter((text) => /^(提案|设计|计划|实现|校验|已验证|归档) \d+$/.test(text))
  assert.deepEqual(rail, ['提案 0', '设计 0', '计划 0', '实现 3', '校验 1', '已验证 0', '归档 0'])
  await view.unmount()
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— `verified` 没有对应的主按钮，导轨也只有六栏。

- [ ] **Step 3: 改 `panel-primary-action.ts`**

`src/panel-primary-action.ts:25-38` 的 `PREFERRED_BY_STAGE` 加一档：

```ts
  // 校验：做完了，校验它；两边各有一套说法，OpenSpec 的先。
  validate: ['openspec.validate', 'superpowers.verify'],
  // 已验证：验证过了，下一步是收尾；再验证一轮仍然可以，验证因此留在「更多」里。
  verified: ['superpowers.finish'],
```

**`archiveReady()` 不改**：它要求 `item.stage === 'validate'`，所以一张「已验证」的卡片不会
把「归档」顶到主按钮上——「收尾」才是那一栏的下一步，「归档」留在「更多」里。

- [ ] **Step 4: 改 `panel-board.tsx`**

`src/panel-board.tsx:19-27` 的 `STAGES`：

```ts
const STAGES: readonly { id: UnifiedStage; label: string }[] = [
  { id: 'proposal', label: '提案' },
  { id: 'design', label: '设计' },
  { id: 'plan', label: '计划' },
  { id: 'implement', label: '实现' },
  { id: 'validate', label: '校验' },
  { id: 'verified', label: '已验证' },
  { id: 'archive', label: '归档' }
]
```

- [ ] **Step 5: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 453 + 2 = 455 个测试全过。

- [ ] **Step 6: 类型检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): a verified card leads with finishing, and the rail has a column for it"
```

---

### Task 9: 验证徽标

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-card.tsx`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-card.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `SuperpowersFacts.verification`。
- Produces: 卡片上那行徽标多两个可能——`已验证 ×{passed}`（tone `success`）和
  `上次验证未通过`（tone `warning`）。

- [ ] **Step 1: 写失败的测试**

`src/panel-card.test.tsx` 追加（并在文件顶部加一个 helper）：

```ts
/** 一张带验证记录的看板。 */
function withVerification(id: string, verification: VerificationFacts): BoardPayload {
  return {
    ...fixturePayload,
    items: fixturePayload.items.map((item) =>
      item.id === id ? { ...item, superpowers: { ...item.superpowers!, verification } } : item
    )
  }
}

test('最近一轮通过，卡片说它被验证过几轮', async () => {
  const host = mockHost({
    requests: {
      'board.get': () =>
        withVerification('local|/repo#add-z', { rounds: 2, passed: 1, lastPassed: true })
    }
  })
  const view = await mount(panel, { host })
  const badge = view.find({ type: 'Badge', text: '已验证 ×1' })
  assert.ok(badge)
  assert.equal(badge?.props.tone, 'success')
  await view.unmount()
})

test('最近一轮没过，卡片说的是没通过', async () => {
  const host = mockHost({
    requests: {
      'board.get': () =>
        withVerification('local|/repo#add-z', { rounds: 2, passed: 1, lastPassed: false })
    }
  })
  const view = await mount(panel, { host })
  const badge = view.find({ type: 'Badge', text: '上次验证未通过' })
  assert.ok(badge)
  assert.equal(badge?.props.tone, 'warning')
  await view.unmount()
})

test('没有记录就不戴验证徽标', async () => {
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ type: 'Badge', text: '已验证 ×1' }), null)
  assert.equal(view.find({ type: 'Badge', text: '上次验证未通过' }), null)
  await view.unmount()
})
```

import 加上 `VerificationFacts`：

```ts
import type { BoardPayload, VerificationFacts } from './model'
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: FAIL —— 卡片上没有验证徽标。

- [ ] **Step 3: 改 `panel-card.tsx`**

`src/panel-card.tsx` 里加一个 helper（放在 `projectLine` 之后）：

```tsx
/**
 * 验证的徽标：最近一轮过了说它被验证过几轮，最近一轮没过说没通过。
 *
 * 没有记录就没有徽标：没有证据就不说「已验证」。
 */
function verificationBadge(item: WorkItem) {
  const verification = item.superpowers?.verification
  if (verification === null || verification === undefined) {
    return null
  }
  if (verification.lastPassed === true) {
    return <Badge tone="success">{`已验证 ×${verification.passed}`}</Badge>
  }
  if (verification.lastPassed === false) {
    return <Badge tone="warning">上次验证未通过</Badge>
  }
  return null
}
```

`src/panel-card.tsx:153-156` 那一行徽标改成：

```tsx
<Row gap="xs" align="center" wrap>
  <Badge tone="neutral">{projectLine(project, item)}</Badge>
  {withoutCli ? <Badge tone="warning">无 CLI</Badge> : null}
  {verificationBadge(item)}
</Row>
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 455 + 3 = 458 个测试全过。

- [ ] **Step 5: 类型检查、静态检查并提交**

```bash
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
pnpm exec oxlint resources/plugins/launch/stablyai.spec-board/src
git add resources/plugins/launch/stablyai.spec-board/src
git commit -- resources/plugins/launch/stablyai.spec-board/src \
  -m "feat(spec-board): the card says how many rounds were verified"
```

---

### Task 10: 看板设计的正本

**Files:**

- Modify: `docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md`

**Interfaces:**

- Produces: 正本里的阶段表、导轨、动作表、类型块与这次的设计一致。

- [ ] **Step 1: 改类型块**

`docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md:303`：

```ts
type UnifiedStage =
  | 'proposal'
  | 'design'
  | 'plan'
  | 'implement'
  | 'validate'
  | 'verified'
  | 'archive'
```

同一个代码块里的 `SuperpowersFacts`（`:317-324`）加一项：

```ts
export type SuperpowersFacts = {
  designSpec: string | null
  plan: string | null
  stage: 'designed' | 'planned' | 'executing' | 'done'
  planDone: number
  planInProgress: number
  planTotal: number
  verification: { rounds: number; passed: number; lastPassed: boolean | null } | null
}
```

- [ ] **Step 2: 改阶段推导表**

`:370-377` 的那张表，「存在的进度对里，非空的那些全部勾完…」这一行之后插一行：

```
| 同上，且最近一轮验证通过（`verification.lastPassed === true`）                                        | `verified` |
```

并在该表下面补一句：

> 「已验证」这一档只对 Superpowers 侧成立：验证记录写在计划文件里，没有计划就没有记录，也
> 就没有证据。清单没勾完时阶段机先看清单——验证过了又加了新任务，就退回「实现」。

- [ ] **Step 3: 改面板结构那一行**

`:459` 那一行里，「阶段导轨：`提案 → 设计 → 计划 → 实现 → 校验 → 归档`」改成
「`提案 → 设计 → 计划 → 实现 → 校验 → 已验证 → 归档`」；同一行的主按钮那句里，
「校验→`openspec.validate`」后面加「，已验证→`superpowers.finish`」。

- [ ] **Step 4: 改动作表**

`:495-514` 的 Superpowers 动作表加一行，并把「验证」那一行改成：

| 动作       | prompt 要点                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计       | 用 `superpowers:brainstorming` 为 `<topic>` 产出设计 spec（卡片上的名字按事实分：还没有设计 spec 时是"写设计"，已经有了是"重新设计"）                                         |
| 写实施计划 | 用 `superpowers:writing-plans` 基于 `<spec>` 写计划                                                                                                                           |
| 执行计划   | 用 `superpowers:executing-plans` 执行 `<plan>`                                                                                                                                |
| 代码评审   | 用 `superpowers:requesting-code-review` 审本次改动                                                                                                                            |
| 验证       | 用 `superpowers:verification-before-completion` 验证；**有计划时**追加：在 `<plan>` 的「## 验证记录」一节末尾追加一行 `- <日期> · 通过/未通过 · <跑了什么>`，**不要写复选框** |
| 收尾       | 用 `superpowers:finishing-a-development-branch` 收尾本次改动                                                                                                                  |

- [ ] **Step 5: 在非目标里补一句**

`:30-35` 的「插件自己不改任何文件」那一条末尾补一句：

> 验证记录由**验证 agent** 写（写在计划文件末尾的「## 验证记录」一节），插件只读它、只发起
> 它要发起的动作。插件不替 agent 判断一次验证算不算通过。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md
git commit -- docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md \
  -m "docs(spec-board): the board design knows about the verification rounds"
```

---

### Task 11: 打包、装上、真机看一眼

**Files:**

- Modify: `resources/plugins/launch/bundled-plugins.json`（`stablyai.spec-board` 的 `contentHash`）

**Interfaces:**

- Consumes: 前十个任务的全部改动。
- Produces: `/Applications/Orca.app` 里带着这次的插件。

- [ ] **Step 1: 跑一遍完整的门禁**

```bash
node out/cli/index.js plugin test resources/plugins/launch/stablyai.spec-board
node out/cli/index.js plugin check resources/plugins/launch/stablyai.spec-board
node_modules/.bin/tsc -p resources/plugins/launch/stablyai.spec-board --noEmit
pnpm exec oxlint resources/plugins/launch/stablyai.spec-board/src
pnpm check:changed
```

Expected: 全部通过（插件测试 458/458）。

- [ ] **Step 2: 重算 contentHash**

```bash
node -e "
const { hashPackagedPluginTree } = require('./config/scripts/desktop-distribution/runtime-verification/verify-packaged-plugin-resources.cjs')
const hash = hashPackagedPluginTree('resources/plugins/launch/stablyai.spec-board')
console.log(hash)
"
```

把打印出来的值写进 `resources/plugins/launch/bundled-plugins.json` 里 `stablyai.spec-board`
那一项的 `contentHash`。

- [ ] **Step 3: 确认 hash 对上了**

```bash
node -e "
const { hashPackagedPluginTree } = require('./config/scripts/desktop-distribution/runtime-verification/verify-packaged-plugin-resources.cjs')
const hash = hashPackagedPluginTree('resources/plugins/launch/stablyai.spec-board')
const catalog = require('./resources/plugins/launch/bundled-plugins.json')
const recorded = catalog.plugins.find((p) => p.pluginKey === 'stablyai.spec-board').contentHash
console.log(hash === recorded ? 'MATCH' : 'MISMATCH ' + hash + ' vs ' + recorded)
"
```

Expected: `MATCH`。

- [ ] **Step 4: 提交并推送**

```bash
git add resources/plugins/launch/bundled-plugins.json
git commit -- resources/plugins/launch/bundled-plugins.json \
  -m "chore(spec-board): the plugin content hash follows the plugin"
git -c http.version=HTTP/1.1 push origin main
```

- [ ] **Step 5: 打包并装到本机**

按 `CLAUDE.md` 的「Local development workflow」：

```bash
for s in build:packages ensure:electron-runtime build:native build:wsl-guest \
         build:cli build:electron-vite build:web-from-renderer build:mobile-web; do
  pnpm run "$s" || break
done

eval "$(node --input-type=module -e "
  import { getLocalBuildIdentity } from './config/scripts/desktop-distribution/macos/build-mac-local.mjs'
  const id = getLocalBuildIdentity()
  console.log('export ORCA_BUILD_COMMIT=' + id.commit)
  console.log('export ORCA_LOCAL_BUILD_VERSION=' + id.version)
")"
ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1 \
  pnpm exec electron-builder --config config/electron-builder-mac-arm64.config.cjs --mac --arm64 --dir

node config/scripts/desktop-distribution/macos/mac-app-install.mjs --source dist/mac-arm64/Orca.app
```

Expected: `/Applications/Orca.app` 被换掉，旧版本留在 `/Applications/Orca.app.bak-*`。

- [ ] **Step 6: 冒烟检查**

```bash
ORCA_BACKGROUND_LAUNCH=1 \
  node config/scripts/runtime-verification/macos/packaged-app-smoke.mjs /Applications/Orca.app --quick
```

Expected: 8/8 PASS。

- [ ] **Step 7: 真机看一眼**

**先走 agent 那条路**（用户真正会走的那条）。在本地一份计划文件末尾加一节——

```markdown
## 验证记录

- 2026-11-27 · 通过 · pnpm tc
```

——然后在装好的 app 里打开「规格看板」面板，点「刷新」。刷新 agent 会去读那份计划文件、把
轮次写进快照的 `superpowers.verification`，插件校验后合并。那张卡片应当：

- 从「校验」栏移到「已验证」栏；
- 徽标是「已验证 ×1」，色是 success；
- 主按钮是「收尾」，「验证」在「更多」里。

**再走一遍失败**：把那一行改成 `- 2026-11-27 · 未通过 · pnpm lint`，再刷新一次。徽标应当
是「上次验证未通过」（warning），卡片退回「校验」栏。

**如果卡片纹丝不动**：先看刷新 agent 有没有把 `superpowers.verification` 写进快照——直接看
`~/.orca/spec-board/board.json` 里那个工作项的 `superpowers.verification`。没写进去，说明
刷新 agent 没数那条记录（新加的那条规则它没照做）；写了却还是不动，说明插件这一侧有别的问题。
同一行没被解析器认也是常见原因：分隔符不是 `·`（U+00B7 前后各一个半角空格），或者结论不是
`通过`/`未通过` 两个字。认不出来就没有证据，卡片留在「校验」是**正确**的行为。

**本地扫描那条路**（插件自己读计划文件）只在 **agent 的快照没有覆盖那个项目**时才看得见：
合并是 `agent ?? local` 整块取用（`board-merge.ts:195-198`），agent 覆盖了项目，它的快照就
是那个项目的事实。

## 验证记录

（验证 agent 在这一节末尾追加记录：`- <日期> · 通过/未通过 · <跑了什么>`。这一节不要写复选框。）
