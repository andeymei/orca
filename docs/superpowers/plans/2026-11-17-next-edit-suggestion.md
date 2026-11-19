# Next Edit Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Orca's Monaco editor, show an inline code suggestion at the cursor that Tab accepts, and mark the other places the model predicts you will edit next.

**Architecture:** A model returns a structured _edit plan_ (which file, which range, what text, why) as JSON. The renderer sends a paused-editing context to the runtime over RPC; the runtime calls an Anthropic- or OpenAI-compatible endpoint, caches the answer, and returns the plan. The renderer keeps the plan per file, renders the edit at the cursor through Monaco's own inline-completions API, and marks the other predicted locations in the gutter.

**Tech Stack:** TypeScript, Electron (main + preload + renderer), Monaco 0.55, zod, Vitest under Bun, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-17-next-edit-suggestion-design.md` — read it before starting; this plan implements it and does not restate it.

## Global Constraints

- **Never write to the model and then notify the store.** Orca owns content sync (`src/renderer/src/components/editor/monaco-content-sync.ts`); a model edit fires `onDidChangeModelContent`, which the bridge (`use-monaco-content-sync-bridge.ts`) already turns into `onContentChange` → draft → dirty → autosave. Writing through the model _is_ the notification. Calling `onContentChange` yourself as well is a double write.
- **Do not use `beginProgrammaticContentSync` / `endProgrammaticContentSync` when applying an accepted suggestion.** Those suppress the change event, which would leave the file clean and unsaved. They exist for content _syncs_, not for user edits.
- An accepted suggestion must be one undoable step: `editorInstance.pushUndoStop()`, `model.pushEditOperations([], [edit], () => null)`, `editorInstance.pushUndoStop()`.
- The API key never enters `GlobalSettings` (that is plaintext JSON on disk) and never enters the RPC params catalog. It lives in an encrypted file store (`createEncryptedApiKeyFileStore`) reached through a dedicated preload channel.
- New runtime RPC methods need seven things: a zod params schema in `src/shared/rpc-contract/`, a `defineMethod` with an explicit `permission`, a family file exporting a `*_METHODS` array, a spread into `ALL_RPC_METHODS` in `src/main/runtime/rpc/methods/rpc-method-registry.ts`, a regenerated `src/shared/rpc-contract/rpc-params-catalog.generated.ts` (`pnpm generate:rpc-params-catalog` — the `rpc-params-type-parity.ts` type gate fails otherwise), and the renderer call site.
- `RpcMethodPermission` is a closed union: `'workspace' | 'desktop-control' | 'accounts-admin' | 'settings-write' | 'skills-admin' | 'pairing-admin' | 'host-admin' | 'device-self'`.
- Outbound HTTP goes through `getMainHttpClient().fetch` (`src/main/network/http-client.ts`) — it honours the Chromium proxy session. Never call `globalThis.fetch` directly in main.
- A settings write goes through the `SettingsUpdate` zod schema (`src/shared/rpc-contract/client-settings-params.ts`), which is `.strict()` — a new setting must be added to it or the write is rejected.
- `GlobalSettingsBase` is an intersection of feature-owned setting modules (`src/shared/global-settings-base.ts`). A new settings block is a new module intersected in, not a field bolted onto the big type.
- A new settings block has to be registered in **six** places, and the first one is easy to miss: the type (`global-settings-base.ts`), the defaults (`default-global-settings.ts`), the RPC schema (`client-settings-params.ts`), the store boundary (`src/main/persistence/applying-settings/settings-update.ts`), the load path (`src/main/persistence/loading-store/profile-loading/normalize-loaded-global-settings.ts`), and **the runtime's own store contract** (`src/main/runtime/construction/runtime-store-contract.ts`), whose `getSettings()` enumerates the settings field by field rather than using `GlobalSettings`. A block missing from that last one is not a type error anywhere else — the RPC method just reads `undefined`.
- New keybinding ids need **two** edits: a `| 'literal'` member in the `KeybindingActionId` union (`src/shared/keybindings/types.ts`) **and** a `KeybindingDefinition` entry in a `definitions-core-N.ts` file.
- Editor key handling is a capture-phase `keydown` listener on `editor.getContainerDomNode()` with `preventDefault()` + `stopPropagation()` (`src/renderer/src/components/editor/editor-shortcuts.ts`). Monaco's own keymap is untouched.
- The inline-completions provider is a module-level singleton guarded by the Monaco instance identity (`ensureMarkdownDocCompletionProvider` in `monaco-markdown-doc-completions.ts` is the pattern).
- Comments state _why_, not _how_. One line.
- No `helpers` / `utils` / `common` in a filename — name a file after the domain concept it holds.
- Cross-platform: `path.join` for paths; never hardcode a shell separator.
- Run tests with `pnpm test <path> --maxWorkers=2`. Never raw `vitest`. Never run two vitest runs at once on this checkout.

## Review Focus

Five input classes the spec implies but no task's tests exercise — each line below gets a test in the owning task.

1. **The user keeps typing while a request is in flight.** The stale plan must not be applied to text that changed under it. (Task 9 and Task 11 — an edit only matches a cursor at its range end, so a moved cursor finds no suggestion, and an edit whose `originalText` no longer matches is refused before it is applied.)
2. **The model returns an edit for a file the user is no longer in.** The marker must not appear in a file the plan did not name, and a plan whose file has changed must not apply. (Task 8 — the plan is keyed by path and the markers are drawn only in the file the plan named.)
3. **The user presses Tab with no suggestion showing.** That must fall through to the TypeScript intellisense suggest widget, not swallow the key. (Task 10.)
4. **The endpoint returns a 401, a 429, or a truncated stream.** The user must see no suggestion and no error dialog; the failure must not be cached as "no suggestions". (Task 2 and Task 3.)
5. **The user has no API key configured, or the key was revoked.** The feature must be inert and the settings UI must say why, rather than firing requests that fail. (Task 5, Task 6 and Task 12.)

---

### Task 1: The edit-plan contract and the prompt

**Files:**

- Create: `src/shared/code-completion/code-completion-types.ts`
- Create: `src/shared/code-completion/code-completion-prompt.ts`
- Create: `src/shared/code-completion/code-completion-types.test.ts`
- Create: `src/shared/code-completion/code-completion-prompt.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (all in `src/shared/code-completion/code-completion-types.ts` unless noted — the renderer and the main process both import them, so **nothing here may live under `src/main/`**):
  - `NesEditKind`, `NesEditRange`, `NesEdit`, `NesEditPlan` (zod schemas and inferred types)
  - `NesBackendId = 'anthropic-messages' | 'openai-chat' | 'openai-completions-fim'`
  - `NesRequest` — the request both sides speak: `{ filePath: string; relativePath: string; languageId: string; prefix: string; suffix: string; prefixStartLine: number; cursorLine: number; cursorColumn: number; relatedFiles: readonly { path: string; content: string; startLine: number }[]; recentEdits: readonly { path: string; label: string }[] }`

`prefixStartLine` is the file line the shown prefix starts at (1 when the whole file precedes the cursor); each related file carries its own `startLine`. `cursorLine` / `cursorColumn` are the cursor's **absolute** position. The model's line numbers are relative to the text it was shown, and the backend converts them to absolute before returning the plan — see the spec's §5.5.

- `validateNesEditPlan(raw: unknown, options: { allowedPaths: readonly string[] }): NesEditPlan` — drops unusable edits instead of failing the whole plan
- `sliceRange(text: string, range: NesEditRange): string | null` — the text a range covers, or null when the range is out of bounds or a column is below one
- `buildNesSystemPrompt(options?: { autoImport?: boolean }): string`
- `buildNesUserPrompt(input: NesPromptInput): string`
- `type NesPromptInput = NesRequest & { autoImport: boolean }`

**Where the `originalText` check happens.** The backend never sees the file's full text — it only has the prefix and the suffix — so it **cannot** verify that `originalText` matches the range. The backend validates structure and paths; the **renderer** validates content, against the live model, in Task 9 (before offering) and again in Task 11 (before applying).

- [ ] **Step 1: Write the failing schema test**

Create `src/shared/code-completion/code-completion-types.test.ts`. Cover exactly these cases:

```ts
describe('validateNesEditPlan', () => {
  it('keeps a well-formed insert', ...)
  it('drops an edit whose path is not in the context', ...)
  it('drops a delete that carries new text', ...)
  it('drops an insert that carries original text', ...)
  it('drops a replace that carries neither text', ...)
  it('drops a replace that rewrites the text it covers', ...)
  it('drops a replace that spans more than one line', ...)
  it('keeps a replace that only adds to the text it covers', ...)
  it('keeps a multi-line insert, whose range is a single line', ...)
  it('truncates a plan with more than five edits', ...)
  it('returns an empty plan when the payload is not JSON', ...)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/shared/code-completion/code-completion-types.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the schema and the validator**

Create `src/shared/code-completion/code-completion-types.ts`:

```ts
import { z } from 'zod'

export const NES_MAX_EDITS = 5

export const NesEditKind = z.enum(['insert', 'replace', 'delete'])

export const NesEditRange = z.object({
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive()
})

export const NesEdit = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: NesEditKind,
  range: NesEditRange,
  originalText: z.string(),
  text: z.string(),
  label: z.string()
})

export const NesEditPlan = z.object({
  edits: salvagingArray(NesEdit).check(z.maxLength(NES_MAX_EDITS))
})

export type NesEditKind = z.infer<typeof NesEditKind>
export type NesEditRange = z.infer<typeof NesEditRange>
export type NesEdit = z.infer<typeof NesEdit>
export type NesEditPlan = z.infer<typeof NesEditPlan>
```

`validateNesEditPlan` parses the payload with `NesEditPlan.safeParse`. A parse failure returns `{ edits: [] }` — a malformed answer means "no suggestion", never an error the user sees.

For each parsed edit, keep it only when all of these hold:

- `allowedPaths` includes `edit.path`
- a path that already has two **kept** edits drops any further edit for that path — an edit that fails another rule never consumes a slot
- `kind === 'insert'` implies `originalText === ''`
- `kind === 'delete'` implies `text === ''`
- `kind === 'replace'` implies both texts are non-empty
- **the range is a single line** — `range.startLine === range.endLine`
- **the new text only adds to the text the range covers** — `nesEditExtendsCoveredText(edit)`

**The last two rules are what the editor can show.** Monaco's classic inline-completion path renders
an insertion and nothing else: a rewrite, a shortening, a deletion and a multi-line range all render
as _nothing_. The plan's interaction model — the anchor edit is a ghost text, `Tab` takes it, the
other locations are gutter markers the user jumps to — holds only if every edit in the plan can be
rendered as a ghost text once the cursor is on it. An edit that cannot be rendered is one the user
can see and never apply.

Both rules are computable from the edit alone, so they belong here, in the contract with the model,
and not in the renderer. `nesEditExtendsCoveredText` lives in this module beside `isApplicableNesEdit`
and is exported, because the provider (Task 9) and the Tab routing (Task 10) ask the same question
as the defence against a plan that reached the renderer without passing the validator.

**A multi-line insert is not dropped.** Its _range_ is empty at one point — a single line — while
its _text_ may be many lines; that is the feature's headline case, and the ghost text renders the
whole block.

`sliceRange(text, range)` returns the text a range covers: 1-based line and column, column counted in UTF-16 code units, lines split on `\n`. It returns null when the range is out of bounds **or when a column is below one** — a zero start column would otherwise reach `slice(-1, …)` and answer with the line's last character, and a zero end column would drop the end line's last character.

- [ ] **Step 4: Write the prompt test**

Create `src/shared/code-completion/code-completion-prompt.test.ts`:

```ts
describe('buildNesUserPrompt', () => {
  it('marks the cursor with a sentinel that cannot appear in source', ...)
  it('separates each file with a ###PATH: header', ...)
  it('includes the related files after the current one', ...)
  it('lists the recently accepted edits', ...)
})

describe('buildNesSystemPrompt', () => {
  it('states the rules the validator drops on', ...)
})
```

Pin the exact sentinel and the exact header in the assertions, e.g. the cursor marker is `<<<CURSOR>>>` and each file header is `###PATH: <path>` on its own line.

**The system prompt's rules are the validator's rules.** Every rule the prompt states has a matching
drop rule in `validateNesEditPlan`, and every drop rule is stated in the prompt — otherwise the
model spends one of its five edits on an edit that is dropped. The two rules this feature adds are
the **add-only** rule and the **one-line range** rule.

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test src/shared/code-completion/code-completion-prompt.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 6: Write the prompt builder**

Create `src/shared/code-completion/code-completion-prompt.ts`:

```ts
export const NES_CURSOR_MARKER = '<<<CURSOR>>>'
export const NES_PATH_HEADER_PREFIX = '###PATH: '

export function buildNesSystemPrompt(): string
export function buildNesUserPrompt(input: NesPromptInput): string
```

The system prompt states, in this order: the response is a single JSON object `{"edits":[…]}` with no prose and no markdown fence; each edit carries `id`, `path`, `kind`, `range`, `originalText`, `text`, `label`; at most five edits; at most two edits per file; `range` is 1-based with columns in UTF-16 code units; **the range's end must be the cursor position** so the suggestion applies where the user is typing; `originalText` must be the exact text the range currently covers; `label` is a short human-readable intent; and the model must return `{"edits":[]}` when it has nothing to propose.

When `autoImport` is true the system prompt adds one sentence: when the new code needs a module that is not imported, propose an `insert` edit at the top of the file that adds the import. When it is false, the sentence is absent — the switch changes the prompt, not the filter.

Two rules the prompt must state, because the validator silently drops anything that misses them:

- **Reply with each path exactly as it appears after `###PATH:`.** The prompt shows the current file twice — once as `Current file: <relativePath>` and once as `###PATH: <absolute path>` — and the validator only keeps a path that is in `allowedPaths`, which holds the absolute forms. A model that answers with the relative path has its edit dropped.
- **The edit at the cursor must end at the cursor position.** Not every edit: an import insert has no cursor, and a plan may carry both.
- **An edit may only add to the text its range covers.** Propose an `insert`, or a `replace` whose `text` begins with the `originalText` it replaces. An edit that rewrites or removes what is already there is dropped — the editor can only show an addition.
- **An edit's range must be on one line.** A range that spans lines is dropped: the editor's suggestion is drawn on one line at a time.
- **Count each file's lines separately — the first line of a file's content, the line right after its `###PATH:` header, is line 1 of that file.** The shown text may start part-way through a file, and the backend converts your line numbers to the file's own. Counting must not run across the files in this prompt: each `###PATH:` block is numbered on its own.

The user prompt is:

```
Current file: <relativePath>
Language: <languageId>

###PATH: <filePath>
<prefix><NES_CURSOR_MARKER><suffix>

###PATH: <related path>
<content>

Recently accepted edits:
- <path>: <label>
```

The current file comes first; related files follow in the order given; recent edits come last.

- [ ] **Step 7: Run both test files**

Run: `pnpm test src/shared/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/code-completion
git commit -m "feat(code-completion): the edit plan contract and its prompt"
```

---

### Task 2: The three HTTP backends

**Files:**

- Create: `src/main/code-completion/completion-backend.ts`
- Create: `src/main/code-completion/completion-http.ts`
- Create: `src/main/code-completion/anthropic-messages-backend.ts`
- Create: `src/main/code-completion/openai-chat-backend.ts`
- Create: `src/main/code-completion/openai-fim-backend.ts`
- Create: `src/main/code-completion/completion-backends.test.ts`

**Interfaces:**

- Consumes: `NesEditPlan`, `validateNesEditPlan`, `NesBackendId`, `NesRequest` — all from `src/shared/code-completion/code-completion-types.ts` (Task 1).
- Produces:
  - `type NesBackend = { id: NesBackendId; planCapable: boolean; identity: string; plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> }`

`identity` names who answered — the protocol, the endpoint, the model and the auto-import switch. Each factory computes it from its config. The completion cache is a module-level singleton, so the identity has to travel with the answer: without it, a plan produced by one model is served to a request that would have gone to another, and turning the auto-import switch off would still surface the old model's import edit.

