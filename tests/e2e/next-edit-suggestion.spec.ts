import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

/** The text the mock's edit proposes. */
const MOCK_EDIT_TEXT = '42'

/** The accept case types ten characters, so the cursor stands on column 11. */
const ACCEPT_EDIT_COLUMN = 11

/** The jump case's first line holds eleven characters, so the edit lands on column 12. */
const JUMP_EDIT_COLUMN = 12

/** The seven fields the settings block carries; the normalizer resets every field it is not given. */
const CODE_COMPLETION_SETTINGS = {
  enabled: true,
  protocol: 'anthropic-messages',
  model: 'e2e-model',
  triggerDelayMs: 0,
  autoImport: false,
  enabledExtensions: ['ts']
}

/**
 * The plan the mock answers with: one insert of `text` at the given line and column.
 *
 * The plan carries the model's own numbers, and the backend takes the cursor marker back off them.
 * A file whose whole prefix fits the budget starts at line 1, so the model's line 1 is the file's
 * line 1, and a column on the cursor's own line is the file's own column.
 */
function mockPlan(filePath: string, line: number, column: number): string {
  return JSON.stringify({
    edits: [
      {
        id: 'edit-1',
        path: filePath,
        kind: 'insert',
        range: {
          startLine: line,
          startColumn: column,
          endLine: line,
          endColumn: column
        },
        originalText: '',
        text: MOCK_EDIT_TEXT,
        label: 'add a value'
      }
    ]
  })
}

type PlanEndpoint = {
  baseUrl: string
  close: () => Promise<void>
}

/**
 * A local endpoint that answers like the Anthropic messages API. The reader keeps only the `data:`
 * lines and the text extractor only the `content_block_delta` events, so the plan has to ride inside
 * one such event.
 */
