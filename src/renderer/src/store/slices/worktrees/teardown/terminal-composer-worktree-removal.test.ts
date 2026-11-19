/** A removed worktree's tabs never reach closeTab, so their composer records would leak. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status/aggregation/worktree-agent-status'
import { createCompatibleRuntimeStatusResponseIfNeeded } from '../../../../runtime/rpc/testing/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCache as clearRuntimeCompatibilityCacheForTests } from '../../../../runtime/rpc/compatibility/runtime-compatibility-cache'
import { createTestStore, seedStore } from '../../../testing/app-store-test-fixture'
import { createStoreCascadesMockApi } from '../../../testing/app-store-cascade-api.test-fixture'
import { makeTab } from '../../../terminals/terminal-tab.test-fixture'
import { makeWorktree } from '../worktree.test-fixture'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@/components/terminal-pane/pty-transport/delivery/pty-dispatcher', () => ({}))

vi.mock('@/components/terminal-pane/pty-transport/shutdown/pty-shutdown-data-suspension', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))

vi.mock('@/lib/agent-status/aggregation/worktree-agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

const mockApi = createStoreCascadesMockApi()

const WT1 = 'repo1::/path/wt1'
const WT2 = 'repo1::/path/wt2'
const TAB1 = 'tab-wt1'
const TAB2 = 'tab-wt2'
const PANE1 = `${TAB1}:11111111-1111-4111-8111-111111111111`
const PANE2 = `${TAB2}:22222222-2222-4222-8222-222222222222`

describe('removing a worktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRuntimeCompatibilityCacheForTests()
    mockApi.worktrees.remove.mockResolvedValue(undefined)
    mockApi.runtimeEnvironments.call.mockReset()
    mockApi.runtimeEnvironments.call.mockImplementation((args: { method: string }) =>
      Promise.resolve(
        createCompatibleRuntimeStatusResponseIfNeeded(args) ?? {
          id: 'rpc-default',
          ok: true,
          result: {},
          _meta: { runtimeId: 'remote-runtime' }
        }
      )
    )
  })

  it('drops the removed worktree’s composer draft and open flag', async () => {
    const store = createTestStore()
    seedStore(store, {
      worktreesByRepo: {
        repo1: [
          makeWorktree({ id: WT1, repoId: 'repo1' }),
          makeWorktree({ id: WT2, repoId: 'repo1' })
        ]
      },
      tabsByWorktree: {
        [WT1]: [makeTab({ id: TAB1, worktreeId: WT1 })],
        [WT2]: [makeTab({ id: TAB2, worktreeId: WT2 })]
      },
      activeWorktreeId: WT1,
      activeTabId: TAB1
    })
    store.getState().setTerminalComposerOpen(PANE1, true)
    store.getState().setTerminalComposerDraft(PANE1, {
      document: { type: 'doc', content: [{ type: 'paragraph' }] },
      attachments: []
    })
    store.getState().setTerminalComposerOpen(PANE2, true)

    await store.getState().removeWorktree({ id: WT1, executionHostId: null })

    expect(store.getState().terminalComposerDraftByPaneKey[PANE1]).toBeUndefined()
    expect(store.getState().terminalComposerOpenByPaneKey[PANE1]).toBeUndefined()
    expect(store.getState().terminalComposerOpenByPaneKey[PANE2]).toBe(true)
  })
})
