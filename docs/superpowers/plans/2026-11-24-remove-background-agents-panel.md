# Remove the Background Agents Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the "Background agents" entry from Orca's right-sidebar activity bar and remove the code that exists only to serve that panel, while keeping the `claude agents --json` listing that AI Vault's session-resume flow depends on.

**Architecture:** The panel and AI Vault share exactly two modules — `src/shared/claude-background-agents.ts` (the roster type) and `src/main/claude/background-agents/claude-background-agent-list.ts` (the CLI wrapper). Everything else the panel touches is deletable. The removal proceeds in dependency order: delete the leaves first (renderer panel, IPC surface, preload surface), then trim the two shared modules down to what AI Vault still calls, then drop the tab id from the four places it is represented, then the strings and docs.

**Tech Stack:** Electron + React + TypeScript, Zustand (renderer store), zod (RPC param schemas), Vitest under Bun.

**Spec:** `docs/superpowers/specs/2026-11-24-remove-background-agents-panel-design.md` — read it before starting; it carries the dependency map and the reasoning behind each keep/delete verdict.

## Global Constraints

- **The AI Vault running-agents path must keep working end to end.** Its chain is: `src/renderer/src/lib/agent-session/resume/history/claude-running-agent.ts` → `window.api.aiVault.listRunningAgents` → `src/preload/api/ai-vault-bridge.ts` → IPC `aiVault:listRunningAgents` → `src/main/ipc/ai-vault/ai-vault-resume.ts` → `listRunningAgentsForHost` → `listClaudeBackgroundAgents` (in `src/main/claude/background-agents/claude-background-agent-list.ts`). Also the runtime RPC method `aiVault.listRunningAgents` in `src/main/runtime/rpc/methods/history/ai-vault.ts`, which a paired runtime host calls back on the desktop. **None of these may be deleted or renamed.**
- **Keep these exported symbols from `src/shared/claude-background-agents.ts`:** `ClaudeBackgroundAgent`, `ClaudeBackgroundAgentKind`, `ClaudeBackgroundAgentState`, `ClaudeBackgroundAgentStatus`, `CLAUDE_BACKGROUND_AGENT_FINISHED_STATES`, `ClaudeRunningAgentLookup`, `ClaudeBackgroundAgentRequest`, `parseClaudeBackgroundAgentsValue`, `parseClaudeBackgroundAgents`, `readClaudeBackgroundAgentsListing`, `ClaudeBackgroundAgentsListing`, `readClaudeBackgroundAgentFailureMessage`, `CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES`, `isRecord`.
- **Keep `listClaudeBackgroundAgents` and `backgroundAgentCommandEnvironment`.** Delete only `listClaudeBackgroundAgentsOrNull` (panel-only).
- **Keep `buildClaudeAttachStartup`** in `src/shared/ai-vault/resume/ai-vault-attach-startup.ts` — the panel and AI Vault both use it.
- **Do not regenerate the RPC params catalog.** `aiVault.listRunningAgents` stays, so `src/shared/rpc-contract/rpc-params-catalog.generated.ts` is unchanged. Do not run `pnpm generate:rpc-params-catalog`.
- **Do not run `pnpm sync:localization-runtime-catalog`** — `src/renderer/src/i18n/en-runtime-required.json` contains none of the removed keys and must stay byte-identical.
- **Only `src/renderer/src/i18n/locales/en.json` has the panel's keys.** The other 10 locale files have zero `backgroundAgents` matches and must not be edited for this.
- **Preserve the unrelated uncommitted work in the tree.** Untouched: `src/renderer/src/components/prompt-editor/PromptEditor.tsx`(+test), `src/renderer/src/components/terminal-pane/composer/TerminalComposerField.tsx`(+test), `tests/e2e/terminal-composer-prompt.spec.ts`, the `terminalComposer.enterHint` line in every locale file, all of `src/main/code-completion/*` and `src/shared/code-completion/*`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-18-terminal-agent-rich-text-composer-design.md`, and the untracked `config/electron-builder-mac-arm64.config.cjs`. Do not stage or revert them.
- **Repo conventions:** no `helpers`/`utils`/`common` in new file names; comments explain _why_, not _how_; project-owned types live in `.ts`, never `.d.ts`; never hardcode `e.metaKey`.
- **Do not add tests by default.** A new test must fail if this change is reverted and must sit at the single layer that owns the behavior. The four guard tests listed in Review Focus are the only ones the plan adds.

## Review Focus

The spec is a vision document; these are the input classes it implies. Each is pinned to a test — three new, one already existing.

1. **A user whose saved right-sidebar tab was "Background agents" restarts the app.** The sidebar must land on Explorer, not a blank panel and not a crash. → **Task 4, Step 5** — new `src/main/persistence/applying-settings/ui-selection-normalization.test.ts`.
2. **An older desktop or mobile client sends `rightSidebarTab: 'background-agents'` over RPC.** The rest of that client's `ui.set` payload must still apply — the removed tab must be dropped as one absent field, not reject the whole payload. → **Task 4, Step 6** — new `src/shared/rpc-contract/client-ui-params.test.ts`.
3. **A user resumes a Claude conversation that is already running.** It must be opened, not copied into a duplicate session — the behavior `aiVault.listRunningAgents` exists to protect. → **already covered** by `src/renderer/src/lib/agent-session/resume/history/claude-running-agent.test.ts` ("finds the agent that runs the conversation", "does not call a finished agent a running one"); the plan runs it in Task 3 and Task 6.
4. **A paired runtime host answers `aiVault.listRunningAgents`.** The desktop must still parse that answer; the wire contract must not drift. → **Task 3, Step 6** — new `src/main/ai-vault/runtime-claude-background-agents.test.ts`. This path had no test; the trim touches the module it depends on, so it gains one.

---

### Task 1: Delete the renderer panel and its store slice

**Files:**

- Delete: `src/renderer/src/components/background-agents/` (all 34 files)
- Delete: `src/renderer/src/store/slices/background-agents/` (both files)
- Modify: `src/renderer/src/store/types.ts:33` (import) and `:89` (`BackgroundAgentsSlice &` member)
- Modify: `src/renderer/src/store/index.ts:38` (import) and `:140` (`...createBackgroundAgentsSlice(...a)`)
- Modify: `src/renderer/src/store/testing/app-store-test-fixture.ts:36` (import) and `:109` (`...createBackgroundAgentsSlice(...a)`)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: the renderer store no longer has a `BackgroundAgentsSlice`. `src/renderer/src/store/types.ts` exports `AppState` without that member.

- [ ] **Step 1: Delete the two directories**

```bash
git rm -r -f src/renderer/src/components/background-agents src/renderer/src/store/slices/background-agents
```

The `-f` is required: `BackgroundAgentComposer.tsx`, `BackgroundAgentComposer.test.tsx` and `BackgroundAgentListScreen.test.tsx` carry uncommitted changes, and plain `git rm` refuses to remove a file with local modifications. Forcing the removal discards those changes, which is intended (the spec §10 records this).

Expect: 36 tracked files removed (34 in the panel directory, 2 in the store slice directory).

- [ ] **Step 2: Remove the slice from `src/renderer/src/store/types.ts`**

Delete the import line:

```ts
import type { BackgroundAgentsSlice } from './slices/background-agents/create-background-agents-slice'
```

and delete the `BackgroundAgentsSlice &` member from the `AppState` intersection (it sits at line 89, between the neighbouring slice members).

- [ ] **Step 3: Remove the slice from `src/renderer/src/store/index.ts`**

Delete the import:

```ts
import { createBackgroundAgentsSlice } from './slices/background-agents/create-background-agents-slice'
```

and delete the spread `...createBackgroundAgentsSlice(...a),` from the slice composition (line 140).

- [ ] **Step 4: Remove the slice from `src/renderer/src/store/testing/app-store-test-fixture.ts`**

Delete the import:

```ts
import { createBackgroundAgentsSlice } from '../slices/background-agents/create-background-agents-slice'
```

and delete the spread `...createBackgroundAgentsSlice(...a),` (line 109). The `createTestStore()` helper must still compile and produce a store without background-agent state.

- [ ] **Step 5: Typecheck the renderer**

Run: `pnpm tc:web`
Expected: PASS. The panel's React components are gone but nothing else imported them yet — the right sidebar still references `BackgroundAgentsPanel`, so expect **this task to fail typecheck** with an error that `BackgroundAgentsPanel` cannot be found at `right-sidebar-panel-content.tsx:13`. That is the expected signal that Task 1's deletions are visible to the rest of the app; Task 2 fixes it. If it fails with anything _other_ than the missing `BackgroundAgentsPanel` import, fix that first.

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer/src/components/background-agents src/renderer/src/store
git commit -m "refactor(renderer): delete the background agents panel and its store slice"
```

