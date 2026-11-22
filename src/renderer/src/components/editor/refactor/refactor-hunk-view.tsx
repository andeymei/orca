import { Circle, CircleCheck } from 'lucide-react'
import { Suspense } from 'react'

import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

import { detectLanguage } from '../../../../../shared/editor-language/editor-language-detect'
import type { RefactorHunk } from '../../../../../shared/refactor/refactor-types'
import { DiffViewer } from '../editor-lazy-views'

export type RefactorHunkViewProps = {
  hunk: RefactorHunk
  /** The absolute path of the file the hunk came from, as the workspace holds it. */
  filePath: string
  /** The path of that file relative to the workspace root. */
  relativePath: string
  /** The review tab that owns the Monaco models of every hunk it shows. */
  ownerKey: string
  accepted: boolean
  sideBySide: boolean
  onToggleAccepted: () => void
  disabled?: boolean
}

/** One hunk of one file: the lines it replaces, the diff, and the control that accepts it. */
export function RefactorHunkView({
  hunk,
  filePath,
  relativePath,
  ownerKey,
  accepted,
  sideBySide,
  onToggleAccepted,
  disabled
}: RefactorHunkViewProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">
          {t('auto.components.editor.RefactorHunkView.lineRange', 'Lines {{range}}', {
            range: originalLineRange(hunk)
          })}
        </span>
        <Button
          className="ml-auto"
          size="xs"
          variant={accepted ? 'secondary' : 'outline'}
          disabled={disabled}
          aria-pressed={accepted}
          onClick={onToggleAccepted}
        >
          {accepted ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
          {accepted
            ? t('auto.components.editor.RefactorHunkView.accepted', 'Accepted')
            : t('auto.components.editor.RefactorHunkView.accept', 'Accept')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Why: the diff chunk loads lazily, and the header must not wait for it. */}
        <Suspense fallback={null}>
          <DiffViewer
            modelKey={`refactor-hunk:${ownerKey}:${relativePath}:${hunk.id}`}
            modelOwnerKey={ownerKey}
            originalContent={hunk.originalText}
            modifiedContent={hunk.modifiedText}
            language={detectLanguage(relativePath)}
            filePath={filePath}
            relativePath={relativePath}
            sideBySide={sideBySide}
            editable={false}
          />
        </Suspense>
      </div>
    </div>
  )
}

/** The lines the hunk replaces; a pure insertion has no lines of its own. */
function originalLineRange(hunk: RefactorHunk): string {
  if (hunk.originalLineCount === 0) {
    return String(hunk.originalStartLine)
  }
  return `${hunk.originalStartLine}-${hunk.originalStartLine + hunk.originalLineCount - 1}`
}
