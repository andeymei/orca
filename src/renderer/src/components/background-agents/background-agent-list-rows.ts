import type {
  ClaudeBackgroundAgent,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentState
} from '../../../../shared/claude-background-agents'

/** One agent of the list, with what it is doing right now. */
export type BackgroundAgentListRow = {
  id: string
  name: string
  cwd: string
  /** The section the row belongs to. */
  section: 'working' | 'needs-input' | 'completed'
  /** The CLI's own state word. */
  state: ClaudeBackgroundAgentState
  /** The gray line under the agent's name. */
  detail: string | null
  /** The agent's question, when it waits for a decision. */
  needs: string | null
  /** Epoch ms the agent started. */
  startedAt: number
  /** Epoch ms of the last state change; null when unknown. */
  updatedAt: number | null
}

/** The rows of the list, split into the sections the panel draws. */
export type BackgroundAgentListGroups = {
  working: BackgroundAgentListRow[]
  needsInput: BackgroundAgentListRow[]
  completed: BackgroundAgentListRow[]
}

/** The CLI groups its agents working | blocked | done; the list mirrors that order. */
const SECTION_ORDER: Record<BackgroundAgentListRow['section'], number> = {
  working: 0,
  'needs-input': 1,
  completed: 2
}

/**
 * The section an agent's own state word puts it in.
 *
 * The CLI decides when an agent is blocked, so the panel reads its word rather than guessing; a
 * live agent has not been seen in the `blocked` state on this machine yet.
 */
function sectionForState(
  state: ClaudeBackgroundAgentState | undefined
): BackgroundAgentListRow['section'] {
  if (state === 'blocked') {
    return 'needs-input'
  }
  if (state === 'working') {
    return 'working'
  }
  return 'completed'
}

/**
 * The rows of the list: what the CLI says lives, plus what each agent is doing.
 *
 * The CLI's listing owns the name and the state word, because it is the one that knows which
 * agents exist; the job state file only adds the line of activity under the name. The rows follow
 * the CLI's own grouping order, with the newest agent of a section first.
 */
export function buildBackgroundAgentListRows(
  agents: readonly ClaudeBackgroundAgent[],
  details: Readonly<Record<string, ClaudeBackgroundAgentDetail>>
): BackgroundAgentListRow[] {
  const rows: BackgroundAgentListRow[] = []
  for (const agent of agents) {
    if (agent.kind === 'interactive') {
      continue
    }
    const detail = details[agent.id]
    rows.push({
      id: agent.id,
      name: agent.name,
      cwd: agent.cwd,
      section: sectionForState(agent.state),
      // A listing from an older CLI carries no state word; it counts as finished.
      state: agent.state ?? 'done',
      detail: detail?.detail ?? null,
      needs: detail?.needs ?? null,
      startedAt: agent.startedAt ?? 0,
      updatedAt: detail?.updatedAt ?? null
    })
  }
  return rows.sort(
    (a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || b.startedAt - a.startedAt
  )
}

/** The rows of the list, one list per section, each keeping the order it came in. */
export function groupBackgroundAgentListRows(
  rows: readonly BackgroundAgentListRow[]
): BackgroundAgentListGroups {
  const groups: BackgroundAgentListGroups = { working: [], needsInput: [], completed: [] }
  for (const row of rows) {
    if (row.section === 'working') {
      groups.working.push(row)
    } else if (row.section === 'needs-input') {
      groups.needsInput.push(row)
    } else {
      groups.completed.push(row)
    }
  }
  return groups
}

/** How many agents each section holds; the header counts them. */
export function countBackgroundAgentListRows(rows: readonly BackgroundAgentListRow[]): {
  awaitingInput: number
  working: number
  completed: number
} {
  const groups = groupBackgroundAgentListRows(rows)
  return {
    awaitingInput: groups.needsInput.length,
    working: groups.working.length,
    completed: groups.completed.length
  }
}

/** How long an agent has been running, the way the CLI's list writes it. */
export function formatBackgroundAgentElapsed(elapsedMs: number): string {
  const ms = Math.max(0, elapsedMs)
  if (ms < 60_000) {
    return `${Math.floor(ms / 1000)}s`
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m`
  }
  if (ms < 86_400_000) {
    return `${Math.floor(ms / 3_600_000)}h`
  }
  return `${Math.floor(ms / 86_400_000)}d`
}
