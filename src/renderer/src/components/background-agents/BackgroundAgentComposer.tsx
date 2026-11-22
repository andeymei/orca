import { useCallback, useImperativeHandle, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { PromptEditor, type PromptEditorInput } from '@/components/prompt-editor/PromptEditor'
import {
  PromptImageLabelContext,
  type PromptImageLabel
} from '@/components/prompt-editor/prompt-editor-labels'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { getScreenSubmitModifierLabel } from '@/lib/keyboard/screen-submit-shortcut'
import { isImeOwnedKeyboardEvent } from '@/lib/text-input/ime/ime-composition-keyboard-event'
import type { TerminalComposerAttachment } from '@/store/slices/terminal-composer/terminal-composer'
import {
  pasteTerminalComposerAttachments,
  pickTerminalComposerAttachments,
  type TerminalComposerIntakeHost,
  type TerminalComposerIntakeResult
} from '@/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake'
import {
  attachmentReasonText,
  TerminalComposerAttachmentStatus
} from '@/components/terminal-pane/composer/TerminalComposerAttachmentStatus'
import { clipboardCarriesFiles } from '@/components/terminal-pane/composer/terminal-composer-content'
import { clipboardEventPromptText } from '../../../../shared/native-chat/input/native-chat-clipboard-event'
import { isImageDropPath } from '../../../../shared/image-path-paste'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import { backgroundAgentPrompt } from './background-agent-composer-attachments'

/** The prompt box under the roster. */
const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export type BackgroundAgentComposerHandle = {
  /** The prompt as it travels: the text with every attachment named by the path it landed at. */
  prompt: () => string
  /** Empties the box; it answers whether there was anything to empty. */
  clear: () => boolean
  /** Puts the caret in the box. */
  focus: () => void
}

/**
 * The prompt box under the roster.
 *
 * It is the app's rich text field: the text is a document, a file is a pill that names the path
 * the agent reads, and an image is a pill that names the picture. Enter breaks the line and
 * Mod+Enter starts the agent, the way every other composer in the app answers.
 *
 * A host this version cannot command renders no composer: the prompt would have nowhere to run.
 */
export function BackgroundAgentComposer({
  onSend,
  onCommand,
  onDismiss,
  buildHost,
  ref
}: {
  /** Starts the agent with the composed prompt. */
  onSend: (prompt: string) => void
  /** The panel's stop and delete command. */
  onCommand: () => void
  /** The list takes the keys; the box has nothing left to clear. */
  onDismiss: () => void
  /** The host that owns the workspace; the attachments land there. */
  buildHost: () => TerminalComposerIntakeHost | null
  ref?: React.Ref<BackgroundAgentComposerHandle>
}): React.JSX.Element {
  const t = useTranslate()
  const editorRef = useRef<PromptEditorInput | null>(null)
  const [attachments, setAttachments] = useState<TerminalComposerAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [text, setText] = useState('')

  const landAttachments = useCallback(
    (result: TerminalComposerIntakeResult) => {
      const editor = editorRef.current
      const failed = result.failed.map((failure) => ({
        id: createNonSecureContextUuid(),
        name: failure.name,
        workspacePath: null,
        isImage: isImageDropPath(failure.name),
        failed: true,
        reason: failure.reason
      }))
      const landed = result.attachments.filter(
        (attachment): attachment is TerminalComposerAttachment & { workspacePath: string } =>
          attachment.workspacePath !== null
      )
      setAttachments((current) => [...current, ...landed, ...failed])
      if (editor) {
        for (const attachment of landed) {
          if (attachment.isImage) {
            editor.insertImageReference?.(attachment.id, attachment.name)
          } else {
            // The pill names the path the agent reads, so the body names the right file.
            editor.insertFileReferences?.([attachment.workspacePath])
          }
        }
      }
      const failure = result.failed[0]
      if (failure) {
        toast.error(
          t('auto.components.backgroundAgents.uploadFailed', 'Could not attach the file'),
          {
            description: attachmentReasonText(failure.reason, t)
          }
        )
      }
    },
    [t]
  )

  const pasteFiles = useCallback(
    async (clipboardData: DataTransfer) => {
      const host = buildHost()
      if (!host) {
        toast.error(
          t('auto.components.backgroundAgents.attachUnavailable', 'This host takes no files')
        )
        return
      }
      try {
        landAttachments(
          await pasteTerminalComposerAttachments(host, {
            files: Array.from(clipboardData.files ?? []),
            items: clipboardData.items ? Array.from(clipboardData.items) : undefined
          })
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('auto.components.backgroundAgents.uploadFailed', 'Could not attach the file')
        )
      } finally {
        setUploading(false)
      }
    },
    [buildHost, landAttachments, t]
  )

  const capturePaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (!clipboardCarriesFiles(event.clipboardData)) {
        // Plain text belongs to the editor.
        return
      }
      // The event is claimed: the editor's own paste handler must not run.
      event.preventDefault()
      // The text half is the body, so the field inserts it.
      const pasted = clipboardEventPromptText(event, true)
      if (pasted) {
        editorRef.current?.insertText?.(pasted)
      }
      setUploading(true)
      void pasteFiles(event.clipboardData)
    },
    [pasteFiles]
  )

  const pickFiles = useCallback(() => {
    const host = buildHost()
    if (!host) {
      toast.error(
        t('auto.components.backgroundAgents.attachUnavailable', 'This host takes no files')
      )
      return
    }
    setUploading(true)
    void (async () => {
      try {
        landAttachments(await pickTerminalComposerAttachments(host))
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('auto.components.backgroundAgents.uploadFailed', 'Could not attach the file')
        )
      } finally {
        setUploading(false)
      }
    })()
  }, [buildHost, landAttachments, t])

  const clear = useCallback((): boolean => {
    const editor = editorRef.current
    if (!editor) {
      return false
    }
    const had = editor.value.trim() !== ''
    editor.clear?.()
    setAttachments([])
    return had
  }, [])

  const prompt = useCallback(
    (): string => backgroundAgentPrompt(editorRef.current?.value ?? '', attachments),
    [attachments]
  )

  useImperativeHandle(
    ref,
    () => ({
      prompt,
      clear,
      focus: () => editorRef.current?.focus()
    }),
    [clear, prompt]
  )

  const send = useCallback(() => {
    // A file that is still on its way would be dropped from the message, so the send waits.
    if (uploading) {
      return
    }
    const composed = prompt()
    if (composed.trim() === '') {
      return
    }
    onSend(composed)
  }, [onSend, prompt, uploading])

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent, editor: Editor): boolean => {
      if (isImeOwnedKeyboardEvent(event)) {
        // The IME owns the key: it only ends the composition.
        return false
      }
      if (event.key === 'Enter') {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          send()
          return true
        }
        // Enter always breaks the line; the agent is sent with Mod+Enter.
        editor.commands.setHardBreak()
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // An empty box has nothing to clear, so the list takes the keys.
        if (!clear()) {
          onDismiss()
        }
        return true
      }
      if (event.ctrlKey && (event.key === 'x' || event.key === 'X')) {
        // Why the selection: a cut of the user's own text is the native cut, not the panel's
        // stop command.
        if (!editor.state.selection.empty) {
          return false
        }
        event.preventDefault()
        onCommand()
        return true
      }
      return false
    },
    [clear, onCommand, onDismiss, send]
  )

  const resolveImageLabel = useCallback(
    (attachmentId: string): PromptImageLabel | null => {
      const attachment = attachments.find((candidate) => candidate.id === attachmentId)
      if (!attachment) {
        return null
      }
      return { label: attachment.name, missing: attachment.failed === true }
    },
    [attachments]
  )

  const dismissFailed = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  return (
    <>
      <div className="flex flex-col gap-1.5 border-t border-border px-2 py-2">
        <TerminalComposerAttachmentStatus
          uploading={uploading}
          attachments={attachments}
          onDismiss={dismissFailed}
        />
        <div
          data-background-agent-composer="true"
          onPasteCapture={capturePaste}
          className="max-h-40 min-h-12 overflow-y-auto scrollbar-sleek rounded-md border border-border/70 bg-background px-2 py-1.5"
        >
          <PromptImageLabelContext value={resolveImageLabel}>
            <PromptEditor
              inputRef={editorRef}
              initialDocument={EMPTY_DOCUMENT}
              disabled={false}
              placeholder={t(
                'auto.components.backgroundAgents.composerPlaceholder',
                'Describe a task for a new session'
              )}
              ariaLabel={t(
                'auto.components.backgroundAgents.composerLabel',
                'New background agent'
              )}
              handleKeyDown={handleEditorKeyDown}
              onChange={(input) => setText(input.value)}
              className="text-sm outline-none"
            />
          </PromptImageLabelContext>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.backgroundAgents.attach', 'Add attachment')}
            onClick={pickFiles}
          >
            <Paperclip />
          </Button>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={uploading || text.trim() === ''}
            onClick={send}
          >
            {t('auto.components.backgroundAgents.send', 'Send')}
          </Button>
        </div>
      </div>
      <div className="px-2 pb-2 text-2xs text-muted-foreground">{shortcutsText(t)}</div>
    </>
  )
}

/** The keys the panel answers, as one line under the box. */
function shortcutsText(t: Translate): string {
  return t(
    'auto.components.backgroundAgents.shortcuts',
    '↑↓ select · {{modifier}}↵ send · ctrl+x stop · / task',
    { modifier: getScreenSubmitModifierLabel() }
  )
}

export default BackgroundAgentComposer
