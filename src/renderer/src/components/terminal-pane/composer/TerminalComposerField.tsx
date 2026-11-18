import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { CornerDownLeft, FileX, Hourglass, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { PromptEditor, type PromptEditorInput } from '@/components/prompt-editor/PromptEditor'
import { PromptImageLabelContext } from '@/components/prompt-editor/prompt-editor-labels'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getScreenSubmitModifierLabel } from '@/lib/keyboard/screen-submit-shortcut'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { TerminalComposerAttachment } from '@/store/slices/terminal-composer/terminal-composer'
import { isImageDropPath } from '../../../../../shared/image-path-paste'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import { isWslUncPath } from '../../../../../shared/wsl-paths'
import { toLocalWslDropPath } from '../input/file-drop/terminal-drop-local-wsl'
import {
  dropTerminalComposerAttachments,
  pasteTerminalComposerAttachments,
  type TerminalComposerIntakeHost,
  type TerminalComposerIntakeResult
} from './attachments/terminal-composer-attachment-intake'
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
  /** The host that owns this terminal; the intake needs it to land attachments on the right machine. */
  host: TerminalComposerIntakeHost
  /** Claims a paste that carries images or files; plain text falls through to the editor. */
  onPasteCapture?: (event: React.ClipboardEvent) => void
  /** Claims dropped files; the drop lands on the terminal's own workspace. */
  onDrop?: (paths: readonly string[]) => void
}

/** The paths a drop carries; a browser file without one is not a file the host can read. */
export function terminalComposerDroppedPaths(event: React.DragEvent): string[] {
  const fs = window.api?.fs
  const getPathForFile = fs && 'getPathForFile' in fs ? fs.getPathForFile : undefined
  if (!getPathForFile) {
    return []
  }
  const paths: string[] = []
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    try {
      const path = getPathForFile(file)
      if (path) {
        paths.push(path)
      }
    } catch {
      // A virtual file has no local path.
    }
  }
  return paths
}

/** The path the agent in this terminal reads: a WSL-hosted agent reads Linux paths. */
function agentVisiblePath(host: TerminalComposerIntakeHost, path: string): string {
  // A plain UNC path is not a WSL path, and toLocalWslDropPath would mangle it.
  return isWslUncPath(host.workspacePath) ? toLocalWslDropPath(path) : path
}

function isLandedAttachment(
  attachment: TerminalComposerAttachment
): attachment is LandedAttachment {
  return attachment.workspacePath !== null
}

function clipboardCarriesFiles(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData) {
    return false
  }
  if (clipboardData.files && clipboardData.files.length > 0) {
    return true
  }
  const items = clipboardData.items
  return items ? Array.from(items).some((item) => item.kind === 'file') : false
}

function dragCarriesFiles(dataTransfer: DataTransfer | null): boolean {
  const types = dataTransfer?.types
  return types ? Array.from(types).includes('Files') : false
}

/** The intake reports machine codes for some failures and a sentence for others. */
function attachmentReasonText(reason: string, t: Translate): string {
  switch (reason) {
    case 'missing':
      return t('terminalComposer.reasonMissing', 'The file is gone')
    case 'symlink':
      return t('terminalComposer.reasonSymlink', 'That path is a link, not a file')
    case 'permission-denied':
      return t('terminalComposer.reasonPermissionDenied', 'No permission to read the file')
    case 'unsupported':
      return t('terminalComposer.reasonUnsupported', 'That kind of file cannot be attached')
    case 'no-local-path':
      return t('terminalComposer.reasonNoLocalPath', 'The pasted item has no file behind it')
    default:
      // A reason that is already a sentence is shown as it came.
      return reason
  }
}

export function TerminalComposerField({
  paneKey,
  disabled,
  onSend,
  onAttach,
  onDismiss,
  host,
  onPasteCapture,
  onDrop,
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
        failed: true
      }))
      const landed = result.attachments.filter(isLandedAttachment)
      const attachments = [...current.attachments, ...landed, ...failedAttachments]
      if (editor && landed.length > 0) {
        landingRef.current = true
        landingDocumentRef.current = null
        try {
          for (const attachment of landed) {
            if (attachment.isImage) {
              editor.insertImageReference?.(attachment.id, attachment.name)
            } else {
              // The pill carries the path the agent reads, so the body names the right file.
              editor.insertFileReferences?.([agentVisiblePath(host, attachment.workspacePath)])
            }
          }
        } finally {
          landingRef.current = false
        }
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
    [host, paneKey, saveDraft, t]
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
        onSend()
        return true
      }
      // Enter always breaks the line; the agent is sent with Mod+Enter.
      editor.commands.setHardBreak()
      return true
    },
    [onDismiss, onSend]
  )

  const pasteFiles = useCallback(
    async (clipboardData: DataTransfer) => {
      setUploading(true)
      try {
        const result = await pasteTerminalComposerAttachments(host, {
          files: Array.from(clipboardData.files ?? []),
          items: clipboardData.items ? Array.from(clipboardData.items) : undefined
        })
        landAttachments(result)
      } finally {
        setUploading(false)
      }
    },
    [host, landAttachments]
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
      // The event is claimed: the editor would paste the image as binary text.
      event.preventDefault()
      void pasteFiles(event.clipboardData)
    },
    [onPasteCapture, pasteFiles]
  )

  const dropFiles = useCallback(
    async (paths: readonly string[]) => {
      setUploading(true)
      try {
        landAttachments(await dropTerminalComposerAttachments(host, paths))
      } finally {
        setUploading(false)
      }
    },
    [host, landAttachments]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      // The card is a drop target too; the file lands once.
      event.stopPropagation()
      const paths = terminalComposerDroppedPaths(event)
      if (onDrop) {
        onDrop(paths)
        return
      }
      void dropFiles(paths)
    },
    [dropFiles, onDrop]
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!dragCarriesFiles(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const resolveImageLabel = useCallback(
    (attachmentId: string) => {
      const attachment = draft.attachments.find((candidate) => candidate.id === attachmentId)
      if (!attachment) {
        return null
      }
      return { label: attachment.name, missing: attachment.failed === true }
    },
    [draft.attachments]
  )

  const failedAttachments = draft.attachments.filter((attachment) => attachment.failed === true)

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
      {uploading || failedAttachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {uploading ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
              <Hourglass className="size-3" />
              <LoadingSpinner className="size-3" />
              {t('terminalComposer.uploading', 'Uploading…')}
            </span>
          ) : null}
          {failedAttachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-56 items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              <FileX className="size-3 shrink-0" />
              <span className="truncate">{attachment.name}</span>
              <span className="shrink-0">
                {t('terminalComposer.attachAgain', 'Attach it again')}
              </span>
              <button
                type="button"
                aria-label={t('terminalComposer.dismissFailed', 'Dismiss the failed attachment')}
                className="shrink-0 rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground"
                onClick={() => removeFailedAttachment(attachment.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div
        data-terminal-composer-editor="true"
        onPasteCapture={capturePaste}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
        <Button type="button" size="sm" disabled={disabled} onClick={onSend}>
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