---

### Task 2: Unwire the sidebar, IPC, preload and web surfaces

**Files:**

- Modify: `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx:13` (lazy import) and `:61` (render branch)
- Modify: `src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts:2` (`Bot` import) and `:89-94` (activity item)
- Delete: `src/main/ipc/claude-agents/` (both files)
- Modify: `src/main/ipc/register-core-handlers/register-core-handlers.ts:37` (import) and `:294` (call)
- Delete: `src/preload/api/claude-agents-api.ts`
- Delete: `src/preload/api/claude-agents-bridge.ts`
- Modify: `src/preload/api-types.ts:54` (import) and `:150` (`claudeAgents: ClaudeAgentsApi` field)
- Modify: `src/preload/index.ts:78` (import) and `:186` (`claudeAgents: claudeAgentsApi,` registration)
- Delete: `src/renderer/src/web/preload-api/web-claude-agents-api.ts`
- Modify: `src/renderer/src/web/web-preload-api.ts:17` (import) and `:125` (`claudeAgents: createWebClaudeAgentsApi(),` registration)
- Delete: `tests/e2e/claude-background-agents.spec.ts`

**Interfaces:**

- Consumes: Task 1's removal of the renderer panel (the sidebar's lazy import now points at a deleted file — this task fixes it).
- Produces: the `PreloadApi` type no longer has a `claudeAgents` member. `window.api.claudeAgents` no longer exists. The IPC channels `claudeAgents:list`, `claudeAgents:readDetails`, `claudeAgents:dispatch`, `claudeAgents:cancelDispatch`, `claudeAgents:stop`, `claudeAgents:remove` are no longer registered.

