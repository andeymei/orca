import { translateMain } from '../i18n/main-i18n'
import { REFACTOR_SOURCE_DIRECTORY_NAME } from './refactor-scratch'

/**
 * The warnings the plan builder produces.
 *
 * Why they live apart from the builder: the builder reads files and drops proposals, and the
 * copy it reports is the feature's own vocabulary -- one warning per thing the user could not
 * act on, and one summary line per count that could happen hundreds of times.
 */

/** The scratch tree holds a copy of the user's file, which is not a proposal. */
export function planSourceIgnoredWarning(): string {
  return translateMain(
    'refactor.plan.sourceIgnored',
    'Proposal {{id}} is the baseline copy and was ignored',
    { id: REFACTOR_SOURCE_DIRECTORY_NAME }
  )
}

/** The proposal id would name a directory outside the scratch tree. */
export function planUnsafeIdWarning(id: string): string {
  return translateMain(
    'refactor.plan.unsafeId',
    'Proposal {{id}} has an id that is not a safe relative path; it was dropped',
    { id }
  )
}

/** Two proposals claim one id, so the review tab cannot tell them apart. */
export function planDuplicateIdWarning(id: string): string {
  return translateMain(
    'refactor.plan.duplicateId',
    'Proposal {{id}} repeats an id; it was dropped',
    {
      id
    }
  )
}

/** The proposal names a file outside the workspace. */
export function planPathOutsideWorkspaceWarning(id: string, path: string): string {
  return translateMain(
    'refactor.plan.pathOutsideWorkspace',
    'Proposal {{id}} names a file outside the workspace; it was dropped: {{path}}',
    { id, path }
  )
}

/** Two proposals change the same file, so only the first one can be written. */
export function planSameFileWarning(id: string, owner: string, path: string): string {
  return translateMain(
    'refactor.plan.sameFile',
    'Proposal {{id}} changes the same file as proposal {{owner}}; the later one was dropped: {{path}}',
    { id, owner, path }
  )
}

/** The proposal names the same file twice. */
export function planDuplicateFileWarning(id: string, path: string): string {
  return translateMain(
    'refactor.plan.duplicateFile',
    'Proposal {{id}} lists the same file twice; it was dropped: {{path}}',
    { id, path }
  )
}

/** The proposal names no file at all. */
export function planNoFilesWarning(id: string): string {
  return translateMain('refactor.plan.noFiles', 'Proposal {{id}} names no file; it was dropped', {
    id
  })
}

/** The job was cancelled while the proposal was being read. */
export function planCancelledWarning(id: string): string {
  return translateMain(
    'refactor.plan.cancelled',
    'Proposal {{id}}: the refactoring was cancelled; it was dropped',
    { id }
  )
}

/** The agent's own file cannot be read. */
export function planScratchUnreadableWarning(id: string, path: string): string {
  return translateMain(
    'refactor.plan.scratchUnreadable',
    'Proposal {{id}}: its scratch file cannot be read; it was dropped: {{path}}',
    { id, path }
  )
}

/** The baseline the change is measured against cannot be read. */
export function planBaselineUnreadableWarning(id: string, path: string): string {
  return translateMain(
    'refactor.plan.baselineUnreadable',
    'Proposal {{id}}: its baseline cannot be read; it was dropped: {{path}}',
    { id, path }
  )
}

/** The file on disk cannot be read, so the staleness check cannot run. */
export function planDiskUnreadableWarning(id: string, path: string): string {
  return translateMain(
    'refactor.plan.diskUnreadable',
    'Proposal {{id}}: its content on disk cannot be read; it was dropped: {{path}}',
    { id, path }
  )
}

/** The job was cancelled before the plan was built. */
export function planCancelledJobWarning(): string {
  return translateMain('refactor.plan.cancelledJob', 'The refactoring was cancelled')
}

/** The proposal was rebuilt from the scratch tree, so it carries no reason. */
export function planRestoredNoReasonWarning(id: string): string {
  return translateMain(
    'refactor.plan.restoredNoReason',
    'Proposal {{id}} was restored from the scratch directory; the agent gave no reason',
    { id }
  )
}

/** The manifest named the proposal but not the files it changes. */
export function planFilesFromTreeWarning(id: string): string {
  return translateMain(
    'refactor.plan.filesFromTree',
    'Proposal {{id}} does not list its files in the manifest; they were restored from the scratch directory',
    { id }
  )
}

/** More proposals than the review tab can show. */
export function planOverProposalLimitWarning(dropped: number, limit: number): string {
  return translateMain(
    'refactor.plan.overProposalLimit',
    'The review shows at most {{limit}} proposals; {{dropped}} could not be shown.',
    { limit, dropped }
  )
}

/** More files in one proposal than the review tab can show. */
export function planOverFileLimitWarning(dropped: number, limit: number): string {
  return translateMain(
    'refactor.plan.overFileLimit',
    'The review shows at most {{limit}} files per proposal; {{dropped}} proposals could not be shown.',
    { limit, dropped }
  )
}
