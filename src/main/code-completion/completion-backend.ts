import {
  validateNesEditPlan,
  type NesBackendId,
  type NesEditPlan,
  type NesRequest
} from '../../shared/code-completion/code-completion-types'

/** The spec caps a completion answer; a longer one is dropped as a parse failure. */
export const NES_COMPLETION_OUTPUT_LIMIT = 8000

export type CompletionUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export type NesBackendResult = {
  plan: NesEditPlan | null
  usage: CompletionUsage
}

export type NesBackend = {
  readonly id: NesBackendId
  readonly planCapable: boolean
  plan(input: NesRequest, signal: AbortSignal): Promise<NesBackendResult>
}

export type NesBackendConfig = {
  baseUrl: string
  model: string
  apiKey: string
  maxTokens: number
  autoImport: boolean
}

export type CompletionBackendOptions = {
  fetchImpl?: typeof fetch
}

export function emptyCompletionUsage(): CompletionUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
}

/** The absolute paths a plan may name: the edited file and the related files. */
export function nesAllowedPaths(input: NesRequest): string[] {
  return [input.filePath, ...input.relatedFiles.map((relatedFile) => relatedFile.path)]
}

/** The plan a model answer carries, or null when the answer is not JSON. */
export function parseNesPlanText(
  text: string,
  allowedPaths: readonly string[]
): NesEditPlan | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(0, NES_COMPLETION_OUTPUT_LIMIT))
  } catch {
    return null
  }
  return validateNesEditPlan(parsed, { allowedPaths })
}