- [ ] **Step 1: Remove the panel from the right sidebar**

In `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx`, delete:

```ts
const BackgroundAgentsPanel = lazy(() => import('../background-agents/BackgroundAgentsPanel'))
```

and the render branch:

```tsx
{
  effectiveTab === 'background-agents' && <BackgroundAgentsPanel />
}
```

In `src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts`, delete the activity item:

```ts
{
  id: 'background-agents',
  icon: Bot,
  title: t('auto.components.right.sidebar.index.backgroundAgents', 'Background agents'),
  shortcut: ''
},
```

and remove `Bot` from the `lucide-react` import, leaving:

```ts
import { Plug, Files, GitBranch, ListChecks, Workflow } from 'lucide-react'
```

- [ ] **Step 2: Delete the IPC handler and its registration**

```bash
git rm -r src/main/ipc/claude-agents
```

In `src/main/ipc/register-core-handlers/register-core-handlers.ts`, delete the import line:

```ts
import { registerClaudeAgentsHandlers } from '../claude-agents/claude-agents'
```

and the call `registerClaudeAgentsHandlers()` (line 294).

- [ ] **Step 3: Delete the preload API and its registrations**

```bash
git rm src/preload/api/claude-agents-api.ts src/preload/api/claude-agents-bridge.ts
```

In `src/preload/api-types.ts`, delete the import `import type { ClaudeAgentsApi } from './api/claude-agents-api'` and the member `claudeAgents: ClaudeAgentsApi` from the `PreloadApi` type.

In `src/preload/index.ts`, delete the import `import { claudeAgentsApi } from './api/claude-agents-bridge'` and the registration line `claudeAgents: claudeAgentsApi,`.

- [ ] **Step 4: Delete the web-client stub and its registration**

```bash
git rm src/renderer/src/web/preload-api/web-claude-agents-api.ts
```

In `src/renderer/src/web/web-preload-api.ts`, delete the import `import { createWebClaudeAgentsApi } from './preload-api/web-claude-agents-api'` and the registration line `claudeAgents: createWebClaudeAgentsApi(),`.

- [ ] **Step 5: Delete the E2E spec**

```bash
git rm tests/e2e/claude-background-agents.spec.ts
```

This spec is the only E2E for the panel. It is guarded by `ORCA_REAL_CLAUDE_CLI_TEST=1` and skipped in CI, so removing it loses no CI coverage.

- [ ] **Step 6: Typecheck all projects**

Run: `pnpm tc`
Expected: PASS. This is the first task where the whole tree typechecks with the panel gone.

- [ ] **Step 7: Run the tests that guard AI Vault**

```bash
pnpm test src/renderer/src/lib/agent-session/resume --maxWorkers=2
pnpm test src/main/ipc/ai-vault --maxWorkers=2
```

