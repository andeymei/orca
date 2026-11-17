import { describe, expect, it, vi } from 'vitest'
import type { NesRequest } from '../../shared/code-completion/code-completion-types'
import { createAnthropicMessagesBackend } from './anthropic-messages-backend'
import { createOpenAiChatBackend } from './openai-chat-backend'
import { createOpenAiFimBackend } from './openai-fim-backend'

const FILE_PATH = '/repo/src/foo.ts'

const REQUEST: NesRequest = {
  filePath: FILE_PATH,
  relativePath: 'src/foo.ts',
  languageId: 'typescript',
  prefix: 'const a = 1\n',
  suffix: '\nconst b = 2',
  relatedFiles: [{ path: '/repo/src/bar.ts', content: 'export const bar = 1\n' }],
  recentEdits: []
}

const CONFIG = {
  baseUrl: 'https://endpoint.invalid',
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 512,
  autoImport: false
}

const PLAN = {
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

function sseResponse(payloads: readonly string[]): Response {
  const body = payloads.map((payload) => `data: ${payload}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function anthropicTextEvent(text: string): string {
  return JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestBody(
  call: [input: RequestInfo | URL, init?: RequestInit] | undefined
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(String(call?.[1]?.body))
  return isRecord(parsed) ? parsed : {}
}

describe('completion backends', () => {
  it('reads an Anthropic stream and returns the validated plan', async () => {
    const planJson = JSON.stringify(PLAN)
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([
        JSON.stringify({ type: 'message_start', message: { id: 'm1' } }),
        anthropicTextEvent(planJson.slice(0, 30)),
        anthropicTextEvent(planJson.slice(30)),
        JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
      ])
    )
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toEqual(PLAN)
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://endpoint.invalid/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      })
    )
    const body = requestBody(fetchImpl.mock.calls[0])
    expect(body.model).toBe('test-model')
    expect(body.max_tokens).toBe(512)
    expect(body.stream).toBe(true)
    expect(body.system).toContain('Reply with a single JSON object')
    expect(body.messages).toEqual([
      { role: 'user', content: expect.stringContaining('###PATH: /repo/src/foo.ts') }
    ])
  })

  it('reads an OpenAI chat stream and returns the validated plan', async () => {
    const planJson = JSON.stringify(PLAN)
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }),
        JSON.stringify({ choices: [{ delta: { content: planJson.slice(0, 30) } }] }),
        JSON.stringify({ choices: [{ delta: { content: planJson.slice(30) } }] }),
        '[DONE]'
      ])
    )
    const backend = createOpenAiChatBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toEqual(PLAN)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://endpoint.invalid/chat/completions',
      expect.objectContaining({
        headers: {
          authorization: 'Bearer test-key',
          'content-type': 'application/json'
        }
      })
    )
    const body = requestBody(fetchImpl.mock.calls[0])
    expect(body.messages).toEqual([
      { role: 'system', content: expect.stringContaining('Reply with a single JSON object') },
      { role: 'user', content: expect.stringContaining('###PATH: /repo/src/foo.ts') }
    ])
  })

  it('reads an OpenAI FIM stream and returns only the cursor edit', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([JSON.stringify({ choices: [{ text: 'const c = 3' }] })])
    )
    const backend = createOpenAiFimBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(backend.planCapable).toBe(false)
    expect(result.plan?.edits).toEqual([
      {
        id: 'fim-cursor',
        path: FILE_PATH,
        kind: 'insert',
        range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 },
        originalText: '',
        text: 'const c = 3',
        label: 'Completion'
      }
    ])
    const body = requestBody(fetchImpl.mock.calls[0])
    expect(body.prompt).toBe('const a = 1\n<<<CURSOR>>>\nconst b = 2')
  })

  it('returns null when the endpoint answers 401', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('unauthorized', { status: 401 }))
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toBeNull()
  })

  it('returns null when the stream ends mid-object', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([anthropicTextEvent(JSON.stringify(PLAN).slice(0, -5))])
    )
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toBeNull()
  })

  it('returns null when the endpoint answers 429 with a retry-after', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })
    )
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toBeNull()
  })

  it('returns null when the answer is longer than the output cap', async () => {
    const oversized = JSON.stringify({ edits: [{ ...PLAN.edits[0], text: 'x'.repeat(9000) }] })
    const fetchImpl = vi.fn<typeof fetch>(async () => sseResponse([anthropicTextEvent(oversized)]))
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toBeNull()
  })
})
