# 看板的验证轮次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 看板上一个 Superpowers 侧的工作项，在验证通过后离开「校验」栏，进入「已验证」栏，带上「已验证 ×N」徽标，主按钮是「收尾」。

**Architecture:** 验证 agent 把每一轮的结论写进**计划文件末尾的「## 验证记录」一节**（一行 `- <日期> · 通过/未通过 · <跑了什么>`，不是复选框）。插件只读、只发起：本地路径由 `local-scan.ts` 解析计划文件，远程路径由刷新 agent 数出轮次写进快照。新事实 `superpowers.verification` 挂在 `SuperpowersFacts` 上，阶段机多一档 `verified`，徽标说轮次，主按钮换成「收尾」。

**Tech Stack:** TypeScript（插件跑在 Orca 的 worker/panel 运行时），`orca/testing`（插件自己的测试），Node 内置 `fs`。

**Spec:** `docs/superpowers/specs/2026-11-27-spec-board-verification-rounds-design.md`（本次的变更说明）＋ `docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md`（看板设计的正本，阶段表与卡片说明在它那里）。

## Global Constraints

- **插件不改任何文件。** 记录是**验证 agent** 写的，插件只读、只发起（正本 `:30-35`）。本次改动里插件唯一的写动作仍然是快照与清单文件。
- **记录只能落在计划文件里**，不能放 `docs/superpowers/plans/` 旁边的侧车文件——那里每个 `.md` 都会被扫成一个 plan，凭空多出工作项。
- **记录行的格式**：` - <YYYY-MM-DD> · 通过|未通过 · <跑了什么>`（分隔符是 `·`，U+00B7）。结论词只认 `通过` 与 `未通过`。
- **`未通过` 必须先于 `通过` 判定**——`未通过` 含有 `通过` 这个子串，顺序反了每次失败都被数成通过。
- **记录不能是复选框。** `countCheckboxes` 不分节，一行 `- [x] 验证通过` 会被算成计划进度，47/47 变成 48/49。
- **提示词硬上限 4096 字符**（`agent.launch` 拒绝更长的提示词，超限时远程刷新根本起不来，本地扫描那条路不报错）。刷新提示词在真实路径下只剩几十个字符，**规则正文压到 40 字符以内**，提交前用真实路径量一遍。
- **UI 文案是中文**，与插件现有文案同一套语气。
- **插件的测试**：`pnpm test:plugin:spec-board`（423 个用例，35 个文件，约 2 秒）。
- **插件的类型**：`./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board`。
- **插件内容变了要重算 `bundled-plugins.json` 的 `contentHash`**，否则打包校验失败（见 Task 7）。
- **不写新的测试来覆盖已有行为**；每个新测试都必须在实现被回退时变红。

## Review Focus

以下五类输入规格暗示了、但没有哪个任务的测试覆盖；每一条都在拥有它的那个任务里补上测试。

1. **记录行被算成计划进度。** 一行 `- [x] 验证通过` 落在计划文件里，`countCheckboxes` 会把它算进进度——所以验证提示词必须**明确禁止**复选框，解析器也必须**不认**复选框行。（Task 1、Task 3）
2. **上一轮失败、上一轮之前通过。** 徽标必须说「上次验证未通过」（warning），阶段必须留在「校验」——卡片说"已验证"而最近一次验证其实没过，那是撒谎。（Task 4、Task 5）
3. **验证通过之后又加了新任务。** 阶段必须退回「实现」，不能停在「已验证」——阶段机先看清单。（Task 4）
4. **旧快照没有这个字段。** 没有 `verification` 的快照必须仍然被接受，卡片不戴徽标——没有证据就不显示"已验证"。（Task 2、Task 5）
5. **真实长路径下的刷新提示词。** 测试用的是短示例路径，它过了不代表真实路径过得了；提示词必须用一条真实的临时目录路径量过仍在 4096 以内。（Task 6）

---

### Task 1: 验证记录的解析器

**Files:**

- Create: `resources/plugins/launch/stablyai.spec-board/src/verification-records.ts`
- Create: `resources/plugins/launch/stablyai.spec-board/src/verification-records.test.ts`
- Modify: `resources/plugins/launch/stablyai.spec-board/src/model.ts`（加 `VerificationFacts` 类型）

**Interfaces:**

- Consumes: 无
- Produces:
  - `model.ts`: `export type VerificationFacts = { rounds: number; passed: number; lastPassed: boolean | null }`
  - `verification-records.ts`: `export function parseVerificationRecords(markdown: string): VerificationFacts | null`

- [ ] **Step 1: 写会失败的测试**