Expected: PASS. `claude-running-agent.test.ts` and `ai-vault-running-agents.test.ts` must still pass — they do not touch the panel, but they prove the resume path was not collaterally damaged.

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/src/components/right-sidebar src/main/ipc src/preload src/renderer/src/web tests/e2e
git commit -m "refactor: unwire the background agents panel from the sidebar, IPC and preload"
```

---

### Task 3: Trim the shared modules to what AI Vault still calls

**Files:**

- Modify: `src/shared/claude-background-agents.ts` (delete the panel-only exports listed below)
- Modify: `src/main/claude/background-agents/claude-background-agent-list.ts` (delete `listClaudeBackgroundAgentsOrNull`)
- Delete: `src/main/claude/background-agents/claude-background-agent-commands.ts` + `.test.ts`
- Delete: `src/main/claude/background-agents/claude-background-agent-job-state.ts` + `.test.ts`
- Delete: `src/main/claude/background-agents/claude-background-agent-remote-list.ts` + `.test.ts`
- Delete: `src/main/claude/background-agents/claude-background-agent-remote-state.ts`
- Modify: `src/main/claude/background-agents/claude-background-agent-list.test.ts` (drop the `listClaudeBackgroundAgentsOrNull` describe block)
- Modify: `src/shared/claude-background-agents.test.ts` (keep; it tests kept functions)
- Test: `src/main/ai-vault/runtime-claude-background-agents.test.ts` (create — pins the paired-host half of the running-agents contract)

**Interfaces:**

- Consumes: Task 2's removal of the IPC handler that was the only caller of `listClaudeBackgroundAgentsOrNull`.
- Produces: `src/shared/claude-background-agents.ts` exports exactly the 14 symbols listed in Global Constraints. `claude-background-agent-list.ts` exports `listClaudeBackgroundAgents`, `CLAUDE_BACKGROUND_AGENTS_ARGS`, `CLAUDE_BACKGROUND_AGENTS_TIMEOUT_MS`, `ClaudeBackgroundAgentAllFlagMemory`, `ClaudeBackgroundAgentDependencies` — and no longer `listClaudeBackgroundAgentsOrNull`.

- [ ] **Step 1: Delete the four panel-only main-process modules**

```bash
git rm src/main/claude/background-agents/claude-background-agent-commands.ts \
       src/main/claude/background-agents/claude-background-agent-commands.test.ts \
       src/main/claude/background-agents/claude-background-agent-job-state.ts \
       src/main/claude/background-agents/claude-background-agent-job-state.test.ts \
       src/main/claude/background-agents/claude-background-agent-remote-list.ts \
       src/main/claude/background-agents/claude-background-agent-remote-list.test.ts \
       src/main/claude/background-agents/claude-background-agent-remote-state.ts
```

These four own `claude --bg` dispatch, `claude stop`, `claude rm`, the job-state reader and the remote roster. `claude-background-agent-list.ts` and `claude-background-agent-environment.ts` **stay** — they are the AI Vault path.

- [ ] **Step 2: Delete `listClaudeBackgroundAgentsOrNull` from `claude-background-agent-list.ts`**

Delete the whole exported function (lines 84-99 in the current file):

```ts
export async function listClaudeBackgroundAgentsOrNull(
  dependencies: ClaudeBackgroundAgentDependencies = {}
): Promise<ClaudeBackgroundAgent[] | null> {
  const listing = await readLocalClaudeBackgroundAgentListing(dependencies)
  if (listing.status === 'unsupported') {
    return null
  }
  if (listing.status === 'error') {
    throw new Error(listing.message)
  }
  return listing.agents
}
```

Keep `listClaudeBackgroundAgents` unchanged — it is the AI Vault entry point. Keep `readLocalClaudeBackgroundAgentListing` and the `LocalClaudeBackgroundAgentListing` type as they are: `listClaudeBackgroundAgents` still reads `listing.status === 'ready'`.

- [ ] **Step 3: Drop the matching test block**

In `src/main/claude/background-agents/claude-background-agent-list.test.ts`, delete the `describe('listClaudeBackgroundAgentsOrNull', ...)` block (lines 262-304) and remove `listClaudeBackgroundAgentsOrNull` from the import list, leaving:

```ts
import {
  listClaudeBackgroundAgents,
  type ClaudeBackgroundAgentAllFlagMemory
} from './claude-background-agent-list'
```

The `describe('listClaudeBackgroundAgents')` and `describe('a CLI that does not know --all')` blocks stay — they cover the AI Vault path and the `--all` downgrade.

- [ ] **Step 4: Trim `src/shared/claude-background-agents.ts`**

Delete these exports (each is used only by code deleted in Tasks 1-3):

`CLAUDE_BACKGROUND_AGENT_ID_PATTERN`, `CLAUDE_BACKGROUND_AGENT_DISPATCH_LINE_PATTERN`, `readClaudeBackgroundAgentDispatchedId`, `ClaudeBackgroundAgentDetail`, `ClaudeAgentsScope`, `readClaudeAgentsScope`, `ClaudeBackgroundAgentListResult`, `ClaudeBackgroundAgentCommandResult`, `ClaudeBackgroundAgentDispatchArgs`, `ClaudeBackgroundAgentIdArgs`, `CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE`.

Also delete the now-unused import at the top of the file:

```ts
import { stripAnsiEscapeSequences } from './ansi-escape-sequences'
```

(It was only used by `readClaudeBackgroundAgentDispatchedId`.)

Keep `isRecord` exported — it is used inside this file by `parseClaudeBackgroundAgentsValue`, and `config/knip.json` sets `ignoreExportsUsedInFile: true`, so an export used only in its own file is not reported as unused.

Two comments reference the panel and must be reworded, not left dangling: the comment above `readClaudeBackgroundAgentFailureMessage` says "trimmed to what a panel can show", and the comment above `readLocalClaudeBackgroundAgentListing` in the list file says "the panel must not show that as an empty list". Change "panel" to "caller" in each.

- [ ] **Step 5: Verify no dangling references**

```bash
grep -rn "listClaudeBackgroundAgentsOrNull\|ClaudeBackgroundAgentDetail\|ClaudeAgentsScope\|readClaudeAgentsScope\|ClaudeBackgroundAgentListResult\|ClaudeBackgroundAgentCommandResult\|ClaudeBackgroundAgentDispatchArgs\|ClaudeBackgroundAgentIdArgs\|CLAUDE_BACKGROUND_AGENT_CANCELLED_MESSAGE\|CLAUDE_BACKGROUND_AGENT_ID_PATTERN\|CLAUDE_BACKGROUND_AGENT_DISPATCH_LINE_PATTERN\|readClaudeBackgroundAgentDispatchedId" src/ tests/
```

Expected: **no output**. Every hit means a deleted symbol is still referenced.

- [ ] **Step 6: Write the paired-host test**

Create `src/main/ai-vault/runtime-claude-background-agents.test.ts`. This path is the paired-host half of the running-agents contract and has no test today; the trim touches the module it depends on, so it needs one. Follow the mocking convention of the sibling `src/main/ai-vault/runtime-session-search-call.test.ts`.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeEnvironment } = vi.hoisted(() => ({
  callRuntimeEnvironment: vi.fn()
}))

vi.mock('../ipc/runtime-environments/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment
}))

import { listRuntimeClaudeBackgroundAgents } from './runtime-claude-background-agents'

beforeEach(() => {
  callRuntimeEnvironment.mockReset()
})

describe('listRuntimeClaudeBackgroundAgents', () => {
  it('asks the host for the agents it runs and parses the answer', async () => {
    callRuntimeEnvironment.mockResolvedValue({
      ok: true,
      result: [{ id: '8857ad86', sessionId: 'session-1', name: 'agent', cwd: '/repos/app' }]
    })
    const agents = await listRuntimeClaudeBackgroundAgents('/userData', 'env-1')
    expect(callRuntimeEnvironment).toHaveBeenCalledWith(
      '/userData',
      'env-1',
      'aiVault.listRunningAgents',
      {},
      expect.any(Number)
    )
    expect(agents?.[0]?.id).toBe('8857ad86')
  })

  it('reports a host that cannot answer as unknown rather than as running nothing', async () => {
    callRuntimeEnvironment.mockResolvedValue({ ok: false, code: 'method_not_found' })
    expect(await listRuntimeClaudeBackgroundAgents('/userData', 'env-1')).toBeNull()
  })
})
```

