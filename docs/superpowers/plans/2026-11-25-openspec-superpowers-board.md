# OpenSpec × Superpowers 规格看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Orca sidebar plugin that shows OpenSpec and Superpowers side by side and launches both frameworks' own commands from the board.

**Architecture:** A `trusted-worker` plugin. The worker keeps a deterministic local scan (Node `fs`) and merges in an agent-written snapshot from `~/.orca/spec-board/board.json`; it owns every judgment (stage, gaps, actions) so the agent only supplies facts. The panel is a `components` panel — Orca draws it, so there is no CSS and no theme work.

**Tech Stack:** Orca plugin API 1 (`orca`, `orca/worker`, `orca/testing`), TypeScript loaded without a build step, Orca's test runner (`orca plugin test`).

**Spec:** `docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md`

## Global Constraints

- Plugin directory: `resources/plugins/launch/stablyai.spec-board/`
- Manifest: `manifestVersion: 2`, `id: "spec-board"`, `publisher: "stablyai"`, `execution: "trusted-worker"`, `engines.orca: ">=1.4.256"`.
- The id must **not** start with `orca-`: that prefix installs only from the official catalog and would break local development installs.
- Capabilities are earned, not asserted: **a commit's manifest declares only the capabilities the code in that commit actually calls.** Task 1's scaffold calls `storage:own` and nothing else; Task 7's worker adds `workspace:read`, `agent:launch`, `terminal:send`, `workspace:write` and `settings:own` in the same commit that introduces the code using them, and drops `storage:own` (the finished worker keeps its snapshot in `~/.orca/spec-board/`, not in plugin storage). The shipped manifest declares exactly those five and nothing else.
- Panel: id `board`, title `规格看板`, icon `layers`, `ui: "components"`.
- Store files live under `~/.orca/spec-board/`; `process.env.SPEC_BOARD_HOME` overrides the directory in tests.
- The plugin never writes to a project's files. It only launches `openspec` or an agent.
- No network calls. No third-party imports: only `orca`, `orca/*` and relative files.
- UI copy is Chinese; identifiers, file names and commit subjects are English.
- **Commit with `git commit -- <paths>`, never a bare `git commit`.** Another session works in this
  same checkout and may have files staged in the index; a bare `git commit` takes the whole index,
  not just what `git add` names. This happened once in Task 2 and had to be undone with
  `git reset --soft HEAD~1` followed by a path-limited commit.
- The plugin lives under `resources/`, which is **outside the repo's tsconfig projects** — so `pnpm tc` does not type-check it — but **inside the root oxlint config's scope** (`resources/` is not in `ignorePatterns`). Type-check inside the plugin with `npx tsc -p .` after `orca plugin types`, and lint with `pnpm exec oxlint resources/plugins/launch/stablyai.spec-board/src`.
- Check commands, run from the repo root:
  - `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
  - `orca plugin check resources/plugins/launch/stablyai.spec-board --json`
  - `orca plugin validate resources/plugins/launch/stablyai.spec-board --json`

## Review Focus

Inputs and conditions the spec implies but no happy-path test covers. Each is pinned by a test in the task named.

1. A checkbox inside a fenced code block must not count toward progress — a `tasks.md` full of
   examples would otherwise report false progress. (Task 3) An **indented** checkbox does count:
   OpenSpec's own task pattern is `/^(\s*)-\s+\[([x\s-~])\]\s+(.+)$/gm`, whose `(\s*)` prefix
   admits indentation, and the extension renders "each task and subtask" with a hierarchy. Only
   the fence rule is about not counting examples.
2. A snapshot whose `generatedAt` is missing or not ISO must render as "未知时间" rather than throw and blank the panel. (Task 2, Task 10)
3. A registry path written with Windows separators or different case must still match the `workspace.list` row, and must report "找不到 workspace" when nothing matches — never silently run a command in the wrong directory. (Task 7)
4. Two OpenSpec changes sharing a topic (`add-x` and `update-x`) must pair one-to-one with Superpowers artifacts; one plan must never satisfy both. (Task 4)
5. Clicking an OpenSpec action on a host without the CLI must fall back to the agent form instead of surfacing ENOENT. (Task 6)

---

### Task 1: Scaffold, manifest, framework map

**Files:**

- Create: `resources/plugins/launch/stablyai.spec-board/` (scaffolded)
- Modify: `orca-plugin.json`
- Replace later: the template's `src/panel.tsx`, `src/panel.test.tsx`, `src/panel.check.ts`, `src/protocol.ts`, `src/worker.ts` and `src/worker.test.ts` stay untouched here and are overwritten by Tasks 7 and 8, so `orca plugin validate` still passes at the end of this task
- Create: `src/framework-map.ts`
- Test: `src/framework-map.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type FrameworkStage = {
    id: 'create' | 'implement' | 'archive'
    title: string
    artifacts: string[]
    commands: { label: string; command: string }[]
  }
  export type SuperpowersStep = {
    skill: string
    role: string
    artifact: string | null
    gate: string | null
  }
  export type Correspondence = { openspec: string; superpowers: string; note: string }
  export type DecisionRule = { situation: string; action: string }
  export const OPENSPEC_STAGES: readonly FrameworkStage[]
  export const SUPERPOWERS_FLOW: readonly SuperpowersStep[]
  export const CORRESPONDENCE: readonly Correspondence[]
  export const OPENSPEC_DECISION_TREE: readonly DecisionRule[]
  ```

- [ ] **Step 1: Scaffold the plugin**

```bash
cd /Users/a1234/ctjt/code/prism_orca
orca plugin create resources/plugins/launch/stablyai.spec-board \
  --template worker-panel --id spec-board --name "OpenSpec × Superpowers 看板" --json
```

Expected: JSON with `"ok": true` and `"pluginKey": "local.spec-board"`.

- [ ] **Step 2: Replace `orca-plugin.json`**

```json
{
  "manifestVersion": 2,
  "id": "spec-board",
  "publisher": "stablyai",
  "name": "OpenSpec × Superpowers 看板",
  "version": "0.1.0",
  "description": "把 OpenSpec 的规格变更与 Superpowers 的设计/计划画在同一块看板上，并标出两者脱节的地方。",
  "engines": {
    "orca": ">=1.4.256"
  },
  "execution": "trusted-worker",
  "pluginApi": 1,
  "main": "src/worker.ts",
  "contributes": {
    "panels": [
      {
        "id": "board",
        "title": "规格看板",
        "icon": "layers",
        "entry": "src/panel.tsx",
        "ui": "components"
      }
    ]
  },
  "capabilities": [
    {
      "kind": "storage:own"
    }
  ]
}
```

The four host capabilities (`workspace:read`, `agent:launch`, `terminal:send`,
`workspace:write`) and the `settings:own` capability together with the
`contributes.settings` block arrive in Task 7, in the same commit as the worker code that
uses them. `settings:own` is required by `contributes.settings`, so the two cannot be
separated. `storage:own` is what the generated scaffold's worker needs; Task 7's worker
replaces it and drops the capability.

- [ ] **Step 3: Validate the manifest**

Run: `orca plugin validate resources/plugins/launch/stablyai.spec-board --json`
Expected: exit 0. If it rejects `publisher: "stablyai"` for a folder plugin, **stop and report** — the bundled-delivery approach in the spec needs rework before any UI work.

- [ ] **Step 4: Write the failing test**

`src/framework-map.test.ts`:

```ts
test('the OpenSpec stages are the three real stages, with their real files', () => {
  assert.deepEqual(
    OPENSPEC_STAGES.map((stage) => stage.id),
    ['create', 'implement', 'archive']
  )
  assert.deepEqual(OPENSPEC_STAGES[0]!.artifacts, [
    'openspec/changes/<change-id>/proposal.md',
    'openspec/changes/<change-id>/design.md',
    'openspec/changes/<change-id>/tasks.md',
    'openspec/changes/<change-id>/specs/<capability>/spec.md'
  ])
  assert.deepEqual(OPENSPEC_STAGES[1]!.artifacts, [
    'openspec/changes/<change-id>/proposal.md',
    'openspec/changes/<change-id>/design.md',
    'openspec/changes/<change-id>/tasks.md',
    'openspec/changes/<change-id>/specs/<capability>/spec.md'
  ])
  assert.deepEqual(OPENSPEC_STAGES[2]!.artifacts, [
    'openspec/changes/archive/YYYY-MM-DD-<change-id>/',
    'openspec/specs/<capability>/spec.md'
  ])
  assert.deepEqual(
    OPENSPEC_STAGES.flatMap((stage) => stage.commands.map((command) => command.command)),
    [
      'openspec list',
      'openspec list --specs',
      'openspec validate <change-id> --strict',
      'openspec show <change-id>',
      'openspec validate <change-id> --strict',
      'openspec archive <change-id> --yes',
      'openspec validate --strict'
    ]
  )
})

