import { z } from 'zod'
import { RefactorPlan } from '../refactor/refactor-types'

export const RefactorProposeParams = z.object({
  worktree: z.string().min(1),
  relativePath: z.string(),
  content: z.string(),
  instruction: z.string().optional()
})

export const RefactorProposeResult = z.object({
  jobId: z.string().min(1)
})

export const RefactorJobIdParams = z.object({
  jobId: z.string().min(1)
})

export const RefactorStatusResult = z.object({
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  progress: z.string(),
  warnings: z.array(z.string())
})

export const RefactorPlanResult = z.object({
  plan: RefactorPlan.nullable()
})

export const RefactorApplyParams = z.object({
  jobId: z.string().min(1),
  acceptedHunkIds: z.array(z.string().min(1))
})

export const RefactorApplyResult = z.object({
  applied: z.array(
    z.object({
      path: z.string().min(1),
      hunksApplied: z.number().int().nonnegative()
    })
  ),
  /** Why: a refusal whose reason the user cannot see is a silent no-op, so the reason travels with the result. */
  refusals: z.array(
    z.object({
      path: z.string().min(1),
      reason: z.string()
    })
  )
})

export const RefactorDiscardResult = z.object({
  discarded: z.boolean()
})

export type RefactorProposeParams = z.infer<typeof RefactorProposeParams>
export type RefactorProposeResult = z.infer<typeof RefactorProposeResult>
export type RefactorJobIdParams = z.infer<typeof RefactorJobIdParams>
export type RefactorStatusResult = z.infer<typeof RefactorStatusResult>
export type RefactorPlanResult = z.infer<typeof RefactorPlanResult>
export type RefactorApplyParams = z.infer<typeof RefactorApplyParams>
export type RefactorApplyResult = z.infer<typeof RefactorApplyResult>
export type RefactorDiscardResult = z.infer<typeof RefactorDiscardResult>
