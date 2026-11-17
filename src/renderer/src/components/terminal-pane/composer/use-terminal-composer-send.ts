import { useCallback } from 'react'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { AGENT_TUI_CLEAR_INPUT_MAX } from '../../../../../shared/agent-launch/startup/agent-tui-input-clear'
import { agentImagePasteWrites } from '../../../../../shared/agent-image-paste'
import { agentImagePastePath } from '../../../../../shared/agent-image-paste-path'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../../shared/native-chat/input/native-chat-answer-stepping'
import {
  buildNativeChatImagePasteBytes,
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from '../../../../../shared/native-chat/input/native-chat-paste-bytes'
import { isWslUncPath } from '../../../../../shared/wsl-paths'
import { toLocalWslDropPath } from '../input/file-drop/terminal-drop-local-wsl'
import {
  captureTerminalDropTarget,
  getCurrentTerminalDropTransport
} from '../input/file-drop/terminal-drop-target'
import { captureTerminalDropTransportOwner } from '../input/file-drop/terminal-drop-transport-owner'
import { isWslShellOverride } from '../input/paste/terminal-paste-runtime'
import { recordTerminalUserInputForLeaf } from '../input/terminal-input-activity'
import type { PtyTransport } from '../pty-transport/pty-transport-types'

export type TerminalComposerWrite = { data: string; delayBeforeMs: number }

export type TerminalComposerSendRequest = {
  paneId: number
  leafId: string
  tabId: string
  /** The prompt body: file pills serialized as @path, image pills already removed. */
  body: string
  /** Workspace paths of the image attachments, in pill order. */
  imagePaths: readonly string[]
  /** The agent running in this pane, when one is detected. */
  agent: string | null
}

export type TerminalComposerSendResult = {
  sent: boolean
  reason?: 'pane-changed' | 'write-rejected' | 'pty-disconnected'
}

/** The bytes that carry a composed prompt into the pane's agent, in the order the agent reads them. */
export function buildTerminalComposerWrites({
  body,
  imagePaths,
  agent
}: {
  body: string
  imagePaths: readonly string[]
  agent: string | null
}): TerminalComposerWrite[] {
  const writes: TerminalComposerWrite[] = [{ data: AGENT_TUI_CLEAR_INPUT_MAX, delayBeforeMs: 0 }]
  const framed = agentImagePasteWrites(
    agent,
    imagePaths.map((path) => buildNativeChatImagePasteBytes(agentImagePastePath(agent, path))),
    body.length > 0
  )
  for (const data of framed) {
    writes.push({ data, delayBeforeMs: 0 })
  }
  writes.push({ data: buildNativeChatPasteBytes(body), delayBeforeMs: 0 })
  writes.push({ data: NATIVE_CHAT_SUBMIT, delayBeforeMs: NATIVE_CHAT_SUBMIT_DELAY_MS })
  return writes
}

/**
 * Write a composed prompt into the pane's terminal.
 *
 * The writes are the four the agent expects, in order: clear its input line, one
 * bracketed paste per image path, the body, and Enter on its own after a delay —
 * a CR sharing a paste write is swallowed and leaves the message unsent.
 */
export function useTerminalComposerSend({
  managerRef,
  paneTransportsRef
}: {
  /** The tab's pane manager; proves the pane is still mounted before a write. */
  managerRef: React.RefObject<PaneManager | null>
  /** The tab's live transports, keyed by pane id. */
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
}): {
  send: (request: TerminalComposerSendRequest) => Promise<TerminalComposerSendResult>
} {
  const send = useCallback(
    async (request: TerminalComposerSendRequest): Promise<TerminalComposerSendResult> => {
      const manager = managerRef.current
      if (!manager) {
        return { sent: false, reason: 'pane-changed' }
      }
      const paneTransports = paneTransportsRef.current
      const transport = paneTransports.get(request.paneId)
      if (!transport) {
        return { sent: false, reason: 'pty-disconnected' }
      }
      const target = captureTerminalDropTarget(
        { id: request.paneId, leafId: request.leafId },
        transport
      )
      // The upload path only enforces the host fence on its runtime branch, so the send
      // layer takes its own reading of the host and refuses the write when it moved.
      const owner = captureTerminalDropTransportOwner(transport)
      const writes = buildTerminalComposerWrites({
        body: request.body,
        imagePaths: request.imagePaths.map((path) => agentVisibleImagePath(transport, path)),
        agent: request.agent
      })
      let recorded = false
      for (const write of writes) {
        if (write.delayBeforeMs > 0) {
          await delay(write.delayBeforeMs)
        }
        const liveTransport = getCurrentTerminalDropTransport(
          manager,
          paneTransportsRef.current,
          target
        )
        if (!liveTransport) {
          return { sent: false, reason: 'pane-changed' }
        }
        try {
          owner?.assertCurrent()
        } catch {
          return { sent: false, reason: 'pane-changed' }
        }
        if (!liveTransport.sendInput(write.data, 'driving')) {
          return { sent: false, reason: 'write-rejected' }
        }
        if (!recorded) {
          // These bytes bypass xterm's input path, so hibernation must see them as user input.
          recordTerminalUserInputForLeaf(request.tabId, request.leafId)
          recorded = true
        }
      }
      return { sent: true }
    },
    [managerRef, paneTransportsRef]
  )
  return { send }
}

/** The path an agent in this pane can open; a WSL agent reads Linux paths, not the Windows spelling. */
function agentVisibleImagePath(transport: PtyTransport, path: string): string {
  const session = transport.getLocalSessionMetadata?.()
  const runsInWsl = isWslUncPath(session?.cwd ?? '') || isWslShellOverride(session?.shellOverride)
  return runsInWsl ? toLocalWslDropPath(path) : path
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