`verification-records.test.ts`（用 `orca/testing` 的 `assert` / `test`）：

````ts
import { assert, test } from 'orca/testing'
import { parseVerificationRecords } from './verification-records'

test('counts the rounds under the heading', () => {
  const markdown = [
    '## 验证记录',
    '',
    '- 2026-11-27 · 通过 · pnpm tc',
    '- 2026-11-27 · 未通过 · worker-refresh-project.test.ts flaky'
  ].join('\n')
  assert.deepEqual(parseVerificationRecords(markdown), { rounds: 2, passed: 1, lastPassed: false })
})

test('a failed round is not a passed one', () => {
  // `未通过` contains `通过`: judged in the wrong order, every failure counts as a pass.
  const markdown = '## 验证记录\n\n- 2026-11-27 · 未通过 · pnpm tc'
  assert.deepEqual(parseVerificationRecords(markdown), { rounds: 1, passed: 0, lastPassed: false })
})

test('the last round is the last line, not the last pass', () => {
  const markdown = '## 验证记录\n\n- 2026-11-27 · 通过 · pnpm tc\n- 2026-11-28 · 未通过 · pnpm tc'
  assert.deepEqual(parseVerificationRecords(markdown), { rounds: 2, passed: 1, lastPassed: false })
})

test('a verdict it does not know is not a round', () => {
  const markdown = '## 验证记录\n\n- 2026-11-27 · 通过但存疑 · pnpm tc'
  assert.equal(parseVerificationRecords(markdown), null)
})

test('a date that is not a date is not a round', () => {
  assert.equal(parseVerificationRecords('## 验证记录\n\n- 26-11-27 · 通过 · pnpm tc'), null)
  assert.equal(parseVerificationRecords('## 验证记录\n\n- 2026-13-45 · 通过 · pnpm tc'), null)
})

test('a checkbox is not a record', () => {
  // The board counts checkboxes in a plan as its progress: a ticked box here would move the
  // plan's own numbers.
  assert.equal(parseVerificationRecords('## 验证记录\n\n- [x] 验证通过'), null)
})

test('content before the heading is not a record', () => {
  const markdown = '- 2026-11-27 · 通过 · pnpm tc\n\n## 验证记录\n'
  assert.equal(parseVerificationRecords(markdown), null)
})

test('a line in a code block is not a record', () => {
  const markdown = ['## 验证记录', '', '```md', '- 2026-11-27 · 通过 · pnpm tc', '```'].join('\n')
  assert.equal(parseVerificationRecords(markdown), null)
})

test('the section ends at the next heading of the same level', () => {
  const markdown = [
    '## 验证记录',
    '',
    '- 2026-11-27 · 通过 · pnpm tc',
    '',
    '## 下一步',
    '',
    '- 2026-11-28 · 通过 · pnpm tc'
  ].join('\n')
  assert.deepEqual(parseVerificationRecords(markdown), { rounds: 1, passed: 1, lastPassed: true })
})

test('a plan with no such section has no records', () => {
  assert.equal(parseVerificationRecords('# Plan\n\n- [x] one\n'), null)
})
````

- [ ] **Step 2: 跑测试看它红**

Run: `pnpm test:plugin:spec-board`
Expected: FAIL — `Cannot find module './verification-records'`（或该文件不存在）。

- [ ] **Step 3: 实现**

`model.ts` 里加（在 `SuperpowersFacts` 之前）：

```ts
/** What the plan file's own verification records say about the rounds that were run. */
export type VerificationFacts = {
  /** 记录里一共有几轮。 */
  rounds: number
  /** 其中通过的几轮。 */
  passed: number
  /** 最近一轮通过了吗；没有记录时为 null。 */
  lastPassed: boolean | null
}
```

`verification-records.ts`：

