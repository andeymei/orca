// The plugin's worker: it answers the board, refreshes the snapshot, and runs the actions the
// board offers.
//
// It is the only place in the plugin that runs anything. The panel names an action and the
// change it picked; the worker resolves that into a command or a prompt, and refuses anything it
// cannot resolve — so a project-derived value has exactly one path into a shell.

import { watch, type FSWatcher } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { resolveAction, type ActionFailure, type ActionRequest } from './action-resolution'
import { actionWorkspaceId } from './action-workspace'
import {
  buildBoard,
  displayText,
  findProject,
  newBoardState,
  snapshotAt
} from './board-load'
import {
  boardProjects,
  readSettings,
  type Settings
} from './board-projects'
import { safeHostOf } from './host-identity'
import { buildRefreshPrompt } from './refresh-prompt'
import { progressInstructions } from './refresh-progress'
import { readRefreshProgress } from './refresh-progress-file'
import { SNAPSHOT_FORMAT } from './snapshot-format'
import {
  boardStoreDir,
  progressPath,
  refreshPromptPath,
  registryPath,
  scanListPath,
  snapshotPath
} from './store-paths'
import { isLocalWorkspace, type WorkspaceRow } from './workspace-match'
import { messageOf } from './unknown-values'
import { remoteOf } from './remote-host'
import type { ProjectRef } from './model'
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
  if (reason === 'placeholder-in-project-action') {
    return '这个动作作用于整个项目，不能带变更占位符'
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
  const settings = await readSettings(orca)
  // A project on another host: the action is a prompt the agent carries over there.
  const remote = remoteOf(project)
  // The project's own workspace, wherever it is: the agent runs where the files are.
  const workspaceId = actionWorkspaceId(board, project)
  if (workspaceId === null) {
    throw requestError(
      'invalid_params',
      `该项目不在 Orca workspace 里：${project.path}`
    )
  }
  const resolution = resolveAction({
    items: item === null ? board.payload.items : [item],
    request,
    cliAvailable: project.openspecCli?.available === true,
    remote
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
  const agent = settings.refreshAgent === '' ? 'claude' : settings.refreshAgent
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent,
    prompt: action.run.prompt
  })
  // The panel says who took the action; only the worker knows which agent it launched.
  return { kind: 'agent', terminalId: launched.terminalId, agent }
}

/**
 * The workspace the refresh runs in.
 *
 * It runs on this machine, always: the snapshot it writes has to be where this worker reads it
 * from, and a snapshot written on another host is a file nobody ever opens. The agent reaches the
 * other hosts over ssh, so a remote project is still collected — it is only the agent that runs
 * here.
 *
 * The workspace is the one the person named, else the focused one, else any local workspace.
 */
function refreshWorkspaceId(
  settings: Settings,
  workspaces: readonly WorkspaceRow[],
  focusedId: string | null
): string | null {
  if (settings.refreshWorkspace !== '') {
    return settings.refreshWorkspace
  }
  const focused = focusedId === null ? undefined : workspaces.find((row) => row.id === focusedId)
  if (focused !== undefined && (focused.hostId === null || focused.hostId === 'local')) {
    return focused.id
  }
  return workspaces.find((row) => row.hostId === null || row.hostId === 'local')?.id ?? null
}

