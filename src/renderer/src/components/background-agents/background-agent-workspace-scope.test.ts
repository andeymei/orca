import { describe, expect, it } from 'vitest'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import {
  createBackgroundAgentScopeMatcher,
  deriveBackgroundAgentScopePaths
} from './background-agent-workspace-scope'

const WORKSPACE = makeWorktree({
  id: 'repo1::/repos/app',
  repoId: 'repo1',
  path: '/repos/app'
})
const SIBLING = makeWorktree({
  id: 'repo1::/repos/app-feature',
  repoId: 'repo1',
  path: '/repos/app-feature'
})

describe('deriveBackgroundAgentScopePaths', () => {
  it('names the directory the workspace owns', () => {
    expect(deriveBackgroundAgentScopePaths(WORKSPACE, [WORKSPACE])).toEqual(['/repos/app'])
  })

  it('keeps the directory a renamed workspace had', () => {
    const renamed = makeWorktree({
      id: 'repo1::/repos/app',
      repoId: 'repo1',
      path: '/repos/app',
      priorWorktreeIds: ['repo1::/repos/app-old']
    })
    expect(deriveBackgroundAgentScopePaths(renamed, [renamed])).toEqual([
      '/repos/app',
      '/repos/app-old'
    ])
  })

  it('leaves the sibling worktree of the same repo out', () => {
    // The workspace rule is not the project rule: the sibling belongs to the project, not to this
    // workspace. The project rule would answer ['/repos/app', '/repos/app-feature'].
    expect(deriveBackgroundAgentScopePaths(WORKSPACE, [WORKSPACE, SIBLING])).toEqual(['/repos/app'])
  })

  it('has nothing to scope when no workspace is open', () => {
    expect(deriveBackgroundAgentScopePaths(null, [WORKSPACE, SIBLING])).toEqual([])
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
    expect(inScope('/repos/app-feature')).toBe(false)
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