- 只认一个标题：`## 验证记录`（行首 trim 之后整行相等）。
- 这一节到**下一个同级或更高级**的标题（`#` 或 `##`）为止；`###` 不结束这一节。
- 节内跳过代码块（围栏 ``` 或 ~~~，与 `markdown-tasks.ts` 同一套判定）。
- 一行记录的正则：`/^-\s*(\d{4}-\d{2}-\d{2})\s*·\s*([^·]+?)\s*(?:·|$)/`——第一段是日期，第二段是结论，后面的「跑了什么」不参与判定。
- 结论先判 `未通过` 再判 `通过`；都不是 → 这一行不算一轮。
- 没有任何一轮 → 返回 `null`（"没有记录"与"格式不对"同义）。

- [ ] **Step 4: 跑测试看它绿**

Run: `pnpm test:plugin:spec-board`
Expected: PASS — 423 + 9 个用例全过（`tests 432 / pass 432 / fail 0`）。

- [ ] **Step 5: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src/model.ts \
        resources/plugins/launch/stablyai.spec-board/src/verification-records.ts \
        resources/plugins/launch/stablyai.spec-board/src/verification-records.test.ts
git commit -m "feat(spec-board): the plan's verification rounds are read, not guessed

The record is a line under one heading, and the parser is strict on purpose: a
line it does not recognise is not a round.  Counting a malformed line would
make the card claim a verification that never happened.

未通过 is judged before 通过, because 未通过 contains 通过.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 事实的两条路：本地读计划，快照带字段

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/model.ts`（`SuperpowersFacts` 加 `verification`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/local-scan-artifacts.ts`（`readPlanFacts`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/local-scan.ts`（读一次计划，两件事一起拿）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/board-schema.ts`（校验 `verification`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/snapshot-format.ts`（示例带上这个对象）
- Modify: 每一个构造 `SuperpowersFacts` 的地方（`panel-fixture.ts`、`stage.test.ts`、`gaps.test.ts`、`item-sources.test.ts`、`board-merge.test.ts`、`board-schema.test.ts`、`actions.test.ts`、`worker-open-source.test.ts`）——加 `verification: null`
- Test: `resources/plugins/launch/stablyai.spec-board/src/local-scan.test.ts`
- Test: `resources/plugins/launch/stablyai.spec-board/src/board-schema.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `parseVerificationRecords(markdown)` 与 `VerificationFacts`
- Produces:
  - `model.ts`: `SuperpowersFacts` 多一个字段 `verification: VerificationFacts | null`（必填、可空——没有记录就是 `null`）
  - `local-scan-artifacts.ts`: `export type PlanFacts = { tasks: CheckboxCount; verification: VerificationFacts | null }` 与 `export async function readPlanFacts(root: string, relative: string, warnings: string[]): Promise<PlanFacts>`

- [ ] **Step 1: 写会失败的测试**

`local-scan.test.ts` 加两个用例（在既有的 `fixture()` 目录里再写一个带记录的计划文件）：

```ts
test('reads the rounds the plan records', async () => {
  const root = await fixture()
  await writeFile(
    join(root, 'docs/superpowers/plans/2026-11-20-add-x.md'),
    [
      '- [x] a\n',
      '- [x] b\n',
      '\n',
      '## 验证记录\n',
      '\n',
      '- 2026-11-27 · 通过 · pnpm tc\n',
      '- 2026-11-28 · 未通过 · pnpm test\n'
    ].join('')
  )
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  const item = result.items[0]!
  assert.deepEqual(item.superpowers?.verification, { rounds: 2, passed: 1, lastPassed: false })
  // The record is not a checkbox: it must not move the plan's own numbers.
  assert.equal(item.superpowers?.planDone, 2)
  assert.equal(item.superpowers?.planTotal, 2)
})

test('a plan without records has none', async () => {
  const root = await fixture()
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.items[0]!.superpowers?.verification, null)
})
```

`board-schema.test.ts` 加三个用例（在既有的 `valid` 快照上加一个 `superpowers` 块）：

```ts
test('accepts the verification facts', () => {
  const result = parseBoardSnapshot(
    withSuperpowers({ verification: { rounds: 2, passed: 1, lastPassed: false } })
  )
  assert.equal(result.ok, true)
})

test('accepts a snapshot written before the field existed', () => {
  // An old snapshot is not a broken one: it is a snapshot with no record.
  const result = parseBoardSnapshot(withSuperpowers(undefined))
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.value.items[0]!.superpowers?.verification : 'rejected', null)
})

