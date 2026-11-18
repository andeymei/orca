import type { JSONContent } from '@tiptap/react'
import { promptHasAttachmentReferences } from '@/components/prompt-editor/prompt-editor-nodes'

// What the composer holds and what it is handed: the body's content, and the files a paste
// carries.

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
