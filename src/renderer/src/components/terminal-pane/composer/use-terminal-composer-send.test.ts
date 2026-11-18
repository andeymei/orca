// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_TUI_CLEAR_INPUT_MAX } from '../../../../../shared/agent-launch/startup/agent-tui-input-clear'
import {
  NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS,
  NATIVE_CHAT_SUBMIT_DELAY_MS
} from '../../../../../shared/native-chat/input/native-chat-answer-stepping'
import {
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from '../../../../../shared/native-chat/input/native-chat-paste-bytes'
import { wrapTerminalBracketedPasteText } from '../../../../../shared/terminal/input/terminal-bracketed-paste-text'
import { buildTerminalComposerWrites, useTerminalComposerSend } from './use-terminal-composer-send'

vi.mock('@/store/index', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({}),
    // An SSH host with no connection state cannot be verified, which is what the send
    // layer has to survive.
    { getState: () => ({ sshConnectionStates: new Map() }) }
  )
}))

const PANE_ID = 1
const LEAF_ID = 'leaf-1'
const WSL_WORKSPACE = '\\\\wsl.localhost\\Ubuntu\\home\\me\\ws'

describe('terminal composer writes', () => {
  it('clears the agent input, writes the image path, the body, then Enter last', () => {
    const writes = buildTerminalComposerWrites({
      body: 'look at this',
      imagePaths: ['/ws/.orca/drops/shot.png'],
      agent: 'claude'
    })
    expect(writes[0].data).toBe(AGENT_TUI_CLEAR_INPUT_MAX)
    // The last image paste takes a space so the body does not merge into the chip.
    expect(writes[1].data).toBe(`${wrapTerminalBracketedPasteText('/ws/.orca/drops/shot.png')} `)
    expect(writes[2].data).toBe(buildNativeChatPasteBytes('look at this'))
    // The chip is created asynchronously; the body waits for it.
    expect(writes[2].delayBeforeMs).toBe(NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS)
    expect(writes[3].data).toBe(NATIVE_CHAT_SUBMIT)
    expect(writes[3].delayBeforeMs).toBe(NATIVE_CHAT_SUBMIT_DELAY_MS)
  })

  it('gives an agent without attachment support an @path reference', () => {
    const writes = buildTerminalComposerWrites({
      body: '',
      imagePaths: ['/ws/.orca/drops/shot.png'],
      agent: 'some-shell'
    })
    expect(writes[1].data).toContain('@/ws/.orca/drops/shot.png')
  })

  it('quotes a file reference whose path needs it', () => {
    const writes = buildTerminalComposerWrites({
      body: '',
      imagePaths: ['/ws/.orca/drops/my shot.png'],
      agent: 'some-shell'
    })
    expect(writes[1].data).toContain('@"/ws/.orca/drops/my shot.png"')
  })

  it('gives each image its own paste, in pill order', () => {
    const writes = buildTerminalComposerWrites({
      body: 'two',
      imagePaths: ['/ws/.orca/drops/a.png', '/ws/.orca/drops/b.png'],
      agent: 'claude'
    })
    expect(writes[1].data).toBe(wrapTerminalBracketedPasteText('/ws/.orca/drops/a.png'))
    expect(writes[2].data).toBe(`${wrapTerminalBracketedPasteText('/ws/.orca/drops/b.png')} `)
  })

  it('writes Enter separately even with no attachments', () => {
    const writes = buildTerminalComposerWrites({ body: 'hello', imagePaths: [], agent: 'claude' })
    expect(writes.map((w) => w.data)).toEqual([
      AGENT_TUI_CLEAR_INPUT_MAX,
      buildNativeChatPasteBytes('hello'),
      NATIVE_CHAT_SUBMIT
    ])
  })

  it('writes no body when there is only whitespace to send', () => {
    const writes = buildTerminalComposerWrites({ body: '   ', imagePaths: [], agent: 'claude' })
    expect(writes.map((w) => w.data)).toEqual([AGENT_TUI_CLEAR_INPUT_MAX, NATIVE_CHAT_SUBMIT])
  })

  it('clears the terminal input line even when no agent was detected', () => {
    const writes = buildTerminalComposerWrites({ body: 'hello', imagePaths: [], agent: null })
    expect(writes.map((w) => w.data)).toEqual([
      AGENT_TUI_CLEAR_INPUT_MAX,
      buildNativeChatPasteBytes('hello'),
      NATIVE_CHAT_SUBMIT
    ])
  })
})

type HarnessOptions = {
  sendInput?: (data: string, inputKind: string) => boolean
  executionHostId?: () => string | null
  localSessionMetadata?: () => { cwd?: string; shellOverride?: string } | null
  withTransport?: boolean
  withManager?: boolean
}

