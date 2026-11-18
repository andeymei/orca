import { useCallback, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { splitImageReferences } from '../../../../../shared/native-chat/native-chat-image-reference'
import { focusTerminalTabSurface } from '../input/focus/focus-terminal-tab-surface'
import { captureTerminalDropTransportOwner } from '../input/file-drop/terminal-drop-transport-owner'
import { resolveTerminalDropWorktreePath } from '../input/file-drop/terminal-drop-worktree-path'
import type { PtyTransport } from '../pty-transport/pty-transport-types'
import {
  dropTerminalComposerAttachments,
  pickTerminalComposerAttachments,
  type TerminalComposerIntakeHost
} from './attachments/terminal-composer-attachment-intake'
import {
  TerminalComposerField,
  terminalComposerHostUnavailableMessage,
  type TerminalComposerFieldHandle
} from './TerminalComposerField'
import {
  useTerminalComposerSend,
  type TerminalComposerSendResult
} from './use-terminal-composer-send'
import { useTerminalComposerFileDrop } from './use-terminal-composer-file-drop'
import { readTerminalComposerDraft, useTerminalComposerState } from './use-terminal-composer-state'

export type TerminalComposerOverlayProps = {
  paneKey: string
  paneId: number
  leafId: string
  tabId: string
  /** The pane's cwd; a folder workspace lands its drops here. */
  cwd: string | undefined
  worktreeId: string
  agent: string | null
  /** The tab's pane manager; proves the pane is still mounted before a write. */
  managerRef: React.RefObject<PaneManager | null>
  /** The tab's live transports, keyed by pane id. */
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
}

/** Why the message did not reach the agent; the code never reaches the user. */
function sendFailureText(reason: TerminalComposerSendResult['reason'], t: Translate): string {
  switch (reason) {
    case 'host-changed':
      return t('terminalComposer.hostChanged', 'The host changed, so the message was not sent')
    case 'pty-disconnected':
      return t(
        'terminalComposer.disconnected',
        'The terminal disconnected, so the message was not sent'
      )
    case 'pane-changed':
      return t('terminalComposer.paneChanged', 'The pane changed, so the message was not sent')
    case 'write-rejected':
      return t('terminalComposer.writeRejected', 'The host refused the message')
    case undefined:
      return t('terminalComposer.sendFailed', 'The message was not sent')
  }
}

export function TerminalComposerOverlay({
  paneKey,
  paneId,
  leafId,
  tabId,
  cwd,
  worktreeId,
  agent,
  managerRef,
  paneTransportsRef
}: TerminalComposerOverlayProps): React.JSX.Element {
  const t = useTranslate()
  const { open, setOpen } = useTerminalComposerState(paneKey)
  const fieldRef = useRef<TerminalComposerFieldHandle | null>(null)
  // The editor is seeded once, so a sent body needs a fresh field to start empty.
  const [fieldKey, setFieldKey] = useState(0)
  const { send } = useTerminalComposerSend({ managerRef, paneTransportsRef })

  /**
   * The host that owns this terminal, read from the pane's transport at the moment the
   * intake happens: the host may have moved since the pane was drawn.
   */
  const buildIntakeHost = useCallback((): TerminalComposerIntakeHost | null => {
    const transport = paneTransportsRef.current.get(paneId)
    if (!transport) {
      return null
    }
    let owner
    try {
      owner = captureTerminalDropTransportOwner(transport)
    } catch {
      // The SSH connection is gone; nothing can land on it.
      return null
    }
    const workspacePath = resolveTerminalDropWorktreePath(
      worktreeId,
      owner?.runtimeEnvironmentId ? undefined : cwd,
      owner?.executionHostId,
      owner?.runtimeEnvironmentId
    )
    if (!workspacePath) {
      return null
    }
    // Only an SSH host names a target and a connection generation.
    const expectedSshTargetId =
      owner && 'expectedSshTargetId' in owner ? owner.expectedSshTargetId : undefined
    const expectedSshConnectionGeneration =
      owner && 'expectedSshConnectionGeneration' in owner
        ? owner.expectedSshConnectionGeneration
        : undefined
    return {
      workspacePath,
      worktreeId,
      runtimeEnvironmentId: owner?.runtimeEnvironmentId ?? null,
      connectionId: owner?.connectionId ?? null,
      expectedExecutionHostId: owner?.expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration,
      assertCurrent: owner?.assertCurrent
    }
  }, [cwd, paneId, paneTransportsRef, worktreeId])

  const dismiss = useCallback(() => {
    setOpen(false)
    // The terminal takes the focus back; the editor is gone with the composer.
    focusTerminalTabSurface(tabId, leafId)
  }, [leafId, setOpen, tabId])

  const handleSend = useCallback(() => {
    const value = fieldRef.current?.value() ?? ''
    const parts = splitImageReferences(value)
    // The image pills travel as their own writes, so the body keeps only the text.
    const body = parts.filter((part): part is string => typeof part === 'string').join('')
    const imageIds = parts.flatMap((part) => (typeof part === 'string' ? [] : [part.attachmentId]))
    // The pill order is the order the images travel in; the attachment list is not.
    const draft = readTerminalComposerDraft(paneKey)
    const imagePaths = imageIds.flatMap((attachmentId) => {
      const attachment = draft.attachments.find((candidate) => candidate.id === attachmentId)
      return attachment?.workspacePath ? [attachment.workspacePath] : []
    })
    if (body.trim().length === 0 && imagePaths.length === 0) {
      // Nothing to say: no bytes at all, not even a cleared input line.
      return
    }
    void (async () => {
      const result = await send({ paneId, leafId, tabId, body, imagePaths, agent })
      if (!result.sent) {
        toast.error(sendFailureText(result.reason, t))
        return
      }
      useAppStore.getState().clearTerminalComposerDraft(paneKey)
      setFieldKey((key) => key + 1)
    })()
  }, [agent, leafId, paneId, paneKey, send, t, tabId])

  const handleAttach = useCallback(() => {
    void (async () => {
      const host = buildIntakeHost()
      if (!host) {
        toast.error(terminalComposerHostUnavailableMessage(t))
        return
      }
      fieldRef.current?.setUploading(true)
      try {
        fieldRef.current?.landAttachments(await pickTerminalComposerAttachments(host))
      } finally {
        fieldRef.current?.setUploading(false)
      }
    })()
  }, [buildIntakeHost, t])

  const handleDropPaths = useCallback(
    (paths: readonly string[]) => {
      void (async () => {
        const host = buildIntakeHost()
        if (!host) {
          // The card claimed the drop, so the composer owes the user an answer.
          toast.error(terminalComposerHostUnavailableMessage(t))
          return
        }
        if (paths.length === 0) {
          return
        }
        fieldRef.current?.setUploading(true)
        try {
          fieldRef.current?.landAttachments(await dropTerminalComposerAttachments(host, paths))
        } finally {
          fieldRef.current?.setUploading(false)
        }
      })()
    },
    [buildIntakeHost, t]
  )

  // The card owns the drop: the pane that hosts the composer claims OS drops first.
  const attachDropOwner = useTerminalComposerFileDrop({
    onPaths: handleDropPaths
  })

  if (!open) {
    return (
      <div className="absolute right-3 bottom-3 z-10">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('terminalComposer.open', 'Send a message to the agent')}
                onClick={() => setOpen(true)}
              >
                <MessageSquarePlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t('terminalComposer.open', 'Send a message to the agent')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  return (
    <div
      ref={attachDropOwner}
      className="absolute inset-x-0 bottom-0 z-10 rounded-lg border border-border bg-popover p-2 shadow-lg"
    >
      <TerminalComposerField
        key={fieldKey}
        ref={fieldRef}
        paneKey={paneKey}
        // A pane without a live terminal is the send layer's business: it refuses the write
        // and says why.
        disabled={false}
        buildHost={buildIntakeHost}
        onSend={handleSend}
        onAttach={handleAttach}
        onDismiss={dismiss}
      />
    </div>
  )
}
