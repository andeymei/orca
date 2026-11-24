// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { OrchestrationWorkerApprovalEntry } from '../../../../../shared/orchestration/orchestration-crew'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

const stream = vi.hoisted(() => ({ emit: (_frame: unknown): void => {} }))
vi.mock('@/runtime/rpc/subscriptions/runtime-rpc-subscribe', () => ({
  subscribeRuntimeRpc: (
    _target: unknown,
    _method: string,
    _params: unknown,
    handlers: { onEvent: (frame: unknown) => void }
  ) => {
    stream.emit = handlers.onEvent
    return Promise.resolve({ unsubscribe: () => {} })
  }
}))

const feed = await import('./native-chat-worker-approval-feed')

afterEach(() => {
  vi.useRealTimers()
})

const PARTY = 'orca_session_id:chat'
const LOCAL: RuntimeClientTarget = { kind: 'local' }
function approval(
  approvalId: string,
  state: 'open' | 'answered',
  by?: 'person' | 'terminal-only'
): OrchestrationWorkerApprovalEntry {
  return {
    approval: {
      v: 1,
      approvalId,
      state,
      worker: { handle: 'term_w', dispatchId: 'ctx_1', taskId: 'task_1' },
      summary: { title: 'Allow Bash?', detail: null, reason: null },
      allowedActions: state === 'open' ? ['allow', 'deny'] : [],
      ...(by
        ? {
            outcome: {
              by,
              decision: by === 'person' ? 'allow' : null,
              reason: null,
              reasonDelivered: false
            }
          }
        : {})
    },
    at: '2026-11-11T20:00:00.000Z',
    worker: { partyKey: 'w', role: 'worker', label: 'w', agentKind: 'claude', status: 'blocked' }
  }
}
function send(...entries: OrchestrationWorkerApprovalEntry[]): void {
  act(() => {
    stream.emit({ type: 'begin' })
    for (const entry of entries) {
      stream.emit({ type: 'approval', entry })
    }
    stream.emit({ type: 'complete' })
  })
}

it('moves an answered prompt into the transcript at once, not after a pause above the composer', async () => {
  const pinned = renderHook(() => feed.useNativeChatPinnedWorkerApprovals(LOCAL, PARTY))
  const receipts = renderHook(() => feed.useNativeChatWorkerApprovalReceipts(LOCAL, PARTY))
  await act(async () => {})
  send(approval('apr_old', 'answered', 'person'), approval('apr_1', 'open'))
  expect(pinned.result.current.map((e) => e.approval.approvalId)).toEqual(['apr_1'])
  expect(receipts.result.current.map((e) => e.approval.approvalId)).toEqual(['apr_old'])

  // The host closes it: it goes to its transcript place at once.
  send(approval('apr_old', 'answered', 'person'), approval('apr_1', 'answered', 'person'))
  expect(pinned.result.current).toEqual([])
  expect(receipts.result.current.map((e) => e.approval.approvalId)).toEqual(['apr_old', 'apr_1'])

  // The same list again: the receipts keep their identity.
  const settled = receipts.result.current
  send(approval('apr_old', 'answered', 'person'), approval('apr_1', 'answered', 'person'))
  expect(receipts.result.current).toBe(settled)
})

it('keeps a prompt only the worker terminal can answer pinned', async () => {
  vi.useFakeTimers()
  const pinned = renderHook(() =>
    feed.useNativeChatPinnedWorkerApprovals(LOCAL, 'orca_session_id:other')
  )
  await act(async () => {})
  send(approval('apr_t', 'answered', 'terminal-only'))
  act(() => vi.advanceTimersByTime(60_000))
  expect(pinned.result.current.map((e) => e.approval.approvalId)).toEqual(['apr_t'])
})
