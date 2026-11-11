# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Orca is an Electron + React desktop IDE for running CLI coding agents (Claude Code, Codex, Cursor,
Copilot, …) in parallel, each in its own git worktree. It also ships an `orca` CLI, a React Native
mobile companion, and a cloud relay.

This checkout is a fork of `github.com/stablyai/orca`, working on the fork's `main`. Remotes:

- `origin` → `github.com/andeymei/orca` (this fork — push here)
- `upstream` → `github.com/stablyai/orca` (pull upstream changes from here)

The local `main` branch tracks `origin/main` and the working tree is kept byte-identical to it, so
`git fetch upstream && git merge upstream/main` is how you take upstream changes. Branch your work
off `main`.

A local branch `base/v1.4.256` is kept as a reference to the last release tag. That tag was cut from
a release-prep branch and **diverges from `main`** (~200 commits / ~5,800 files behind), so it is
not a useful diff base — diff against `main`.

Note `package.json#version` on `main` reads `1.4.214` even though the latest release is `v1.4.256`:
version bumps are maintainer-managed and happen on release-prep branches, so **the version string on
`main` does not tell you which release it is**. Check `git tag` for that.

`AGENTS.md` is the canonical rulebook for this repo and is read alongside this file. It is short;
read it fully. The sections below cover the commands and the architecture, which `AGENTS.md` assumes
you already know.

## Setup

Node 24 (expressed only via `package.json#engines` — there is no `.nvmrc`), the pnpm version in
`package.json#packageManager` (12.14.0), and the Bun version in `config/.bun-version` (1.4.4). Bun
is not optional: it is what actually executes Vitest and the typechecker.

`pnpm install` compiles native modules (`node-pty`, `@vscode/windows-process-tree`, the two
`@orca/windows-*` addons) via node-gyp / `@electron/rebuild`, so a C++ toolchain and Python 3 are
required — Xcode CLT on macOS, VS Build Tools with the "Desktop development with C++" workload on
Windows, plus `build-essential python3 xvfb libgtk-3-0 libnss3 libgbm1 libasound2t64` on Linux.

```bash
pnpm install
pnpm -C mobile install --frozen-lockfile   # mobile/ has its own lockfile; build and lint need it
```

Details: `docs/development.md` (per-OS packages, dev profiles, Linux/Docker, troubleshooting).

**Git over the network needs the local proxy.** Direct GitHub access fails here with
`Error in the HTTP2 framing layer`. Prefix remote operations with:

```bash
git -c http.version=HTTP/1.1 \
    -c http.proxy=http://127.0.0.1:7890 \
    -c https.proxy=http://127.0.0.1:7890 \
    <fetch|pull|push|clone|ls-remote>
```

## Commands

The lint/format tooling is **oxlint + oxfmt** — there is no eslint and no prettier in this repo.

| Task                                  | Command                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| Typecheck (all projects, incremental) | `pnpm tc`                                                                       |
| Typecheck (one project)               | `pnpm tc:node` / `pnpm tc:web` / `pnpm tc:cli`                                  |
| Unit test — one file                  | `pnpm test src/shared/path/to/file.test.ts --maxWorkers=2`                      |
| Unit test — one directory             | `pnpm test src/main/runtime --maxWorkers=2`                                     |
| Unit test — only my changes           | `pnpm test:changed src/main/runtime --maxWorkers=2` (staged+unstaged+untracked) |
| Unit test — vs. a base ref            | `pnpm test --changed=origin/main --maxWorkers=2`                                |
| Lint — full gate                      | `pnpm lint`                                                                     |
| Lint — a few files                    | `pnpm exec oxlint <files>`                                                      |
| Format check / fix                    | `pnpm exec oxfmt --check <files>` / `--write`                                   |
| Format everything                     | `pnpm format`                                                                   |
| Run the app                           | `pnpm dev`                                                                      |
| Preview a build                       | `pnpm start`                                                                    |
| Web client only                       | `pnpm dev:web`                                                                  |
| Build (desktop + native)              | `pnpm build`                                                                    |
| Build native addons only              | `pnpm build:native`                                                             |
| E2E (Playwright, Electron)            | `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e`                                    |
| Component screenshot, no Electron     | `pnpm fixtures:shot sidebar/DeleteWorktreeDirtyChangeHint:dirty`                |
| Pre-push gate                         | `pnpm check:changed`                                                            |

