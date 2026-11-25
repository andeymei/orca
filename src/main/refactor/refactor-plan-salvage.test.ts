import { describe, expect, it } from 'vitest'

import { salvageRefactorPlan } from './refactor-plan-salvage'

const ORIGINAL = 'a\nb\n'
const MODIFIED = 'a\nB\n'

describe('the plan of a turn that was cut off', () => {
  it('keeps the changes the turn wrote before it stopped', async () => {
    const result = await salvageRefactorPlan({
      plan: {
        jobId: 'job-1',
        sourcePath: 'src/foo.ts',
        scratchRoot: '/repo/.orca/refactor/job-1',
        workspaceRoot: '/repo',
        readBaseline: async () => ORIGINAL,
        readDiskContent: async () => ORIGINAL,
        listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
        scratchFiles: async () => MODIFIED
      },
      completedWriteKeys: new Set(['p1/src/foo.ts'])
    })
    expect(result.plan.proposals).toHaveLength(1)
    expect(result.plan.proposals[0].files[0].path).toBe('src/foo.ts')
    expect(result.plan.proposals[0].files[0].hunks).toHaveLength(1)
  })

  it('names a proposal the agent never named after the file it changes', async () => {
    const result = await salvageRefactorPlan({
      plan: {
        jobId: 'job-1',
        sourcePath: 'src/foo.ts',
        scratchRoot: '/repo/.orca/refactor/job-1',
        workspaceRoot: '/repo',
        readBaseline: async () => ORIGINAL,
        readDiskContent: async () => ORIGINAL,
        listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
        scratchFiles: async () => MODIFIED
      },
      completedWriteKeys: new Set(['p1/src/foo.ts'])
    })
    expect(result.plan.proposals[0].title).toBe('foo.ts')
  })

  it('leaves out a file the turn was interrupted in the middle of writing', async () => {
    // Why the other file: a write whose tool result never came back is half a file, and half a
    // file offered as a proposal would be applied as one.
    const result = await salvageRefactorPlan({
      plan: {
        jobId: 'job-1',
        sourcePath: 'src/foo.ts',
        scratchRoot: '/repo/.orca/refactor/job-1',
        workspaceRoot: '/repo',
        readBaseline: async () => ORIGINAL,
        readDiskContent: async () => ORIGINAL,
        listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
        scratchFiles: async () => MODIFIED
      },
      completedWriteKeys: new Set(['p1/src/bar.ts'])
    })
    expect(result.plan.proposals).toHaveLength(0)
  })

  it('keeps everything when the turn confirmed no write at all', async () => {
    // Why: an empty set says the turn wrote nothing, not that every write is half a file.
    const result = await salvageRefactorPlan({
      plan: {
        jobId: 'job-1',
        sourcePath: 'src/foo.ts',
        scratchRoot: '/repo/.orca/refactor/job-1',
        workspaceRoot: '/repo',
        readBaseline: async () => ORIGINAL,
        readDiskContent: async () => ORIGINAL,
        listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
        scratchFiles: async () => MODIFIED
      },
      completedWriteKeys: new Set()
    })
    expect(result.plan.proposals).toHaveLength(1)
  })
})
