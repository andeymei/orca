// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { BoardPayload, ItemSourceKey } from './model'
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
     * Refreshes one project.
     *
     * A project on this machine is read here: the worker scans it and puts what it found into the
     * snapshot. A project on another host cannot be read here, so an agent collects it and writes
     * what it found into a file of its own, which the worker merges into the snapshot.
     *
     * The project is named by the id the board knows it by. The worker looks that id up on the
     * board and refuses one that is not there: the caller's string is never read back as a path.
     */
    'board.refreshProject': {
      input: { projectId: string }
      output: { kind: 'local' | 'agent'; terminalId?: string; agent?: string }
    }
    /**
     * Opens one file of a work item in an editor tab of Orca's window.
     *
     * The panel names the item and which of its files — never a path: the worker derives the path
     * from the item's own facts, so a file that is not the item's cannot be opened.
     */
    'source.open': {
      input: { itemId: string; sourceKey: ItemSourceKey }
      output: { opened: true }
    }
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
