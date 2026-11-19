import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { completionCache } from '../../../../code-completion/completion-cache'
import {
  getDefaultCodeCompletionSettings,
  type CodeCompletionSettings
} from '../../../../../shared/code-completion/code-completion-settings'
import { CodeCompletionPlanResult } from '../../../../../shared/rpc-contract/code-completion-params'
import { CODE_COMPLETION_METHODS } from './code-completion-methods'

const apiKey = vi.hoisted(() => ({ read: (): string | null => 'test-api-key' }))
const completionUsage = vi.hoisted(() => ({ record: vi.fn() }))

vi.mock('../../../../code-completion/code-completion-api-key-store', () => ({
  readCodeCompletionApiKey: () => apiKey.read()
}))

vi.mock('../../../../code-completion/completion-usage', () => ({
  recordCompletionUsage: completionUsage.record
}))

const FILE_PATH = '/repo/src/foo.ts'

/** The request the renderer sends; the prefix shows one line of a longer file. */
const PLAN_PARAMS = {
  filePath: FILE_PATH,
  relativePath: 'src/foo.ts',
  languageId: 'typescript',
  prefix: 'const a = 1\n',
  suffix: '\nconst b = 2',
  prefixStartLine: 40,
  cursorLine: 41,
  cursorColumn: 1
}

/** What the model answers: its line numbers count from the text it was shown. */
const MODEL_PLAN = {
  edits: [
    {
      id: 'e1',
      path: FILE_PATH,
      kind: 'insert',
      range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 },
      originalText: '',
      text: 'const c = 3\n',
      label: 'add the third constant'
    }
  ]
}

function createRuntime(settings?: Partial<CodeCompletionSettings>): OrcaRuntimeService {
  const codeCompletion = settings
    ? { ...getDefaultCodeCompletionSettings(), ...settings }
    : undefined
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads requireStore().getSettings().codeCompletion and the dispatcher reads getRuntimeId.
  const runtime = {
    getRuntimeId: () => 'runtime-a',
    requireStore: () => ({ getSettings: () => ({ codeCompletion }) })
  } as unknown as OrcaRuntimeService
  return runtime
}

async function dispatchPlan(
  runtime: OrcaRuntimeService,
  params: Record<string, unknown>
): Promise<unknown> {
  const dispatcher = new RpcDispatcher({ runtime, methods: [...CODE_COMPLETION_METHODS] })
  const request: RpcRequest = {
    id: 'req-1',
    authToken: 'token',
    method: 'codeCompletion.plan',
    params
  }
  return await dispatcher.dispatch(request)
}

/** The endpoint answers with the model's plan, as an Anthropic stream. */
function stubCompletionFetch(): ReturnType<typeof vi.fn> {
  const event = JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: JSON.stringify(MODEL_PLAN) }
  })
  const fetchMock = vi.fn(
    async () =>
      new Response(`data: ${event}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The endpoint answers with the given text and reports the Anthropic usage counts. */
function stubCompletionFetchWithUsage(answer: string): ReturnType<typeof vi.fn> {
  const start = JSON.stringify({
    type: 'message_start',
    message: { id: 'm1', usage: { input_tokens: 12, cache_read_input_tokens: 3 } }
  })
  const event = JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: answer }
  })
  const delta = JSON.stringify({ type: 'message_delta', usage: { output_tokens: 7 } })
  const fetchMock = vi.fn(
    async () =>
      new Response(`data: ${start}\n\ndata: ${event}\n\ndata: ${delta}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('codeCompletion.plan', () => {
  beforeEach(() => {
    completionCache.clear()
    apiKey.read = () => 'test-api-key'
    completionUsage.record.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a plan from the completion service', async () => {
    const fetchMock = stubCompletionFetch()
    const runtime = createRuntime({
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    expect(response).toMatchObject({
      ok: true,
      result: {
        plan: {
          edits: [
            {
              id: 'e1',
              path: FILE_PATH,
              kind: 'insert',
              range: { startLine: 41, startColumn: 1, endLine: 41, endColumn: 1 },
              originalText: '',
              text: 'const c = 3\n',
              label: 'add the third constant'
            }
          ]
        }
      }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://endpoint.invalid/v1/messages',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('records what the completion spent', async () => {
    stubCompletionFetchWithUsage(JSON.stringify(MODEL_PLAN))
    const runtime = createRuntime({
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    await dispatchPlan(runtime, PLAN_PARAMS)

    expect(completionUsage.record).toHaveBeenCalledWith({
      model: 'test-model',
      usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 3 },
      at: expect.any(Number)
    })
  })

  it('records what the completion spent even when the answer is not a plan', async () => {
    stubCompletionFetchWithUsage('not a plan')
    const runtime = createRuntime({
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    expect(response).toMatchObject({ ok: true, result: { plan: null } })
    expect(completionUsage.record).toHaveBeenCalledWith({
      model: 'test-model',
      usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 3 },
      at: expect.any(Number)
    })
  })

  it('records nothing when the completion spent nothing', async () => {
    stubCompletionFetch()
    const runtime = createRuntime({
      enabled: true,
      protocol: 'anthropic-messages',
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    await dispatchPlan(runtime, PLAN_PARAMS)

    expect(completionUsage.record).not.toHaveBeenCalled()
  })

  it('returns null when the feature is disabled', async () => {
    const fetchMock = stubCompletionFetch()
    const runtime = createRuntime({
      enabled: false,
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    expect(response).toMatchObject({ ok: true, result: { plan: null } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when no endpoint is configured', async () => {
    const fetchMock = stubCompletionFetch()
    const runtime = createRuntime({ enabled: true, baseUrl: '', model: 'test-model' })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    expect(response).toMatchObject({ ok: true, result: { plan: null } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when no API key is stored', async () => {
    apiKey.read = () => null
    const fetchMock = stubCompletionFetch()
    const runtime = createRuntime({
      enabled: true,
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    expect(response).toMatchObject({ ok: true, result: { plan: null } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers no plan when the saved key cannot be read', async () => {
    apiKey.read = () => {
      throw new Error('Code completion API key could not be decrypted')
    }
    const fetchMock = stubCompletionFetch()
    const runtime = createRuntime({
      enabled: true,
      baseUrl: 'https://endpoint.invalid',
      model: 'test-model'
    })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    expect(response).toMatchObject({ ok: true, result: { plan: null } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never returns the API key to the caller', async () => {
    apiKey.read = () => 'super-secret-api-key'
    stubCompletionFetch()
    const runtime = createRuntime({
      enabled: true,
      baseUrl: 'https://user:pass@endpoint.invalid',
      model: 'test-model'
    })

    const response = await dispatchPlan(runtime, PLAN_PARAMS)

    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('super-secret-api-key')
    expect(serialized).not.toContain('user:pass')
    expect(response).toMatchObject({ ok: true, result: { plan: { edits: [{ id: 'e1' }] } } })
  })
})

describe('the codeCompletion.plan result contract', () => {
  it('accepts a plan and rejects a malformed one', () => {
    expect(CodeCompletionPlanResult.safeParse({ plan: null }).success).toBe(true)
    expect(CodeCompletionPlanResult.safeParse({ plan: { edits: [] } }).success).toBe(true)
    expect(CodeCompletionPlanResult.safeParse({ plan: { edits: 'nope' } }).success).toBe(false)
  })
})