test('the Superpowers flow is the fifteen real skills in process order', () => {
  assert.deepEqual(
    SUPERPOWERS_FLOW.map((step) => step.skill),
    [
      'using-superpowers',
      'brainstorming',
      'writing-plans',
      'using-git-worktrees',
      'executing-plans',
      'subagent-driven-development',
      'dispatching-parallel-agents',
      'test-driven-development',
      'systematic-debugging',
      'requesting-code-review',
      'receiving-code-review',
      'verification-before-completion',
      'finishing-a-development-branch',
      'diagnosing-superpowers',
      'writing-skills'
    ]
  )
  assert.deepEqual(
    SUPERPOWERS_FLOW.filter((step) => step.artifact !== null).map((step) => [
      step.skill,
      step.artifact
    ]),
    [
      ['brainstorming', 'docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md'],
      ['writing-plans', 'docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md']
    ]
  )
  assert.deepEqual(
    SUPERPOWERS_FLOW.filter((step) => step.gate !== null).map((step) => step.skill),
    ['brainstorming', 'writing-plans']
  )
})

test('the correspondence rows pair the two frameworks artifact by artifact', () => {
  assert.deepEqual(
    CORRESPONDENCE.map((row) => [row.openspec, row.superpowers]),
    [
      ['proposal.md', 'design spec 的 Context/Goals'],
      ['design.md', 'design spec 的 Decisions/Risks'],
      ['tasks.md', 'plan'],
      ['增量 spec', '验收标准']
    ]
  )
})

test('the decision tree says when to write a proposal and when to just fix', () => {
  assert.deepEqual(
    OPENSPEC_DECISION_TREE.map((rule) => [rule.situation, rule.action]),
    [
      ['修 bug：行为本就符合 spec', '直接改，不用写 proposal'],
      ['改错别字、格式、注释', '直接改，不用写 proposal'],
      ['新增功能或能力', '写 proposal'],
      ['破坏性变更（API、schema）', '写 proposal'],
      ['架构或模式变更', '写 proposal'],
      ['拿不准', '写 proposal（更安全）']
    ]
  )
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — `Cannot find module './framework-map'`.

- [ ] **Step 6: Implement `framework-map.ts`**

Three OpenSpec stages (`create` / `implement` / `archive`), each with the artifact paths and the CLI commands from the spec. Fifteen Superpowers steps in flow order, each naming its artifact (`docs/superpowers/specs/…`, `docs/superpowers/plans/…`) or `null`, and its gate (`"设计未批准不得写代码"`, `"spec 批准后才允许写实施计划"`) or `null`. Four correspondence rows: `proposal.md ↔ design spec 的 Context/Goals`、`design.md ↔ Decisions/Risks`、`tasks.md ↔ plan`、`增量 spec ↔ 验收标准`.

The sixth export, `OPENSPEC_DECISION_TREE`, holds the six rules from `openspec/AGENTS.md`'s decision tree — when to write a proposal and when to just fix the code: 修 bug（行为本就符合 spec）、改错别字/格式/注释 → 直接改；新增功能或能力、破坏性变更（API/schema）、架构或模式变更 → 写 proposal；拿不准 → 写 proposal（更安全）。It is a separate export, not a field on `FrameworkStage`: the stages describe how a change flows, the tree describes whether to start one.

- [ ] **Step 7: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 6 tests (4 framework-map + 2 scaffold).

- [ ] **Step 8: Type-check**

```bash
cd resources/plugins/launch/stablyai.spec-board
orca plugin types .
npx tsc -p .
```

Expected: exit 0.

- [ ] **Step 9: Replace the scaffold's `README.md`**

The generated README describes the Counter demo. Rewrite it for this plugin: what the board
shows, the three tabs, and — in the spec's own careful wording — that the plugin itself writes
no file into a project; it only _initiates_ actions, and the two frameworks' own commands are
what change state. Say it that way, because `openspec archive` really does move
`changes/<id>/` into `changes/archive/`. It is a few lines, not a manual.

- [ ] **Step 10: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board
git commit -m "feat(spec-board): scaffold the plugin and its framework map"
```

---

### Task 2: Snapshot model and validation

**Files:**

- Create: `src/model.ts`
- Create: `src/board-schema.ts`
- Test: `src/board-schema.test.ts`

**Interfaces:**

- Produces (from `model.ts`):
  ```ts
  export type UnifiedStage = 'proposal' | 'design' | 'plan' | 'implement' | 'validate' | 'archive'
  export type GapCode =
    | 'openspec-only'
    | 'superpowers-only'
    | 'progress-drift'
    | 'no-design'
    | 'tasks-complete-not-archived'
    | 'archived-spec-stale'
  export type Gap = { code: GapCode; severity: 'info' | 'warning' | 'error'; message: string }
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
  export type SnapshotProject = {
    id: string
    name: string
    host: string
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
  export type SnapshotItem = {
    id: string
    projectId: string
    title: string
    topic: string
    openspec: OpenspecFacts | null
    superpowers: SuperpowersFacts | null
    summary?: string
    nextAction?: { label: string; detail: string }
  }
  export type ActionRun = { kind: 'terminal'; command: string } | { kind: 'agent'; prompt: string }
  export type Action = {
    id: string
    label: string
    framework: 'openspec' | 'superpowers'
    run: ActionRun
    mutates: boolean
  }
  export type WorkItem = SnapshotItem & { stage: UnifiedStage; gaps: Gap[]; actions: Action[] }
  export type BoardSnapshot = {
    schemaVersion: 1
    generatedAt: string
    generatedBy: { agent: string; workspace?: string; host?: string }
    projects: SnapshotProject[]
    items: SnapshotItem[]
    notes?: string[]
  }
  export type BoardPayload = {
    items: WorkItem[]
    projects: SnapshotProject[]
    sources: { localAt: number | null; agentAt: number | null }
    warnings: string[]
  }
  export type ProjectRef = { name: string; host: string; path: string }
  ```
- Produces (from `board-schema.ts`):

  ```ts
  export type ParseResult = { ok: true; value: BoardSnapshot } | { ok: false; error: string }
  export function parseBoardSnapshot(raw: unknown): ParseResult
  ```

- [ ] **Step 1: Write the failing test**

`src/board-schema.test.ts`:

```ts
import { assert, test } from 'orca/testing'
import { parseBoardSnapshot } from './board-schema'

const valid = {
  schemaVersion: 1,
  generatedAt: '2026-11-25T10:00:00.000Z',
  generatedBy: { agent: 'claude' },
  projects: [
    {
      id: 'local|/repo',
      name: 'repo',
      host: 'local',
      path: '/repo',
      openspec: null,
      superpowers: null,
      openspecCli: null,
      scannedAt: '2026-11-25T10:00:00.000Z'
    }
  ],
  items: [
    {
      id: 'local|/repo#add-x',
      projectId: 'local|/repo',
      title: 'Add X',
      topic: 'add-x',
      openspec: {
        changeId: 'add-x',
        stage: 'implementing',
        hasProposal: true,
        hasDesign: false,
        hasTasks: true,
        tasksDone: 2,
        tasksInProgress: 0,
        tasksTotal: 5,
        capabilities: ['x']
      },
      superpowers: null
    }
  ]
}

test('accepts a minimal valid snapshot', () => {
  const result = parseBoardSnapshot(valid)
  assert.equal(result.ok, true)
})

test('rejects an unknown schemaVersion', () => {
  const result = parseBoardSnapshot({ ...valid, schemaVersion: 2 })
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /schemaVersion/)
})

test('rejects progress where done exceeds total', () => {
  const item = {
    ...valid.items[0],
    openspec: { ...valid.items[0]!.openspec, tasksDone: 9, tasksInProgress: 0, tasksTotal: 5 }
  }
  const result = parseBoardSnapshot({ ...valid, items: [item] })
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /\.tasksDone:/)
})

test('rejects a project without a path', () => {
  const project = { ...valid.projects[0] } as Record<string, unknown>
  delete project.path
  const result = parseBoardSnapshot({ ...valid, projects: [project] })
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /path/)
})

