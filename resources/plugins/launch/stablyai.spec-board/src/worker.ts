// The plugin's worker: it answers the board, refreshes the snapshot, and runs the actions the
// board offers.
//
// It is the only place in the plugin that runs anything. The panel names an action and the
// change it picked; the worker resolves that into a command or a prompt, and refuses anything it
// cannot resolve — so a project-derived value has exactly one path into a shell.

import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { resolveAction, type ActionFailure, type ActionRequest } from './action-resolution'
import { actionWorkspaceId } from './action-workspace'
import {
  buildBoard,
  displayText,
  findProject,
  newBoardState,
  type BoardState
} from './board-load'
import {
  boardProjects,
  focusedWorkspaceId,
  readSettings
} from './board-projects'
import { safeHostOf } from './host-identity'
import { mergePendingFragments, refreshProject } from './project-refresh'
import { requestError } from './request-error'
import { startWatcher, type StoreWatcher } from './store-watcher'
import { buildRefreshPrompt } from './refresh-prompt'
import { progressInstructions } from './refresh-progress'
import { readRefreshProgress } from './refresh-progress-file'
import { clearProgress, writeRefreshPrompt } from './refresh-files'
import { refreshWorkspace } from './refresh-workspace'
import { SNAPSHOT_FORMAT } from './snapshot-format'
import {
  boardStoreDir,
  progressPath,
  scanListPath,
  snapshotPath
} from './store-paths'
import { messageOf } from './unknown-values'
import { remoteOf } from './remote-host'
import type { ItemSourceKey, ProjectRef, SnapshotProject } from './model'

/** The warnings the worker recorded while running an action; the next board.get carries them. */
const recordedWarnings: string[] = []

/** How many recorded warnings the board keeps. */
const MAX_RECORDED_WARNINGS = 20

/** The watcher on the store directory, closed when the worker stops. */
let watcher: StoreWatcher | null = null

/**
 * What the worker keeps between its requests.
 *
 * It lives as long as the worker does, and the watcher needs it too: a project's own snapshot
 * lands long after the request that asked for it, and the merge reads the snapshot the board
 * reads — the last one that parsed.
 */
let boardState: BoardState = newBoardState()

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
 * Whether the file the path names is inside the project.
 *
 * The path the board derived cannot see a symlink: a link inside the project may point
 * anywhere, and opening it would open a file the project never held. So the project and the
 * file are resolved, and the resolved file has to be inside the resolved project.
 *
 * A project on another host is not here to be resolved — the file is opened there, and this
 * machine has no canonical path for it — so the path's own gate (no traversal, no absolute
 * path) is what holds for it, and the host opens the file on that machine.
 *
 * A project on this machine resolves or it does not. One that does not is a project that is not
 * there: nothing inside it can be opened, so the answer is no. It is never yes — a check that
 * cannot establish where a file is does not get to open it.
 */
async function staysInsideProject(project: SnapshotProject, relative: string): Promise<boolean> {
  if (remoteOf(project) !== null) {
    return true
  }
  const root = await realpath(project.path).catch(() => null)
  if (root === null) {
    return false
  }
  const target = await realpath(join(root, relative)).catch(() => null)
  if (target === null) {
    // The file is gone, or it points nowhere: there is nothing inside the project to open.
    return false
  }
  return target === root || target.startsWith(root + sep)
}

/**
 * Opens one file of a work item in an editor tab of Orca's window.
 *
 * The panel names the item and which of its files; the path is the worker's own. It derives the
 * item's files again and takes the one that was named, so a path the caller made up names
 * nothing — the same rule every other project-derived value follows.
 */
async function openSource(
  orca: OrcaWorkerApi,
  request: { itemId: string; sourceKey: ItemSourceKey },
  state: BoardState
): Promise<{ opened: true }> {
  const warnings: string[] = []
  const board = await buildBoard(orca, warnings, state)
  const item = board.payload.items.find((entry) => entry.id === request.itemId)
  if (item === undefined) {
    throw requestError('invalid_params', `找不到这个工作项：${request.itemId}`)
  }
  const source = item.sources.find((entry) => entry.key === request.sourceKey)
  if (source === undefined) {
    throw requestError('invalid_params', `这个工作项没有这个文件：${request.sourceKey}`)
  }
  const project = findProject(board, item.projectId)
  if (project === null) {
    throw requestError('invalid_params', `找不到这个项目：${item.projectId}`)
  }
  if (!(await staysInsideProject(project, source.path))) {
    throw requestError('invalid_params', `这个文件不在项目里：${source.path}`)
  }
  // The workspace that holds the project is the one the file lives in: the path is relative to it.
  const workspaceId = actionWorkspaceId(board, project)
  if (workspaceId === null) {
    throw requestError('invalid_params', `该项目不在 Orca workspace 里：${project.path}`)
  }
  // A tab in a workspace that is not the one on screen is a tab nobody sees, so the workspace comes
  // to the front first — unless it is already there. A workspace that will not come to the front
  // does not stop the file from opening: a tab in the background is better than no tab.
  const focused = await focusedWorkspaceId(orca, warnings)
  if (focused !== workspaceId) {
    try {
      await orca.host.call('workspace.open', { workspaceId })
    } catch (error) {
      orca.log(`[spec-board] 无法切到 workspace ${workspaceId}：${messageOf(error)}`)
    }
  }
  await orca.host.call('editor.open', { workspaceId, path: source.path })
  return { opened: true }
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
  const workspaceId = refreshWorkspace(settings, known.workspaces, focusedId)
  const prompt = buildRefreshPrompt({
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

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  // What the worker keeps between its requests; it lives as long as the worker does.
  boardState = newBoardState()
  orca.panels.handle('board.get', async () => {
    const warnings = [...recordedWarnings]
    // A refresh of one project writes a file of its own, and that file may land while the
    // watcher is not looking: the file system does not always say what changed. So the board
    // is merged on every read — the panel reads it again and again while a refresh runs, and
    // the facts arrive that way too.
    await mergePendingFragments(orca, boardState)
    return (await buildBoard(orca, warnings, boardState)).payload
  })
  orca.panels.handle('board.refresh', async () => refresh(orca))
  orca.panels.handle('board.refreshProject', async (input) =>
    refreshProject(orca, input.projectId, boardState)
  )
  orca.panels.handle('board.progress', async () => ({ progress: await readRefreshProgress() }))
  orca.panels.handle('action.run', async (input) => runAction(orca, input, boardState))
  orca.panels.handle('source.open', async (input) => openSource(orca, input, boardState))
  try {
    await mkdir(boardStoreDir(), { recursive: true })
  } catch (error) {
    // A directory that cannot be created is not a reason to refuse to start: the board still
    // reads the projects it can, and the snapshot may well live somewhere else.
    orca.log(`[spec-board] 无法创建 ${boardStoreDir()}：${messageOf(error)}`)
  }
  watcher = startWatcher(orca, boardState)
  // A fragment may have landed while no worker was watching: the board would otherwise keep the
  // facts it had before that refresh.
  void mergePendingFragments(orca, boardState)
}

export function deactivate(): void {
  watcher?.close()
  watcher = null
}
