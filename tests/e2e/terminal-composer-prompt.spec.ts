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
  await orcaPage.evaluate((targetTabId) => {
    const pane = window.__paneManagers?.get(targetTabId)?.getActivePane()
    pane?.terminal.focus()
    pane?.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, tabId)
  await orcaPage.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P')

  const editor = orcaPage.locator('[data-terminal-composer-editor="true"]')
  await expect(editor).toBeVisible()

  // Type it: `fill` sets the DOM text directly, which ProseMirror does not always read back
  // into the document. Keystrokes are what the editor actually sees, so they go to the
  // contenteditable field the composer owns.
  const field = editor.locator('[contenteditable="true"]')
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
