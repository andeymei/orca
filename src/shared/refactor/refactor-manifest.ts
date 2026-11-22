import { z } from 'zod'

export const RefactorManifestProposal = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Empty when the agent gave no reason; the UI shows it as "no reason given". */
  rationale: z.string(),
  /** Paths relative to the workspace root, not to the file the refactor was asked for. */
  files: z.array(z.string().min(1))
})

export const RefactorManifest = z.object({
  proposals: z.array(RefactorManifestProposal)
})

export type RefactorManifestProposal = z.infer<typeof RefactorManifestProposal>
export type RefactorManifest = z.infer<typeof RefactorManifest>
