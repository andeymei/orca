import { Loader2, Sparkles } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { fileOwnerUnresolvedMessage } from '@/lib/files/access/file-owner-runtime-target'
import { useFileOwnerRuntimeTarget } from '@/runtime/rpc/targets/use-worktree-runtime-target'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

import type { FileContent } from '../loading/editor-panel-content-types'
import { openRefactorReviewTab } from './refactor-review-tab-open'
import {
  beginRefactorStart,
  endRefactorStart,
  isRefactorStarting,
  subscribeRefactorStarts
} from './refactor-start-guard'

export type RefactorTriggerButtonProps = {
  /** The file the refactoring would run on. */
  fileId: string
  worktreeId: string
  relativePath: string
  /** The runtime environment that owns the workspace; absent for a workspace of this machine. */
  runtimeEnvironmentId?: string | null
  /** The unsaved buffer of every open file, by file id. */
  drafts: Record<string, string>
  /** The content the editor loaded from disk, by file id. */
  fileContents: Record<string, FileContent>
}

/** The header button that starts a refactoring of the file the user is looking at. */
export function RefactorTriggerButton({
  fileId,
  worktreeId,
  relativePath,
  runtimeEnvironmentId,
  drafts,
  fileContents
}: RefactorTriggerButtonProps): React.JSX.Element {
  const t = useTranslate()
  const content = refactorSourceContent(drafts[fileId], fileContents[fileId])
  const label = t('auto.components.editor.RefactorTriggerButton.refactor', 'Refactor')
  // Why the owner: the job runs in the runtime that holds the workspace's files, so the request
  // has to go there and not to this app's runtime.
  const target = useFileOwnerRuntimeTarget(worktreeId, runtimeEnvironmentId)
  // Why the shared guard: the button unmounts when the user leaves the file, and a second start
  // while the first request is in flight would run a second agent turn on the same file.
  const readStarting = useCallback(
    () => isRefactorStarting(worktreeId, relativePath),
    [worktreeId, relativePath]
  )
  const starting = useSyncExternalStore(subscribeRefactorStarts, readStarting)
  const start = (): void => {
    void startRefactoring({ target, worktreeId, relativePath, content, runtimeEnvironmentId })
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={content.length === 0 || starting}
            onClick={start}
          >
            {starting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Starts the refactoring and always releases the start guard.
 *
 * Why it is not a component function: the React Compiler cannot compile a try/finally without a
 * catch inside a component, and the guard has to be released even when the request fails.
 */
async function startRefactoring(input: {
  target: RuntimeClientTarget | null
  worktreeId: string
  relativePath: string
  content: string
  runtimeEnvironmentId?: string | null
}): Promise<void> {
  if (input.content.length === 0 || !beginRefactorStart(input.worktreeId, input.relativePath)) {
    return
  }
  try {
    if (!input.target) {
      // Why: the rows disagree on who owns the workspace, so no runtime can be named for it.
      toast.error(fileOwnerUnresolvedMessage())
      return
    }
    await openRefactorReviewTab({
      target: input.target,
      worktreeId: input.worktreeId,
      relativePath: input.relativePath,
      content: input.content,
      runtimeEnvironmentId: input.runtimeEnvironmentId
    })
  } finally {
    endRefactorStart(input.worktreeId, input.relativePath)
  }
}

/**
 * The text a refactoring would run on.
 *
 * Why the buffer first: the user may have unsaved edits, and the refactoring has to be based on
 * what they see. Why the disk content is checked: a binary, half-read or outdated file is not
 * something to hand to an agent.
 */
export function refactorSourceContent(
  draft: string | undefined,
  loaded: FileContent | undefined
): string {
  if (draft !== undefined) {
    return draft
  }
  if (!loaded || loaded.isBinary || loaded.loadError || loaded.isStale) {
    return ''
  }
  return loaded.content
}