The second case pins the distinction the whole feature rests on: a host that could not report must not be read as a host that runs nothing, or a running conversation gets copied into a duplicate session.

- [ ] **Step 7: Run the shared and AI Vault tests**

```bash
pnpm test src/shared/claude-background-agents.test.ts --maxWorkers=2
pnpm test src/main/claude/background-agents --maxWorkers=2
pnpm test src/main/ai-vault --maxWorkers=2
pnpm test src/main/ipc/ai-vault --maxWorkers=2
pnpm test src/renderer/src/lib/agent-session/resume --maxWorkers=2
```

Expected: PASS. `src/shared/claude-background-agents.test.ts` keeps both its describe blocks (`parseClaudeBackgroundAgents` and `readClaudeBackgroundAgentsListing`) — both functions are in the keep-set, so no test needs removing.

- [ ] **Step 8: Typecheck**

Run: `pnpm tc`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src/shared/claude-background-agents.ts src/shared/claude-background-agents.test.ts src/main/claude/background-agents src/main/ai-vault/runtime-claude-background-agents.test.ts
git commit -m "refactor: keep only the agent listing that AI Vault resumes against"
```

---

### Task 4: Drop the tab id from its four representations

**Files:**

- Modify: `src/shared/ui-chrome-types.ts:101` (the `RightSidebarTab` union member)
- Modify: `src/renderer/src/store/slices/right-sidebar/right-sidebar-route.ts:40` (the `tab === 'background-agents' ||` branch)
- Modify: `src/main/persistence/applying-settings/ui-selection-normalization.ts:67` (the `tab === 'background-agents' ||` branch)
- Modify: `src/shared/rpc-contract/client-ui-params.ts:44` (the `'background-agents'` entry in `STATIC_RIGHT_SIDEBAR_TABS`)
- Test: `src/main/persistence/applying-settings/ui-selection-normalization.test.ts` (create — pure-function test for the persisted-tab fallback)
- Test: `src/shared/rpc-contract/client-ui-params.test.ts` (create — pins the old-client wire behavior)

**Interfaces:**

- Consumes: Task 2's removal of the sidebar activity item (the tab id is no longer reachable from the UI).
- Produces: `'background-agents'` is no longer a valid `RightSidebarTab` anywhere. `normalizeRightSidebarTab('background-agents')` returns `'explorer'`; `normalizeRightSidebarRoute('background-agents')` returns `{ rightSidebarTab: 'explorer', rightSidebarExplorerView: 'files' }`; `UiUpdate` drops a `rightSidebarTab` of `'background-agents'` as one absent field.

- [ ] **Step 1: Remove the union member**

In `src/shared/ui-chrome-types.ts`, delete `| 'background-agents'` from the `RightSidebarTab` union (line 101).

- [ ] **Step 2: Remove the renderer route branch**

In `src/renderer/src/store/slices/right-sidebar/right-sidebar-route.ts`, delete the line `tab === 'background-agents' ||` (line 40) from the accepted-tab list inside `normalizeRightSidebarRoute`.

- [ ] **Step 3: Remove the persisted-state branch**

In `src/main/persistence/applying-settings/ui-selection-normalization.ts`, delete the line `tab === 'background-agents' ||` (line 67) from `normalizeRightSidebarTab`.

With that branch gone, a persisted `'background-agents'` falls through to the existing fallback `return getDefaultUIState().rightSidebarTab`, which is `'explorer'` (`src/shared/constants.ts:170`). **No migration code is needed** — this is the fallback, not new behavior.

- [ ] **Step 4: Remove the RPC schema entry**

In `src/shared/rpc-contract/client-ui-params.ts`, delete the `'background-agents',` entry from the `STATIC_RIGHT_SIDEBAR_TABS` array (line 44).

This is safe for older clients: `UiUpdate` wraps every field in `.catch(() => undefined)` via `tolerateUnknownValues` (`src/shared/rpc-contract/ui-update-value-tolerance-params.ts`), so a client still sending `'background-agents'` loses only that one field and the rest of its payload still applies. Verified against the real schema:

```
schema 保留该 tab  -> ACCEPTED, data={"rightSidebarTab":"background-agents","sidebarWidth":300}
schema 删除该 tab  -> ACCEPTED, data={"sidebarWidth":300}
```

- [ ] **Step 5: Write the persisted-tab test**

Create `src/main/persistence/applying-settings/ui-selection-normalization.test.ts`. The normalizer is a pure function with no store or filesystem dependency, so it gets its own light test file rather than joining the heavy `persistence-ui-state.test.ts` integration suite (whose siblings all spin up a SQLite store and mock the SSH parser).

```ts
import { describe, expect, it } from 'vitest'
import { normalizeRightSidebarTab } from './ui-selection-normalization'

