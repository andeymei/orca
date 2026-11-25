// The buttons a work item can press. The snapshot on disk carries facts only; the actions are
// derived here, in the two channels the design names: OpenSpec's own CLI runs in a terminal
// when the host that owns the project has it, and Superpowers' skills are always dispatched to
// an agent. Where the CLI is missing the OpenSpec actions fall back to a prompt that points the
// agent at the project's own `openspec/AGENTS.md`.
//
// Every project-derived value — a change id, a topic, an artifact path — clears the gate in
// `command-values.ts` before it can reach a command line or a prompt: they are read out of a
// repository the user may have cloned, so a directory name can carry a shell command. The
// palette's `<change-id>` is exempt by provenance, not by content: it is this module's own
// sentinel, and it never stands in for a value that came out of a repository.

import type { Action, ActionRun, OpenspecFacts, SuperpowersFacts } from './model'
import {
  CHANGE_ID_PLACEHOLDER,
  OPENSPEC_COMMANDS,
  SUPERPOWERS_SKILLS,
  type OpenspecCommand,
  type SuperpowersSkill
} from './action-catalog'
import { isSafeCommandPath, isSafeCommandValue } from './command-values'

/** The change a palette command names until the panel picks a concrete one. */
export { CHANGE_ID_PLACEHOLDER }

/** The guide the agent follows where the OpenSpec CLI is not installed. */
const OPENSPEC_GUIDE = 'openspec/AGENTS.md'

/** What the prompts talk about: the work itself, and the artifacts it already has. */
type Subject = {
  /** What the work is called: its own topic. */
  topic: string
  /** The design spec the plan is written from. */
  spec: string
  /** The plan that is being executed. */
  plan: string
}

/** Puts the change into a command, or into a task that asks for one. */
function withChangeId(text: string, changeId: string): string {
  return text.replaceAll(CHANGE_ID_PLACEHOLDER, changeId)
}

/**
 * Where the change in a command comes from. A change id read out of the repository is judged by
 * its content; the palette's placeholder is this module's own sentinel and carries no value at
 * all, so no repository value can be handed the placeholder's trust. The trust lives here, at
 * the call site, and not in the content of the value.
 */
type ChangeRef = { kind: 'repository'; changeId: string } | { kind: 'placeholder' }

/**
 * The change a command names, or null when the value may not be put in front of one: the
 * terminal needs the id and a prompt carrying it would be no better.
 */
function changeText(change: ChangeRef): string | null {
  if (change.kind === 'placeholder') {
    return CHANGE_ID_PLACEHOLDER
  }
  return isSafeCommandValue(change.changeId) ? change.changeId : null
}

/** The prompt the agent gets where the CLI is missing: the guide, and the task. */
function openspecPrompt(command: OpenspecCommand, changeId: string): string {
  return `按 ${OPENSPEC_GUIDE} ${withChangeId(command.task, changeId)}`
}

/**
 * One OpenSpec action, in the channel the host can actually run it — or null when the change
 * id may not be put in front of a command. An id that fails the gate leaves the item with no
 * OpenSpec action; the palette's placeholder is trusted by construction, because it is the
 * module's own sentinel and never a value read out of a repository.
 */
function openspecAction(
  command: OpenspecCommand,
  change: ChangeRef,
  cliAvailable: boolean
): Action | null {
  const changeId = changeText(change)
  if (changeId === null) {
    return null
  }
  const run: ActionRun =
    command.command !== null && cliAvailable
      ? { kind: 'terminal', command: withChangeId(command.command, changeId) }
      : { kind: 'agent', prompt: openspecPrompt(command, changeId) }
  return {
    id: command.id,
    label: command.label,
    framework: 'openspec',
    run,
    mutates: command.mutates,
    scope: command.scope
  }
}

/** The prompt one Superpowers skill is dispatched with. */
function superpowersPrompt(skill: SuperpowersSkill, subject: Subject): string {
  const task = skill.task
    .replaceAll('<topic>', subject.topic)
    .replaceAll('<spec>', subject.spec)
    .replaceAll('<plan>', subject.plan)
  return `用 ${skill.skill} ${task}`
}

/** One Superpowers action: always an agent, because Superpowers has no shell command. */
function superpowersAction(skill: SuperpowersSkill, subject: Subject): Action {
  return {
    id: skill.id,
    label: skill.label,
    framework: 'superpowers',
    run: { kind: 'agent', prompt: superpowersPrompt(skill, subject) },
    mutates: skill.mutates,
    // Superpowers has no command that acts on one change: a skill acts on the project.
    scope: 'project'
  }
}

/** The value a prompt may name, or the generic label when the value may not be trusted. */
function safeValue(value: string, fallback: string): string {
  return isSafeCommandValue(value) ? value : fallback
}

