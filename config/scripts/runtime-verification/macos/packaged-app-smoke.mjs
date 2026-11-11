// Real-machine smoke test for a packaged macOS Orca app.
//
// Launches the packaged .app against a disposable profile, keeps every window hidden
// (ORCA_BACKGROUND_LAUNCH=1), then drives the live renderer over CDP: shell round trip,
// runtime RPC, the packaged CLI, and a terminal pane rendered from a real worktree.
//
// Run from the repository root:
//   node config/scripts/runtime-verification/macos/packaged-app-smoke.mjs <path to Orca.app>
//
// ORCA_PACKAGED_APP_PATH overrides the positional path, which lets the package.json entry
// default to the locally built bundle.
//
// The app under test is a released or locally built bundle; this script never builds it.
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const APP_PATH = resolve(
  process.env.ORCA_PACKAGED_APP_PATH ?? process.argv[2] ?? 'dist/mac/Orca.app'
)
const CDP_PORT = Number(process.env.ORCA_SMOKE_CDP_PORT ?? 9333)
const RUN_DIR = process.env.ORCA_SMOKE_RUN_DIR ?? join(tmpdir(), `orca-mac-smoke-${process.pid}`)
const SCREENSHOT_PATH = join(RUN_DIR, 'orca-packaged-smoke.png')
const ONBOARDING_SOURCE = resolve(
  import.meta.dirname,
  '../../../../src/shared/onboarding-defaults.ts'
)

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

// The onboarding constants live in TypeScript; read them so this script stays in step with
// the app instead of hardcoding a wizard version that drifts.
function readOnboardingConstants() {
  const source = readFileSync(ONBOARDING_SOURCE, 'utf8')
  const flowVersion = /export const ONBOARDING_FLOW_VERSION = (\d+)/.exec(source)?.[1]
  const finalStep = /export const ONBOARDING_FINAL_STEP = (\d+)/.exec(source)?.[1]
  if (!flowVersion || !finalStep) {
    throw new Error(`Could not read the onboarding constants from ${ONBOARDING_SOURCE}`)
  }
  return { flowVersion: Number(flowVersion), finalStep: Number(finalStep) }
}

function seedCompletedOnboarding(userDataDir) {
  const { flowVersion, finalStep } = readOnboardingConstants()
  writeFileSync(
    join(userDataDir, 'orca-data.json'),
    `${JSON.stringify(
      {
        settings: {
          telemetry: {
            optedIn: true,
            installId: '00000000-0000-4000-8000-000000000000',
            existedBeforeTelemetryRelease: false
          }
        },
        onboarding: { flowVersion, closedAt: 1, outcome: 'completed', lastCompletedStep: finalStep }
      },
      null,
      2
    )}\n`
  )
}

function createFixtureRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true })
  const git = (...args) =>
    spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', timeout: 30_000 })
  git('init', '-q')
  git('config', 'user.email', 'smoke@test.local')
  git('config', 'user.name', 'Orca Smoke')
  writeFileSync(join(repoDir, 'README.md'), '# Orca packaged smoke fixture\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Initial commit')
}

const homeDir = join(RUN_DIR, 'home')
const userDataDir = join(RUN_DIR, 'userData')
const fixtureRepo = join(RUN_DIR, 'fixture-repo')
mkdirSync(homeDir, { recursive: true, mode: 0o700 })
mkdirSync(userDataDir, { recursive: true })
seedCompletedOnboarding(userDataDir)
createFixtureRepo(fixtureRepo)
const isolatedHome = realpathSync.native(homeDir)