- `type NesBackendResult = { plan: NesEditPlan | null; usage: CompletionUsage }` — the usage is filled in by Task 14; until then it is all zeros
- `type CompletionUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number }`
- `createAnthropicMessagesBackend(config): NesBackend`
- `createOpenAiChatBackend(config): NesBackend`
- `createOpenAiFimBackend(config): NesBackend`
- `type NesBackendConfig = { baseUrl: string; model: string; apiKey: string; maxTokens: number; autoImport: boolean }`

`autoImport` is a **setting**, not part of the request: the renderer must not decide whether the model may propose an import. The main process reads it from the settings and passes it in the backend config; the backend puts it on the prompt input (`NesPromptInput = NesRequest & { autoImport: boolean }`). The FIM backend does not use the prompt at all.

- [ ] **Step 1: Write the failing backend test**

Create `src/main/code-completion/completion-backends.test.ts`. Stub the network at the seam the backends use — the backends must call an injected `fetch` so the test never touches the network:

```ts
describe('completion backends', () => {
  it('reads an Anthropic stream and returns the validated plan', ...)
  it('reads an OpenAI chat stream and returns the validated plan', ...)
  it('reads an OpenAI FIM stream and returns only the cursor edit', ...)
  it('returns null when the endpoint answers 401', ...)
  it('returns null when the stream ends mid-object', ...)
  it('returns null when the endpoint answers 429 with a retry-after', ...)
})
```

The FIM case is the interesting one: the FIM backend has `planCapable === false` and returns a plan with at most one edit, whose `path` is the current file and whose range is the cursor.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/code-completion/completion-backends.test.ts --maxWorkers=2`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the shared stream reader**

Create `src/main/code-completion/completion-http.ts`:

```ts
export type CompletionHttpRequest = {
  url: string
  headers: Record<string, string>
  body: unknown
  signal: AbortSignal
  fetchImpl?: typeof fetch
}

export type CompletionHttpResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'http_error' | 'stream_error' | 'aborted' }

export async function postCompletionJson(
  request: CompletionHttpRequest
): Promise<CompletionHttpResult>
```

It posts with `getMainHttpClient().fetch` unless `fetchImpl` is injected, reads the body as a stream with `response.body.getReader()`, and accumulates the SSE `data:` payloads into one text buffer, stripping the `data: ` prefix and ignoring `[DONE]`. A non-2xx response returns `{ ok: false, reason: 'http_error' }` — the status code itself is not part of the result, because no caller may show it to the user.

- [ ] **Step 4: Write the three backends**

Create `src/main/code-completion/completion-backend.ts` with the `NesBackend` type. `NesBackendId` and `NesRequest` come from `src/shared/code-completion/code-completion-types.ts` — do not redeclare them here.

Create `src/main/code-completion/anthropic-messages-backend.ts`:

```ts
export function createAnthropicMessagesBackend(config: NesBackendConfig): NesBackend
```

Posts to `${config.baseUrl}/v1/messages` with `{ model, max_tokens, system, messages: [{ role: 'user', content }], stream: true }` and the headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. The streamed text is the concatenation of the `content_block_delta` `text` fields.

Create `src/main/code-completion/openai-chat-backend.ts`:

```ts
export function createOpenAiChatBackend(config: NesBackendConfig): NesBackend
```

Posts to `${config.baseUrl}/chat/completions` with `{ model, max_tokens, messages: [{ role: 'system', content }, { role: 'user', content }], stream: true }` and the headers `authorization: Bearer <key>`, `content-type: application/json`. The streamed text is the concatenation of `choices[0].delta.content`.

Create `src/main/code-completion/openai-fim-backend.ts`:

```ts
export function createOpenAiFimBackend(config: NesBackendConfig): NesBackend
```

Posts to `${config.baseUrl}/completions` with `{ model, max_tokens, prompt, stream: true }` where `prompt` is the prefix, a cursor sentinel, and the suffix. The streamed text is the concatenation of `choices[0].text`. This backend has `planCapable: false`; it returns one edit whose `path` is the current file and whose range is the cursor, and it never asks for multi-location edits.

All three backends finish the same way: parse the accumulated text as JSON, run it through `validateNesEditPlan` with the request's file paths, and return `null` on any failure.

**Then the backend converts the model's relative line numbers to the file's absolute ones.** The model sees a prefix that may start part-way through the file, so its line 1 is the file's `prefixStartLine` (and a related file's own `startLine`). Every edit's `range.startLine` and `range.endLine` get `startLineFor(edit.path) - 1` added. The renderer therefore always receives absolute coordinates and never has to know the model was shown a fragment.

```ts
export function nesStartLineFor(request: NesRequest, path: string): number
export function translateNesEditLines(plan: NesEditPlan, request: NesRequest): NesEditPlan
```

`nesStartLineFor` returns the related file's `startLine` when the path names one, and `request.prefixStartLine` otherwise. `translateNesEditLines` returns a plan whose ranges are absolute; a `delete` edit's range still covers the same text, since only the line numbers move.

The FIM backend needs no translation of a model's answer — it synthesizes the insert itself — but its range is built from the request's **absolute** `cursorLine` / `cursorColumn`, so it is exempt from the conversion.

The FIM completion text is used as the model wrote it, except that **trailing newlines are stripped** — a model that ends its answer with a line break would otherwise insert a blank line. Leading whitespace is kept: it is the indentation the model chose for the code it is continuing.

`allowedPaths` holds the **absolute** paths — the same strings the prompt prints after `###PATH:`. The relative path the prompt also prints (`Current file: <relativePath>`) is not in `allowedPaths`, so an edit that answers with it is dropped.

The two prompt-building backends build their prompts with `buildNesSystemPrompt({ autoImport: config.autoImport })` and `buildNesUserPrompt({ ...input, autoImport: config.autoImport })`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/main/code-completion/completion-backends.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/code-completion
git commit -m "feat(code-completion): the Anthropic, OpenAI chat and FIM backends"
```

---

### Task 3: The completion service and its cache

**Files:**

- Create: `src/main/code-completion/completion-cache.ts`
- Create: `src/main/code-completion/completion-service.ts`
- Create: `src/main/code-completion/completion-cache.test.ts`
- Create: `src/main/code-completion/completion-service.test.ts`

**Interfaces:**

- Consumes: `NesBackend`, `NesRequest` (Task 2); `NesEditPlan` (Task 1).
- Produces:
  - `type CompletionCache = { get(key: string): NesEditPlan | null; set(key: string, plan: NesEditPlan): void; clear(): void }`
  - `createCompletionCache(options?: { ttlMs?: number; maxPerFile?: number; now?: () => number }): CompletionCache`
  - `completionCache: CompletionCache` — the **module-level singleton**. The service takes it when the caller injects none; a cache that lives only as long as the request is not a cache.
  - `completionCacheKey(input: { filePath: string; prefix: string; suffix: string; prefixStartLine: number; relatedFiles: readonly { path: string; content: string }[]; source: string }): string`
  - `type CompletionService = { plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult> }`
  - `createCompletionService(options: { resolveBackend: () => NesBackend | null; cache?: CompletionCache; now?: () => number }): CompletionService`

- [ ] **Step 1: Write the failing cache test**

Create `src/main/code-completion/completion-cache.test.ts`:

```ts
describe('completion cache', () => {
  it('returns a cached plan within the ttl', ...)
  it('expires a cached plan after the ttl', ...)
  it('keeps at most ten plans per file and evicts the least recently used', ...)
  it('keys a plan by the cursor context so a moved cursor misses', ...)
})
```

The ttl is 30 000 ms and the per-file cap is 10 — the values the spec fixes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/code-completion/completion-cache.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the cache**

Create `src/main/code-completion/completion-cache.ts`. The cache holds `{ plan, storedAt, lastUsedAt }` per key. `get` returns the plan when `now - storedAt < ttlMs` and refreshes `lastUsedAt`; otherwise it deletes the entry and returns null. `set` stores and, when the file has more than `maxPerFile` entries, evicts the one with the smallest `lastUsedAt`.

`completionCacheKey` hashes the file path, the prefix, the suffix, `prefixStartLine`, the related files' **paths and shown content**, and the **source** into one string. A moved cursor changes the prefix and suffix, so it misses. `prefixStartLine` is in the key because the plan's line numbers are absolute after the conversion (the spec's §5.5): the same text at a different offset is a different answer, and an edit above the prefix window changes the offset without changing the text. The related files' content is in the key because the model saw that content — a changed related file can change the answer — and because identical content implies an identical start line, which covers their offset too.

`source` names **who answered**: the protocol, the endpoint, the model and the auto-import switch. The cache is a module-level singleton, so without it a plan produced by one model is served to a request that would have gone to another — and turning the auto-import switch off would still surface the old model's import edit for the length of the ttl.

- [ ] **Step 4: Write the failing service test**

Create `src/main/code-completion/completion-service.test.ts`:

```ts
describe('completion service', () => {
  it('asks the backend once and serves the second identical request from the cache', ...)
  it('returns null when no backend is configured', ...)
  it('does not cache a failure', ...)
  it('gives up after the request timeout', ...)
  it('runs at most four requests at once', ...)
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test src/main/code-completion/completion-service.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 6: Write the service**

Create `src/main/code-completion/completion-service.ts`. The service:

1. resolves the backend through `resolveBackend()`; when it returns null it answers `null` without calling anything
2. looks the cache up by `completionCacheKey(input)`; a hit is returned immediately
3. otherwise calls `backend.plan(input, signal)` under an 8 000 ms timeout and a global concurrency cap of four (a queue that lets a fifth caller wait)
4. caches a **successful** plan and returns it; a failure returns `null` and caches nothing

A failure is silent to the user — that is the spec's rule — but it is **not** silent to the log: an endpoint 401, a 429 and a truncated stream are indistinguishable after the fact if nothing is written down. Log the failure with `console.error` (the repo's convention in `src/main`), leaving the abort and timeout paths out: the user typed, and that is not an error.

**Log only a fixed, safe set of facts — never the error object.** A caught exception can carry the request (with the API key in its headers) or the response (the model's answer, which is the user's source code); a `SyntaxError` from parsing a non-JSON answer includes a fragment of that answer in modern V8. So the log line carries the **backend id** and the error's **`name`** (a class name) — never the message, never the error object, never anything derived from the request or the response.

**An abort is not a failure to cache.** The backend distinguishes an aborted request from an endpoint error, and the service must not cache "nothing to propose" for an abort: the user kept typing, so the answer would be stale the moment it arrived. Check `signal.aborted` before caching.

- [ ] **Step 7: Run both test files**

Run: `pnpm test src/main/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/code-completion
git commit -m "feat(code-completion): the completion service and its cache"
```

---

### Task 4: The completion settings

**Files:**

- Create: `src/shared/code-completion/code-completion-settings.ts`
- Modify: `src/shared/code-completion/code-completion-types.ts` (derive `NesBackendId` from a runtime list)
- Modify: `src/shared/global-settings-base.ts` (intersect the new module in)
- Modify: `src/shared/default-global-settings.ts` (add the default block)
- Modify: `src/shared/rpc-contract/client-settings-params.ts` (add the field to the `.strict()` `SettingsUpdate` schema)
- Modify: `src/main/persistence/applying-settings/settings-update.ts` (normalize the block at the store boundary)
- Test: `src/main/persistence/applying-settings/settings-update*.test.ts` (the existing family in that directory)
- Create: `src/shared/code-completion/code-completion-settings.test.ts`

**Interfaces:**

- Consumes: `NesBackendId` from `src/shared/code-completion/code-completion-types.ts` (Task 1).
- Produces:
  - `type CodeCompletionSettings = { enabled: boolean; protocol: NesBackendId; baseUrl: string; model: string; triggerDelayMs: number; autoImport: boolean; enabledExtensions: string[] }`
  - `getDefaultCodeCompletionSettings(): CodeCompletionSettings`
  - `normalizeCodeCompletionSettings(value: unknown): CodeCompletionSettings`
  - `GlobalSettings['codeCompletion']` — optional, so an existing profile needs no migration

- [ ] **Step 1: Write the failing settings test**

Create `src/shared/code-completion/code-completion-settings.test.ts`:

```ts
describe('code completion settings', () => {
  it('defaults to enabled with no endpoint configured', ...)
  it('normalizes an unknown protocol back to the default', ...)
  it('normalizes a negative trigger delay to the default', ...)
  it('keeps a per-extension list', ...)
})
```

The defaults are: `enabled: true`, `protocol: 'anthropic-messages'`, `baseUrl: ''`, `model: ''`, `triggerDelayMs: 500`, `autoImport: true`, `enabledExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'rb', 'php', 'cs', 'swift', 'kt', 'scala', 'c', 'h', 'cpp', 'hpp', 'vue', 'svelte']`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/shared/code-completion/code-completion-settings.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the settings module**

Create `src/shared/code-completion/code-completion-settings.ts` exporting the type, `getDefaultCodeCompletionSettings()` and `normalizeCodeCompletionSettings(value)`. `normalizeCodeCompletionSettings` reads an unknown value defensively: a non-object becomes the defaults; each field falls back to its default when it is the wrong type; `triggerDelayMs` is clamped to 0…5000.

- [ ] **Step 4: Wire the settings into the global type and the defaults**

In `src/shared/global-settings-base.ts`, intersect the new module into `GlobalSettingsBase`:

```ts
export type GlobalSettingsBase = ... &
  CodeCompletionSettingsHolder
```

where `src/shared/code-completion/code-completion-settings.ts` also exports

```ts
export type CodeCompletionSettingsHolder = {
  /** Optional so an existing profile needs no migration. */
  codeCompletion?: CodeCompletionSettings
}
```

In `src/shared/default-global-settings.ts`, add `codeCompletion: getDefaultCodeCompletionSettings()` to the object `buildDefaultSettings` returns.

In `src/shared/rpc-contract/client-settings-params.ts`, add to the `SettingsUpdate` object:

```ts
    codeCompletion: z.unknown().transform((v) => normalizeCodeCompletionSettings(v)).optional(),
```

The `.strict()` schema rejects unknown keys, so this line is what lets a **runtime RPC** client save the block.

**The desktop renderer's write path does not go through that schema.** The renderer saves through the preload's `settings:set` IPC, which reaches `store.updateSettings` with the values as they were — so the block would persist verbatim, and a later consumer reading `settings.codeCompletion.enabled` could get a string. The repository's convention is to normalize a nested settings block at the **store boundary**, where every writer is covered (the renderer's IPC, the runtime RPC, the CLI, plugin hosts). Add it there, next to the other nested blocks:

```ts
if ('codeCompletion' in sanitizedUpdates) {
  sanitizedUpdates.codeCompletion = normalizeCodeCompletionSettings(sanitizedUpdates.codeCompletion)
}
```

in `src/main/persistence/applying-settings/settings-update.ts` (beside the `prBotAuthorOverrides` block), and cover it in that directory's existing test family.

**The load path normalizes too.** A profile file that was hand-edited, or that came from somewhere else, can carry a malformed block, and the loader is where the settings enter the system from disk. `src/main/persistence/loading-store/profile-loading/normalize-loaded-global-settings.ts` already normalizes `prBotAuthorOverrides`; normalize the completion block there as well, beside it.

**The normalizer resets the fields it is not given — it does not merge with the stored block.** A partial write such as `{ enabled: false }` rewrites `baseUrl`, `model` and `enabledExtensions` to their defaults. Whoever writes the settings UI must therefore send the **whole** block.

**The protocol list must be the source of truth, not a copy of it.** In `src/shared/code-completion/code-completion-types.ts`, make the runtime list the origin:

```ts
export const NES_BACKEND_IDS = [
  'anthropic-messages',
  'openai-chat',
  'openai-completions-fim'
] as const
export type NesBackendId = (typeof NES_BACKEND_IDS)[number]
```

and have the settings module import that list instead of declaring its own. A `satisfies readonly NesBackendId[]` check proves the list is a subset of the union, not the other way round — so a fourth protocol added to the union would be missing from the list, and the runtime check would fall back to the default protocol instead of failing to compile.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/shared/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm tc`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/code-completion src/shared/global-settings-base.ts src/shared/default-global-settings.ts src/shared/rpc-contract/client-settings-params.ts
git commit -m "feat(code-completion): the completion settings block"
```

---

### Task 5: The encrypted key store and its preload surface

**Files:**

