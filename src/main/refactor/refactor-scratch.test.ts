import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  refactorScratchParentRoot,
  refactorScratchRelativeRoot,
  refactorScratchRoot
} from './refactor-scratch'

describe('refactorScratchRoot', () => {
  it('agrees with the relative spelling of the same directory', () => {
    // The prompt names the relative root and the gate names the absolute one; when they are not
    // the same directory every agent write is refused and no manifest is ever read.
    expect(refactorScratchRoot('/repo', 'job-1')).toBe(
      path.join('/repo', refactorScratchRelativeRoot('job-1'))
    )
  })

  it('keeps the scratch tree inside the workspace', () => {
    expect(refactorScratchRoot('/repo', 'job-1')).toBe(
      path.join('/repo', '.orca', 'refactor', 'job-1')
    )
  })

  it('names the parent of every job directory', () => {
    expect(refactorScratchParentRoot('/repo')).toBe(path.join('/repo', '.orca', 'refactor'))
  })
})
