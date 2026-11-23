import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildRefactorPlan } from './refactor-plan-builder'
import { isSafeRelativeRefactorPath } from './refactor-path-rules'
import { readRefactorManifest } from './refactor-runner'
import type { RefactorManifest } from '../../shared/refactor/refactor-manifest'

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
  /**
   * A scratch root that holds the manifest the agent wrote, read through the app's own reader.
   *
   * Why the reader reads it: the plan builder takes the manifest it is given, so a plan-level
   * claim about what a broken manifest leads to has to start from what the reader made of it.
   */
  async function scratchRootWithManifest(manifest: unknown): Promise<{
    root: string
    read: { manifest: RefactorManifest | null; warnings: string[] }
  }> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'refactor-plan-'))
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    return { root, read: await readRefactorManifest(root) }
  }

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
    expect(result.warnings.some((warning) => warning.includes('changes the same file'))).toBe(true)
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
    // The dropped proposal leaves no trace: its other file is nowhere in the disk contents.
    expect(result.diskContents.has('src/other.ts')).toBe(false)
  })

  it('names the file in the hunk id, so two files do not share one', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/a.ts',
      manifest: {
        proposals: [{ id: 'p1', title: 'a', rationale: 'r', files: ['src/a.ts', 'src/b.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async (_proposalId, relativePath) =>
        relativePath === 'src/a.ts' ? 'A\n' : 'B\n'
    })
    expect(result.plan.proposals[0].files.map((file) => file.hunks[0].id)).toEqual([
      'src/a.ts:h1',
      'src/b.ts:h1'
    ])
  })

  it('treats a differently cased path as the same file', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/Foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src/Foo.ts'] },
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
    expect(result.warnings.some((warning) => warning.includes('changes the same file'))).toBe(true)
  })

  it('treats a backslash-spelled path as the same file', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src\\foo.ts'] },
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
    expect(result.warnings.some((warning) => warning.includes('changes the same file'))).toBe(true)
  })

  it('drops the second proposal when two proposals share an id', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src/foo.ts'] },
          { id: 'p1', title: 'b', rationale: 'r', files: ['src/other.ts'] }
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
    expect(result.warnings.some((warning) => warning.includes('repeats an id'))).toBe(true)
    expect(result.diskContents.has('src/other.ts')).toBe(false)
  })

  it('ignores a manifest proposal named _source and says so', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: '_source', title: 'a', rationale: 'r', files: ['src/foo.ts'] },
          { id: 'p1', title: 'b', rationale: 'r', files: ['src/foo.ts'] }
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
    expect(result.warnings.some((warning) => warning.includes('_source'))).toBe(true)
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

  it('says so when it ignores the baseline copy in the scratch tree', async () => {
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
    expect(
      result.warnings.some(
        (warning) => warning.includes('_source') && warning.includes('the baseline copy')
      )
    ).toBe(true)
  })

  it('warns about a missing reason only for a restored proposal that was kept', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: null,
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [
        { id: 'p1', files: ['src/foo.ts'] },
        { id: 'p2', files: ['src/foo.ts'] }
      ],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    const reasonWarnings = result.warnings.filter((warning) =>
      warning.includes('the agent gave no reason')
    )
    expect(reasonWarnings).toHaveLength(1)
    expect(reasonWarnings[0]).toContain('p1')
    expect(reasonWarnings[0]).not.toContain('p2')
  })

  it('stops building when the job was cancelled', async () => {
    // A discarded job's plan is never reviewed, so the build must not keep reading files.
    const controller = new AbortController()
    controller.abort()
    let reads = 0
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: '提取校验', rationale: '重复。', files: ['src/foo.ts'] }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => {
        reads += 1
        return 'a\n'
      },
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n',
      signal: controller.signal
    })
    expect(reads).toBe(0)
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.some((warning) => warning.includes('was cancelled'))).toBe(true)
  })

  it('takes the file list of a proposal the manifest does not name from the scratch tree', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: '提取校验', rationale: '两处规则相同。' }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.plan.proposals).toHaveLength(1)
    expect(result.plan.proposals[0].rationale).toBe('两处规则相同。')
    expect(result.plan.proposals[0].files.map((file) => file.path)).toEqual(['src/foo.ts'])
    expect(result.warnings.some((warning) => warning.includes('does not list its files'))).toBe(
      true
    )
  })

  it('does not say the agent gave no reason when the manifest named the proposal', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [{ id: 'p1', title: '提取校验', rationale: '两处规则相同。' }]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.warnings.some((warning) => warning.includes('the agent gave no reason'))).toBe(
      false
    )
  })

  it('keeps a proposal whose file list is empty, even when the tree holds files for it', async () => {
    // An empty list is the agent saying it changed nothing; only a missing one is a gap.
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
      listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings.some((warning) => warning.includes('names no file'))).toBe(true)
  })

  it('drops the proposals past the limit and says how many were dropped', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          { id: 'p1', title: 'a', rationale: 'r', files: ['src/a.ts'] },
          { id: 'p2', title: 'a', rationale: 'r', files: ['src/b.ts'] },
          { id: 'p3', title: 'a', rationale: 'r', files: ['src/c.ts'] },
          { id: 'p4', title: 'a', rationale: 'r', files: ['src/d.ts'] },
          { id: 'p5', title: 'a', rationale: 'r', files: ['src/e.ts'] },
          { id: 'p6', title: 'a', rationale: 'r', files: ['src/f.ts'] }
        ]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5'
    ])
    const limitWarnings = result.warnings.filter((warning) =>
      warning.includes('at most 5 proposals')
    )
    expect(limitWarnings).toEqual(['The review shows at most 5 proposals; 1 could not be shown.'])
  })

  it('drops the proposals past the limit on the scratch tree path too', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: null,
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [
        { id: 'p1', files: ['src/a.ts'] },
        { id: 'p2', files: ['src/b.ts'] },
        { id: 'p3', files: ['src/c.ts'] },
        { id: 'p4', files: ['src/d.ts'] },
        { id: 'p5', files: ['src/e.ts'] },
        { id: 'p6', files: ['src/f.ts'] }
      ],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5'
    ])
    const limitWarnings = result.warnings.filter((warning) =>
      warning.includes('at most 5 proposals')
    )
    expect(limitWarnings).toEqual(['The review shows at most 5 proposals; 1 could not be shown.'])
  })

  it('warns once about the proposals past the limit, not once per proposal', async () => {
    // The pathological tree: hundreds of scratch directories, so the notices would render
    // hundreds of paragraphs.
    const proposals = Array.from({ length: 500 }, (_unused, index) => ({
      id: `p${index + 1}`,
      title: 'a',
      rationale: 'r',
      files: [`src/${index + 1}.ts`]
    }))
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: { proposals },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(5)
    expect(result.warnings).toEqual([
      'The review shows at most 5 proposals; 495 could not be shown.'
    ])
  })

  it('warns once about the proposals that name too many files, not once per proposal', async () => {
    const proposals = [
      {
        id: 'p1',
        title: 'a',
        rationale: 'r',
        files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
      },
      {
        id: 'p2',
        title: 'a',
        rationale: 'r',
        files: ['src/g.ts', 'src/h.ts', 'src/i.ts', 'src/j.ts', 'src/k.ts', 'src/l.ts']
      }
    ]
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: { proposals },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings).toEqual([
      'The review shows at most 5 files per proposal; 2 proposals could not be shown.'
    ])
  })

  it('keeps a warning of its own for a proposal dropped for a reason the user can act on', async () => {
    // The count limits collapse into one line each; the rest tell the user what the agent did
    // wrong, so they keep a line each.
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          {
            id: 'p1',
            title: 'a',
            rationale: 'r',
            files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
          },
          { id: 'p2', title: 'a', rationale: 'r', files: ['src/g.ts'] },
          { id: 'p3', title: 'a', rationale: 'r', files: ['src/g.ts'] }
        ]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.warnings).toEqual([
      'Proposal p3 changes the same file as proposal p2; the later one was dropped: src/g.ts',
      'The review shows at most 5 files per proposal; 1 proposals could not be shown.'
    ])
  })

  it('drops a proposal that names more files than the limit', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: {
        proposals: [
          {
            id: 'p1',
            title: 'a',
            rationale: 'r',
            files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
          }
        ]
      },
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(
      result.warnings.some((warning) => warning.includes('at most 5 files per proposal'))
    ).toBe(true)
  })

  it('drops a proposal of the scratch tree that names more files than the limit', async () => {
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: null,
      scratchRoot,
      workspaceRoot,
      readBaseline: async () => 'a\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [
        {
          id: 'p1',
          files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
        }
      ],
      scratchFiles: async () => 'b\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(
      result.warnings.some((warning) => warning.includes('at most 5 files per proposal'))
    ).toBe(true)
  })

  it('takes the proposal from the scratch tree when every proposal of the manifest was dropped', async () => {
    // The agent's work must not be lost because of a manifest defect: a manifest that lost every
    // proposal says nothing the tree cannot say better.
    const { root, read } = await scratchRootWithManifest({
      proposals: [{ id: 'p1', rationale: '这个方案没有标题。' }]
    })
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: read.manifest,
      scratchRoot: root,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.plan.proposals[0].files.map((file) => file.path)).toEqual(['src/foo.ts'])
    expect(result.warnings).toEqual([
      'Proposal p1 was restored from the scratch directory; the agent gave no reason'
    ])
  })

  it('takes no proposal from the scratch tree when the manifest really holds none', async () => {
    // A manifest that holds no proposal is the agent saying it has nothing to show, and it keeps
    // that meaning: the tree is not a second chance for it.
    const { root, read } = await scratchRootWithManifest({ proposals: [] })
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: read.manifest,
      scratchRoot: root,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => [{ id: 'p1', files: ['src/foo.ts'] }],
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.plan.proposals).toHaveLength(0)
    expect(result.warnings).toEqual([])
  })

  it('takes the proposal that fits from the manifest when another one was dropped', async () => {
    // The manifest path stays the manifest path: one bad proposal does not cost the good one its
    // title and its reason, and the tree is not consulted at all.
    const { root, read } = await scratchRootWithManifest({
      proposals: [
        { id: 'p1', title: '提取校验', rationale: '两处规则相同。', files: ['src/foo.ts'] },
        { id: 'p2', rationale: '这个方案没有标题。' }
      ]
    })
    let treeReads = 0
    const result = await buildRefactorPlan({
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      manifest: read.manifest,
      scratchRoot: root,
      workspaceRoot,
      readBaseline: async () => 'a\nb\n',
      readDiskContent: async () => 'a\n',
      listScratchProposals: async () => {
        treeReads += 1
        return [{ id: 'p1', files: ['src/other.ts'] }]
      },
      scratchFiles: async () => 'a\nB\n'
    })
    expect(result.plan.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(result.plan.proposals[0].title).toBe('提取校验')
    expect(result.plan.proposals[0].rationale).toBe('两处规则相同。')
    expect(result.plan.proposals[0].files.map((file) => file.path)).toEqual(['src/foo.ts'])
    expect(treeReads).toBe(0)
    expect(result.warnings).toEqual([])
  })
})
