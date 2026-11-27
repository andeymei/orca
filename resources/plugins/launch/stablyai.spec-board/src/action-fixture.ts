// The work item the action tests act on, and the reader that takes a prompt out of an action.
//
// The item carries both frameworks at once: a change that is being implemented and a plan in
// flight. The two half-items are the same work with one side missing.

import type { Action } from './model'

/** The item both frameworks act on: a change in implementation, and a plan in flight. */
export const item = {
  topic: 'add-x',
  openspec: {
    changeId: 'add-x',
    stage: 'implementing' as const,
    hasProposal: true,
    hasDesign: true,
    hasTasks: true,
    tasksDone: 1,
    tasksInProgress: 0,
    tasksTotal: 2,
    capabilities: []
  },
  superpowers: {
    designSpec: 'docs/superpowers/specs/x-design.md',
    plan: 'docs/superpowers/plans/x.md',
    stage: 'executing' as const,
    planDone: 1,
    planInProgress: 0,
    planTotal: 2,
    verification: null
  }
}

/** The item with only a change of its own: a copy, so a test that writes into it poisons nothing. */
export const openspecOnly = { topic: 'add-x', openspec: { ...item.openspec }, superpowers: null }

/** The item with only Superpowers work of its own: a copy, for the same reason. */
export const superpowersOnly = { topic: 'add-x', openspec: null, superpowers: { ...item.superpowers } }

/** The prompt an agent action carries. */
export const promptOf = (action: Action): string => {
  if (action.run.kind !== 'agent') {
    throw new Error(`action ${action.id} does not run an agent prompt`)
  }
  return action.run.prompt
}

/** The item, carrying the change id it is given. */
export const itemWithChangeId = (changeId: string): typeof item => ({
  ...item,
  openspec: { ...item.openspec, changeId }
})

/** The item, with its Superpowers side changed. */
export const itemWithSuperpowers = (superpowers: Partial<typeof item.superpowers>): typeof item => ({
  ...item,
  superpowers: { ...item.superpowers, ...superpowers }
})
