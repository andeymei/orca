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

  it('replaces the warnings instead of appending to them', () => {
    const registry = createRefactorJobRegistry()
    registry.create({ jobId: 'job-1', scratchRoot: '/repo/.orca/refactor/job-1', worktree: 'wt-1' })
    registry.update('job-1', { warnings: ['w1'] })
    registry.update('job-1', { warnings: ['w2'] })
    expect(registry.get('job-1')?.warnings).toEqual(['w2'])
  })

  it('gives every job its own abort controller', () => {
    const registry = createRefactorJobRegistry()
    const first = registry.create({
      jobId: 'job-1',
      scratchRoot: '/repo/.orca/refactor/job-1',
      worktree: 'wt-1'
    })
    const second = registry.create({
      jobId: 'job-2',
      scratchRoot: '/repo/.orca/refactor/job-2',
      worktree: 'wt-2'
    })
    expect(first.controller).not.toBe(second.controller)
    first.controller.abort()
    expect(first.controller.signal.aborted).toBe(true)
    expect(second.controller.signal.aborted).toBe(false)
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
