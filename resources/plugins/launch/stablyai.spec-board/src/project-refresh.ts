// The refresh of one project.
//
// A project on this machine is read here: the worker scans it and puts what it found into the
// snapshot. A project on another host cannot be read here, so an agent collects it and writes what
// it found into a file of its own, which is merged into the snapshot when the file lands.
//
// The other projects are not this refresh's business: the snapshot holds every project, and a
// refresh of one project must not cost the board the ones nobody re-read.

import { writeFile } from 'node:fs/promises'
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
import { buildProjectRefreshPrompt } from './refresh-prompt'
import { progressInstructions } from './refresh-progress'
import { clearProgress, writeRefreshPrompt } from './refresh-files'
import { refreshWorkspace } from './refresh-workspace'
import { requestError } from './request-error'
import { applyProjectFacts, factsOf, supersedes } from './snapshot-merge'
import { SNAPSHOT_FORMAT } from './snapshot-format'
import {
  fileTime,
  progressPath,
  projectScanListPath,
  projectSnapshotPath,
  readJsonFile,
  snapshotPath,
  writeJsonFile
} from './store-paths'
import { messageOf } from './unknown-values'
import type { SnapshotProject } from './model'

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
  if (current.value !== null) {
    await writeJsonFile(
      snapshotPath(),
      applyProjectFacts(current.value, { project: scan.project, items: scan.items })
    )
  }
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
    await writeFile(
      list,
      `${JSON.stringify(
        {
          projects: [{ name: project.name, host: project.host, path: project.path }],
          snapshotFormat: SNAPSHOT_FORMAT,
          progress: progressInstructions(progressPath())
        },
        null,
        2
      )}\n`,
      'utf8'
    )
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
 * file lands first, and this puts it in. A file that is older than the snapshot is left alone — a
 * refresh of the whole board can land after a refresh of one project, and the older facts must not
 * overwrite the newer ones.
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
  const current = await readSnapshot([], state)
  const collectedAt = await fileTime(path)
  if (collectedAt === null || !supersedes(collectedAt, await snapshotAt())) {
    return
  }
  // With no snapshot to put it in, the file becomes the snapshot: this project was collected, and
  // the projects nobody collected are not in it.
  let merged = current.value ?? { ...parsed.value, projects: [], items: [] }
  for (const project of parsed.value.projects) {
    const facts = factsOf(parsed.value, project.id)
    if (facts !== null) {
      merged = applyProjectFacts(merged, facts)
    }
  }
  await writeJsonFile(snapshotPath(), merged)
  orca.panels.post('board.changed', { agentAt: await snapshotAt() })
}

/**
 * Whether a file in the store directory is a project's own snapshot.
 *
 * The names are told apart by their shape: the board's snapshot, the progress, and a file per
 * project. A file that is none of them is ignored.
 */
export function isProjectSnapshotFile(filename: string): boolean {
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
export function queueMerge(orca: OrcaWorkerApi, path: string, state: BoardState): void {
  merging = merging
    .then(() => mergeProjectSnapshot(orca, path, state))
    .catch((error: unknown) => {
      orca.log(`[spec-board] 无法合并项目快照 ${path}：${messageOf(error)}`)
    })
}