Notes:

- `pnpm tc` runs **all five** tsconfig projects; `tc:node` / `tc:web` / `tc:cli` are single-project.
  `pnpm typecheck` is the same driver without the incremental cache.
- `pnpm test` is a wrapper (`config/scripts/test-runtime/execution-policy/run-vitest.mjs`) that runs
  Vitest **under Bun**, sets `ORCA_BACKGROUND_LAUNCH=1` for you, and keeps a transform/module cache.
  Use `pnpm test`, never raw `vitest` — raw vitest loses the cache and the Bun setup.
- `pnpm test` and `pnpm dev` rebuild the native addons transparently if they fail to load under the
  target runtime. On Windows, a rebuild that fails usually means a running Orca still holds the
  `.node` file.
- A test that passes alone but fails after others needs `// @orca-isolated-worker` at the top of the
  file. `ORCA_VITEST_ISOLATE_EVERY_FILE=1` isolates every file to confirm a leak. Windows always
  isolates every file, because native addons kept across files corrupt the heap.
- `pnpm lint` is a **46-step aggregate gate** (oxlint, ast-grep, knip, react-doctor, ratchets, …),
  not one oxlint call. For a single file use `pnpm exec oxlint <files>`.
- `pnpm build` runs the **full typecheck first** (`build:desktop` = `typecheck && build:desktop:assets`).
- `pnpm dev` in a linked git worktree gets its own profile and ports (renderer from 15200, CDP from 9333) so instances run side by side. `pnpm dev:fresh` gives a throwaway profile;
  `pnpm dev:seed-profile` copies settings from another profile.
- `pnpm build:mac` cross-builds x64 + arm64; run `pnpm install:release` first.
- `pnpm fixtures:shot` ids are the path under `src/renderer/src/` with `components/` and
  `.fixture.tsx` stripped, plus the export name. `--theme both`, `--scale N`, `--list`, `--stop`.
  PNGs land in `.cache/fixtures/`.
- The repo has ~220 package scripts; most are CI gates, not daily commands. The ones above plus
  `check:code-quality:changed <base>` and `check:flaky-test-pattern-ratchet` are the ones that
  matter locally.
- `pnpm check:changed` must pass right before every push. Never `--no-verify` (husky enforces it).
- `pnpm check:changed` and `pnpm test --changed=<ref>` default to `origin/main`, which is the right
  base here — the working tree tracks the fork's `main`. Set `ORCA_CODE_QUALITY_BASE=<ref>` to
  compare against something else.

### Choosing a test layer

- **Store logic** → `src/renderer/src/store/slices/*.test.ts`, using `createTestStore()` from
  `src/renderer/src/store/testing/app-store-test-fixture.ts`. (`tests/e2e/AGENTS.md` still calls this
  `createTestAppStore()` — that name is stale.)
- **Real UI events, IPC, persistence, restarts, Electron lifecycle** → E2E under `tests/e2e/`.
- **Presentational components** → a `*.fixture.tsx` next to the component, screenshotted with
  `pnpm fixtures:shot`. Fixtures are the fast loop for UI work; use E2E when the change depends on
  real app state, IPC, terminals, or window chrome.

E2E details that will bite you:

- `pnpm run test:e2e` builds with `--mode e2e`, which is what exposes `window.__store`. A plain build
  omits it, and tests then time out waiting for it — rebuild in E2E mode before suspecting the
  harness.
- `window.__store` is for **setup only**. Assert user-visible behavior through the DOM
  (`getByRole`, `toBeVisible`, `toHaveText`); writing state and reading it back cannot catch broken
  rendering.
- Terminal-topology refactors must pass
  `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e:terminal-layout-parity`, which compares the working
  tree against its merge-base on `origin/main`. Intended fixes must be declared in
  `tests/e2e/terminal-layout-parity-declared-differences.ts` or the run fails.

## Architecture

### Process layout

`electron.vite.config.ts` defines three bundles — `main`, `preload`, `renderer` — and the source
tree mirrors that split:

- **`src/main`** — the Electron main process. ~140 feature directories (`workspaces/`, `git/`,
  `terminal/`, `browser/`, `native-chat/`, `plugins/`, `skills/`, one dir per agent provider, …).
