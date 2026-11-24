const CLAUDE_BACKGROUND_AGENT_KINDS = ['background', 'interactive'] as const
const CLAUDE_BACKGROUND_AGENT_STATES = ['working', 'blocked', 'done', 'failed', 'stopped'] as const
const CLAUDE_BACKGROUND_AGENT_STATUSES = ['busy', 'idle', 'waiting'] as const

/** 'background' for a daemon-backed agent; 'interactive' for a foreground terminal session. */
export type ClaudeBackgroundAgentKind = (typeof CLAUDE_BACKGROUND_AGENT_KINDS)[number]

/** The agent's own state word; an older host omits it. */
export type ClaudeBackgroundAgentState = (typeof CLAUDE_BACKGROUND_AGENT_STATES)[number]

/**
 * The states that mean the agent is finished.
 *
 * These are the states only the `--all` listing adds, so a listing that carries them says more
 * than the active-only one did. An agent with no state at all is not on this list: a missing state
 * is not a finished state.
 */
export const CLAUDE_BACKGROUND_AGENT_FINISHED_STATES: readonly ClaudeBackgroundAgentState[] = [
  'done',
  'failed',
  'stopped'
]

/** 'busy' while the agent is turning; 'waiting' when it needs a decision. */
export type ClaudeBackgroundAgentStatus = (typeof CLAUDE_BACKGROUND_AGENT_STATUSES)[number]

/** A Claude Code background agent, as `claude agents --json` reports it. */
export type ClaudeBackgroundAgent = {
  /** The short id `claude attach` takes. */
  id: string
  /** The conversation id; the same value the AI Vault records for that conversation. */
  sessionId: string
  name: string
  cwd: string
  /** 'background' for a daemon-backed agent; 'interactive' for a foreground terminal session. */
  kind?: ClaudeBackgroundAgentKind
  /** Epoch ms the agent started. */
  startedAt?: number
  /** The agent's own state word; an older host omits it. */
  state?: ClaudeBackgroundAgentState
  /** 'busy' while the agent is turning; 'waiting' when it needs a decision. */
  status?: ClaudeBackgroundAgentStatus
}

/** How many bytes of `claude agents --json` output are read; the envelope is a small array. */
export const CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES = 256 * 1024

/** The CLI's stderr can be a quarter of a megabyte; the caller only needs the reason. */
const MAX_FAILURE_MESSAGE_LENGTH = 500

/**
 * What the CLI said about its refusal, trimmed to what a caller can read.
 *
 * An empty stderr means the CLI said nothing at all, and each caller words that differently.
 */
export function readClaudeBackgroundAgentFailureMessage(stderr: string, fallback: string): string {
  const trimmed = stderr.trim()
  if (!trimmed) {
    return fallback
  }
  return trimmed.length > MAX_FAILURE_MESSAGE_LENGTH
    ? `${trimmed.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`
    : trimmed
}

/** Whether a value is an object the parser can read fields from. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The word when the CLI used one it knows; undefined for anything else. */
function readKnownWord<T extends string>(value: unknown, words: readonly T[]): T | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return words.find((word) => word === value)
}

/**
 * The agents the CLI printed, or why its answer cannot be used.
 *
 * An older or broken `claude` build prints a table instead of a JSON array. That is not an empty
 * list, it is an answer nobody can read, and the caller has to hear which one it is.
 */
export type ClaudeBackgroundAgentsListing =
  | { ok: true; agents: ClaudeBackgroundAgent[] }
  | { ok: false; message: string }

/** The agents the CLI printed, or why its answer cannot be used. */
export function readClaudeBackgroundAgentsListing(stdout: string): ClaudeBackgroundAgentsListing {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { ok: false, message: 'the Claude Code CLI did not print JSON' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: 'the Claude Code CLI did not print an agent list' }
  }
  return { ok: true, agents: parseClaudeBackgroundAgentsValue(parsed) }
}

/**
 * The agents from `claude agents --json`.
 *
 * The CLI prints an array, but a broken or older build prints something else; an unreadable
 * listing must not take the picker down with it.
 */
export function parseClaudeBackgroundAgents(stdout: string): ClaudeBackgroundAgent[] {
  const listing = readClaudeBackgroundAgentsListing(stdout)
  return listing.ok ? listing.agents : []
}

/** The same listing, already parsed: a host answers with the value instead of the printed text. */
export function parseClaudeBackgroundAgentsValue(parsed: unknown): ClaudeBackgroundAgent[] {
  if (!Array.isArray(parsed)) {
    return []
  }
  const agents: ClaudeBackgroundAgent[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id : ''
    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : ''
    if (!id || !sessionId) {
      continue
    }
    agents.push({
      id,
      sessionId,
      name: typeof entry.name === 'string' ? entry.name : '',
      cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
      kind: readKnownWord(entry.kind, CLAUDE_BACKGROUND_AGENT_KINDS),
      startedAt: typeof entry.startedAt === 'number' ? entry.startedAt : undefined,
      state: readKnownWord(entry.state, CLAUDE_BACKGROUND_AGENT_STATES),
      status: readKnownWord(entry.status, CLAUDE_BACKGROUND_AGENT_STATUSES)
    })
  }
  return agents
}

/** Which host the listing is wanted from; a conversation runs on the host that recorded it. */
export type ClaudeBackgroundAgentRequest = {
  executionHostId?: string
}

/**
 * What the host that owns a conversation says about it.
 *
 * `unknown` is the host's own answer: it could not report its conversations — an Orca older
 * than the method that answers the listing. The host then decides for itself.
 */
export type ClaudeRunningAgentLookup =
  | { status: 'running'; agent: ClaudeBackgroundAgent }
  | { status: 'idle' }
  | { status: 'unknown' }
