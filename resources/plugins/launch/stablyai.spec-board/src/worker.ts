// The plugin's worker: it answers the board, refreshes the snapshot, and runs the actions the
// board offers.
//
// It is the only place in the plugin that runs anything. The panel names an action and the
// change it picked; the worker resolves that into a command or a prompt, and refuses anything it
// cannot resolve — so a project-derived value has exactly one path into a shell.

import { watch, type FSWatcher } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { resolveAction, type ActionFailure, type ActionRequest } from './action-resolution'
import {
  buildBoard,
  displayText,
  findProject,
  messageOf,
  newBoardState,
  readSettings,
  snapshotAt
} from './board-load'
import { buildRefreshPrompt } from './refresh-prompt'
import {
  boardStoreDir,
  refreshPromptPath,
  registryPath,
  snapshotPath
} from './store-paths'
import { findWorkspaceId } from './workspace-match'
import type { BoardState } from './board-load'

/** The warnings the worker recorded while running an action; the next board.get carries them. */
const recordedWarnings: string[] = []

/** How many recorded warnings the board keeps. */
const MAX_RECORDED_WARNINGS = 20

/** The watcher on the store directory, closed when the worker stops. */
let watcher: FSWatcher | null = null

/** Records a warning the board shows on its next read. */
function record(message: string): void {
  recordedWarnings.push(message)
  while (recordedWarnings.length > MAX_RECORDED_WARNINGS) {
    recordedWarnings.shift()
  }
}

/**
 * An error the panel can act on: the host reads the code off the error, and an error without a
 * known code reaches the panel as `action_failed`.
 */
function requestError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Why an action could not be run, in the words the person reads. */
function failureMessage(reason: ActionFailure, request: ActionRequest): string {
  if (reason === 'unknown-item') {
    return `找不到这个工作项：${request.itemId ?? ''}`
  }
  if (reason === 'unknown-action') {
    return `没有这个动作：${request.actionId}`
  }
  if (reason === 'needs-change-id') {
    return '请先选择一个变更'
  }
  return `变更 id 不安全：${displayText(request.changeId ?? '')}`
}

/** Runs the action the panel named. */
async function runAction(
  orca: OrcaWorkerApi,
  request: ActionRequest,
  state: BoardState
): Promise<{ kind: 'terminal' | 'agent'; terminalId: string; agent?: string }> {
  const warnings: string[] = []
  const board = await buildBoard(orca, warnings, state)
  // The board's projects are the authority on where a project lives. An id that is not on the
  // board names nothing: the caller's string is never read back as a path, because that would
  // let the request choose the directory the command runs in.
  const project = findProject(board, request.projectId)
  if (project === null) {
    throw new Error(`这个项目不在 Orca workspace 里：${request.projectId}`)
  }
  // An item has to belong to the project it runs in: the command is built from the item's own
  // change, and it has to run in that project's directory.
  const item =
    request.itemId === undefined
      ? null
      : (board.payload.items.find((entry) => entry.id === request.itemId) ?? null)
  if (request.itemId !== undefined && (item === null || item.projectId !== project.id)) {
    throw new Error(`这个工作项不属于这个项目：${request.itemId ?? ''}`)
  }
  const workspaceId = findWorkspaceId(board.workspaces, {
    path: project.path,
    host: project.host
  })
  if (workspaceId === null) {
    throw new Error(`该项目不在 Orca workspace 里：${project.path}`)
  }
  const resolution = resolveAction({
    items: item === null ? board.payload.items : [item],
    request,
    cliAvailable: project.openspecCli?.available === true
  })
  if (!resolution.ok) {
    if (resolution.reason === 'unsafe-change-id') {
      record(
        `请求的变更 id 不安全：${displayText(request.changeId ?? '')}—— 只能用字母、数字、点、短横和下划线，且以字母或数字开头`
      )
    }
    throw new Error(failureMessage(resolution.reason, request))
  }
  const action = resolution.action
  if (action.run.kind === 'terminal') {
    const created = await orca.host.call('terminal.create', {
      workspaceId,
      command: action.run.command,
      title: action.label
    })
    // The command runs in the background; focusing its pane is what makes it visible. Orca only
    // learned the method in 1.4.259, and an older one still opens the terminal.
    if (orca.host.has('terminal.focus')) {
      await orca.host.call('terminal.focus', { terminalId: created.terminalId })
    }
    return { kind: 'terminal', terminalId: created.terminalId }
  }
  const settings = await readSettings(orca)
  const agent = settings.refreshAgent === '' ? 'claude' : settings.refreshAgent
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent,
    prompt: action.run.prompt
  })
  // The panel says who took the action; only the worker knows which agent it launched.
  return { kind: 'agent', terminalId: launched.terminalId, agent }
}

