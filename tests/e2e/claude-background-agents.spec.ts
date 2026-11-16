/**
 * The supervisor's promise: a running agent keeps running while the user looks at something else.
 *
 * **This spec writes into a live Claude Code session.** It dispatches its own throw-away agent
 * with `claude --bg`, attaches to it and types into that agent's prompt box; the draft is never
 * submitted, so no LLM turn is ever spent, but the session is a real one. It therefore only runs
 * when the machine's owner asks for it:
 *
 *     ORCA_REAL_CLAUDE_CLI_TEST=1 pnpm run test:e2e -- tests/e2e/claude-background-agents.spec.ts
 *
 * Without that switch the whole spec skips.
 *
 * Reaching this machine's real agents needs three harness concessions, each explained where it
 * is made:
 *
 * 1. The E2E app runs with an isolated HOME, where the Claude Code CLI finds no agents at all, so
 *    the app runs the real CLI with the real config directory through a `claude` launcher.
 * 2. macOS login shells run path_helper, which puts the real `claude` ahead of the launcher's
 *    directory, so the app's shell is a wrapper that drops the login flag.
 * 3. A hidden window never polls, so the spec reports the document as visible.
 *
 * A machine without a Claude Code CLI has nothing to supervise, and CI has none, so the spec skips
 * there instead of pretending.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { expect, test as base } from './helpers/orca-app'
import { resolveClaudeCommand } from '../../src/shared/node-cli-command-resolution'
import { stripAnsiEscapeSequences } from '../../src/shared/ansi-escape-sequences'
import {
  CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
  readClaudeBackgroundAgentsListing,
  type ClaudeBackgroundAgent
} from '../../src/shared/claude-background-agents'

/** The CLI answers a listing in a moment; a wedged CLI must not hang the spec. */
const LISTING_TIMEOUT_MS = 20_000

/** Starting the probe waits for the CLI to bring a session up. */
const DISPATCH_TIMEOUT_MS = 60_000

/** Removing the probe takes its worktree with it, so it gets its own budget. */
const REMOVE_TIMEOUT_MS = 60_000

/** What the probe is asked to do; an answer the CLI can give without touching a tool. */
const PROBE_PROMPT = 'Reply with the single word OK. Do not use any tools.'

/**
 * How many characters the spec types into the attached terminal.
 *
 * The Claude Code TUI redraws its prompt box for every keystroke, and each redraw costs dozens of
 * bytes of escape sequences, so this many keystrokes put tens of kilobytes on the wire — the "a
 * few tens of kilobytes" the design spec asks the E2E to push through.
 */
const TYPED_CHARACTERS = 700

/** The gap between two keystrokes; the TUI folds a faster burst into one paste. */
const KEYSTROKE_DELAY_MS = 25

/** The pause between the filler and the tail marker, so no paste collapse can span both. */
const MARKER_PAUSE_MS = 500

/** How long the tail of the typed stream may take to arrive. */
const TAIL_TIMEOUT_MS = 60_000

/**
 * How many characters the attached terminal has to carry.
 *
 * Calibrated against this machine: 720 keystrokes into the probe agent produced 36,754 characters
 * (≈51 bytes per keystroke), and a raw pty of the same CLI produced ≈43 bytes per keystroke
 * (≈30 KB). The floor sits below both, so a Claude Code that redraws more cheaply still clears it;
 * a run that fails here means the TUI redrew more cheaply than when the floor was set, not that
 * the panel broke.
 */
const MINIMUM_DELIVERED_CHARS = 20_000

/** How many backspaces one cleanup batch sends. */
const PROMPT_CLEAR_BATCH_SIZE = 100

/** How many cleanup batches may run before the spec gives up on an empty prompt box. */
const PROMPT_CLEAR_BATCHES = 12

/** The gap between two backspaces; the TUI drops a faster burst. */
const BACKSPACE_DELAY_MS = 10

type ClaudeLauncher = {
  /** The directory the app's PATH starts with; it holds the `claude` launcher. */
  dir: string
  /** The shell the app spawns; it drops the login flag so the PATH survives. */
  shell: string
}

/** The Claude Code CLI this machine has, or null when it has none. */
function resolveRealClaude(): string | null {
  const resolved = resolveClaudeCommand()
  return path.isAbsolute(resolved) ? resolved : null
}

/** The directory the Claude Code CLI keeps its agents in. */
function resolveRealClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
}

