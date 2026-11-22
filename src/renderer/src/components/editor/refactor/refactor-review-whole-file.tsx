import { Suspense } from 'react'

import { useTranslate } from '@/i18n/use-translate'

import { detectLanguage } from '../../../../../shared/editor-language/editor-language-detect'
import { applyRefactorHunks } from '../../../../../shared/refactor/refactor-hunk-application'
import type { RefactorFileProposal } from '../../../../../shared/refactor/refactor-types'
import { DiffViewer } from '../editor-lazy-views'

export type RefactorWholeFileProps = {
  /** The file of one proposal. */
  file: RefactorFileProposal
  /** The absolute path of that file in the workspace. */
  filePath: string
  /** The review tab that owns the Monaco model of the file. */
  ownerKey: string
  sideBySide: boolean
}

/**
 * The whole file of one proposal: the baseline and the text that proposal produces.
 *
 * Why this proposal's hunks only: another proposal's result would not be the file this proposal
 * leaves behind.
 */
export function RefactorWholeFile({
  file,
  filePath,
  ownerKey,
  sideBySide
}: RefactorWholeFileProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{file.path}</span>
        <span className="text-xs text-muted-foreground">
          {t('auto.components.editor.RefactorReviewTab.wholeFile', '整个文件')}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Why: the diff loads lazily, and the header must not wait for it. */}
        <Suspense fallback={null}>
          <DiffViewer
            modelKey={`refactor-file:${ownerKey}:${file.path}`}
            modelOwnerKey={ownerKey}
            originalContent={file.originalContent}
            modifiedContent={applyRefactorHunks(file.originalContent, file.hunks)}
            language={detectLanguage(file.path)}
            filePath={filePath}
            relativePath={file.path}
            sideBySide={sideBySide}
            editable={false}
          />
        </Suspense>
      </div>
    </div>
  )
}