describe('normalizeRightSidebarTab', () => {
  it('falls back to the explorer tab when the saved tab is not one the app knows', () => {
    expect(normalizeRightSidebarTab('background-agents')).toBe('explorer')
  })

  it('keeps a tab the app knows', () => {
    expect(normalizeRightSidebarTab('vault')).toBe('vault')
  })
})
```

The second case pins that the fallback did not swallow the normal path — without it, a normalizer that always returned `'explorer'` would pass the first test.

- [ ] **Step 6: Write the old-client wire test**

In `src/shared/rpc-contract/client-ui-params.test.ts` (create it — no test file exists for this module), add:

```ts
import { describe, expect, it } from 'vitest'
import { UiUpdate } from './client-ui-params'

describe('UiUpdate', () => {
  it('drops a right sidebar tab the app no longer knows and keeps the rest of the payload', () => {
    const result = UiUpdate.parse({
      rightSidebarTab: 'background-agents',
      sidebarWidth: 300
    })
    expect(result).toEqual({ sidebarWidth: 300 })
  })
})
```

This pins Review Focus #2: an older client's payload is not rejected wholesale.

- [ ] **Step 7: Run the tests**

```bash
pnpm test src/main/persistence/applying-settings/ui-selection-normalization.test.ts --maxWorkers=2
pnpm test src/shared/rpc-contract/client-ui-params.test.ts --maxWorkers=2
```

Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `pnpm tc`
Expected: PASS. The `AssertNoMissingValues` parity check in `src/main/runtime/rpc/methods/client-state/ui-state-schema-parity-checks.ts` compares `PersistedUIState`'s `rightSidebarTab` union against the RPC schema's value domain — removing the member from both sides keeps them in agreement. If typecheck reports a parity error, the two sides drifted: check that `ui-chrome-types.ts` and `client-ui-params.ts` were both edited.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ui-chrome-types.ts src/shared/rpc-contract/client-ui-params.ts \
        src/shared/rpc-contract/client-ui-params.test.ts \
        src/renderer/src/store/slices/right-sidebar/right-sidebar-route.ts \
        src/main/persistence/applying-settings/ui-selection-normalization.ts \
        src/main/persistence/applying-settings/ui-selection-normalization.test.ts
git commit -m "refactor: drop the background agents tab id from every representation"
```

