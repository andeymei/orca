import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { CornerDownLeft, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { PromptEditor, type PromptEditorInput } from '@/components/prompt-editor/PromptEditor'
import {
  PromptImageLabelContext,
  type PromptImageLabel
} from '@/components/prompt-editor/prompt-editor-labels'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getScreenSubmitModifierLabel } from '@/lib/keyboard/screen-submit-shortcut'
import { useTranslate } from '@/i18n/use-translate'
import type { TerminalComposerAttachment } from '@/store/slices/terminal-composer/terminal-composer'
import { clipboardEventPromptText } from '../../../../../shared/native-chat/input/native-chat-clipboard-event'
import { isImageDropPath } from '../../../../../shared/image-path-paste'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import {
  pasteTerminalComposerAttachments,
  type TerminalComposerIntakeHost,
  type TerminalComposerIntakeResult
} from './attachments/terminal-composer-attachment-intake'
import {
  attachmentReasonText,
  TerminalComposerAttachmentStatus
} from './TerminalComposerAttachmentStatus'
import { terminalComposerAgentVisiblePath } from './terminal-composer-agent-path'
import { clipboardCarriesFiles, draftHasContent } from './terminal-composer-content'
import {
  runTerminalComposerIntake,
  terminalComposerHostUnavailableMessage
} from './terminal-composer-intake'
import { readTerminalComposerDraft, useTerminalComposerState } from './use-terminal-composer-state'

/** An attachment whose bytes landed; the others are still uploading or failed. */
type LandedAttachment = TerminalComposerAttachment & { workspacePath: string }

export type TerminalComposerFieldHandle = {
  /** The body as the editor reads it: file pills as their `@path`, image pills as their token. */
  value: () => string
  /** Lands what the intake returned: the pills go into the body, the records into the draft. */
  landAttachments: (result: TerminalComposerIntakeResult) => void
  /** Whether an upload is still on its way to the host that owns the terminal. */
  setUploading: (uploading: boolean) => void
}

export type TerminalComposerFieldProps = {
  paneKey: string
  disabled: boolean
  onSend: () => void
  onAttach: () => void
  onDismiss: () => void
  /** Builds the host that owns this terminal; the intake needs it to land attachments on the right machine. */
  buildHost: () => TerminalComposerIntakeHost | null
  /** Claims a paste that carries images or files; plain text falls through to the editor. */
  onPasteCapture?: (event: React.ClipboardEvent) => void
}

/**
 * Inserts the pills of the attachments that landed, while the landing guard is held.
 *
 * The guard is released even when an insert throws, so the draft stays writable.
 */
function insertLandedAttachmentPills(args: {
  editor: PromptEditorInput
  landed: readonly LandedAttachment[]
  buildHost: () => TerminalComposerIntakeHost | null
  landingRef: React.RefObject<boolean>
}): void {
  try {
    for (const attachment of args.landed) {
      if (attachment.isImage) {
        args.editor.insertImageReference?.(attachment.id, attachment.name)
      } else {
        // The pill carries the path the agent reads, so the body names the right file.
        args.editor.insertFileReferences?.([
          terminalComposerAgentVisiblePath(args.buildHost()?.session, attachment.workspacePath)
        ])
      }
    }
  } finally {
    args.landingRef.current = false
  }
}