/** The user's own shell; the app's shell has to be one the daemon knows how to drive. */
function resolveRealShell(): string {
  const shell = process.env.SHELL?.trim()
  if (shell && path.isAbsolute(shell)) {
    return shell
  }
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

function quoteShellValue(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * A `claude` launcher that runs the real CLI with the real config directory.
 *
 * The E2E app's HOME is a throwaway profile, so the CLI would report an empty roster there and
 * `claude attach` would find no agent. The launcher keeps the CLI real and only says where its
 * state lives.
 */
function writeClaudeLauncher(dir: string, realClaude: string, configDir: string): void {
  const command = path.join(dir, 'claude')
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      '# The E2E profile has its own HOME, where the CLI finds no agents.',
      `CLAUDE_CONFIG_DIR=${quoteShellValue(configDir)}`,
      'export CLAUDE_CONFIG_DIR',
      `exec ${quoteShellValue(realClaude)} "$@"`,
      ''
    ].join('\n')
  )
  chmodSync(command, 0o755)
}

/**
 * A shell that keeps the PATH the app was given.
 *
 * macOS login shells run path_helper, which puts /usr/local/bin — the real `claude` — ahead of the
 * launcher's directory. Dropping the login flag keeps the launcher's directory first. The daemon's
 * readiness wrapper still works: it hands the shell a ZDOTDIR or a bash rcfile, and the shell reads
 * it as usual.
 */
function writeShellWrapper(dir: string, realShell: string): string {
  // The daemon recognizes a shell by its file name, so the wrapper carries the real shell's name.
  const shell = path.join(dir, path.basename(realShell))
  writeFileSync(
    shell,
    [
      '#!/bin/sh',
      "# macOS login shells run path_helper, which puts the real claude ahead of the launcher's",
      '# directory. Dropping the login flag keeps the PATH the app was given.',
      'case "$1" in',
      `  -ilc|-lic|-ic) exec ${quoteShellValue(realShell)} -c "$2" ;;`,
      'esac',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -l|-i|--login) shift ;;',
      '    *) break ;;',
      '  esac',
      'done',
      `exec ${quoteShellValue(realShell)} "$@"`,
      ''
    ].join('\n')
  )
  chmodSync(shell, 0o755)
  return shell
}

const test = base.extend<{ claudeLauncher: ClaudeLauncher }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixture callbacks require object destructuring here.
  claudeLauncher: async ({}, provideFixture, testInfo) => {
    // Why: the spec types into a live agent's prompt box, so it only runs on request.
    if (process.env.ORCA_REAL_CLAUDE_CLI_TEST !== '1') {
      testInfo.skip(true, 'set ORCA_REAL_CLAUDE_CLI_TEST=1 to run against the real claude CLI')
      return
    }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-claude-launcher-'))
    const realClaude = resolveRealClaude()
    if (realClaude === null) {
      rmSync(dir, { recursive: true, force: true })
      testInfo.skip(true, 'this machine has no Claude Code CLI')
      return
    }
    const launcher: ClaudeLauncher = {
      dir,
      shell: writeShellWrapper(dir, resolveRealShell())
    }
    writeClaudeLauncher(dir, realClaude, resolveRealClaudeConfigDir())
    await provideFixture(launcher)
    rmSync(dir, { recursive: true, force: true })
  },
  launchEnv: async ({ claudeLauncher }, provideFixture) => {
    await provideFixture({
      SHELL: claudeLauncher.shell,
      PATH: [claudeLauncher.dir, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter)
    })
  }
})

/** What the CLI answered, or why its answer cannot be used. */
type AgentsAnswer = { ok: true; agents: ClaudeBackgroundAgent[] } | { ok: false; reason: string }

/**
 * What this machine's Claude Code CLI reports about its agents.
 *
 * A CLI that fails is not an empty roster. The spec has to tell the two apart, or a broken
 * environment hides behind a green skip.
 */
async function askClaudeAgents(extraArgs: readonly string[]): Promise<AgentsAnswer> {
  const realClaude = resolveRealClaude()
  if (!realClaude) {
    return { ok: false, reason: 'this machine has no Claude Code CLI' }
  }
  const result = await runProcess({
    program: realClaude,
    args: ['agents', '--json', ...extraArgs],
    timeoutMs: LISTING_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  })
  if (result.timedOut) {
    return { ok: false, reason: 'the Claude Code CLI timed out' }
  }
  if (result.code !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || `the Claude Code CLI exited with ${String(result.code)}`
    }
  }
  const listing = readClaudeBackgroundAgentsListing(result.stdout)
  if (!listing.ok) {
    return { ok: false, reason: listing.message }
  }
  return { ok: true, agents: listing.agents }
}

