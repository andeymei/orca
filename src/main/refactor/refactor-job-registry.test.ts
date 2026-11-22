import { describe, expect, it } from 'vitest'
import { createRefactorJobRegistry } from './refactor-job-registry'

describe('the refactor job registry', () => {
  it('starts a job in the running state', () => {
    const registry = createRefactorJobRegistry()
    const job = registry.create({
      jobId: 'job-1',
      scratchRoot: '/repo/.orca/refactor/job-1',
      worktree: 'wt-1'
    })
    expect(job.state).toBe('running')
    expect(registry.get('job-1')).toBe(job)
  })

  it('updates the progress and the warnings', () => {
    const registry = createRefactorJobRegistry()
    registry.create({ jobId: 'job-1', scratchRoot: '/repo/.orca/refactor/job-1', worktree: 'wt-1' })
    registry.update('job-1', { progress: '正在读取 src/foo.ts', warnings: ['w'] })
    expect(registry.get('job-1')?.progress).toBe('正在读取 src/foo.ts')
    expect(registry.get('job-1')?.warnings).toEqual(['w'])
  })

  it('carries the baseline of the target file from the start', () => {
    const registry = createRefactorJobRegistry()
    const job = registry.create({
      jobId: 'job-1',
      scratchRoot: '/repo/.orca/refactor/job-1',
      worktree: 'wt-1',
      baselines: new Map([['src/foo.ts', 'a\n']])
    })
    expect(job.baselines.get('src/foo.ts')).toBe('a\n')
  })

  it('returns null for an unknown job', () => {
    expect(createRefactorJobRegistry().get('nope')).toBeNull()
  })

  it('removes a job', () => {
    const registry = createRefactorJobRegistry()
    registry.create({ jobId: 'job-1', scratchRoot: '/x', worktree: 'wt-1' })
    registry.remove('job-1')
    expect(registry.get('job-1')).toBeNull()
  })

  it('ignores an update for a job that is already gone', () => {
    const registry = createRefactorJobRegistry()
    registry.create({ jobId: 'job-1', scratchRoot: '/x', worktree: 'wt-1' })
    registry.remove('job-1')
    expect(() => registry.update('job-1', { progress: 'late' })).not.toThrow()
    expect(registry.get('job-1')).toBeNull()
  })
})
