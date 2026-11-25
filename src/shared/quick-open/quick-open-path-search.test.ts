import { describe, expect, it } from 'vitest'

import { prepareQuickOpenFiles, rankQuickOpenFiles } from './quick-open-path-search'

describe('rankQuickOpenFiles', () => {
  it('ranks an authored file ahead of a build artifact with the same name', () => {
    const files = prepareQuickOpenFiles(['build/generated/job.js', 'src/core/job.js'])
    const ranked = rankQuickOpenFiles('job', files, 10).map((result) => result.path)
    expect(ranked).toEqual(['src/core/job.js', 'build/generated/job.js'])
  })

  it('keeps build artifacts reachable when they are the only match', () => {
    const files = prepareQuickOpenFiles(['dist/bundle.js'])
    expect(rankQuickOpenFiles('bundle', files, 10).map((result) => result.path)).toEqual([
      'dist/bundle.js'
    ])
  })

  it('ranks authored files ahead of vendored and generated paths', () => {
    const files = prepareQuickOpenFiles([
      'node_modules/pkg/job.js',
      'third_party/job.cpp',
      'dist/job.js',
      'src/job.ts'
    ])
    const ranked = rankQuickOpenFiles('job', files, 10).map((result) => result.path)
    expect(ranked[0]).toBe('src/job.ts')
    expect(ranked).toHaveLength(4)
  })
})
