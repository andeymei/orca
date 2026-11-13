import { describe, expect, it, beforeEach } from 'vitest'
import { createTestStore } from '@/store/testing/app-store-test-fixture'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import {
  createBackgroundAgentScopeMatcher,
  resolveBackgroundAgentWorkspaceScope
} from './background-agent-workspace-scope'

function session(cwd: string): AiVaultSession {
  return {
    id: 'session-1',
    sessionId: 'session-1',
    executionHostId: 'local',
    agent: 'claude',
    title: 'a session',
    cwd,
    branch: null,
    model: null,
    filePath: '/transcripts/session-1.jsonl',
    codexHome: null,
    createdAt: '2026-11-12T09:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
    modifiedAt: '2026-11-12T10:00:00.000Z',
    messageCount: 12,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'claude --resume session-1',
    subagent: null
  }
}

let store: ReturnType<typeof createTestStore>

beforeEach(() => {
  store = createTestStore()
})

describe('resolveBackgroundAgentWorkspaceScope', () => {
  it('names the workspace the user is in and the directory it owns', () => {
    store.setState({
      repos: [TEST_REPO],
      worktreesByRepo: {
        repo1: [makeWorktree({ id: 'repo1::/repos/app', repoId: 'repo1', path: '/repos/app' })]
      },
      activeWorktreeId: 'repo1::/repos/app',
      activeWorkspaceExecutionHostId: 'local'
    })
    const scope = resolveBackgroundAgentWorkspaceScope(store.getState())
    expect(scope.workspaceId).toBe('repo1::/repos/app')
    expect(scope.scopePaths).toEqual(['/repos/app'])
  })

  it('keeps the directory a renamed workspace had', () => {
    store.setState({
      repos: [TEST_REPO],
      worktreesByRepo: {
        repo1: [
          makeWorktree({
            id: 'repo1::/repos/app',
            repoId: 'repo1',
            path: '/repos/app',
            priorWorktreeIds: ['repo1::/repos/app-old']
          })
        ]
      },
      activeWorktreeId: 'repo1::/repos/app',
      activeWorkspaceExecutionHostId: 'local'
    })
    const scope = resolveBackgroundAgentWorkspaceScope(store.getState())
    expect(scope.scopePaths).toEqual(['/repos/app', '/repos/app-old'])
  })

  it('has nothing to scope when no workspace is open', () => {
    store.setState({ activeWorktreeId: null })
    expect(resolveBackgroundAgentWorkspaceScope(store.getState())).toEqual({
      workspaceId: null,
      scopePaths: []
    })
  })
})

describe('createBackgroundAgentScopeMatcher', () => {
  it('keeps a session that ran in the workspace', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope(session('/repos/app'))).toBe(true)
    expect(inScope(session('/repos/app/packages/web'))).toBe(true)
  })

  it('drops a session that ran elsewhere on the same host', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope(session('/repos/other'))).toBe(false)
  })

  it('drops a sibling directory that only shares the workspace prefix', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope(session('/repos/app-old'))).toBe(false)
  })
})
