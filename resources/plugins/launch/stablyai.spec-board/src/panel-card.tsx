// One card of the board: what the work is, how far the two frameworks have come, what the agent
// advises, and the buttons that run either framework's own commands.
//
// The card leads with one button — the one its stage waits for — and keeps the rest behind 更多,
// because a card can offer eight actions and a person can only tell which one is next.

import { Badge, Button, Card, Collapsible, Progress, Row, Stack, Text, read } from 'orca'
import type { Action, SnapshotProject, WorkItem } from './model'
import { otherActions, primaryAction } from './panel-primary-action'
import { feedback, pendingAction, pressAction } from './panel-state'

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
export function WorkCard({
  item,
  projects
}: {
  item: WorkItem
  projects: readonly SnapshotProject[]
}) {
  const waiting = read(pendingAction)
  const results = read(feedback)
  const project = projects.find((entry) => entry.id === item.projectId) ?? null
  // The badge says what the button does, not what the project owns: an OpenSpec action that runs
  // no command goes to an agent instead, and the person must see that before pressing it.
  const withoutCli = item.actions.some(
    (action) => action.framework === 'openspec' && action.run.kind === 'agent'
  )
  const primary = primaryAction(item)
  const others = otherActions(item)
  const done = results[item.id]
  return (
    <Card>
      <Stack gap="sm">
        <Text weight="semibold">{item.title}</Text>
        <Row gap="xs" align="center" wrap>
          <Badge tone="neutral">{projectLine(project, item)}</Badge>
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
        {item.nextAction === undefined ? null : (
          <Stack gap="none">
            <Text size="xs" weight="medium">
              {item.nextAction.label}
            </Text>
            <Text muted size="xs">
              {item.nextAction.detail}
            </Text>
          </Stack>
        )}
        <Row gap="xs" align="start" wrap>
          {primary === null ? null : (
            <Button
              key={primary.id}
              size="sm"
              variant="solid"
              onPress={() => {
                pressAction(item, primary)
              }}
            >
              {actionLabel(item, primary, waiting)}
            </Button>
          )}
          {others.length === 0 ? null : (
            <Collapsible title="更多">
              <Row gap="xs" wrap>
                {others.map((action) => (
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
            </Collapsible>
          )}
        </Row>
        {done === undefined ? null : (
          <Text size="xs" tone="success">
            {done}
          </Text>
        )}
      </Stack>
    </Card>
  )
}
