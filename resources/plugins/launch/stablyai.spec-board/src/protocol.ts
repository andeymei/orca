// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { BoardPayload } from './model'
import type { RefreshProgress } from './refresh-progress'

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** The board: the items, the projects, and what the worker could not read. */
    'board.get': { output: BoardPayload }
    /**
     * Starts the agent that writes a new snapshot; answers with its terminal and the agent it
     * launched. The worker is the source of that agent: the setting can change between the
     * panel's read and the launch, so only the worker knows what ran.
     */
    'board.refresh': { output: { terminalId: string; agent?: string } }
    /**
     * How far the refresh in flight has come. Null when the agent has not said yet — the agent
     * writes the progress after every project, and a panel that opens mid-refresh asks for it
     * here rather than wait for the next one.
     */
    'board.progress': { output: { progress: RefreshProgress | null } }
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
    /** Posted to every open panel when the agent reported how far its refresh has come. */
    'board.progress.changed': { progress: RefreshProgress | null }
  }
}
