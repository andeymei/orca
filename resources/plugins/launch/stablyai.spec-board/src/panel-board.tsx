// The board tab: the stage rail, and a card for each piece of work in the stage the rail is on.
//
// The card is where the two frameworks' disagreement shows: two progress lanes, the gaps between
// them, and the buttons that run either framework's own commands.

import { Button, EmptyState, Row, Stack, Text, read, set } from 'orca'
import type { SnapshotProject, UnifiedStage, WorkItem } from './model'
import { WorkCard } from './panel-card'
import { busy, payload, stage } from './panel-state'

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
      <StageRail items={items} current={current} />
      {board === null ? (
        <Text muted>{read(busy) ? '读取中…' : '还没有读到看板。'}</Text>
      ) : (
        <WorkList items={shown} projects={board.projects} />
      )}
    </Stack>
  )
}