- **`src/preload`** — the `contextBridge` surface. Each domain has an `api/<domain>-api.ts` (types
  only) and `api/<domain>-bridge.ts` (the implementation). `src/preload/api-types.ts` aggregates
  them into the `PreloadApi` type the renderer consumes. Also hosts browser-extension and plugin
  guest preloads.
- **`src/renderer`** — the React app. `src/renderer/src/components/` holds feature folders;
  `src/renderer/src/components/ui/` holds the shadcn primitives that everything else must build on.
- **`src/shared`** — types, schemas, and contracts imported by more than one process. If a module
  needs to be in both main and renderer, it belongs here, not in `shared-stuff`.
- **`src/cli`** — the `orca` CLI (built to `out/cli/`). Talks to a running Orca over RPC.
- **`src/wsl-guest`** — code that runs _inside_ a WSL guest, not on the host.
- **`src/packages/process-host`** — the published `@orca/process-host` package: the only sanctioned
  way to spawn child processes (it pins `windowsHide`, refuses `shell: true`, and encodes `.cmd`
  arguments correctly on Windows).

### Generated files — never hand-edit

Several checked-in files are code-generated. CI re-runs each generator with `--check` and fails if
the output is stale, and the ACP generator explicitly detects "generated file was edited by hand".
Change the _input_ and regenerate; never patch the output.

