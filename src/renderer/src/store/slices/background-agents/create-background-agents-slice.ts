import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import type {
  ClaudeBackgroundAgent,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentListResult
} from '../../../../../shared/claude-background-agents'

/** Which screen the supervisor shows: the roster, or one agent's detail. */
export type BackgroundAgentsScreen = { kind: 'list' } | { kind: 'agent'; agentId: string }

/** The dispatch that is on its way; the panel draws it as a placeholder row. */
export type BackgroundAgentsDispatch = {
  state: 'opening' | 'failed' | 'started'
  /** The short id the CLI gave, when the dispatch won the race against the cancel. */
  agentId: string | null
  /** Why the dispatch failed. */
  message: string | null
}

/** Keep the supervisor's screen and roster in session memory across panel unmounts; never persist to disk. */
export type BackgroundAgentsSlice = {
  backgroundAgentsScreen: BackgroundAgentsScreen
  backgroundAgentsStatus: 'loading' | 'ready' | 'unsupported' | 'error'
  backgroundAgentsMessage: string | null
  backgroundAgentsAgents: ClaudeBackgroundAgent[]
  backgroundAgentsDetails: Record<string, ClaudeBackgroundAgentDetail>
  backgroundAgentsAttachedPtyId: string | null
  backgroundAgentsDispatch: BackgroundAgentsDispatch | null
  openBackgroundAgent: (agentId: string) => void
  closeBackgroundAgent: () => void
  publishBackgroundAgentsListing: (result: ClaudeBackgroundAgentListResult) => void
  publishBackgroundAgentDetails: (details: Record<string, ClaudeBackgroundAgentDetail>) => void
  publishBackgroundAgentsDispatch: (dispatch: BackgroundAgentsDispatch | null) => void
  setBackgroundAgentsAttachedPty: (ptyId: string | null) => void
}

export const createBackgroundAgentsSlice: StateCreator<AppState, [], [], BackgroundAgentsSlice> = (
  set
) => ({
  backgroundAgentsScreen: { kind: 'list' },
  backgroundAgentsStatus: 'loading',
  backgroundAgentsMessage: null,
  backgroundAgentsAgents: [],
  backgroundAgentsDetails: {},
  backgroundAgentsAttachedPtyId: null,
  backgroundAgentsDispatch: null,
  openBackgroundAgent: (agentId) => set({ backgroundAgentsScreen: { kind: 'agent', agentId } }),
  closeBackgroundAgent: () => set({ backgroundAgentsScreen: { kind: 'list' } }),
  publishBackgroundAgentsListing: (result) =>
    set({
      backgroundAgentsStatus: result.status,
      backgroundAgentsMessage: result.message,
      // A failed refresh keeps the rows and their activity lines; only a host with no CLI at all empties them.
      ...(result.status === 'unsupported'
        ? { backgroundAgentsAgents: [], backgroundAgentsDetails: {} }
        : result.status === 'ready'
          ? {
              // Why copies: the caller may reuse the array and the object it handed over.
              backgroundAgentsAgents: [...result.agents],
              backgroundAgentsDetails: { ...result.details }
            }
          : {})
    }),
  publishBackgroundAgentDetails: (details) =>
    set((state) => ({ backgroundAgentsDetails: { ...state.backgroundAgentsDetails, ...details } })),
  publishBackgroundAgentsDispatch: (dispatch) => set({ backgroundAgentsDispatch: dispatch }),
  setBackgroundAgentsAttachedPty: (ptyId) => set({ backgroundAgentsAttachedPtyId: ptyId })
})
