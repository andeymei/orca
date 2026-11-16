import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDispatchArgs
} from '../../../shared/claude-background-agents'
import { buildClaudeBackgroundAgentListResult, registerClaudeAgentsHandlers } from './claude-agents'

const ipcHandlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, listener)
    }
  }
}))

const cli = vi.hoisted(() => ({
  listAgents: vi.fn(async () => [{ id: 'aaaa1111', sessionId: 's', name: 'n', cwd: '/w' }]),
  readJobState: vi.fn(async () => null),
  dispatch: vi.fn(async () => ({ ok: true, id: 'aaaa1111' })),
  stop: vi.fn(async () => ({ ok: true, id: 'aaaa1111' })),
  remove: vi.fn(async () => ({ ok: true, id: 'aaaa1111' }))
}))

vi.mock('../../claude/background-agents/claude-background-agent-list', () => ({
  listClaudeBackgroundAgentsOrNull: cli.listAgents
}))
vi.mock('../../claude/background-agents/claude-background-agent-job-state', () => ({
  readClaudeBackgroundAgentJobState: cli.readJobState
}))
vi.mock('../../claude/background-agents/claude-background-agent-commands', () => ({
  dispatchClaudeBackgroundAgent: cli.dispatch,
  stopClaudeBackgroundAgent: cli.stop,
  removeClaudeBackgroundAgent: cli.remove
}))

describe('buildClaudeBackgroundAgentListResult', () => {
  it('pairs each agent with its own detail', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => [{ id: '4db4f587', sessionId: 's', name: 'a', cwd: '/w' }],
      async (id) => ({ detail: `working on ${id}`, needs: null, updatedAt: 1 })
    )
    expect(result.status).toBe('ready')
    expect(Object.keys(result.details)).toEqual(['4db4f587'])
    expect(result.details['4db4f587'].detail).toBe('working on 4db4f587')
  })

  it('says so when this machine has no Claude Code CLI', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => null,
      async () => ({ detail: null, needs: null, updatedAt: null })
    )
    expect(result.status).toBe('unsupported')
  })

  it('keeps the agents whose detail file cannot be read', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => [{ id: '4db4f587', sessionId: 's', name: 'a', cwd: '/w' }],
      async () => null
    )
    expect(result.status).toBe('ready')
    expect(result.agents).toHaveLength(1)
    expect(result.details['4db4f587']).toBeUndefined()
  })

  it('reports a listing that failed instead of an empty one', async () => {
    const result = await buildClaudeBackgroundAgentListResult(
      async () => {
        throw new Error('the CLI timed out')
      },
      async () => null
    )
    expect(result.status).toBe('error')
    expect(result.message).toBe('the CLI timed out')
    expect(result.agents).toEqual([])
  })
})

describe('registerClaudeAgentsHandlers', () => {
  beforeAll(() => {
    registerClaudeAgentsHandlers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the agents of this machine', async () => {
    await expect(handlerFor('claudeAgents:list')({})).resolves.toEqual({
      status: 'ready',
      agents: [{ id: 'aaaa1111', sessionId: 's', name: 'n', cwd: '/w' }],
      details: {},
      message: null
    })
  })

  it('answers a readDetails call that carries no list with an empty map', async () => {
    await expect(handlerFor('claudeAgents:readDetails')({}, 'not a list')).resolves.toEqual({})
    expect(cli.readJobState).not.toHaveBeenCalled()
  })

  it('refuses a dispatch without a prompt', async () => {
    await expect(handlerFor('claudeAgents:dispatch')({}, {})).resolves.toEqual({
      ok: false,
      message: 'the dispatch needs a prompt'
    })
    expect(cli.dispatch).not.toHaveBeenCalled()
  })

  it('dispatches the prompt the renderer sent', async () => {
    await expect(
      handlerFor('claudeAgents:dispatch')({}, { prompt: 'do the thing' })
    ).resolves.toEqual({ ok: true, id: 'aaaa1111' })
    expect(cli.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'do the thing' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('refuses a stop without an agent id', async () => {
    await expect(handlerFor('claudeAgents:stop')({}, {})).resolves.toEqual({
      ok: false,
      message: 'the command needs an agent id'
    })
    expect(cli.stop).not.toHaveBeenCalled()
  })

  it('refuses a remove without an agent id', async () => {
    await expect(handlerFor('claudeAgents:remove')({}, 'not an object')).resolves.toEqual({
      ok: false,
      message: 'the command needs an agent id'
    })
    expect(cli.remove).not.toHaveBeenCalled()
  })
})

describe('the dispatch that is still opening', () => {
  beforeEach(() => {
    registerClaudeAgentsHandlers()
  })

  it('aborts the dispatch that is still opening', async () => {
    const seen: { signal?: AbortSignal } = {}
    registerClaudeAgentsHandlers({
      dispatch: (
        _args: ClaudeBackgroundAgentDispatchArgs,
        dependencies?: { signal?: AbortSignal }
      ) =>
        new Promise<ClaudeBackgroundAgentCommandResult>((resolve) => {
          seen.signal = dependencies?.signal
          dependencies?.signal?.addEventListener('abort', () => {
            resolve({ ok: false, message: 'the dispatch was cancelled' })
          })
        })
    })
    const dispatch = handlerFor('claudeAgents:dispatch')({}, { prompt: 'do the thing' })
    await handlerFor('claudeAgents:cancelDispatch')({})
    expect(seen.signal?.aborted).toBe(true)
    await dispatch
  })

  it('does nothing when no dispatch is opening', async () => {
    await expect(handlerFor('claudeAgents:cancelDispatch')({})).resolves.toBeUndefined()
  })
})

function handlerFor(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const handler = ipcHandlers.get(channel)
  if (!handler) {
    throw new Error(`no handler is registered for ${channel}`)
  }
  return handler
}
