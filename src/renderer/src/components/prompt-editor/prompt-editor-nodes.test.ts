import { describe, expect, it } from 'vitest'
import {
  FILE_REFERENCE_NODE,
  IMAGE_REFERENCE_NODE,
  fileReferenceContent,
  promptHasAttachmentReferences,
  promptLeafString,
  promptTextContent,
  withoutImageReferenceNodes
} from './prompt-editor-nodes'

describe('prompt editor nodes', () => {
  it('serializes a file pill as an @path reference', () => {
    expect(
      promptLeafString(FILE_REFERENCE_NODE, { token: '@/tmp/a.txt', path: '/tmp/a.txt' })
    ).toBe('@/tmp/a.txt')
  })

  it('quotes a file path that carries whitespace or an @', () => {
    expect(fileReferenceContent('/tmp/my file.txt').attrs?.token).toBe('@"/tmp/my file.txt"')
    expect(fileReferenceContent('/tmp/a@b.txt').attrs?.token).toBe('@"/tmp/a@b.txt"')
  })

  it('quotes a windows path that carries spaces', () => {
    expect(fileReferenceContent('C:\\Users\\A B\\a.txt').attrs?.token).toBe(
      '@"C:\\Users\\A B\\a.txt"'
    )
  })

  it('serializes an image pill as its token', () => {
    expect(promptLeafString(IMAGE_REFERENCE_NODE, { attachmentId: 'a1', name: 'shot.png' })).toBe(
      '[Image](orca-image:a1)'
    )
  })

  it('reads a hard break as a newline', () => {
    expect(promptLeafString('hardBreak', undefined, null)).toBe('\n')
  })

  it('keeps a blank line as an empty paragraph', () => {
    // ProseMirror rejects empty text nodes, so a blank line must not become one.
    expect(promptTextContent('a\n\nb')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }
      ]
    })
  })

  it('removes an image pill and keeps the spaces around it', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'look at ' },
            { type: IMAGE_REFERENCE_NODE, attrs: { attachmentId: 'a1', name: 'shot.png' } },
            { type: 'text', text: ' please' }
          ]
        }
      ]
    }
    expect(withoutImageReferenceNodes(document, 'a1')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'look at  please' }] }]
    })
  })

  it('finds an attachment reference anywhere in the document', () => {
    const document = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [fileReferenceContent('/tmp/a.txt')] }]
    }
    expect(promptHasAttachmentReferences(document)).toBe(true)
    expect(promptHasAttachmentReferences(promptTextContent('plain'))).toBe(false)
  })
})
