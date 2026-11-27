// The board tab: the stage rail, and a card for each piece of work in the stage the rail is on.
//
// The card is where the two frameworks' disagreement shows: two progress lanes, the gaps between
// them, and the buttons that run either framework's own commands.

import { Button, EmptyState, Row, Stack, Text, read, set } from 'orca'
import type { BoardFocus, SnapshotProject, UnifiedStage, WorkItem } from './model'
import { WorkCard } from './panel-card'
import {
  busy,
  payload,
  refreshBoard,
  refreshProject,
  refreshStartedAt,
  refreshing,
  stage
} from './panel-state'

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

/** The cards of the stage, or the empty state when it has none. */
function WorkList({
  items,
  projects,
  empty
}: {
  items: readonly WorkItem[]
  projects: readonly SnapshotProject[]
  /** What the empty state says: the stage is empty, or the project has no work at all. */
  empty: string
}) {
  if (items.length === 0) {
    return (
      <EmptyState title="这个阶段还没有工作项" description={empty} icon="layers" />
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

/**
 * The button that puts the board back in step with the files.
 *
 * The board does not watch the files: it shows what the last scan found, so a change that only
 * the files know about is invisible until somebody looks again. The button is here, where the work
 * is, because a refresh in another tab is a refresh nobody presses.
 *
 * One refresh runs at a time: two agents would fight over the progress file and over the list
 * the other one is reading, so the button is off while a refresh is in flight.
 */
function RefreshButton({ project }: { project: SnapshotProject | null }) {
  const busy = read(refreshing) || read(refreshStartedAt) !== null
  return (
    <Button
      size="sm"
      icon="refresh"
      disabled={busy}
      tooltip={project === null ? '重新采集整块看板' : `重新采集 ${project.name}`}
      onPress={() => {
        if (project === null) {
          void refreshBoard()
          return
        }
        void refreshProject(project.id, project.name)
      }}
    >
      {busy ? '刷新中…' : '刷新'}
    </Button>
  )
}

/**
 * The work of the project the sidebar has selected.
 *
 * The board follows the sidebar: the work of every project at once is nobody's work. A board with
 * no focused workspace shows everything, which is what it did before the sidebar could steer it.
 */
function focusedItems(
  items: readonly WorkItem[],
  focus: BoardFocus | null
): readonly WorkItem[] {
  if (focus === null) {
    return items
  }
  return items.filter((item) => item.projectId === focus.projectId)
}

/** The board tab: the stage rail, and the cards of the stage it is on. */
export function BoardTab() {
  const board = read(payload)
  const focus = board?.focus ?? null
  const items = focusedItems(board?.items ?? [], focus)
  const current = selectedStage(items)
  const shown = items.filter((item) => item.stage === current)
  const project = board?.projects.find((entry) => entry.id === focus?.projectId) ?? null
  // A project with no work at all is not an empty stage: it has not been collected yet.
  const empty =
    focus !== null && items.length === 0
      ? '这个项目还没有采集到工作项。到「项目」里点刷新，让 agent 采集它。'
      : '换一个阶段看看，或者让 agent 再扫一遍工作区。'
  return (
    <Stack gap="md">
      {project === null ? null : (
        <Text size="xs" muted>
          {`当前项目：${project.name} · ${project.host}`}
        </Text>
      )}
      <Row gap="sm" align="center" wrap>
        <StageRail items={items} current={current} />
        <RefreshButton project={project} />
      </Row>
      {board === null ? (
        <Text muted>{read(busy) ? '读取中…' : '还没有读到看板。'}</Text>
      ) : (
        <WorkList items={shown} projects={board.projects} empty={empty} />
      )}
    </Stack>
  )
}
