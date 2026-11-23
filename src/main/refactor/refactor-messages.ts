import { translateMain } from '../i18n/main-i18n'

/**
 * The copy the main process shows the user.
 *
 * Why the copy lives here and not at the call sites: the messages are the feature's own
 * vocabulary, several of them are shared by two layers, and the English a message falls back to
 * has to be the same sentence the catalog holds.
 */

/** The path of the refactoring target has a segment Windows would strip. */
export function pathRulesUnsafeSegmentMessage(): string {
  return translateMain(
    'refactor.pathRules.unsafeSegment',
    'The path of the refactoring target has a segment that ends with a space or a dot'
  )
}

/** The refactoring target is not a relative path inside the workspace. */
export function pathRulesNotRelativeMessage(): string {
  return translateMain(
    'refactor.pathRules.notRelative',
    'The refactoring target must be a relative path inside the workspace'
  )
}

/** The refactoring target resolves outside the workspace. */
export function pathRulesOutsideWorkspaceMessage(): string {
  return translateMain(
    'refactor.pathRules.outsideWorkspace',
    'The refactoring target must be inside the workspace'
  )
}

/** The file is too large to read into the plan. */
export function fileReadsTooLargeMessage(): string {
  return translateMain('refactor.fileReads.tooLarge', 'The file is too large to be read safely')
}

/** The file is not a regular file, so it cannot be read into the plan. */
export function fileReadsNotRegularMessage(): string {
  return translateMain(
    'refactor.fileReads.notRegular',
    'The file is not a regular file and cannot be read safely'
  )
}

/** The file cannot be read because of its permissions. */
export function fileReadsPermissionDeniedMessage(): string {
  return translateMain(
    'refactor.fileReads.permissionDenied',
    'The file cannot be read (permission denied)'
  )
}

/** The file cannot be read, and the reason would name a path. */
export function fileReadsUnreadableMessage(): string {
  return translateMain('refactor.fileReads.unreadable', 'The file cannot be read')
}

/** The manifest the agent wrote could not be read at all. */
export function manifestReadFailedMessage(reason: string): string {
  return translateMain(
    'refactor.manifest.readFailed',
    'The manifest could not be read: {{reason}}',
    { reason }
  )
}

/** The manifest is not JSON. */
export function manifestNotJsonMessage(): string {
  return translateMain('refactor.manifest.notJson', 'The manifest is not valid JSON')
}

/** The manifest does not hold the shape the plan builder reads. */
export function manifestBadShapeMessage(): string {
  return translateMain(
    'refactor.manifest.badShape',
    'The manifest does not have the expected shape'
  )
}

/** One proposal of the manifest does not hold the shape the plan builder reads. */
export function manifestProposalBadShapeMessage(id: string): string {
  return translateMain(
    'refactor.manifest.proposalBadShape',
    'The proposal {{id}} in the manifest does not have the expected shape; it was dropped',
    { id }
  )
}

/** One proposal of the manifest has no id, so it is named by its position. */
export function manifestProposalBadShapeNumberedMessage(index: number): string {
  return translateMain(
    'refactor.manifest.proposalBadShapeNumbered',
    'The proposal number {{index}} in the manifest does not have the expected shape; it was dropped',
    { index }
  )
}

/** The file changed while the user was reading the plan. */
export function applyFileChangedMessage(): string {
  return translateMain(
    'refactor.apply.fileChanged',
    'The file changed during the review; generate the refactoring suggestions again'
  )
}

/** The file is gone. */
export function applyFileMissingMessage(): string {
  return translateMain('refactor.apply.fileMissing', 'The file was deleted')
}

/** The write did not go through. */
export function applyWriteFailedMessage(): string {
  return translateMain('refactor.apply.writeFailed', 'The write failed')
}

/** The refactoring was cancelled before this file was written. */
export function applyCancelledMessage(): string {
  return translateMain(
    'refactor.apply.cancelled',
    'The refactoring was cancelled; the file was not written'
  )
}

/** The file cannot be written because it is not text. */
export function applyNotUtf8Message(): string {
  return translateMain(
    'refactor.apply.notUtf8',
    'The file is not valid UTF-8 text and cannot be written safely'
  )
}

/** The write threw, and the reason is worth reading. */
export function applyWriteFailedWithReasonMessage(reason: string): string {
  return translateMain('refactor.apply.writeFailedWithReason', 'The write failed: {{reason}}', {
    reason
  })
}

/** The agent is reading a file. */
export function progressReadingMessage(path: string): string {
  return translateMain('refactor.progress.reading', 'Reading {{path}}', { path })
}

/** The agent is writing a file. */
export function progressWritingMessage(path: string): string {
  return translateMain('refactor.progress.writing', 'Writing {{path}}', { path })
}

/** The child process did not confirm that it exited. */
export function turnConnectionUnconfirmedExitMessage(): string {
  return translateMain(
    'refactor.turnConnection.unconfirmedExit',
    'The child process did not confirm that it exited'
  )
}

/** The root process is still running, and so is its descendant tree. */
export function turnConnectionRootStillRunningMessage(root: string, tree: string): string {
  return translateMain(
    'refactor.turnConnection.rootStillRunning',
    'The root process did not exit: {{root}}; the descendant tree: {{tree}}',
    { root, tree }
  )
}

/** The connection could not be closed. */
export function turnConnectionCloseFailedMessage(reason: string): string {
  return translateMain(
    'refactor.turnConnection.closeFailed',
    'The connection could not be closed: {{reason}}',
    { reason }
  )
}

/** The user cancelled the refactoring. */
export function turnVerdictCancelledMessage(): string {
  return translateMain('refactor.turnVerdict.cancelled', 'The task was cancelled')
}

/** The turn ran past its deadline. */
export function turnVerdictTimedOutMessage(): string {
  return translateMain('refactor.turnVerdict.timedOut', 'The task timed out')
}

/** The turn ended without a verdict. */
export function turnVerdictNoResultMessage(): string {
  return translateMain('refactor.turnVerdict.noResult', 'The turn did not end')
}

/** The turn ended for a reason the SDK named. */
export function turnVerdictStopReasonMessage(reason: string): string {
  return translateMain('refactor.turnVerdict.stopReason', '(stopped because: {{reason}})', {
    reason
  })
}

/** The turn ended with an error. */
export function turnVerdictEndedInErrorMessage(detail: string, stop: string): string {
  return translateMain(
    'refactor.turnVerdict.endedInError',
    'The turn ended in an error: {{detail}}{{stop}}',
    { detail, stop }
  )
}

/** The turn crashed, and the crash said what happened. */
export function turnVerdictFaultMessage(fault: string): string {
  return translateMain('refactor.turnVerdict.fault', 'The turn did not end normally: {{fault}}', {
    fault
  })
}

/** A refactoring cannot run on a remote host. */
export function methodsRemoteWorkspaceRefusedMessage(): string {
  return translateMain(
    'refactor.methods.remoteWorkspaceRefused',
    'Refactoring on a remote host is not supported: start it in a workspace on this machine.'
  )
}

/** The job the caller named is not one this runtime knows. */
export function methodsJobNotFoundMessage(): string {
  return translateMain('refactor.methods.jobNotFound', 'The task does not exist')
}

/** The job the caller named is not one this runtime knows. */
export function methodsRefactorNotFoundMessage(): string {
  return translateMain('refactor.methods.refactorNotFound', 'The refactoring task does not exist')
}

/** The job holds no plan to review. */
export function methodsNoPlanMessage(): string {
  return translateMain(
    'refactor.methods.noPlan',
    'The refactoring task has no proposals to review yet'
  )
}