async function startPlanEndpoint(planText: string): Promise<PlanEndpoint> {
  const server = createServer((request, response) => {
    // Why: the request carries the key in x-api-key, so only the method and the path are logged.
    console.log(`[nes-mock] ${request.method} ${request.url}`)
    request.on('data', () => {})
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: planText }
        })}\n\n`
      )
      response.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
      response.end()
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    // Why: 127.0.0.1 is in the proxy bypass lists, and the backend appends the protocol path itself.
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

/**
 * Point the feature at the endpoint and give it a key. Three preconditions fail silently — the
 * handler answers "no plan" when the feature is off, when the endpoint or the model is empty, and
 * when the key file cannot be read — so each one is waited for before anything is typed.
 */
async function pointTheFeatureAt(page: Page, baseUrl: string): Promise<void> {
  await page.evaluate(
    (codeCompletion) => window.__store?.getState().updateSettings({ codeCompletion }),
    { ...CODE_COMPLETION_SETTINGS, baseUrl }
  )
  await expect
    .poll(() => page.evaluate(() => window.__store?.getState().settings?.codeCompletion?.baseUrl), {
      timeout: 30_000
    })
    .toBe(baseUrl)
  await page.evaluate(() => window.api.codeCompletion.saveApiKey('e2e-test-key'))
  // Why: a key the other Orca app on this machine sealed reads as configured but cannot be used.
  await expect
    .poll(() => page.evaluate(() => window.api.codeCompletion.getStatus()), { timeout: 30_000 })
    .toMatchObject({ configured: true, unreadable: undefined })
}

/** The worktree that owns the seeded repository. */
async function worktreeIdFor(page: Page, repoPath: string): Promise<string> {
  const worktreeId = await page.evaluate(
    (path) =>
      window.__store
        ?.getState()
        .allWorktrees()
        .find((worktree) => worktree.path === path)?.id ?? null,
    repoPath
  )
  if (!worktreeId) {
    throw new Error('The seeded worktree is missing')
  }
  return worktreeId
}

/** Open the file through its worktree; the editor only asks for plans for the extensions it is on for. */
async function openTypescriptFile(page: Page, filePath: string, worktreeId: string): Promise<void> {
  await page.evaluate(
    ({ filePath, worktreeId }) => {
      window.__store?.getState().setActiveWorktree(worktreeId, 'local')
      window.__store?.getState().openFile({
        filePath,
        relativePath: filePath.split(/[\\/]/).pop() ?? filePath,
        worktreeId,
        runtimeEnvironmentId: null,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { filePath, worktreeId }
  )
}

/** The editor that shows the opened file. */
function visibleEditor(page: Page) {
  return page.locator('.monaco-editor[data-uri^="file:"]').filter({ visible: true })
}

/** Wait until the editor of the opened file is mounted. */
async function waitForEditorFile(page: Page, filePath: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__monacoEditorE2E?.filePath), { timeout: 30_000 })
    .toBe(filePath)
}

/** The buffer of the mounted editor. */
function editorValue(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__monacoEditorE2E?.value())
}

/** The cursor of the mounted editor, as `line:column`. */
function editorCursor(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const selection = window.__monacoEditorE2E?.snapshot().selection
    return selection ? `${selection.startLineNumber}:${selection.startColumn}` : null
  })
}

test('shows the predicted edit at the cursor and Tab accepts it', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  // Why: a cold app launch plus the plan's round trip can outlast the default budget.
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)

  // Why: one line and no trailing newline, so the cursor the test creates is line 1, column 11.
  const filePath = path.join(testRepoPath, `nes-accept-${randomUUID()}.ts`)
  await writeFile(filePath, '', 'utf8')
  registerPostElectronShutdownCleanup(() => rm(filePath, { force: true }))

  const worktreeId = await worktreeIdFor(orcaPage, testRepoPath)
  const endpoint = await startPlanEndpoint(mockPlan(filePath, 1, ACCEPT_EDIT_COLUMN))
  try {
    await pointTheFeatureAt(orcaPage, endpoint.baseUrl)
    await openTypescriptFile(orcaPage, filePath, worktreeId)
    await waitForEditorFile(orcaPage, filePath)

    const editor = visibleEditor(orcaPage)
    await editor.click()
    await orcaPage.keyboard.press('ControlOrMeta+End')
    await orcaPage.keyboard.type('const x = ')

    const ghostText = editor.locator('.ghost-text-decoration')
    await expect(ghostText).toBeVisible({ timeout: 30_000 })
    await expect(ghostText).toHaveText(MOCK_EDIT_TEXT)
    // The editor paints the suggestion into the line it belongs to.
    await expect(editor.locator('.view-lines')).toContainText(MOCK_EDIT_TEXT)

    // Why: the suggestion is a ghost, so the buffer still holds only what was typed.
    await expect.poll(() => editorValue(orcaPage)).toBe('const x = ')

    await orcaPage.keyboard.press('Tab')
    await expect.poll(() => editorValue(orcaPage)).toBe(`const x = ${MOCK_EDIT_TEXT}`)
  } finally {
    await endpoint.close()
    await orcaPage.evaluate(() => window.api.codeCompletion.clearApiKey()).catch(() => undefined)
  }
})

test('Tab jumps to the predicted location when the cursor is not on it', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  // Why: a cold app launch plus the plan's round trip can outlast the default budget.
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)

  // Why: the jump case needs a second line, so the plan has a location that is not the cursor's.
  const filePath = path.join(testRepoPath, `nes-jump-${randomUUID()}.ts`)
  await writeFile(filePath, 'const a = 1\nconst b = 2', 'utf8')
  registerPostElectronShutdownCleanup(() => rm(filePath, { force: true }))

  const worktreeId = await worktreeIdFor(orcaPage, testRepoPath)
  const endpoint = await startPlanEndpoint(mockPlan(filePath, 1, JUMP_EDIT_COLUMN))
  try {
    await pointTheFeatureAt(orcaPage, endpoint.baseUrl)
    await openTypescriptFile(orcaPage, filePath, worktreeId)
    await waitForEditorFile(orcaPage, filePath)

    const editor = visibleEditor(orcaPage)
    const ghostText = editor.locator('.ghost-text-decoration')
    await editor.click()
    // The cursor stands on the second line; the plan puts the edit on the first one.
    await orcaPage.keyboard.press('ControlOrMeta+End')
    await orcaPage.keyboard.press('ArrowUp')
    // Why: the suggestion only draws where the cursor is, so its arrival is how the plan shows.
    await expect(ghostText).toBeVisible({ timeout: 30_000 })
    await expect(ghostText).toHaveText(MOCK_EDIT_TEXT)

    await orcaPage.keyboard.press('ControlOrMeta+End')
    await expect(ghostText).toBeHidden()

    await orcaPage.keyboard.press('Tab')
    await expect.poll(() => editorCursor(orcaPage)).toBe(`1:${JUMP_EDIT_COLUMN}`)
    // Why: a jump moves the cursor; it does not write the edit into the buffer.
    await expect.poll(() => editorValue(orcaPage)).toBe('const a = 1\nconst b = 2')
  } finally {
    await endpoint.close()
    await orcaPage.evaluate(() => window.api.codeCompletion.clearApiKey()).catch(() => undefined)
  }
})
