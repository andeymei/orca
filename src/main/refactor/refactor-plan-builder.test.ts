import { describe, expect, it } from 'vitest'
import { buildRefactorPlan, isSafeRelativeRefactorPath } from './refactor-plan-builder'

const workspaceRoot = '/repo'
const scratchRoot = '/repo/.orca/refactor/job-1'

describe('isSafeRelativeRefactorPath', () => {
  it('accepts a plain relative path', () => {
    expect(isSafeRelativeRefactorPath('src/foo.ts')).toBe(true)
  })

  it('rejects a path that climbs out of the workspace', () => {
    expect(isSafeRelativeRefactorPath('../../etc/passwd')).toBe(false)
  })

  it('rejects an absolute path', () => {
    expect(isSafeRelativeRefactorPath('/etc/passwd')).toBe(false)
  })
})

describe('buildRefactorPlan', () => {
  it('builds a plan with hunks against the baseline', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: '提取校验', rationale: '重复。', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.plan.proposals).toHaveLength(1)
    expect(result.plan.proposals[0].files[0].hunks).toHaveLength(1)
    expect(result.plan.proposals[0].files[0].originalContent).toBe('a\nb\n')
  })

  it('keeps the disk content aside for the staleness check', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: '提取校验', rationale: '重复。', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.diskContents.get('src/foo.ts')).toBe('a\n')
  })

  it('drops a proposal whose path escapes the workspace', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 't', rationale: 'r', files: ['../../etc/passwd'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('drops the later proposal when two proposals touch the same file', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] },
          { id: 'p2', title: 'b', rationale: 'r', files: ['src/foo.ts'] }
        ]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('checks the conflict before it reads, so the dropped proposal is never read', async () => {
    const readProposals: string[] = []
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] },
          { id: 'p2', title: 'b', rationale: 'r', files: ['src/other.ts', 'src/foo.ts'] }
        ]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async (proposalId) => {
        readProposals.push(proposalId)
        return 'b\n'
      }
    })
    expect(readProposals).toEqual(['p1'])
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.diskContents.get('src/foo.ts')).toBe('a\n')
  })

  it('keeps a proposal whose content did not change', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'a\n'
    })
    expect(result.plan.proposals).toHaveLength(1)
    expect(result.plan.proposals[0].files[0].hunks).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('drops a proposal whose id would climb out of the scratch root', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: '..', title: 'a', rationale: 'r', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('drops a proposal that lists no file', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 'a', rationale: 'r', files: [] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('drops a proposal whose scratch file is missing and warns about it', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => null
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('rebuilds the proposal list from the scratch tree when the manifest is missing', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: null,
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [
        { id: '_source', files: ['src/foo.ts'] },
        { id: 'p1', files: ['src/foo.ts'] }
      ],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
