/** Where a new task's agent runs: a fresh worktree, or the repo's existing checkout. */
export type TaskCheckoutTarget = 'new-workspace' | 'current-checkout'

export const TASK_CHECKOUT_TARGETS: readonly TaskCheckoutTarget[] = [
  'new-workspace',
  'current-checkout'
]

export function isTaskCheckoutTarget(value: unknown): value is TaskCheckoutTarget {
  return typeof value === 'string' && TASK_CHECKOUT_TARGETS.includes(value as TaskCheckoutTarget)
}
