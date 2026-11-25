// The static picture of both frameworks: OpenSpec's three stages, Superpowers' fifteen skills
// in the order the process runs, and where the two frameworks' artifacts line up.
// Hand-written from openspec/AGENTS.md and the superpowers skills' own SKILL.md files, so the
// board can show it without scanning a project.

export type FrameworkStage = {
  id: 'create' | 'implement' | 'archive'
  title: string
  artifacts: string[]
  commands: { label: string; command: string }[]
}

export type SuperpowersStep = {
  skill: string
  role: string
  artifact: string | null
  gate: string | null
}

export type Correspondence = { openspec: string; superpowers: string; note: string }

/** OpenSpec's three stages: the files each stage works on, and the CLI that drives it. */
export const OPENSPEC_STAGES: readonly FrameworkStage[] = [
  {
    id: 'create',
    title: '创建变更',
    artifacts: [
      'openspec/changes/<change-id>/proposal.md',
      'openspec/changes/<change-id>/design.md',
      'openspec/changes/<change-id>/tasks.md',
      'openspec/changes/<change-id>/specs/<capability>/spec.md'
    ],
    commands: [
      { label: '列出进行中的变更', command: 'openspec list' },
      { label: '列出已有能力', command: 'openspec list --specs' },
      { label: '严格校验提案', command: 'openspec validate <change-id> --strict' }
    ]
  },
  {
    id: 'implement',
    title: '实现变更',
    artifacts: [
      'openspec/changes/<change-id>/tasks.md',
      'openspec/changes/<change-id>/specs/<capability>/spec.md'
    ],
    commands: [
      { label: '查看变更内容', command: 'openspec show <change-id>' },
      { label: '严格校验增量', command: 'openspec validate <change-id> --strict' }
    ]
  },
  {
    id: 'archive',
    title: '归档变更',
    artifacts: [
      'openspec/changes/archive/YYYY-MM-DD-<change-id>/',
      'openspec/specs/<capability>/spec.md'
    ],
    commands: [
      { label: '归档变更', command: 'openspec archive <change-id> --yes' },
      { label: '严格校验归档结果', command: 'openspec validate --strict' }
    ]
  }
]

/**
 * Superpowers' fifteen skills in the order the process runs: enter, design, plan, prepare,
 * execute, keep the discipline, review, verify, wrap up, then the two support skills.
 * A step's `gate` is the condition that has to hold before the next phase may start.
 */
export const SUPERPOWERS_FLOW: readonly SuperpowersStep[] = [
  {
    skill: 'using-superpowers',
    role: '会话入口：先确认该用哪些技能，再动手做',
    artifact: null,
    gate: null
  },
  {
    skill: 'brainstorming',
    role: '设计阶段：问清需求与取舍，写出设计 spec 并拿到批准',
    artifact: 'docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md',
    gate: 'spec 批准后才允许写实施计划'
  },
  {
    skill: 'writing-plans',
    role: '计划阶段：把批准的设计 spec 拆成带勾选框的实施计划',
    artifact: 'docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md',
    gate: '设计未批准不得写代码'
  },
  {
    skill: 'using-git-worktrees',
    role: '开工前：准备一个隔离的工作区再动手',
    artifact: null,
    gate: null
  },
  {
    skill: 'executing-plans',
    role: '执行方式一：当前会话里自己按计划一步步实现',
    artifact: null,
    gate: null
  },
  {
    skill: 'subagent-driven-development',
    role: '执行方式二：把计划里的独立任务分派给子 agent 实现',
    artifact: null,
    gate: null
  },
  {
    skill: 'dispatching-parallel-agents',
    role: '执行方式三：多个互不依赖的任务并行分派给 agent',
    artifact: null,
    gate: null
  },
  {
    skill: 'test-driven-development',
    role: '实现纪律：先写会失败的测试，再写让它通过的代码',
    artifact: null,
    gate: null
  },
  {
    skill: 'systematic-debugging',
    role: '出问题时：先定位根因，再谈怎么修',
    artifact: null,
    gate: null
  },
  {
    skill: 'requesting-code-review',
    role: '完成后：请求一次代码评审',
    artifact: null,
    gate: null
  },
  {
    skill: 'receiving-code-review',
    role: '收到评审意见：先核实再改，不盲从',
    artifact: null,
    gate: null
  },
  {
    skill: 'verification-before-completion',
    role: '声称完成前：跑验证命令、看真实输出再下结论',
    artifact: null,
    gate: null
  },
  {
    skill: 'finishing-a-development-branch',
    role: '收尾：测试全绿后决定怎么合并或清理分支',
    artifact: null,
    gate: null
  },
  {
    skill: 'diagnosing-superpowers',
    role: '支持：流程跑歪或某个技能没触发时，事后复盘原因',
    artifact: null,
    gate: null
  },
  {
    skill: 'writing-skills',
    role: '支持：把反复出现的做法沉淀成新技能或改现有技能',
    artifact: null,
    gate: null
  }
]

/** Where an OpenSpec artifact and a Superpowers artifact answer the same question. */
export const CORRESPONDENCE: readonly Correspondence[] = [
  {
    openspec: 'proposal.md',
    superpowers: 'design spec 的 Context/Goals',
    note: '两边都在回答“为什么要改、改成什么样”：proposal.md 的 Why / What Changes 对应 spec 的 Context / Goals。只有一边有，就是需求没对齐。'
  },
  {
    openspec: 'design.md',
    superpowers: 'design spec 的 Decisions/Risks',
    note: '技术决策与风险一一对位。但 OpenSpec 的 design.md 只在跨模块、引入新依赖或安全/性能/迁移复杂度大时才必写，Superpowers 的 spec 必写——缺一边就是脱节。'
  },
  {
    openspec: 'tasks.md',
    superpowers: 'plan',
    note: '两边都是可勾选的实施清单。tasks.md 勾了一半而 plan 没动，说明规格和计划各走各的。'
  },
  {
    openspec: '增量 spec',
    superpowers: '验收标准',
    note: '增量 spec 里每个 Scenario 就是一条验收标准，对应计划里的验证步骤（跑什么命令、什么输出算通过）。spec 有 Scenario 而计划没有对应验证，就等于没验收。'
  }
]
