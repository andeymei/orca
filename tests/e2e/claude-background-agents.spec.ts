/**
 * The supervisor's promise: a running agent keeps running while the user looks at something else.
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
 * A machine without a live background agent has nothing to supervise, and CI has none, so the
 * spec skips there instead of pretending.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { expect, test as base } from './helpers/orca-app'
import { resolveClaudeCommand } from '../../src/shared/node-cli-command-resolution'
import {
  CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES,
  parseClaudeBackgroundAgents,
  type ClaudeBackgroundAgent
} from '../../src/shared/claude-background-agents'

/** The CLI answers a listing in a moment; a wedged CLI must not hang the spec. */
const LISTING_TIMEOUT_MS = 20_000

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

/** The agents this machine's Claude Code CLI reports as running. */
async function readLiveBackgroundAgents(): Promise<ClaudeBackgroundAgent[]> {
  const realClaude = resolveRealClaude()
  if (!realClaude) {
    return []
  }
  const result = await runProcess({
    program: realClaude,
    args: ['agents', '--json'],
    timeoutMs: LISTING_TIMEOUT_MS,
    maxOutputBytes: CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES
  })
  if (result.code !== 0 || result.timedOut) {
    return []
  }
  return parseClaudeBackgroundAgents(result.stdout)
}

test('entering a running agent and coming back leaves the agent running', async ({ orcaPage }) => {
  const liveBefore = await readLiveBackgroundAgents()
  test.skip(liveBefore.length === 0, 'this machine has no live Claude Code background agent')

  // The panel polls only while the window is visible, and the E2E window stays hidden.
  await orcaPage.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
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

  // The arrow keys walk the rows the way the CLI's own list does; with one agent there is no
  // second row to walk to.
  if ((await rows.count()) > 1) {
    await orcaPage.keyboard.press('ArrowDown')
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
    await orcaPage.keyboard.press('ArrowUp')
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
  }

  // Enter opens the agent's own terminal.
  await orcaPage.keyboard.press('Enter')
  await expect(orcaPage.getByTestId('background-agents-agent')).toBeVisible({ timeout: 30_000 })
  await expect(orcaPage.getByRole('button', { name: 'Back to the agent list' })).toBeVisible()
  await expect(
    orcaPage.locator('[data-testid="background-agent-terminal"] .xterm-screen')
  ).toHaveText(/\S/, { timeout: 30_000 })

  // Which agent the panel entered; the id is what the liveness check below looks for.
  const enteredAgentId = await orcaPage.evaluate(() => {
    const screen = window.__store?.getState().backgroundAgentsScreen
    return screen?.kind === 'agent' ? screen.agentId : null
  })
  expect(enteredAgentId).toBeTruthy()

  // The left arrow goes back while the agent keeps running.
  await orcaPage.keyboard.press('ArrowLeft')
  await expect(orcaPage.getByTestId('background-agents-list')).toBeVisible({ timeout: 15_000 })
  await expect(orcaPage.getByTestId('background-agents-agent')).toHaveCount(0)

  const liveAfter = await readLiveBackgroundAgents()
  expect(liveAfter.map((agent) => agent.id)).toContain(enteredAgentId)
})
