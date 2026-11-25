// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { BoardPayload } from './model'

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** The board: the items, the projects, and what the worker could not read. */
    'board.get': { output: BoardPayload }
    /** Starts the agent that writes a new snapshot; answers with its terminal. */
    'board.refresh': { output: { terminalId: string } }
    /**
     * Runs one action. The panel names the action and, for a change-scoped command, the change
     * it picked — never a command line: the worker resolves that itself.
     *
     * On the agent channel the answer carries the agent that took the action: the worker launched
     * it, so the worker's answer is the truth about what ran.
     */
    'action.run': {
      input: {
        projectId: string
        actionId: string
        itemId?: string
        changeId?: string
      }
      output: { kind: 'terminal' | 'agent'; terminalId: string; agent?: string }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    /** Posted to every open panel when the snapshot on disk changed. */
    'board.changed': { agentAt: number | null }
  }
}
