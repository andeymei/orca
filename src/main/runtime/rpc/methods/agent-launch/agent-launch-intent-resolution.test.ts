// A caller that launches an agent and then sends it a prompt reuses the terminal it was given.
// The agent is still starting then, so the reuse waits for it instead of dropping the prompt.
import { describe, expect, it } from 'vitest'
import type { AgentLaunchIntent } from '../../../../../shared/agent-launch/contracts/agent-launch-intent'
import {
  REUSED_TERMINAL_AGENT_READY_TIMEOUT_MS,
  validateReusedTerminal,
  type ReusedTerminalReadinessClock,
  type ReusedTerminalRuntime
} from './agent-launch-intent-resolution'

const intent: AgentLaunchIntent = {
  agent: 'claude',
  target: { kind: 'existing', worktree: 'repo-1::/repo/app' },
  reuseTerminal: { handle: 'term-1' }
}

/** A clock the test runs by hand: the wait never sleeps for real. */
function testClock(): ReusedTerminalReadinessClock & { sleeps: number } {
  let now = 0
  const clock = {
    sleeps: 0,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
      clock.sleeps += 1
    }
  }
  return clock
}

/** A terminal whose agent proves itself on the check after `startsAfter`; never when negative. */
function runtime(startsAfter: number): ReusedTerminalRuntime & { checks: number } {
  let checks = 0
  const terminal = {
    get checks() {
      return checks
    },
    showTerminal: async () => ({ worktreeId: 'repo-1::/repo/app' }),
    isTerminalRunningAgent: async () => {
      checks += 1
      return startsAfter >= 0 && checks > startsAfter
    }
  }
  return terminal
}

describe('a reused terminal', () => {
  it('waits for an agent that is still starting', async () => {
    const clock = testClock()
    const terminal = runtime(2)
    // The agent proves itself on the third check: the reuse must not refuse before that.
    await validateReusedTerminal(intent, terminal, undefined, clock)
    expect(clock.sleeps).toBe(2)
    expect(terminal.checks).toBe(3)
  })

  it('refuses a terminal that never runs the agent', async () => {
    const clock = testClock()
    await expect(validateReusedTerminal(intent, runtime(-1), undefined, clock)).rejects.toThrow(
      'agent_launch_terminal_not_running_agent'
    )
    expect(clock.now()).toBeGreaterThanOrEqual(REUSED_TERMINAL_AGENT_READY_TIMEOUT_MS)
  })

  it('refuses a terminal that belongs to another workspace', async () => {
    const other: ReusedTerminalRuntime = {
      showTerminal: async () => ({ worktreeId: 'repo-2::/repo/other' }),
      isTerminalRunningAgent: async () => true
    }
    await expect(validateReusedTerminal(intent, other, undefined, testClock())).rejects.toThrow(
      'agent_launch_terminal_worktree_mismatch'
    )
  })

  it('ends the wait when the caller gives up', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      validateReusedTerminal(intent, runtime(-1), controller.signal, testClock())
    ).rejects.toThrow('agent_launch_terminal_not_running_agent')
  })
})
