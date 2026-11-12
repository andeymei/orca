import { describe, expect, it } from 'vitest'
import {
  backgroundAgentTerminalRows,
  type BackgroundAgentTerminalTab
} from './background-agent-terminal-rows'

function tab(
  overrides: Partial<BackgroundAgentTerminalTab> & { tabId: string }
): BackgroundAgentTerminalTab {
  return {
    worktreeId: 'wt-1',
    title: '',
    ...overrides
  }
}

describe('backgroundAgentTerminalRows', () => {
  it('lists a terminal whose title names an agent', () => {
    const rows = backgroundAgentTerminalRows(
      [
        tab({ tabId: 'tab-1', title: '⠂ Claude Code' }),
        tab({ tabId: 'tab-2', title: '✳ Claude Code' })
      ],
      null
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      tabId: 'tab-1',
      agent: 'claude',
      workspaceId: 'wt-1',
      state: 'working'
    })
    expect(rows[1]).toMatchObject({ tabId: 'tab-2', state: 'idle' })
  })

  it('ignores a terminal that runs no agent', () => {
    const rows = backgroundAgentTerminalRows([tab({ tabId: 'tab-1', title: 'zsh' })], null)
    expect(rows).toHaveLength(0)
  })

  it('leaves out the tab that is on screen', () => {
    const rows = backgroundAgentTerminalRows(
      [tab({ tabId: 'tab-1', title: '⠂ Claude Code' })],
      'tab-1'
    )
    expect(rows).toHaveLength(0)
  })

  it('keeps the workspace and host of the tab it came from', () => {
    const rows = backgroundAgentTerminalRows(
      [
        tab({
          tabId: 'tab-1',
          title: '⠂ Claude Code',
          worktreeId: 'wt-2',
          executionHostId: 'ssh:host-1'
        })
      ],
      null
    )
    expect(rows[0]).toMatchObject({ workspaceId: 'wt-2', executionHostId: 'ssh:host-1' })
  })
})