test('refuses a passed count larger than the rounds', () => {
  const result = parseBoardSnapshot(withSuperpowers({ rounds: 1, passed: 2, lastPassed: true }))
  assert.equal(result.ok, false)
})
```

（`withSuperpowers` 是这个测试文件里现造的一个辅助函数：复制 `valid`，把 `items[0].superpowers` 换成一个带 `verification` 的 `SuperpowersFacts`；`undefined` 表示**整个 `superpowers` 字段不写**。）

- [ ] **Step 2: 跑测试看它红**

Run: `pnpm test:plugin:spec-board`
Expected: FAIL — `verification` 不在 `SuperpowersFacts` 上，`item.superpowers?.verification` 是 `undefined`（不是 `null`），快照里的 `verification` 被校验器丢掉。

- [ ] **Step 3: 实现**

1. `model.ts`：`SuperpowersFacts` 加 `verification: VerificationFacts | null`（放在 `planTotal` 之后）。
2. `local-scan-artifacts.ts`：加 `PlanFacts` 与 `readPlanFacts`——**计划文件只读一次**，复选框与记录一起拿：

```ts
export async function readPlanFacts(
  root: string,
  relative: string,
  warnings: string[]
): Promise<PlanFacts> {
  const text = await readFileText(root, relative, warnings)
  if (text === null) {
    return { tasks: NO_CHECKBOXES, verification: null }
  }
  return { tasks: countCheckboxes(text), verification: parseVerificationRecords(text) }
}
```

3. `local-scan.ts`：`buildItem` 里把 `countBoxes(root, plan.path, warnings)` 换成 `readPlanFacts(...)`；`superpowersFacts` 的入参从 `planTasks: CheckboxCount` 换成 `planFacts: PlanFacts | null`，返回里带 `verification: planFacts?.verification ?? null`。
4. `board-schema.ts`：加 `readNullableBoolean(value, field)` 与 `readVerificationFacts(value, field)`（`rounds`、`passed` 是非负整数且 `passed <= rounds`，`lastPassed` 是布尔或 `null`）；`readSuperpowersFacts` 用 `readNullable(source['verification'], ...)` 读它——**没有这个字段就是 `null`**。
5. `snapshot-format.ts`：示例的 `superpowers` 块里加 `verification: { rounds: 1, passed: 1, lastPassed: true }`。
6. 每一个构造 `SuperpowersFacts` 的地方补上 `verification: null`（`tsc` 会把它们一个一个列出来）。

- [ ] **Step 4: 跑测试看它绿**

Run: `pnpm test:plugin:spec-board` && `./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 插件测试全过，`tsc` 无输出（退出码 0）。

- [ ] **Step 5: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src resources/plugins/launch/stablyai.spec-board/README.md
git commit -m "feat(spec-board): the rounds reach the card from both sides

The local path reads the plan file once — its checkboxes and its verification
records together — and the remote path carries the counts in the snapshot, so
one fact travels by two roads.

A snapshot written before the field existed is not a broken snapshot: it is a
snapshot with no record, and the card says nothing.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 验证动作留下记录

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts`（加 `VERIFICATION_RECORD_RULE`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/actions.ts`（有计划才带这句）
- Test: `resources/plugins/launch/stablyai.spec-board/src/actions.test.ts`

**Interfaces:**

- Consumes: 无（只用现有 `Subject` 与 `SUPERPOWERS_SKILLS`）
- Produces:
  - `action-catalog.ts`: `export const VERIFICATION_RECORD_RULE: string`
  - `actions.ts`: `Subject.plan` 的类型从 `string` 变成 `string | null`（`null` = 没有计划，或路径不可信）

- [ ] **Step 1: 写会失败的测试**

`actions.test.ts` 加两个用例：

```ts
test('the verify action asks for a record when the work has a plan', () => {
  const prompt = promptOf(findAction(actionsForItem(item, true), 'superpowers.verify')!)
  // The record goes into the plan, and the plan is named so the agent knows where.
  assert.match(prompt, /「## 验证记录」/)
  assert.match(prompt, /docs\/superpowers\/plans\//)
  // It must not be a checkbox: the board counts checkboxes as the plan's progress.
  assert.match(prompt, /不要写复选框/)
})

test('a work item without a plan asks for no record', () => {
  // There is nowhere to write a record, so there is no record to ask for.
  const withoutPlan = actionsForItem(
    { topic: 'add-x', openspec: item.openspec, superpowers: { ...item.superpowers!, plan: null } },
    true
  )
  const prompt = promptOf(findAction(withoutPlan, 'superpowers.verify')!)
  assert.equal(prompt.includes('验证记录'), false)
})
```

（`item`、`promptOf`、`findAction`、`actionsForItem` 都是这个测试文件里已有的。）

- [ ] **Step 2: 跑测试看它红**

Run: `pnpm test:plugin:spec-board`
Expected: FAIL —— 提示词里没有「验证记录」。

- [ ] **Step 3: 实现**

1. `action-catalog.ts` 导出：

```ts
/**
 * The rule the verify action carries when the work item has a plan to write into: the agent has
 * to leave a record of the round, and the plan file is where the record goes.
 *
 * It must not be a checkbox: the board counts the checkboxes in a plan as the plan's progress,
 * so a ticked box here would move the plan's own numbers.
 */
export const VERIFICATION_RECORD_RULE =
  '验证结束后，在 <plan> 的「## 验证记录」一节末尾追加一行：`- <日期> · 通过/未通过 · <跑了什么>`；没有这一节就新建一节。这一节不要写复选框（`- [x]`），看板把复选框当任务进度数。'
```

