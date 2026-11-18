// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { createRef, type RefObject } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { PromptEditor, type PromptEditorInput } from './PromptEditor'
import { PromptImageLabelContext } from './prompt-editor-labels'
import { fileReferenceContent, imageReferenceContent } from './prompt-editor-nodes'

afterEach(cleanup)

const resolveImageLabel = () => ({ label: 'shot.png', missing: false })

const emptyDocument: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

function renderEditor(
  initialDocument: JSONContent = emptyDocument,
  inputRef = createRef<PromptEditorInput>()
): { inputRef: RefObject<PromptEditorInput | null> } {
  render(
    <PromptEditor
      inputRef={inputRef}
      initialDocument={initialDocument}
      disabled={false}
      placeholder="Message"
    />
  )
  return { inputRef }
}

describe('prompt editor', () => {
  it('renders a file pill as the attachment it names', async () => {
    renderEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [fileReferenceContent('/tmp/a.txt')] }]
    })
    expect(await screen.findByText('a.txt')).toBeVisible()
  })

  it('shows the image pill the label resolver names', async () => {
    render(
      <PromptImageLabelContext.Provider value={resolveImageLabel}>
        <PromptEditor
          inputRef={createRef<PromptEditorInput>()}
          initialDocument={{
            type: 'doc',
            content: [{ type: 'paragraph', content: [imageReferenceContent('a1', 'shot.png')] }]
          }}
          disabled={false}
          placeholder="Message"
        />
      </PromptImageLabelContext.Provider>
    )
    expect(await screen.findByText('shot.png')).toBeVisible()
  })

  it('inserts a file pill at the caret', async () => {
    const { inputRef } = renderEditor()
    await act(async () => {
      inputRef.current!.focus()
      inputRef.current!.insertFileReferences?.(['/tmp/a.txt'])
    })
    expect(inputRef.current!.value).toContain('@/tmp/a.txt')
  })

  it('keeps an image pill in the text as the token the sender splits out', async () => {
    const { inputRef } = renderEditor()
    await act(async () => {
      inputRef.current!.insertImageReference?.('a1', 'shot.png')
    })
    expect(inputRef.current!.value).toContain('[Image](orca-image:a1)')
  })

  it('drops the image pill when its attachment goes', async () => {
    const { inputRef } = renderEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [imageReferenceContent('a1', 'shot.png')] }]
    })
    expect(await screen.findByText('shot.png')).toBeVisible()
    await act(async () => {
      inputRef.current!.removeImageReferences?.('a1')
    })
    expect(inputRef.current!.value).toBe('')
    expect(screen.queryByText('shot.png')).toBeNull()
  })
})