export function TerminalComposerField({
  paneKey,
  disabled,
  onSend,
  onAttach,
  onDismiss,
  buildHost,
  onPasteCapture,
  ref
}: TerminalComposerFieldProps & {
  ref?: React.Ref<TerminalComposerFieldHandle>
}): React.JSX.Element {
  const t = useTranslate()
  const { draft, saveDraft } = useTerminalComposerState(paneKey)
  const editorRef = useRef<PromptEditorInput | null>(null)
  const [uploading, setUploading] = useState(false)
  // The pills land as one batch, so the draft is written once, after they are in.
  const landingRef = useRef(false)
  const landingDocumentRef = useRef<JSONContent | null>(null)

  const landAttachments = useCallback(
    (result: TerminalComposerIntakeResult) => {
      const editor = editorRef.current
      const current = readTerminalComposerDraft(paneKey)
      const failedAttachments: TerminalComposerAttachment[] = result.failed.map((failure) => ({
        id: createNonSecureContextUuid(),
        name: failure.name,
        workspacePath: null,
        isImage: isImageDropPath(failure.name),
        failed: true,
        reason: failure.reason
      }))
      const landed = result.attachments.filter(
        (attachment): attachment is LandedAttachment => attachment.workspacePath !== null
      )
      const attachments = [...current.attachments, ...landed, ...failedAttachments]
      if (editor && landed.length > 0) {
        landingRef.current = true
        landingDocumentRef.current = null
        insertLandedAttachmentPills({ editor, landed, buildHost, landingRef })
      }
      const document = landingDocumentRef.current ?? current.document
      landingDocumentRef.current = null
      saveDraft({ document, attachments })
      const failure = result.failed[0]
      if (failure) {
        toast.error(t('terminalComposer.uploadFailed', 'Could not attach the file'), {
          description: attachmentReasonText(failure.reason, t)
        })
      }
    },
    [buildHost, paneKey, saveDraft, t]
  )

  useImperativeHandle(
    ref,
    () => ({
      value: () => editorRef.current?.value ?? '',
      landAttachments,
      setUploading
    }),
    [landAttachments]
  )

  useLayoutEffect(() => {
    editorRef.current?.focus()
  }, [])

  const handleDocumentChange = useCallback(
    (document: JSONContent) => {
      if (landingRef.current) {
        landingDocumentRef.current = document
        return
      }
      // The draft is replaced whole, so the attachments are read at write time.
      const current = readTerminalComposerDraft(paneKey)
      saveDraft({ document, attachments: current.attachments })
    },
    [paneKey, saveDraft]
  )

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent, editor: Editor): boolean => {
      if (event.isComposing || event.keyCode === 229) {
        // The IME owns the key: it only ends the composition.
        return false
      }
      if (event.key === 'Escape') {
        onDismiss()
        return true
      }
      if (event.key !== 'Enter') {
        return false
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault()
        // An upload in flight would be dropped from the message, so the send waits for it.
        if (!uploading) {
          onSend()
        }
        return true
      }
      // Enter always breaks the line; the agent is sent with Mod+Enter.
      editor.commands.setHardBreak()
      return true
    },
    [onDismiss, onSend, uploading]
  )

  const pasteFiles = useCallback(
    async (clipboardData: DataTransfer) => {
      const host = buildHost()
      if (!host) {
        toast.error(terminalComposerHostUnavailableMessage(t))
        return
      }
      await runTerminalComposerIntake({
        intake: () =>
          pasteTerminalComposerAttachments(host, {
            files: Array.from(clipboardData.files ?? []),
            items: clipboardData.items ? Array.from(clipboardData.items) : undefined
          }),
        land: landAttachments,
        setUploading,
        t
      })
    },
    [buildHost, landAttachments, t]
  )

  const capturePaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (onPasteCapture) {
        onPasteCapture(event)
        return
      }
      if (!clipboardCarriesFiles(event.clipboardData)) {
        // Plain text belongs to the editor.
        return
      }
      // The event is claimed: the editor's own paste handler must not run.
      event.preventDefault()
      // The text half is the body, so the field inserts it.
      const text = clipboardEventPromptText(event, true)
      if (text) {
        editorRef.current?.insertText?.(text)
      }
      void pasteFiles(event.clipboardData)
    },
    [onPasteCapture, pasteFiles]
  )

  const resolveImageLabel = useCallback(
    (attachmentId: string): PromptImageLabel | null => {
      const attachment = draft.attachments.find((candidate) => candidate.id === attachmentId)
      if (!attachment) {
        return null
      }
      return { label: attachment.name, missing: attachment.failed === true }
    },
    [draft.attachments]
  )

  const removeFailedAttachment = useCallback(
    (attachmentId: string) => {
      const current = readTerminalComposerDraft(paneKey)
      saveDraft({
        document: current.document,
        attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId)
      })
    },
    [paneKey, saveDraft]
  )

  return (
    <div className="flex flex-col gap-1.5">
      <TerminalComposerAttachmentStatus
        uploading={uploading}
        attachments={draft.attachments}
        onDismiss={removeFailedAttachment}
      />
      <div
        data-terminal-composer-editor="true"
        onPasteCapture={capturePaste}
        className="max-h-40 min-h-12 overflow-y-auto scrollbar-sleek rounded-md border border-border/70 bg-background px-2 py-1.5"
      >
        <PromptImageLabelContext value={resolveImageLabel}>
          <PromptEditor
            inputRef={editorRef}
            initialDocument={draft.document}
            disabled={disabled}
            placeholder={t('terminalComposer.placeholder', 'Message the agent')}
            handleKeyDown={handleEditorKeyDown}
            onDocumentChange={handleDocumentChange}
            className="text-sm outline-none"
          />
        </PromptImageLabelContext>
      </div>
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('terminalComposer.attach', 'Add attachment')}
                disabled={disabled}
                onClick={onAttach}
              >
                <Paperclip />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t('terminalComposer.attach', 'Add attachment')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          type="button"
          size="sm"
          disabled={disabled || uploading || !draftHasContent(draft.document)}
          onClick={onSend}
        >
          {t('terminalComposer.send', 'Send')}
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t('terminalComposer.enterHint', 'Enter for a new line')}</span>
          <span className="flex items-center gap-1">
            <ShortcutKeyCombo
              keys={[getScreenSubmitModifierLabel(), 'Enter']}
              renderKey={(key) => (key === 'Enter' ? <CornerDownLeft className="size-3" /> : key)}
            />
            {t('terminalComposer.sendHint', 'to send')}
          </span>
        </div>
      </div>
    </div>
  )
}
