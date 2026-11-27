// The refresh in flight: a bar that moves, the project the agent is on, and how long it has been
// working.
//
// The card says what it knows and nothing more. The agent writes how far it has come after every
// project it scans; an agent that has not written yet leaves the bar without a number, rather
// than a number it never said.

import { Card, Progress, RelativeTime, Row, Spinner, Stack, Text, read } from 'orca'
import { progressPercent } from './refresh-progress'
import { refreshProgress, refreshStartedAt, refreshTarget, refreshTimedOut } from './panel-state'

/** What the card says when the refresh has waited longer than it may. */
const TIMED_OUT = '刷新没有完成：等了很久也没有新的快照。'

/** What the card says while the agent has not reported yet. */
const SCANNING = 'agent 正在采集'

/** The refresh in flight, or nothing when there is none. */
export function RefreshCard() {
  const startedAt = read(refreshStartedAt)
  const progress = read(refreshProgress)
  const timedOut = read(refreshTimedOut)
  const target = read(refreshTarget)
  if (startedAt === null) {
    return null
  }
  if (timedOut) {
    return (
      <Card>
        <Text size="sm">{TIMED_OUT}</Text>
      </Card>
    )
  }
  return (
    <Card>
      <Stack gap="xs">
        <Row gap="xs" align="center">
          <Spinner label="刷新中" labelHidden />
          <Text size="sm" weight="medium">
            {target === null ? '刷新中' : `正在刷新 ${target}`}
          </Text>
        </Row>
        <Progress
          label="刷新进度"
          labelHidden
          value={progress === null ? undefined : progressPercent(progress)}
        />
        <Text size="xs" muted>
          {progress === null
            ? SCANNING
            : `已采集 ${progress.done}/${progress.total} 个项目`}
        </Text>
        {progress !== null && progress.current !== '' ? (
          <Text size="xs" muted>{`正在采集 ${progress.current}`}</Text>
        ) : null}
        <Row gap="xs" align="center">
          <Text size="xs" muted>
            开始于
          </Text>
          <RelativeTime at={startedAt} muted />
        </Row>
      </Stack>
    </Card>
  )
}