const appLog = createWriteStream(join(RUN_DIR, 'app.log'), { flags: 'a' })
const app = spawn(join(APP_PATH, 'Contents/MacOS/Orca'), [`--remote-debugging-port=${CDP_PORT}`], {
  env: {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    ORCA_E2E_USER_DATA_DIR: userDataDir,
    ORCA_E2E_HOME_DIR: isolatedHome,
    ORCA_DISABLE_MACOS_LOGIN_SHELL: '1',
    // Agent-launched Electron never shows, focuses or activates a window.
    ORCA_BACKGROUND_LAUNCH: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})
app.stdout.pipe(appLog)
app.stderr.pipe(appLog)

async function waitForCdp(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (app.exitCode !== null) {
      throw new Error(`the app exited early with code ${app.exitCode}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) {
        return await response.json()
      }
    } catch {
      // The endpoint opens before the window exists.
    }
    await sleep(500)
  }
  throw new Error('timed out waiting for the CDP endpoint')
}

function runCli(cliPath, cliEnv, args, timeoutMs = 90_000) {
  return spawnSync(cliPath, args, { env: cliEnv, encoding: 'utf8', timeout: timeoutMs })
}

let browser
let orcaPage

try {
  const version = await waitForCdp()
  check('CDP endpoint reachable', true, version.Browser)

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
  const pageDeadline = Date.now() + 120_000
  let pages = []
  let scored = []
  while (Date.now() < pageDeadline && scored.length === 0) {
    pages = browser.contexts().flatMap((context) => context.pages())
    scored = []
    for (const page of pages) {
      const mounted = await page
        .locator('[data-testid="sortable-tab"], #root, [data-testid="sidebar"]')
        .first()
        .count()
        .catch(() => 0)
      if (mounted > 0) {
        scored.push({ page, isMain: /index\.html/.test(page.url()) })
      }
    }
    if (scored.length === 0) {
      await sleep(1000)
    }
  }
  scored.sort((left, right) => Number(right.isMain) - Number(left.isMain))
  orcaPage = scored[0]?.page
  check(
    'Orca renderer identified',
    Boolean(orcaPage),
    orcaPage ? orcaPage.url() : 'no renderer found'
  )
  if (!orcaPage) {
    throw new Error('the Orca renderer was not found among the CDP pages')
  }

  await orcaPage.waitForLoadState('domcontentloaded')
  await orcaPage.waitForTimeout(2000)

  const shell = await orcaPage.evaluate(() => {
    const root = document.querySelector('#root')
    return {
      hasRoot: Boolean(root),
      childCount: root?.childElementCount ?? 0,
      buttonCount: document.querySelectorAll('button').length
    }
  })
  check(
    'renderer shell mounted',
    shell.hasRoot && shell.childCount > 0 && shell.buttonCount > 0,
    `root children=${shell.childCount} buttons=${shell.buttonCount}`
  )

  // A PTY round trip exercises the packaged node-pty build, the terminal daemon and xterm.
  const terminal = await orcaPage.evaluate(async () => {
    const api = window.api
    if (!api?.pty?.spawn) {
      return { error: 'window.api.pty.spawn is unavailable' }
    }
    const received = []
    const unsubscribe = api.pty.onData((event) => {
      if (event?.id) {
        received.push(event.data ?? '')
      }
    })
    try {
      const spawned = await api.pty.spawn({ cols: 100, rows: 30, cwd: '/tmp' })
      const id = typeof spawned === 'string' ? spawned : spawned?.id
      if (!id) {
        return { error: `spawn returned no pty id: ${JSON.stringify(spawned).slice(0, 160)}` }
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 1200))
      api.pty.write(id, 'echo ORCA_PACKAGED_TERMINAL_OK\r', 'driving')
      const deadline = Date.now() + 25_000
      let live = ''
      while (Date.now() < deadline && !live.includes('ORCA_PACKAGED_TERMINAL_OK')) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 400))
        live = received.join('')
      }
      const snapshot = await api.pty
        .getMainBufferSnapshot(id, { scrollbackRows: 200 })
        .catch(() => null)
      const buffer = snapshot?.data ?? ''
      return {
        id,
        live: live.includes('ORCA_PACKAGED_TERMINAL_OK'),
        buffer: buffer.includes('ORCA_PACKAGED_TERMINAL_OK'),
        bytes: received.join('').length
      }
    } finally {
      unsubscribe?.()
    }
  })
  check(
    'PTY round trip',
    terminal.live === true || terminal.buffer === true,
    terminal.error ??
      `pty=${terminal.id} live=${terminal.live} buffer=${terminal.buffer} bytes=${terminal.bytes}`
  )

  const rpc = await orcaPage.evaluate(async () => {
    try {
      const response = await window.api.runtime.call({
        method: 'terminalDaemon.severedStatus',
        params: null
      })
      return response?.ok === true
        ? { ok: true, detail: JSON.stringify(response.result).slice(0, 160) }
        : { ok: false, detail: JSON.stringify(response?.error ?? response).slice(0, 200) }
    } catch (error) {
      return { ok: false, detail: String(error).slice(0, 200) }
    }
  })
  check('runtime RPC reachable from the renderer', rpc.ok, rpc.detail)

  const cliPath = join(APP_PATH, 'Contents/Resources/bin/orca')
  const cliEnv = { ...process.env, HOME: isolatedHome, ORCA_USER_DATA_PATH: userDataDir }

  const cliHelp = runCli(cliPath, cliEnv, ['--help'], 60_000)
  check(
    'packaged CLI loads',
    cliHelp.status === 0,
    `exit=${cliHelp.status} stderr=${(cliHelp.stderr ?? '').slice(0, 160)}`
  )

  // The runtime socket is published slightly after the window appears, so poll for it.
  let cliStatus = { status: 1, stdout: '', stderr: '' }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    cliStatus = runCli(cliPath, cliEnv, ['status', '--json'])
    if (cliStatus.status === 0) {
      break
    }
    spawnSync('sleep', ['3'])
  }
  check(
    'packaged CLI reaches the running runtime',
    cliStatus.status === 0,
    `exit=${cliStatus.status} out=${(cliStatus.stdout ?? '').slice(0, 160)}`
  )

  const repoAdd = runCli(cliPath, cliEnv, [
    'repo',
    'add',
    '--path',
    fixtureRepo,
    '--kind',
    'git',
    '--json'
  ])
  check(
    'packaged CLI registers a repo',
    repoAdd.status === 0,
    `exit=${repoAdd.status} out=${(repoAdd.stdout ?? '').slice(0, 160)} err=${(repoAdd.stderr ?? '').slice(0, 160)}`
  )

  const worktreeCreate = runCli(
    cliPath,
    cliEnv,
    [
      'worktree',
      'create',
      '--name',
      'packaged-smoke',
      '--repo',
      `path:${fixtureRepo}`,
      '--activate',
      '--json'
    ],
    180_000
  )
  check(
    'packaged CLI creates and activates a worktree',
    worktreeCreate.status === 0,
    `exit=${worktreeCreate.status} out=${(worktreeCreate.stdout ?? '').slice(0, 160)} err=${(worktreeCreate.stderr ?? '').slice(0, 160)}`
  )
  await sleep(4000)

  let paneCount = 0
  const paneDeadline = Date.now() + 60_000
  while (Date.now() < paneDeadline && paneCount === 0) {
    await orcaPage.waitForTimeout(1500)
    paneCount = await orcaPage
      .locator('.xterm')
      .count()
      .catch(() => 0)
  }
  check('terminal pane rendered', paneCount > 0, `xterm panes=${paneCount}`)

  // Ask the live PTYs to echo a marker, then read it back from the main-process buffer.
  const echo = await orcaPage.evaluate(async (marker) => {
    const api = window.api
    const sessions = await api.pty.listSessions({ connectionId: null }).catch(() => [])
    const ids = (sessions ?? []).map((session) => session.id).filter(Boolean)
    for (const id of ids) {
      try {
        api.pty.write(id, `echo ${marker}\r`, 'driving')
      } catch {
        // The session went away mid-probe.
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
    for (const id of ids) {
      const snapshot = await api.pty
        .getMainBufferSnapshot(id, { scrollbackRows: 100 })
        .catch(() => null)
      if ((snapshot?.data ?? '').includes(marker)) {
        return { found: true, sessions: ids.length }
      }
    }
    return { found: false, sessions: ids.length }
  }, 'ORCA_PACKAGED_TERMINAL_OK')
  check('live shell echoes a command', echo.found === true, `sessions=${echo.sessions}`)

  await orcaPage.waitForTimeout(1500)
  await orcaPage.screenshot({ path: SCREENSHOT_PATH }).catch(() => {})
  console.log(`[shot] ${SCREENSHOT_PATH}`)

  check('app still running', app.exitCode === null, `exitCode=${app.exitCode}`)
} catch (error) {
  check('smoke run completed without throwing', false, String(error).slice(0, 400))
} finally {
  await browser?.close().catch(() => {})
  app.kill('SIGTERM')
  await sleep(1500)
  if (app.exitCode === null) {
    app.kill('SIGKILL')
  }
}

const failed = results.filter((result) => !result.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`)
for (const failure of failed) {
  console.log(`FAILED: ${failure.name}`)
}
process.exit(failed.length === 0 ? 0 : 1)
