import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import type { Page } from '@stablyai/playwright-test'
import { formatNativeChatFileReference } from '../../src/shared/agent-image-paste'
import { test, expect } from './helpers/orca-app'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  resolveActiveTabId,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test.describe.configure({ mode: 'serial' })

test.use({ launchEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

/** The PNG the attachment test drops; its bytes are what the workspace copy must hold. */
function composerFixturePng(): Buffer {
  const png = new PNG({ width: 8, height: 8 })
  for (let index = 3; index < png.data.length; index += 4) {
    png.data[index] = 255
  }
  png.data.fill(90, 0, png.data.length - 4)
  return PNG.sync.write(png)
}

/** The terminal's own focus, so the composer's shortcut resolves on the terminal's key path. */
async function focusTerminalAndOpenComposer(
  orcaPage: Page,
  tabId: string,
  isMac: boolean
): Promise<void> {
  await orcaPage.evaluate((targetTabId) => {
    const pane = window.__paneManagers?.get(targetTabId)?.getActivePane()
    pane?.terminal.focus()
    pane?.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, tabId)
  await orcaPage.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P')
}

test('the terminal composer writes a multi-line prompt and then Enter', async ({
  electronApp,
  orcaPage
}) => {
  await installTerminalPtyWriteSpy(electronApp)
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)

  const tabId = await resolveActiveTabId(orcaPage)
  if (!tabId) {
    throw new Error('Expected an active terminal tab')
  }
  const ptyId = await waitForActivePanePtyId(orcaPage)

  // The shortcut rides the terminal's own key path, so the terminal has to hold the focus
  // first; a synthetic event on the window never reaches the terminal's handler.
  const isMac = await orcaPage.evaluate(() => navigator.userAgent.includes('Mac'))
  await focusTerminalAndOpenComposer(orcaPage, tabId, isMac)

  const editor = orcaPage.locator('[data-terminal-composer-editor="true"]')
  await expect(editor).toBeVisible()

  // Type it: `fill` sets the DOM text directly, which ProseMirror does not always read back
  // into the document. Keystrokes are what the editor actually sees, so they go to the
  // contenteditable field the composer owns.
  const field = editor.locator('[data-prompt-editor="true"]')
  await field.click()
  await field.pressSequentially('first line')
  await field.press('Enter')
  await field.pressSequentially('second line')

  await clearTerminalPtyWriteLog(electronApp)
  await field.press(isMac ? 'Meta+Enter' : 'Control+Enter')

  // The frame normalizes the draft's newline to a carriage return, the way xterm's own paste
  // path does.
  await expect
    .poll(async () =>
      (await readTerminalPtyWriteEntries(electronApp))
        .filter((entry) => entry.id === ptyId)
        .map((entry) => entry.data)
        .join('')
    )
    .toContain('\x1b[200~first line\rsecond line\x1b[201~')
  // The submit must be a write of its own, and its whole payload must be the CR: the framed
  // body above carries a CR too (the frame normalizes line endings), so joining the writes
  // would pass even when the submit was swallowed.
  await expect
    .poll(
      async () =>
        (await readTerminalPtyWriteEntries(electronApp)).filter(
          (entry) => entry.id === ptyId && entry.data === '\r'
        ).length
    )
    .toBe(1)
})

test('a dropped attachment lands in the workspace and its path reaches the PTY', async ({
  electronApp,
  orcaPage
}) => {
  await installTerminalPtyWriteSpy(electronApp)
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)

  const tabId = await resolveActiveTabId(orcaPage)
  if (!tabId) {
    throw new Error('Expected an active terminal tab')
  }
  const ptyId = await waitForActivePanePtyId(orcaPage)

  const isMac = await orcaPage.evaluate(() => navigator.userAgent.includes('Mac'))
  await focusTerminalAndOpenComposer(orcaPage, tabId, isMac)

  const editor = orcaPage.locator('[data-terminal-composer-editor="true"]')
  await expect(editor).toBeVisible()

  const fixtureName = 'orca-composer-fixture.png'
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'orca-composer-fixture-'))
  const fixturePath = path.join(fixtureDir, fixtureName)
  const fixtureBytes = composerFixturePng()
  writeFileSync(fixturePath, fixtureBytes)

  try {
    // The composer takes the drop through the OS file drop owner, and an owner ignores an
    // untrusted event on purpose: the drop has to arrive through the browser's own input
    // pipeline, where the file still carries its path on disk.
    const box = await editor.boundingBox()
    if (!box) {
      throw new Error('Expected the composer field to have a box')
    }
    const client = await orcaPage.context().newCDPSession(orcaPage)
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + box.height / 2)
    const data = { items: [], files: [fixturePath], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
      await client.send('Input.dispatchDragEvent', { type, x, y, data })
    }

    // The attachment shows as a pill in the composer.
    await expect(orcaPage.locator('[data-prompt-image-reference]')).toBeVisible()

    const landed = await orcaPage.evaluate((targetTabId) => {
      const state = window.__store?.getState()
      const pane = window.__paneManagers?.get(targetTabId)?.getActivePane()
      const draft = state?.terminalComposerDraftByPaneKey?.[`${targetTabId}:${pane?.leafId ?? ''}`]
      const worktrees = Object.values(state?.worktreesByRepo ?? {}).flat()
      return {
        workspacePath: draft?.attachments[0]?.workspacePath ?? null,
        workspaceRoot:
          worktrees.find((worktree) => worktree.id === state?.activeWorktreeId)?.path ?? null
      }
    }, tabId)
    // A drop that landed nowhere has no path to assert on.
    if (!landed.workspaceRoot || !landed.workspacePath) {
      throw new Error('The attachment did not land in the workspace')
    }
    const landedPath = landed.workspacePath
    // The copy lands in the workspace that owns the terminal, not in a temp directory.
    expect(landedPath).toBe(path.join(landed.workspaceRoot, '.orca', 'drops', fixtureName))
    // The bytes on disk are the fixture's bytes.
    expect(existsSync(landedPath)).toBe(true)
    expect(readFileSync(landedPath).equals(fixtureBytes)).toBe(true)

    await clearTerminalPtyWriteLog(electronApp)
    await editor
      .locator('[data-prompt-editor="true"]')
      .press(isMac ? 'Meta+Enter' : 'Control+Enter')

    // No agent runs in a plain shell, so the path travels as a file reference in its own
    // frame. The quoting rule belongs to the shared formatter: a path that carries
    // whitespace or an `@` is quoted, so the expected form is derived, not hard-coded.
    const reference = formatNativeChatFileReference(landedPath)
    await expect
      .poll(async () =>
        (await readTerminalPtyWriteEntries(electronApp))
          .filter((entry) => entry.id === ptyId)
          .map((entry) => entry.data)
          .join('')
      )
      .toContain(`\x1b[200~${reference}\x1b[201~`)
    // The submit is still a write of its own.
    await expect
      .poll(
        async () =>
          (await readTerminalPtyWriteEntries(electronApp)).filter(
            (entry) => entry.id === ptyId && entry.data === '\r'
          ).length
      )
      .toBe(1)
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})
