// The panel: three tabs, and the board the person opens first. It draws what the worker answered
// with and asks the worker to do things; it never builds a command line of its own.

import { Callout, Heading, Stack, Tab, Tabs, Text, plugin, read, set } from 'orca'
import type { PanelContext } from 'orca'
import { BoardTab } from './panel-board'
import { error, newBoardReads, stopWaiting, tab } from './panel-state'

/** The tab a press on the tab bar asks for. */
function changeTab(value: string): void {
  if (value === 'board' || value === 'map' || value === 'projects') {
    set(tab, value)
  }
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
      <Tabs label="看板视图" value={current} onChange={changeTab}>
        <Tab value="board" label="看板">
          <BoardTab />
        </Tab>
        <Tab value="map" label="全貌">
          <Text muted>这个标签页由后面的任务完成</Text>
        </Tab>
        <Tab value="projects" label="项目">
          <Text muted>这个标签页由后面的任务完成</Text>
        </Tab>
      </Tabs>
    </Stack>
  )
}