test('keeps a missing generatedAt parseable so the panel can say it is unknown', () => {
  const { generatedAt, ...rest } = valid
  const result = parseBoardSnapshot(rest)
  assert.equal(result.ok, true)
  assert.equal(result.ok === true ? result.value.generatedAt : '', '')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — `Cannot find module './board-schema'`.

- [ ] **Step 3: Implement `model.ts` and `board-schema.ts`**

`parseBoardSnapshot` is a hand-written validator: no dependencies are allowed. It checks the top-level shape, `schemaVersion === 1`, that `projects` and `items` are arrays, that every project has non-empty `id`/`name`/`host`/`path`, that every item has `id`/`projectId`/`title`/`topic`, that both progress triples satisfy
`done + inProgress <= total`, and that `inProgress` is a non-negative integer. Unknown keys are dropped. A missing `generatedAt` becomes `''`.

Each rejection returns `{ ok: false, error: '<field>: <what is wrong>' }` so the panel can name the field.

**`null` means absent for optional fields.** The snapshot is written by an LLM, and `null` for an
absent optional is the most common thing it produces. A single `null` must not reject the whole
snapshot and blank the board. So `readOptionalString` returns `undefined` for both `undefined` and
`null`, and `nextAction: null` is read as absent. The fields whose type says `string | null` —
`designSpec`, `plan`, `openspec`, `superpowers` — keep their `null`, because there `null` is
meaningful.

`notes` is optional too (`notes?: string[]`), so `notes: null` reads as absent by the same rule —
the LLM writes it, and one `null` must not blank the board.

An unexpected exception inside the validator is a bug in the validator, not a malformed snapshot:
log it and answer with a generic Chinese message that does not leak the English stack fragment.
That branch is reachable from outside the module — a value with a throwing getter reaches it through
the public entry point — so it gets a test that asserts the property rather than the copy:
the returned message must not contain the English fragment, and a malformed snapshot must still
report its field name.

- [ ] **Step 4: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 15 tests (7 board-schema + 4 framework-map + 2 panel/worker scaffold).

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): add the snapshot model and its validator"
```

---

### Task 3: Checkbox counting and stage derivation

**Files:**

- Create: `src/markdown-tasks.ts`
- Create: `src/stage.ts`
- Test: `src/markdown-tasks.test.ts`
- Test: `src/stage.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type CheckboxCount = { done: number; total: number; inProgress: number }
  export function countCheckboxes(markdown: string): CheckboxCount
  export function deriveStage(facts: {
    openspec: OpenspecFacts | null
    superpowers: SuperpowersFacts | null
  }): UnifiedStage
  ```

- [ ] **Step 1: Write the failing tests**

`src/markdown-tasks.test.ts`:

````ts
import { assert, test } from 'orca/testing'
import { countCheckboxes } from './markdown-tasks'

test('counts done and open boxes, including nested and upper-case ones', () => {
  const md = ['- [x] a', '- [ ] b', '  - [X] c', '    - [-] d', '* [~] e'].join('\n')
  assert.deepEqual(countCheckboxes(md), { done: 2, total: 5, inProgress: 2 })
})

test('ignores boxes inside fenced code blocks', () => {
  const md = [
    '- [x] real',
    '```md',
    '- [ ] example',
    '- [x] example',
    '```',
    '- [ ] also real'
  ].join('\n')
  assert.deepEqual(countCheckboxes(md), { done: 1, total: 2, inProgress: 0 })
})

test('returns zeros for a file with no boxes', () => {
  assert.deepEqual(countCheckboxes('# Plan\n\nNothing here.'), { done: 0, total: 0, inProgress: 0 })
})
````

`src/stage.test.ts`:

```ts
import { assert, test } from 'orca/testing'
import type { OpenspecFacts, SuperpowersFacts } from './model'
import { deriveStage } from './stage'

const openspec = (over: Partial<OpenspecFacts> = {}) => ({
  changeId: 'add-x',
  stage: 'proposed' as const,
  hasProposal: true,
  hasDesign: false,
  hasTasks: false,
  tasksDone: 0,
  tasksInProgress: 0,
  tasksTotal: 0,
  capabilities: [],
  ...over
})
const superpowers = (over: Partial<SuperpowersFacts> = {}) => ({
  designSpec: null,
  plan: null,
  stage: 'designed' as const,
  planDone: 0,
  planInProgress: 0,
  planTotal: 0,
  ...over
})

test('a proposal alone is the proposal stage', () => {
  assert.equal(deriveStage({ openspec: openspec(), superpowers: null }), 'proposal')
})

test('a design without tasks or a plan is the design stage', () => {
  assert.equal(
    deriveStage({ openspec: openspec({ hasDesign: true }), superpowers: superpowers() }),
    'design'
  )
})

test('tasks that nobody started are the plan stage', () => {
  assert.equal(
    deriveStage({ openspec: openspec({ hasTasks: true, tasksTotal: 4 }), superpowers: null }),
    'plan'
  )
})

test('any completed box is the implement stage', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksTotal: 4, tasksDone: 1 }),
      superpowers: null
    }),
    'implement'
  )
})

test('everything ticked but not archived is validate', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ hasTasks: true, tasksTotal: 4, tasksDone: 4 }),
      superpowers: superpowers({ plan: 'p.md', planTotal: 2, planDone: 2 })
    }),
    'validate'
  )
})

test('an archived change is archive regardless of the rest', () => {
  assert.equal(
    deriveStage({
      openspec: openspec({ stage: 'archived', hasTasks: true, tasksTotal: 1, tasksDone: 1 }),
      superpowers: null
    }),
    'archive'
  )
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both modules**

`countCheckboxes` skips lines inside ``` fences, matches `^\s*[-*]\s+\[([ xX~-])\]`, and counts `x`/`X` as done and `~`/`-` as in-progress.

`deriveStage` applies the spec's §4.6 table in order: archived → validate → implement → plan → design → proposal. "Everything ticked" means: among the progress pairs that carry information (those with `total > 0`), every one is fully ticked (`done === total` — an in-progress box is not a finished one), and at least one such pair exists. A pair with `total === 0` is an empty checklist: it carries no progress information, so it does not veto the stage. "Started" means `done + inProgress > 0` on some side: OpenSpec treats `- [-]` and `- [~]` as in progress, so work that is underway must read as `implement`, not `plan`.

- [ ] **Step 4: Run them to verify they pass**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): count task checkboxes and derive the unified stage"
```

---

### Task 4: Correlation and gap detection

**Files:**

- Create: `src/correlation.ts`
- Create: `src/gaps.ts`
- Test: `src/correlation.test.ts`
- Test: `src/gaps.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type CorrelationInput = { id: string; topic: string }
  export type CorrelationMatch = { openspecId: string; superpowersId: string; confidence: number }
  export function normalizeTopic(fileName: string): string
  export function topicSimilarity(a: string, b: string): number
  export function correlate(
    openspec: readonly CorrelationInput[],
    superpowers: readonly CorrelationInput[]
  ): {
    matches: CorrelationMatch[]
    unmatchedOpenspec: string[]
    unmatchedSuperpowers: string[]
  }
  export function detectGaps(item: {
    openspec: OpenspecFacts | null
    superpowers: SuperpowersFacts | null
    existingSpecCapabilities?: readonly string[]
  }): Gap[]
  ```

- [ ] **Step 1: Write the failing tests**

`src/correlation.test.ts`:

```ts
import { assert, test } from 'orca/testing'
import { correlate, normalizeTopic, topicSimilarity } from './correlation'

test('normalizes a dated design-spec file name to its topic', () => {
  assert.equal(normalizeTopic('2026-11-17-next-edit-suggestion-design.md'), 'next-edit-suggestion')
  assert.equal(normalizeTopic('next-edit-suggestion'), 'next-edit-suggestion')
})

test('scores partial overlap below an exact match', () => {
  assert.equal(topicSimilarity('add-two-factor-auth', 'add-two-factor-auth'), 1)
  assert.ok(topicSimilarity('add-two-factor-auth', 'add-two-factor-auth-ui') < 1)
  assert.equal(topicSimilarity('abc-def', 'xyz'), 0)
})

