import { beforeEach, describe, expect, it } from 'vitest'
import { isRecord } from '../../../shared/claude-background-agents'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  listRemoteClaudeBackgroundAgents,
  readRemoteClaudeBackgroundAgentDetails,
  resetRemoteClaudeBackgroundAgentCachesForTests
} from './claude-background-agent-remote-list'

const USER_DATA = '/tmp/orca-user-data'
const ENVIRONMENT_ID = 'env-remote'
const HOME = 'C:\\Users\\andey'
const JOBS_DIR = `${HOME}\\.claude\\jobs`
const WORKTREE = 'repo::D:\\ctjt\\code\\ctjt-service'

const BACKGROUND_JOB = 'aaaa1111'
const INTERACTIVE_JOB = 'bbbb2222'
const EMPTY_JOB = 'cccc3333'
const FAILING_READ_JOB = 'dddd4444'
const UNKNOWN_STATE_JOB = 'eeee5555'
const UPPERCASE_JOB = 'ABCDEF12'

const BACKGROUND_STATE = {
  template: 'bg',
  state: 'done',
  detail: 'fixed the failing test',
  name: 'agent alpha',
  cwd: 'D:\\ctjt\\code\\ctjt-platform\\ctjt-service',
  sessionId: 'session-alpha',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:05:30.000Z'
}

const INTERACTIVE_STATE = {
  template: 'claude',
  state: 'working',
  sessionId: 'session-interactive',
  cwd: 'D:\\ctjt\\code\\ctjt-platform\\ctjt-service',
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:10:00.000Z'
}

const UNKNOWN_STATE = {
  template: 'bg',
  state: 'archived',
  sessionId: 'session-unknown',
  cwd: 'D:\\ctjt\\code\\ctjt-platform\\ctjt-service',
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: 'not a timestamp'
}

type RemoteFixture = {
  /** State file paths the host would agree to read, and what they contain. */
  stateFiles: Map<string, unknown>
  /** Reads the host answers with an error even though the grant resolved. */
  failingReads: Set<string>
  calls: { method: string; params: unknown }[]
  /** The worktree selector each file call carried; pinned so the sent form cannot drift. */
  worktreeSelectors: { method: string; worktree: string | null }[]
}

function okResult(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'test', ok: true, result, _meta: { runtimeId: 'remote-runtime' } }
}

function failureResult(message: string): RuntimeRpcResponse<unknown> {
  return { id: 'test', ok: false, error: { code: 'internal_error', message } }
}

function readStringField(params: unknown, field: string): string | null {
  if (!isRecord(params)) {
    return null
  }
  const value = params[field]
  return typeof value === 'string' ? value : null
}

function createHostCalls(fixture: RemoteFixture, options: { jobsMissing?: boolean } = {}) {
  return async (
    _userDataPath: string,
    _environmentId: string,
    method: string,
    params: unknown
  ): Promise<RuntimeRpcResponse<unknown>> => {
    fixture.calls.push({ method, params })
    if (method === 'files.resolveTerminalPath' || method === 'files.readTerminalArtifact') {
      fixture.worktreeSelectors.push({
        method,
        worktree: readStringField(params, 'worktree')
      })
    }
    if (method === 'files.browseServerDir') {
      const path = readStringField(params, 'path')
      if (path === '~') {
        return okResult({
          resolvedPath: HOME,
          pathFlavor: 'win32',
          entries: [{ name: '.claude', isDirectory: true, isSymlink: false }]
        })
      }
      if (path === JOBS_DIR) {
        if (options.jobsMissing) {
          return failureResult(`ENOENT: no such file or directory, stat '${JOBS_DIR}'`)
        }
        return okResult({
          resolvedPath: JOBS_DIR,
          pathFlavor: 'win32',
          entries: [
            { name: BACKGROUND_JOB, isDirectory: true, isSymlink: false },
            { name: INTERACTIVE_JOB, isDirectory: true, isSymlink: false },
            { name: EMPTY_JOB, isDirectory: true, isSymlink: false },
            { name: FAILING_READ_JOB, isDirectory: true, isSymlink: false },
            { name: UNKNOWN_STATE_JOB, isDirectory: true, isSymlink: false },
            { name: UPPERCASE_JOB, isDirectory: true, isSymlink: false },
            { name: 'not-hex', isDirectory: true, isSymlink: false },
            { name: 'pins.json', isDirectory: false, isSymlink: false }
          ]
        })
      }
      return failureResult(`unexpected browse of ${path}`)
    }
    if (method === 'files.resolveTerminalPath') {
      const pathText = readStringField(params, 'pathText') ?? ''
      if (!fixture.stateFiles.has(pathText)) {
        return okResult({
          worktree: WORKTREE,
          relativePath: null,
          absolutePath: pathText,
          exists: false,
          isDirectory: false
        })
      }
      return okResult({
        worktree: WORKTREE,
        relativePath: null,
        absolutePath: pathText,
        exists: true,
        isDirectory: false,
        openTarget: {
          kind: 'absolute-file',
          absolutePath: pathText,
          grantId: `grant:${pathText}`,
          byteLength: 100
        }
      })
    }
    if (method === 'files.readTerminalArtifact') {
      const grantId = readStringField(params, 'grantId') ?? ''
      const absolutePath = grantId.slice('grant:'.length)
      if (fixture.failingReads.has(absolutePath)) {
        return failureResult('the grant expired')
      }
      return okResult({
        worktree: WORKTREE,
        relativePath: absolutePath,
        content: JSON.stringify(fixture.stateFiles.get(absolutePath)),
        truncated: false,
        byteLength: 100
      })
    }
    return failureResult(`unexpected method ${method}`)
  }
}

