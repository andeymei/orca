# Qoder CLI as an Orca ACP Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Orca run `qodercli --acp` (and the China build `qoderclicn --acp`) as a structured agent, so a Qoder conversation runs in Orca's native chat instead of only in a terminal pane.

**Architecture:** Orca already ships Qoder as a _terminal_ agent — `TUI_AGENT_CONFIG.qoder` knows the binary, `src/main/qoder/` implements its hooks and workspace trust, and the AI Vault already parses its session files (`~/.qoder/projects/**/qoder-session.jsonl`, whose turns are Claude-shaped). This plan adds the missing half: an `AcpLaunchSpec` that launches the CLI's `--acp` mode over stdio and registers it in the ACP launch registry, plus install/sign-in entries so Orca can set the CLI up.

**Tech Stack:** TypeScript, Electron main process, the repo's ACP stack (`src/main/acp/`), Vitest under Bun.

**Spec:** `docs/superpowers/specs/2026-11-17-next-edit-suggestion-design.md` — §10 (this plan) and §17 (limits).

## Global Constraints

- The ACP protocol types are generated: `src/main/acp/generated/acp-protocol.generated.ts`. Never hand-edit; regenerate with `pnpm generate:acp-protocol`.
- `AcpDialect` is a bag of optional overrides. The standard behaviour is `GENERIC_ACP_DIALECT` (`src/main/acp/acp-dialects/acp-dialect.ts:198`). **Do not add a Qoder dialect until Qoder's ACP is observed to deviate.**
- `qoder` (global build, binary `qodercli`, npm `@qoder-ai/qodercli`) and `qoder-cn` (China build, binary `qoderclicn`, npm `@qodercn-ai/qoderclicn`) are different packages with separate accounts and separate config homes. **Never let one read the other's home.**
- `AcpLaunchSpec.sessionHistory.rowAgents` is typed `readonly AiVaultAgent[]`, so a build can only own History rows under an agent name the AI Vault knows. Task 2 gives the China build that name.
- Comments state _why_, not _how_. One line.
- No `helpers` / `utils` / `common` in a filename — name a file after the domain concept it holds.
- Cross-platform: use `path.join` for paths; never hardcode a shell separator.
- Run tests with `pnpm test <path> --maxWorkers=2` (Bun under the hood). Never raw `vitest`.
- Never run two vitest runs at once on this checkout.

## Review Focus

- A `qoder-cn` chat must never link to a `qoder` History row, and a `qoder` chat must never link to a `qoder-cn` row. The two builds have separate accounts; a shared row identity would leak one build's conversations into the other's history.
- A `qodercli` that is not installed must fail with a message naming the npm package, not a raw spawn `ENOENT`.
- `--acp` must not be recognised as an interactive terminal agent. `src/shared/qoder-agent.test.ts` already asserts `recognizeAgentProcessFromCommandLine('qodercli --acp')` is null — the new spec must not reintroduce that shape as an interactive process.
- Signing in on a remote host must not open a browser prompt no one can see. If a build has no device-code path, say so rather than hanging on an invisible prompt.

---

### Task 1: Teach the agent table how to install and sign in to Qoder

**Files:**

- Modify: `src/shared/agent-session/lifecycle/agent-session-setup-commands.ts` (the `AGENT_SESSION_SETUP_COMMANDS` array, currently ending with the `antigravity` entry)
- Create: `src/shared/agent-session/lifecycle/agent-session-setup-commands.test.ts`

**Interfaces:**

- Consumes: nothing. This task only adds table rows.
- Produces: `agentSessionSetupFor('qoder')` and `agentSessionSetupFor('qoder-cn')` each return an entry with `loginCommand` and `installCommand`. Task 3 reads `agentSessionSetupFor(row.agent)?.loginCommand ?? []` for its spec's `loginCommand`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/agent-session/lifecycle/agent-session-setup-commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { agentSessionSetupFor, AGENT_SESSION_SETUP_COMMANDS } from './agent-session-setup-commands'

