import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import type {
  ClaudeBackgroundAgent,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentListResult
} from '../../../../../shared/claude-background-agents'

/** Which screen the supervisor shows: the roster, or one agent's detail. */
export type BackgroundAgentsScreen = { kind: 'list' } | { kind: 'agent'; agentId: string }

/** Keep the supervisor's screen and roster in session memory across panel unmounts; never persist to disk. */
export type BackgroundAgentsSlice = {
  backgroundAgentsScreen: BackgroundAgentsScreen
  backgroundAgentsStatus: 'loading' | 'ready' | 'unsupported' | 'error'
  backgroundAgentsMessage: string | null
  backgroundAgentsAgents: ClaudeBackgroundAgent[]
  backgroundAgentsDetails: Record<string, ClaudeBackgroundAgentDetail>
  backgroundAgentsAttachedPtyId: string | null
  openBackgroundAgent: (agentId: string) => void
  closeBackgroundAgent: () => void
  publishBackgroundAgentsListing: (result: ClaudeBackgroundAgentListResult) => void
  publishBackgroundAgentDetails: (details: Record<string, ClaudeBackgroundAgentDetail>) => void
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
  setBackgroundAgentsAttachedPty: (ptyId) => set({ backgroundAgentsAttachedPtyId: ptyId })
})