test('pairs exact topics first, then the best remaining overlap', () => {
  const result = correlate(
    [
      { id: 'o1', topic: 'next-edit-suggestion' },
      { id: 'o2', topic: 'intelligent-refactor' }
    ],
    [
      { id: 's1', topic: 'intelligent-refactor' },
      { id: 's2', topic: 'next-edit-suggestion-design' }
    ]
  )
  assert.deepEqual(
    result.matches.map((m) => [m.openspecId, m.superpowersId]),
    [
      ['o2', 's1'],
      ['o1', 's2']
    ]
  )
  assert.deepEqual(result.unmatchedOpenspec, [])
  assert.deepEqual(result.unmatchedSuperpowers, [])
})

test('pairs one-to-one when two changes share a topic', () => {
  const result = correlate(
    [
      { id: 'o1', topic: 'add-x-auth' },
      { id: 'o2', topic: 'update-x-auth' }
    ],
    [{ id: 's1', topic: 'x-auth' }]
  )
  // Exactly one of the two changes gets the single plan, and the other is reported unmatched.
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]!.superpowersId, 's1')
  assert.equal(result.unmatchedOpenspec.length, 1)
  assert.deepEqual(result.unmatchedSuperpowers, [])
})

test('leaves everything unmatched when nothing overlaps', () => {
  const result = correlate([{ id: 'o1', topic: 'alpha' }], [{ id: 's1', topic: 'beta' }])
  assert.deepEqual(result.matches, [])
  assert.deepEqual(result.unmatchedOpenspec, ['o1'])
  assert.deepEqual(result.unmatchedSuperpowers, ['s1'])
})
```

`src/gaps.test.ts`:

```ts
import { assert, test } from 'orca/testing'
import type { OpenspecFacts, SuperpowersFacts } from './model'
import { detectGaps } from './gaps'

const openspec = (over: Partial<OpenspecFacts> = {}) => ({
  changeId: 'add-x',
  stage: 'implementing' as const,
  hasProposal: true,
  hasDesign: true,
  hasTasks: true,
  tasksDone: 1,
  tasksInProgress: 0,
  tasksTotal: 4,
  capabilities: [],
  ...over
})
const superpowers = (over: Partial<SuperpowersFacts> = {}) => ({
  designSpec: 'spec.md',
  plan: 'plan.md',
  stage: 'executing' as const,
  planDone: 1,
  planInProgress: 0,
  planTotal: 4,
  ...over
})
const codes = (item: Parameters<typeof detectGaps>[0]) => detectGaps(item).map((gap) => gap.code)

test('reports a change with no Superpowers counterpart', () => {
  assert.deepEqual(codes({ openspec: openspec(), superpowers: null }), ['openspec-only'])
})

test('reports Superpowers work with no change', () => {
  assert.deepEqual(codes({ openspec: null, superpowers: superpowers() }), ['superpowers-only'])
})

test('reports drift only when both sides have started and differ by more than 0.30', () => {
  assert.ok(
    codes({
      openspec: openspec({ tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 1, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 2, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 2, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
  assert.ok(
    !codes({
      openspec: openspec({ tasksDone: 0, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 0, planInProgress: 0, planTotal: 4 })
    }).includes('progress-drift')
  )
})

test('reports a change with tasks but no design', () => {
  assert.ok(
    codes({ openspec: openspec({ hasDesign: false }), superpowers: superpowers() }).includes(
      'no-design'
    )
  )
})

test('reports a fully ticked change that was never archived', () => {
  assert.ok(
    codes({
      openspec: openspec({ tasksDone: 4, tasksInProgress: 0, tasksTotal: 4 }),
      superpowers: superpowers({ planDone: 4, planInProgress: 0, planTotal: 4 })
    }).includes('tasks-complete-not-archived')
  )
})

test('reports an archived change whose capability never reached specs', () => {
  assert.ok(
    codes({
      openspec: openspec({ stage: 'archived', capabilities: ['x'] }),
      superpowers: null,
      existingSpecCapabilities: []
    }).includes('archived-spec-stale')
  )
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both modules**

`normalizeTopic` strips a leading `YYYY-MM-DD-`, a trailing `-design`, an `.md` suffix, lowercases, and collapses runs of non-alphanumerics to `-`.

`topicSimilarity` is the Jaccard index over kebab tokens; two empty token sets score 0.

`correlate` sorts candidate pairs by (exact match first, then similarity), keeps the best above a 0.6 floor, and marks both sides used — that is what makes a shared topic pair one-to-one instead of one plan satisfying two changes.

`detectGaps` implements the spec's §4.8 table, including the `> 0.30` drift threshold and the rule that drift is only reported when both sides have started.

A **finished** work item — the OpenSpec change is archived, or the Superpowers plan is `done` —
reports only `archived-spec-stale`. The other gaps describe work in flight, and nagging about a
change that already shipped is noise that dilutes the signal.

`existingSpecCapabilities` is the list of capability directories that exist under the project's
`openspec/specs/`. It is optional, and **absent means unknown**, not "every archived capability is
stale": with no list, `archived-spec-stale` is not reported at all.

- [ ] **Step 4: Run them to verify they pass**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): correlate the two frameworks and detect gaps"
```

---

### Task 5: Local project scan

**Files:**

- Create: `src/local-scan.ts`
- Test: `src/local-scan.test.ts`

**Interfaces:**

- Consumes: `countCheckboxes` (Task 3), `normalizeTopic` (Task 4), `SnapshotProject`/`SnapshotItem` (Task 2).
- Produces:

  ```ts
  export type ScanProjectResult = {
    project: SnapshotProject
    items: SnapshotItem[]
    warnings: string[]
  }
  export async function scanProject(input: {
    name: string
    host: string
    path: string
  }): Promise<ScanProjectResult>
  export function projectIdFor(host: string, path: string): string
  ```

- [ ] **Step 1: Write the failing test**

`src/local-scan.test.ts`. Build the fixture with `node:fs/promises` in `os.tmpdir()` and remove it in `afterEach`.

```ts
import { afterEach, assert, test } from 'orca/testing'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectIdFor, scanProject } from './local-scan'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-'))
  roots.push(root)
  await mkdir(join(root, 'openspec/changes/add-x/specs/x'), { recursive: true })
  await writeFile(join(root, 'openspec/changes/add-x/proposal.md'), '# Change: Add X\n')
  await writeFile(join(root, 'openspec/changes/add-x/design.md'), '## Context\n')
  await writeFile(
    join(root, 'openspec/changes/add-x/tasks.md'),
    '- [x] one\n- [ ] two\n- [ ] three\n- [ ] four\n'
  )
  await writeFile(join(root, 'openspec/changes/add-x/specs/x/spec.md'), '## ADDED Requirements\n')
  await mkdir(join(root, 'openspec/specs/x'), { recursive: true })
  await writeFile(join(root, 'openspec/specs/x/spec.md'), '## Requirements\n')
  await mkdir(join(root, 'docs/superpowers/specs'), { recursive: true })
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true })
  await writeFile(join(root, 'docs/superpowers/specs/2026-11-20-add-x-design.md'), '# Design\n')
  await writeFile(
    join(root, 'docs/superpowers/plans/2026-11-20-add-x.md'),
    '- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n- [ ] f\n- [ ] g\n- [ ] h\n'
  )
  return root
}

test('reads a change, its task progress and its matching plan', async () => {
  const root = await fixture()
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.project.openspec?.present, true)
  assert.equal(result.project.openspec?.activeChanges, 1)
  assert.equal(result.project.superpowers?.specs, 1)
  assert.equal(result.items.length, 1)
  const item = result.items[0]!
  assert.equal(item.openspec?.changeId, 'add-x')
  assert.equal(item.openspec?.tasksDone, 1)
  assert.equal(item.openspec?.tasksTotal, 4)
  assert.equal(item.openspec?.hasDesign, true)
  assert.equal(item.superpowers?.plan, 'docs/superpowers/plans/2026-11-20-add-x.md')
  assert.equal(item.superpowers?.planDone, 1)
  assert.equal(item.superpowers?.planTotal, 8)
  assert.deepEqual(result.warnings, [])
})

test('reports a project with neither directory as absent without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-empty-'))
  roots.push(root)
  const result = await scanProject({ name: 'empty', host: 'local', path: root })
  assert.equal(result.project.openspec, null)
  assert.equal(result.project.superpowers, null)
  assert.deepEqual(result.items, [])
})

