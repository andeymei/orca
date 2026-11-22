import type { editor } from 'monaco-editor'
import type { NesEditPlan } from '../../../../../shared/code-completion/code-completion-types'
import { buildNesContext } from './nes-context-builder'
import { nesSecretNearCursor } from './nes-secret-guard'
import { requestNesPlan } from './nes-runtime-client'

export type NesPlanRequestResult = {
  /** The plan the model answered with, or null when there was none. */
  plan: NesEditPlan | null
  /** The text near the cursor held a secret, so nothing was sent. */
  blocked: boolean
  /** How long the answer took, in milliseconds. */
  latencyMs: number
}

/**
 * Asks the model what to write at the cursor.
 *
 * Why the secret check is here: the text goes to a provider, which is somebody else's computer.
 * A key or a token near the cursor would go with it, and the person who typed it never meant that.
 */
export async function requestNesPlanForEditor(params: {
  model: editor.ITextModel
  position: { lineNumber: number; column: number }
  filePath: string
  relativePath: string | undefined
  contextPrefixChars: number
  contextSuffixChars: number
  displayDeadlineMs: number
  signal: AbortSignal
}): Promise<NesPlanRequestResult> {
  const { model, position, filePath, relativePath, signal } = params
  const context = buildNesContext(model, position, {
    filePath,
    relativePath: relativePath ?? filePath,
    prefixChars: params.contextPrefixChars,
    suffixChars: params.contextSuffixChars
  })
  const secret = nesSecretNearCursor({
    model,
    cursorLine: context.cursorLine,
    cursorColumn: context.cursorColumn,
    prefixStartLine: context.prefixStartLine,
    suffixEndLine: context.cursorLine + countLines(context.suffix),
    fileName: relativePath ?? filePath
  })
  if (secret) {
    return { plan: null, blocked: true, latencyMs: 0 }
  }
  const askedAt = Date.now()
  const plan = await requestNesPlan(
    {
      ...context,
      // Why: the related files cost a search and several thousand tokens on every request, and
      // the model answered the same either way — the suggestion is about the file being typed.
      relatedFiles: [],
      recentEdits: []
    },
    {
      signal,
      // Why: an answer that arrives after the deadline is noise, and the request that brings
      // it holds a slot and spends tokens.
      timeoutMs: params.displayDeadlineMs
    }
  )
  return { plan, blocked: false, latencyMs: Date.now() - askedAt }
}

/** How many lines the text covers below the line it starts on. */
function countLines(text: string): number {
  let lines = 0
  for (const character of text) {
    if (character === '\n') {
      lines += 1
    }
  }
  return lines
}