- Create: `src/main/code-completion/code-completion-api-key-store.ts`
- Create: `src/main/code-completion/code-completion-credential-commands.ts`
- Create: `src/main/ipc/code-completion-credentials.ts`
- Create: `src/shared/code-completion/code-completion-credentials-status.ts`
- Create: `src/shared/code-completion/code-completion-credential-channels.ts`
- Create: `src/preload/api/code-completion-api.ts`
- Create: `src/preload/api/code-completion-bridge.ts`
- Modify: `src/renderer/src/web/preload-api/web-agent-accounts-api.ts` (the browser client's stub)
- Modify: `src/renderer/src/web/web-preload-api.ts` (register the stub)
- Modify: `src/main/orcad/orcad-plaintext-credential-migration.ts` (re-seal a plaintext key)
- Modify: `src/preload/api-types.ts` (register the API type)
- Modify: `src/preload/index.ts` (expose the bridge)
- Modify: `src/main/ipc/register-core-handlers/register-core-handlers.ts` (register the handlers)
- Create: `src/main/code-completion/code-completion-api-key-store.test.ts`
- Create: `src/main/code-completion/code-completion-credential-commands.test.ts`
- Create: `src/preload/code-completion-credentials.test.ts`

**Interfaces:**

- Consumes: `createEncryptedApiKeyFileStore` (`src/main/credentials/encrypted-api-key-file-store.ts`), the minimax credential pattern (`src/main/minimax/minimax-credential-commands.ts`, `src/main/ipc/minimax-credentials.ts`, `src/shared/minimax-credentials-status.ts`).
- Produces:
  - `hasCodeCompletionApiKey(): boolean`, `readCodeCompletionApiKey(): string | null`, `saveCodeCompletionApiKey(key: string): void`, `clearCodeCompletionApiKey(): void`, `getCodeCompletionApiKeyProtection(): SecretAtRestProtection | null`
  - `type CodeCompletionCredentialsStatus = { configured: boolean; protection: SecretAtRestProtection | null }` in `src/shared/code-completion/code-completion-credentials-status.ts`
  - `getCodeCompletionCredentialStatus(): CodeCompletionCredentialsStatus`, `saveCodeCompletionApiKeyCredential(key: unknown): CodeCompletionCredentialsStatus`, `clearCodeCompletionApiKeyCredential(): CodeCompletionCredentialsStatus` in `src/main/code-completion/code-completion-credential-commands.ts`
  - `type CodeCompletionCredentialsApi = { getStatus: () => Promise<CodeCompletionCredentialsStatus>; saveApiKey: (key: string) => Promise<CodeCompletionCredentialsStatus>; clearApiKey: () => Promise<CodeCompletionCredentialsStatus> }` exposed as `window.api.codeCompletion`

- [ ] **Step 1: Write the failing store test**

Create `src/main/code-completion/code-completion-api-key-store.test.ts`:

```ts
describe('code completion api key store', () => {
  it('reports no key before one is saved', ...)
  it('saves and reads a key back', ...)
  it('rejects an empty key', ...)
  it('clears a saved key', ...)
})
```

The store resolves its path at call time — `join(homedir(), '.orca', fileName)` — so the test isolates it by mocking `node:os`, `node:fs`, `node:path` and `../../shared/secure-storage/secure-file`, and it installs a stub secret store with `setSecretStore(...)` because `getSecretStore()` throws when no store is installed. `src/main/zcode/zcode-plan-api-key-store.test.ts` is the closest model in the repo: it mocks the same four modules, calls `setSecretStore({ ...safeStorageMock, describeProtectionGap: () => null })` in `beforeEach`, and re-imports the store with `vi.resetModules()` between cases (the store caches the key in a module-level closure).

- [ ] **Step 2: Run the store test to verify it fails**

Run: `pnpm test src/main/code-completion/code-completion-api-key-store.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the store**

Create `src/main/code-completion/code-completion-api-key-store.ts` following `src/main/minimax/minimax-api-key-store.ts` exactly:

```ts
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'

const store = createEncryptedApiKeyFileStore({
  fileName: 'code-completion-api-key.enc',
  envelopePrefix: 'orca-code-completion-api-key:v1:',
  providerLabel: 'Code completion',
  logScope: 'code-completion'
})

export const hasCodeCompletionApiKey = store.has
export const readCodeCompletionApiKey = store.read
export const saveCodeCompletionApiKey = store.save
export const clearCodeCompletionApiKey = store.clear
export const getCodeCompletionApiKeyProtection = store.protection
export const codeCompletionApiKeyEnvelopeFile = store.envelopeFile
```

`store.protection` reports how the key sits on disk — `'sealed'`, `'plaintext'` or `null` when there is no key — and the status type carries it so the settings UI can warn when the key is not sealed.

- [ ] **Step 4: Write the shared status type**

Create `src/shared/code-completion/code-completion-credentials-status.ts`:

```ts
import type { SecretAtRestProtection } from '../secret-at-rest-protection'

export type CodeCompletionCredentialsStatus = {
  configured: boolean
  /** How the stored key sits on disk, so the settings UI can warn when it is unsealed. */
  protection: SecretAtRestProtection | null
  /** Set when the saved file cannot be used here: 'sealed-elsewhere' means the other Orca app
   *  on that machine (desktop vs orcad) saved it. */
  unreadable?: 'sealed-elsewhere' | 'unreadable'
}
```

It lives in `src/shared/` because the main process, the preload and the renderer all speak it — the same reason `src/shared/minimax-credentials-status.ts` exists. The `unreadable` union is spelled out inline rather than imported: `src/shared/` must not depend on `src/main/`, and `src/shared/minimax-credentials-status.ts` already declares the same union inline.

- [ ] **Step 5: Write the failing command test**

Create `src/main/code-completion/code-completion-credential-commands.test.ts`. The command layer is where the untrusted-argument checks live, so it gets its own test — the store test cannot reach them. Mock `./code-completion-api-key-store` so the test never touches the real home directory.

```ts
describe('code completion credential commands', () => {
  it('reports no key when none is saved', ...)
  it('reports the key as configured after a save', ...)
  it('rejects a key that is not a string', ...)
  it('rejects a key with an interior newline', ...)
  it('clears the key', ...)
})
```

The two rejection cases are the ones that matter: the value arrives over IPC and is untrusted, and the key becomes an HTTP `Authorization` header value, so an interior newline cannot be sent. Each must fail if the check is reverted.

- [ ] **Step 6: Run the command test to verify it fails**

Run: `pnpm test src/main/code-completion/code-completion-credential-commands.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 7: Write the credential commands**

Create `src/main/code-completion/code-completion-credential-commands.ts`, mirroring `src/main/minimax/minimax-credential-commands.ts`:

- `getCodeCompletionCredentialStatus(): CodeCompletionCredentialsStatus` — `configured` is `hasCodeCompletionApiKey()`, and `protection` is `getCodeCompletionApiKeyProtection()` when a key exists, `null` otherwise.
- `saveCodeCompletionApiKeyCredential(key: unknown): CodeCompletionCredentialsStatus` — the argument is untrusted because it arrives over IPC: reject anything that is not a string. Then **trim** the key and reject it if what remains contains a newline (the key becomes an HTTP `Authorization` header value, so an interior newline cannot be sent). Trimming first means a key pasted with a trailing newline is accepted while an interior one is refused — the rule `src/main/zcode/zcode-plan-api-key-store.ts` already uses. The factory's own `save` rejects an empty key; the command layer adds the type check.
- `clearCodeCompletionApiKeyCredential(): CodeCompletionCredentialsStatus` — clears the key and returns the status.

The API key never enters the settings, the RPC params catalog, a cache key or a log line.

- [ ] **Step 8: Write the preload surface**

Create `src/preload/api/code-completion-api.ts`:

```ts
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export type CodeCompletionCredentialsApi = {
  getStatus: () => Promise<CodeCompletionCredentialsStatus>
  saveApiKey: (key: string) => Promise<CodeCompletionCredentialsStatus>
  clearApiKey: () => Promise<CodeCompletionCredentialsStatus>
}
```

Create `src/preload/api/code-completion-bridge.ts`:

```ts
import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { CodeCompletionCredentialsStatus } from '../../shared/code-completion/code-completion-credentials-status'

export const codeCompletionApi = {
  getStatus: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke('codeCompletion:getCredentialStatus'),
  saveApiKey: (key: string): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke('codeCompletion:saveApiKey', key),
  clearApiKey: (): Promise<CodeCompletionCredentialsStatus> =>
    ipcRenderer.invoke('codeCompletion:clearApiKey')
} satisfies PreloadApi['codeCompletion']
```

Register `codeCompletion: CodeCompletionCredentialsApi` in `src/preload/api-types.ts` (with the type import) and `codeCompletion: codeCompletionApi` in `src/preload/index.ts` (with the bridge import).

Create `src/main/ipc/code-completion-credentials.ts`:

```ts
export function registerCodeCompletionCredentialHandlers(): void {
  ipcMain.handle('codeCompletion:getCredentialStatus', () => getCodeCompletionCredentialStatus())
  ipcMain.handle('codeCompletion:saveApiKey', (_event, key: unknown) =>
    saveCodeCompletionApiKeyCredential(key)
  )
  ipcMain.handle('codeCompletion:clearApiKey', () => clearCodeCompletionApiKeyCredential())
}
```

Register `registerCodeCompletionCredentialHandlers()` in `src/main/ipc/register-core-handlers/register-core-handlers.ts` alongside the minimax credential handlers.

- [ ] **Step 9: Write the failing bridge test**

Create `src/preload/code-completion-credentials.test.ts`, following `src/preload/opencode-go-credentials.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { codeCompletionApi } from './api/code-completion-bridge'

const invoke = vi.hoisted(() => vi.fn(async () => ({ configured: true, protection: null })))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

describe('Code completion credential bridge', () => {
  it('exposes only status and write operations', async () => {
    expect(await codeCompletionApi.getStatus()).toEqual({ configured: true, protection: null })
    await codeCompletionApi.saveApiKey('fake-key')
    await codeCompletionApi.clearApiKey()
    expect(invoke.mock.calls).toEqual([
      ['codeCompletion:getCredentialStatus'],
      ['codeCompletion:saveApiKey', 'fake-key'],
      ['codeCompletion:clearApiKey']
    ])
    expect(Object.keys(codeCompletionApi)).toEqual(['getStatus', 'saveApiKey', 'clearApiKey'])
  })
})
```

The channel names are the contract between this bridge and the main-process handlers; a typo in either side would only show up as a settings UI that silently does nothing (Task 12). This test fails if either side's name changes.

- [ ] **Step 10: Run the bridge test to verify it fails**

Run: `pnpm test src/preload/code-completion-credentials.test.ts --maxWorkers=2`
Expected: FAIL — the bridge does not exist.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `pnpm test src/main/code-completion src/preload/code-completion-credentials.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 12: Typecheck**

Run: `pnpm tc:node && pnpm tc:web`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add src/main/code-completion src/main/ipc/code-completion-credentials.ts src/main/ipc/register-core-handlers src/preload src/shared/code-completion
git commit -m "feat(code-completion): store the completion API key outside the settings"
```

---

### Task 6: The RPC method family

**Files:**

- Create: `src/shared/rpc-contract/code-completion-params.ts`
- Create: `src/main/runtime/rpc/methods/code-completion/code-completion-methods.ts`
- Modify: `src/main/runtime/rpc/methods/rpc-method-registry.ts` (import and spread)
- Modify: `src/shared/code-completion/code-completion-types.ts` (the import label prefix)
- Modify: `src/shared/code-completion/code-completion-prompt.ts` (the import rule)
- Modify: `src/main/code-completion/completion-backend.ts` (the import's absolute position)
- Modify: `src/shared/code-completion/code-completion-prompt.test.ts` (the import rule)
- Modify: `src/main/code-completion/completion-backends.test.ts` (the import's position)
- Regenerate: `src/shared/rpc-contract/rpc-params-catalog.generated.ts`
- Create: `src/main/runtime/rpc/methods/code-completion/code-completion-methods.test.ts`

**Interfaces:**

- Consumes: `createCompletionService` (Task 3), the runtime's settings store (`runtime.requireStore().getSettings()`), `readCodeCompletionApiKey` (Task 5), `NesBackendId` (Task 2), `NesRequest` (Task 2).
- Produces: the RPC method `codeCompletion.plan`, callable as `callRuntimeRpc(target, 'codeCompletion.plan', params)`.

- [ ] **Step 1: Write the params schema**

Create `src/shared/rpc-contract/code-completion-params.ts`:

```ts
import { z } from 'zod'
import { NesEditPlan } from '../code-completion/code-completion-types'

export const CodeCompletionRelatedFile = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** The file line the shown content starts at, 1-based. */
  startLine: z.number().int().positive()
})

export const CodeCompletionRecentEdit = z.object({
  path: z.string().min(1),
  label: z.string()
})

export const CodeCompletionPlan = z.object({
  filePath: z.string().min(1),
  relativePath: z.string(),
  languageId: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  /** The file line the shown prefix starts at, 1-based. */
  prefixStartLine: z.number().int().positive(),
  /** The cursor's absolute position in the file, 1-based. */
  cursorLine: z.number().int().positive(),
  cursorColumn: z.number().int().positive(),
  relatedFiles: z.array(CodeCompletionRelatedFile).max(8).default([]),
  recentEdits: z.array(CodeCompletionRecentEdit).max(10).default([])
})

export const CodeCompletionPlanResult = z.object({
  plan: NesEditPlan.nullable()
})
```

`CodeCompletionPlanResult` is the method's declared result type — the handler's return value is typed with it, so it is not a dead export. It is built on the real plan type, not on `z.unknown()`: a result type of `{ plan: unknown }` says nothing about what comes back. The backends already return a validated plan, so it parses.

The renderer still re-validates (Task 7), because only the renderer holds the file's text and can check the `originalText` — a content check, not a structural one.

- [ ] **Step 2: Write the failing method test**

Create `src/main/runtime/rpc/methods/code-completion/code-completion-methods.test.ts`:

```ts
describe('codeCompletion.plan', () => {
  it('returns a plan from the completion service', ...)
  it('returns null when the feature is disabled', ...)
  it('returns null when no endpoint is configured', ...)
  it('returns null when no API key is stored', ...)
  it('never returns the API key to the caller', ...)
  it('answers no plan when the saved key cannot be read', ...)
})
```

The last case is the one that matters: assert that the serialized response contains neither the key nor the base URL's credentials. The second-to-last is the inert-not-broken rule: a key file that cannot be read or decrypted — corrupt, or sealed by the other Orca app on this machine — must answer `{ plan: null }` rather than fail the call.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/main/runtime/rpc/methods/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write the method family**

Create `src/main/runtime/rpc/methods/code-completion/code-completion-methods.ts`:

```ts
import { defineMethod } from '../../core'
import {
  CodeCompletionPlan,
  CodeCompletionPlanResult
} from '../../../../../shared/rpc-contract/code-completion-params'
import { createCompletionService } from '../../../../code-completion/completion-service'
import { createAnthropicMessagesBackend } from '../../../../code-completion/anthropic-messages-backend'
import { createOpenAiChatBackend } from '../../../../code-completion/openai-chat-backend'
import { createOpenAiFimBackend } from '../../../../code-completion/openai-fim-backend'
import { readCodeCompletionApiKey } from '../../../../code-completion/code-completion-api-key-store'

export const CODE_COMPLETION_METHODS = [
  defineMethod({
    name: 'codeCompletion.plan',
    permission: 'workspace',
    params: CodeCompletionPlan,
    handler: async (params, { runtime, signal }): Promise<CodeCompletionPlanResult> => {
      const settings = runtime.requireStore().getSettings().codeCompletion
      if (!settings?.enabled) {
        return { plan: null }
      }
      // Why: a key file that cannot be read or decrypted must make the feature *inert*,
      // not broken. The credential status (Task 5) reports that state to the settings UI.
      let apiKey: string | null = null
      try {
        apiKey = readCodeCompletionApiKey()
      } catch {
        return { plan: null }
      }
      if (!apiKey || !settings.baseUrl || !settings.model) {
        return { plan: null }
      }
      const service = createCompletionService({
        resolveBackend: () =>
          createBackend(settings.protocol, {
            baseUrl: settings.baseUrl,
            model: settings.model,
            apiKey,
            maxTokens: 2000,
            autoImport: settings.autoImport
          })
      })
      const result = await service.plan(
        {
          filePath: params.filePath,
          relativePath: params.relativePath,
          languageId: params.languageId,
          prefix: params.prefix,
          suffix: params.suffix,
          prefixStartLine: params.prefixStartLine,
          cursorLine: params.cursorLine,
          cursorColumn: params.cursorColumn,
          relatedFiles: params.relatedFiles,
          recentEdits: params.recentEdits
        },
        signal ?? new AbortController().signal
      )
      return { plan: result.plan }
    }
  })
]
```

`createBackend` maps the protocol id to the three backend factories:

```ts
function createBackend(protocol: NesBackendId, config: NesBackendConfig): NesBackend {
  switch (protocol) {
    case 'anthropic-messages':
      return createAnthropicMessagesBackend(config)
    case 'openai-chat':
      return createOpenAiChatBackend(config)
    case 'openai-completions-fim':
      return createOpenAiFimBackend(config)
  }
}
```

The switch is exhaustive over `NesBackendId`, so a fourth protocol fails to compile rather than falling back at runtime. The **cache** is a module-level singleton (`completionCache` in `src/main/code-completion/completion-cache.ts`) that the service takes when the caller injects none — a cache that lives only as long as the request is not a cache. The service itself is still created per call, because the backend it resolves depends on the settings at that moment.

**Read the settings from the store, not from the client projection.** `runtime.getClientSettings()` returns the _paired-client_ projection (`RuntimeClientSettingsController.get()`), which deliberately omits the completion block — a phone has no editor and must not receive the endpoint and model settings. The handler reads the desktop's own settings with `runtime.requireStore().getSettings().codeCompletion`, the pattern the other settings-reading RPC methods use.

- [ ] **Step 5: Register the family**

In `src/main/runtime/rpc/methods/rpc-method-registry.ts`, import `CODE_COMPLETION_METHODS` and spread it into `ALL_RPC_METHODS`.

- [ ] **Step 6: Land the auto-import at the top of the file**

The prompt tells the model to "propose an `insert` edit at the top of the file that adds the import". But the model only ever sees the _shown_ content, and the prefix is trimmed from the front to fit the token budget — so the model's "top of the file" is the shown line 1, and the backend's relative-to-absolute translation (adding `prefixStartLine - 1`) would put the import at `prefixStartLine`: **in the middle of the file**. An import statement in the middle of a file body is broken code, and the model cannot fix it — it has no way to name the file's absolute line 1.

**The edit must carry a marker.** Add `NES_IMPORT_LABEL_PREFIX = 'import: '` to `src/shared/code-completion/code-completion-types.ts` — one definition that the prompt and the backend both import, the way `NES_PATH_HEADER_PREFIX` and `NES_CURSOR_MARKER` work today. The prompt's import sentence ends with "…and give the edit the label `import: <what it imports>`". The backend's `translateNesEditLines` maps an insert whose label starts with the prefix to **file line 1, column 1** for the current file, whatever the prefix's offset. The rule is **per file, not per current file**: a related file is shown from its own first line, so its import belongs at its own line 1.

**The import text must end with a line break.** The backend owns the import's insertion point, so it owns the text that goes with it. A model that answers `"import { z } from 'zod'"` with no trailing newline would otherwise be inserted at 1:1 and concatenated with the file's existing first line — `import { z } from 'zod'import React from 'react'`. The `originalText` guard cannot catch it: an insert's `originalText` is the empty string, which matches the empty range at 1:1. So the import branch appends a line break when the text does not end with one.

**The cursor's line carries the marker, so its columns must be corrected.** The prompt is
`${prefix}${NES_CURSOR_MARKER}${suffix}` — the marker sits **inline**, in the middle of the
cursor's line. That line, as the model sees it, is

```
<the file's columns 1 … cursorColumn-1><<<CURSOR>>>><the file's columns cursorColumn …>
```

so every column **after** the cursor is shifted right by the marker's length (12 characters), while
the columns before it are not. The model answers with the columns it counted, and the backend
converts **lines only** — it leaves columns verbatim, because the prompt gives the cursor only as a
marker and never as a number the backend could compare against.

A model that treats the marker as text therefore answers a column 12 too far right. That is not a
cosmetic error: the renderer finds the cursor's edit by matching the range's end against the
cursor (`nesEditMatchesPosition`), so a column that is 12 out **means no suggestion is ever
offered** — and if it does match, the accepted edit is spliced 12 characters away from where the
user is typing.

**So the backend corrects the columns on the cursor's line.** For the current file only, a column
`P` on the cursor's line maps back to the file's column as:

- `P < cursorColumn` → `P` (before the marker — unchanged)
- `cursorColumn ≤ P < cursorColumn + NES_CURSOR_MARKER.length` → inside the marker; no valid answer
  lands here, so the value is left as it is
- `P ≥ cursorColumn + NES_CURSOR_MARKER.length` → `P - NES_CURSOR_MARKER.length` (after the marker)

The rule is applied to a column **only when that column's own line is the cursor's line**, and only
for the **current** file — a related file carries no marker, and every other line of the current
file is shown whole. The correction therefore leaves a `replace` that ends _before_ the cursor
alone, and fixes one that ends after it.

`NES_CURSOR_MARKER` is already defined once in `src/shared/code-completion/code-completion-prompt.ts`
and read by both sides; the backend imports it rather than hardcoding 12.

**The prompt states the convention, because the correction depends on it.** The correction is a
blind subtraction: it assumes the model counts the marker as the characters it is. The system prompt
must therefore say so — one line, interpolated from `NES_CURSOR_MARKER.length`, never a literal:

> The cursor marker `<<<CURSOR>>>` occupies twelve columns of the content, so count those columns
> when you answer; the cursor is at the marker.

Without it the prompt is ambiguous about the one thing the backend's correction depends on. The
correction never touches the **cursor edit's own column** — the cursor's column is `cursorColumn`,
and the correction only fires at `cursorColumn + NES_CURSOR_MARKER.length` or beyond — so the
correction makes the cursor edit correct under **both** readings of "where the cursor is": a model
answering the marker's first column is left alone, and a model answering the column after the
marker is corrected.

Tests:

- in `code-completion-prompt.test.ts`: the import sentence names the label prefix.
- in `completion-backends.test.ts`: an import edit in a plan for a **trimmed** prefix lands on file line 1; a non-import insert at the same shown line keeps its translated position; and an import whose text has no trailing newline comes back **with** one, so it cannot be concatenated with the file's first line. Without these, the import silently lands mid-file or produces a broken first line.
- in `completion-backends.test.ts`: an edit whose column on the cursor's line is past the marker comes back with the marker's length subtracted, and one whose column is before the cursor comes back unchanged; an edit in a **related** file comes back with its columns untouched. Without these, a model that counts the marker as text produces a suggestion the renderer can never match to the cursor.

This task re-touches Task 1's and Task 2's files — the marker has to be defined once and read by both sides, and splitting it across two tasks would cost a context handover for three lines.

- [ ] **Step 7: Regenerate the params catalog**

Run: `pnpm generate:rpc-params-catalog`
Expected: `src/shared/rpc-contract/rpc-params-catalog.generated.ts` now carries a `codeCompletion.plan` entry.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test src/main/runtime/rpc/methods/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm tc:node`
Expected: no errors — the params-catalog parity gate runs here.

- [ ] **Step 10: Commit**

```bash
git add src/shared/rpc-contract src/main/runtime/rpc
git commit -m "feat(code-completion): the codeCompletion.plan RPC method"
```

---

### Task 7: The renderer client, the context builder and the related files

**Files:**

- Create: `src/renderer/src/components/editor/code-completion/nes-runtime-client.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-context-builder.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-context-builder.test.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-related-files.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-related-files.test.ts`

**Interfaces:**

- Consumes: `callRuntimeRpc` (`src/renderer/src/runtime/rpc/calls/runtime-rpc-call.ts`), the existing worktree search (`searchRuntimeFiles`, client at `src/renderer/src/runtime/files/search/runtime-file-search-client.ts`), the existing file read (`readRuntimeFileContent`, client at `src/renderer/src/runtime/files/reads/runtime-file-read-client.ts`), `getRelativePathInsideWorktree` (`src/renderer/src/runtime/files/runtime-file-routing.ts`), `NesRequest` (Task 2), the edit-plan contract (Task 1).

**Use the runtime clients, not `window.api.fs`.** The editor buffer holds the file's text even when the file lives on an SSH host, but a _related_ file is only on that host. `searchRuntimeFiles` takes a `RuntimeFileOperationArgs` (`{ target, worktreeId, worktreePath, connectionId }`) and routes to the local or the remote side; `readRuntimeFileContent` takes a `RuntimeFileReadArgs` — a _different_ type, with no `worktreePath`. `window.api.fs.readFile` would silently read the wrong machine's path.

The read is therefore assembled field by field, and the path is made root-relative with the repo's own helper, because a remote read is root-relative:

```ts
const result = await readRuntimeFileContent({
  target: input.files.target,
  worktreeId: input.files.worktreeId ?? undefined,
  connectionId: input.files.connectionId,
  filePath: path,
  relativePath: getRelativePathInsideWorktree(input.files.worktreePath, path) ?? undefined
})
```

`readRuntimeFileContent` answers `{ content, isBinary, ... }` — a **binary** result is dropped, since the model cannot read a PNG.

- Produces:
  - `requestNesPlan(input: NesRequest, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<NesEditPlan | null>`
  - `buildNesContext(model: editor.ITextModel, position: IPosition, options): NesContextInput`
  - `type NesContextInput = { prefix: string; suffix: string; filePath: string; relativePath: string; languageId: string; prefixStartLine: number; cursorLine: number; cursorColumn: number }`
  - `collectNesRelatedFiles(input: NesRelatedFilesInput): Promise<{ path: string; content: string; startLine: number }[]>`
  - `type NesRelatedFilesInput = { filePath: string; fileText: string; symbolAtCursor: string | null; files: RuntimeFileOperationArgs }`
  - `NES_RELATED_FILE_MAX = 8`, `NES_RELATED_FILE_TOKEN_BUDGET = 1000`

- [ ] **Step 1: Write the failing context test**

Create `src/renderer/src/components/editor/code-completion/nes-context-builder.test.ts`:

```ts
describe('buildNesContext', () => {
  it('puts the cursor between the prefix and the suffix', ...)
  it('keeps the prefix within its budget and the suffix whole', ...)
  it('reads the file path and the language from the model', ...)
})
```

The budgets are 4000 tokens for the prefix and 1000 for the suffix. Approximate a token as four characters; the test asserts the prefix is truncated to at most 16 000 characters and that the suffix is never truncated while it fits in 4 000 characters.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the context builder**

Create `src/renderer/src/components/editor/code-completion/nes-context-builder.ts`:

`IPosition` is imported from `'monaco-editor'` directly — `import type { IPosition } from 'monaco-editor'`, the way `src/renderer/src/components/editor/monaco-codebase-search.ts` does. It is **not** `editor.IPosition`: Monaco exports it at the module's top level.

```ts
export const NES_PREFIX_TOKEN_BUDGET = 4000
export const NES_SUFFIX_TOKEN_BUDGET = 1000
export const NES_CHARS_PER_TOKEN = 4

export function buildNesContext(
  model: editor.ITextModel,
  position: IPosition,
  options: { filePath: string; relativePath: string }
): NesContextInput
```

The prefix is the text before the cursor, trimmed from the front to the character budget; the suffix is the text after it, trimmed from the back to its budget. The suffix is trimmed from the back, not the front, because the text right after the cursor matters most.

**The prefix is trimmed at a line boundary**, and the result carries the line it starts at (`prefixStartLine`) and the cursor's absolute position (`cursorLine` / `cursorColumn`). The model sees a fragment of the file and answers with line numbers relative to that fragment; the backend converts them back to absolute (the spec's §5.5). Trimming mid-line would make the shown text's first line a partial one and the cursor's column ambiguous.

`NesContextInput` therefore also carries `prefixStartLine`, `cursorLine` and `cursorColumn`. The related files carry their own `startLine` the same way — a related file shown from its first line has `startLine: 1`.

- [ ] **Step 4: Write the failing related-files test**

Create `src/renderer/src/components/editor/code-completion/nes-related-files.test.ts`:

```ts
describe('collectNesRelatedFiles', () => {
  it('resolves the relative imports of the current file', ...)
  it('keeps a package import out of the results', ...)
  it('adds the files that mention the symbol at the cursor', ...)
  it('never returns more than eight files', ...)
  it('gives every file at most a thousand tokens', ...)
  it('still resolves the relative imports when there is no worktree, and does not search', ...)
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 6: Write the related-files collector**

Create `src/renderer/src/components/editor/code-completion/nes-related-files.ts`:

```ts
export const NES_RELATED_FILE_MAX = 8
export const NES_RELATED_FILE_TOKEN_BUDGET = 1000

export function parseRelativeImports(fileText: string, filePath: string): string[]
export async function collectNesRelatedFiles(
  input: NesRelatedFilesInput
): Promise<{ path: string; content: string; startLine: number }[]>
```

`NES_CHARS_PER_TOKEN` lives in `nes-context-builder.ts` and is **imported** here — one definition of "how many characters a token is", so the two budgets cannot drift apart. Every returned file carries `startLine: 1`, because a related file is always shown from its first line.

Two sources, in this order:

1. **The current file's relative imports.** `parseRelativeImports` pulls the module specifiers out of the import statements and keeps only the ones that start with `./` or `../` — a package import names a module the model already knows, not a file in this repository. Each relative specifier resolves against the current file's directory; the extension is tried as written, then with `.ts`, `.tsx`, `.js`, `.jsx` and `/index.ts`, `/index.tsx`.
2. **The files that mention the symbol at the cursor.** `searchRuntimeFiles(context, options, signal?)` takes a `RuntimeFileOperationArgs` and a `SearchOptions` whose `rootPath` is **required**. When `symbolAtCursor` is a plain identifier, call `searchRuntimeFiles(input.files, { query: symbolAtCursor, rootPath: input.files.worktreePath ?? '', maxResults: 20 })` — but only when `input.files.worktreePath` is set. **A missing worktree path means no search at all**: `rootPath` is required, and searching with an empty root path would sweep the whole filesystem. **A missing worktree path means no _search_, not no related files.** The guard belongs to the search, not to the collector: an import-driven read needs no root at all — the read takes an absolute `filePath` and an _optional_ `relativePath`, and `getRelativePathInsideWorktree` returning null means "no root-relative path", not "unreadable". So when there is no worktree path the collector still resolves the current file's **relative imports**; it just does not search. A **folder workspace** — a first-class case this repo calls out ("never assume a workspace is a git worktree") — has no worktree path, and its imports are perfectly readable.

Then take the files whose matches include the symbol's definition — the file that declares it wins over the files that merely call it.

**Drop the vendored and tool-generated paths from the search results.** The content search has **no product-level ignore list** — the only hard-coded exclusion is `--glob !.git`, and everything else depends on ripgrep's own ignore handling, which reads `.gitignore` **only when the search root is inside a git repository**. In a folder workspace — not a git repo — `node_modules` comes back, and a package that declares a symbol of the same name is ranked as a "definition" and read as a related file.

The repo already has the policy: `shouldIncludeQuickOpenPath(path)` in
`src/shared/quick-open/quick-open-filter.ts` walks the path's segments and rejects the
hidden-directory blocklist plus `node_modules`. **Use it; do not write a second list.** Apply it to
the **search results** only, not to the import-driven files: a relative import points at a file the
author wrote, a search result is a guess.

**Apply it to the result's root-relative path, not to its absolute path.** The predicate is a
segment blocklist, and every other caller in the repo hands it a path relative to the search root.
Handed an absolute path, an ancestor directory named `.cache`, `.git`, `.npm` or `.gvfs` takes the
whole result set with it — a workspace under `~/.cache/<repo>` silently loses every symbol-derived
related file. Normalize the separators first (`normalizeRelativePath` from
`src/shared/cross-platform-path.ts`): the predicate splits on `/`, and the relative path can be
Windows-style.

**The search's cap counts matches, not files.** `SearchOptions.maxResults` caps the total number of
matches, so a file with ten occurrences of the symbol consumes ten of the cap — and the symbol's own
**definition**, the one file the ranking wants most, is then never in the results. The cap is
**200**: the search runs per file and is cached, so the cost is amortized, and the results are
capped at `NES_RELATED_FILE_MAX` (8) afterwards anyway.

Each result is read through `readRuntimeFileContent`, truncated to `NES_RELATED_FILE_TOKEN_BUDGET` tokens from the front, and the list is capped at `NES_RELATED_FILE_MAX`. A file that cannot be read is dropped.

**Caching.** The caller caches the result per file path and refreshes it when the file is saved or after five idle seconds — running a worktree search on every keystroke pause is not affordable. Keep the cache in `nes-related-files.ts` and expose `clearNesRelatedFilesCache(filePath: string): void`.

- [ ] **Step 7: Write the runtime client**

Create `src/renderer/src/components/editor/code-completion/nes-runtime-client.ts`:

```ts
export async function requestNesPlan(
  input: NesRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NesEditPlan | null>
```

It calls `callRuntimeRpc<CodeCompletionPlanResult>({ kind: 'local' }, 'codeCompletion.plan', input, { signal: options.signal, timeoutMs: options.timeoutMs ?? 12_000 })`, then validates `response.plan` with `NesEditPlan.safeParse` and returns null when the payload does not parse.

**The timeout is the renderer's own, not the transport's.** `callRuntimeRpc` forwards `signal` and `timeoutMs` only on the `environment` branch; on the `local` branch it calls `window.api.runtime.call({ method, params })` and drops both. So the request cannot be cancelled, and the caller's `timeoutMs` never fires. `requestNesPlan` therefore races the call against its own timer and returns `null` when the timer wins — the underlying request may still complete, and its answer is discarded by the hook's generation counter (Task 10).

The completion talks to the **local** runtime even when the file lives on a remote host: the buffer is already in the renderer, and the endpoint is the user's own.

- [ ] **Step 8: Run the tests**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/editor/code-completion
git commit -m "feat(code-completion): the renderer client, the context and the related files"
```

---

### Task 8: The plan store and the location markers

**Files:**

- Create: `src/renderer/src/components/editor/code-completion/nes-plan-store.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-location-markers.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-plan-store.test.ts`
- Modify: `src/shared/code-completion/code-completion-types.ts` (add the predicate below)
- Test: `src/shared/code-completion/code-completion-types.test.ts` (the predicate's own cases)

**Interfaces:**

- Consumes: `NesEdit`, `NesEditPlan` (Task 1).
- Produces:
  - `nesEditExtendsCoveredText(edit: NesEdit): boolean` — **in `src/shared/code-completion/code-completion-types.ts`**, beside the module-private `isApplicableNesEdit`. It answers "does this edit only append to the text its range covers?" and is `edit.text.length > edit.originalText.length && edit.text.startsWith(edit.originalText)`.
  - `type NesPlanStore = { bindModel(modelKey: string, filePath: string): void; setPlan(filePath: string, plan: NesEditPlan): void; getPlan(filePath: string): NesEditPlan | null; editAt(modelKey: string, position: { lineNumber: number; column: number }): NesEdit | null; editsForPath(filePath: string): NesEdit[]; remove(filePath: string): void; clear(): void }`
  - `createNesPlanStore(): NesPlanStore`
  - `nesPlanStore: NesPlanStore` — the module-level singleton the provider and the hook share. The provider is registered globally (Task 9) but the plan belongs to the open editor, so both sides must reach the same store.
  - `nesEditMatchesPosition(edit: NesEdit, position: { lineNumber: number; column: number }): boolean`
  - `type NesLocationMarker = { edit: NesEdit; lineNumber: number }`
  - `nesLocationMarkers(edits: readonly NesEdit[], cursor: { lineNumber: number; column: number }): NesLocationMarker[]`
  - `nesMarkerDecorations(markers: readonly NesLocationMarker[]): editor.IModelDeltaDecoration[]` — the **pure** builder, so the decoration's shape is testable without a Monaco instance
  - `createNesMarkerDecorations(editorInstance: editor.IStandaloneCodeEditor, markers: readonly NesLocationMarker[]): editor.IEditorDecorationsCollection` — creates the collection and sets the decorations

**Why the store is keyed by model as well as by path.** The provider (Task 9) is registered globally and gets only a Monaco model. The model URI _does_ carry the path — `toEditorModelUri` builds it as `vscode-remote:<hashed-owner-authority>/<path>` — but its **authority is a hash of the owner key**, so the URI alone cannot say _which host's_ editor it is. Two editors on different hosts can show the same path with different URIs. The editor hook (Task 10) _does_ know the path — it is a prop of `MonacoEditor` — so the hook binds the model's URI string to the path, and the provider asks the store by model key.

- [ ] **Step 1: Write the failing store test**

Create `src/renderer/src/components/editor/code-completion/nes-plan-store.test.ts`:

```ts
describe('nes plan store', () => {
  it('finds the edit whose range ends at the cursor', ...)
  it('finds nothing when the cursor moved past the edit', ...)
  it('finds nothing when the cursor moved before the edit', ...)
  it('resolves a bound model to the plan of its file', ...)
  it('lists the edits of another file that a plan mentions', ...)
  it('does not list an edit of a file the plan never named', ...)
})

describe('nes location markers', () => {
  it('leaves out the edit whose range ends at the cursor', ...)
  it('keeps the marker for a cursor edit that only rewrites', ...)
  it('marks an edit at another line with the line it starts on', ...)
})
```

The predicate's own cases go in the shared module's test file, `src/shared/code-completion/code-completion-types.test.ts`:

```ts
describe('nesEditExtendsCoveredText', () => {
  it('accepts an insert, whose covered text is empty', ...)
  it('accepts a replace that only appends to the covered text', ...)
  it('refuses a replace that rewrites the covered text', ...)
  it('refuses a replace that shortens the covered text', ...)
  it('refuses a delete', ...)
  it('refuses an edit that changes nothing', ...)
})
```

The second block is not optional: `nesLocationMarkers` is the selection rule the spec's second layer rests on, and the cursor edit must not also become a gutter marker — the cursor edit is the _suggestion_, and a marker on it would draw the user to the line they are already on.

**But only the cursor edit that is actually the suggestion leaves no marker.** An edit that ends at the cursor and cannot be shown as an inline suggestion was never shown to the user at all, so the marker is what makes it reachable — the second layer doing the first layer's job. `nesEditExtendsCoveredText` is the test for "can this be shown inline", so the rule is: **an edit leaves the marker list when its range ends at the cursor _and_ it extends the covered text.**

**Why the predicate lives in the shared contract module.** Three places need the same answer — this
marker rule, the provider's offer decision (Task 9) and the Tab routing (Task 10) — and they must
agree. If the provider refuses an edit the marker list still excludes, the edit is unreachable; if
the routing accepts an edit the provider refused, Tab rewrites the user's code with no preview. One
exported predicate, imported by all three, is what keeps them from drifting apart.

`nesEditMatchesPosition` is the rule the spec fixes: **an edit matches the cursor when the cursor sits at the edit's range end**; an `insert` has `start === end`, so the cursor must be exactly there.

**Two edits can match the same position.** The import edit's position is **synthetic** — the backend
forces it to file line 1, column 1 (Task 6) — while the cursor edit's position is where the user is
typing. When the user is typing at exactly 1:1, both sit at the same position and both match.

**`editAt` returns the first matching edit in the plan's order.** No special case for the import:
giving the import its own priority would make either the import or the code the user is typing
unreachable, because `nesLocationMarkers` excludes every edit whose range end is the cursor
position, so the loser of that priority would show no gutter marker and Tab could never reach it.

The accepted consequence: in that degenerate case one of the two edits is unreachable. It is rare —
the user typing at column 1 of line 1 — and inherent: an import and an insert at the same point are
the same point.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the store and the marker selection**

Create `src/renderer/src/components/editor/code-completion/nes-plan-store.ts` with the types above. The store keeps two maps: `modelKey → filePath` (the bindings the hook makes) and `filePath → plan` (the plans that arrived). `editAt(modelKey, position)` resolves the model to its file, then returns that file's edit whose range end equals the position. `editsForPath(filePath)` returns every edit any stored plan makes in that file — that is how a file the user is _not_ in still shows its marker.

Create `src/renderer/src/components/editor/code-completion/nes-location-markers.ts` with `nesLocationMarkers(edits, cursor)`: the given edits whose range end is **not** the cursor position **or** that do not extend the covered text (per `nesEditExtendsCoveredText`), each with the line of its range start. The predicate itself goes in the shared contract module, not here — add it and its cases before writing the marker rule.

- [ ] **Step 4: Write the marker decoration**

In the same file, add two functions — the **pure** builder and the collection creator:

```ts
export function nesMarkerDecorations(
  markers: readonly NesLocationMarker[]
): editor.IModelDeltaDecoration[]

export function createNesMarkerDecorations(
  editorInstance: editor.IStandaloneCodeEditor,
  markers: readonly NesLocationMarker[]
): editor.IEditorDecorationsCollection
```

Each marker becomes a decoration on its line with `glyphMarginClassName: 'nes-location-marker'` and a `glyphMarginHoverMessage` carrying the edit's `label` and `kind`.

**Follow the house pattern for gutter glyphs.** `src/renderer/src/components/editor/ai-instructions/use-monaco-ai-instructions.ts` already draws one: the decoration's range is `new monaco.Range(lineNumber, 1, lineNumber, 1)`, its options carry `glyphMarginClassName`, `glyphMarginHoverMessage: { value }` and `isWholeLine: false`, and the collection is `editor.createDecorationsCollection()` refreshed with `collection.set(decorations)` and released with `collection.clear()`.

**The decoration's shape is built by a pure function, and the collection is separate.** The house
pattern creates the collection **once** and refreshes it with `collection.set(decorations)` — so a
function that created a new collection on every call would leak one per tick. Split the two:

- `nesMarkerDecorations(markers)` returns the `editor.IModelDeltaDecoration[]` and nothing else. It
  is **pure**, so the test file can pin the decoration's shape — the glyph class, the hover message,
  the range — without a Monaco instance at all.
- `createNesMarkerDecorations(editorInstance, markers)` creates the collection with
  `editorInstance.createDecorationsCollection()` and sets the decorations from the builder.

**The range may be a plain `IRange` object.** `IModelDeltaDecoration['range']` is an `IRange`, and a
plain `{ startLineNumber, startColumn, endLineNumber, endColumn }` literal satisfies it — so this
module needs no _value_ import of `monaco-editor` and stays a pure module. The house file uses
`new monaco.Range(...)` because it needs the Monaco runtime anyway.

**Disposing the collection is Task 10's job, not this task's**: the hook (Task 10) owns the editor's
lifetime, creates the collection, refreshes it on each tick with
`collection.set(nesMarkerDecorations(markers))` and disposes it when the editor goes away. This task
provides the builder, the creator and the collection type; it does not wire the lifecycle.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/editor/code-completion src/shared/code-completion
git commit -m "feat(code-completion): the plan store and the location markers"
```

---

### Task 9: The Monaco inline provider

**Files:**

- Create: `src/renderer/src/components/editor/code-completion/nes-inline-provider.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-inline-provider.test.ts`
- Modify: `src/renderer/src/assets/main.css` (the `nes-location-marker` and ghost-text classes)

**Interfaces:**

- Consumes: `NesPlanStore` (Task 8), `NesEdit` (Task 1), `nesEditExtendsCoveredText` (Task 8).
- Produces:
  - `ensureNesInlineCompletionsProvider(monaco: MonacoApi): void` — the module-level singleton
  - `nesInlineCompletionForEdit(edit: NesEdit, model: monaco.editor.ITextModel): monaco.languages.InlineCompletion | null`
  - `fireNesInlineCompletionsChanged(): void` — asks Monaco to re-query the provider. The provider registers `onDidChangeInlineCompletions` on the module-level `changeEmitter`; Task 10 calls the function when a new plan lands, so the suggestion appears without the user moving the cursor.

- [ ] **Step 1: Write the failing provider test**

Create `src/renderer/src/components/editor/code-completion/nes-inline-provider.test.ts`:

```ts
describe('nes inline completion', () => {
  it('turns an insert edit into an inline completion at the cursor', ...)
  it('turns a multi-line insert into one inline completion', ...)
  it('turns a replace that extends the covered text into an inline completion', ...)
  it('returns null for a replace that rewrites the covered text', ...)
  it('returns null for a delete edit', ...)
  it('rejects an edit whose range no longer matches the model', ...)
  it('returns null for a replace edit that starts on an earlier line', ...)
  it('returns null when the range names a line past the end of the file', ...)
})
```

The "rewrites the covered text" case is Monaco's own constraint, and it decides what this provider may
offer at all: **the classic ghost-text path can only show an insertion.** A rewrite renders as
nothing at all, so offering it would put the user in front of an invisible suggestion — and since
the accept path is ours (Task 10 calls `applyNesEdit`), Tab would then rewrite their code with no
preview. The rule is `nesEditExtendsCoveredText` (Task 8): the offered text must strictly extend
the text the range covers.

The "starts on an earlier line" case is Monaco's other constraint: an inline completion's range must
begin on the cursor's line, so a `replace` that starts higher is never displayable and must not be
offered.

The "range no longer matches the model" case is the "the user typed while the request was in flight"
case from Review Focus: the provider re-checks the model's current text against the edit's
`originalText` before it offers the suggestion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the provider**

Create `src/renderer/src/components/editor/code-completion/nes-inline-provider.ts`:

```ts
import type { OnMount } from '@monaco-editor/react'
import type * as monaco from 'monaco-editor'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'
import { nesPlanStore } from './nes-plan-store'

type MonacoApi = Parameters<OnMount>[1]

let provider: monaco.IDisposable | null = null
let providerMonaco: MonacoApi = null
let changeEmitter: monaco.Emitter<void> | null = null
```

**The Monaco types come from the namespace import.** `import type * as monaco from 'monaco-editor'` is a
type-only import — it costs nothing at runtime — and it carries every type the module needs:
`monaco.IDisposable`, `monaco.Emitter<void>`, `monaco.editor.ITextModel` and
`monaco.languages.InlineCompletion`. The module needs no **value** import of `monaco-editor`: the
live namespace arrives as the `monaco` argument of `ensureNesInlineCompletionsProvider`, and that is
what the emitter is built from.

Because the emitter needs the live Monaco namespace, create it inside `ensureNesInlineCompletionsProvider` and keep it in a module-level variable. `fireNesInlineCompletionsChanged()` is a no-op while `changeEmitter` is null.

`ensureNesInlineCompletionsProvider(monaco)` re-registers the provider when the Monaco instance changed, following `ensureMarkdownDocCompletionProvider` exactly.

**What "exactly" means here is the singleton pattern only.** `ensureMarkdownDocCompletionProvider` (`src/renderer/src/components/editor/markdown-source-tools/monaco/monaco-markdown-doc-completions.ts`) registers a **suggest-widget** provider (`registerCompletionItemProvider`) for markdown, not an inline one — it is the repo's example of _module-level provider plus provider-instance check plus dispose-and-recreate_, which is what this task copies. There is no existing inline-completions provider in this repo to copy behaviour from.

Two facts about Monaco 0.55 that make this work, both verified against the installed package:

- **Inline suggestions are on by default.** `EditorOption.inlineSuggest` defaults to `{ enabled: true }` (`node_modules/monaco-editor/esm/vs/editor/common/config/editorOptions.js`), and the repo does not override it — so the provider is called and the ghost text renders without any configuration.
- **`disposeInlineCompletions` is required.** The `InlineCompletionsProvider` interface declares it **without** a `?`, so an omitted method is a type error; `onDidChangeInlineCompletions` _is_ optional.

`provideInlineCompletions` is called with `(model, position, context, token)`; the provider only needs the first two.

The provider:

```ts
monaco.languages.registerInlineCompletionsProvider('*', {
  provideInlineCompletions(model, position) {
    const modelKey = model.uri.toString()
    const edit = nesPlanStore.editAt(modelKey, {
      lineNumber: position.lineNumber,
      column: position.column
    })
    if (!edit) {
      return null
    }
    const completion = nesInlineCompletionForEdit(edit, model)
    return completion ? { items: [completion] } : null
  },
  onDidChangeInlineCompletions: changeEmitter?.event,
  // Why: the interface has no optional member here — an omitted method is a type error.
  disposeInlineCompletions() {}
})
```

The provider asks the store by **model key**, not by file path: the model URI's authority is a hash of the owner key, so it cannot say which host's editor it is (see Task 8's note). The hook's binding is the only way to know which file a model shows.

`nesInlineCompletionForEdit` maps an edit to Monaco's shape:

```ts
{
  insertText: edit.text,
  range: {
    startLineNumber: edit.range.startLine,
    startColumn: edit.range.startColumn,
    endLineNumber: edit.range.endLine,
    endColumn: edit.range.endColumn
  }
}
```

**The range is mapped verbatim — there is no off-by-one to correct.** The NES range's end column is
exclusive ("it covers the text up to but not including its end") and Monaco's is too: its end column
points one _past_ the last covered character. Probed against a real `PieceTreeTextBuffer`,
`Range(1,1,1,2)` covers `"c"` and `Range(1,1,1,14)` covers the whole 13-character line
`"const x = abc"` — the same columns `sliceRange` slices. Do not "fix" this by adding or removing
one.

**The range is used as it is, and the cursor's line must match it.** Monaco's `InlineCompletion.range`
"must begin and end on the same line", and `inlineCompletionIsVisible` refuses any suggestion whose
`range.startLineNumber` is not the cursor's line — so a multi-line range would be silently _never
displayed_. Such an edit is not lost: it still gets a gutter marker (Task 8) and the user can jump to
it. **Reject, do not clamp** — clamping the range to the cursor's line would change which text the
suggestion overwrites. For an NES cursor edit the range _ends_ at the cursor, so "starts on the
cursor's line" and "is a single line" are the same condition.

**The single-line check needs no cursor.** `nesPlanStore.editAt` only returns an edit whose range end
_is_ the cursor's position, so the cursor's line is the range's end line. "The range starts on the
cursor's line" is therefore "the range is a single line", which is `edit.range.startLine ===
edit.range.endLine` — no position argument is needed, and `nesInlineCompletionForEdit(edit, model)`
keeps the signature the Interfaces block gives it.

**Three facts about Monaco 0.55's ghost text, all verified against the installed package.**

- **A multi-line `insertText` is fine, and it is the feature's core.** `computeGhostText` refuses a
  multi-line _range_, not a multi-line _text_: an insert of three lines at the cursor produces the
  whole three-line ghost text, which Monaco renders with the first line inline and the rest below the
  cursor line. One `InlineCompletion` carries the whole block.
- **The classic path can only show an insertion.** It renders the diff between the model's text in
  the range and the offered text, and it bails as soon as a diff change removes anything
  (`if (c.originalLength > 0) return undefined`). So the offered text must **strictly extend** the
  covered text — this is `nesEditExtendsCoveredText` (Task 8), and it is what the provider checks
  before offering anything.
- **A replace that extends the covered text shows only the appended part.** Monaco strips the common
  prefix itself, so the ghost text is the delta (`"abc"` → `"abcdef"` renders `"def"` at the end of
  the range). The result the user sees matches what `applyNesEdit` writes, so the preview stays
  faithful.

**The delete case is already covered by the predicate.** A `delete` has empty `text` and non-empty
`originalText`, so it does not extend the covered text and never reaches the mapping. Deleting is a
plan-level action, not a suggestion the user accepts with Tab.

**The predicate and the model check are both required.** `nesEditExtendsCoveredText` says the edit
_could_ be shown; the model's current text must still match `edit.originalText` before it _is_
shown.

**Validate the range before reading the model, and check that it did not move.** The model does not
throw on an out-of-range request — it validates internally — but it _clamps_, and a clamped range
silently names a different place than the plan did. For an **insert** that is the worst case: the
clamped position covers `''`, an insert's `originalText` is `''`, the two match, and the provider
would offer a suggestion at a line the file no longer has. So the provider calls
`model.validateRange(range)` and **rejects the edit when the validated range is not the edit's own
range** — every field of it. The range it then hands to Monaco is always in bounds and always the
one the plan named.

- [ ] **Step 4: Add the CSS**

In `src/renderer/src/assets/main.css`, add a `.nes-location-marker` class (a small glyph in the gutter) and a `.nes-ghost-text` class used by the preview overlay of Task 11. Follow the token rules in `docs/STYLEGUIDE.md` — reuse the existing border and foreground tokens rather than hardcoding hex values.

**Copy the house pattern for the glyph.** `src/renderer/src/assets/main.css` already styles the AI-instruction gutter glyphs (`.monaco-editor .ai-instruction-glyph--pending::before` and its two siblings) — the glyph is a `::before` pseudo-element with `content: ''`, a `mask-image` holding an inline SVG data URI, an explicit `width`/`height`, and a `background-color` drawn from a token.

**Colour it with a token and no `.dark` rule is needed.** The house pattern uses `var(--muted-foreground)` and `var(--primary)`, which flip between the themes themselves, so a `.dark` override would be redundant. Add one only for a colour that is **not** an existing token. The house rules also carry a comment saying _why_ the states are told apart by shape rather than by colour: the glyph margin is a few pixels wide and `--primary` flips from near-black to near-white between themes.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/editor/code-completion src/renderer/src/assets/main.css
git commit -m "feat(code-completion): the Monaco inline completion provider"
```

---

### Task 10: The trigger, the keybindings and the interception

**This task runs after Task 11.** The hook calls `applyNesEdit` and `previewNesEdit`, which Task
11 produces, and Task 11 depends on nothing but Task 1 — so the two swap without either one's
work changing. The numbering stays; the execution order is **9 → 11 → 10**.

**Files:**

- Create: `src/renderer/src/components/editor/code-completion/use-monaco-nes.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-key-routing.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-key-routing.test.ts`
- Modify: `src/shared/keybindings/types.ts` (add the action ids)
- Modify: `src/shared/keybindings/definitions-core-4.ts` (add the definitions)
- Modify: `src/renderer/src/components/editor/editor-shortcuts.ts` (add the installers)
- Modify: `src/renderer/src/components/editor/monaco-editor-input-bindings.ts` (install and dispose them)
- Modify: `src/renderer/src/components/editor/MonacoEditor.tsx` (mount the hook, pass the editor instance and the extension list)
- Modify: `src/renderer/src/components/editor/use-monaco-editor-mount.ts` (register the inline provider)

**Interfaces:**

- Consumes: `requestNesPlan` (Task 7), `NesPlanStore` (Task 8), `ensureNesInlineCompletionsProvider` (Task 9),
  `applyNesEdit` and `previewNesEdit` (Task 11).
- Produces:
  - `type NesTabDecision = 'accept-suggestion' | 'jump-to-next-location' | 'pass-through'`
  - `decideNesTabAction(input: { hasInlineSuggestion: boolean; hasOtherLocations: boolean }): NesTabDecision` — the pure routing rule. `hasInlineSuggestion` is **our own state**, not Monaco's. One question, one answer: **ask the provider's own predicate.** `nesInlineCompletionForEdit(edit, model)` (Task 9, exported) returns `null` for exactly the edits the provider refuses to render, so the hook computes it as:

```ts
const edit = nesPlanStore.editAt(modelKey, cursor)
const hasInlineSuggestion = edit !== null && nesInlineCompletionForEdit(edit, model) !== null
```

**Do not re-implement the checks — the provider makes _four_, and two of them are easy to miss.** The edit's range must be on **one line** (Monaco renders a suggestion only when its range begins on the cursor's line), and the range must survive `model.validateRange` unchanged (a clamped range names a place the model no longer has). On top of those: the edit must **extend** the covered text (`nesEditExtendsCoveredText` — the classic ghost text renders an insertion only), and the live model must still hold the edit's `originalText`. A hook that checked only the last two would accept a multi-line-range edit the provider never rendered — the user would watch their code change with no preview of it.

Reusing the predicate makes the two agree **by construction**: there is no second copy of the rules to drift. Monaco exposes no public query for whether _its_ inline widget is showing; `editor.action.inlineSuggest.commit`'s `isSupported()` is the closest, but it answers for whichever provider owns the widget.

- `useMonacoNextEditSuggestions(params): void` — the hook that owns the trigger and the plan state
- two new keybinding ids: `editor.acceptAiSuggestion` and `editor.nextAiSuggestion`

- [ ] **Step 1: Write the failing routing test**

Create `src/renderer/src/components/editor/code-completion/nes-key-routing.test.ts`:

```ts
describe('decideNesTabAction', () => {
  it('accepts the suggestion when one is showing', ...)
  it('jumps to the next location when the plan has more', ...)
  it('passes the key through when there is nothing to do', ...)
})
```

`pass-through` is the Review Focus case: Tab must still reach the TypeScript suggest widget.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the routing rule**

Create `src/renderer/src/components/editor/code-completion/nes-key-routing.ts`:

```ts
export type NesTabDecision = 'accept-suggestion' | 'jump-to-next-location' | 'pass-through'

export function decideNesTabAction(input: {
  hasInlineSuggestion: boolean
  hasOtherLocations: boolean
}): NesTabDecision {
  if (input.hasInlineSuggestion) {
    return 'accept-suggestion'
  }
  if (input.hasOtherLocations) {
    return 'jump-to-next-location'
  }
  return 'pass-through'
}
```

- [ ] **Step 4: Add the keybinding definitions**

In `src/shared/keybindings/types.ts`, add to the `KeybindingActionId` union:

```ts
  | 'editor.acceptAiSuggestion'
  | 'editor.nextAiSuggestion'
```

In `src/shared/keybindings/definitions-core-3.ts`, add two definitions in the editor group:

```ts
  {
    id: 'editor.acceptAiSuggestion',
    title: 'Accept AI Suggestion',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: ['shortcut', 'editor', 'ai', 'suggestion', 'accept', 'tab'],
    defaultBindings: platformBindings(['Tab'])
  },
  {
    id: 'editor.nextAiSuggestion',
    title: 'Go to Next AI Suggestion',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: ['shortcut', 'editor', 'ai', 'suggestion', 'next', 'jump'],
    // Why: F8 is the sibling of the F7 "go to next change" this repo already binds.
    defaultBindings: platformBindings(['F8']),
    allowBareKeybindings: true
  },
```

**Both bindings are bare keys, so both definitions need `allowBareKeybindings: true`.** A bare `Tab`
and a bare `F8` are both dropped by the normalizer without the flag — the action would exist and
would never fire.

**The jump chord is `F8`, not `Mod+Tab`.** `Mod+Tab` is `Cmd+Tab` on macOS, which the OS consumes
before the renderer sees it, so the action could never fire there; and it is `Ctrl+Tab` on Linux
and Windows, which `tab.previousRecent` already owns (`definitions-core-2.ts:211`). `F8` is free
across the whole repo — no other definition and no terminal binding uses it — and no OS eats it.
It is also the natural sibling of the `F7` "go to next change" this repo already binds.

**The definitions go in `definitions-core-4.ts`, not `definitions-core-3.ts`.** The four core files
are split by size, not by subject, and `definitions-core-3.ts` sits at 297 of its 300 **code**
lines (`.oxlintrc.json:244` counts code lines — blank lines and comments do not count). Two more
definitions do not fit, and the max-lines ratchet refuses a new over-limit file, so the two
definitions belong in `definitions-core-4.ts`, which has room.

- [ ] **Step 5: Write the installers**

In `src/renderer/src/components/editor/editor-shortcuts.ts`, add:

```ts
export function installEditorAcceptAiSuggestionShortcut(
  target: HTMLElement,
  decide: () => NesTabDecision,
  onAccept: () => void,
  onJump: () => void
): () => void
```

It follows the repo's installer pattern (`installEditorSaveShortcut` at the top of the same file): a capture-phase `keydown` listener on `target` that returns a dispose function. It calls `decide()`, and consumes the key for `accept-suggestion` and `jump-to-next-location`; for `pass-through` it does **not** call `preventDefault()`, so the key reaches the suggest widget. The event is matched through `editorShortcutMatches('editor.acceptAiSuggestion', event)` — the matcher every other editor shortcut uses, so the user's keybinding customisation applies. `decide()` is consulted only once the event matches that action; the second action (`editor.nextAiSuggestion`) routes to `jump-to-next-location` the same way.

**Match the action, not the key.** A hardcoded `event.key === 'Tab'` would make the two `KeybindingDefinition` entries this task adds dead — the user could rebind _Accept AI Suggestion_ and nothing would happen.

**Ignore a repeated press.** `installEditorSaveShortcut` returns early on `event.repeat`, and the Tab
installer must do the same: a held Tab key fires a stream of repeats, and the first one accepts the
suggestion — the repeats must not accept again, and must not fall through to the suggest widget and
insert whitespace either. Skip repeats before deciding anything.

**The accept path is ours, not Monaco's.** On `accept-suggestion` the hook calls `applyNesEdit` (Task 11) — it does **not** run Monaco's `editor.action.inlineSuggest.commit`. The Global Constraints require an accepted suggestion to be one undoable step made with `pushUndoStop()` / `pushEditOperations` / `pushUndoStop()`, and Task 11's `originalText` guard must sit on the path that actually applies the edit. The hook applies the edit **first** and hides the inline widget (`editor.action.inlineSuggest.hide`) **only when the edit landed** — a refused edit keeps the ghost text, so the user does not lose the preview and get nothing.

Add a second installer for the preview modifier:

```ts
export function installEditorAiSuggestionPreviewShortcut(
  target: HTMLElement,
  onPreview: (active: boolean) => void
): () => void
```

It watches `Alt` keydown and keyup (ignoring `event.repeat`) and reports the held state.

**The preview draws the edit at the cursor with our own overlay, not with Monaco's ghost text.** The
hook previews the edit `nesPlanStore.editAt` returns, through `previewNesEdit` (Task 11), which
draws the change with a **Monaco content widget**. Monaco's ghost text is the _default_ view — it
shows the suggestion as the user types — while the Alt overlay is the deliberate one: the user
holds Alt to see the whole change laid over the code before accepting it.

**Not injected text.** Monaco's `InjectedTextOptions.content` "Must be a single line", and the
feature's core case is a multi-line insert, so the overlay is a content widget. Task 11 measures
and implements that; this task only calls it.

**Release the preview on Alt's keyup, and on the editor's unmount.**
The release function is `previewNesEdit`'s return value, and the caller holds it for as long as
the user holds Alt: Alt keydown creates the preview, Alt keyup releases it. If the editor is
closed while Alt is still held, the widget goes with it — Monaco's `dispose()` clears the content
widgets, and `removeContentWidget` on a disposed editor is a no-op — so the release call is safe
either way, but the hook should not leave a dangling reference to a widget it has already
released.

**It can show any kind of edit, which is why it is worth having.** The contract now keeps only the
edits the editor can draw (Task 1's validator), so a rewrite of the text the user just typed never
reaches the renderer. But the overlay does not depend on that rule: if a plan reaches the renderer
that the classic path cannot draw — an older cached plan, say — the overlay still shows it.

- [ ] **Step 6: Write the hook**

Create `src/renderer/src/components/editor/code-completion/use-monaco-nes.ts`:

```ts
export function useMonacoNextEditSuggestions(params: {
  filePath: string | undefined
  relativePath: string | undefined
  enabled: boolean
  triggerDelayMs: number
  /** The extensions the feature is on for; a file outside the list is skipped whole. */
  enabledExtensions: readonly string[]
  /** The live editor — the hook needs its model, its cursor and its decoration collection. */
  editorInstance: editor.IStandaloneCodeEditor | null
  /** The worktree that owns the file, for the related-file search. */
  files: RuntimeFileOperationArgs
}): void
```

The hook:

- subscribes to the editor's `onDidChangeModelContent` and `onDidChangeCursorPosition`
- debounces both by `triggerDelayMs`
- **fires one tick when it mounts**, so opening a file asks for a plan instead of waiting for the
  user to type. The content sync's effect runs _before_ the hook's (the sync is called at
  `MonacoEditor.tsx:178`, the hook at `:236`), so the model already holds the file when the hook
  subscribes and the content-change event that would have triggered the request has already gone
  by. The spec's acceptance line is "打开文件 → 触发 → 看到 ghost text" — without the mount tick the
  suggestion only appears after the first keystroke. The tick is debounced like every other, so a
  content change that lands during the debounce window coalesces into it rather than adding a
  second request.
- binds the model to its file path in the plan store (`nesPlanStore.bindModel(model.uri.toString(), filePath)`) as soon as it mounts, so the provider (Task 9) can resolve the model
- on a tick it builds the context (Task 7), collects the related files (Task 7), asks for the plan (Task 7), stores it (Task 8) and fires `fireNesInlineCompletionsChanged()` so Monaco re-queries the provider

**The request the hook assembles.** `NesRequest` is the context, plus the related files, plus the
recent edits:

```ts
const context = buildNesContext(model, position, { filePath, relativePath })
const relatedFiles = await collectNesRelatedFiles({
  filePath,
  fileText: model.getValue(),
  symbolAtCursor: identifierAtCursor(model, position),
  files
})
const plan = await requestNesPlan({ ...context, relatedFiles, recentEdits: [] })
```

Two of those inputs are not obvious, and the collector's own signature does not supply them:

- **`symbolAtCursor` is a plain identifier.** The collector uses it only to find the files that
  mention it, and `findSymbolFiles` drops anything that is not a plain identifier. Take the word
  under the cursor from the model — `model.getWordUntilPosition(position)` — and pass `null` when
  there is none. Nothing in the repo derives it for you.
- **`recentEdits` is empty in this round.** The field is in the contract for a later feature and
  the RPC params default it to `[]`; nothing in this plan records a history, so pass `[]` and do
  not invent one.
- **renders the other predicted locations**: `nesLocationMarkers(nesPlanStore.editsForPath(filePath), cursor)` into a `createNesMarkerDecorations(editorInstance, markers)` collection, refreshed on each tick and disposed with the editor. This is the spec's second layer — the gutter markers — and the hook is its only caller. The same list is what `decideNesTabAction`'s `hasOtherLocations` reads.
- **discards a stale answer**: the request cannot be cancelled end to end (see below), so the hook keeps a generation counter and applies a plan only when the generation still matches the one the request was made under.
- skips the whole cycle when the file's extension is not in the enabled list, when the feature is off, or when the editor is read-only

**The key format is a silent-failure coupling — and there is a trap in recomputing it.** The
provider asks the store by `model.uri.toString()` (`nes-inline-provider.ts:27`), and the store
takes an opaque string. If the hook binds with a different key, the provider finds nothing and
**no suggestion ever appears**, with no error anywhere.

**Take the key from the live model, never from the file path.** The hook's parameters do not
include the model owner key, and the model's URI cannot be recomputed from the file path alone:

- `toEditorModelUri(filePath, modelOwnerKey)` builds a **`vscode-remote://<owner-hash>/path`**
  URI — the authority is a hash of the owner key (`editor-model-uri.ts`, `ownerAuthority`), and
  the model is created with exactly that URI (`monaco.Uri.parse(toEditorModelUri(filePath,
  modelOwnerKey))`).
- `toEditorModelUri(filePath)` **without** an owner key builds a plain **`file:///path`** URI.

Those are different strings. A hook that recomputed the URI from the path would bind a key the
provider never asks for, and the feature would be inert with no error to show for it.

**So: `editorInstance.getModel()?.uri.toString()` — read it off the model the provider will read
it off.** The hook has the editor instance, and the editor's model is the one the provider sees.
Bind that, and the two sides agree by construction.

The editor is remounted per file (`<Editor key={modelUri}>` in `MonacoEditor.tsx`), so `onMount`
runs again for each file and the binding follows the model. The hook's effect must depend on
`editorInstance` and `filePath`, and it must **unbind the previous model** when either changes —
otherwise the store keeps a stale binding for a model nobody is looking at any more.

A test that pins this is worth having: bind the model, ask the provider for the edit at the
cursor, and assert it is offered. Without it, a change to either side's key format breaks the
feature silently, and the E2E spec in Task 13 is the only thing that would notice.

The related files are collected from the **cached** list (Task 7). The hook never waits on a worktree search before asking for the plan: a stale related-file list is better than a slow suggestion.

**The request cannot be cancelled end to end.** `callRuntimeRpc` forwards `signal` and `timeoutMs` only on the `environment` branch; on the `local` branch it calls `window.api.runtime.call({ method, params })`, and the `runtime:call` IPC dispatches with no signal — so the runtime's handler sees `ctx.signal === undefined` and the request runs to completion whatever the renderer does. Two consequences, and the plan is written around them:

1. **Staleness is handled renderer-side.** The hook keeps a generation counter; every tick increments it, and a plan is applied only when the counter still matches the value captured when the request went out. A plan that arrives after the user has typed again is discarded.
2. **The timeout stops the _waiting_, not the request.** `requestNesPlan` races the call against a timer and returns `null` when the timer wins. The underlying request may still complete; its answer is discarded by the generation check.

Changing `window.api.runtime.call` to carry an abort would give real cancellation, but it changes a shared contract for one feature's benefit — not worth it in this plan.

**Where `files` comes from.** Do not hand-roll it. `src/renderer/src/runtime/source-control/git/runtime-git-client-context.ts` only _declares_ the `RuntimeGitContext` type — it has no assembly function. The real assembler is `buildWorkspaceFileContextForFile(worktreeId, worktreePath, filePath, runtimeEnvironmentId)` in `src/renderer/src/runtime/files/workspace-file-host-routing.ts`, which resolves the target through `requireRuntimeTargetForFileOwner` and sets `connectionId` through `getConnectionIdForFile`. Use it: a hand-rolled `target` drops the SSH connection id and breaks folder workspaces and per-file ownership.

- [ ] **Step 7: Wire the hook and the installers**

In `src/renderer/src/components/editor/MonacoEditor.tsx`, call `useMonacoNextEditSuggestions(...)` with the file's path, relative path and language, **the live editor instance** (the component already holds it as `mountedEditor` state) and **the enabled extension list** from the settings. The hook needs both: it builds the context from the model, and it skips a file whose extension is not enabled.

In `src/renderer/src/components/editor/monaco-editor-input-bindings.ts`, install the two new shortcuts next to the existing ones and add their cleanup functions to `disposeInputBindings`.

In `src/renderer/src/components/editor/use-monaco-editor-mount.ts`, call `ensureNesInlineCompletionsProvider(monaco)` next to `ensureMarkdownDocCompletionProvider(monaco)`.

- [ ] **Step 8: Run the tests**

Run: `pnpm test src/renderer/src/components/editor/code-completion src/shared/keybindings --maxWorkers=2`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/editor src/shared/keybindings
git commit -m "feat(code-completion): the suggestion trigger and the Tab routing"
```

---

### Task 11: Applying an accepted edit and the preview

**Files:**

- Create: `src/renderer/src/components/editor/code-completion/nes-edit-application.ts`
- Create: `src/renderer/src/components/editor/code-completion/nes-edit-application.test.ts`

**Interfaces:**

- Consumes: `NesEdit` (Task 1), `sliceRange` (Task 1).
- Produces:
  - `applyNesEdit(model: editor.ITextModel, editorInstance: editor.IStandaloneCodeEditor, edit: NesEdit): boolean` — true when the edit was applied
  - `previewNesEdit(model, editorInstance, edit): () => void` — returns the function that releases the preview overlay

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/editor/code-completion/nes-edit-application.test.ts`:

```ts
describe('applyNesEdit', () => {
  it('inserts the text at the cursor', ...)
  it('replaces the range with the new text', ...)
  it('deletes the range', ...)
  it('refuses an edit whose original text no longer matches', ...)
  it('leaves the model untouched when it refuses', ...)
})

describe('previewNesEdit', () => {
  it('shows the new text without touching the model', ...)
  it('removes the widget when the preview is released', ...)
})
```

The fourth `applyNesEdit` case is Review Focus item 2: the file changed under the plan, so the edit
must not be applied.

**Build the model and the editor the way the repo's editor tests do.** `monaco-content-sync.undo-history.test.ts`
is the pattern: `// @vitest-environment happy-dom` at the top of the file, then

```ts
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
const model = monaco.editor.createModel(initialContent, 'plaintext')
```

**The editor instance for `previewNesEdit` can be a small fake.** The preview needs three things
from the editor: `addContentWidget`, `removeContentWidget` and `layoutContentWidget`. A fake that
records the widget it is given is enough for the test to read `widget.getDomNode().textContent`
and to count the add and the remove. The model is a real one — `applyNesEdit` writes through it,
and that is the behaviour under test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the application**

Create `src/renderer/src/components/editor/code-completion/nes-edit-application.ts`:

```ts
export function applyNesEdit(
  model: editor.ITextModel,
  editorInstance: editor.IStandaloneCodeEditor,
  edit: NesEdit
): boolean
```

It reads the model's current text and checks that the slice the range covers still equals `edit.originalText`, using `sliceRange` (Task 1). **A range that leaves the text is a mismatch, not a pass**: `sliceRange` returns `null` there, and `null` never equals the original text, so the edit is refused.

The same check serves an `insert`: its range start equals its end, so `sliceRange` returns the empty string, and an insert's `originalText` is the empty string — they match, and the insert is applied. A `replace` or a `delete` carries real text, and the comparison is the guard against a plan that went stale while the user kept typing.

When the check fails the function returns false and changes nothing. Otherwise it pushes one edit operation:

```ts
editorInstance.pushUndoStop()
model.pushEditOperations(
  [],
  [{ range, text: edit.kind === 'delete' ? null : edit.text }],
  () => null
)
editorInstance.pushUndoStop()
```

and returns true.

**`null` is Monaco's delete spelling.** `ISingleEditOperation.text` is `string | null`, and the
document says "This can be null to emulate a simple delete" — so the `delete` kind passes `null`,
not `''`. The `cursorStateComputer` is required in monaco 0.55, and `() => null` is the right
shape for it (`ICursorStateComputer` returns `Selection[] | null`).

`applyNesEdit` is **on the accept path**: Task 10's shortcut calls it when the routing decision is `accept-suggestion`. It is not a helper for some later flow — the `originalText` check above is the guard that stops a stale plan from being applied to text that changed under it, so it has to sit on the path that actually writes. Task 9's provider check is the _first_ line of defence (it decides whether to offer the suggestion at all); this one is the second, at the moment of acceptance.

The write goes straight into the model. The model's change event then reaches `use-monaco-content-sync-bridge.ts`, which turns it into `onContentChange` → draft → dirty → autosave. **Do not** call `onContentChange` yourself and **do not** wrap the write in `beginProgrammaticContentSync` — either would break the save path.

- [ ] **Step 4: Write the inline preview**

The Alt preview draws the edit's new text **with a Monaco content widget**, not with injected text.

**Why not injected text — measured, not assumed.** Monaco's own API doc says so:
`InjectedTextOptions.content` — "Sets the text to inject. **Must be a single line.**"
(`node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts`). The feature's core case is a
multi-line insert, and the whole point of the Alt preview is to see the whole change — so injected
text cannot carry it. The spec left this open ("Monaco 的 injected text 或 decoration", with a
⚠️ 待实测 note); this measurement is what settled it.

**A content widget carries it, and the repo already has the pattern.**
`src/renderer/src/components/editor/setup-contextual-copy.ts` builds an `editor.IContentWidget`:
`allowEditorOverflow`, `suppressMouseDown`, `getId`, `getDomNode`, `getPosition`. It is added with
`editorInstance.addContentWidget(...)`, re-laid-out with `editorInstance.layoutContentWidget(...)`,
and removed with `editorInstance.removeContentWidget(...)` when the editor is disposed. Copy that
shape.

The widget's DOM node holds the proposed text — one element per line, so a multi-line edit shows
as multiple lines — with the `.nes-ghost-text` class on it (Task 9 adds the class). The widget is
anchored at the edit's **range end**, which is where the cursor is, and is placed **below** that
line (`ContentWidgetPositionPreference.BELOW`), so the preview appears under the line the user is
typing on.

**The widget shows `edit.text` in full** — the text that will be there once the edit is accepted,
not the delta. For the contract's edits the two differ only by the prefix the user can already
see, and the full text is the one that is unambiguous for every kind, including a rewrite the
validator would drop today.

**The preview must not touch the model's real content.** It is a widget, so releasing it restores
the original code exactly: nothing was written, so the undo stack is untouched and there is nothing
to undo. `previewNesEdit` returns the function that removes the widget from the editor — the
caller holds it for as long as the user holds Alt.

**The preview must not swallow the mouse.** The widget sits over the code, and the user must still
be able to click and select the text under it while the preview is up — that is what they are
holding Alt to check. So the widget's DOM node takes `pointer-events: none`, and the widget does
**not** set `suppressMouseDown`. (The house pattern in `setup-contextual-copy.ts` sets
`suppressMouseDown: true`, which is right for a hint that is not about the code under it; a preview
is about the code under it, so it must let the mouse through.)

If `pointer-events: none` on the node is not enough because Monaco puts the widget's own element
between the node and the code, put the rule on the class instead — `.nes-ghost-text` is the
preview's own class and Task 9 added it for exactly this.

- [ ] **Step 5: The diff preview is deferred past this plan — do not build it**

The spec's §8.5 asks for a whole-file diff surface ("current file vs. the file with the edit
applied"), coloured by change type. **This plan does not build it**, and this step is here so the
implementer does not go looking for it.

**Why it is deferred.** The contract now keeps only the edits the editor can draw: a single-line
range whose new text only adds to the text it covers (Task 1's validator). Every edit in a plan is
therefore a small addition or extension — which Monaco's ghost text shows exactly, and which the
Alt overlay (Step 4) shows in place. A whole-file diff of a one-line change is noise.

And there is nowhere to put it. The surface itself — a panel, a modal, a host for the
`DiffEditor` — is a design of its own, and nothing in the spec's interaction table or in this plan
opens it. A surface with no entry point is dead code, and a module whose two exports nothing calls
is dead code that the repo's own dead-code gate rejects.

**What a later plan picks up.** The seam is small: the current buffer's text and the proposed text,
over two in-memory models, on `@monaco-editor/react`'s `DiffEditor` — the pattern the repo already
drives elsewhere. Two things worth knowing, recorded here so they are not rediscovered:

- **Do not reuse `EditorDiffFileSurface.tsx`** — it is a _git_ diff surface: it takes an
  `activeFile`, a `GitDiffResult` and an `editBuffer`, and is rendered by the git-diff editor panel.
  There is no entry point that opens it with an arbitrary original/proposed pair. `DiffViewer`
  (`src/renderer/src/components/editor/diff/monaco-view/DiffViewer.tsx`) is not a drop-in either —
  it is the full diff panel, with the diff-comment and diff-navigation plumbing and a prop set that
  reaches into the app store.
- **Dispose the `DiffEditor` and both of its models when the preview closes.** This repo carries a
  patch for exactly this leak: `config/patches/monaco-editor@0.55.1.patch` backports monaco-editor
  0.56.0's fix for a diff editor whose gutter views stay registered on the global `MenuRegistry`
  and retain the whole editor. The patch is the reason the leak is survivable here, not the reason
  to ignore it — a preview opened and closed repeatedly must not pile up editors.

  The patch does **not** touch the gutter the markers use: it patches
  `browser/widget/diffEditor/utils/editorGutter.js` — the **diff editor's** gutter. The main
  editor's glyph margin is a different file
  (`browser/viewParts/glyphMargin/glyphMargin.js`) and is untouched, so the NES location markers
  (Task 8) are unaffected by it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/editor/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/editor/code-completion
git commit -m "feat(code-completion): apply an accepted edit and preview it"
```

---

### Task 12: The settings UI

**Files:**

- Create: `src/renderer/src/components/settings/editor/CodeCompletionSection.tsx`
- Create: `src/renderer/src/components/settings/editor/CodeCompletionSection.test.tsx`
- Create: `src/renderer/src/components/settings/editor/CodeCompletionCredentialSetting.tsx` (the credential
  block, split out of the section: one file cannot hold both the settings and the key under the
  400-line ceiling for a `.tsx`)
- Create: `src/renderer/src/components/settings/editor/code-completion-search.ts` (the search entry's
  title, description and keywords, so the section and the settings search index cannot drift)
- Modify: `src/renderer/src/components/settings/editor/general-editor-search.ts` (the search entry)
- Modify: `src/renderer/src/components/settings/editor/GeneralEditorSettingsSection.tsx` (render the section)
- Modify: `src/renderer/src/components/settings/general/general-setting-anchors.ts` (the new anchor id and its owner)
- Modify: `src/renderer/src/i18n/locales/en.json` (the extracted keys)

**Interfaces:**

- Consumes: `GlobalSettings['codeCompletion']` (Task 4), `window.api.codeCompletion` (Task 5).
- Produces: the settings UI. No new exported symbols beyond the component.

- [ ] **Step 1: Write the component**

Create `src/renderer/src/components/settings/editor/CodeCompletionSection.tsx` following `EditorWordWrapSetting.tsx` exactly: `SearchableSetting` with a `GENERAL_SETTING_ANCHORS` id, `useTranslate()` for every string, and `SettingsSwitchRow` / `SettingsSegmentedControl` from `../form-controls/SettingsFormControls`.

The section offers:

- the master switch
- the protocol (Anthropic Messages / OpenAI Chat / OpenAI FIM)
- the base URL and the model, as text inputs
- the API key, as a password input that saves through `window.api.codeCompletion.saveApiKey` and never reads the stored key back — show "configured" from `getStatus()` instead. **Clear the input once the save succeeds**, so the key does not linger in the DOM: the renderer holds it only as the value the user typed.
- the trigger delay
- the auto-import switch
- the per-extension list

Every string goes through `useTranslate()` with an `auto.` key and an English default, matching the convention in `EditorWordWrapSetting.tsx`.

**Every write sends the whole block.** `updateSettings` takes a `Partial<GlobalSettings>` and writes the given key verbatim, and the normalizer **resets every field it is not given** — so `updateSettings({ codeCompletion: { model } })` would wipe `baseUrl`, `protocol` and `enabledExtensions`. Every write is `updateSettings({ codeCompletion: { ...settings.codeCompletion, model: next } })`.

**The section must say why the feature is off.** The status carries three states and the section must name the one that applies — the Review Focus case: the user must not have to guess why no suggestion ever appears.

- `configured: false` — the feature stays off until an API key is saved.
- `unreadable: 'sealed-elsewhere'` — the saved key was sealed by the _other_ Orca app on this machine (the desktop and orcad cannot decrypt each other's files), so the section says the key must be entered again here.
- `unreadable: 'unreadable'` — the saved file cannot be read; the section says the key should be re-entered.
- `protection: 'plaintext'` — the key is stored unencrypted on this machine; the section warns about that.

The status is polled, so the section re-reads it rather than caching it — but on an **interval, not on every render**: the `unreadable` probe reads the envelope file from disk on every call, and a settings screen re-renders often.

- [ ] **Step 2: Write the failing section test**

Create `src/renderer/src/components/settings/editor/CodeCompletionSection.test.tsx`. The case that matters pins Review Focus #5: **"tells the user the feature is off until an API key is saved"** — with `getStatus()` reporting `configured: false`, the section says so. A test must fail if that message is removed.

- [ ] **Step 3: Render the section**

In `src/renderer/src/components/settings/editor/GeneralEditorSettingsSection.tsx`, render `<CodeCompletionSection settings={settings} updateSettings={updateSettings} />` inside the editor group.

- [ ] **Step 4: Typecheck**

Run: `pnpm tc:web`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/editor src/renderer/src/components/settings/general/general-setting-anchors.ts
git commit -m "feat(code-completion): the completion settings section"
```

---

### Task 13: The end-to-end proof

**Files:**

- Modify: `src/renderer/src/components/editor/monaco-e2e-probe.ts` (add a full-text accessor)
- Create: `tests/e2e/next-edit-suggestion.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: `window.__monacoEditorE2E?.value(): string` — the probe currently exposes only `valueLength` and `valueTail`, and the test needs the whole buffer.

- [ ] **Step 1: Add the probe accessor**

In `src/renderer/src/components/editor/monaco-e2e-probe.ts`, add a `value(): string` method to the `MonacoE2EProbe` type and return the model's full text. The probe is only installed when `import.meta.env.MODE === 'e2e'`, so the accessor never ships.

- [ ] **Step 2: Write the E2E spec**

Create `tests/e2e/next-edit-suggestion.spec.ts`. Follow `tests/e2e/editor-model-host-isolation.spec.ts`: open a workspace file through `window.__store.getState().openFile(...)`, click `.monaco-editor`, and type with `page.keyboard`.

**The spec must not depend on a real model endpoint.** `window.api` is a context-bridge object and cannot be monkey-patched from the page, so stub the _endpoint_, not the RPC:

1. Start a local HTTP server on `127.0.0.1` in the test process that answers `POST /v1/messages` with a fixed Anthropic-style SSE stream whose text is a single edit plan JSON.
2. Point the app at it: `await orcaPage.evaluate((baseUrl) => window.__store?.getState().updateSettings({ codeCompletion: { enabled: true, protocol: 'anthropic-messages', baseUrl, model: 'e2e-model', triggerDelayMs: 0, autoImport: false, enabledExtensions: ['ts'] } }), baseUrl)`.
3. Store a key: `await orcaPage.evaluate(() => window.api.codeCompletion.saveApiKey('e2e-test-key'))`.

The mock's plan must place its edit exactly at the cursor the test creates, so the spec types `const x = ` at the end of the file and the plan answers an `insert` whose range ends at that column.

### The mock's answer, exactly — this is where the spec silently finds nothing

**The backend does not read the stream raw.** `readSsePayloads` (`completion-http.ts:68`) keeps only
the lines that **start with `data:`** and strips that prefix, and `anthropicStreamText`
(`anthropic-messages-backend.ts:65`) concatenates the `delta.text` of the events shaped exactly
`{ "type": "content_block_delta", "delta": { "text": … } }`. So a bare JSON line is dropped by the
reader, and a plan JSON sent as a top-level event is never seen as text at all.

The mock answers:

```
event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<the plan JSON, escaped>"}}

event: message_stop
data: {"type":"message_stop"}
```

**The plan JSON has to satisfy the contract, or the edit is dropped without an error.** The
validator keeps the edits that pass and drops the ones that do not, and the backend answers "no
plan" when the text is not JSON — so a wrong `path` shows up as _no suggestion at all_.

```json
{"edits":[{"id":"edit-1","path":"<the absolute path of the file the test opened>","kind":"insert",
  "range":{"startLine":<the line the test typed on>,"startColumn":<the cursor column>,
           "endLine":<the same line>,"endColumn":<the same column>},
  "originalText":"","text":"42","label":"add a value"}]}
```

- **`path` is the absolute path of the edited file.** `nesAllowedPaths` is
  `[request.filePath, ...relatedFiles]`, and the file the test opened is the only one in it.
- **`kind: 'insert'` requires `originalText` to be `""`**; a `replace` requires both `originalText`
  and `text` to be non-empty.
- **The range is on one line** (`startLine === endLine`), and the end column is **exclusive**.
- **`text` must be longer than `originalText` and start with it** — `nesEditExtendsCoveredText` is
  the rule the provider, the marker and the Tab routing all ask.
- At most 5 edits, at most 2 per file.

**The columns are the model's, not the file's.** The prompt shows
`prefix + "<<<CURSOR>>>" + suffix` and tells the model the marker occupies 11 columns, so the
model counts the marker as text and the backend takes it back off
(`nesColumnWithoutCursorMarker`, `completion-backend.ts:117`). For an insert **at** the cursor that
is a no-op — the marker starts at the cursor column, and a column before
`cursorColumn + 11` is left alone — so the mock reports the cursor's own column. **The line
numbers are the model's too**: `translateNesEditLines` adds `prefixStartLine - 1` to them. Use a
**small file**, so the whole prefix fits the budget, `prefixStartLine` is 1, the offset is 0, and
the model's line numbers are the file's own line numbers.

Then:

1. type `const x = ` in the editor
2. wait for the suggestion to appear — **the selectors are known, do not guess them.** The brief's
   `.inline-completion-text-to-replace` is an older Monaco class and does not exist in 0.55.1.
   Measured against the installed package:

   - **the inline suggestion at the cursor** — Monaco inserts it into the view line as an inline
     decoration whose class is **`ghost-text-decoration`**
     (`esm/vs/editor/contrib/inlineCompletions/browser/view/ghostText/ghostTextView.js:171`; the
     "preview" variant is `ghost-text-decoration-preview`). The constant at line 48 is
     `GHOST_TEXT_CLASS_NAME = 'ghost-text'`, used for the ghost text lines.
   - **the multi-line part of the suggestion** — the widget below the cursor line, a
     **`div.suggest-preview-text`** (`ghostTextView.js:427`).

   So assert on `.monaco-editor .ghost-text-decoration` for the inline case, and add
   `.monaco-editor .suggest-preview-text` for the multi-line case. Both are styled by
   `ghostTextView.css`; the rules are scoped to `.monaco-editor`, so the selector needs that
   prefix.

3. assert the buffer still holds only what was typed — the suggestion is a ghost, not an edit
4. press `Tab`
5. assert the buffer now holds the typed text **and** the suggested text
6. in a second case, plan an edit at another line and press `Tab` with no suggestion showing; assert the cursor moved to that line

**The second case needs its own, two-line file.** The one-line file above is for the accept case; a
one-line file has no other line for the plan to point at. The jump case writes a two-line file, puts
the cursor on the second line, and lets the mock answer with an insert on the first — one edit, on
the other line, which is what the marker list keeps (`nesLocationMarkers`,
`nes-location-markers.ts:23-25`) and what makes `hasNextLocation()` true. An edit _at_ the cursor
would be filtered out of the marker list, and Tab would have nothing to jump to.

**The preconditions fail silently, so the spec checks them before it types.** The main-side handler
answers `{ plan: null }` — no error, no log — when the feature is off, when `baseUrl` or `model` is
empty, or when the key file cannot be read (`code-completion-methods.ts:24-37`), and the renderer's
`updateSettings` swallows its own errors (`create-settings-slice.ts:219-221`). Every one of those
looks exactly like "the feature does not work", so the spec waits for the settings round trip and
for the credential status before it types a character.

**The key file lives in the E2E's disposable home, so the developer's key is not at risk.** The harness creates `<userDataDir>/home` and launches Electron with `HOME` and `USERPROFILE` pointing at it (`tests/e2e/helpers/electron-home-isolation.ts:71-110`), then asserts that the app's resolved `app.getPath('home')` is that isolated home (`tests/e2e/helpers/orca-app.ts:191-194`). The key store reads `join(homedir(), '.orca', 'code-completion-api-key.enc')`, so the file the app reads is this spec's own. The spec stores `e2e-test-key` and clears it in an `afterAll` hook (`window.api.codeCompletion.clearApiKey()`); nothing of the developer's is touched. **Do not** set `HOME` or `USERPROFILE` through `orcaAppExtraEnv` — the harness rejects those keys on purpose (`cannot override the E2E home boundary`) and the launch throws. What still matters is that the mock never prints the headers it receives: the request carries the key as `x-api-key`.

- [ ] **Step 3: Build in E2E mode and run the spec**

Run: `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e -- next-edit-suggestion`
Expected: PASS.

The E2E build must be `--mode e2e`; a plain build omits `window.__store` and the probe and the spec will time out.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/editor/monaco-e2e-probe.ts tests/e2e/next-edit-suggestion.spec.ts
git commit -m "test(code-completion): prove a suggestion appears and Tab accepts it"
```

---

### Task 14: Recording the completion usage

**Files:**

- Create: `src/main/code-completion/completion-usage.ts`
- Create: `src/main/code-completion/completion-usage.test.ts`
- Modify: `src/main/code-completion/completion-backend.ts` (parse the usage out of the stream)
- Modify: `src/main/code-completion/anthropic-messages-backend.ts` (report the usage)
- Modify: `src/main/code-completion/openai-chat-backend.ts` (report the usage)
- Modify: `src/main/code-completion/openai-fim-backend.ts` (report the usage)
- Modify: `src/main/runtime/rpc/methods/code-completion/code-completion-methods.ts` (report the usage)

**Interfaces:**

- Consumes: `NesBackend` (Task 2) — the backend must report what it spent.
- Produces:
  - `type CompletionUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number }`
  - `recordCompletionUsage(entry: { model: string; usage: CompletionUsage; at: number }): void`
  - `readCompletionUsageToday(now?: number): CompletionUsage`

The `NesBackend.plan` shape is already final in Task 2 (`Promise<NesBackendResult>`, where `NesBackendResult` carries both the plan and the usage). Task 14 only fills in the usage **values** — it does not change the interface.

**Why this cannot reuse the existing usage pipeline.** The usage scanner reads a provider's transcript files and attributes each session to a worktree (`src/main/usage/worktree-attribution/usage-worktree-resolver.ts`). A completion request has no transcript and belongs to no worktree, so the scanner cannot see it. The spec calls for a new path.

**Why this stays small.** The full usage-provider lifecycle (`UsageProviderStoreLifecycle`, a scan worker, the stats-UI breakdowns) is built for providers whose sessions live on disk. The completion has neither. This task records a running total in a small JSON file in the runtime's userData path and exposes it through the existing RPC method family — enough to answer "how much did the completions cost" without rebuilding the usage service.

- [ ] **Step 1: Write the failing usage test**

Create `src/main/code-completion/completion-usage.test.ts`:

```ts
describe('completion usage', () => {
  it('adds up the tokens of several completions', ...)
  it('reports nothing before the first completion', ...)
  it('keeps the total across a restart', ...)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/code-completion/completion-usage.test.ts --maxWorkers=2`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the recorder**

Create `src/main/code-completion/completion-usage.ts`. It keeps `{ inputTokens, outputTokens, cacheReadTokens }` per day, persists to `<userDataPath>/orca-code-completion-usage.json` through `writeSecureFile` (the same helper the key store uses), and reads the total back.

- [ ] **Step 4: Report the usage from the backends**

Each backend reads the token counts from its own stream and returns them beside the plan. A stream that reports no usage contributes zeros.

- **Anthropic Messages** reports the **input** tokens in `message_start`'s `message.usage` and the **output** tokens in `message_delta`'s `usage` — two different events, so the reader has to keep the first and update with the second. `cache_read_input_tokens` arrives on the same `message.usage` object.
- **OpenAI Chat Completions** reports the whole `usage` object on the **final** chunk, but only when the request asks for it: the request must send `stream_options: { include_usage: true }`, otherwise no chunk carries a usage object and the totals stay zero.
- **OpenAI FIM** is a plain completions stream with no usage at all, so it always contributes zeros unless the endpoint volunteers a `usage` object.

The three backends already share a stream reader, so the parsing belongs in the shared code where the events are dispatched — not three times over.

**The service already passes the usage through — it is not part of this task.**
`completion-service.ts:64` returns the whole `NesBackendResult`, and the other three paths
already say the right thing: the **cache hit** returns `emptyCompletionUsage()` because a
cache hit spends nothing, the **"the endpoint returned no plan"** path returns the **real**
usage because those tokens _were_ spent, and the error paths return zeros.

**The RPC handler is the seam.** `code-completion-methods.ts:64` returns
`{ plan: result.plan }` and drops the usage. Call
`recordCompletionUsage({ model: settings.model, usage: result.usage, at: Date.now() })` there —
and **record it whenever the usage is not zero, not only after a successful plan**: the path
at `completion-service.ts:61` returns a null plan _with_ the real usage, because the model
answered and the answer was not usable. Those tokens were spent, and a counter that only
adds up the successes under-reports exactly the case where the model wasted the money.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/main/code-completion --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/code-completion src/main/runtime/rpc/methods/code-completion
git commit -m "feat(code-completion): record what the completions spent"
```

---

## Follow-ups this plan deliberately leaves out

- **A model catalogue for the FIM endpoint.** `qodercli --list-models` exists, but its output format is not documented, so the plan does not guess it. The FIM backend takes the model name from the settings.
- **Model discovery for the completion endpoint.** There is no list of models behind a user-supplied base URL.
- **A second, faster channel** for the cursor edit (the spec's risk 2). The plan builds one channel; a second one needs real latency numbers first.
- **The completion usage in the stats screen.** Task 14 records the totals but does not build the stats-UI breakdowns; that needs the full usage-provider lifecycle, which is worth doing only once the feature has users.
- **Per-host completion settings.** `GlobalSettings` supports per-host overrides, but the completion talks to the user's own endpoint from the local runtime, so one set of settings serves every host.
