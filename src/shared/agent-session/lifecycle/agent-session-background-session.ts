import type { AgentSessionWorkspaceKind } from './agent-session-record'

/** How a background session can be re-entered.
 *  running — this host still owns the provider child, so the agent works on.
 *  interrupted — the app went away while the agent was working; a durable offer can continue it.
 *  idle — the conversation is on disk and the agent is stopped; opening it starts it again.
 *  slept — the user's Sleep stopped this chat until the next message. */
export const AGENT_SESSION_BACKGROUND_STATES = ['running', 'interrupted', 'idle', 'slept'] as const
export type AgentSessionBackgroundState = (typeof AGENT_SESSION_BACKGROUND_STATES)[number]

/** One chat that is not on screen right now, and how it can be re-entered. */
export type AgentSessionBackgroundSession = {
  sessionId: string
  workspaceId: string
  workspaceKind: AgentSessionWorkspaceKind
  /** The agent that owns this conversation, as the record names it. */
  agent: string
  /** The conversation's name, else its newest prompt; empty when neither exists. */
  title: string
  /** Host-path directory the chat is held to, when it is pinned to one. */
  launchDirectory?: string
  updatedAt: number
  state: AgentSessionBackgroundState
}
