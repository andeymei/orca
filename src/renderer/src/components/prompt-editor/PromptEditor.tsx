import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Slice } from '@tiptap/pm/model'
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import {
  PromptFileReference,
  PromptImageReference,
  fileReferenceContent,
  imageReferenceContent,
  promptText,
  promptTextContent,
  withoutImageReferenceNodes
} from './prompt-editor-nodes'

export type PromptEditorInput = {
  /** The editor's text: file pills as their `@path` reference, image pills as their token. */
  readonly value: string
  readonly disabled: boolean
  focus: () => void
  insertText?: (text: string) => void
  insertFileReferences?: (paths: readonly string[]) => void
  insertImageReference?: (attachmentId: string, name: string) => void
  removeImageReferences?: (attachmentId: string) => void
}

export type PromptEditorProps = {
  inputRef: RefObject<PromptEditorInput | null>
  initialDocument: JSONContent
  disabled: boolean
  placeholder: string
  /** The editor owns the document, so it reports it; the text facade alone cannot carry pills. */
  onDocumentChange?: (document: JSONContent) => void
  onChange?: (input: PromptEditorInput) => void
  onSelect?: (input: PromptEditorInput) => void
  className?: string
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  inputRef,
  initialDocument,
  disabled,
  placeholder,
  onDocumentChange,
  onChange,
  onSelect,
  className
}) => {
  const placeholderRef = useRef(placeholder)
  placeholderRef.current = placeholder
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          gapcursor: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          orderedList: false,
          strike: false,
          underline: false,
          trailingNode: false
        }),
        PromptFileReference,
        PromptImageReference,
        // A disabled box still says why it is disabled, as the plain text box's placeholder does.
        Placeholder.configure({
          placeholder: () => placeholderRef.current,
          showOnlyWhenEditable: false
        })
      ],
      content: initialDocument,
      editable: !disabled,
      editorProps: {
        attributes: {
          'data-prompt-editor': 'true',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': placeholder,
          class: `${className ?? ''} whitespace-pre-wrap break-words [&_p]:m-0 [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:pointer-events-none`
        },
        // Clipboard input is always literal text; only the picker and attachments create pills.
        handlePaste: (view, event) => {
          if (event.defaultPrevented) {
            return true
          }
          const text = event.clipboardData?.getData('text/plain')
          if (text == null) {
            return false
          }
          const content = view.state.schema.nodeFromJSON(promptTextContent(text))
          view.dispatch(view.state.tr.replaceSelection(new Slice(content.content, 1, 1)))
          return true
        }
      },
      onUpdate: ({ editor: current }) => {
        onDocumentChange?.(current.getJSON())
        if (inputRef.current) {
          onChange?.(inputRef.current)
        }
      },
      onSelectionUpdate: () => {
        if (inputRef.current) {
          onSelect?.(inputRef.current)
        }
      }
    },
    []
  )

  useLayoutEffect(() => editor?.setEditable(!disabled, false), [disabled, editor])

  const input = useMemo<PromptEditorInput | null>(
    () =>
      editor
        ? {
            get value() {
              return promptText(editor.state.doc)
            },
            get disabled() {
              return !editor.isEditable
            },
            focus: () => editor.commands.focus(),
            insertText: (text) => {
              const content = editor.schema.nodeFromJSON(promptTextContent(text))
              editor.view.dispatch(
                editor.state.tr.replaceSelection(new Slice(content.content, 1, 1))
              )
            },
            insertFileReferences: (paths) => {
              editor.commands.insertContentAt(
                editor.state.selection.from,
                paths.flatMap((path) => [fileReferenceContent(path), { type: 'text', text: ' ' }])
              )
            },
            insertImageReference: (attachmentId, name) => {
              editor.commands.insertContentAt(editor.state.selection.from, [
                imageReferenceContent(attachmentId, name),
                { type: 'text', text: ' ' }
              ])
            },
            removeImageReferences: (attachmentId) => {
              editor.commands.setContent(withoutImageReferenceNodes(editor.getJSON(), attachmentId))
            }
          }
        : null,
    [editor]
  )
  useImperativeHandle(inputRef, () => input!, [input])

  return (
    <EditorContent
      editor={editor}
      data-disabled={disabled || undefined}
      className="data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
    />
  )
}
