import type { NesRequest } from '../../shared/code-completion/code-completion-types'

/** The absolute paths a plan may name: the edited file and the related files. */
export function nesAllowedPaths(input: NesRequest): string[] {
  return [input.filePath, ...input.relatedFiles.map((relatedFile) => relatedFile.path)]
}
