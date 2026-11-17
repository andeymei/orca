import { getMainHttpClient } from '../network/http-client'

export type CompletionHttpRequest = {
  url: string
  headers: Record<string, string>
  body: unknown
  signal: AbortSignal
  fetchImpl?: typeof fetch
}

export type CompletionHttpResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'http_error' | 'stream_error' | 'aborted' }

/** The endpoint URL of a base URL and a protocol path; a trailing slash on the base is dropped. */
export function completionEndpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/** The events of an SSE stream, or null when a payload is not JSON. */
export function parseCompletionSseEvents(text: string): unknown[] | null {
  const events: unknown[] = []
  for (const payload of text.split('\n')) {
    const trimmed = payload.trim()
    if (!trimmed) {
      continue
    }
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  return events
}

export async function postCompletionJson(
  request: CompletionHttpRequest
): Promise<CompletionHttpResult> {
  const fetchImpl: (url: string, init?: RequestInit) => Promise<Response> =
    request.fetchImpl ?? getMainHttpClient().fetch
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: request.signal
    })
  } catch {
    return { ok: false, reason: request.signal.aborted ? 'aborted' : 'http_error' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return { ok: false, reason: 'http_error' }
  }
  if (!response.body) {
    return { ok: false, reason: 'stream_error' }
  }
  try {
    return { ok: true, text: await readSsePayloads(response.body) }
  } catch {
    return { ok: false, reason: request.signal.aborted ? 'aborted' : 'stream_error' }
  }
}

/** The `data:` payloads of a stream, joined by a newline so each event parses on its own. */
async function readSsePayloads(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const payloads: string[] = []
  let buffer = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        collectSsePayload(buffer.slice(0, newline), payloads)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    collectSsePayload(buffer, payloads)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return payloads.join('\n')
}

function collectSsePayload(line: string, payloads: string[]): void {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
  if (!trimmed.startsWith('data:')) {
    return
  }
  const payload = trimmed.slice('data:'.length).trimStart()
  if (!payload || payload === '[DONE]') {
    return
  }
  payloads.push(payload)
}