test('counts archived changes separately and does not list them as active', async () => {
  const root = await fixture()
  await mkdir(join(root, 'openspec/changes/archive/2026-11-01-old'), { recursive: true })
  const result = await scanProject({ name: 'demo', host: 'local', path: root })
  assert.equal(result.project.openspec?.archived, 1)
  assert.equal(result.project.openspec?.activeChanges, 1)
  assert.equal(result.items.filter((item) => item.openspec !== null).length, 1)
})

test('builds a stable project id from host and path', () => {
  assert.equal(projectIdFor('local', '/a/b'), 'local|/a/b')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `local-scan.ts`**

Read with `node:fs/promises`. `openspec` is present when `openspec/changes` or `openspec/specs` exists. Active changes are directories under `openspec/changes/` other than `archive`; archived ones are directories under `openspec/changes/archive/`. Capabilities are directory names under `openspec/specs/`. Superpowers artifacts are `.md` files under `docs/superpowers/specs/` and `docs/superpowers/plans/`, matched by topic.

Every artifact becomes one item, keyed by `projectIdFor(host, path) + '#' + topic`, with
`openspec`/`superpowers` filled from whichever side exists. The progress triples come straight
from `countCheckboxes`: `tasksDone` / `tasksInProgress` / `tasksTotal` for the OpenSpec side and
`planDone` / `planInProgress` / `planTotal` for the Superpowers side. A change and its plan therefore land on one item. Unmatched Superpowers artifacts become items with `openspec: null`.

An unreadable path returns a project with `error` set and no items — it must never throw, because one bad registry entry must not blank the whole board.

- [ ] **Step 4: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): scan a local project for both frameworks"
```

---

### Task 6: Action derivation

**Files:**

- Create: `src/actions.ts`
- Test: `src/actions.test.ts`

**Interfaces:**

- Consumes: `SnapshotItem`, `Action`, `ActionRun` (Task 2).
- Produces:

  ```ts
  export function actionsForItem(
    item: {
      openspec: OpenspecFacts | null
      superpowers: SuperpowersFacts | null
    },
    cliAvailable: boolean
  ): Action[]
  export function frameworkActions(cliAvailable: boolean): {
    openspec: Action[]
    superpowers: Action[]
  }
  export function findAction(actions: readonly Action[], actionId: string): Action | null
  ```

- [ ] **Step 1: Write the failing test**

`src/actions.test.ts`:

```ts
import { assert, test } from 'orca/testing'
import { actionsForItem, findAction, frameworkActions } from './actions'

const item = {
  openspec: {
    changeId: 'add-x',
    stage: 'implementing' as const,
    hasProposal: true,
    hasDesign: true,
    hasTasks: true,
    tasksDone: 1,
    tasksInProgress: 0,
    tasksTotal: 2,
    capabilities: []
  },
  superpowers: {
    designSpec: 'docs/superpowers/specs/x-design.md',
    plan: 'docs/superpowers/plans/x.md',
    stage: 'executing' as const,
    planDone: 1,
    planInProgress: 0,
    planTotal: 2
  }
}

test('runs OpenSpec commands in a terminal when the CLI is there', () => {
  const actions = actionsForItem(item, true)
  const validate = findAction(actions, 'openspec.validate')!
  assert.deepEqual(validate.run, { kind: 'terminal', command: 'openspec validate add-x --strict' })
  assert.equal(validate.mutates, false)
  assert.equal(findAction(actions, 'openspec.archive')?.mutates, true)
})

test('falls back to the agent form when the host has no CLI', () => {
  const actions = actionsForItem(item, false)
  for (const action of actions.filter((a) => a.framework === 'openspec')) {
    assert.equal(action.run.kind, 'agent', action.id)
    assert.match((action.run as { prompt: string }).prompt, /openspec\/AGENTS\.md/)
  }
})

test('Superpowers actions are always dispatched to an agent', () => {
  const actions = actionsForItem(item, true)
  const plan = findAction(actions, 'superpowers.plan')!
  assert.equal(plan.run.kind, 'agent')
  assert.match((plan.run as { prompt: string }).prompt, /superpowers:writing-plans/)
  assert.equal(plan.mutates, true)
})

test('omits OpenSpec actions for an item with no change', () => {
  const actions = actionsForItem({ openspec: null, superpowers: item.superpowers }, true)
  assert.equal(actions.filter((a) => a.framework === 'openspec').length, 0)
  assert.ok(actions.length > 0)
})

test('the framework palette lists both frameworks', () => {
  const palette = frameworkActions(false)
  assert.ok(palette.openspec.length >= 4)
  assert.ok(palette.superpowers.length >= 5)
  assert.ok(palette.openspec.every((action) => action.run.kind === 'agent'))
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `actions.ts`**

Action ids are fixed strings: `openspec.list`, `openspec.validate`, `openspec.show`, `openspec.archive`, `openspec.propose`, `superpowers.brainstorm`, `superpowers.plan`, `superpowers.execute`, `superpowers.review`, `superpowers.verify`.

Only `openspec.archive`, `openspec.propose`, `superpowers.brainstorm`, `superpowers.plan`, `superpowers.execute` are `mutates: true`. The command strings are exactly the ones in the spec's §4.11 tables. The agent fallback prompt names `openspec/AGENTS.md` and the change id.

- [ ] **Step 4: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): derive executable actions for both frameworks"
```

---

### Task 7: Worker — merge, refresh, run actions

**Files:**

- Create: `src/store-paths.ts`
- Create: `src/refresh-prompt.ts`
- Create: `src/workspace-match.ts`
- Test: `src/workspace-match.test.ts`
- Replace: `src/protocol.ts`
- Replace: `src/worker.ts`
- Replace: `src/worker.test.ts`

**Interfaces:**

- Consumes: `parseBoardSnapshot` (Task 2), `deriveStage` (Task 3), `correlate`/`detectGaps` (Task 4), `scanProject`/`projectIdFor` (Task 5), `actionsForItem`/`findAction` (Task 6).
- Produces:
  ```ts
  // store-paths.ts
  export function boardStoreDir(): string
  export function snapshotPath(): string
  export function registryPath(): string
  export function refreshPromptPath(): string
  export type Registry = { schemaVersion: 1; projects: ProjectRef[] }
  export async function readRegistry(): Promise<{
    registry: Registry | null
    warning: string | null
  }>
  export async function writeRegistryIfAbsent(projects: readonly ProjectRef[]): Promise<void>

  // refresh-prompt.ts
  export function buildRefreshPrompt(input: { registryPath: string; snapshotPath: string }): string

  // workspace-match.ts
  export type WorkspaceRow = { id: string; path: string; hostId: string | null }
  export type WorkspaceListRow = WorkspaceRow & { projectId?: string | null }
  export function normalizePath(path: string): string
  export function findWorkspaceId(
    rows: readonly WorkspaceRow[],
    project: { path: string; host: string }
  ): string | null
  export function projectRefsFromWorkspaces(rows: readonly WorkspaceListRow[]): ProjectRef[]
  ```
- `src/protocol.ts` declares:

  ```ts
  export {}
  declare module 'orca' {
    interface PluginRequests {
      'board.get': { output: BoardPayload }
      'board.refresh': { output: { terminalId: string } }
      'action.run': {
        input: { projectId: string; actionId: string }
        output: { kind: 'terminal' | 'agent'; terminalId: string }
      }
    }
    interface PluginPanelEvents {
      'board.changed': { agentAt: number | null }
    }
  }
  ```

- [ ] **Step 1: Write the failing tests**

`src/workspace-match.test.ts` — this is Review Focus 3: a registry path written by hand must still match the row Orca reports.

```ts
import { assert, test } from 'orca/testing'
import { findWorkspaceId, normalizePath } from './workspace-match'

const rows = [
  { id: 'w1', path: '/Users/me/repo', hostId: 'local' },
  { id: 'w2', path: 'C:/work/remote', hostId: 'ssh:yolo' }
]

test('normalizes separators and case for Windows-style paths', () => {
  assert.equal(normalizePath('C:\\Work\\Remote\\'), 'c:/work/remote')
  assert.equal(normalizePath('/Users/me/repo/'), '/users/me/repo')
})

test('matches a hand-written registry path against the reported row', () => {
  assert.equal(findWorkspaceId(rows, { path: 'c:\\work\\remote', host: 'ssh:yolo' }), 'w2')
})

test('never falls back to a different workspace', () => {
  assert.equal(findWorkspaceId(rows, { path: 'C:/work/other', host: 'ssh:yolo' }), null)
})

test('collapses the worktrees of one project into a single entry', () => {
  const refs = projectRefsFromWorkspaces([
    { id: 'a', path: '/repo', hostId: 'local', projectId: 'p1' },
    { id: 'b', path: '/repo/.orca/worktrees/feat-x', hostId: 'local', projectId: 'p1' },
    { id: 'c', path: '/other', hostId: 'local', projectId: 'p2' },
    { id: 'd', path: 'C:/remote', hostId: 'ssh:yolo', projectId: 'p3' }
  ])
  assert.deepEqual(
    refs.map((ref) => ref.path),
    ['/repo', '/other']
  )
})
```

`src/worker.test.ts`. Point `SPEC_BOARD_HOME` at a temp dir and stub the host with `requests`/`results`.

```ts
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  delete process.env.SPEC_BOARD_HOME
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spec-board-home-'))
  roots.push(root)
  process.env.SPEC_BOARD_HOME = root
  return root
}

const workspaces = {
  workspaces: [
    {
      id: 'w1',
      kind: 'worktree',
      name: 'demo',
      project: 'demo',
      projectId: 'p1',
      path: '/repo/demo',
      branch: 'main',
      hostId: 'local'
    },
    {
      id: 'w2',
      kind: 'worktree',
      name: 'remote',
      project: 'remote',
      projectId: 'p2',
      path: 'C:/work/remote',
      branch: 'main',
      hostId: 'ssh:yolo'
    }
  ],
  truncated: false
}

test('merges the agent snapshot over the local scan', async () => {
  const root = await home()
  await writeFile(
    join(root, 'board.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-11-25T10:00:00.000Z',
      generatedBy: { agent: 'claude' },
      projects: [
        {
          id: 'ssh:yolo|C:/work/remote',
          name: 'remote',
          host: 'ssh:yolo',
          path: 'C:/work/remote',
          openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
          superpowers: null,
          openspecCli: { available: true, version: '1.8.0' },
          scannedAt: '2026-11-25T10:00:00.000Z'
        }
      ],
      items: [
        {
          id: 'ssh:yolo|C:/work/remote#add-y',
          projectId: 'ssh:yolo|C:/work/remote',
          title: 'Add Y',
          topic: 'add-y',
          openspec: {
            changeId: 'add-y',
            stage: 'implementing',
            hasProposal: true,
            hasDesign: true,
            hasTasks: true,
            tasksDone: 1,
            tasksInProgress: 0,
            tasksTotal: 4,
            capabilities: []
          },
          superpowers: null
        }
      ]
    })
  )
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.equal(
    payload.projects.some((p) => p.id === 'ssh:yolo|C:/work/remote'),
    true
  )
  const remote = payload.items.find((i) => i.projectId === 'ssh:yolo|C:/work/remote')!
  assert.equal(remote.stage, 'implement')
  assert.equal(remote.gaps[0]?.code, 'openspec-only')
  assert.ok(remote.actions.length > 0)
  assert.equal(payload.sources.agentAt !== null, true)
  await worker.deactivate()
})

