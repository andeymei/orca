// The 项目 tab: what Orca knows about the projects, and the button that makes the board see
// anything at all.
//
// The button does not scan anything itself: it asks the worker to launch the agent that writes
// the snapshot. The board does not change when that agent finishes — the worker's watcher posts
// `board.changed`, and the panel reads the board again.

import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  RelativeTime,
  Row,
  Stack,
  Text,
  read
} from 'orca'
import type { SnapshotProject } from './model'
import {
  busy,
  payload,
  refreshBoard,
  refreshFeedback,
  refreshProject,
  refreshing
} from './panel-state'

/** What the card says about a project nobody scanned yet. */
const NEVER_SCANNED = '尚未扫描'

/** What the card says about a project whose scan time cannot be read. */
const UNKNOWN_TIME = '未知时间'

/** The shape a snapshot writes its scan time in: a date, a time, and an optional zone. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/

/** Whether a time names its own zone. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/

/** The milliseconds a snapshot's scan time names, or null when it names none that can be read. */
function scanTimeOf(scannedAt: string): number | null {
  if (!ISO_TIME.test(scannedAt)) {
    return null
  }
  // A time without a zone is read as UTC: the snapshot is written by an agent, on a machine
  // whose zone is not the reader's.
  const at = Date.parse(HAS_ZONE.test(scannedAt) ? scannedAt : `${scannedAt}Z`)
  return Number.isNaN(at) ? null : at
}

/** The scan time on the card: how long ago, or the words for a time that is not there. */
function ScannedAt({ scannedAt }: { scannedAt: string }) {
  if (scannedAt === '') {
    return <Text size="xs" muted>{NEVER_SCANNED}</Text>
  }
  const at = scanTimeOf(scannedAt)
  if (at === null) {
    return <Text size="xs" muted>{UNKNOWN_TIME}</Text>
  }
  return <RelativeTime at={at} muted />
}

/** The failure a project carries, or null: an empty string is no failure at all. */
function failureOf(project: SnapshotProject): string | null {
  const error = project.error
  return error === undefined || error === '' ? null : error
}

/**
 * Whether anybody checked this project.
 *
 * The local scan reads a local project — unless the scan failed, which the error badge says. A
 * project on another host was read by the agent alone, and a field it left empty is an absence
 * nobody checked.
 */
function scannedOf(project: SnapshotProject): boolean {
  return project.host === 'local' && failureOf(project) === null
}

/**
 * Whether this project still waits for the agent.
 *
 * A project with no facts at all was never read: the worker cannot read a project on another
 * host, and a local project the registry forgot is not read either. The badge says so, instead
 * of leaving the person to wonder where their project went.
 */
function needsCollection(project: SnapshotProject): boolean {
  return project.openspec === null && project.superpowers === null && failureOf(project) === null
}

/** The badge that says what a project has of a framework: it has it, it has not, or nobody knows. */
function frameworkBadge(
  label: string,
  facts: { present: boolean } | null,
  scanned: boolean
): string {
  if (facts === null) {
    return scanned ? `无 ${label}` : `未知 ${label}`
  }
  return facts.present ? label : `无 ${label}`
}

/** The badge that says whether the OpenSpec CLI is on that host. */
function cliBadge(cli: SnapshotProject['openspecCli']): { text: string; tone: 'neutral' | 'warning' } {
  if (cli === null) {
    // The worker cannot probe another host: it does not know, and it does not say it is missing.
    return { text: 'CLI 未知', tone: 'neutral' }
  }
  return cli.available ? { text: 'CLI 可用', tone: 'neutral' } : { text: '无 CLI', tone: 'warning' }
}

/** A key that keeps one project's path from looking like a child of another's. */
function projectKey(id: string): string {
  return id.replaceAll('/', ':')
}

/** One project: where it is, what it carries, and what went wrong with it. */
function ProjectCard({
  project,
  focused,
  refreshing
}: {
  project: SnapshotProject
  focused: boolean
  refreshing: boolean
}) {
  const cli = cliBadge(project.openspecCli)
  const failure = failureOf(project)
  const scanned = scannedOf(project)
  return (
    <Card>
      <Stack gap="sm">
        <Row gap="xs" align="center" wrap>
          <Badge tone="neutral">{`${project.name} · ${project.host}`}</Badge>
          {focused ? <Badge tone="success">当前</Badge> : null}
          {failure === null ? null : <Badge tone="danger">{failure}</Badge>}
          {needsCollection(project) ? <Badge tone="warning">需 agent 采集</Badge> : null}
        </Row>
        <Row gap="xs" wrap>
          <Badge tone="neutral">
            {frameworkBadge('OpenSpec', project.openspec, scanned)}
          </Badge>
          <Badge tone="neutral">
            {frameworkBadge('Superpowers', project.superpowers, scanned)}
          </Badge>
          <Badge tone={cli.tone}>{cli.text}</Badge>
        </Row>
        <Row gap="xs" align="center" justify="between">
          <Row gap="xs" align="center">
            <Text size="xs" muted>
              扫描时间
            </Text>
            <ScannedAt scannedAt={project.scannedAt} />
          </Row>
          <IconButton
            icon="refresh"
            label={`刷新 ${project.name}`}
            tooltip="只重新采集这个项目"
            size="sm"
            disabled={refreshing}
            onPress={() => {
              void refreshProject(project.id, project.name)
            }}
          />
        </Row>
      </Stack>
    </Card>
  )
}

/** The 项目 tab: the refresh button, and a card for every project the board knows. */
export function ProjectsTab() {
  const board = read(payload)
  const projects = board?.projects ?? []
  const focus = board?.focus ?? null
  const isRefreshing = read(refreshing)
  const said = read(refreshFeedback)
  return (
    <Stack gap="md">
      <Row gap="sm" align="center" wrap>
        <Button
          size="sm"
          icon="refresh"
          disabled={isRefreshing}
          onPress={() => {
            void refreshBoard()
          }}
        >
          {isRefreshing ? '刷新中…' : '刷新'}
        </Button>
        {said === null ? null : (
          <Text size="xs" tone="success">
            {said}
          </Text>
        )}
      </Row>
      {board !== null && board.sources.agentAt === null ? (
        <Text size="xs" muted>
          尚无 agent 快照（项目清单来自本地扫描）
        </Text>
      ) : null}
      {board === null ? (
        <Text muted>{read(busy) ? '读取中…' : '还没有读到看板。'}</Text>
      ) : projects.length === 0 ? (
        <EmptyState
          title="还没有项目"
          description="点刷新让 agent 采集工作区。"
          icon="folder"
        />
      ) : (
        <Stack gap="sm">
          {projects.map((project) => (
            <ProjectCard
              key={projectKey(project.id)}
              project={project}
              focused={focus !== null && project.id === focus.projectId}
              refreshing={isRefreshing}
            />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