/** The CLI prints the new agent's id after `backgrounded`; the panel reads the same line. */
const DISPATCHED_AGENT_LINE_PATTERN = /^backgrounded\s*·\s*(\S+)/m

/**
 * Start the spec's own throw-away agent and report the id the CLI gave it.
 *
 * The probe is what the spec supervises, so the spec never touches the agent the developer is
 * working in.
 *
 * The CLI is the machine's own, and it runs without `CLAUDE_CONFIG_DIR`: the launcher the app
 * uses sets that variable to the real config directory, and with it set the CLI no longer finds
 * the workspace's trust record and refuses to start a session ("Workspace not trusted"). The
 * directory the CLI then uses is the same one the launcher points at — `~/.claude` — so the app
 * and the spec see the same roster.
 */
async function dispatchProbeAgent(): Promise<string> {
  const realClaude = resolveRealClaude()
  if (!realClaude) {
    throw new Error('this machine has no Claude Code CLI')
  }
  const result = await runProcess({
    program: realClaude,
    args: ['--bg', '--', PROBE_PROMPT],
    timeoutMs: DISPATCH_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  })
  if (result.timedOut) {
    throw new Error('the Claude Code CLI timed out while starting the probe agent')
  }
  if (result.code !== 0) {
    throw new Error(
      `the Claude Code CLI could not start the probe agent: ${
        result.stderr.trim() || `it exited with ${String(result.code)}`
      }`
    )
  }
  // The CLI colorizes its answer when the environment asks for color, and the id arrives wrapped
  // in escape sequences.
  const id = DISPATCHED_AGENT_LINE_PATTERN.exec(stripAnsiEscapeSequences(result.stdout))?.[1]
  if (!id) {
    throw new Error(`the Claude Code CLI did not print an agent id: ${result.stdout.trim()}`)
  }
  return id
}

/**
 * Delete the probe agent and report why it could not be deleted.
 *
 * A probe that outlives the run is litter on the developer's machine, so the removal happens
 * even when the run failed; a removal that fails is reported rather than failed on.
 */
async function removeProbeAgent(id: string): Promise<string | null> {
  const realClaude = resolveRealClaude()
  if (!realClaude) {
    return 'this machine has no Claude Code CLI'
  }
  const result = await runProcess({
    program: realClaude,
    args: ['rm', id],
    timeoutMs: REMOVE_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  })
  if (result.code === 0) {
    return null
  }
  return result.stderr.trim() || `the Claude Code CLI exited with ${String(result.code)}`
}

/** A token no transcript is likely to carry, so what the spec typed is what it looks for. */
function randomToken(): string {
  return Math.random().toString(36).slice(2, 8)
}