2. `actions.ts`：
   - `Subject` 的 `plan` 改成 `string | null`——`null` 表示没有计划或路径不可信。
   - `safePath(path)` 改成返回 `string | null`（`null` 而不是兜底串）；`spec` 用 `safePath(item.superpowers.designSpec) ?? '设计 spec'`，`plan` 用 `safePath(item.superpowers.plan)`。
   - `frameworkActions` 的 `plan` 改成 `null`（调色板没有具体工作项，也没有地方放记录）。
   - 提示词里 `<plan>` 仍然是 `subject.plan ?? '实施计划'`（调色板的行为不变）。
   - 加一个 `skillTask(skill, subject)`：`skill.id === 'superpowers.verify' && subject.plan !== null` 时，任务文本后面接 `。${VERIFICATION_RECORD_RULE}`；**替换在拼接之后做**，这样规则里的 `<plan>` 也被换成真实路径。

- [ ] **Step 4: 跑测试看它绿**

Run: `pnpm test:plugin:spec-board` && `./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 插件测试全过，`tsc` 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts \
        resources/plugins/launch/stablyai.spec-board/src/actions.ts \
        resources/plugins/launch/stablyai.spec-board/src/actions.test.ts
git commit -m "feat(spec-board): the verify action asks for a record of the round

The agent is the one who writes the record — the plugin never writes a file —
so the verify action has to say where the record goes and what shape it has.

Only a work item with a plan carries the rule: without a plan there is
nowhere to write a record, and the placeholder path would send the agent
somewhere that does not exist.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 「已验证」这一栏，从阶段到按钮

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/model.ts`（`UnifiedStage` 加 `'verified'`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/stage.ts`（阶段规则）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts`（新增 `superpowers.finish`）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/framework-map.ts`（`finishing-a-development-branch` 挂上动作 id）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-primary-action.ts`（`PREFERRED_BY_STAGE` 加一档）
- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-board.tsx`（导轨加一栏）
- Test: `resources/plugins/launch/stablyai.spec-board/src/stage.test.ts`
- Test: `resources/plugins/launch/stablyai.spec-board/src/panel-primary-action.test.ts`
- Test: `resources/plugins/launch/stablyai.spec-board/src/actions.test.ts`
- Test: `resources/plugins/launch/stablyai.spec-board/src/framework-map.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `SuperpowersFacts.verification`
- Produces:
  - `model.ts`: `UnifiedStage` = `'proposal' | 'design' | 'plan' | 'implement' | 'validate' | 'verified' | 'archive'`
  - `action-catalog.ts`: `SUPERPOWERS_SKILLS` 末尾多一项 `{ id: 'superpowers.finish', label: '收尾', mutates: true, skill: 'superpowers:finishing-a-development-branch', task: '收尾本次改动' }`

- [ ] **Step 1: 写会失败的测试**

`stage.test.ts` 加四个用例（`superpowers()` 这个工厂已经存在，给它加上 `verification` 字段）：

```ts
test('a ticked plan whose last round passed is the verified stage', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({
        plan: 'p.md',
        planTotal: 2,
        planDone: 2,
        verification: { rounds: 2, passed: 2, lastPassed: true }
      })
    }),
    'verified'
  )
})

test('a ticked plan whose last round failed is validate', () => {
  // A card that says "verified" while the last round failed would be lying.
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

test('a ticked plan with no record is validate', () => {
  assert.equal(
    deriveStage({
      openspec: null,
      superpowers: superpowers({ plan: 'p.md', planTotal: 2, planDone: 2 })
    }),
    'validate'
  )
})

test('a verified plan that gained a task is implement again', () => {
  // The stage machine looks at the checklist first: a new task means the work is not done.
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
```

`panel-primary-action.test.ts` 加两个用例：

```ts
test('the verified stage leads with the finish', () => {
  const card = item('verified', ['superpowers.verify', 'superpowers.finish'])
  assert.equal(primaryAction(card)?.id, 'superpowers.finish')
  // The next round of verification stays available behind 更多.
  assert.deepEqual(
    otherActions(card).map((entry) => entry.id),
    ['superpowers.verify']
  )
})
```

`actions.test.ts`：既有的动作清单断言里补上 `'superpowers.finish'`（三处：`an item offers the commands of its change and the skills of its work`、`an item with only Superpowers work offers only the Superpowers skills`、`every action carries the label, the framework and the mutates flag of its row`），并给新技能补一行 `['superpowers.finish', '收尾', 'superpowers', true]`。`every Superpowers prompt names the skill it dispatches` 那张表也要加一行 `'superpowers.finish': 'superpowers:finishing-a-development-branch'`，否则新技能的提示词过不了那张表。