test('reports a broken snapshot without losing the local scan', async () => {
  const root = await home()
  await writeFile(join(root, 'board.json'), '{ not json')
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  const payload = await worker.request('board.get')
  assert.ok(payload.warnings.some((w) => w.includes('board.json')))
  assert.equal(payload.sources.agentAt, null)
  await worker.deactivate()
})

test('runs a terminal action on the workspace that owns the project', async () => {
  const root = await home()
  // The local scan finds nothing on a fake path, so the item under test comes from the snapshot.
  await writeFile(
    join(root, 'board.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-11-25T10:00:00.000Z',
      generatedBy: { agent: 'claude' },
      projects: [
        {
          id: 'local|/repo/demo',
          name: 'demo',
          host: 'local',
          path: '/repo/demo',
          openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
          superpowers: null,
          openspecCli: { available: true },
          scannedAt: '2026-11-25T10:00:00.000Z'
        }
      ],
      items: [
        {
          id: 'local|/repo/demo#add-x',
          projectId: 'local|/repo/demo',
          title: 'Add X',
          topic: 'add-x',
          openspec: {
            changeId: 'add-x',
            stage: 'implementing',
            hasProposal: true,
            hasDesign: true,
            hasTasks: true,
            tasksDone: 1,
            tasksInProgress: 0,
            tasksTotal: 4,
            capabilities: []
          },
          superpowers: null
        }
      ]
    })
  )
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'terminal.create': { terminalId: 't1' },
      'terminal.focus': { focused: true }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  const result = await worker.request('action.run', {
    projectId: 'local|/repo/demo',
    actionId: 'openspec.validate'
  })
  assert.deepEqual(result, { kind: 'terminal', terminalId: 't1' })
  const created = host.callsOf('terminal.create')[0]!.params as {
    workspaceId: string
    command: string
  }
  assert.equal(created.workspaceId, 'w1')
  assert.equal(created.command, 'openspec validate add-x --strict')
  await worker.deactivate()
})

test('refuses an action for a project with no matching workspace', async () => {
  await home()
  const host = mockHost({ results: { 'workspace.list': workspaces } })
  const worker = await mountWorker(main, { host })
  await worker.request('board.get')
  await assert.rejects(
    worker.request('action.run', { projectId: 'local|/nowhere', actionId: 'openspec.validate' }),
    /workspace/
  )
  assert.deepEqual(host.callsOf('terminal.create'), [])
  await worker.deactivate()
})