/** Starts the agent that writes the snapshot. */
async function refresh(orca: OrcaWorkerApi): Promise<{ terminalId: string; agent: string }> {
  const settings = await readSettings(orca)
  const warnings: string[] = []
  const known = await boardProjects(orca, settings, warnings)
  let focusedId: string | null = null
  if (settings.refreshWorkspace === '') {
    // The setting names the workspace; there is nothing to ask the host about.
    try {
      const context = await orca.host.call('workspace.readContext')
      focusedId = context?.workspaceId ?? null
    } catch (error) {
      warnings.push(`无法读取当前 workspace：${messageOf(error)}`)
    }
  }
  const workspaceId = refreshWorkspaceId(settings, known.workspaces, focusedId)
  if (workspaceId === null) {
    throw requestError('invalid_params', '本机没有可用的 workspace 来刷新')
  }
  const named = known.workspaces.find((row) => row.id === workspaceId)
  if (named !== undefined && !isLocalWorkspace(named)) {
    throw requestError(
      'invalid_params',
      '刷新必须在本机运行：快照只有写在本机，看板才读得到它。请把「刷新在哪个 workspace 运行」指向本机的 workspace。'
    )
  }
  const prompt = buildRefreshPrompt({
    registryPath: registryPath(),
    scanListPath: scanListPath(),
    snapshotPath: snapshotPath()
  })
  await writeRefreshPrompt(orca, prompt)
  await writeScanList(orca, known.projects)
  await clearProgress(orca)
  const agent = settings.refreshAgent === '' ? 'claude' : settings.refreshAgent
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent,
    prompt
  })
  // The panel says who took the refresh; only the worker knows which agent it launched, and the
  // setting can change between the panel's read and this launch.
  return { terminalId: launched.terminalId, agent }
}

/**
 * Writes what the agent is to scan, and the shape of the snapshot it writes.
 *
 * Both are in a file, not in the prompt: the prompt has room for the task and the rules, and not
 * for the schema as well — `agent.launch` refuses a prompt over 4096 characters. Orca knows
 * projects the agent cannot see by itself, too: the ones on another host, above all.
 *
 * The progress file is named there too, for the same reason: the panel's bar needs the agent to
 * say how far it has come, and the prompt has no room for the shape of that file.
 *
 * A project whose host cannot be named safely is left out: the agent runs `ssh -- <target> …`
 * with that host, and a name a shell would read as an option is not a host.
 */
async function writeScanList(
  orca: OrcaWorkerApi,
  projects: readonly ProjectRef[]
): Promise<void> {
  const named = projects.filter((project) => {
    if (safeHostOf(project.host) !== null) {
      return true
    }
    orca.log(`[spec-board] 跳过了主机名不安全的项目：${project.host}（${project.path}）`)
    return false
  })
  try {
    await mkdir(boardStoreDir(), { recursive: true })
  } catch (error) {
    orca.log(`[spec-board] 无法创建 ${boardStoreDir()}：${messageOf(error)}`)
  }
  try {
    await writeFile(
      scanListPath(),
      `${JSON.stringify(
        {
          projects: named,
          snapshotFormat: SNAPSHOT_FORMAT,
          progress: progressInstructions(progressPath())
        },
        null,
        2
      )}\n`,
      'utf8'
    )
  } catch (error) {
    throw requestError(
      'unavailable',
      `无法写入 ${scanListPath()}：${messageOf(error)}`)
  }
}

/**
 * Takes the last refresh's progress away.
 *
 * The progress belongs to the refresh that is starting: a bar that counts the projects of the
 * last run would say the agent is halfway when it has not begun. A file that cannot be removed
 * is logged — the agent overwrites it with its first report anyway — and never refuses the
 * refresh, because the snapshot is what the board reads.
 */
async function clearProgress(orca: OrcaWorkerApi): Promise<void> {
  try {
    await rm(progressPath(), { force: true })
  } catch (error) {
    orca.log(`[spec-board] 无法清掉旧的进度文件：${messageOf(error)}`)
  }
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

/**
 * Watches the store directory, so a new snapshot reaches the open panels — and so the agent's
 * progress does too.
 *
 * The two files are told apart by their name: the snapshot is the board's, the progress is only
 * how far the agent has come. A file that is neither is ignored.
 */
function startWatcher(orca: OrcaWorkerApi): FSWatcher | null {
  const dir = boardStoreDir()
  try {
    const created = watch(dir, (_event, filename) => {
      if (filename === 'progress.json') {
        void readRefreshProgress().then((progress) =>
          orca.panels.post('board.progress.changed', { progress })
        )
        return
      }
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
  orca.panels.handle('board.progress', async () => ({ progress: await readRefreshProgress() }))
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
