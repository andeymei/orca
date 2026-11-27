// One card of the board: what the work is, how far the two frameworks have come, what the agent
// advises, and the buttons that run either framework's own commands.
//
// The card leads with one button — the one its stage waits for — and keeps the rest behind 更多,
// because a card can offer eight actions and a person can only tell which one is next.

import { Badge, Button, Card, Collapsible, Link, Progress, Row, Stack, Text, read } from 'orca'
import type { Action, SnapshotProject, WorkItem } from './model'
import { otherActions, primaryAction } from './panel-primary-action'
import {
  dispatchKey,
  dispatched,
  feedback,
  openSource,
  pendingAction,
  pressAction,
  readNumber
} from './panel-state'
import { canRunActions, noRunMessage, runChannel } from './panel-workspace'

/** What a button says when its action is already out. */
const SENT = '已发出'

/** What that button's tooltip says: why it is off, and what to do about it. */
const SENT_HINT = '已经发出去了，刷新看板看结果'

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

/** The verification badge: without a verdict there is none, because no evidence is no claim. */
function verificationBadge(item: WorkItem) {
  const verification = item.superpowers?.verification
  if (verification === null || verification === undefined) {
    return null
  }
  if (verification.lastPassed === true) {
    return <Badge tone="success">{`已验证 ×${verification.passed}`}</Badge>
  }
  if (verification.lastPassed === false) {
    return <Badge tone="warning">上次验证未通过</Badge>
  }
  return null
}

/** The label on an action's button: the action's own, or the question it asks first. */
function actionLabel(
  scope: string,
  action: Action,
  waiting: { scope: string; actionId: string } | null
): string {
  const asked = waiting !== null && waiting.scope === scope && waiting.actionId === action.id
  return asked ? '确认执行？' : action.label
}

/**
 * Whether an action is already out: it was sent, and the board has not been read since.
 *
 * The read is the only sign the panel has that the work moved on, so until it comes the button
 * stays off: a second press would start a second agent, not a second attempt at the first one.
 */
function isSent(scope: string, action: Action): boolean {
  const sent = read(dispatched)[dispatchKey(scope, action.id)]
  return sent !== undefined && sent.at === readNumber()
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
  // The badge says the project has no OpenSpec CLI — a fact, not a guess: a project nobody
  // answered for keeps an unknown CLI, and unknown is not "no CLI".
  const withoutCli = project?.openspecCli?.available === false
  const primary = primaryAction(item)
  const others = otherActions(item)
  // The files the work was written in. The first one is the item's main file — the title opens
  // it — and the rest are named under it, so every file of the work is one press away.
  const mainSource = item.sources[0] ?? null
  const otherSources = item.sources.slice(1)
  const done = results[item.id]
  // A project whose actions cannot run has nowhere to run them: the button is off, and it says so.
  const runnable = canRunActions(project)
  const hint = runnable ? undefined : noRunMessage(project)
  return (
    <Card>
      <Stack gap="sm">
        <Text weight="semibold">
          {mainSource === null ? (
            item.title
          ) : (
            <Link onPress={() => { void openSource(item.id, mainSource.key) }}>
              {item.title}
            </Link>
          )}
        </Text>
        {otherSources.length === 0 ? null : (
          <Row gap="xs" wrap>
            {otherSources.map((source) => (
              <Link
                key={source.key}
                onPress={() => { void openSource(item.id, source.key) }}
              >
                {source.label}
              </Link>
            ))}
          </Row>
        )}
        <Row gap="xs" align="center" wrap>
          <Badge tone="neutral">{projectLine(project, item)}</Badge>
          {withoutCli ? <Badge tone="warning">无 CLI</Badge> : null}
          {verificationBadge(item)}
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
              disabled={!runnable || isSent(item.id, primary)}
              tooltip={isSent(item.id, primary) ? SENT_HINT : hint ?? runChannel(primary)}
              onPress={() => {
                pressAction({
                  scope: item.id,
                  projectId: item.projectId,
                  action: primary,
                  itemId: item.id
                })
              }}
            >
              {isSent(item.id, primary) ? SENT : actionLabel(item.id, primary, waiting)}
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
                    disabled={!runnable || isSent(item.id, action)}
                    tooltip={isSent(item.id, action) ? SENT_HINT : hint ?? runChannel(action)}
                    onPress={() => {
                      pressAction({
                        scope: item.id,
                        projectId: item.projectId,
                        action,
                        itemId: item.id
                      })
                    }}
                  >
                    {isSent(item.id, action) ? SENT : actionLabel(item.id, action, waiting)}
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