`framework-map.test.ts`：给 `finishing-a-development-branch` 那一步断言 `actionId === 'superpowers.finish'`（`SUPERPOWERS_FLOW` 里它是倒数第三个技能）。

- [ ] **Step 2: 跑测试看它红**

Run: `pnpm test:plugin:spec-board`
Expected: FAIL —— `deriveStage` 仍然返回 `validate`，`'verified'` 不是合法的 `UnifiedStage`（`tsc` 也会报错）。

- [ ] **Step 3: 实现**

1. `model.ts`：`UnifiedStage` 在 `validate` 与 `archive` 之间加 `'verified'`。
2. `stage.ts`：`informative.every(...)` 那一支返回

   ```ts
   return facts.superpowers?.verification?.lastPassed === true ? 'verified' : 'validate'
   ```

   其余规则一行不动（清单没勾完的仍然先看清单）。

3. `action-catalog.ts`：`SUPERPOWERS_SKILLS` 末尾加 `superpowers.finish`（`mutates: true`——收尾会合并或清理分支）。
4. `framework-map.ts`：`SUPERPOWERS_FLOW` 里 `finishing-a-development-branch` 那一步加 `actionId: 'superpowers.finish'`。
5. `panel-primary-action.ts`：`PREFERRED_BY_STAGE` 加 `verified: ['superpowers.finish']`。
   **`archiveReady` 改成 `(item.stage === 'validate' || item.stage === 'verified') && item.openspec?.stage === 'validated'`**——归档这一步排在阶段自己的步骤之前；一个 OpenSpec 侧的变更还没归档时，卡片仍然先带「归档」，而不是丢掉它。
6. `panel-board.tsx`：`STAGES` 在 `校验` 与 `归档` 之间加 `{ id: 'verified', label: '已验证' }`。

- [ ] **Step 4: 跑测试看它绿**

Run: `pnpm test:plugin:spec-board` && `./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 插件测试全过，`tsc` 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): a verified item has a column and a next step

The stage machine gains one branch: everything ticked and the last round
passed is 'verified'.  The last round, not the last pass — a card that says
'verified' while the last round failed would be lying.

The leading button of that column is 收尾, which is what finishing-a-development-
branch does; the next round of verification stays behind 更多, so the rounds keep
going up.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 徽标

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/panel-card.tsx`
- Test: `resources/plugins/launch/stablyai.spec-board/src/panel-card.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `SuperpowersFacts.verification`
- Produces: 无（只是面板上的一行）

- [ ] **Step 1: 写会失败的测试**

`panel-card.test.tsx` 加两个用例（用 `fixturePayload` 复制一份，把 `local|/repo#add-z` 这张 Superpowers 侧的卡的 `verification` 换掉）：

```ts
test('a card that was verified wears the count of the rounds', async () => {
  const host = mockHost({
    requests: { 'board.get': () => withVerification({ rounds: 3, passed: 3, lastPassed: true }) }
  })
  const view = await mount(panel, { host })
  const badge = view.find({ type: 'Badge', text: '已验证 ×3' })
  assert.ok(badge)
  assert.equal(badge?.props.tone, 'success')
  await view.unmount()
})

test('a card whose last round failed says so', async () => {
  const host = mockHost({
    requests: { 'board.get': () => withVerification({ rounds: 3, passed: 2, lastPassed: false }) }
  })
  const view = await mount(panel, { host })
  const badge = view.find({ type: 'Badge', text: '上次验证未通过' })
  assert.ok(badge)
  // The failed round must not read as a success.
  assert.equal(view.find({ type: 'Badge', text: '已验证 ×2' }), null)
  await view.unmount()
})

test('a card with no record wears no verification badge', async () => {
  // Without evidence the board says nothing.
  const host = mockHost({ requests: { 'board.get': () => fixturePayload } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ type: 'Badge', text: '已验证 ×0' }), null)
  assert.equal(view.find({ type: 'Badge', text: '上次验证未通过' }), null)
  await view.unmount()
})
```

（`withVerification` 是这个测试文件里的一个辅助函数：复制 `fixturePayload`，给 `local|/repo#add-z` 的 `superpowers` 加上 `verification`。）

- [ ] **Step 2: 跑测试看它红**

Run: `pnpm test:plugin:spec-board`
Expected: FAIL —— 卡片上没有徽标。

- [ ] **Step 3: 实现**

`panel-card.tsx`：从 `./model` 导入 `VerificationFacts`，加一个函数，并在已有的徽标那一行（项目名 `Badge` 与 `无 CLI` 之后）挂上：

