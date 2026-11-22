/**
 * The most proposals one refactoring may produce.
 *
 * Why a limit and not a hint: the prompt tells the agent the number, and the plan builder
 * enforces it, so a manifest that breaks it cannot grow the review tab past it.
 */
export const REFACTOR_MAX_PROPOSALS = 5

/** The most files one proposal may change. */
export const REFACTOR_MAX_FILES_PER_PROPOSAL = 5
