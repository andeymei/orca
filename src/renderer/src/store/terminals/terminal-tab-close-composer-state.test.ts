import { describe, expect, it, vi } from 'vitest'
import { createTestStore, seedStore } from '../testing/app-store-test-fixture'
import { createStoreCascadesMockApi } from '../testing/app-store-cascade-api.test-fixture'
import { makeTab } from './terminal-tab.test-fixture'
import { makeWorktree } from '../slices/worktrees/worktree.test-fixture'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

createStoreCascadesMockApi()

describe('closing a terminal tab', () => {
  it('drops the composer draft and open flag its panes owned', () => {
    const store = createTestStore()
    const worktreeId = 'repo1::/path/wt1'
    const tabId = 'tab-1'
    const paneKey = `${tabId}:11111111-1111-4111-8111-111111111111`
    seedStore(store, {
      worktreesByRepo: {
        repo1: [makeWorktree({ id: worktreeId, repoId: 'repo1', path: '/path/wt1' })]
      },
      activeWorktreeId: worktreeId,
      tabsByWorktree: { [worktreeId]: [makeTab({ id: tabId, worktreeId })] }
    })
    store.getState().setTerminalComposerOpen(paneKey, true)
    store.getState().setTerminalComposerDraft(paneKey, {
      document: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }]
      },
      attachments: []
    })

    store.getState().closeTab(tabId)

    expect(store.getState().terminalComposerDraftByPaneKey[paneKey]).toBeUndefined()
    expect(store.getState().terminalComposerOpenByPaneKey[paneKey]).toBeUndefined()
  })
})