test('entering a running agent and coming back leaves the agent running', async ({
  orcaPage
}, testInfo) => {
  const probeId = await dispatchProbeAgent()
  try {
    // The panel polls only while the window is visible, and the E2E window stays hidden.
    await orcaPage.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible'
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      state?.setRightSidebarOpen(true)
      state?.setRightSidebarWidth(400)
    })
    await orcaPage.getByRole('button', { name: 'Background agents', exact: true }).click()

    const rows = orcaPage.getByTestId('background-agent-row')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true')

    // The arrow keys walk the rows the way the CLI's own list does. With a single row there is
    // nowhere to walk to, and the selection has to stay where it is.
    const rowCount = await rows.count()
    const rowAfterArrowDown = rowCount > 1 ? rows.nth(1) : rows.first()
    await orcaPage.keyboard.press('ArrowDown')
    await expect(rowAfterArrowDown).toHaveAttribute('aria-selected', 'true')
    await orcaPage.keyboard.press('ArrowUp')
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true')

    // The probe's own row, named by its id — the panel's rows carry it.
    const probeRow = orcaPage.locator(
      `[data-testid="background-agent-row"][data-agent-id="${probeId}"]`
    )
    await expect(probeRow).toHaveCount(1, { timeout: 30_000 })
    // Walk the selection onto it; the selection starts on the first row and only moves down.
    await expect
      .poll(
        async () => {
          const selectedId = await orcaPage
            .locator('[data-testid="background-agent-row"][aria-selected="true"]')
            .getAttribute('data-agent-id')
          if (selectedId === probeId) {
            return true
          }
          await orcaPage.keyboard.press('ArrowDown')
          return false
        },
        { timeout: 15_000 }
      )
      .toBe(true)
    await expect(probeRow).toHaveAttribute('aria-selected', 'true')

    // Enter opens the agent's own terminal.
    await orcaPage.keyboard.press('Enter')
    await expect(orcaPage.getByTestId('background-agents-agent')).toBeVisible({ timeout: 30_000 })
    await expect(orcaPage.getByRole('button', { name: 'Back to the agent list' })).toBeVisible()

    // The Claude Code TUI's prompt glyph. It proves the TUI drew itself; the glyph belongs to the
    // Claude Code CLI, so a CLI release that changes it breaks this assertion.
    const terminalScreen = orcaPage.locator(
      '[data-testid="background-agent-terminal"] .xterm-screen'
    )
    await expect(terminalScreen).toContainText('❯', { timeout: 30_000 })

    // Push a long stream through the attached terminal. The TUI echoes what is typed and redraws
    // its prompt box for every keystroke, so the keystrokes are what put tens of kilobytes on the
    // wire. The marker at the very end of the stream is what proves the tail arrived: a delivery
    // that stalls half-way through never renders it.
    const attachPtyId = await orcaPage.evaluate(
      () => window.__store?.getState().backgroundAgentsAttachedPtyId ?? null
    )
    if (!attachPtyId) {
      throw new Error('the attached terminal has no PTY of its own')
    }
    const readProducedChars = async (): Promise<number | null> =>
      await orcaPage.evaluate(async (id) => {
        const snapshot = await window.api.pty.getMainBufferSnapshot(id)
        return snapshot?.seq ?? null
      }, attachPtyId)
    const producedBefore = await readProducedChars()

    const token = randomToken()
    const marker = `${token}-tail-${Date.now().toString(36)}`
    const filler = token
      .repeat(Math.ceil(TYPED_CHARACTERS / token.length))
      .slice(0, TYPED_CHARACTERS)
    await orcaPage.keyboard.type(filler, { delay: KEYSTROKE_DELAY_MS })
    // The marker is typed on its own: a paste collapse in the filler must not be able to swallow
    // the marker too, or the failure would be a timeout instead of a clear error.
    await orcaPage.waitForTimeout(MARKER_PAUSE_MS)
    await orcaPage.keyboard.type(marker, { delay: KEYSTROKE_DELAY_MS })
    // The TUI wraps the prompt box, so the marker can straddle a row boundary.
    await expect(terminalScreen).toContainText(new RegExp([...marker].join('\\s*')), {
      timeout: TAIL_TIMEOUT_MS
    })

    // How much really went through: main counts the characters the attach client produced, and the
    // difference between the two counts is what the panel had to carry.
    const producedAfter = await readProducedChars()
    if (producedBefore === null || producedAfter === null) {
      throw new Error('the attached terminal produced no measurable output')
    }
    expect(
      producedAfter - producedBefore,
      'the attached terminal carried too little output to be worth checking'
    ).toBeGreaterThan(MINIMUM_DELIVERED_CHARS)
    testInfo.annotations.push({
      type: 'attached-terminal-volume',
      description: `the attached terminal carried ${producedAfter - producedBefore} characters`
    })

    // Leave the agent's prompt box as it was found: one backspace per typed character, until the
    // typed text is gone from the screen.
    for (let batch = 0; batch < PROMPT_CLEAR_BATCHES; batch++) {
      const screen = await terminalScreen.textContent()
      if (!screen?.includes(token)) {
        break
      }
      for (let press = 0; press < PROMPT_CLEAR_BATCH_SIZE; press++) {
        await orcaPage.keyboard.press('Backspace', { delay: BACKSPACE_DELAY_MS })
      }
    }
    await expect(terminalScreen).not.toContainText(token)

    // The left arrow goes back while the agent keeps running.
    await orcaPage.keyboard.press('ArrowLeft')
    await expect(orcaPage.getByTestId('background-agents-list')).toBeVisible({ timeout: 15_000 })
    await expect(orcaPage.getByTestId('background-agents-agent')).toHaveCount(0)

    // The promise: the probe is still there. `--all` also lists the sessions that finished on
    // their own, so an agent that ran out of work still counts as still there — what must not
    // happen is that leaving the screen stopped it.
    const after = await askClaudeAgents(['--all'])
    if (!after.ok) {
      throw new Error(`the Claude Code CLI could not list its agents: ${after.reason}`)
    }
    const probe = after.agents.find((agent) => agent.id === probeId)
    expect(probe, `the agent ${probeId} is gone`).toBeTruthy()
    expect(probe?.state, `the agent ${probeId} was stopped`).not.toBe('stopped')
  } finally {
    const removalFailure = await removeProbeAgent(probeId)
    if (removalFailure) {
      testInfo.annotations.push({
        type: 'probe-agent-removal',
        description: `the probe agent ${probeId} could not be removed: ${removalFailure}`
      })
    }
  }
})