function createHarness(options: HarnessOptions = {}) {
  const sendInput = vi.fn(options.sendInput ?? (() => true))
  const pane = { id: PANE_ID, leafId: LEAF_ID }
  const panes = [pane]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake answers only the pane queries the send layer makes.
  const manager = { getPanes: () => panes } as never
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake answers only the transport queries the send layer makes.
  const transport = {
    sendInput,
    getPtyId: () => 'pty-1',
    isConnected: () => true,
    getExecutionHostId: options.executionHostId ?? (() => 'local'),
    getRuntimeEnvironmentId: () => null,
    getLocalSessionMetadata: options.localSessionMetadata ?? (() => ({ cwd: '/ws' }))
  } as never
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fake map holds the one transport the send layer looks up.
  const paneTransports = new Map(
    options.withTransport === false ? [] : [[PANE_ID, transport]]
  ) as never
  const managerRef = { current: options.withManager === false ? null : manager }
  const paneTransportsRef = { current: paneTransports }
  const hook = renderHook(() => useTerminalComposerSend({ managerRef, paneTransportsRef }))
  return {
    hook,
    panes,
    sendInput,
    send: (request: Parameters<typeof hook.result.current.send>[0]) =>
      hook.result.current.send(request)
  }
}

const REQUEST = {
  paneId: PANE_ID,
  leafId: LEAF_ID,
  tabId: 'tab-1',
  body: 'look at this',
  imagePaths: [],
  agent: 'claude'
}

describe('terminal composer send', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('writes the clear, the body and the Enter as driving input', async () => {
    const harness = createHarness()
    const pending = harness.send(REQUEST)
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_DELAY_MS)

    expect(await pending).toEqual({ sent: true })
    expect(harness.sendInput.mock.calls).toEqual([
      [AGENT_TUI_CLEAR_INPUT_MAX, 'driving'],
      [buildNativeChatPasteBytes('look at this'), 'driving'],
      [NATIVE_CHAT_SUBMIT, 'driving']
    ])
  })

  it('refuses to write when the pane is no longer mounted', async () => {
    const harness = createHarness()
    harness.panes.length = 0

    expect(await harness.send(REQUEST)).toEqual({ sent: false, reason: 'pane-changed' })
    expect(harness.sendInput).not.toHaveBeenCalled()
  })

  it('refuses to write when the pane manager is gone', async () => {
    const harness = createHarness({ withManager: false })

    expect(await harness.send(REQUEST)).toEqual({ sent: false, reason: 'pane-changed' })
    expect(harness.sendInput).not.toHaveBeenCalled()
  })

  it('refuses to write when the host changed under the send', async () => {
    const executionHostId = vi.fn().mockReturnValueOnce('local').mockReturnValue('ssh:other')
    const harness = createHarness({ executionHostId })

    expect(await harness.send(REQUEST)).toEqual({ sent: false, reason: 'host-changed' })
    expect(harness.sendInput).not.toHaveBeenCalled()
  })

  it('refuses to write when the host cannot be verified', async () => {
    // The SSH connection generation is gone, so the write cannot be proven to reach the
    // host that owns this pane.
    const harness = createHarness({ executionHostId: () => 'ssh:other' })

    expect(await harness.send(REQUEST)).toEqual({ sent: false, reason: 'host-changed' })
    expect(harness.sendInput).not.toHaveBeenCalled()
  })

  it('reports a terminal that is no longer connected', async () => {
    const harness = createHarness({ withTransport: false })

    expect(await harness.send(REQUEST)).toEqual({ sent: false, reason: 'pty-disconnected' })
    expect(harness.sendInput).not.toHaveBeenCalled()
  })

  it('stops at a write the terminal rejects', async () => {
    const harness = createHarness({ sendInput: () => false })

    expect(await harness.send(REQUEST)).toEqual({ sent: false, reason: 'write-rejected' })
    expect(harness.sendInput).toHaveBeenCalledTimes(1)
  })

  it('writes the Linux path a WSL agent can read', async () => {
    const harness = createHarness({
      localSessionMetadata: () => ({ cwd: WSL_WORKSPACE })
    })

    const pending = harness.send({
      ...REQUEST,
      body: '',
      imagePaths: [`${WSL_WORKSPACE}\\.orca\\drops\\shot.png`]
    })
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_DELAY_MS)
    await pending

    expect(harness.sendInput.mock.calls[1][0]).toBe(
      wrapTerminalBracketedPasteText('/home/me/ws/.orca/drops/shot.png')
    )
  })

  it('keeps the Windows path for a session that is not in WSL', async () => {
    const harness = createHarness({
      localSessionMetadata: () => ({ cwd: 'C:\\ws' })
    })

    const pending = harness.send({
      ...REQUEST,
      body: '',
      imagePaths: ['C:\\ws\\.orca\\drops\\shot.png']
    })
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_DELAY_MS)
    await pending

    expect(harness.sendInput.mock.calls[1][0]).toBe(
      wrapTerminalBracketedPasteText('C:\\ws\\.orca\\drops\\shot.png')
    )
  })
})
