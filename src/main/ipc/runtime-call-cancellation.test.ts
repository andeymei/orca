import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  onMock,
  removeAllListenersMock,
  removeHandlerMock,
  fromWebContentsMock,
  dispatchMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onMock: vi.fn(),
  removeAllListenersMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  fromWebContentsMock: vi.fn(),
  dispatchMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock
  },
  ipcMain: {
    handle: handleMock,
    on: onMock,
    removeAllListeners: removeAllListenersMock,
    removeHandler: removeHandlerMock
  }
}))

vi.mock('../runtime/rpc/dispatcher', () => ({
  RpcDispatcher: class {
    dispatch(request: unknown, options: unknown): Promise<unknown> {
      return dispatchMock(request, options)
    }
  }
}))

import { registerRuntimeHandlers } from './runtime'

/** The options the dispatcher was called with. */
function dispatchOptions(): { signal?: AbortSignal } {
  return dispatchMock.mock.calls[0][1]
}

function senderWith(id: number): { mainFrame: object; id: number; once: unknown; on: unknown } {
  const frame = {}
  return { mainFrame: frame, id, once: vi.fn(), on: vi.fn() }
}

describe('the runtime call cancellation', () => {
  beforeEach(() => {
    handleMock.mockReset()
    onMock.mockReset()
    removeAllListenersMock.mockReset()
    removeHandlerMock.mockReset()
    fromWebContentsMock.mockReset()
    dispatchMock.mockReset()
    // Why: the call waits for the signal, so the test can watch the abort reach it.
    dispatchMock.mockImplementation(
      (_request: unknown, options: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          const finish = (): void => {
            resolve({ id: 'rpc-1', ok: false })
          }
          options.signal?.addEventListener('abort', finish)
          setTimeout(finish, 50)
        })
    )
  })

  it('stops the call when the window cancels it', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only the runtime id.
    registerRuntimeHandlers({ getRuntimeId: () => 'runtime-1' } as never)
    const registration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
    const sender = senderWith(7)

    const pending = registration![1](
      { senderFrame: sender.mainFrame, sender },
      { method: 'codeCompletion.plan', params: {}, requestId: 'request-1' }
    )
    const cancel = onMock.mock.calls.find(([channel]) => channel === 'runtime:cancelCall')
    cancel![1]({ sender }, { requestId: 'request-1' })

    const options = dispatchOptions()
    expect(options.signal?.aborted).toBe(true)
    await pending
  })

  it('does not let one window cancel another window’s call', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only the runtime id.
    registerRuntimeHandlers({ getRuntimeId: () => 'runtime-1' } as never)
    const registration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
    const first = senderWith(7)
    const second = senderWith(8)

    const pending = registration![1](
      { senderFrame: first.mainFrame, sender: first },
      { method: 'codeCompletion.plan', params: {}, requestId: 'request-1' }
    )
    const cancel = onMock.mock.calls.find(([channel]) => channel === 'runtime:cancelCall')
    cancel![1]({ sender: second }, { requestId: 'request-1' })

    const options = dispatchOptions()
    expect(options.signal?.aborted).toBe(false)
    await pending
  })
})