function makeFixture(): RemoteFixture {
  return {
    stateFiles: new Map([
      [`${JOBS_DIR}\\${BACKGROUND_JOB}\\state.json`, BACKGROUND_STATE],
      [`${JOBS_DIR}\\${INTERACTIVE_JOB}\\state.json`, INTERACTIVE_STATE],
      [`${JOBS_DIR}\\${FAILING_READ_JOB}\\state.json`, BACKGROUND_STATE],
      [`${JOBS_DIR}\\${UNKNOWN_STATE_JOB}\\state.json`, UNKNOWN_STATE]
    ]),
    failingReads: new Set([`${JOBS_DIR}\\${FAILING_READ_JOB}\\state.json`]),
    calls: [],
    worktreeSelectors: []
  }
}

function listWith(
  fixture: RemoteFixture,
  options: { jobsMissing?: boolean; environmentId?: string } = {}
) {
  return listRemoteClaudeBackgroundAgents({
    userDataPath: USER_DATA,
    environmentId: options.environmentId ?? ENVIRONMENT_ID,
    worktreeId: WORKTREE,
    call: createHostCalls(fixture, options)
  })
}

beforeEach(() => {
  resetRemoteClaudeBackgroundAgentCachesForTests()
})

describe('listRemoteClaudeBackgroundAgents', () => {
  it('lists a background job and leaves out the interactive one', async () => {
    const fixture = makeFixture()
    const result = await listWith(fixture)
    expect(result.status).toBe('ready')
    expect(result.agents.map((agent) => agent.id)).toEqual([BACKGROUND_JOB, UNKNOWN_STATE_JOB])
    const background = result.agents[0]
    expect(background).toMatchObject({
      id: BACKGROUND_JOB,
      sessionId: 'session-alpha',
      name: 'agent alpha',
      cwd: 'D:\\ctjt\\code\\ctjt-platform\\ctjt-service',
      kind: 'background',
      state: 'done'
    })
  })

  it('skips job directories without a state file, pins.json and non-hex names', async () => {
    const fixture = makeFixture()
    const result = await listWith(fixture)
    const ids = result.agents.map((agent) => agent.id)
    // The empty job had no state file; the failing read is skipped too.
    expect(ids).not.toContain(EMPTY_JOB)
    expect(ids).not.toContain(FAILING_READ_JOB)
    expect(ids).not.toContain(UPPERCASE_JOB)
    expect(ids).not.toContain('pins.json')
    expect(ids).not.toContain('not-hex')
    expect(result.status).toBe('ready')
  })

  it('takes startedAt from createdAt and updatedAt from the ISO timestamp', async () => {
    const fixture = makeFixture()
    const result = await listWith(fixture)
    expect(result.agents[0].startedAt).toBe(Date.parse('2026-11-20T10:00:00.000Z'))
    expect(result.details[BACKGROUND_JOB]).toEqual({
      detail: 'fixed the failing test',
      needs: null,
      updatedAt: Date.parse('2026-11-20T10:05:30.000Z')
    })
  })

  it('leaves an unknown state word unset so the row falls into Completed', async () => {
    const fixture = makeFixture()
    const result = await listWith(fixture)
    const unknown = result.agents.find((agent) => agent.id === UNKNOWN_STATE_JOB)
    expect(unknown).toBeDefined()
    expect(unknown?.state).toBeUndefined()
    expect(result.details[UNKNOWN_STATE_JOB]).toEqual({
      detail: null,
      needs: null,
      updatedAt: null
    })
  })

  it('answers ready with the readable jobs when only some jobs fail', async () => {
    const fixture = makeFixture()
    const result = await listWith(fixture)
    // The fixture lists five job directories; two of them cannot be read.
    expect(result.status).toBe('ready')
    expect(result.agents.map((agent) => agent.id)).toContain(BACKGROUND_JOB)
    expect(result.agents.map((agent) => agent.id)).not.toContain(FAILING_READ_JOB)
    expect(result.agents.map((agent) => agent.id)).not.toContain(EMPTY_JOB)
  })

  it('reports an error when the host lists jobs but none of them can be read', async () => {
    // Why: an older host refusing the grant, or a connection dropping mid-sweep, must not turn
    // into "this project has no background agents" and replace the panel's last roster.
    const fixture: RemoteFixture = {
      stateFiles: new Map(),
      failingReads: new Set(),
      calls: [],
      worktreeSelectors: []
    }
    const result = await listWith(fixture)
    expect(result.status).toBe('error')
    expect(result.agents).toEqual([])
    expect(result.details).toEqual({})
    expect(result.message).toContain('5')
    expect(result.message).toContain('could not read')
  })

  it("sends the caller's bare worktree id with both file calls", async () => {
    const fixture = makeFixture()
    await listWith(fixture)
    const resolveCalls = fixture.worktreeSelectors.filter(
      (call) => call.method === 'files.resolveTerminalPath'
    )
    const readCalls = fixture.worktreeSelectors.filter(
      (call) => call.method === 'files.readTerminalArtifact'
    )
    expect(resolveCalls.length).toBeGreaterThan(0)
    expect(readCalls.length).toBeGreaterThan(0)
    // The probe proved the bare id resolves on the real host; an `id:` prefix would be untested.
    expect(new Set(fixture.worktreeSelectors.map((call) => call.worktree))).toEqual(
      new Set([WORKTREE])
    )
  })

  it('answers ready with no agents when the host has no jobs directory', async () => {
    const fixture = makeFixture()
    const result = await listWith(fixture, { jobsMissing: true })
    expect(result).toEqual({ status: 'ready', agents: [], details: {}, message: null })
  })

  it('asks for the home directory once across listings', async () => {
    const fixture = makeFixture()
    await listWith(fixture)
    await listWith(fixture)
    const homeBrowses = fixture.calls.filter(
      (call) =>
        call.method === 'files.browseServerDir' && readStringField(call.params, 'path') === '~'
    )
    expect(homeBrowses).toHaveLength(1)
  })

  it('serves the details of the last listing from the cache without another request', async () => {
    const fixture = makeFixture()
    const listing = await listWith(fixture)
    const callsAfterListing = fixture.calls.length
    const details = readRemoteClaudeBackgroundAgentDetails(ENVIRONMENT_ID, [
      BACKGROUND_JOB,
      'ffff9999'
    ])
    expect(details[BACKGROUND_JOB]).toEqual(listing.details[BACKGROUND_JOB])
    expect(details['ffff9999']).toBeUndefined()
    expect(fixture.calls).toHaveLength(callsAfterListing)
  })

  it('reports an error when the host cannot report its home', async () => {
    const result = await listRemoteClaudeBackgroundAgents({
      userDataPath: USER_DATA,
      environmentId: ENVIRONMENT_ID,
      worktreeId: WORKTREE,
      call: async () => failureResult('the tunnel is down')
    })
    expect(result.status).toBe('error')
    expect(result.message).toContain('the tunnel is down')
    expect(result.agents).toEqual([])
  })

  it('reports an error when the runtime cannot be reached at all', async () => {
    const result = await listRemoteClaudeBackgroundAgents({
      userDataPath: USER_DATA,
      environmentId: ENVIRONMENT_ID,
      worktreeId: WORKTREE,
      call: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:64714')
      }
    })
    expect(result.status).toBe('error')
    expect(result.message).toContain('ECONNREFUSED')
  })
})
