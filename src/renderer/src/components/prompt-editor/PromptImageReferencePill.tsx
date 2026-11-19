import { useContext } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ImageIcon, ImageOff } from 'lucide-react'
import { PromptImageLabelContext } from './prompt-editor-labels'
import { PromptPill } from './PromptPill'

export function PromptImageReferencePill({ node, selected }: NodeViewProps): React.JSX.Element {
  const resolveLabel = useContext(PromptImageLabelContext)
  const attachmentId = String(node.attrs.attachmentId)
  const resolved = resolveLabel?.(attachmentId)
  // Without a resolver the editor cannot know whether the image is still there.
  const missing = resolved?.missing ?? true
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <PromptPill
        icon={missing ? ImageOff : ImageIcon}
        label={resolved?.label ?? String(node.attrs.name)}
        selected={selected}
        data-prompt-image-reference={attachmentId}
      />
    </NodeViewWrapper>
  )
}
