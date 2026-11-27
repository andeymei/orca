// What the two frameworks offer, as data: OpenSpec's own command set and Superpowers' skills.
// The commands are the ones the CLI has, and the tasks are what an agent is asked to do when
// the CLI is not installed. The derivation of the actions themselves lives in `actions.ts`.

import type { ActionScope } from './model'

/** The change a palette command names until the panel picks a concrete one. */
export const CHANGE_ID_PLACEHOLDER = '<change-id>'

/** One OpenSpec command: what it runs, and what an agent is asked to do instead. */
export type OpenspecCommand = {
  id: string
  label: string
  mutates: boolean
  /** 'change' for the commands that act on one change, 'project' for the rest. */
  scope: ActionScope
  /** The CLI command; null where the CLI has no form of this action. */
  command: string | null
  /** What the agent does; `<change-id>` marks the change it acts on. */
  task: string
}

/**
 * The catalog's own invariant: a command that acts on the whole project names no change, so it
 * never carries the placeholder — the palette resolves the change when the person presses, and a
 * project-scoped action has no change to resolve. A command that broke this would type the
 * literal `<change-id>` into a terminal.
 */
function assertProjectCommandNamesNoChange(command: OpenspecCommand): void {
  if (command.scope !== 'project') {
    return
  }
  const names = command.task.includes(CHANGE_ID_PLACEHOLDER)
  const runs = command.command !== null && command.command.includes(CHANGE_ID_PLACEHOLDER)
  if (names || runs) {
    throw new Error(`项目级命令不能带变更占位符：${command.id}`)
  }
}

/**
 * OpenSpec's command set, built through the rule: a command the rule refuses never becomes a
 * row, and a row it accepted is frozen, so the catalog cannot hold a command the rule never saw
 * — nor one that was edited into a change behind the rule's back.
 */
export function buildOpenspecCommands(
  commands: readonly OpenspecCommand[]
): readonly OpenspecCommand[] {
  for (const command of commands) {
    assertProjectCommandNamesNoChange(command)
  }
  return Object.freeze(commands.map((command) => Object.freeze(command)))
}

/** OpenSpec's own command set, in the order the design's table lists it. */
export const OPENSPEC_COMMANDS: readonly OpenspecCommand[] = buildOpenspecCommands([
  {
    id: 'openspec.list',
    label: '列出变更',
    mutates: false,
    scope: 'project',
    command: 'openspec list',
    task: '列出当前进行中的变更'
  },
  {
    id: 'openspec.propose',
    label: '新建提案',
    mutates: true,
    scope: 'project',
    command: null,
    task: 'Stage 1 生成 proposal、tasks 和增量 spec'
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
    id: 'openspec.complete',
    label: '补齐变更',
    mutates: true,
    scope: 'change',
    command: null,
    task: '为变更 <change-id> 补齐 design、tasks 和增量 spec'
  },
  {
    id: 'openspec.implement',
    label: '实现变更',
    mutates: true,
    scope: 'change',
    command: null,
    task: '实现变更 <change-id>，按它的 tasks.md 做'
  },
  {
    id: 'openspec.archive',
    label: '归档',
    mutates: true,
    scope: 'change',
    command: 'openspec archive <change-id> --yes',
    task: '归档变更 <change-id>'
  }
])

/** One Superpowers skill: the agent it dispatches and what that agent is asked to do. */
export type SuperpowersSkill = {
  id: string
  label: string
  mutates: boolean
  /** The skill the agent must invoke. */
  skill: string
  /** What it does with the skill; the placeholders name the artifacts it works on. */
  task: string
  /**
   * The rule the agent follows once the step is done; only a step that leaves a record has one.
   * A step with nowhere to write gets no rule.
   */
  recordRule?: string
}

/**
 * The round the agent writes down after it verifies.
 *
 * The record is the agent's own: the plugin writes no file, so the agent is what leaves the
 * evidence behind. The rule rides on this step, so the button and the rule cannot tell each
 * other something different.
 */
export const VERIFICATION_RECORD_RULE =
  '验证结束后，在 <plan> 的「## 验证记录」一节末尾追加一行：`- <YYYY-MM-DD> · 通过/未通过 · <跑了什么>`；没有这一节就新建一节。这一节不要写复选框（`- [x]`），看板把复选框当任务进度数。'

/** Superpowers' steps, in the order the design's table lists them. */
export const SUPERPOWERS_SKILLS: readonly SuperpowersSkill[] = [
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
    label: '验证',
    mutates: false,
    skill: 'superpowers:verification-before-completion',
    task: '验证本次改动',
    recordRule: VERIFICATION_RECORD_RULE
  }
]
