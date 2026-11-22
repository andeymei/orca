import { describe, expect, it } from 'vitest'
import { applyRefactorSelection } from './refactor-apply'
import { computeRefactorHunks } from '../../shared/refactor/refactor-hunk-computation'
import { getDiskBaselineSignature } from '../../shared/file-write/disk-baseline-signature'

const original = 'a\nb\nc\n'
const modified = 'A\nb\nC\n'
const hunks = computeRefactorHunks(original, modified)

const plan = {
  jobId: 'job-1',
  sourcePath: 'src/foo.ts',
  proposals: [
    {
      id: 'p1',
      title: 't',
      rationale: 'r',
      files: [{ path: 'src/foo.ts', originalContent: original, hunks }]
    }
  ]
}

describe('applyRefactorSelection', () => {
  it('writes the file when the accepted hunk matches the current content', async () => {
    const writes: { path: string; content: string }[] = []
    const preconditions: { expectedSignature: string; allowMissing: boolean }[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => original,
      write: async (path, content, precondition) => {
        writes.push({ path, content })
        preconditions.push(precondition)
        return true
      }
    })
    expect(writes).toEqual([{ path: 'src/foo.ts', content: 'A\nb\nc\n' }])
    expect(result.applied).toEqual([{ path: 'src/foo.ts', hunksApplied: 1 }])
    // 前置条件描述的是**读到的**那份磁盘内容，不是要写进去的新内容——
    // 写错的话每次写都会被拒，功能直接废掉。
    expect(preconditions[0].expectedSignature).toBe(getDiskBaselineSignature(original))
  })

  it('writes the file when the disk still holds the content the plan was built against', async () => {
    // 缓冲区有未保存修改：基准文本 B 与磁盘内容 D 不同，但磁盘没被人动过。
    const writes: { path: string; content: string }[] = []
    await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', 'disk\n']]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => 'disk\n',
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes).toHaveLength(1)
  })

  it('writes the file when the user saved the buffer during the review', async () => {
    const writes: { path: string; content: string }[] = []
    await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', 'disk\n']]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => original,
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes).toHaveLength(1)
  })

  it('refuses to write when the file changed since the plan was built', async () => {
    const writes: string[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => 'a\nCHANGED\nc\n',
      write: async (path) => {
        writes.push(path)
        return true
      }
    })
    expect(writes).toEqual([])
    expect(result.refusals.length).toBe(1)
  })

  it('applies only the accepted hunks of a file', async () => {
    const writes: { path: string; content: string }[] = []
    await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[1].id],
      readCurrent: async () => original,
      write: async (path, content) => {
        writes.push({ path, content })
        return true
      }
    })
    expect(writes[0].content).toBe('a\nb\nC\n')
  })

  it('leaves a file with no accepted hunk alone', async () => {
    const writes: string[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [],
      readCurrent: async () => original,
      write: async (path) => {
        writes.push(path)
        return true
      }
    })
    expect(writes).toEqual([])
    expect(result.applied).toEqual([])
    expect(result.refusals).toEqual([])
  })

  it('keeps the hunks of two files apart', async () => {
    // The accepted set is flat, so the id has to name the file it belongs to.
    const otherHunks = computeRefactorHunks(original, modified, 'src/bar.ts:')
    const twoFilePlan = {
      jobId: 'job-1',
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: 't',
          rationale: 'r',
          files: [
            { path: 'src/foo.ts', originalContent: original, hunks },
            { path: 'src/bar.ts', originalContent: original, hunks: otherHunks }
          ]
        }
      ]
    }
    const writes: string[] = []
    await applyRefactorSelection({
      plan: twoFilePlan,
      diskContents: new Map([
        ['src/foo.ts', original],
        ['src/bar.ts', original]
      ]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => original,
      write: async (path) => {
        writes.push(path)
        return true
      }
    })
    expect(writes).toEqual(['src/foo.ts'])
  })
})
