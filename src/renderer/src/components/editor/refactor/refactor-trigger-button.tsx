import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'

import type { FileContent } from '../editor-panel-content-types'
import { openRefactorReviewTab } from './refactor-review-tab-open'

export type RefactorTriggerButtonProps = {
  /** The file the refactoring would run on. */
  fileId: string
  worktreeId: string
  relativePath: string
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
  drafts,
  fileContents
}: RefactorTriggerButtonProps): React.JSX.Element {
  const t = useTranslate()
  const content = refactorSourceContent(drafts[fileId], fileContents[fileId])
  const label = t('auto.components.editor.RefactorTriggerButton.refactor', 'Refactor')
  // Why the pending state: the propose request can take a while, and a second click would start a
  // second agent turn on the same file.
  const [starting, setStarting] = useState(false)
  const start = async (): Promise<void> => {
    if (starting || content.length === 0) {
      return
    }
    setStarting(true)
    try {
      await openRefactorReviewTab({ worktreeId, relativePath, content })
    } finally {
      setStarting(false)
    }
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
            onClick={() => {
              void start()
            }}
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
