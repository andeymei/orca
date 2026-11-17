import { Node, type JSONContent } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { formatNativeChatFileReference } from '../../../../shared/agent-image-paste'
import { imageReferenceToken } from '../../../../shared/native-chat/native-chat-image-reference'

/** Persisted in native chat's IndexedDB drafts; renaming orphans every saved pill. */
export const FILE_REFERENCE_NODE = 'nativeChatFileReference'
export const IMAGE_REFERENCE_NODE = 'nativeChatImageReference'

export const PromptFileReference = Node.create({
  name: FILE_REFERENCE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ token: { default: '' }, path: { default: '' } }),
  renderText: ({ node }) => node.attrs.token,
  renderHTML: ({ node }) => ['span', { 'data-prompt-file-reference': node.attrs.path }]
})

export const PromptImageReference = Node.create({
  name: IMAGE_REFERENCE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ attachmentId: { default: '' }, name: { default: '' } }),
  renderText: ({ node }) => imageReferenceToken(node.attrs.attachmentId),
  renderHTML: ({ node }) => ['span', { 'data-prompt-image-reference': node.attrs.attachmentId }]
})

/** A pill reads as its token and a hard break as a newline, so the text is what the agent receives. */
export function promptLeafString(
  type: string | undefined,
  attrs: Readonly<Record<string, unknown>> | undefined,
  text?: string | null
): string {
  if (type === 'hardBreak') {
    return '\n'
  }
  if (type === IMAGE_REFERENCE_NODE) {
    return imageReferenceToken(String(attrs?.attachmentId))
  }
  if (type === FILE_REFERENCE_NODE) {
    return String(attrs?.token ?? '')
  }
  return text ?? String(attrs?.token ?? '')
}

export function promptText(doc: ProseMirrorNode, from = 0, to = doc.content.size): string {
  return doc.textBetween(from, to, '\n', (node) =>
    promptLeafString(node.type.name, node.attrs, node.text)
  )
}

export function promptTextContent(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      // ProseMirror rejects empty text nodes, so a blank line stays an empty paragraph.
      content: line ? [{ type: 'text', text: line }] : []
    }))
  }
}

export function fileReferenceContent(path: string): JSONContent {
  return {
    type: PromptFileReference.name,
    attrs: { token: formatNativeChatFileReference(path), path }
  }
}

export function imageReferenceContent(attachmentId: string, name: string): JSONContent {
  return {
    type: PromptImageReference.name,
    attrs: { attachmentId, name }
  }
}

/** Files or images attached inline as pills. */
export function promptHasAttachmentReferences(document: JSONContent | undefined): boolean {
  return (
    document !== undefined &&
    (document.type === FILE_REFERENCE_NODE ||
      document.type === IMAGE_REFERENCE_NODE ||
      (document.content ?? []).some(promptHasAttachmentReferences))
  )
}

const sameMarks = (a: JSONContent, b: JSONContent): boolean =>
  JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? [])

/** ProseMirror holds one text node per run, so dropping a chip splits its run in two. */
function joinTextRuns(nodes: JSONContent[]): JSONContent[] {
  const joined: JSONContent[] = []
  for (const node of nodes) {
    const previous = joined.at(-1)
    if (previous?.type === 'text' && node.type === 'text' && sameMarks(previous, node)) {
      joined[joined.length - 1] = { ...previous, text: `${previous.text ?? ''}${node.text ?? ''}` }
      continue
    }
    joined.push(node)
  }
  return joined
}

/** The document side of removing an image chip; the text around it keeps its spaces. */
export function withoutImageReferenceNodes(
  document: JSONContent,
  attachmentId: string
): JSONContent {
  const isChip = (node: JSONContent | undefined): boolean =>
    node?.type === IMAGE_REFERENCE_NODE && node.attrs?.attachmentId === attachmentId
  return document.content
    ? {
        ...document,
        content: joinTextRuns(
          document.content.flatMap((node) =>
            isChip(node) ? [] : [withoutImageReferenceNodes(node, attachmentId)]
          )
        )
      }
    : document
}
