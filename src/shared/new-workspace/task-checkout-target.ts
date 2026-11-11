/** Where a new task's agent runs: a fresh worktree, or the repo's existing checkout. */
export const TASK_CHECKOUT_TARGETS = ['new-workspace', 'current-checkout'] as const

export type TaskCheckoutTarget = (typeof TASK_CHECKOUT_TARGETS)[number]

export function isTaskCheckoutTarget(value: unknown): value is TaskCheckoutTarget {
  return typeof value === 'string' && TASK_CHECKOUT_TARGETS.some((target) => target === value)
}
