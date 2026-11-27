// The refresh of one project.
//
// A project on this machine is read here: the worker scans it and puts what it found into the
// snapshot. A project on another host cannot be read here, so an agent collects it and writes what
// it found into a file of its own, which is merged into the snapshot when the file lands.
//
// The other projects are not this refresh's business: the snapshot holds every project, and a
// refresh of one project must not cost the board the ones nobody re-read.

import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  buildBoard,
  findProject,
  readSnapshot,
  snapshotAt,
  type Board,
  type BoardState
} from './board-load'
import { readSettings } from './board-projects'
import { parseBoardSnapshot } from './board-schema'
import { safeHostOf } from './host-identity'
import { scanProject } from './local-scan'
import { projectIdFor } from './project-identity'
import { buildProjectRefreshPrompt } from './refresh-prompt'
import { progressInstructions } from './refresh-progress'
import { clearProgress, writeRefreshPrompt } from './refresh-files'
import { refreshWorkspace } from './refresh-workspace'
import { requestError } from './request-error'
import { applyProjectFacts, factsOf, scannedAtOf, supersedes } from './snapshot-merge'
import { SNAPSHOT_FORMAT } from './snapshot-format'
import {
  boardStoreDir,
  fileTime,
  projectFileKey,
  progressPath,
  projectScanListPath,
  projectSnapshotPath,
  readJsonFile,
  snapshotPath,
  writeJsonFile
} from './store-paths'
import { messageOf } from './unknown-values'
import type { BoardSnapshot, SnapshotProject } from './model'

/** What the refresh did, and what the panel says about it. */
export type ProjectRefresh = { kind: 'local' | 'agent'; terminalId?: string; agent?: string }

/**
 * Refreshes one project.
 *
 * The project is named by the id the board knows it by. The worker looks that id up on the board
 * and refuses one that is not there: the caller's string is never read back as a path, because
 * that would let the request choose the directory the scan reads.
 */
export async function refreshProject(
  orca: OrcaWorkerApi,
  projectId: string,
  state: BoardState
): Promise<ProjectRefresh> {
  const warnings: string[] = []
  const board = await buildBoard(orca, warnings, state)
  const project = findProject(board, projectId)
  if (project === null) {
    throw requestError('invalid_params', `这个项目不在看板上：${projectId}`)
  }
  if (project.host === 'local') {
    await refreshLocalProject(orca, project, state)
    return { kind: 'local' }
  }
  return await refreshRemoteProject(orca, board, project)
}

/**
 * Reads a local project here, now.
 *
 * The snapshot holds the agent's copy of a project, which is as old as the last refresh. The scan
 * below is fresher, so it goes into the snapshot in that project's place — and only in that
 * project's place.
 */
async function refreshLocalProject(
  orca: OrcaWorkerApi,
  project: SnapshotProject,
  state: BoardState
): Promise<void> {
  const scan = await scanProject({
    name: project.name,
    host: project.host,
    path: project.path
  })
  const current = await readSnapshot([], state)
  // With no snapshot to put it in, the scan becomes the snapshot: this project was read, and the
  // projects nobody read are not in it.
  const base = current.value ?? { schemaVersion: 1, generatedAt: '', generatedBy: { agent: 'plugin' }, projects: [], items: [] }
  await writeJsonFile(
    snapshotPath(),
    applyProjectFacts(base, { project: scan.project, items: scan.items })
  )
  orca.panels.post('board.changed', { agentAt: await snapshotAt() })
}

/**
 * Collects a project on another host with an agent.
 *
 * The agent runs here and reaches the other machine over ssh, so it needs a workspace on this
 * machine — the same one the whole-board refresh uses. The list it reads holds this one project,
 * and the file it writes is this project's own: the plugin merges that file into the snapshot, so
 * the other projects are not the agent's to touch.
 */
async function refreshRemoteProject(
  orca: OrcaWorkerApi,
  board: Board,
  project: SnapshotProject
): Promise<{ kind: 'agent'; terminalId: string; agent: string }> {
  // The host ends up in an `ssh -- <名字>` the agent runs here, so a host that could be read as
  // an option must not reach it.
  if (safeHostOf(project.host) === null) {
    throw requestError('invalid_params', `这个项目的主机名不安全，刷新不了：${project.host}`)
  }
  const settings = await readSettings(orca)
  const workspaceId = refreshWorkspace(
    settings,
    board.workspaces,
    board.payload.focus?.workspaceId ?? null
  )
  const list = projectScanListPath(project.id)
  try {
    // The agent reads this list the moment it starts: a half-written list would be a list of
    // another project's.
    await writeJsonFile(list, {
      projects: [{ name: project.name, host: project.host, path: project.path }],
      snapshotFormat: SNAPSHOT_FORMAT,
      progress: progressInstructions(progressPath())
    })
  } catch (error) {
    // A raw errno reaches the panel as a code it does not recognise, and the person sees nothing
    // useful.
    throw requestError('unavailable', `无法写入 ${list}：${messageOf(error)}`)
  }
  const prompt = buildProjectRefreshPrompt({
    scanListPath: list,
    snapshotPath: projectSnapshotPath(project.id)
  })
  await writeRefreshPrompt(orca, prompt)
  await clearProgress(orca)
  const agent = settings.refreshAgent === '' ? 'claude' : settings.refreshAgent
  const launched = await orca.host.call('agent.launch', {
    workspaceId,
    agent,
    prompt
  })
  return { kind: 'agent', terminalId: launched.terminalId, agent }
}

