import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { buildWorkspaceFileContextForFile } from '@/runtime/files/workspace-file-host-routing'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'

/**
 * The workspace the file belongs to, for the related-file search. It is built per file, because a
 * folder workspace may span hosts and two files of one workspace can have different owners.
 */
export function useMonacoNesFilesContext(params: {
  worktreeId: string | undefined
  filePath: string
}): RuntimeFileOperationArgs | null {
  const { worktreeId, filePath } = params
  // Why: a workspace the store does not know has no root, which costs the symbol search only.
  const worktreePath = useAppStore((state) =>
    worktreeId ? (state.getKnownWorktreeById(worktreeId)?.path ?? null) : null
  )
  return useMemo(() => {
    try {
      // Why: no runtime environment id, so the workspace owner decides which host holds the file.
      return buildWorkspaceFileContextForFile(worktreeId ?? '', worktreePath ?? '', filePath)
    } catch (error) {
      // Why: an unresolvable owner means the file cannot be read; the editor must still render.
      console.error('[code-completion] The file owner is unresolved; the related files stay out.', {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      })
      return null
    }
  }, [worktreeId, worktreePath, filePath])
}
