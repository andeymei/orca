// The buttons a work item can press. The snapshot on disk carries facts only; the actions are
// derived here, in the two channels the design names: OpenSpec's own CLI runs in a terminal
// when the host that owns the project has it, and Superpowers' skills are always dispatched to
// an agent. Where the CLI is missing the OpenSpec actions fall back to a prompt that points the
// agent at the project's own `openspec/AGENTS.md`.

import type { Action, ActionRun, OpenspecFacts, SuperpowersFacts } from './model'

/** The change a palette command names until the panel picks a concrete one. */
export const CHANGE_ID_PLACEHOLDER = '<change-id>'

/** The guide the agent follows where the OpenSpec CLI is not installed. */
const OPENSPEC_GUIDE = 'openspec/AGENTS.md'

/** One OpenSpec command: what it runs, and what an agent is asked to do instead. */
type OpenspecCommand = {
  id: string
  label: string
  mutates: boolean
  /** 'change' for the commands that act on one change, 'project' for the rest. */
  scope: 'change' | 'project'
  /** The CLI command; null where the CLI has no form of this action. */
  command: string | null
  /** What the agent does; `<change-id>` marks the change it acts on. */
  task: string
}

/** OpenSpec's own command set, in the order the design's table lists it. */
const OPENSPEC_COMMANDS: readonly OpenspecCommand[] = [
  {
    id: 'openspec.list',
    label: '列出变更',
    mutates: false,
    scope: 'project',
    command: 'openspec list',
    task: '列出当前进行中的变更'
  },
  {
    id: 'openspec.validate',
    label: '校验',
    mutates: false,
    scope: 'change',
    command: 'openspec validate <change-id> --strict',
    task: '严格校验变更 <change-id>'
  },
  {
    id: 'openspec.show',
    label: '看增量',
    mutates: false,
    scope: 'change',
    command: 'openspec show <change-id> --json --deltas-only',
    task: '查看变更 <change-id> 的增量 spec'
  },
  {
    id: 'openspec.archive',
    label: '归档',
    mutates: true,
    scope: 'change',
    command: 'openspec archive <change-id> --yes',
    task: '归档变更 <change-id>'
  },
  {
    id: 'openspec.propose',
    label: '新建提案',
    mutates: true,
    scope: 'project',
    command: null,
    task: 'Stage 1 生成 proposal、tasks 和增量 spec'
  }
]

/** One Superpowers skill: the agent it dispatches and what that agent is asked to do. */
type SuperpowersSkill = {
  id: string
  label: string
  mutates: boolean
  /** The skill the agent must invoke. */
  skill: string
  /** What it does with the skill; the placeholders name the artifacts it works on. */
  task: string
}

/** Superpowers' steps, in the order the design's table lists them. */
const SUPERPOWERS_SKILLS: readonly SuperpowersSkill[] = [
  {
    id: 'superpowers.brainstorm',
    label: '设计',
    mutates: true,
    skill: 'superpowers:brainstorming',
    task: '为 <topic> 产出设计 spec'
  },
  {
    id: 'superpowers.plan',
    label: '写实施计划',
    mutates: true,
    skill: 'superpowers:writing-plans',
    task: '基于 <spec> 写实施计划'
  },
  {
    id: 'superpowers.execute',
    label: '执行计划',
    mutates: true,
    skill: 'superpowers:executing-plans',
    task: '执行 <plan>'
  },
  {
    id: 'superpowers.review',
    label: '代码评审',
    mutates: false,
    skill: 'superpowers:requesting-code-review',
    task: '审本次改动'
  },
  {
    id: 'superpowers.verify',
    label: '验证完成',
    mutates: false,
    skill: 'superpowers:verification-before-completion',
    task: '验证本次改动'
  }
]

/** What the prompts talk about: the work itself, and the artifacts it already has. */
type Subject = {
  /** What the work is called: the change, where there is one. */
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

/** The prompt the agent gets where the CLI is missing: the guide, and the task. */
function openspecPrompt(command: OpenspecCommand, changeId: string): string {
  return `按 ${OPENSPEC_GUIDE} ${withChangeId(command.task, changeId)}`
}

/** One OpenSpec action, in the channel the host can actually run it. */
function openspecAction(
  command: OpenspecCommand,
  changeId: string,
  cliAvailable: boolean
): Action {
  const run: ActionRun =
    command.command !== null && cliAvailable
      ? { kind: 'terminal', command: withChangeId(command.command, changeId) }
      : { kind: 'agent', prompt: openspecPrompt(command, changeId) }
  return {
    id: command.id,
    label: command.label,
    framework: 'openspec',
    run,
    mutates: command.mutates
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
    mutates: skill.mutates
  }
}

/**
 * The actions one work item offers: the commands of the change it has, and the skills of the
 * work it has. An item without a change offers no OpenSpec action at all, and one without
 * Superpowers work offers no Superpowers action.
 */
export function actionsForItem(
  item: {
    openspec: OpenspecFacts | null
    superpowers: SuperpowersFacts | null
  },
  cliAvailable: boolean
): Action[] {
  const actions: Action[] = []
  if (item.openspec) {
    for (const command of OPENSPEC_COMMANDS) {
      if (command.scope === 'change') {
        actions.push(openspecAction(command, item.openspec.changeId, cliAvailable))
      }
    }
  }
  if (item.superpowers) {
    const subject: Subject = {
      topic: item.openspec?.changeId ?? '这个工作项',
      spec: item.superpowers.designSpec ?? '设计 spec',
      plan: item.superpowers.plan ?? '实施计划'
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
 * the change; the agent prompts name it the same way.
 */
export function frameworkActions(cliAvailable: boolean): {
  openspec: Action[]
  superpowers: Action[]
} {
  const subject: Subject = {
    topic: '这个项目要做的改动',
    spec: '设计 spec',
    plan: '实施计划'
  }
  return {
    openspec: OPENSPEC_COMMANDS.map((command) =>
      openspecAction(command, CHANGE_ID_PLACEHOLDER, cliAvailable)
    ),
    superpowers: SUPERPOWERS_SKILLS.map((skill) => superpowersAction(skill, subject))
  }
}

/** The action with that id, or null when there is no such button. */
export function findAction(actions: readonly Action[], actionId: string): Action | null {
  return actions.find((action) => action.id === actionId) ?? null
}
