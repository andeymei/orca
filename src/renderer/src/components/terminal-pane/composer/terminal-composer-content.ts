import type { DragEvent } from 'react'
import type { JSONContent } from '@tiptap/react'
import { promptHasAttachmentReferences } from '@/components/prompt-editor/prompt-editor-nodes'

// What the composer holds and what it is handed: the body's content, and the files a paste, a
// drag or a drop carries.

/** Whether the draft carries something to send: body text, a file pill or an image pill. */
export function draftHasContent(document: JSONContent): boolean {
  if (promptHasAttachmentReferences(document)) {
    return true
  }
  return documentHasText(document)
}

/** Whether the document carries body text. */
function documentHasText(document: JSONContent): boolean {
  if (document.type === 'text') {
    return (document.text ?? '').trim().length > 0
  }
  return (document.content ?? []).some(documentHasText)
}

/** Whether the clipboard carries files; a text clipboard belongs to the editor. */
export function clipboardCarriesFiles(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData) {
    return false
  }
  if (clipboardData.files && clipboardData.files.length > 0) {
    return true
  }
  const items = clipboardData.items
  return items ? Array.from(items).some((item) => item.kind === 'file') : false
}

/** Whether a drag carries files; a text drag belongs to the editor. */
export function dragCarriesFiles(dataTransfer: DataTransfer | null): boolean {
  const types = dataTransfer?.types
  return types ? Array.from(types).includes('Files') : false
}

/** The paths a drop carries; a browser file without one is not a file the host can read. */
export function terminalComposerDroppedPaths(event: DragEvent): string[] {
  const fs = window.api?.fs
  const getPathForFile = fs && 'getPathForFile' in fs ? fs.getPathForFile : undefined
  if (!getPathForFile) {
    return []
  }
  const paths: string[] = []
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    try {
      const path = getPathForFile(file)
      if (path) {
        paths.push(path)
      }
    } catch {
      // A virtual file has no local path.
    }
  }
  return paths
}
