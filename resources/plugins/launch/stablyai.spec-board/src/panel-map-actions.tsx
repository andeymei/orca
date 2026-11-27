// The palette of the 全貌 tab: the button a command of the map carries.
//
// The button names the action, the project and the change; the worker resolves them into a
// command. It never names a command line itself, and it never reads one: the action's own run is
// only asked which channel it takes, so a person can see before pressing it.

import { Button, Stack, Text, read } from 'orca'
import { needsChangeId } from './actions'
import type { Action, SnapshotProject } from './model'
import {
  dispatchKey,
  dispatched,
  feedback,
  pendingAction,
  pressAction,
  readNumber
} from './panel-state'
import { canRunActions, noRunMessage, runChannel } from './panel-workspace'

/** What a command of the palette needs to run: the project, the change, and the actions. */
export type Palette = {
  /** The project the commands run in; null when the board knows none. */
  project: SnapshotProject | null
  /** The change the change-scoped commands act on; null when none is picked. */
  change: string | null
  /** The catalog's actions, by id. */
  actions: ReadonlyMap<string, Action>
}

/** The label on a button that cannot run yet: the person is one pick short. */
const NEEDS_A_CHANGE = '先选一个变更'

/** What a button says when its action is already out. */
const SENT = '已发出'

/** What that button's tooltip says: why it is off, and what to do about it. */
const SENT_HINT = '已经发出去了，刷新看板看结果'

/**
 * Where the press is filed: what the action will act on, and which button it was. A change
 * picked after the confirmation was armed is a different action, so it has a different scope —
 * and the confirmation cannot carry over to a target it was not armed for.
 */
function scopeOf(projectId: string, change: string | null, row: string, action: Action): string {
  const target = needsChangeId(action) ? (change ?? '') : ''
  return `map:${projectId}:${target}:${row}:${action.id}`
}

/**
 * One command of the palette. The button names the action and the change; the worker resolves
 * them into a command. A mutating action waits for its second press, the same way a card's does.
 */
export function PaletteButton({
  action,
  palette,
  row
}: {
  action: Action
  palette: Palette
  /** What the row is: the stage or the skill the button belongs to. */
  row: string
}) {
  const waiting = read(pendingAction)
  const project = palette.project
  if (project === null) {
    return null
  }
  // The same signal the worker reads: an action that names a change cannot run without one.
  const namesChange = needsChangeId(action)
  const ready = !namesChange || palette.change !== null
  // A project no workspace holds has nowhere to run: the button is off, and it says so.
  const runnable = canRunActions(project)
  const scope = scopeOf(project.id, palette.change, row, action)
  const asked = waiting !== null && waiting.scope === scope && waiting.actionId === action.id
  const done = read(feedback)[scope]
  // The action this button has already sent, if it has sent one since the last read.
  const sent = read(dispatched)[dispatchKey(scope, action.id)]
  const out = sent !== undefined && sent.at === readNumber()
  return (
    <Stack gap="none">
      <Button
        size="sm"
        variant="outline"
        icon="play"
        disabled={!ready || !runnable || out}
        tooltip={out ? SENT_HINT : runnable ? runChannel(action) : noRunMessage(project)}
        onPress={() => {
          pressAction({
            scope,
            projectId: project.id,
            action,
            changeId: namesChange ? (palette.change ?? undefined) : undefined
          })
        }}
      >
        {out ? SENT : asked ? '确认执行？' : ready ? action.label : NEEDS_A_CHANGE}
      </Button>
      {done === undefined ? null : (
        <Text size="xs" tone="success">
          {done}
        </Text>
      )}
    </Stack>
  )
}
