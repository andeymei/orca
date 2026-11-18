import { useContext } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { basename } from '@/lib/path'
import { getFileTypeIcon } from '@/lib/file-icons/file-type-icons'
import { PromptFileLabelContext } from './prompt-editor-labels'
import { PromptPill } from './PromptPill'

export function PromptFileReferencePill({ node, selected }: NodeViewProps): React.JSX.Element {
  const resolveLabel = useContext(PromptFileLabelContext)
  const path = String(node.attrs.path)
  const token = String(node.attrs.token)
  const resolved = resolveLabel?.(path, token)
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <PromptPill
        icon={resolved?.icon ?? getFileTypeIcon(path)}
        label={resolved?.label ?? basename(path)}
        selected={selected}
        title={resolved ? resolved.title : path}
        data-prompt-file-reference={path}
      />
    </NodeViewWrapper>
  )
}