/** Starts the agent that writes the snapshot. */
async function refresh(orca: OrcaWorkerApi): Promise<{ terminalId: string }> {
  const settings = await readSettings(orca)
  let workspaceId = settings.refreshWorkspace
  if (workspaceId === '') {
    const context = await orca.host.call('workspace.readContext')
    workspaceId = context?.workspaceId ?? ''
  }
  if (workspaceId === '') {
    throw requestError('invalid_params', '没有可用的 workspace 来刷新')
  }
  const prompt = buildRefreshPrompt({ registryPath: registryPath(), snapshotPath: snapshotPath() })
  await writeRefreshPrompt(orca, prompt)
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent: settings.refreshAgent === '' ? 'claude' : settings.refreshAgent,
    prompt
  })
  return { terminalId: launched.terminalId }
}

/**
 * Writes the prompt of this refresh, so a person can read what the agent was asked. A store
 * directory that cannot be made is logged and the write is tried anyway; a write that fails is a
 * refusal the panel can show, with the reason in it — a raw errno reaches the panel as a code it
 * does not recognise, and the person sees nothing useful.
 */
async function writeRefreshPrompt(orca: OrcaWorkerApi, prompt: string): Promise<void> {
  try {
    await mkdir(boardStoreDir(), { recursive: true })
  } catch (error) {
    orca.log(`[spec-board] 无法创建 ${boardStoreDir()}：${messageOf(error)}`)
  }
  try {
    await writeFile(refreshPromptPath(), prompt, 'utf8')
  } catch (error) {
    throw requestError(
      'unavailable',
      `无法写入 ${refreshPromptPath()}：${messageOf(error)}`
    )
  }
}

/** Watches the store directory, so a new snapshot reaches the open panels. */
function startWatcher(orca: OrcaWorkerApi): FSWatcher | null {
  const dir = boardStoreDir()
  try {
    const created = watch(dir, (_event, filename) => {
      if (filename !== null && filename !== 'board.json') {
        return
      }
      void snapshotAt().then((agentAt) => orca.panels.post('board.changed', { agentAt }))
    })
    // The watch must not keep the process alive: the worker's own lifetime decides that.
    created.unref()
    return created
  } catch (error) {
    orca.log(`[spec-board] 无法监听 ${dir}：${messageOf(error)}`)
    return null
  }
}

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  // What the worker keeps between its requests; it lives as long as the worker does.
  const state = newBoardState()
  orca.panels.handle('board.get', async () => {
    const warnings = [...recordedWarnings]
    return (await buildBoard(orca, warnings, state)).payload
  })
  orca.panels.handle('board.refresh', async () => refresh(orca))
  orca.panels.handle('action.run', async (input) => runAction(orca, input, state))
  try {
    await mkdir(boardStoreDir(), { recursive: true })
  } catch (error) {
    // A directory that cannot be created is not a reason to refuse to start: the board still
    // reads the projects it can, and the snapshot may well live somewhere else.
    orca.log(`[spec-board] 无法创建 ${boardStoreDir()}：${messageOf(error)}`)
  }
  watcher = startWatcher(orca)
}

export function deactivate(): void {
  watcher?.close()
  watcher = null
}
