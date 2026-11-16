import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { formatBackgroundAgentElapsed } from './background-agent-list-rows'
import { BackgroundAgentTerminal } from './background-agent-terminal'
import { useBackgroundAgentRosterRefresh } from './use-background-agent-roster-refresh'

/** How often the elapsed column is recomputed. */
const ELAPSED_TICK_INTERVAL_MS = 1000

/**
 * One agent's detail screen: what the agent is, and the agent's own terminal.
 *
 * The header reads the roster, so it follows the agent while the user talks to it. The terminal
 * below is the agent's own Claude Code session, attached in place.
 */
export function BackgroundAgentAgentScreen({ agentId }: { agentId: string }): React.JSX.Element {
  const t = useTranslate()
  const agent = useAppStore((state) => state.backgroundAgentsAgents.find((a) => a.id === agentId))
  const closeBackgroundAgent = useAppStore((state) => state.closeBackgroundAgent)
  const [now, setNow] = useState(() => Date.now())
  // Why: a finished agent leaves the roster, and the header still has to say which one it was.
  const identity = useRef({ name: '', cwd: '' })

  // Why: the agent's own state lives in the roster, so the header needs the slow poll too.
  useBackgroundAgentRosterRefresh()

  useEffect(() => {
    // Why: the elapsed column has no reader while the window is hidden.
    return installWindowVisibilityInterval({
      run: () => setNow(Date.now()),
      intervalMs: ELAPSED_TICK_INTERVAL_MS
    })
  }, [])

  useEffect(() => {
    if (agent) {
      identity.current = { name: agent.name, cwd: agent.cwd }
    }
  }, [agent])

  const name = agent?.name || identity.current.name
  const cwd = agent?.cwd || identity.current.cwd
  const elapsed = agent?.startedAt ? formatBackgroundAgentElapsed(now - agent.startedAt) : null

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="background-agents-agent"
    >
      <header className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          aria-label={t('auto.components.backgroundAgents.back', 'Back to the agent list')}
          onClick={closeBackgroundAgent}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{name}</span>
        {agent?.state ? (
          <span className="shrink-0 text-2xs text-muted-foreground">{agent.state}</span>
        ) : null}
        {cwd ? (
          <span className="min-w-0 shrink truncate text-2xs text-muted-foreground">{cwd}</span>
        ) : null}
        {elapsed ? (
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{elapsed}</span>
        ) : null}
      </header>
      <BackgroundAgentTerminal agentId={agentId} cwd={cwd || null} onBack={closeBackgroundAgent} />
    </div>
  )
}

export default BackgroundAgentAgentScreen
