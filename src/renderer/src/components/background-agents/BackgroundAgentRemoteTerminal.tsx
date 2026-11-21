import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { extractIpcErrorMessage } from '@/runtime/errors/ipc-error'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import {
  closeRemoteBackgroundAgentTerminal,
  createRemoteBackgroundAgentTerminal
} from './claude-background-agent-remote-terminal'
import { claimAgentTerminalBackKey } from './background-agent-terminal-back-key'

/**
 * One agent's own terminal on a paired host, shown in place.
 *
 * The agent runs on that host, so its terminal does too: the panel asks the host for a terminal
 * running `claude attach` and previews it here, the same way it shows a local agent's terminal.
 */
export function BackgroundAgentRemoteTerminal({
  agentId,
  cwd,
  onBack
}: {
  agentId: string
  cwd: string | null
  onBack: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const onBackRef = useRef(onBack)
  const attachFailedMessage = t(
    'auto.components.backgroundAgents.attachFailed',
    "The agent's terminal could not be opened"
  )
  const attachFailedRef = useRef(attachFailedMessage)
  const [ptyId, setPtyId] = useState<string | null>(null)
  useEffect(() => {
    onBackRef.current = onBack
    attachFailedRef.current = attachFailedMessage
  }, [onBack, attachFailedMessage])

  useEffect(() => {
    let disposed = false
    let handle: string | null = null
    // Why the store: the workspace the user opened the agent from is the one that owns it.
    const state = useAppStore.getState()
    const host = parseExecutionHostId(state.activeWorkspaceExecutionHostId)
    const environmentId = host?.kind === 'runtime' ? host.environmentId : null
    if (!environmentId) {
      return
    }
    const open = async (): Promise<void> => {
      try {
        const terminal = await createRemoteBackgroundAgentTerminal({
          environmentId,
          agentId,
          cwd
        })
        if (disposed) {
          // Why: a screen that was replaced must not leave its terminal on the host.
          await closeRemoteBackgroundAgentTerminal({
            environmentId,
            handle: terminal.handle
          }).catch(() => {})
          return
        }
        handle = terminal.handle
        setPtyId(terminal.ptyId)
      } catch (error) {
        if (!disposed) {
          toast.error(extractIpcErrorMessage(error, attachFailedRef.current))
          onBackRef.current()
        }
      }
    }
    void open()
    return () => {
      disposed = true
      if (handle) {
        // Why: leaving the screen closes the attach client; the agent keeps running.
        void closeRemoteBackgroundAgentTerminal({ environmentId, handle }).catch(() => {})
      }
    }
  }, [agentId, cwd])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="background-agent-remote-terminal"
    >
      {ptyId ? (
        <AgentTerminalPreview
          ptyId={ptyId}
          className="h-full"
          // Why: the agent's own TUI reads the left arrow as "back", so Orca claims it.
          claimKeyEvent={(event) => claimAgentTerminalBackKey(event, () => onBackRef.current())}
        />
      ) : null}
    </div>
  )
}

export default BackgroundAgentRemoteTerminal