/**
 * Puts what the agent collected for one project into the snapshot.
 *
 * The agent writes a file of its own, so the board's snapshot is never half written by it: the
 * file lands first, and this puts it in. Facts that are older than what the board already holds
 * are left alone — a refresh of the whole board can land after a refresh of one project, and the
 * older facts must not overwrite the newer ones.
 */
export async function mergeProjectSnapshot(
  orca: OrcaWorkerApi,
  path: string,
  state: BoardState
): Promise<void> {
  const raw = await readJsonFile(path)
  if (raw === null) {
    return
  }
  const parsed = parseBoardSnapshot(raw)
  if (!parsed.ok) {
    orca.log(`[spec-board] 项目快照无法读取：${path}（${parsed.error}）`)
    return
  }
  const project = projectOfFile(path, parsed.value)
  if (project === null) {
    orca.log(`[spec-board] 项目快照不是它自己的项目：${path}`)
    return
  }
  if (projectIdFor(project.host, project.path) !== project.id) {
    // The fragment says the project is somewhere its own id does not name. It is not the
    // project the file was written for, so none of it goes on the board.
    orca.log(`[spec-board] 项目快照说的位置不是它自己的项目：${path}`)
    return
  }
  const current = await readSnapshot([], state)
  const held = current.value?.projects.find((entry) => entry.id === project.id) ?? null
  // The facts' own times, not the times the files were written: the plugin writes the snapshot
  // itself whenever it merges something into it, so the file's time says when the file was
  // touched, not when the project was collected.
  const collectedAt = scannedAtOf(project) ?? (await fileTime(path))
  const boardAt = held === null ? null : (scannedAtOf(held) ?? (await snapshotAt()))
  if (!supersedes(collectedAt, boardAt)) {
    orca.log(`[spec-board] 项目快照比看板里的旧，没有并入：${path}`)
    return
  }
  // With no snapshot to put it in, the file becomes the snapshot: this project was collected, and
  // the projects nobody collected are not in it.
  const base = current.value ?? { ...parsed.value, projects: [], items: [] }
  const facts = factsOf(parsed.value, project.id)
  if (facts === null) {
    return
  }
  // The snapshot that holds this fragment is the one in the fragment's own directory: a path
  // derived again from the environment may name another directory by the time the merge runs.
  const target = snapshotPathOf(path)
  await writeJsonFile(target, applyProjectFacts(base, facts))
  orca.panels.post('board.changed', { agentAt: await fileTime(target) })
}

/**
 * The board's snapshot that a fragment belongs to.
 *
 * A fragment is written next to the board's snapshot, so the snapshot that holds it is the one in
 * its own directory. Deriving the path from the environment instead would name whatever directory
 * the plugin is pointed at now — which is not the directory the fragment came from.
 */
function snapshotPathOf(fragmentPath: string): string {
  return join(dirname(fragmentPath), 'board.json')
}

/**
 * The project a file holds, when it is the project the file is named after.
 *
 * The file's name is the project's own digest, so an agent that wrote about another project — or
 * about the same directory under another name — cannot put that project on the board.
 */
function projectOfFile(path: string, snapshot: BoardSnapshot): SnapshotProject | null {
  const key = projectFileKeyOf(path)
  for (const project of snapshot.projects) {
    if (projectFileKey(project.id) === key) {
      return project
    }
  }
  return null
}

/** The digest in a project's own file name, or null when the name is not one. */
function projectFileKeyOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const match = /^project-([0-9a-f]{16})\.json$/.exec(name)
  return match === null ? null : match[1]!
}

/**
 * Merges the fragments that are in a directory, and waits for the merges to finish.
 *
 * The file event does not always name the file that changed: a batch of changes is reported as
 * the directory's own change, and the name that comes with it is the directory's. So the
 * directory is looked at instead of the name, and every fragment in it is merged — a fragment
 * that is already in the snapshot is left alone by the merge itself.
 */
export async function mergeFragmentsIn(
  dir: string,
  orca: OrcaWorkerApi,
  state: BoardState
): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    // A directory that cannot be read holds no fragments.
    return
  }
  for (const name of names.filter((entry) => isProjectSnapshotFile(entry)).sort()) {
    queueMerge(orca, join(dir, name), state)
  }
  await merging
}

/**
 * Merges the fragments that are already on disk.
 *
 * The worker is reaped when it is idle, and an agent can take minutes: a fragment that landed
 * while nobody was watching would otherwise never reach the snapshot, and the board would keep
 * showing the facts it had before the refresh.
 */
export async function mergePendingFragments(orca: OrcaWorkerApi, state: BoardState): Promise<void> {
  await mergeFragmentsIn(boardStoreDir(), orca, state)
}

/**
 * Whether a file in the store directory is a project's own snapshot.
 *
 * The names are told apart by their shape: the board's snapshot, the progress, and a file per
 * project. A file that is none of them is ignored.
 */
function isProjectSnapshotFile(filename: string): boolean {
  return /^project-[0-9a-f]{16}\.json$/.test(filename)
}

/**
 * The merges, one after another.
 *
 * Two merges at once would each read the snapshot and write it back, and the second would write
 * over what the first put in. The queue makes them take turns.
 */
let merging: Promise<void> = Promise.resolve()

/** Puts a project's own snapshot into the board's snapshot, after the merges before it. */
function queueMerge(orca: OrcaWorkerApi, path: string, state: BoardState): void {
  merging = merging
    .then(() => mergeProjectSnapshot(orca, path, state))
    .catch((error: unknown) => {
      orca.log(`[spec-board] 无法合并项目快照 ${path}：${messageOf(error)}`)
    })
}
