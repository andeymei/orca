// The board tab: the stage rail, and a card for each piece of work in the stage the rail is on.
//
// The card is where the two frameworks' disagreement shows: two progress lanes, the gaps between
// them, and the buttons that run either framework's own commands.

import { Badge, Button, Card, EmptyState, Progress, Row, Stack, Text, read, set } from 'orca'
import type { Action, SnapshotProject, UnifiedStage, WorkItem } from './model'
import { busy, payload, pendingAction, pressAction, stage } from './panel-state'

/** The six stages the rail shows, in the order the work flows. */
const STAGES: readonly { id: UnifiedStage; label: string }[] = [
  { id: 'proposal', label: '提案' },
  { id: 'design', label: '设计' },
  { id: 'plan', label: '计划' },
  { id: 'implement', label: '实现' },
  { id: 'validate', label: '校验' },
  { id: 'archive', label: '归档' }
]

/** The stage the cards show: the one the rail is on, or the first stage that has work. */
function selectedStage(items: readonly WorkItem[]): UnifiedStage {
  const chosen = read(stage)
  if (chosen !== null) {
    return chosen
  }
  const first = STAGES.find((entry) => items.some((item) => item.stage === entry.id))
  return first?.id ?? 'proposal'
}

/** How far a checklist is, in the percent a Progress bar takes. */
function percent(done: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}

/** The tone a gap wears: how far apart the two frameworks are, in colour. */
function gapTone(severity: 'info' | 'warning' | 'error'): 'neutral' | 'warning' | 'danger' {
  if (severity === 'error') {
    return 'danger'
  }
  return severity === 'warning' ? 'warning' : 'neutral'
}

/** The line that says which project the work belongs to. */
function projectLine(project: SnapshotProject | null, item: WorkItem): string {
  return project === null ? item.projectId : `${project.name} · ${project.host}`
}

/** The label on an action's button: the action's own, or the question it asks first. */
function actionLabel(
  item: WorkItem,
  action: Action,
  waiting: { itemId: string; actionId: string } | null
): string {
  const asked = waiting !== null && waiting.itemId === item.id && waiting.actionId === action.id
  return asked ? '确认执行？' : action.label
}

/** A key that keeps one card's path from looking like a child of another's. */
function cardKey(id: string): string {
  return id.replaceAll('/', ':')
}

/** The rail: one button per stage, with the work in it. */
function StageRail({ items, current }: { items: readonly WorkItem[]; current: UnifiedStage }) {
  return (
    <Row gap="xs" wrap>
      {STAGES.map((entry) => (
        <Button
          key={entry.id}
          size="sm"
          variant={entry.id === current ? 'solid' : 'ghost'}
          onPress={() => {
            set(stage, entry.id)
          }}
        >
          {`${entry.label} ${items.filter((item) => item.stage === entry.id).length}`}
        </Button>
      ))}
    </Row>
  )
}

/** The OpenSpec lane: the tasks the change's own checklist holds. */
function OpenspecLane({ item }: { item: WorkItem }) {
  const facts = item.openspec
  if (facts === null) {
    return null
  }
  return (
    <Row gap="xs" align="center">
      <Text size="xs">{`OpenSpec ${facts.tasksDone}/${facts.tasksTotal}`}</Text>
      <Progress
        label="OpenSpec 任务进度"
        labelHidden
        value={percent(facts.tasksDone, facts.tasksTotal)}
      />
    </Row>
  )
}

/** The Superpowers lane: the boxes the plan holds. */
function SuperpowersLane({ item }: { item: WorkItem }) {
  const facts = item.superpowers
  if (facts === null) {
    return null
  }
  return (
    <Row gap="xs" align="center">
      <Text size="xs">{`Superpowers ${facts.planDone}/${facts.planTotal}`}</Text>
      <Progress
        label="Superpowers 计划进度"
        labelHidden
        value={percent(facts.planDone, facts.planTotal)}
      />
    </Row>
  )
}

/** One piece of work: what it is, how far the two frameworks have come, and what can be done. */
function WorkCard({
  item,
  projects
}: {
  item: WorkItem
  projects: readonly SnapshotProject[]
}) {
  const waiting = read(pendingAction)
  const project = projects.find((entry) => entry.id === item.projectId) ?? null
  // The badge says what the button does, not what the project owns: an OpenSpec action that runs
  // no command goes to an agent instead, and the person must see that before pressing it.
  const withoutCli = item.actions.some(
    (action) => action.framework === 'openspec' && action.run.kind === 'agent'
  )
  return (
    <Card>
      <Stack gap="sm">
        <Text weight="semibold">{item.title}</Text>
        <Row gap="xs" align="center" wrap>
          <Text muted size="xs">{projectLine(project, item)}</Text>
          {withoutCli ? <Badge tone="warning">无 CLI</Badge> : null}
        </Row>
        <Row gap="md" align="center" wrap>
          {item.openspec === null ? null : <OpenspecLane item={item} />}
          {item.superpowers === null ? null : <SuperpowersLane item={item} />}
        </Row>
        {item.gaps.length === 0 ? null : (
          <Row gap="xs" wrap>
            {item.gaps.map((gap) => (
              <Badge key={gap.code} tone={gapTone(gap.severity)}>
                {gap.message}
              </Badge>
            ))}
          </Row>
        )}
        {item.actions.length === 0 ? null : (
          <Row gap="xs" wrap>
            {item.actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="outline"
                onPress={() => {
                  pressAction(item, action)
                }}
              >
                {actionLabel(item, action, waiting)}
              </Button>
            ))}
          </Row>
        )}
      </Stack>
    </Card>
  )
}

/** The cards of the stage, or the empty state when it has none. */
function WorkList({
  items,
  projects
}: {
  items: readonly WorkItem[]
  projects: readonly SnapshotProject[]
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="这个阶段还没有工作项"
        description="换一个阶段看看，或者让 agent 再扫一遍工作区。"
        icon="layers"
      />
    )
  }
  return (
    <Stack gap="sm">
      {items.map((item) => (
        <WorkCard key={cardKey(item.id)} item={item} projects={projects} />
      ))}
    </Stack>
  )
}

/** The board tab: the stage rail, and the cards of the stage it is on. */
export function BoardTab() {
  const board = read(payload)
  const items = board?.items ?? []
  const current = selectedStage(items)
  const shown = items.filter((item) => item.stage === current)
  return (
    <Stack gap="md">
      {board?.warnings.map((warning, index) => (
        <Text key={index} tone="warning" size="xs">
          {warning}
        </Text>
      ))}
      <StageRail items={items} current={current} />
      {board === null ? (
        <Text muted>{read(busy) ? '读取中…' : '还没有读到看板。'}</Text>
      ) : (
        <WorkList items={shown} projects={board.projects} />
      )}
    </Stack>
  )
}
