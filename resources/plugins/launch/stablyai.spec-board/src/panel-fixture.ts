// The board the panel is drawn against, in the tests and in `orca plugin check`.
//
// Two projects: one with the OpenSpec CLI, one without it. The second one carries the card whose
// OpenSpec action runs no command, so the `无 CLI` badge has something true to say.

import type { BoardPayload } from './model'

/** When the last scan ran; the panel shows it as a relative time. */
const SCANNED_AT = '2026-11-25T10:00:00.000Z'

/** The board the panel draws. */
export const fixturePayload: BoardPayload = {
  items: [
    {
      id: 'local|/repo#add-x',
      projectId: 'local|/repo',
      title: 'Add X',
      topic: 'add-x',
      stage: 'implement',
      nextAction: { label: '写下设计', detail: '先写设计 spec，再改代码' },
      openspec: {
        changeId: 'add-x',
        stage: 'implementing',
        hasProposal: true,
        hasDesign: true,
        hasTasks: true,
        tasksDone: 2,
        tasksInProgress: 0,
        tasksTotal: 5,
        capabilities: []
      },
      superpowers: null,
      gaps: [
        {
          code: 'openspec-only',
          severity: 'warning',
          message: '有 OpenSpec 变更，没有对应的 Superpowers 设计'
        }
      ],
      actions: [
        {
          id: 'openspec.validate',
          label: '校验',
          framework: 'openspec',
          run: { kind: 'terminal', command: 'openspec validate add-x --strict' },
          mutates: false,
          scope: 'change'
        },
        {
          id: 'openspec.archive',
          label: '归档',
          framework: 'openspec',
          run: { kind: 'terminal', command: 'openspec archive add-x --yes' },
          mutates: true,
          scope: 'change'
        }
      ]
    },
    {
      id: 'local|/legacy#add-y',
      projectId: 'local|/legacy',
      title: 'Add Y',
      topic: 'add-y',
      stage: 'implement',
      openspec: {
        changeId: 'add-y',
        stage: 'implementing',
        hasProposal: true,
        hasDesign: false,
        hasTasks: true,
        tasksDone: 1,
        tasksInProgress: 0,
        tasksTotal: 4,
        capabilities: []
      },
      superpowers: null,
      gaps: [
        {
          code: 'no-design',
          severity: 'info',
          message: '有 tasks.md，但缺少 design.md'
        }
      ],
      actions: [
        {
          id: 'openspec.show',
          label: '看增量',
          framework: 'openspec',
          run: {
            kind: 'agent',
            prompt: '按 openspec/AGENTS.md 查看变更 add-y 的增量 spec'
          },
          mutates: false,
          scope: 'change'
        }
      ]
    },
    {
      id: 'local|/repo#add-z',
      projectId: 'local|/repo',
      title: 'Add Z',
      topic: 'add-z',
      stage: 'implement',
      openspec: null,
      superpowers: {
        designSpec: 'docs/superpowers/specs/add-z.md',
        plan: 'docs/superpowers/plans/add-z.md',
        stage: 'executing',
        planDone: 1,
        planInProgress: 0,
        planTotal: 8
      },
      gaps: [
        {
          code: 'superpowers-only',
          severity: 'warning',
          message: '有 Superpowers 设计或计划，没有对应的 OpenSpec 变更'
        }
      ],
      actions: [
        {
          id: 'superpowers.review',
          label: '代码评审',
          framework: 'superpowers',
          run: { kind: 'agent', prompt: '用 superpowers:requesting-code-review 审本次改动' },
          mutates: false,
          scope: 'project'
        },
        {
          id: 'superpowers.execute',
          label: '执行计划',
          framework: 'superpowers',
          run: { kind: 'agent', prompt: '用 superpowers:executing-plans 执行这个计划' },
          mutates: true,
          scope: 'project'
        }
      ]
    },
    {
      id: 'local|/repo#add-w',
      projectId: 'local|/repo',
      title: 'Add W',
      topic: 'add-w',
      stage: 'validate',
      openspec: {
        changeId: 'add-w',
        stage: 'validated',
        hasProposal: true,
        hasDesign: true,
        hasTasks: true,
        tasksDone: 3,
        tasksInProgress: 0,
        tasksTotal: 3,
        capabilities: ['auth']
      },
      superpowers: null,
      gaps: [],
      actions: []
    }
  ],
  projects: [
    {
      id: 'local|/repo',
      name: 'repo',
      host: 'local',
      path: '/repo',
      openspec: { present: true, capabilities: [], activeChanges: 3, archived: 0 },
      superpowers: { present: true, specs: 1, plans: 1 },
      openspecCli: { available: true },
      scannedAt: SCANNED_AT
    },
    {
      id: 'local|/legacy',
      name: 'legacy',
      host: 'local',
      path: '/legacy',
      openspec: { present: true, capabilities: [], activeChanges: 1, archived: 0 },
      superpowers: null,
      openspecCli: { available: false },
      scannedAt: SCANNED_AT
    }
  ],
  sources: { localAt: Date.parse(SCANNED_AT), agentAt: null },
  warnings: []
}
