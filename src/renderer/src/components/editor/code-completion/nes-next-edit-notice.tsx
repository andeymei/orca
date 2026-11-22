import { ChevronDown, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/i18n/use-translate'
import type { NesNextEdit } from './nes-next-edit'

/**
 * The notice that names the edit the editor cannot draw where the user is typing.
 *
 * Why: a plan whose edit sits elsewhere in the file leaves a gutter marker, and a marker alone
 * reads as nothing happened. The notice names the place, so a suggestion is never invisible.
 */
export function NesNextEditNotice(props: {
  nextEdit: NesNextEdit
  /** Moves the cursor to the edit, so the user lands where the model meant. */
  onJump: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { nextEdit } = props
  if (nextEdit.kind === 'rewrite') {
    // Why: only a held Alt previews a rewrite, so the notice says so rather than pretending a
    // click would show it.
    return (
      <Badge variant="dot" className="absolute right-3 top-2 z-10" title={nextEdit.label}>
        <Pencil className="size-3" />
        {t('components.codeCompletion.rewriteHere', 'Rewrite here')}
        <span className="text-muted-foreground">
          {t('components.codeCompletion.holdAltToPreview', 'hold Alt to preview')}
        </span>
      </Badge>
    )
  }
  return (
    <Badge variant="dot" asChild className="absolute right-3 top-2 z-10 cursor-pointer">
      <button type="button" onClick={props.onJump} title={nextEdit.label}>
        <ChevronDown className="size-3" />
        {t('components.codeCompletion.nextEdit', 'Next edit')}
        <span className="font-mono text-muted-foreground">L{nextEdit.lineNumber}</span>
      </button>
    </Badge>
  )
}
