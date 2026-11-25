// The panel: three tabs, and the board the person opens first. It draws what the worker answered
// with and asks the worker to do things; it never builds a command line of its own.

import { Callout, Heading, Stack, Tab, Tabs, Text, plugin, read, set } from 'orca'
import type { PanelContext } from 'orca'
import { BoardTab } from './panel-board'
import { MapTab } from './panel-map'
import { ProjectsTab } from './panel-projects'
import { error, newBoardReads, payload, stopWaiting, tab } from './panel-state'

/** The tab a press on the tab bar asks for. */
function changeTab(value: string): void {
  if (value === 'board' || value === 'map' || value === 'projects') {
    set(tab, value)
  }
}

/**
 * What the worker could not read.
 *
 * A broken snapshot is not a problem of one tab, so the warning sits above the tabs: it is there
 * whichever tab is open. A board with no local scan of its own has nothing to show, so the same
 * warnings are the reason the board is empty rather than a note about it.
 */
function BoardWarnings() {
  const board = read(payload)
  const warnings = board?.warnings ?? []
  if (warnings.length === 0) {
    return null
  }
  const blind = board?.sources.localAt === null
  return (
    <Callout
      tone={blind ? 'danger' : 'warning'}
      icon="warning"
      title={blind ? '看板没有可用的数据' : '看板有警告'}
    >
      <Stack gap="none">
        {warnings.map((warning, index) => (
          <Text key={index} size="xs">
            {warning}
          </Text>
        ))}
      </Stack>
    </Callout>
  )
}

export function setup(ctx: PanelContext): () => void {
  // The reads of this panel run: they start here, so a read that hung while an earlier panel was
  // open cannot leave this one busy forever.
  const board = newBoardReads()
  // The agent wrote a new snapshot: the board is read again.
  ctx.subscriptions.push(
    plugin.on('board.changed', () => {
      void board.load()
    })
  )
  void board.load()
  return () => {
    board.close()
    stopWaiting()
  }
}

export default function Panel() {
  const current = read(tab)
  const failure = read(error)
  return (
    <Stack gap="md">
      <Heading level={2}>规格看板</Heading>
      {failure === null ? null : (
        <Callout tone="danger" title={failure.code}>
          <Text>{failure.message}</Text>
        </Callout>
      )}
      <BoardWarnings />
      <Tabs label="看板视图" value={current} onChange={changeTab}>
        <Tab value="board" label="看板">
          <BoardTab />
        </Tab>
        <Tab value="map" label="全貌">
          <MapTab />
        </Tab>
        <Tab value="projects" label="项目">
          <ProjectsTab />
        </Tab>
      </Tabs>
    </Stack>
  )
}
