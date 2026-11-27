// Merges the agent's snapshot with the local scan.
//
// The snapshot carries facts only; every judgment — the unified stage, the gaps, the actions — is
// derived here, so the agent never decides what the board says.
//
// The rules, in one place:
// - a project the agent covered is the agent's — it is the fresher copy of the same project —
//   and a field the agent left unknown is filled in from the local scan; a project only the
//   local scan saw is the local scan's;
// - where a project *is* is not the agent's to say: its id is its host and its path, and a
//   project the registry and the local scan do not hold is not a project this board is about;
// - an item the agent covered is the agent's, whole: the local scan's facts are not merged into
//   it, so a task ticked since the last refresh is not shown — the agent's snapshot is the
//   authority for the project it covers;
// - the gaps of an item are the union of what both sides say, deduped by code: a disagreement
//   between the two sources is worth showing, not worth hiding behind one of them.

import { actionsForItem } from './actions'
import { detectGaps } from './gaps'
import { itemSources } from './item-sources'
import { projectIdFor } from './project-identity'
import { remoteOf } from './remote-host'
import { deriveStage } from './stage'
import type { BoardSnapshot, Gap, ProjectRef, SnapshotItem, SnapshotProject, WorkItem } from './model'

/** What the local scan found in one project. */
export type LocalScan = { project: SnapshotProject; items: SnapshotItem[] }

/** What the merge needs besides the facts. */
export type MergeInput = {
  snapshot: BoardSnapshot | null
  localScans: readonly LocalScan[]
  /**
   * The capability directories under each project's `openspec/specs/`; absent for a project the
   * worker cannot read — a remote one — because absent means unknown and an empty list would
   * claim the project has no capabilities at all.
   */
  specCapabilities: ReadonlyMap<string, readonly string[] | undefined>
  /**
   * The projects the board knows but nobody has read: the ones Orca lists and the registry names,
   * whose artifacts this worker cannot reach — a project on another host, above all. They are on
   * the board with no facts, so the panel can say they need collecting instead of leaving the
   * person to wonder where their project went.
   */
  knownProjects: readonly ProjectRef[]
}

/** The board, merged. */
export type MergedBoard = { projects: SnapshotProject[]; items: WorkItem[] }

/**
 * Whether a project says where it is.
 *
 * The id of a project is its host and its path — that is the plugin's own rule, and the one the
 * agent is told. So a project whose fields disagree with its id does not know where it is, and
 * nothing that reads the path may follow it.
 */
function placesItself(project: SnapshotProject): boolean {
  return projectIdFor(project.host, project.path) === project.id
}

/**
 * One project from both sides. A field the agent left null is unknown, not empty, so the local
 * scan fills it in; the agent's own values win. The agent's verdict on the project wins whole:
 * a project it read successfully has no error, even when the local scan could not read it.
 *
 * A project nobody read is still a project: it is on the board with no facts, and the panel says
 * it needs collecting.
 *
 * What the agent may not say is where the project is. Its own rule for an id is the host and the
 * path, so a project whose id is not the host and the path it claims is not about the project it
 * names — the board cannot say where it is, and neither does anything else that reads the path.
 * Its facts are still about the project its id names; only the placement is dropped.
 */
function mergeProject(
  agent: SnapshotProject | undefined,
  local: SnapshotProject | undefined,
  known: SnapshotProject | undefined
): SnapshotProject | null {
  const told = agent !== undefined && placesItself(agent) ? agent : undefined
  if (told && local) {
    const merged: SnapshotProject = {
      ...local,
      ...told,
      openspec: told.openspec ?? local.openspec,
      superpowers: told.superpowers ?? local.superpowers,
      openspecCli: told.openspecCli ?? local.openspecCli
    }
    if (told.error === undefined) {
      delete merged.error
    }
    return merged
  }
  return told ?? local ?? known ?? null
}

/** A project nobody has read: on the board, with nothing said about it yet. */
function unknownProject(ref: ProjectRef): SnapshotProject {
  const id = projectIdFor(ref.host, ref.path)
  return {
    id,
    name: ref.name,
    host: ref.host,
    path: ref.path,
    openspec: null,
    superpowers: null,
    openspecCli: null,
    scannedAt: ''
  }
}

