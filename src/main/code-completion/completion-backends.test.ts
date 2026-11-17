import { describe, expect, it, vi } from 'vitest'
import type { NesEditPlan, NesRequest } from '../../shared/code-completion/code-completion-types'
import { createAnthropicMessagesBackend } from './anthropic-messages-backend'
import { translateNesEditLines } from './completion-backend'
import { createOpenAiChatBackend } from './openai-chat-backend'
import { createOpenAiFimBackend } from './openai-fim-backend'

const FILE_PATH = '/repo/src/foo.ts'
const RELATED_FILE_PATH = '/repo/src/bar.ts'

// The prefix shows one line of a longer file, so the model's line numbers drift from the file's.
const REQUEST: NesRequest = {
  filePath: FILE_PATH,
  relativePath: 'src/foo.ts',
  languageId: 'typescript',
  prefix: 'const a = 1\n',
  suffix: '\nconst b = 2',
  prefixStartLine: 40,
  cursorLine: 41,
  cursorColumn: 1,
  relatedFiles: [{ path: RELATED_FILE_PATH, content: 'export const bar = 1\n', startLine: 5 }],
  recentEdits: []
}

const CONFIG = {
  baseUrl: 'https://endpoint.invalid',
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 512,
  autoImport: false
}

/** What the model answers: line numbers count from the text it was shown. */
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

/** What the backend answers: the same edit at the file's own line. */
const ABSOLUTE_PLAN = {
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
    const planJson = JSON.stringify(MODEL_PLAN)
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

    expect(result.plan).toEqual(ABSOLUTE_PLAN)
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

  it('asks for the auto-import when the setting is on', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([anthropicTextEvent(JSON.stringify(MODEL_PLAN))])
    )
    const backend = createAnthropicMessagesBackend({ ...CONFIG, autoImport: true }, { fetchImpl })

    await backend.plan(REQUEST, new AbortController().signal)

    const body = requestBody(fetchImpl.mock.calls[0])
    expect(body.system).toContain('adds the import')
  })

  it('drops an edit that answers with the relative path', async () => {
    const relativePlan = {
      edits: [
        {
          id: 'e1',
          path: REQUEST.relativePath,
          kind: 'insert',
          range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 },
          originalText: '',
          text: 'const c = 3\n',
          label: 'add the third constant'
        }
      ]
    }
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([anthropicTextEvent(JSON.stringify(relativePlan))])
    )
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan?.edits).toEqual([])
  })

  it('reads an OpenAI chat stream and returns the validated plan', async () => {
    const planJson = JSON.stringify(MODEL_PLAN)
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

    expect(result.plan).toEqual(ABSOLUTE_PLAN)
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
      sseResponse([JSON.stringify({ choices: [{ text: '  const c = 3\n' }] })])
    )
    const backend = createOpenAiFimBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(backend.planCapable).toBe(false)
    expect(result.plan?.edits).toEqual([
      {
        id: 'fim-cursor',
        path: FILE_PATH,
        kind: 'insert',
        range: { startLine: 41, startColumn: 1, endLine: 41, endColumn: 1 },
        originalText: '',
        text: '  const c = 3',
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
      sseResponse([anthropicTextEvent(JSON.stringify(MODEL_PLAN).slice(0, -5))])
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
    const oversized = JSON.stringify({
      edits: [{ ...MODEL_PLAN.edits[0], text: 'x'.repeat(9000) }]
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => sseResponse([anthropicTextEvent(oversized)]))
    const backend = createAnthropicMessagesBackend(CONFIG, { fetchImpl })

    const result = await backend.plan(REQUEST, new AbortController().signal)

    expect(result.plan).toBeNull()
  })
})

describe('backend identity', () => {
  it('tells two models apart', () => {
    expect(createAnthropicMessagesBackend(CONFIG).identity).not.toBe(
      createAnthropicMessagesBackend({ ...CONFIG, model: 'other-model' }).identity
    )
  })

  it('tells the auto-import switch apart', () => {
    expect(createAnthropicMessagesBackend(CONFIG).identity).not.toBe(
      createAnthropicMessagesBackend({ ...CONFIG, autoImport: true }).identity
    )
  })
})

describe('translateNesEditLines', () => {
  it('moves a line to the file the text was shown from', () => {
    const plan: NesEditPlan = {
      edits: [
        {
          id: 'e1',
          path: FILE_PATH,
          kind: 'insert',
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          originalText: '',
          text: 'const c = 3\n',
          label: 'add the third constant'
        },
        {
          id: 'e2',
          path: RELATED_FILE_PATH,
          kind: 'insert',
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          originalText: '',
          text: 'export const baz = 2\n',
          label: 'add the second export'
        }
      ]
    }

    const translated = translateNesEditLines(plan, REQUEST)

    expect(translated.edits[0].range).toEqual({
      startLine: 40,
      startColumn: 1,
      endLine: 40,
      endColumn: 1
    })
    expect(translated.edits[1].range).toEqual({
      startLine: 5,
      startColumn: 1,
      endLine: 5,
      endColumn: 1
    })
  })
})