| Artifact                                                       | Regenerate with                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/main/acp/generated/acp-protocol.generated.ts`             | `pnpm generate:acp-protocol`                                               |
| `src/shared/rpc-contract/rpc-params-catalog.generated.ts`      | `pnpm generate:rpc-params-catalog`                                         |
| `resources/plugins/types/orca-*.d.ts`                          | `pnpm generate:plugin-author-typings`                                      |
| `resources/plugins/declarative/orca.d.ts`                      | `pnpm generate:plugin-declarative-typings`                                 |
| Published plugin JSON Schemas and `docs/reference/plugin-*.md` | `pnpm generate:plugin-schemas`                                             |
| `resources/plugins/declarative/*.mjs`                          | `pnpm generate:plugin-declarative-runtime`                                 |
| `src/cli/bundled-skill-guides.ts` and `skills/*/SKILL.md`      | `pnpm generate:bundled-skill-guides`                                       |
| `skill-guides/orca-plugin-authoring/references/*.md`           | `pnpm generate:plugin-authoring-skill-references`                          |
| `resources/skills/*-manifest.json`                             | `pnpm generate:skill-bundle-manifest`                                      |
| `src/shared/plugins/languages/plugin-protected-copy.ts`        | `pnpm sync:localization-protected-copy`                                    |
| the generated block inside `src/shared/node-runtime-pin.ts`    | `config/scripts/node-runtime/archive-identity/update-node-runtime-pin.mjs` |

Note that `skills/*/SKILL.md` is generated from `skill-stubs/` + `skill-guides/` — edit the stub or
the guide, then regenerate.

Two files that _look_ generated but are not: `src/main/dsh/dsh-home-patch.ts` and
`src/main/kimi/kimi-hook-config-toml.ts` write marker-delimited regions into a _user-owned_ file at
runtime. Similarly, the "Generated by …" comment inside
`src/shared/plugins/**/plugin-*-reference-doc.ts` lands in the output, not the source — those
renderers are hand-written.

### Three ways to call into the runtime — understand this first

There are three distinct surfaces, and picking the wrong one is the most common architectural
mistake here.

**1. Domain IPC (renderer → main).** The preload bridge calls
`ipcRenderer.invoke('<namespace>:<method>')`; the main process registers the matching
`ipcMain.handle('<namespace>:<method>')` under `src/main/ipc/`. Handlers receive a context object
(`{ mainWindow, store, runtime, options }`). ~200 files register handlers; the bootstrap that wires
them all up is `src/main/ipc/register-core-handlers/register-core-handlers.ts`. Events flow back over
`ipcRenderer.on(...)` with an `on<Event>` accessor that returns its own unsubscribe function.

**2. Runtime RPC (everything else).** A method-based protocol served by the Orca runtime, living in
`src/main/runtime/rpc/`: `dispatcher.ts` (`RpcDispatcher`), `core.ts` (registry/envelope types), and
`methods/<domain>/` with one module per method family, all collected in
`methods/rpc-method-registry.ts` (`ALL_RPC_METHODS`). Clients reach it several ways:

- **Local CLI** → Unix socket / named pipe, NDJSON-framed, endpoint discovered by reading
  the `orca-runtime.json` metadata file out of the userData path (`src/shared/runtime-bootstrap.ts`,
  `src/cli/runtime/transport.ts`).
- **Remote CLI, phone, cloud relay** → WebSocket (`src/main/runtime/rpc/ws-transport.ts`) or the
  relay transport (`src/main/runtime/rpc/relay-transport.ts`).
- **Plugin hosts** → the same `RpcDispatcher`, constructed in-process
  (`src/main/plugins/plugin-runtime-rpc.ts`).
- **The renderer itself** → `window.api.runtime.call({ method, params })`, which is IPC channel
  `runtime:call`; the main-side handler builds a fresh dispatcher and dispatches with
  `caller: DESKTOP_RPC_CALLER` (`src/main/ipc/runtime.ts`, `src/preload/api/runtime-bridge.ts`).
  So the renderer's RPC path and the CLI's are literally the same dispatcher — the renderer just
  enters through IPC instead of a socket. Streaming subscriptions use `runtime:subscribe` with
  per-subscription channels.

Every RPC request carries an `executionHost` and is gated by caller identity
(`src/main/runtime/rpc/rpc-caller-identity.ts`: `local-cli`, `desktop`, `paired-device`) and scope
(`src/main/runtime/rpc/rpc-caller-scope.ts`: `owner` | `mobile` | `runtime-paired`).

**3. The terminal daemon protocol.** A _different_ protocol, not RPC: `src/main/daemon/protocol/`
discriminates on `type:` (`createOrAttach`, `write`, `resize`, `kill`, …) rather than `method:`. Its
socket (`daemon-v<version>.sock`) is distinct from the runtime socket (`o-<pid>-<suffix>.sock`).
The CLI never speaks it — `orca terminal-daemon status` goes through the runtime RPC method
`terminalDaemon.severedStatus`.

### Who owns layout

The **renderer** owns tab/pane layout in shipped builds: it publishes its window graph to main over
the IPC channel `runtime:syncWindowGraph`, and main indexes it
(`src/main/runtime/session-graph/`). `ORCA_LAYOUT_OWNER` (`src/shared/layout-owner-switch.ts`) is a
compile-time define whose _off_ value is `'window'`; the `'main'` value is a dark build that
`config/dark-build-switches.cjs` refuses to package. The same mechanism gates
`ORCA_SIDEBAR_INPUTS` (`src/shared/sidebar-inputs-switch.ts`). Search these two files before
assuming which side is authoritative.

### Host, client, runtime

Three distinct nouns, easy to confuse:

- **Runtime** — one Orca process owning authoritative state (`OrcaRuntimeService`,
  `src/main/runtime/orca-runtime.ts`).
- **Host** — a _machine_ that runs a runtime: this desktop, a WSL distro, an SSH server (`orcad`).
  See `src/main/runtime/hosts/`.
- **Client** — a _consumer_ of a runtime's RPC: the desktop renderer, a paired phone, the CLI
  (`src/main/runtime/client/`).

Where a workspace actually runs is captured by `src/shared/execution-host.ts`:
`ExecutionHostId` = `local` | `ssh:<targetId>` | `runtime:<environmentId>`. A remote workspace is
not a different runtime — it is the same runtime holding a worktree whose `executionHostId` points
elsewhere. Never assume a workspace is local, and never assume it is a git worktree: "folder
workspaces" are a first-class case.

### Terminals are a separate daemon

Terminals do not live in the Electron main process. `src/main/daemon/` is a standalone daemon that
physically owns the PTYs and survives app restarts; `daemon/pty-subprocess/` is where PTYs are
actually spawned. `src/main/pty/` holds only supporting logic (environment, history, scrollback,
shell startup, process retirement). The renderer attaches to daemon-owned sessions rather than
owning them. (Its wire protocol is surface 3 above.)

`src/main/daemon/AGENTS.md` documents the socket-endpoint ownership protocol in detail and is
mandatory reading before touching anything that links, renames, unlinks, or stats that socket path.
The short version: **no actor removes a name it did not create**, liveness is proven by connecting
(not by mtime or a timeout), and `link` → prove dead → `rename` is the only sanctioned publish path.

### Renderer state

Zustand. `src/renderer/src/store/index.ts` builds the store; `src/renderer/src/store/slices/` has
28 domain slices (`tabs`, `worktrees`, `ssh`, `terminals`, `settings`, `browser`, `usage`, …). Beside
the slices, `src/renderer/src/store/` holds cross-slice machinery:
`src/renderer/src/store/keyed-record-transitions.ts`,
`src/renderer/src/store/keyed-record-change-reads.ts`,
`src/renderer/src/store/keyed-tab-row-changes.ts`,
`src/renderer/src/store/keyed-tab-row-diff.ts`,
`src/renderer/src/store/seam-record-fields.ts`, `src/renderer/src/store/workspace-layout/`, and
`src/renderer/src/store/testing/` (the `createTestStore()` helper used by store tests).

The store is a _projection_, not the source of truth. `src/renderer/src/runtime/` holds the sync
layers that keep it fed from the runtime: `sync-runtime-graph/` (the window graph the renderer
publishes), `web-session-tabs-sync/` (a _remote_ host's tab inventory mirrored into the local store),
`local-structured-session-tabs-sync/` (the local host's structured sessions), and
`src/renderer/src/runtime/rpc/`. The runtime does the same shaping server-side —
`projectSessionTabsForClient(...)` renders the same state differently for mobile vs. runtime
clients.

### Agents and providers

Orca drives third-party CLIs rather than reimplementing them. Per-provider directories under
`src/main/` (`claude/`, `codex/`, `cursor/`, `copilot/`, `gemini/`, …) handle install, accounts, and
usage.

**ACP** (`src/main/acp/`) is the _Agent Client Protocol_ — JSON-RPC 2.0 over NDJSON on the agent's
stdio. Each provider's quirks live in a **dialect** (`src/main/acp/acp-dialects/`: grok, omp,
opencode, antigravity). The agents actually launched over ACP are listed in
`src/main/acp/launch/acp-launch-registry.ts`.

**Claude Code is not one of them.** Claude's structured path uses the **Claude Agent SDK**
(`src/main/claude/structured/`, `src/main/claude/claude-agent-sdk-process-spawn.ts`); Codex's uses
`src/main/codex/app-server/`. So the structured-agent transports differ per agent — don't assume
ACP is the one in use.

**Native chat** has two shapes, and they are different features:

- _Terminal-backed_ — the agent runs as a TUI in a PTY and Orca renders its transcript file
  (`src/main/native-chat/transcript-watch.ts`, per-agent `transcript-line-decoders-*.ts`).
- _Structured_ — Orca owns the conversation (`src/main/native-chat/agent-session-wire/`).

`src/main/runtime/orchestration/` implements coordinator → worker orchestration across worktrees.
`src/main/agent-launch/` and `src/main/runtime/agent-session/` handle session lifecycle.

### Skills, plugins, and the cloud

- `skills/` + `skill-guides/` + `skill-stubs/` — the agent-facing skills shipped in the app;
  `src/main/skills/` and `config/scripts/skills/` build and bundle them.
- `src/main/plugins/` + `resources/plugins/` + `docs/reference/plugin-*.md` — the plugin system
  (themes, editors, panels, declarative UI). `config/agent-plugins/` is a separate thing: a Claude Code
  plugin marketplace, not a pnpm package.
- `cloud/` — a **separate** pnpm workspace (relay, push, relay-edge, Postgres schema) with its own
  lockfile. Not a member of the root workspace.
- `mobile/` — React Native app, also a separate workspace with its own lockfile and its own
  `pnpm install`.

**Relays.** A relay moves RPC traffic across a network the two peers cannot both reach. Two compose:
`src/main/runtime/mobile-cloud-relay/` is the cloud cell the desktop dials _out_ to, and the phone
connects to; `src/main/runtime/mobile-desktop-relay/` forwards a phone's request onward from the
desktop to a configured server, rewriting the phone's token into the server's. Net:
phone → cloud relay cell → desktop runtime → desktop relay → server runtime.
`src/main/runtime/rpc/relay-transport.ts` implements the transport, so a relay cell is just another
transport in front of the same dispatcher.

The root pnpm workspace has only three members, all private and unpublished:
`@orca/process-host` (`src/packages/process-host`), `@orca/windows-registry`, and
`@orca/windows-security`. The shipped artifact is the Electron app itself, packaged by
electron-builder (`config/electron-builder.config.cjs`).

`config/` is the "everything that is not source" bucket — the repo root only admits allowlisted
entries, so all tooling lives there. `config/scripts/` (48 subdirectories, ~880 files) holds the entry
point for every `package.json` script. `config/` also carries the vitest configs, the ten
`tsconfig.*.json` project files, the ten `oxlint-*.json` configs, ast-grep rules, pnpm patches, and
the electron-builder config.

## Conventions that bite

Read `AGENTS.md` for the full list. The ones that most often break a change:

- **Cross-platform.** Never hardcode `e.metaKey` — check `navigator.userAgent.includes('Mac')`.
  Use `CmdOrCtrl` in Electron accelerators and `path.join` for paths. Spawn children through
  `@orca/process-host`, never `child_process` directly. Never spawn a bare `'rg'` — use
  `spawnBundledRipgrep` / `resolveRelayRipgrepCommand`. `docs/agents-md-refs/cross-platform-support.md`.
- **Remote hosts.** Every feature must work against a local repo, an SSH host, and a WSL guest.
  Do not assume a process, file, credential, or network path exists only on the local machine.
- **Design system.** All UI work follows `docs/STYLEGUIDE.md`. Tokens live in
  `src/renderer/src/assets/main.css` (canonical) and primitives in
  `src/renderer/src/components/ui/`. Never hardcode a hex value a token already covers; a new token
  goes in both `:root` and `.dark`.
- **Do not add tests by default.** A test must fail if your change is reverted, hardcode its expected
  values, and sit at the single layer that owns the behavior. `docs/agents-md-refs/test-antipatterns.md`
  lists the anti-patterns — if you touch a low-value test, delete it rather than update it.
- **Electron launches are always backgrounded.** `ORCA_BACKGROUND_LAUNCH=1` for tests and for any
  agent-launched app. Never `show()`, `bringToFront()`, `app.focus()`, or any OS activation — drive
  renderers through Playwright CDP against hidden windows. `tests/AGENTS.md`, `tests/e2e/AGENTS.md`.
- **Naming.** No `helpers`, `utils`, `common`, `misc`. Name a file after the domain concept it holds
  (`tab-group-state.ts`, not `tabs-helpers.ts`).
- **Comments.** Only where the code does not describe. One line, why not how.
- **Types.** Project-owned types go in `.ts` files, not `.d.ts` — `skipLibCheck` makes an unresolved
  reference in a `.d.ts` silently `any`. This is CI-enforced for `src/preload/` and `src/shared/`.

## Where to look

| Question                          | File                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Canonical repo rules              | `AGENTS.md`                                                                                    |
| Human-facing contribution guide   | `.github/CONTRIBUTING.md`                                                                      |
| Environment setup details         | `docs/development.md`                                                                          |
| UI rules and tokens               | `docs/STYLEGUIDE.md` (+ `docs/styleguide/`)                                                    |
| Cross-platform footguns           | `docs/agents-md-refs/cross-platform-support.md`                                                |
| Git / `gh` / review footguns      | `docs/agents-md-refs/git-workflow.md`                                                          |
| Test anti-patterns                | `docs/agents-md-refs/test-antipatterns.md`                                                     |
| Terminal daemon socket ownership  | `src/main/daemon/AGENTS.md`                                                                    |
| E2E rules                         | `tests/AGENTS.md`, `tests/e2e/AGENTS.md`                                                       |
| Plugin authoring                  | `docs/reference/plugin-*.md`                                                                   |
| Tooling entry points              | `config/scripts/`                                                                              |
| Register a new runtime RPC method | `src/main/runtime/rpc/methods/rpc-method-registry.ts`, then `pnpm generate:rpc-params-catalog` |
| Add a renderer→main call          | `src/preload/api/<domain>-bridge.ts` + `src/preload/api-types.ts` + `src/main/ipc/`            |
| Where a workspace runs            | `src/shared/execution-host.ts`                                                                 |
| Who may call what                 | `src/main/runtime/rpc/rpc-caller-identity.ts`, `src/main/runtime/rpc/rpc-caller-scope.ts`      |
| Build-time feature switches       | `config/dark-build-switches.cjs`, `src/shared/layout-owner-switch.ts`                          |