---

### Task 5: Remove the panel's strings and its design docs

**Files:**

- Modify: `src/renderer/src/i18n/locales/en.json` (delete the `auto.components.backgroundAgents` object at line 20142 and the `auto.components.right.sidebar.index.backgroundAgents` entry at line 15213)
- Delete: `docs/superpowers/specs/2026-11-15-claude-background-agents-supervisor-design.md`
- Delete: `docs/superpowers/specs/2026-11-20-background-agents-remote-hosts-design.md`
- Delete: `docs/superpowers/plans/2026-11-15-claude-background-agents-supervisor.md`

**Interfaces:**

- Consumes: Task 2's removal of the components that referenced these keys.
- Produces: no locale catalog references the panel's strings.

- [ ] **Step 1: Delete the panel's string block from `en.json`**

In `src/renderer/src/i18n/locales/en.json`, delete the whole `"backgroundAgents": { ... }` object (starts at line 20142, ends with the `"send": "Send"` line followed by `},`).

Delete the `"backgroundAgents": "Background agents"` entry (line 15213) from the `auto.components.right.sidebar.index` object. That entry is the **last** key in its object, so delete it together with the comma on the preceding line (`"creatingWorkspace": "Available when the workspace is ready",` → `"creatingWorkspace": "Available when the workspace is ready"`).

**Do not touch** the `terminalComposer.enterHint` line in this file — it is the unrelated uncommitted work from a different task.

