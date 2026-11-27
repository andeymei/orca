// The shapes the board is built from. The snapshot on disk carries facts only; every judgment
// (the unified stage, the gaps, the actions) is the worker's own derivation from those facts.

/** Where a piece of work sits in the process both frameworks describe. */
export type UnifiedStage = 'proposal' | 'design' | 'plan' | 'implement' | 'validate' | 'archive'

/** A way the two frameworks' view of the same work disagree. */
export type GapCode =
  | 'openspec-only'
  | 'superpowers-only'
  | 'progress-drift'
  | 'no-design'
  | 'tasks-complete-not-archived'
  | 'archived-spec-stale'

export type Gap = { code: GapCode; severity: 'info' | 'warning' | 'error'; message: string }

/** What OpenSpec's own files say about one change. */
export type OpenspecFacts = {
  changeId: string
  stage: 'proposed' | 'implementing' | 'validated' | 'archived'
  hasProposal: boolean
  hasDesign: boolean
  hasTasks: boolean
  tasksDone: number
  tasksInProgress: number
  tasksTotal: number
  capabilities: string[]
}

/** What Superpowers' own files say about one piece of work. */
export type SuperpowersFacts = {
  designSpec: string | null
  plan: string | null
  stage: 'designed' | 'planned' | 'executing' | 'done'
  planDone: number
  planInProgress: number
  planTotal: number
}

/** One scanned project — the place a board item belongs to. */
export type SnapshotProject = {
  id: string
  name: string
  host: string
  path: string
  openspec: {
    present: boolean
    capabilities: string[]
    activeChanges: number
    archived: number
  } | null
  superpowers: { present: boolean; specs: number; plans: number } | null
  openspecCli: { available: boolean; version?: string; path?: string } | null
  scannedAt: string
  error?: string
  /**
   * Whether this project's actions can run here. The worker decides it — the board's workspaces
   * are the authority on where a project lives — and the panel draws the consequence: the
   * actions of a project that cannot run are off, and they say why.
   *
   * A local project runs when a workspace holds it. A remote project runs when this machine has
   * a workspace: its action is an agent that runs here and reaches the other machine over ssh.
   */
  canRun?: boolean
}

/** One piece of work as the agent found it: facts only, no judgment. */
export type SnapshotItem = {
  id: string
  projectId: string
  title: string
  topic: string
  openspec: OpenspecFacts | null
  superpowers: SuperpowersFacts | null
  summary?: string
  nextAction?: { label: string; detail: string }
}

/** A terminal command or an agent prompt — what a button on the board runs. */
export type ActionRun = { kind: 'terminal'; command: string } | { kind: 'agent'; prompt: string }

/**
 * What an action acts on: one change of the project, or the project itself. It is the catalog's
 * own scope, carried on the action so that nothing has to read it back out of the run's text.
 */
export type ActionScope = 'change' | 'project'

export type Action = {
  id: string
  label: string
  framework: 'openspec' | 'superpowers'
  run: ActionRun
  mutates: boolean
  /** Whether the action acts on one change, or on the project as a whole. */
  scope: ActionScope
}

/** Which file of a work item a press names. */
export type ItemSourceKey =
  | 'openspec-proposal'
  | 'openspec-design'
  | 'openspec-tasks'
  | 'superpowers-spec'
  | 'superpowers-plan'

/** One file of a work item: what it is called, and where it lives inside the project. */
export type ItemSource = {
  key: ItemSourceKey
  /** The name the card shows: the file's own name. */
  label: string
  /** The path inside the project, `/`-separated. */
  path: string
}

/** A snapshot item plus the worker's own derivations. */
export type WorkItem = SnapshotItem & {
  stage: UnifiedStage
  gaps: Gap[]
  actions: Action[]
  /**
   * The files this work item was written in, and may be opened from.
   *
   * They are the item's own files, so the board knows where each one is — but only the ones the
   * project can be opened from are here: a file of a project Orca holds no workspace for cannot
   * be opened in an editor tab, and a link that opens nothing is worse than no link.
   */
  sources: ItemSource[]
}

/** The file the agent writes. */
export type BoardSnapshot = {
  schemaVersion: 1
  generatedAt: string
  generatedBy: { agent: string; workspace?: string; host?: string }
  projects: SnapshotProject[]
  items: SnapshotItem[]
  notes?: string[]
}

/** The project the sidebar has selected. */
export type BoardFocus = {
  /** The board project's id. */
  projectId: string
  /** The focused workspace, as Orca names it. */
  workspaceId: string
  /** The host the workspace lives on: 'local', 'ssh:…' or 'runtime:…'. */
  host: string
  /** The workspace's own path, which is not the project's path. */
  path: string
}

/** What the worker hands the panel. */
export type BoardPayload = {
  items: WorkItem[]
  projects: SnapshotProject[]
  /**
   * The project the sidebar has selected, or null when nothing is selected.
   *
   * The board follows the sidebar: the panel shows the work of this project, and the projects
   * tab marks it as the current one.
   */
  focus: BoardFocus | null
  sources: { localAt: number | null; agentAt: number | null }
  warnings: string[]
}

export type ProjectRef = { name: string; host: string; path: string }
