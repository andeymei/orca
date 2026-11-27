// Where the two frameworks keep their files, relative to a project root.
//
// The board both reads these files and offers them as links, so the scan that finds them and the
// derivation that names them must agree on one layout. Two copies of it would drift, and a link
// would quietly open a file that is not there.
//
// This module holds nothing but the layout: it imports no module, so anything may read it — the
// panel included, which runs in a frame where a `node:` import blanks the whole panel.

/** OpenSpec's folder in a project. */
export const OPENSPEC_DIR = 'openspec'

/** The folder holding the changes in flight. */
export const OPENSPEC_CHANGES_DIR = 'changes'

/** The folder holding the capabilities a project already has. */
export const OPENSPEC_SPECS_DIR = 'specs'

/** The folder inside `changes/` holding the changes that are done. */
export const OPENSPEC_ARCHIVE_DIR = 'archive'

/** The file that says what a change is about. */
export const OPENSPEC_PROPOSAL_FILE = 'proposal.md'

/** The file that says how a change is to be made. */
export const OPENSPEC_DESIGN_FILE = 'design.md'

/** The file that lists a change's steps. */
export const OPENSPEC_TASKS_FILE = 'tasks.md'

/** The Superpowers folders, and the kind of artifact each one holds. */
export const SUPERPOWERS_DIRS = [
  { kind: 'spec', path: 'docs/superpowers/specs' },
  { kind: 'plan', path: 'docs/superpowers/plans' }
] as const
