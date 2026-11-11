import React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  measureTextControlPasteByteLength,
  pasteTextIntoTextControl,
  shouldHandleTextControlPaste
} from '@/lib/text-input/paste/text-control-paste'
import { TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES } from '@/lib/text-input/paste/text-control-paste-model'

type Props = {
  label: string
  placeholder: string
  note: string
  onNoteChange: (value: string) => void
}

/** The composer note doubles as the task text the agent receives. */
export function ComposerTaskNoteField({
  label,
  placeholder,
  note,
  onNoteChange
}: Props): React.JSX.Element {
  const handleNotePaste = React.useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    const byteLengthMeasurement = measureTextControlPasteByteLength(text, {
      stopAfterBytes: TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES
    })
    if (
      !byteLengthMeasurement.exceededLimit &&
      !shouldHandleTextControlPaste(text, { measuredByteLength: byteLengthMeasurement.byteLength })
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const textarea = event.currentTarget
    void pasteTextIntoTextControl(textarea, text, {
      source: 'clipboard',
      canContinue: (target) => target.ownerDocument.activeElement === target
    })
      .then((result) => {
        if (result.status === 'rejected' && result.reason === 'too-large') {
          toast.error(
            translate(
              'auto.components.NewWorkspaceComposerCard.notePasteTooLarge',
              'Paste is too large for the note field.'
            )
          )
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        onPaste={handleNotePaste}
        placeholder={placeholder}
        rows={1}
        className="w-full min-w-0 resize-none overflow-y-auto scrollbar-sleek rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [field-sizing:content] max-h-40"
      />
    </div>
  )
}
