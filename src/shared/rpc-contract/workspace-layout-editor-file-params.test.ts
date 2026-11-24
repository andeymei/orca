import { describe, expect, it } from 'vitest'
import { LayoutApplyParams } from './workspace-layout/workspace-layout-params'

const open = (view: unknown) => ({
  command: {
    type: 'openEditorTab',
    workspace: 'wt-1',
    tabId: 'wt-1::diff::unstaged::a.ts',
    fileId: 'wt-1::diff::unstaged::a.ts',
    contentType: 'diff',
    view
  }
})

const FILE = { filePath: '/repo/a.ts', relativePath: 'a.ts', language: 'typescript' }

describe("layout.apply's editor view", () => {
  it('refuses an unknown mode, an edit view without its conflict, or a view without a file', () => {
    for (const view of [
      { view: { mode: 'terminal' }, file: FILE },
      { view: { mode: 'edit' }, file: FILE },
      { view: { mode: 'diff' } }
    ]) {
      expect(LayoutApplyParams.safeParse(open(view)).success).toBe(false)
    }
  })

  it('accepts a refactor-review tab with its view', () => {
    const result = LayoutApplyParams.safeParse({
      command: {
        type: 'openEditorTab',
        workspace: 'wt-1',
        tabId: 'wt-1::refactor-review:job-1',
        fileId: 'wt-1::refactor-review:job-1',
        contentType: 'refactor-review',
        view: {
          view: {
            mode: 'refactor-review',
            refactorReview: { jobId: 'job-1', worktreeId: 'wt-1', relativePath: 'a.ts' }
          },
          file: FILE
        }
      }
    })

    expect(result.success).toBe(true)
  })
})