```tsx
/** The badge that says how many rounds of verification the work has passed. */
function verificationBadge(verification: VerificationFacts | null) {
  if (verification === null || verification.lastPassed === null) {
    return null
  }
  if (verification.lastPassed) {
    return <Badge tone="success">{`已验证 ×${verification.passed}`}</Badge>
  }
  return <Badge tone="warning">上次验证未通过</Badge>
}
```

`lastPassed === null`（有记录但结论不明）不戴徽标——没有证据就不显示"已验证"。

- [ ] **Step 4: 跑测试看它绿**

Run: `pnpm test:plugin:spec-board` && `./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 插件测试全过，`tsc` 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src/panel-card.tsx \
        resources/plugins/launch/stablyai.spec-board/src/panel-card.test.tsx
git commit -m "feat(spec-board): the card says how many rounds it passed

'已验证 ×3' is the number of rounds that succeeded; '上次验证未通过' is what a
card wears when the last round failed.  A record with no verdict wears
nothing: without evidence the board says nothing.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 刷新提示词里的那条规则

**Files:**

- Modify: `resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.ts`
- Test: `resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.test.ts`

**Interfaces:**

- Consumes: 无
- Produces: 无（提示词正文）

- [ ] **Step 1: 写会失败的测试**

`refresh-prompt.test.ts` 加三个用例：

```ts
/** A path as long as the ones a real machine hands out: a temp directory, not a short example. */
const LONG_HOME = '/var/folders/db/vtj54kp928z7sqphxz7_t9bm0000gn/T/spec-board-home-BMNsqV'

test('tells the agent to count the rounds the plan records', () => {
  for (const text of [prompt, projectPrompt]) {
    assert.match(text, /验证记录/)
    assert.match(text, /verification/)
  }
})

