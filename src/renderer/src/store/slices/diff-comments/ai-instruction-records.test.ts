import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../types'
import { createTestStore } from '../../testing/app-store-test-fixture'
import { selectDiffCommentView, type DiffCommentOwner } from './diff-comment-owner'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'

const updateMeta = vi.fn()
const recordFeatureInteraction = vi.fn()

vi.stubGlobal('window', {
  api: {
    worktrees: { updateMeta },
    ui: { set: vi.fn(), recordFeatureInteraction }
  }
})

const REPO = 'repo-1'
const WT = `${REPO}::/work/feature`

const repo: Repo = {
  id: REPO,
  path: '/work/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 0,
  executionHostId: 'local'
}

const worktree: Worktree = {
  id: WT,
  repoId: REPO,
  path: '/work/feature',
  head: 'abc',
  branch: 'refs/heads/feature',
  isBare: false,
  isMainWorktree: false,
  displayName: 'feature',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  hostId: 'local',
  diffComments: []
}

function createStore() {
  const store = createTestStore()
  store.setState({
    activeWorktreeId: WT,
    activeWorkspaceExecutionHostId: 'local',
    // Why: the telemetry path is closed until the persisted UI is ready, so the guard below needs it open.
    persistedUIReady: true,
    repos: [repo],
    worktreesByRepo: { [REPO]: [worktree] }
  })
  return store
}

function capturedOwner(store: { getState: () => AppState }): DiffCommentOwner {
  const { owner } = selectDiffCommentView(store.getState(), WT, 'selection')
  if (!owner) {
    throw new Error('No copy of the workspace is shown.')
  }
  return owner
}

beforeEach(() => {
  updateMeta.mockReset()
  updateMeta.mockResolvedValue({})
  recordFeatureInteraction.mockReset()
  recordFeatureInteraction.mockResolvedValue({
    featureInteractions: {},
    contextualToursSeenIds: []
  })
})

describe('AI instruction records', () => {
  it('stamps a dispatched AI instruction and keeps it', async () => {
    const store = createStore()
    const ok = await store
      .getState()
      .markAiInstructionsDispatched(capturedOwner(store), [
        { filePath: 'src/foo.ts', lineNumber: 42, body: '指数退避重试' }
      ])
    expect(ok).toBe(true)
    const records = store.getState().getAiInstructionComments(WT)
    expect(records).toHaveLength(1)
    expect(records[0].source).toBe('ai-instruction')
    expect(records[0].sentAt).toBeGreaterThan(0)
    expect(records[0].completedAt).toBeUndefined()
    // Why: an instruction record is not a review note, so it must not feed the review-notes telemetry.
    expect(recordFeatureInteraction).not.toHaveBeenCalled()
  })

  it('completes an AI instruction without deleting it', async () => {
    const store = createStore()
    const owner = capturedOwner(store)
    await store
      .getState()
      .markAiInstructionsDispatched(owner, [
        { filePath: 'src/foo.ts', lineNumber: 42, body: '指数退避重试' }
      ])
    const id = store.getState().getAiInstructionComments(WT)[0].id
    await store.getState().markAiInstructionsCompleted(owner, [id])
    const records = store.getState().getAiInstructionComments(WT)
    expect(records).toHaveLength(1)
    expect(records[0].completedAt).toBeGreaterThan(0)
    // Why: an instruction record is not a review note, so it must not feed the review-notes telemetry.
    expect(recordFeatureInteraction).not.toHaveBeenCalled()
  })

  it('clears the completion stamp when the instruction is dispatched again', async () => {
    const store = createStore()
    const owner = capturedOwner(store)
    await store
      .getState()
      .markAiInstructionsDispatched(owner, [
        { filePath: 'src/foo.ts', lineNumber: 42, body: '指数退避重试' }
      ])
    const id = store.getState().getAiInstructionComments(WT)[0].id
    await store.getState().markAiInstructionsCompleted(owner, [id])
    expect(store.getState().getAiInstructionComments(WT)[0].completedAt).toBeGreaterThan(0)
    await store
      .getState()
      .markAiInstructionsDispatched(owner, [
        { filePath: 'src/foo.ts', lineNumber: 42, body: '指数退避重试' }
      ])
    const records = store.getState().getAiInstructionComments(WT)
    expect(records).toHaveLength(1)
    expect(records[0].completedAt).toBeUndefined()
  })

  it('drops records whose instruction no longer exists in the file', async () => {
    const store = createStore()
    const owner = capturedOwner(store)
    await store
      .getState()
      .markAiInstructionsDispatched(owner, [
        { filePath: 'src/foo.ts', lineNumber: 42, body: '旧指令' }
      ])
    await store
      .getState()
      .markAiInstructionsDispatched(
        owner,
        [{ filePath: 'src/foo.ts', lineNumber: 42, body: '新指令' }],
        { currentInstructions: [{ lineNumber: 42, instruction: '新指令' }] }
      )
    const records = store.getState().getAiInstructionComments(WT)
    expect(records.map((r) => r.body)).toEqual(['新指令'])
  })

  it('keeps the records of other files when it drops the orphans of one file', async () => {
    const store = createStore()
    const owner = capturedOwner(store)
    await store
      .getState()
      .markAiInstructionsDispatched(owner, [
        { filePath: 'src/other.ts', lineNumber: 7, body: '别的指令' }
      ])
    await store
      .getState()
      .markAiInstructionsDispatched(
        owner,
        [{ filePath: 'src/foo.ts', lineNumber: 42, body: '新指令' }],
        { currentInstructions: [{ lineNumber: 42, instruction: '新指令' }] }
      )
    const records = store.getState().getAiInstructionComments(WT)
    expect(records.map((r) => r.body)).toEqual(['别的指令', '新指令'])
  })
})
