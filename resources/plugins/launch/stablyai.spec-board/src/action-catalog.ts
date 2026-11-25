// What the two frameworks offer, as data: OpenSpec's own command set and Superpowers' skills.
// The commands are the ones the CLI has, and the tasks are what an agent is asked to do when
// the CLI is not installed. The derivation of the actions themselves lives in `actions.ts`.

/** One OpenSpec command: what it runs, and what an agent is asked to do instead. */
export type OpenspecCommand = {
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
export const OPENSPEC_COMMANDS: readonly OpenspecCommand[] = [
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
export type SuperpowersSkill = {
  id: string
  label: string
  mutates: boolean
  /** The skill the agent must invoke. */
  skill: string
  /** What it does with the skill; the placeholders name the artifacts it works on. */
  task: string
}

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
    label: '验证完成',
    mutates: false,
    skill: 'superpowers:verification-before-completion',
    task: '验证本次改动'
  }
]