test('the prompt of one project fits the host with a real path too', () => {
  // The example path in the tests is short; a real machine hands out a longer one, and a
  // refresh that cannot start collects nothing.
  const long = buildProjectRefreshPrompt({
    scanListPath: `${LONG_HOME}/scan-list-ab12cd34.json`,
    snapshotPath: `${LONG_HOME}/project-ab12cd34.json`
  })
  assert.ok(long.length <= PROMPT_MAX_CHARS, `${long.length} > ${PROMPT_MAX_CHARS}`)
  const whole = buildRefreshPrompt({
    scanListPath: `${LONG_HOME}/scan-list.json`,
    snapshotPath: `${LONG_HOME}/board.json`
  })
  assert.ok(whole.length <= PROMPT_MAX_CHARS, `${whole.length} > ${PROMPT_MAX_CHARS}`)
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `pnpm test:plugin:spec-board`
Expected: FAIL —— 提示词里没有「验证记录」。

- [ ] **Step 3: 实现**

在 `refresh-prompt.ts` 的 `snapshotRules()` 里（讲 `superpowers.plan` 的那一条之后）加一条规则：

```
- 计划里「验证记录」一节的轮次照示例写进 verification
```

这条规则**正文不超过 40 字符**（正文 39 字符，连项目符号与换行共 40）。示例里的 `superpowers.verification` 对象告诉 agent 字段该长什么样（Task 2 已经把它放进 `snapshot-format.ts`）。

- [ ] **Step 4: 跑测试看它绿，并用真实路径量一遍**

Run: `pnpm test:plugin:spec-board` && `./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board`
Expected: PASS —— 插件测试全过，`tsc` 退出码 0。

**再量一次**（把真实路径的长度打印出来，记进提交说明）：

```bash
cat > "$CLAUDE_JOB_DIR/tmp/measure-prompt.ts" <<'EOF'
import { buildProjectRefreshPrompt, buildRefreshPrompt } from '<repo>/resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.ts'
const home = '/var/folders/db/vtj54kp928z7sqphxz7_t9bm0000gn/T/spec-board-home-BMNsqV'
console.log('board  ', buildRefreshPrompt({ scanListPath: `${home}/scan-list.json`, snapshotPath: `${home}/board.json` }).length)
console.log('project', buildProjectRefreshPrompt({ scanListPath: `${home}/scan-list-ab12cd34.json`, snapshotPath: `${home}/project-ab12cd34.json` }).length)
EOF
./node_modules/.bin/bun "$CLAUDE_JOB_DIR/tmp/measure-prompt.ts"
```

Expected: 两条都在 4096 以内，且**单项目那条至少还剩 10 个字符**。若放不下：按设计的兜底，把这条规则从提示词里拿掉，改为写进清单文件的 `snapshotFormat`（`scan-list.json` 没有长度上限），并在 `snapshot-format.ts` 的示例旁边补一句说明——**不要硬塞**，超限时远程刷新根本起不来。

- [ ] **Step 5: 提交**

```bash
git add resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.ts \
        resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.test.ts
git commit -m "feat(spec-board): the refresh prompt counts the rounds too

On a remote project the plugin cannot read the plan itself, so the refresh
agent has to count the rounds and say how many there were.

The rule is 40 characters: the prompt has room for about sixty characters left
under the host's 4096 limit on a real path, and a refresh that cannot start
collects nothing.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 内容哈希与正本

**Files:**

- Modify: `resources/plugins/launch/bundled-plugins.json`
- Modify: `docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md`
- Modify: `resources/plugins/launch/stablyai.spec-board/README.md`

**Interfaces:**

- Consumes: Task 1–6 的全部改动（插件内容变了）
- Produces: 无

- [ ] **Step 1: 重算内容哈希**

```bash
node config/scripts/plugin-authoring/content-validation/validate-plugin-files.mjs \
  resources/plugins/launch/stablyai.spec-board
```

从输出里读 `contentHash`（64 位十六进制），写进 `resources/plugins/launch/bundled-plugins.json` 里 `stablyai.spec-board` 那一条。

- [ ] **Step 2: 更新正本**

`docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md`：

1. `UnifiedStage`（`:303` 附近）加 `'verified'`。
2. 阶段推导表（`:366-377` 附近）把「存在的进度对里……全部勾完」那一行拆成两行：全部勾完**且最近一轮验证通过** → `verified`；全部勾完但没有记录或最近一轮未通过 → `validate`。
3. 导轨与卡片说明（`:459` 附近）：`提案 → 设计 → 计划 → 实现 → 校验 → 已验证 → 归档`；卡片多一个徽标（`已验证 ×N` / `上次验证未通过`）；「已验证」栏的主按钮是「收尾」。
4. 命令表（`:495-497` 附近）加一行「收尾」。
5. **补一句**：验证记录由**验证 agent** 写进计划文件，插件自己不写任何文件（守住 `:30-35` 那条约束）。

`resources/plugins/launch/stablyai.spec-board/README.md`：第 7 行的阶段串改成 `提案 → 设计 → 计划 → 实现 → 校验 → 已验证 → 归档`，并说明徽标。

- [ ] **Step 3: 跑门禁**

Run: `pnpm test:plugin:spec-board` && `./node_modules/.bin/tsc --noEmit -p resources/plugins/launch/stablyai.spec-board` && `pnpm exec oxlint resources/plugins/launch/stablyai.spec-board/src`
Expected: 插件测试全过；`tsc` 退出码 0；`oxlint` 无输出。

- [ ] **Step 4: 提交**

```bash
git add resources/plugins/launch/bundled-plugins.json \
        docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md \
        resources/plugins/launch/stablyai.spec-board/README.md
git commit -m "docs(spec-board): the board's own design says what a verified item is

The canonical design holds the stage table, the rail and the card, so they
have to say what the new column is.  It also says who writes the record: the
verification agent, never the plugin.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 5: 推送前的门禁**

Run: `pnpm check:changed`
Expected: PASS —— 全部检查项通过（这是推送前必须过的门）。

---

## Pre-flight

- **共享接口**：Task 2 消费 Task 1 的 `parseVerificationRecords` 与 `VerificationFacts`；Task 3、Task 5 消费 Task 2 的 `SuperpowersFacts.verification`；Task 4 消费 Task 2 的 `verification` 并产出 `UnifiedStage` 的 `'verified'`；Task 7 消费全部。
- **已定的分歧（记录在案，不再讨论）**：
  - `archiveReady` 接受 `verified` 这一档——归档这一步排在阶段自己的步骤之前；规格 §4.4 说的「已验证栏的主按钮是收尾」指的是规格讲的那个**只有 Superpowers 侧**的工作项，两边都有的工作项仍然先带「归档」。不改这一条会让原来带「归档」的卡片丢掉它。
  - 记录行落在**计划文件**里，不放侧车文件——`docs/superpowers/plans/` 下每个 `.md` 都会被扫成一个 plan。
  - `verification` 在 `SuperpowersFacts` 上是**必填可空**（`VerificationFacts | null`），与同类型的 `designSpec` / `plan` 一致；代价是每一个构造点都要补 `verification: null`。
  - 计划路径不可信（`isSafeCommandPath` 不过）时，验证动作**不带**记录要求——不可信的路径不能进提示词，没有路径就没有地方放记录。
  - 刷新提示词的那条规则**放在 `snapshotRules()` 里**（两份提示词共用），并且必须用真实路径量过；放不下就写进清单文件。
