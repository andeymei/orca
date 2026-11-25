import { assert, test } from 'orca/testing'
import {
  CORRESPONDENCE,
  OPENSPEC_DECISION_TREE,
  OPENSPEC_STAGES,
  SUPERPOWERS_FLOW
} from './framework-map'

test('the OpenSpec stages are the three real stages, with their real files', () => {
  assert.deepEqual(
    OPENSPEC_STAGES.map((stage) => stage.id),
    ['create', 'implement', 'archive']
  )
  assert.deepEqual(OPENSPEC_STAGES[0]!.artifacts, [
    'openspec/changes/<change-id>/proposal.md',
    'openspec/changes/<change-id>/design.md',
    'openspec/changes/<change-id>/tasks.md',
    'openspec/changes/<change-id>/specs/<capability>/spec.md'
  ])
  assert.deepEqual(OPENSPEC_STAGES[1]!.artifacts, [
    'openspec/changes/<change-id>/proposal.md',
    'openspec/changes/<change-id>/design.md',
    'openspec/changes/<change-id>/tasks.md',
    'openspec/changes/<change-id>/specs/<capability>/spec.md'
  ])
  assert.deepEqual(OPENSPEC_STAGES[2]!.artifacts, [
    'openspec/changes/archive/YYYY-MM-DD-<change-id>/',
    'openspec/specs/<capability>/spec.md'
  ])
  assert.deepEqual(
    OPENSPEC_STAGES.flatMap((stage) => stage.commands.map((command) => command.command)),
    [
      'openspec list',
      'openspec list --specs',
      'openspec validate <change-id> --strict',
      'openspec show <change-id>',
      'openspec validate <change-id> --strict',
      'openspec archive <change-id> --yes',
      'openspec validate --strict'
    ]
  )
})

test('the Superpowers flow is the fifteen real skills in process order', () => {
  assert.deepEqual(
    SUPERPOWERS_FLOW.map((step) => step.skill),
    [
      'using-superpowers',
      'brainstorming',
      'writing-plans',
      'using-git-worktrees',
      'executing-plans',
      'subagent-driven-development',
      'dispatching-parallel-agents',
      'test-driven-development',
      'systematic-debugging',
      'requesting-code-review',
      'receiving-code-review',
      'verification-before-completion',
      'finishing-a-development-branch',
      'diagnosing-superpowers',
      'writing-skills'
    ]
  )
  assert.deepEqual(
    SUPERPOWERS_FLOW.filter((step) => step.artifact !== null).map((step) => [
      step.skill,
      step.artifact
    ]),
    [
      ['brainstorming', 'docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md'],
      ['writing-plans', 'docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md']
    ]
  )
  assert.deepEqual(
    SUPERPOWERS_FLOW.filter((step) => step.gate !== null).map((step) => step.skill),
    ['brainstorming', 'writing-plans']
  )
})

test('the correspondence rows pair the two frameworks artifact by artifact', () => {
  assert.deepEqual(
    CORRESPONDENCE.map((row) => [row.openspec, row.superpowers]),
    [
      ['proposal.md', 'design spec 的 Context/Goals'],
      ['design.md', 'design spec 的 Decisions/Risks'],
      ['tasks.md', 'plan'],
      ['增量 spec', '验收标准']
    ]
  )
})

test('the decision tree says when to write a proposal and when to just fix', () => {
  assert.deepEqual(
    OPENSPEC_DECISION_TREE.map((rule) => [rule.situation, rule.action]),
    [
      ['修 bug：行为本就符合 spec', '直接改，不用写 proposal'],
      ['改错别字、格式、注释', '直接改，不用写 proposal'],
      ['新增功能或能力', '写 proposal'],
      ['破坏性变更（API、schema）', '写 proposal'],
      ['架构或模式变更', '写 proposal'],
      ['拿不准', '写 proposal（更安全）']
    ]
  )
})
