import { z } from 'zod'

export const RefactorManifestProposal = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Empty when the agent gave no reason; the UI shows it as "no reason given". */
  rationale: z.string(),
  /**
   * Paths relative to the workspace root, not to the file the refactor was asked for.
   *
   * Why it may be missing: the manifest is an index, and an index that leaves out a page is still
   * an index — the plan builder takes the file list of such a proposal from the scratch tree.
   */
  files: z.array(z.string().min(1)).optional()
})

export const RefactorManifest = z.object({
  proposals: z.array(RefactorManifestProposal)
})

/**
 * The manifest as it arrives on disk.
 *
 * Why the proposals are untyped here: one proposal that does not fit the shape must not void the
 * others, so the reader checks them one at a time against `RefactorManifestProposal`.
 */
export const RefactorManifestDocument = z.object({
  proposals: z.array(z.unknown())
})

export type RefactorManifestProposal = z.infer<typeof RefactorManifestProposal>
export type RefactorManifest = z.infer<typeof RefactorManifest>