/**
 * The gaps of both sides, one per code. The rule is the agent's gap wins: the local scan only
 * adds a code the agent did not report. The agent's snapshot is what the person asked for, and
 * its numbers are the ones the board shows — but when the local scan sees a code the agent did
 * not, that is worth saying, and when the two disagree about the same code, the agent's message
 * is the one that goes with the facts on the card.
 */
function unionGaps(lists: readonly (readonly Gap[])[]): Gap[] {
  const byCode = new Map<Gap['code'], Gap>()
  for (const list of lists) {
    for (const gap of list) {
      if (!byCode.has(gap.code)) {
        byCode.set(gap.code, gap)
      }
    }
  }
  return [...byCode.values()]
}

/** Whether the OpenSpec CLI is there for a project: only the agent or the local scan knows. */
function cliAvailable(project: SnapshotProject | undefined): boolean {
  return project?.openspecCli?.available === true
}

/** The gaps one item has, from the facts of one side. */
function gapsOf(
  item: SnapshotItem,
  specCapabilities: readonly string[] | undefined
): Gap[] {
  return detectGaps({
    openspec: item.openspec,
    superpowers: item.superpowers,
    ...(specCapabilities === undefined ? {} : { existingSpecCapabilities: specCapabilities })
  })
}

/**
 * The board, merged. The projects and the items come out sorted by their ids, so two runs over
 * the same files give the same board.
 */
export function mergeBoard(input: MergeInput): MergedBoard {
  const agentProjects = new Map<string, SnapshotProject>()
  for (const project of input.snapshot?.projects ?? []) {
    agentProjects.set(project.id, project)
  }
  const localProjects = new Map<string, SnapshotProject>()
  for (const scan of input.localScans) {
    localProjects.set(scan.project.id, scan.project)
  }
  const knownProjects = new Map<string, SnapshotProject>()
  for (const ref of input.knownProjects) {
    knownProjects.set(projectIdFor(ref.host, ref.path), unknownProject(ref))
  }
  const projectIds = [
    ...new Set([...agentProjects.keys(), ...localProjects.keys(), ...knownProjects.keys()])
  ].sort()
  const projects: SnapshotProject[] = []
  for (const id of projectIds) {
    const merged = mergeProject(
      agentProjects.get(id),
      localProjects.get(id),
      knownProjects.get(id)
    )
    if (merged) {
      projects.push(merged)
    }
  }

  const agentItems = new Map<string, SnapshotItem>()
  for (const item of input.snapshot?.items ?? []) {
    agentItems.set(item.id, item)
  }
  const localItems = new Map<string, SnapshotItem>()
  for (const scan of input.localScans) {
    for (const item of scan.items) {
      localItems.set(item.id, item)
    }
  }
  const itemIds = [...new Set([...agentItems.keys(), ...localItems.keys()])].sort()
  const items: WorkItem[] = []
  for (const id of itemIds) {
    const agent = agentItems.get(id)
    const local = localItems.get(id)
    // The agent's snapshot is the authority for the project it covers: its item wins whole, and
    // the local scan's facts are not merged into it.
    const facts = agent ?? local
    if (!facts) {
      continue
    }
    const specCapabilities = input.specCapabilities.get(facts.projectId)
    const gaps = unionGaps([
      agent ? gapsOf(agent, specCapabilities) : [],
      local ? gapsOf(local, specCapabilities) : []
    ])
    const project = projects.find((entry) => entry.id === facts.projectId)
    if (project === undefined) {
      // The project is not on the board, so its work is not either: the card would name a
      // project the board cannot place.
      continue
    }
    items.push({
      ...facts,
      stage: deriveStage(facts),
      gaps,
      // The files the work was written in. Whether they can be opened is not decided here: a
      // project Orca holds no workspace for has no editor tab to open them in, and that is the
      // board's business, not the merge's.
      sources: itemSources(facts),
      // A project on another host cannot run a command here: its actions are prompts the agent
      // carries over there.
      actions: actionsForItem(facts, cliAvailable(project), remoteOf(project))
    })
  }
  return { projects, items }
}
