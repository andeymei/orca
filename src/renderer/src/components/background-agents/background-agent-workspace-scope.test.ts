import { describe, expect, it, beforeEach } from 'vitest'
import { createTestStore } from '@/store/testing/app-store-test-fixture'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import {
  createBackgroundAgentScopeMatcher,
  resolveBackgroundAgentWorkspaceScope
} from './background-agent-workspace-scope'

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

  it('leaves the sibling worktree of the same repo out', () => {
    store.setState({
      repos: [TEST_REPO],
      worktreesByRepo: {
        repo1: [
          makeWorktree({ id: 'repo1::/repos/app', repoId: 'repo1', path: '/repos/app' }),
          makeWorktree({
            id: 'repo1::/repos/app-feature',
            repoId: 'repo1',
            path: '/repos/app-feature'
          })
        ]
      },
      activeWorktreeId: 'repo1::/repos/app',
      activeWorkspaceExecutionHostId: 'local'
    })
    const scope = resolveBackgroundAgentWorkspaceScope(store.getState())
    expect(scope.scopePaths).toEqual(['/repos/app'])
    expect(scope.scopePaths).not.toContain('/repos/app-feature')
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
  it('keeps an agent that ran in the workspace', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope('/repos/app')).toBe(true)
    expect(inScope('/repos/app/packages/web')).toBe(true)
  })

  it('drops an agent that ran elsewhere on the same host', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope('/repos/other')).toBe(false)
  })

  it('drops a sibling directory that only shares the workspace prefix', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope('/repos/app-old')).toBe(false)
  })

  it('claims nothing when the workspace has no directory', () => {
    const inScope = createBackgroundAgentScopeMatcher([])
    expect(inScope('/repos/app')).toBe(false)
  })

  it('claims nothing when an agent recorded no directory', () => {
    const inScope = createBackgroundAgentScopeMatcher(['/repos/app'])
    expect(inScope(null)).toBe(false)
    expect(inScope(undefined)).toBe(false)
  })
})
