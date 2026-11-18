import { z } from 'zod'

export const CodeCompletionRelatedFile = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** The file line the shown content starts at, 1-based. */
  startLine: z.number().int().positive()
})

export const CodeCompletionRecentEdit = z.object({
  path: z.string().min(1),
  label: z.string()
})

export const CodeCompletionPlan = z.object({
  filePath: z.string().min(1),
  relativePath: z.string(),
  languageId: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  /** The file line the shown prefix starts at, 1-based. */
  prefixStartLine: z.number().int().positive(),
  /** The cursor's absolute position in the file, 1-based. */
  cursorLine: z.number().int().positive(),
  cursorColumn: z.number().int().positive(),
  relatedFiles: z.array(CodeCompletionRelatedFile).max(8).default([]),
  recentEdits: z.array(CodeCompletionRecentEdit).max(10).default([])
})

export type CodeCompletionRelatedFile = z.infer<typeof CodeCompletionRelatedFile>
export type CodeCompletionRecentEdit = z.infer<typeof CodeCompletionRecentEdit>
export type CodeCompletionPlan = z.infer<typeof CodeCompletionPlan>

export const CodeCompletionPlanResult = z.object({
  plan: z.unknown().nullable()
})

export type CodeCompletionPlanResult = z.infer<typeof CodeCompletionPlanResult>
