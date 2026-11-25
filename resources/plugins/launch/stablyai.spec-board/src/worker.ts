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
  request: ActionRequest
): Promise<{ kind: 'terminal' | 'agent'; terminalId: string }> {
  const warnings: string[] = []
  const board = await buildBoard(orca, warnings)
  const project = findProject(board, request.projectId)
  const workspaceId = findWorkspaceId(board.workspaces, {
    path: project.path,
    host: project.host
  })
  if (workspaceId === null) {
    throw new Error(`该项目不在 Orca workspace 里：${project.path}`)
  }
  const resolution = resolveAction({
    items: board.payload.items,
    request,
    cliAvailable: project.cliAvailable
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
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent: settings.refreshAgent === '' ? 'claude' : settings.refreshAgent,
    prompt: action.run.prompt
  })
  return { kind: 'agent', terminalId: launched.terminalId }
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
    throw new Error('没有可用的 workspace 来刷新')
  }
  const prompt = buildRefreshPrompt({ registryPath: registryPath(), snapshotPath: snapshotPath() })
  await mkdir(boardStoreDir(), { recursive: true })
  await writeFile(refreshPromptPath(), prompt, 'utf8')
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent: settings.refreshAgent === '' ? 'claude' : settings.refreshAgent,
    prompt
  })
  return { terminalId: launched.terminalId }
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
  orca.panels.handle('board.get', async () => {
    const warnings = [...recordedWarnings]
    return (await buildBoard(orca, warnings)).payload
  })
  orca.panels.handle('board.refresh', async () => refresh(orca))
  orca.panels.handle('action.run', async (input) => runAction(orca, input))
  await mkdir(boardStoreDir(), { recursive: true })
  watcher = startWatcher(orca)
}

export function deactivate(): void {
  watcher?.close()
  watcher = null
}