test('refresh writes the prompt it will send and launches the agent', async () => {
  const root = await home()
  const host = mockHost({
    results: {
      'workspace.list': workspaces,
      'workspace.readContext': {
        workspaceId: 'w1',
        branch: 'main',
        displayName: 'demo',
        terminals: []
      },
      'agent.launch': { terminalId: 't9' }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('board.refresh')
  const launched = host.callsOf('agent.launch')[0]!.params as {
    workspaceId: string
    agent: string
    prompt: string
  }
  assert.equal(launched.workspaceId, 'w1')
  assert.equal(launched.agent, 'claude')
  assert.ok(launched.prompt.includes(join(root, 'board.json')))
  const written = await readFile(join(root, 'last-refresh-prompt.md'), 'utf8')
  assert.equal(written, launched.prompt)
  await worker.deactivate()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — `board.get` is not handled (`unknown_method`).

- [ ] **Step 3: Grant the capabilities the worker actually calls**

In `orca-plugin.json`, replace the `capabilities` array with exactly the kinds this worker's
code calls, and add the settings contribution the worker reads:

```json
"capabilities": [
  { "kind": "workspace:read" },
  { "kind": "agent:launch" },
  { "kind": "terminal:send" },
  { "kind": "workspace:write" },
  { "kind": "settings:own" }
]
```

`storage:own` goes away: the finished worker keeps its snapshot in `~/.orca/spec-board/`, not
in plugin storage. Add to `contributes`:

```json
"settings": [
  { "key": "refreshAgent", "title": "刷新用的 agent", "type": "string", "default": "claude" },
  { "key": "refreshWorkspace", "title": "刷新在哪个 workspace 运行", "type": "string", "default": "" },
  { "key": "scanRoots", "title": "额外扫描的本地根目录（每行一个绝对路径）", "type": "string", "multiline": true, "default": "" }
]
```

Then run `orca plugin validate <dir> --json` and confirm `errors` is empty. Every kind listed
must be called by the worker in this same commit — a declared-but-unused capability is a
finding, not a harmless extra.

- [ ] **Step 4: Implement `store-paths.ts`, `refresh-prompt.ts`, `protocol.ts`, `worker.ts`**

`boardStoreDir()` returns `process.env.SPEC_BOARD_HOME ?? join(homedir(), '.orca', 'spec-board')`.

The worker's `board.get` handler:

1. Reads the registry; a malformed file yields a warning and a `null` registry, never a throw.
2. With no registry, calls `workspace.list` and derives `ProjectRef[]` through `projectRefsFromWorkspaces`, which keeps rows whose `hostId` is `local` or `null` and the shortest path per `projectId` — otherwise every agent worktree of a repo becomes a separate project on the board. It then writes the result once with `writeRegistryIfAbsent`.
3. Scans every local project (registry entries with `host === 'local'` plus `scanRoots` lines) with `scanProject`, in series.
4. Reads and parses `board.json`; a parse failure becomes a warning naming the file.
5. Merges by `projectId`, agent snapshot winning; then computes `stage`, `gaps` and `actions` per item.
6. Sets `openspecCli.available` for local projects by running `openspec --version` in a `node:child_process` `execFile` with a 3 s timeout; a missing binary is `available: false`.

The worker also watches the store directory with `node:fs` `watch` and posts `board.changed` with the new `agentAt`.

`action.run` resolves the project, then the workspace by normalized absolute path (forward slashes, lower-cased on Windows-style paths), and rejects with a message containing "workspace" when nothing matches. A `terminal` run calls `terminal.create` then `terminal.focus`; an `agent` run calls `agent.launch`.

`board.refresh` resolves the workspace from the `refreshWorkspace` setting, else `workspace.readContext`, writes the prompt to `last-refresh-prompt.md`, then calls `agent.launch`.

The prompt must state the snapshot schema **exactly as the validator enforces it**, because a
mismatch shows the user a broken-snapshot card instead of a board: the `stage` enum spellings, that
`id`/`name`/`host`/`path`/`title`/`topic` are non-empty strings, that counts are non-negative
integers, that **every progress count is written explicitly** — `tasksDone`, `tasksInProgress`,
`tasksTotal`, `planDone`, `planInProgress`, `planTotal`, where an in-progress count of `0` is a
valid value and omitting the field is not — that `done + inProgress <= total` on both sides, and
that optional fields
(`error`, `summary`, `nextAction`, `openspecCli.version`,
`openspecCli.path`, `generatedBy.workspace`, `generatedBy.host`, `notes`) are **omitted** rather
than written as `null`. The validator reads `null` as absent either way; omitting is what the prompt
should ask for.

- [ ] **Step 5: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS — 4 workspace-match tests, 5 worker tests, plus the earlier tasks' tests.

- [ ] **Step 6: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): merge the snapshot, refresh it and run actions"
```

---

### Task 8: Panel shell and the board tab

**Files:**

- Replace: `src/panel.tsx`
- Replace: `src/panel.test.tsx`
- Create: `src/panel.check.ts`

**Interfaces:**

- Consumes: `plugin.request('board.get')`, `plugin.on('board.changed')`, `plugin.request('action.run')`.
- Produces: the default-exported `Panel` component and `setup(ctx)`.

- [ ] **Step 1: Write the failing test**

`src/panel.test.tsx`:

```tsx
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const item = {
  id: 'local|/repo#add-x',
  projectId: 'local|/repo',
  title: 'Add X',
  topic: 'add-x',
  stage: 'implement',
  gaps: [
    {
      code: 'openspec-only',
      severity: 'warning',
      message: '有 OpenSpec 变更，没有对应的 Superpowers 设计'
    }
  ],
  openspec: {
    changeId: 'add-x',
    stage: 'implementing',
    hasProposal: true,
    hasDesign: true,
    hasTasks: true,
    tasksDone: 2,
    tasksInProgress: 0,
    tasksTotal: 5,
    capabilities: []
  },
  superpowers: null,
  actions: [
    {
      id: 'openspec.validate',
      label: '校验',
      framework: 'openspec',
      run: { kind: 'terminal', command: 'openspec validate add-x --strict' },
      mutates: false
    },
    {
      id: 'openspec.archive',
      label: '归档',
      framework: 'openspec',
      run: { kind: 'terminal', command: 'openspec archive add-x --yes' },
      mutates: true
    }
  ]
}
const payload = {
  items: [item],
  projects: [
    {
      id: 'local|/repo',
      name: 'repo',
      host: 'local',
      path: '/repo',
      openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
      superpowers: null,
      openspecCli: { available: true },
      scannedAt: '2026-11-25T10:00:00.000Z'
    }
  ],
  sources: { localAt: Date.now(), agentAt: null },
  warnings: []
}

test('draws the change, both progress lanes and its gaps', async () => {
  const host = mockHost({ requests: { 'board.get': () => payload } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Add X' }))
  assert.ok(view.find({ text: 'OpenSpec 2/5' }))
  assert.ok(view.find({ text: '有 OpenSpec 变更，没有对应的 Superpowers 设计' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('runs a non-mutating action on the first press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => payload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't1' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '校验' })
  assert.deepEqual(calls, [{ projectId: 'local|/repo', actionId: 'openspec.validate' }])
  await view.unmount()
})

test('holds a mutating action until a second press', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'board.get': () => payload,
      'action.run': (input) => {
        calls.push(input)
        return { kind: 'terminal', terminalId: 't2' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: '归档' })
  assert.deepEqual(calls, [])
  await view.press({ text: '确认执行？' })
  assert.deepEqual(calls, [{ projectId: 'local|/repo', actionId: 'openspec.archive' }])
  await view.unmount()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — the panel draws the template's counter.

- [ ] **Step 3: Implement the panel shell and board tab**

Atoms: `payload`, `tab` (`'board' | 'map' | 'projects'`), `stage`, `error`, `busy`, `pendingAction`.

The `Tabs` control takes the required `label` prop, set to `看板视图` — tests and screen readers find it by that label, and it is the only stable handle on a control whose children are tabs.

`setup` subscribes to `board.changed` and requests `board.get` once; a rejected request sets `error` to the host error's `code` and message.

Board tab:

- A `Row` of six stage `Button`s with counts; the selected one uses `variant="solid"`, the rest `variant="ghost"`.
- A `Stack` of `Card`s for the selected stage. The item title is rendered as a `<Text>` **child** of the card (not only as the `Card` `title` prop) and the project line as a `<Text>` child too — the test kit's query matcher compares against an element's rendered `text`, so a value that lives only in a prop is not findable.
- Inside each card: a `Row` with two `Progress` — each preceded by a `<Text>` caption reading `OpenSpec 2/5` and `Superpowers 1/8`. The captions are `<Text>` elements for the same reason the title is. `Progress.value` is a **percentage from 0 to 100** (Orca's Progress wraps Radix's, whose indicator translates `100 - value` percent — not a 0-to-1 fraction), and the `Progress` is omitted when that side is null.
- A `Row` of `Badge`s, one per gap, `tone` from severity (`info` → neutral, `warning` → warning, `error` → danger`). The badge text is the gap's `message`.
- A `Row` of action `Button`s. A `mutates` action needs two presses within 3 s: the first sets `pendingAction`, the second calls `action.run`. The label changes to `确认执行？` while pending.
- When the selected stage is empty, an `EmptyState`.

`src/panel.check.ts`:

```ts
import { defineCheck } from 'orca/testing'
import { fixturePayload } from './panel.fixture'

export default defineCheck({
  empty: {
    requests: {
      'board.get': () => ({
        items: [],
        projects: [],
        sources: { localAt: null, agentAt: null },
        warnings: []
      })
    }
  },
  loaded: { requests: { 'board.get': () => fixturePayload } },
  broken: {
    requests: {
      'board.get': () => ({
        items: [],
        projects: [],
        sources: { localAt: null, agentAt: null },
        warnings: ['board.json: schemaVersion: 期望 1']
      })
    }
  }
})
```

Export the fixture payload from `src/panel.fixture.ts` so the test and `panel.check.ts` share it.

- [ ] **Step 4: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json` then `orca plugin check resources/plugins/launch/stablyai.spec-board --json`
Expected: tests PASS; check renders three scenarios with no issues.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): draw the stage rail, cards and gap badges"
```

---

### Task 9: The 全貌 tab as a command palette

**Files:**

- Modify: `src/panel.tsx`
- Modify: `src/panel.test.tsx`

**Interfaces:**

- Consumes: `OPENSPEC_STAGES`, `SUPERPOWERS_FLOW`, `CORRESPONDENCE` (Task 1); `frameworkActions` (Task 6).

- [ ] **Step 1: Write the failing test**

Add to `src/panel.test.tsx`:

```tsx
test('the map tab shows both frameworks and a project picker', async () => {
  const host = mockHost({ requests: { 'board.get': () => payload } })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'map')
  assert.ok(view.summary().includes('OpenSpec'))
  assert.ok(view.summary().includes('Superpowers'))
  assert.ok(view.find({ type: 'Select' }))
  await view.unmount()
})

test('the palette only offers commands allowed for the chosen project', async () => {
  const host = mockHost({ requests: { 'board.get': () => payload } })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'map')
  assert.ok(view.find({ text: /openspec validate/ }))
  await view.unmount()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — there is no `map` tab.

- [ ] **Step 3: Implement the map tab**

A project `Select` at the top (options from `payload.projects`). Below it, two `Card`s — OpenSpec and Superpowers — each a vertical list of stages/steps with `Badge`s for artifacts and a `Button` per command. Command buttons call the same `action.run` path as the board, with the selected project.

The correspondence rows render as a `KeyValue` under the two cards. Below them, the
`OPENSPEC_DECISION_TREE` renders as a list of `Card`s, one per rule, with the situation as the
title and the action as the description — it answers "do I need a proposal for this at all?".

The command buttons substitute a concrete change id into the map's `<change-id>` placeholder
before running; a command whose id is still a placeholder is disabled with the label
`先选一个变更`.

When nothing is loaded yet the tab still renders the static map — it must never depend on a scan.

- [ ] **Step 4: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): make the framework map a command palette"
```

---

### Task 10: Projects tab, refresh, and error cards

**Files:**

- Modify: `src/panel.tsx`
- Modify: `src/panel.test.tsx`

**Interfaces:**

- Consumes: `plugin.request('board.refresh')`; `sources`, `warnings`, `projects` from the payload.

- [ ] **Step 1: Write the failing test**

Add to `src/panel.test.tsx`:

```tsx
test('shows a warning card for a broken snapshot but keeps the map', async () => {
  const broken = {
    items: [],
    projects: [],
    sources: { localAt: null, agentAt: null },
    warnings: ['board.json: schemaVersion: 期望 1']
  }
  const host = mockHost({ requests: { 'board.get': () => broken } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ role: 'alert' }))
  await view.select({ label: '看板视图' }, 'map')
  assert.ok(view.summary().includes('OpenSpec'))
  await view.unmount()
})

test('refresh dispatches the worker and disables the button while busy', async () => {
  let resolve!: (value: { terminalId: string }) => void
  const host = mockHost({
    requests: {
      'board.get': () => payload,
      'board.refresh': () =>
        new Promise((r) => {
          resolve = r as typeof resolve
        })
    }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  await view.press({ text: /刷新/ })
  assert.ok(view.find({ text: /刷新中/ }))
  resolve({ terminalId: 't1' })
  await view.settled()
  await view.unmount()
})

test('renders an unknown snapshot time instead of throwing', async () => {
  const host = mockHost({
    requests: { 'board.get': () => ({ ...payload, sources: { localAt: null, agentAt: null } }) }
  })
  const view = await mount(panel, { host })
  await view.select({ label: '看板视图' }, 'projects')
  assert.ok(view.find({ text: /未知|尚未/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json`
Expected: FAIL — no projects tab.

- [ ] **Step 3: Implement**

Projects tab: one `Card` per project showing name, host, openspec/superpowers presence, `openspecCli` availability, and `RelativeTime` for `scannedAt` — or the literal `尚未扫描` when `scannedAt` is empty. A `Button` labelled `刷新` calls `board.refresh`; while the request is in flight the label becomes `刷新中…` and the button is disabled.

Warnings render as a `Callout` with `tone="warning"` and `icon="warning"` above the tab content, so a broken snapshot is visible from every tab. A `Callout` with `tone="danger"` replaces it when `sources.localAt === null` and `warnings` is non-empty.

- [ ] **Step 4: Run it to verify it passes**

Run: `orca plugin test resources/plugins/launch/stablyai.spec-board --json` then `orca plugin check resources/plugins/launch/stablyai.spec-board --json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/plugins/launch/stablyai.spec-board/src
git commit -m "feat(spec-board): add the projects tab, refresh and error cards"
```

---

### Task 11: Bundle the plugin into the app

**Files:**

- Modify: `resources/plugins/launch/bundled-plugins.json`
- Create: `config/scripts/plugin-authoring/content-validation/update-bundled-plugin-index.mjs` **or** reuse the existing hash helper if one exists (check `config/scripts/desktop-distribution/runtime-verification/verify-packaged-plugin-resources.cjs` for `hashPackagedPluginTree` and import it)

**Interfaces:**

- Produces: a `bundled-plugins.json` entry

  ```json
  { "pluginKey": "stablyai.spec-board", "path": "stablyai.spec-board", "contentHash": "<64 hex>" }
  ```

- [ ] **Step 1: Compute the hash with the same function the verifier uses**

Run: `node -e "const { hashPackagedPluginTree } = require('./config/scripts/desktop-distribution/runtime-verification/verify-packaged-plugin-resources.cjs'); console.log(hashPackagedPluginTree('resources/plugins/launch/stablyai.spec-board'))"`
Expected: a 64-character hex string. If the function is not exported, extract it into a shared module first and re-point the verifier at it — do not reimplement the hash.

- [ ] **Step 2: Add the index entry**

Append the entry to `resources/plugins/launch/bundled-plugins.json`, keeping `version: 1`.

- [ ] **Step 3: Verify packaging accepts it**

Run:

```bash
node -e "const {verifyPackagedPluginResources}=require('./config/scripts/desktop-distribution/runtime-verification/verify-packaged-plugin-resources.cjs'); verifyPackagedPluginResources('resources')"
```

Expected: `OK — verified 3 bundled plugin(s)`. The script has no CLI of its own — it is a module the electron-builder config calls — so drive it from `node -e` rather than trying to run the file directly.

- [ ] **Step 4: Commit**

```bash
git add resources/plugins/launch/bundled-plugins.json
git commit -m "feat(spec-board): bundle the board as a built-in plugin"
```

---

### Task 12: Packaged end-to-end verification

**Files:** none — this task verifies the shipped build.

- [ ] **Step 1: Run the repo gates**

```bash
pnpm check:changed
```

Expected: passes. If `resources/` is untouched by any gate, note that in the commit message rather than assuming coverage.

- [ ] **Step 2: Package and install**

Follow `CLAUDE.md` §Local development workflow: the asset builds, then the arm64 electron-builder run, then `mac-app-install.mjs`, then the packaged smoke test.

- [ ] **Step 3: Verify the five acceptance points from the spec**

1. 右侧边栏出现「规格看板」，图标 `layers`。
2. 首次打开、没有任何配置文件时：看板 Tab 列出本仓库的工作项，全貌 Tab 完整可读。
3. 点「刷新」→ agent 启动、写出 `board.json`、面板自动更新，远程 `yolocalc` 项目出现在项目 Tab。
4. 人为写坏 `board.json` → 错误卡出现，全貌 Tab 仍可用。
5. 在远程项目卡片上点「校验」→ 该主机终端打开并输出 `openspec validate` 结果。

- [ ] **Step 4: Push and commit the result**

```bash
git -c http.version=HTTP/1.1 push origin main
```

---

## Self-Review Notes

- **Spec coverage:** §4.1–4.4 → Tasks 1, 2, 7; §4.5–4.8 → Tasks 2, 3, 4; §4.9 → Task 1; §4.10 → Tasks 8, 9, 10; §4.11 → Tasks 6, 7, 9; §5 → Task 7; §6 → Tasks 2, 7, 10; §8 → every task's tests plus Task 12; §4.1 bundling → Task 11.
- **Two files beyond the spec's §4.1 tree:** `workspace-match.ts` (path normalization, worktree collapsing and workspace lookup — split out so Review Focus 3 is unit-testable instead of buried in the worker) and `panel.fixture.ts` (the test and `panel.check.ts` share one payload). Both were added back to the spec's tree.
- **Deliberate omission:** no unit test for the `fs.watch` wiring; it is covered by Task 12's acceptance point 3 instead, because a watch test in Node would only prove Node's watcher works.
- **Pre-flight fixes applied to this plan before Task 1** (both found by reading the test kit's matcher and the worker test's own data flow): the board card's title and progress captions are rendered as `<Text>` children so they are findable by text, and Task 7's terminal-action test seeds `board.json` because the local scan cannot find anything on a fake path.