describe('Qoder setup commands', () => {
  it('signs in and installs the global build', () => {
    expect(agentSessionSetupFor('qoder')).toEqual({
      agent: 'qoder',
      loginCommand: ['qodercli', 'login'],
      installCommand: 'npm install -g @qoder-ai/qodercli'
    })
  })

  it('signs in and installs the China build under its own command', () => {
    expect(agentSessionSetupFor('qoder-cn')).toEqual({
      agent: 'qoder-cn',
      loginCommand: ['qoderclicn', 'login'],
      installCommand: 'npm install -g @qodercn-ai/qoderclicn'
    })
  })

  it('keeps one agent per row so the two builds never share an entry', () => {
    const agents = AGENT_SESSION_SETUP_COMMANDS.map((entry) => entry.agent)
    expect(new Set(agents).size).toBe(agents.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/shared/agent-session/lifecycle/agent-session-setup-commands.test.ts --maxWorkers=2`
Expected: FAIL — `agentSessionSetupFor('qoder')` returns `undefined`.

- [ ] **Step 3: Add the two rows**

In `src/shared/agent-session/lifecycle/agent-session-setup-commands.ts`, append to the `AGENT_SESSION_SETUP_COMMANDS` array:

```ts
  {
    agent: 'qoder',
    loginCommand: ['qodercli', 'login'],
    installCommand: 'npm install -g @qoder-ai/qodercli'
  },
  {
    agent: 'qoder-cn',
    loginCommand: ['qoderclicn', 'login'],
    installCommand: 'npm install -g @qodercn-ai/qoderclicn'
  },
```

The two builds are separate npm packages with separate accounts, so they get separate rows. The `agent` field must be the `TuiAgent` union member (`'qoder'` / `'qoder-cn'`), not the display name.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/shared/agent-session/lifecycle/agent-session-setup-commands.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-session/lifecycle/agent-session-setup-commands.ts src/shared/agent-session/lifecycle/agent-session-setup-commands.test.ts
git commit -m "feat(agent-launch): let Orca install and sign in to Qoder"
```

---

### Task 2: Give the China build its own History row identity

**Files:**

- Modify: `src/shared/ai-vault/contracts/ai-vault-types.ts` — the `AI_VAULT_AGENTS` array (line 6) and the `AI_VAULT_AGENT_LABELS` map (line 66)
- Modify: `src/shared/ai-vault/session-display/ai-vault-session-log-resource.ts` — the `logFileResolvers` map (line 31)
- Modify: `src/main/ai-vault/session-scope-cwd.ts` — the `AI_VAULT_SCOPE_CWD_SOURCES` map (line 106)
- Modify: `src/main/ai-vault-search/indexing/session-search-index-consumer.ts` — the searchable-agents map (line 23)
- Modify: `src/main/ai-vault/session-scanner-agent-sources.ts` — the `AI_VAULT_AGENT_SOURCES` map (line 90)
- Modify: `src/main/ai-vault/session-scanner-types.ts` — `AiVaultScanOptions` (line 16)
- Modify: `src/main/ai-vault/scanners/qoder/session-scanner-qoder-parser.ts` — label the row with the build that owns it
- Modify: `src/main/ai-vault/session-scanner-agent-parser.ts` — the `parseAgentSessionFile` switch (line 83)
- Create: `src/main/ai-vault/scanners/qoder/qoder-cn-row-identity.test.ts`

**Interfaces:**

- Consumes: `parseQoderSessionFile` (currently `src/main/ai-vault/scanners/qoder/session-scanner-qoder-parser.ts:82`).
- Produces: `parseQoderSessionFile(file, platform, messages, agent?)` — the new fourth parameter defaults to `'qoder'` and labels the parsed row with it. `'qoder-cn'` becomes a valid `AiVaultAgent`, so Task 3 can give the China build's ACP spec a `rowAgents` entry.

- [ ] **Step 1: Write the failing test**

Create `src/main/ai-vault/scanners/qoder/qoder-cn-row-identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_VAULT_AGENTS, AI_VAULT_AGENT_LABELS } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { AI_VAULT_AGENT_SOURCES } from '../../session-scanner-agent-sources'
import { parseQoderSessionFile } from './session-scanner-qoder-parser'

describe('Qoder China build rows', () => {
  it('is a known History agent with its own label', () => {
    expect(AI_VAULT_AGENTS).toContain('qoder-cn')
    expect(AI_VAULT_AGENT_LABELS['qoder-cn']).toBe('Qoder CLI China')
  })

  it('scans the China build's own projects directory', () => {
    const source = AI_VAULT_AGENT_SOURCES['qoder-cn']
    expect(source).toBeDefined()
    const roots = source?.rootDirs?.({}, [])
    expect(roots?.some((root) => root.endsWith(join('.qoder-cn', 'projects')))).toBe(true)
  })

  it('labels a parsed China row as qoder-cn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qoder-cn-rows-'))
    try {
      const file = join(dir, 'qoder-session.jsonl')
      await writeFile(
        file,
        [
          JSON.stringify({ type: 'workspace-directories', directories: ['/tmp/qoder'] }),
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            timestamp: '2026-11-17T00:00:00.000Z'
          })
        ].join('\n'),
        'utf8'
      )
      const session = await parseQoderSessionFile({ path: file, modifiedAt: 0 }, 'linux')
      expect(session?.agent).toBe('qoder-cn')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

If the `FileWithMtime` shape used by `parseQoderSessionFile` differs from `{ path, modifiedAt }`, copy the shape from the existing Qoder scanner test rather than inventing fields.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/ai-vault/scanners/qoder/qoder-cn-row-identity.test.ts --maxWorkers=2`
Expected: FAIL — `'qoder-cn'` is not in `AI_VAULT_AGENTS`.

- [ ] **Step 3: Add the agent name to the exhaustive maps**

In `src/shared/ai-vault/contracts/ai-vault-types.ts`:

- add `'qoder-cn'` to the `AI_VAULT_AGENTS` array, right after `'qoder'`
- add `'qoder-cn': 'Qoder CLI China'` to the `AI_VAULT_AGENT_LABELS` map

In `src/shared/ai-vault/session-display/ai-vault-session-log-resource.ts`, add `'qoder-cn': jsonlLog` to `logFileResolvers`.

In `src/main/ai-vault/session-scope-cwd.ts`, add `'qoder-cn': head((record) => record.cwd)` to `AI_VAULT_SCOPE_CWD_SOURCES`.

In `src/main/ai-vault-search/indexing/session-search-index-consumer.ts`, add `'qoder-cn': true` to the searchable-agents map (the China build's session files are the same JSONL shape as the global build's).

- [ ] **Step 4: Give the parser a build label**

In `src/main/ai-vault/scanners/qoder/session-scanner-qoder-parser.ts`:

- change `createQoderState(file, messages)` to `createQoderState(file, messages, agent: 'qoder' | 'qoder-cn' = 'qoder')` and set `state.accumulator.agent = agent`
- thread the parameter through `parseQoderSessionFile(file, platform, messages, agent?)` and `parseLines(...)`

In `src/main/ai-vault/session-scanner-agent-parser.ts`, add the dispatch arm:

```ts
    case 'qoder-cn':
      return parseQoderSessionFile(candidate.file, platform, messages, 'qoder-cn')
```

- [ ] **Step 5: Add the scanner source**

In `src/main/ai-vault/session-scanner-types.ts`, add `qoderCnProjectsDir?: string` to `AiVaultScanOptions`.

In `src/main/ai-vault/session-scanner-agent-sources.ts`, add a `qoder-cn` entry mirroring the `qoder` one but pointing at the China build's home:

```ts
  'qoder-cn': {
    rootDirs: (options, wslHomeDirs) =>
      sessionRootDirs(
        options.qoderCnProjectsDir ?? join(homedir(), '.qoder-cn', 'projects'),
        wslHomeDirs,
        ['.qoder-cn', 'projects']
      ),
    extensions: ['.jsonl'],
    directoryPredicate: (name) => name !== SUBAGENT_DIR_NAME
  },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/main/ai-vault/scanners/qoder/qoder-cn-row-identity.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Run the AI Vault suites**

Run: `pnpm test src/main/ai-vault src/shared/ai-vault --maxWorkers=2`
Expected: PASS — the new agent name must not break the exhaustive maps.

- [ ] **Step 8: Typecheck**

Run: `pnpm tc:node`
Expected: no errors. The four exhaustive maps over `AiVaultAgent` are the ones that break if a map entry is missed.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ai-vault src/main/ai-vault src/main/ai-vault-search
git commit -m "feat(ai-vault): give the Qoder China build its own History rows"
```

---

### Task 3: The Qoder ACP launch spec

**Files:**

- Create: `src/main/qoder/qoder-acp-launch-spec.ts`
- Create: `src/main/qoder/qoder-acp-launch-spec.test.ts`
- Modify: `src/main/acp/launch/acp-launch-registry.ts` (the `ACP_LAUNCH_SPECS` array)

**Interfaces:**

- Consumes: `agentSessionSetupFor` (Task 1), `'qoder-cn'` as an `AiVaultAgent` (Task 2), `directoryAccountBinding` (`src/main/acp/launch/acp-account-binding.ts:29`), `GENERIC_ACP_DIALECT` (`src/main/acp/acp-dialects/acp-dialect.ts:198`), `resumeInvocationAfterMarker` and `sessionFileResumeTargetMatches` (`src/main/native-chat/structured-agent-cli-conversations.ts:115` and `:166`).
- Produces: `QODER_ACP_LAUNCH_SPECS: readonly AcpLaunchSpec[]`, one entry per build. `acpLaunchSpecFor('qoder')` and `acpLaunchSpecFor('qoder-cn')` return them.

- [ ] **Step 1: Write the failing test**

Create `src/main/qoder/qoder-acp-launch-spec.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { acpLaunchSpecFor } from '../acp/launch/acp-launch-registry'
import { GENERIC_ACP_DIALECT } from '../acp/acp-dialects/acp-dialect'

describe('Qoder ACP launch spec', () => {
  it('launches the global build in ACP mode', () => {
    const spec = acpLaunchSpecFor('qoder')
    expect(spec?.command).toBe('qodercli')
    expect(spec?.args({ fullAccess: false, pluginDir: null })).toEqual(['--acp'])
    expect(spec?.dialect).toBe(GENERIC_ACP_DIALECT)
  })

  it('launches the China build under its own command', () => {
    const spec = acpLaunchSpecFor('qoder-cn')
    expect(spec?.command).toBe('qoderclicn')
    expect(spec?.args({ fullAccess: false, pluginDir: null })).toEqual(['--acp'])
  })

  it('keeps the two builds on separate account homes', () => {
    expect(acpLaunchSpecFor('qoder')?.account.pin.accountHomeVariable).toBe('QODER_HOME')
    expect(acpLaunchSpecFor('qoder-cn')?.account.pin.accountHomeVariable).toBe('QODER_CN_HOME')
  })

  it('signs in with the command each build ships', () => {
    expect(acpLaunchSpecFor('qoder')?.loginCommand).toEqual(['qodercli', 'login'])
    expect(acpLaunchSpecFor('qoder-cn')?.loginCommand).toEqual(['qoderclicn', 'login'])
  })

  it('finds each build in its own install directory', () => {
    const home = '/home/dev'
    expect(acpLaunchSpecFor('qoder')?.installDirectories({ env: {}, homePath: home })).toEqual([
      join(home, '.qoder', 'bin', 'qodercli')
    ])
    expect(acpLaunchSpecFor('qoder-cn')?.installDirectories({ env: {}, homePath: home })).toEqual([
      join(home, '.qoder-cn', 'bin')
    ])
  })

  it('gives each build its own History rows', () => {
    expect(acpLaunchSpecFor('qoder')?.sessionHistory.rowAgents).toEqual(['qoder'])
    expect(acpLaunchSpecFor('qoder-cn')?.sessionHistory.rowAgents).toEqual(['qoder-cn'])
  })

  it('resumes a Qoder session by its --resume argument', () => {
    const history = acpLaunchSpecFor('qoder')?.sessionHistory
    expect(history?.parseResumeArgs(['--resume', 'session-42'])).toEqual({ target: 'session-42' })
    expect(history?.parseResumeArgs(['--acp'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/main/qoder/qoder-acp-launch-spec.test.ts --maxWorkers=2`
Expected: FAIL — `acpLaunchSpecFor('qoder')` returns `null`.

- [ ] **Step 3: Write the spec**

Create `src/main/qoder/qoder-acp-launch-spec.ts`:

```ts
import { join } from 'node:path'
import type { AcpLaunchSpec } from '../acp/launch/acp-launch-contract'
import { GENERIC_ACP_DIALECT } from '../acp/acp-dialects/acp-dialect'
import { directoryAccountBinding } from '../acp/launch/acp-account-binding'
import { agentSessionSetupFor } from '../../shared/agent-session/lifecycle/agent-session-setup-commands'
import {
  resumeInvocationAfterMarker,
  sessionFileResumeTargetMatches,
  type StructuredAgentSessionHistory
} from '../native-chat/structured-agent-cli-conversations'

type QoderBuild = {
  agent: 'qoder' | 'qoder-cn'
  command: string
  accountHomeVariable: string
  accountDirName: '.qoder' | '.qoder-cn'
  installDir: (homePath: string) => string
}

const QODER_BUILDS: readonly QoderBuild[] = [
  {
    agent: 'qoder',
    command: 'qodercli',
    accountHomeVariable: 'QODER_HOME',
    accountDirName: '.qoder',
    installDir: (homePath) => join(homePath, '.qoder', 'bin', 'qodercli')
  },
  {
    agent: 'qoder-cn',
    command: 'qoderclicn',
    accountHomeVariable: 'QODER_CN_HOME',
    accountDirName: '.qoder-cn',
    installDir: (homePath) => join(homePath, '.qoder-cn', 'bin')
  }
]

function qoderSessionHistory(agent: 'qoder' | 'qoder-cn'): StructuredAgentSessionHistory {
  return {
    rowAgents: [agent],
    rowSessionId: (link) => link.handle.nativeId,
    // Qoder stores sessions under its projects folder, whose files are Claude-shaped.
    parseResumeArgs: (args) => resumeInvocationAfterMarker(args, ['--resume']),
    resumeTargetMatches: sessionFileResumeTargetMatches
  }
}

function qoderAcpLaunchSpec(build: QoderBuild): AcpLaunchSpec {
  return {
    agent: build.agent,
    command: build.command,
    args: () => ['--acp'],
    env: {},
    dialect: GENERIC_ACP_DIALECT,
    loginCommand: agentSessionSetupFor(build.agent)?.loginCommand ?? [],
    account: directoryAccountBinding(build.accountHomeVariable, (homePath) =>
      join(homePath, build.accountDirName)
    ),
    installDirectories: ({ homePath }) => [build.installDir(homePath)],
    // The CLI lists models only inside a session; a listing session would land in the user's history.
    modelDiscovery: {
      kind: 'unavailable',
      reason: 'Qoder CLI lists its models inside a session'
    },
    compaction: true,
    transcriptImport: null,
    sessionHistory: qoderSessionHistory(build.agent)
  }
}

export const QODER_ACP_LAUNCH_SPECS: readonly AcpLaunchSpec[] = QODER_BUILDS.map(qoderAcpLaunchSpec)
```

- [ ] **Step 4: Register the specs**

In `src/main/acp/launch/acp-launch-registry.ts`, import `QODER_ACP_LAUNCH_SPECS` from `../../qoder/qoder-acp-launch-spec` and spread it into `ACP_LAUNCH_SPECS`:

```ts
export const ACP_LAUNCH_SPECS: readonly AcpLaunchSpec[] = [
  GROK_LAUNCH_SPEC,
  OPENCODE_LAUNCH_SPEC,
  OPENCODE2_LAUNCH_SPEC,
  OMP_LAUNCH_SPEC,
  ANTIGRAVITY_LAUNCH_SPEC,
  COPILOT_LAUNCH_SPEC,
  ...QODER_ACP_LAUNCH_SPECS
]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/main/qoder/qoder-acp-launch-spec.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Run the surrounding suites**

Run: `pnpm test src/main/acp src/main/qoder --maxWorkers=2`
Expected: PASS — the registry change must not break the existing ACP specs.

- [ ] **Step 7: Commit**

```bash
git add src/main/qoder src/main/acp/launch/acp-launch-registry.ts
git commit -m "feat(acp): run Qoder CLI as an ACP agent"
```

---

### Task 4: Prove a Qoder ACP session starts

**Files:**

- Create: `src/main/qoder/qoder-acp-session-launch.test.ts`
- Create: `docs/readme/qoder-acp-agent.md` (a short runbook for the manual path)

**Interfaces:**

- Consumes: `QODER_ACP_LAUNCH_SPECS` (Task 3) and the repo's existing ACP connection rig.
- Produces: an opt-in test that proves a real `qodercli --acp` handshake, and a runbook a human can follow when the test machine has no Qoder account.

- [ ] **Step 1: Write the opt-in test**

Create `src/main/qoder/qoder-acp-session-launch.test.ts`. Follow the repo's existing opt-in pattern (`describe.skipIf(...)`, as the WSL suites use): detect the binary with a `which`-style lookup and skip the whole suite when it is absent.

The suite must:

- launch the build's command with the spec's `args({ fullAccess: false, pluginDir: null })`
- send the ACP `initialize` request and assert the response carries a protocol version and an agent capability block
- close the connection and assert the process exits

Reuse the repo's ACP rig rather than hand-rolling a stdio client: `src/main/acp/turns/acp-structured-image-prompts.test.ts` opens a rig from an `AcpLaunchSpec`, and `src/main/acp/launch/acp-structured-launch-resolution.ts` exports `resolveAcpLaunchCommand`.

- [ ] **Step 2: Run the test to verify it skips cleanly**

Run: `pnpm test src/main/qoder/qoder-acp-session-launch.test.ts --maxWorkers=2`
Expected: SKIPPED (the CLI is not installed on this machine) — not a failure.

- [ ] **Step 3: Write the runbook**

Create `docs/readme/qoder-acp-agent.md` covering:

- installing the build: `npm install -g @qoder-ai/qodercli` (or `@qodercn-ai/qoderclicn`)
- signing in: `qodercli login`
- starting a Qoder chat in Orca and confirming the ACP session is the one talking
- how to tell an ACP chat apart from the existing terminal Qoder agent (the ACP one lives in native chat; the terminal one is a pane)
- the two builds' separate accounts, and that each needs its own `login`

Keep it under 40 lines.

- [ ] **Step 4: Commit**

```bash
git add src/main/qoder/qoder-acp-session-launch.test.ts docs/readme/qoder-acp-agent.md
git commit -m "test(acp): prove a Qoder ACP session starts"
```
