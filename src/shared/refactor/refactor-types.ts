import { z } from 'zod'

export const RefactorHunk = z.object({
  id: z.string().min(1),
  originalStartLine: z.number().positive(),
  originalLineCount: z.number().nonnegative(),
  modifiedStartLine: z.number().positive(),
  modifiedLineCount: z.number().nonnegative(),
  originalText: z.string(),
  modifiedText: z.string()
})

export const RefactorFileProposal = z.object({
  path: z.string().min(1),
  originalContent: z.string(),
  hunks: z.array(RefactorHunk)
})

export const RefactorProposal = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Empty when the agent gave no reason; the UI shows it as "no reason given". */
  rationale: z.string(),
  files: z.array(RefactorFileProposal)
})

export const RefactorPlan = z.object({
  jobId: z.string().min(1),
  sourcePath: z.string().min(1),
  proposals: z.array(RefactorProposal)
})

export type RefactorHunk = z.infer<typeof RefactorHunk>
export type RefactorFileProposal = z.infer<typeof RefactorFileProposal>
export type RefactorProposal = z.infer<typeof RefactorProposal>
export type RefactorPlan = z.infer<typeof RefactorPlan>
