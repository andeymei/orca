// The board panel. It draws what the worker returns and asks the worker to do things; it never
// builds a command line of its own.
import {
  atom,
  Badge,
  Button,
  Heading,
  plugin,
  read,
  Row,
  set,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { BoardPayload } from './model'

/** What the worker last answered. */
const board = atom<BoardPayload | null>(null)

/** Why the board could not be read, if it could not. */
const failure = atom<string | null>(null)

/** Reads the board again. */
async function load(): Promise<void> {
  try {
    set(board, await plugin.request('board.get'))
    set(failure, null)
  } catch (error) {
    set(failure, error instanceof Error ? error.message : String(error))
  }
}

export function setup(ctx: PanelContext): void {
  // The agent wrote a new snapshot: the board is read again.
  ctx.subscriptions.push(
    plugin.on('board.changed', () => {
      void load()
    })
  )
  void load()
}

export default function Panel() {
  const payload = read(board)
  const error = read(failure)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading level={2}>规格看板</Heading>
        <Button
          onPress={() => {
            void load()
          }}
        >
          重新读取
        </Button>
      </Row>
      {error !== null ? <Text tone="danger">{error}</Text> : null}
      {payload === null ? (
        <Text muted>读取中…</Text>
      ) : (
        <Stack gap="xs">
          {payload.items.length === 0 ? (
            <Text muted>还没有工作项。点「刷新」让 agent 扫一遍。</Text>
          ) : (
            payload.items.map((item) => (
              <Row key={item.id} justify="between">
                <Text>{item.title}</Text>
                <Badge tone="accent">{item.stage}</Badge>
              </Row>
            ))
          )}
          {payload.warnings.map((warning) => (
            <Text key={warning} tone="warning" size="xs">
              {warning}
            </Text>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