- [ ] **Step 2: Verify the JSON is still valid and the keys are gone**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/renderer/src/i18n/locales/en.json','utf8')); console.log('valid json')"
grep -c "backgroundAgents" src/renderer/src/i18n/locales/en.json
```

Expected: `valid json`, then `0`.

- [ ] **Step 3: Verify no other locale file needs editing**

```bash
for f in src/renderer/src/i18n/locales/*.json; do echo "$(basename $f): $(grep -c backgroundAgents $f)"; done
```

Expected: every file reports `0`.

- [ ] **Step 4: Delete the three design documents**

```bash
git rm docs/superpowers/specs/2026-11-15-claude-background-agents-supervisor-design.md \
       docs/superpowers/specs/2026-11-20-background-agents-remote-hosts-design.md \
       docs/superpowers/plans/2026-11-15-claude-background-agents-supervisor.md
```

Do **not** delete `docs/superpowers/specs/2026-11-18-terminal-agent-rich-text-composer-design.md` — it is the terminal composer's design and carries unrelated uncommitted edits. Do not delete the new `docs/superpowers/specs/2026-11-24-remove-background-agents-panel-design.md` or this plan.

- [ ] **Step 5: Run the localization gates**

```bash
pnpm verify:localization-extraction
pnpm verify:localization-catalogs
```

Expected: PASS. `verify:localization-extraction` is the gate that fails when a catalog key has no source reference — it is why the keys must be deleted rather than left behind.

- [ ] **Step 6: Confirm the runtime catalog is untouched**

```bash
git diff --stat src/renderer/src/i18n/en-runtime-required.json
```

Expected: **no output**. It never contained these keys.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/i18n/locales/en.json docs/superpowers
git commit -m "refactor: remove the background agents strings and design docs"
```

---

### Task 6: Full verification

**Files:**

- No file changes expected. This task verifies the whole branch.

**Interfaces:**

- Consumes: every prior task.
- Produces: a green branch.

- [ ] **Step 1: Typecheck every project**

```bash
pnpm tc
```

Expected: PASS — all five tsconfig projects.

- [ ] **Step 2: Run the tests that guard the surviving feature**

```bash
pnpm test src/shared/claude-background-agents.test.ts --maxWorkers=2
pnpm test src/main/claude/background-agents --maxWorkers=2
pnpm test src/main/ipc/ai-vault --maxWorkers=2
pnpm test src/main/ai-vault/runtime-claude-background-agents.test.ts --maxWorkers=2
pnpm test src/renderer/src/lib/agent-session/resume --maxWorkers=2
pnpm test src/main/persistence/applying-settings/ui-selection-normalization.test.ts --maxWorkers=2
pnpm test src/shared/rpc-contract/client-ui-params.test.ts --maxWorkers=2
```

Expected: PASS. The first five are the AI Vault guard set; the last two cover the tab-id removal.

- [ ] **Step 3: Confirm the feature is gone from the source tree**

```bash
grep -rn "background-agents\|BackgroundAgents\|backgroundAgents" src/ tests/ --include="*.ts" --include="*.tsx" --include="*.json"
```

Expected: hits remain, and every one of them must be one of the four **kept** artifacts:

- `src/shared/claude-background-agents.ts` and `src/shared/claude-background-agents.test.ts` — the shared module AI Vault still uses
- `src/main/claude/background-agents/claude-background-agent-list.ts` and `claude-background-agent-environment.ts` (+ their tests) — the CLI wrapper AI Vault still calls
- import lines pointing at those modules from the AI Vault chain (`claude-running-agent.ts`, `ai-vault-resume.ts`, `runtime-claude-background-agents.ts`, `ai-vault-api.ts`, `ai-vault-bridge.ts`)

Within those files the surviving symbols are `ClaudeBackgroundAgent`, `ClaudeBackgroundAgentsListing`, `readClaudeBackgroundAgentsListing`, `parseClaudeBackgroundAgents` — all in the Global Constraints keep-set.

Any hit **outside** those files and symbols is a missed reference. The panel-specific names that must appear nowhere are `BackgroundAgentsPanel`, `BackgroundAgentListScreen`, `BackgroundAgentComposer`, `BackgroundAgentRow`, `BackgroundAgentDispatchRow`, `BackgroundAgentEmptyState`, `BackgroundAgentHostNotice`, `BackgroundAgentAgentScreen`, `BackgroundAgentRemoteTerminal`, `createBackgroundAgentsSlice`, `BackgroundAgentsSlice`, `ClaudeAgentsApi`, `claudeAgentsApi`, `createWebClaudeAgentsApi`, `registerClaudeAgentsHandlers`.

- [ ] **Step 4: Confirm the AI Vault chain is intact**

```bash
grep -rn "listRunningAgents" src/main/ipc/ai-vault/ai-vault-resume.ts src/preload/api/ai-vault-bridge.ts src/renderer/src/lib/agent-session/resume/history/claude-running-agent.ts
grep -n "aiVault.listRunningAgents" src/main/runtime/rpc/methods/history/ai-vault.ts
```

Expected: every line present. This is Review Focus #3 and #4 — the resume path and the paired-host contract must be byte-for-byte intact.

- [ ] **Step 5: Run the lint gate**

```bash
pnpm lint
```

Expected: PASS — all 46 steps, including `verify:localization-extraction` and `verify:localization-catalogs`.

- [ ] **Step 6: Run the pre-push gate**

```bash
pnpm check:changed
```

Expected: PASS — typecheck, unit tests, changed-code quality, format and the selected verify checks.

- [ ] **Step 7: Confirm the unrelated uncommitted work is intact**

```bash
git status --porcelain
```

Expected: the following files still show as modified, exactly as they did before this plan started, and nothing new is staged:

```
 M CLAUDE.md
 M docs/superpowers/specs/2026-11-18-terminal-agent-rich-text-composer-design.md
 M src/main/code-completion/anthropic-messages-backend.ts
 M src/main/code-completion/completion-backend.ts
 M src/main/code-completion/completion-service.ts
 M src/renderer/src/components/prompt-editor/PromptEditor.test.tsx
 M src/renderer/src/components/prompt-editor/PromptEditor.tsx
 M src/renderer/src/components/terminal-pane/composer/TerminalComposerField.test.tsx
 M src/renderer/src/components/terminal-pane/composer/TerminalComposerField.tsx
 M src/renderer/src/i18n/locales/de.json
 M src/renderer/src/i18n/locales/es.json
 M src/renderer/src/i18n/locales/fr.json
 M src/renderer/src/i18n/locales/ja.json
 M src/renderer/src/i18n/locales/ko.json
 M src/renderer/src/i18n/locales/pt.json
 M src/renderer/src/i18n/locales/ru.json
 M src/renderer/src/i18n/locales/tr.json
 M src/renderer/src/i18n/locales/zh-Hant.json
 M src/renderer/src/i18n/locales/zh.json
 M src/shared/code-completion/code-completion-settings.test.ts
 M src/shared/code-completion/code-completion-settings.ts
 M src/shared/code-completion/code-completion-types.ts
 M tests/e2e/terminal-composer-prompt.spec.ts
?? config/electron-builder-mac-arm64.config.cjs
```

`src/renderer/src/i18n/locales/en.json` is **not** in this list — Task 5 committed it along with the panel's keys, so its only remaining change (the `terminalComposer.enterHint` line) is now committed as part of the removal commit. That is expected and harmless: the line survives in the committed file.

- [ ] **Step 8: Manual confirmation (requires a running app)**

Run: `pnpm dev`

Confirm three things by hand:

1. The right-sidebar activity bar no longer shows "Background agents".
2. In AI Vault, resuming a Claude conversation that is still running opens it rather than creating a duplicate.
3. A profile that had `rightSidebarTab: "background-agents"` saved lands on the Explorer tab, not an empty sidebar.
