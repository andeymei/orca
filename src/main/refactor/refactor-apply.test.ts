import { describe, expect, it } from 'vitest'
import { applyRefactorSelection } from './refactor-apply'
import type { RefactorFileReadResult } from './refactor-file-reads'
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

/** The file's current disk content. */
function readsContent(content: string): () => Promise<RefactorFileReadResult> {
  return async () => ({ status: 'read', content })
}

describe('applyRefactorSelection', () => {
  it('writes the file when the accepted hunk matches the current content', async () => {
    const writes: { path: string; content: string }[] = []
    const preconditions: { expectedSignature: string; allowMissing: boolean }[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: readsContent(original),
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
      readCurrent: readsContent('disk\n'),
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
      readCurrent: readsContent(original),
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
      readCurrent: readsContent('a\nCHANGED\nc\n'),
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
      readCurrent: readsContent(original),
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
      readCurrent: readsContent(original),
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
      readCurrent: readsContent(original),
      write: async (path) => {
        writes.push(path)
        return true
      }
    })
    expect(writes).toEqual(['src/foo.ts'])
  })

  it('refuses to apply the same hunks twice', async () => {
    // The first apply leaves the refactored text on disk, which is neither the content the plan
    // was built against nor the baseline, so the second apply is refused instead of applied again.
    let disk = original
    const first = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => ({ status: 'read', content: disk }),
      write: async (_path, content) => {
        disk = content
        return true
      }
    })
    expect(first.applied).toEqual([{ path: 'src/foo.ts', hunksApplied: 1 }])

    const second = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => ({ status: 'read', content: disk }),
      write: async () => true
    })
    expect(second.applied).toEqual([])
    expect(second.refusals[0].reason).toContain('改动过')
  })

  it('names a file that cannot be read instead of calling it deleted', async () => {
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => ({ status: 'unreadable', reason: '文件过大，无法安全读取' }),
      write: async () => true
    })
    expect(result.applied).toEqual([])
    expect(result.refusals).toEqual([{ path: 'src/foo.ts', reason: '文件过大，无法安全读取' }])
  })

  it('names a file that is gone', async () => {
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      readCurrent: async () => ({ status: 'missing' }),
      write: async () => true
    })
    expect(result.refusals).toEqual([{ path: 'src/foo.ts', reason: '文件已被删除' }])
  })

  it('refuses the files that were not written when the task is cancelled', async () => {
    // The abort lands while the first file is written: that write cannot be un-written, and the
    // second file must say it was cancelled rather than that it changed under the user.
    const controller = new AbortController()
    const writes: string[] = []
    const result = await applyRefactorSelection({
      plan: {
        jobId: 'job-1',
        sourcePath: 'src/foo.ts',
        proposals: [
          {
            id: 'p1',
            title: 't',
            rationale: 'r',
            files: [
              { path: 'src/foo.ts', originalContent: original, hunks },
              { path: 'src/bar.ts', originalContent: original, hunks }
            ]
          }
        ]
      },
      diskContents: new Map([
        ['src/foo.ts', original],
        ['src/bar.ts', original]
      ]),
      acceptedHunkIds: [hunks[0].id],
      signal: controller.signal,
      readCurrent: readsContent(original),
      write: async (path) => {
        writes.push(path)
        controller.abort()
        return true
      }
    })
    expect(writes).toEqual(['src/foo.ts'])
    expect(result.applied).toEqual([{ path: 'src/foo.ts', hunksApplied: 1 }])
    expect(result.refusals).toEqual([
      { path: 'src/bar.ts', reason: '重构任务已取消，该文件未写入' }
    ])
  })

  it('writes nothing when the task was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const writes: string[] = []
    const result = await applyRefactorSelection({
      plan,
      diskContents: new Map([['src/foo.ts', original]]),
      acceptedHunkIds: [hunks[0].id],
      signal: controller.signal,
      readCurrent: readsContent(original),
      write: async (path) => {
        writes.push(path)
        return true
      }
    })
    expect(writes).toEqual([])
    expect(result.applied).toEqual([])
    expect(result.refusals).toEqual([
      { path: 'src/foo.ts', reason: '重构任务已取消，该文件未写入' }
    ])
  })
})