/** The artifact path a prompt may name, or the generic label when the path may not be trusted. */
function safePath(path: string | null, fallback: string): string {
  if (path === null) {
    return fallback
  }
  return isSafeCommandPath(path) ? path : fallback
}

/**
 * The actions one work item offers: the commands of the change it has, and the skills of the
 * work it has. An item without a change offers no OpenSpec action at all, and one without
 * Superpowers work offers no Superpowers action. A change id that may not reach a command
 * leaves the item with no OpenSpec action either — one bad directory must not blank the board,
 * so nothing here throws.
 */
export function actionsForItem(
  item: {
    topic: string
    openspec: OpenspecFacts | null
    superpowers: SuperpowersFacts | null
  },
  cliAvailable: boolean
): Action[] {
  const actions: Action[] = []
  if (item.openspec) {
    for (const command of OPENSPEC_COMMANDS) {
      if (command.scope !== 'change') {
        continue
      }
      // A change that is archived already is archived; the command would only fail.
      if (command.id === 'openspec.archive' && item.openspec.stage === 'archived') {
        continue
      }
      const action = openspecAction(
        command,
        { kind: 'repository', changeId: item.openspec.changeId },
        cliAvailable
      )
      if (action) {
        actions.push(action)
      }
    }
  }
  if (item.superpowers) {
    const subject: Subject = {
      topic: safeValue(item.topic, '这个工作项'),
      spec: safePath(item.superpowers.designSpec, '设计 spec'),
      plan: safePath(item.superpowers.plan, '实施计划')
    }
    for (const skill of SUPERPOWERS_SKILLS) {
      actions.push(superpowersAction(skill, subject))
    }
  }
  return actions
}

/**
 * The framework palette: every command both frameworks offer. The OpenSpec commands that act
 * on a change name the placeholder, because the palette is for a project and the panel picks
 * the change; the agent prompts name it the same way. The placeholder is the module's own
 * sentinel, so it is not a value that has to clear the gate.
 */
export function frameworkActions(cliAvailable: boolean): {
  openspec: Action[]
  superpowers: Action[]
} {
  const openspec: Action[] = []
  for (const command of OPENSPEC_COMMANDS) {
    const action = openspecAction(command, { kind: 'placeholder' }, cliAvailable)
    if (action) {
      openspec.push(action)
    }
  }
  const subject: Subject = {
    topic: '这个项目要做的改动',
    spec: '设计 spec',
    plan: '实施计划'
  }
  return {
    openspec,
    superpowers: SUPERPOWERS_SKILLS.map((skill) => superpowersAction(skill, subject))
  }
}

/**
 * Whether the action needs a change id. The scope is the catalog's own, carried on the action:
 * the decision is structural, not a guess read out of the run's text. The panel asks this before
 * it offers the action and the worker asks it before it runs it — one signal, so "pick a change
 * first" and "needs-change-id" cannot disagree.
 */
export function needsChangeId(action: Action): boolean {
  return action.scope === 'change'
}

/** Whether an action's run still names a change. */
function carriesPlaceholder(action: Action): boolean {
  return action.run.kind === 'terminal'
    ? action.run.command.includes(CHANGE_ID_PLACEHOLDER)
    : action.run.prompt.includes(CHANGE_ID_PLACEHOLDER)
}

/**
 * The palette action with a real change id in it. The panel names the action and the change;
 * the worker resolves it here, so a command line is never built in the renderer. A change id
 * that fails the gate is refused: the palette is for a repository the user may have cloned.
 */
export function resolvePaletteAction(
  action: Action,
  changeId: string | undefined
):
  | { ok: true; action: Action }
  | { ok: false; reason: 'needs-change-id' | 'unsafe-change-id' | 'placeholder-in-project-action' } {
  if (!needsChangeId(action)) {
    // A project-scoped action names no change, so it must not carry the placeholder: there is no
    // change to put in it, and the literal would reach the terminal.
    if (carriesPlaceholder(action)) {
      return { ok: false, reason: 'placeholder-in-project-action' }
    }
    return { ok: true, action }
  }
  if (changeId === undefined) {
    return { ok: false, reason: 'needs-change-id' }
  }
  if (!isSafeCommandValue(changeId)) {
    return { ok: false, reason: 'unsafe-change-id' }
  }
  const run: ActionRun =
    action.run.kind === 'terminal'
      ? {
          kind: 'terminal',
          command: action.run.command.replaceAll(CHANGE_ID_PLACEHOLDER, changeId)
        }
      : { kind: 'agent', prompt: action.run.prompt.replaceAll(CHANGE_ID_PLACEHOLDER, changeId) }
  return { ok: true, action: { ...action, run } }
}

/** The action with that id, or null when there is no such button. */
export function findAction(actions: readonly Action[], actionId: string): Action | null {
  return actions.find((action) => action.id === actionId) ?? null
}
