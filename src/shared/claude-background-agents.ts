const CLAUDE_BACKGROUND_AGENT_KINDS = ['background', 'interactive'] as const
const CLAUDE_BACKGROUND_AGENT_STATES = ['working', 'blocked', 'done', 'failed', 'stopped'] as const
const CLAUDE_BACKGROUND_AGENT_STATUSES = ['busy', 'idle', 'waiting'] as const

/** The short id the CLI hands out; it may be used as a path segment, so nothing else may. */
export const CLAUDE_BACKGROUND_AGENT_ID_PATTERN = /^[0-9a-f]{8}$/

/** 'background' for a daemon-backed agent; 'interactive' for a foreground terminal session. */
export type ClaudeBackgroundAgentKind = (typeof CLAUDE_BACKGROUND_AGENT_KINDS)[number]

/** The agent's own state word; an older host omits it. */
export type ClaudeBackgroundAgentState = (typeof CLAUDE_BACKGROUND_AGENT_STATES)[number]

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

/** What the agent's own job state file says; the CLI's listing does not carry it. */
export type ClaudeBackgroundAgentDetail = {
  /** The gray line under the agent's name. */
  detail: string | null
  /** The agent's own question, when it waits for a decision. */
  needs: string | null
  /** Epoch ms of the last state change. */
  updatedAt: number | null
}

/** What the panel gets over IPC. */
export type ClaudeBackgroundAgentListResult = {
  /** 'unsupported' means this machine has no Claude Code CLI to ask. */
  status: 'ready' | 'unsupported' | 'error'
  agents: ClaudeBackgroundAgent[]
  /** The job state files, keyed by agent id. */
  details: Record<string, ClaudeBackgroundAgentDetail>
  /** Why the listing failed, when status is 'error'. */
  message: string | null
}

/** What a dispatch, stop or remove reports back. */
export type ClaudeBackgroundAgentCommandResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

/** How many bytes of `claude agents --json` output are read; the envelope is a small array. */
export const CLAUDE_BACKGROUND_AGENTS_MAX_OUTPUT_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The word when the CLI used one the panel knows; undefined for anything else. */
function readKnownWord<T extends string>(value: unknown, words: readonly T[]): T | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return words.find((word) => word === value)
}

/**
 * The agents from `claude agents --json`.
 *
 * The CLI prints an array, but a broken or older build prints something else; an unreadable
 * listing must not take the picker down with it.
 */
export function parseClaudeBackgroundAgents(stdout: string): ClaudeBackgroundAgent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  return parseClaudeBackgroundAgentsValue(parsed)
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
