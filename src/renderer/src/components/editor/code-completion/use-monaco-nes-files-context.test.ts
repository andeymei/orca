// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { buildWorkspaceFileContextForFileMock } = vi.hoisted(() => ({
  buildWorkspaceFileContextForFileMock: vi.fn()
}))

vi.mock('@/runtime/files/workspace-file-host-routing', () => ({
  buildWorkspaceFileContextForFile: buildWorkspaceFileContextForFileMock
}))
vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: { getKnownWorktreeById: (id: string) => { path: string } }) => unknown
  ) => selector({ getKnownWorktreeById: () => ({ path: '/repo' }) })
}))

import { useMonacoNesFilesContext } from './use-monaco-nes-files-context'

describe('useMonacoNesFilesContext', () => {
  it('builds the context of the file own workspace', () => {
    const context = { target: { kind: 'local' }, worktreeId: 'wt-1', worktreePath: '/repo' }
    buildWorkspaceFileContextForFileMock.mockReturnValue(context)

    const { result } = renderHook(() =>
      useMonacoNesFilesContext({ worktreeId: 'wt-1', filePath: '/repo/src/app.ts' })
    )

    expect(result.current).toEqual(context)
    expect(buildWorkspaceFileContextForFileMock).toHaveBeenCalledWith(
      'wt-1',
      '/repo',
      '/repo/src/app.ts'
    )
  })

  it('records why the owner could not be resolved', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    buildWorkspaceFileContextForFileMock.mockImplementation(() => {
      throw new Error('the owner is ambiguous')
    })

    const { result } = renderHook(() =>
      useMonacoNesFilesContext({ worktreeId: 'wt-1', filePath: '/repo/src/app.ts' })
    )

    expect(result.current).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      '[code-completion] The file owner is unresolved; the related files stay out.',
      { error: 'Error' }
    )
    errorSpy.mockRestore()
  })
})
