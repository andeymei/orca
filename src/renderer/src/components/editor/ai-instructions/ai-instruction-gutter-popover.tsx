import React, { useCallback, useMemo } from 'react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store'
import { aiInstructionFileKey } from '@/store/slices/ai-instructions/ai-instruction-entries'
import { useAiInstructionComments } from '../../diff-comments/use-diff-comment-owner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { WorkspaceResource } from '@/lib/workspace/ownership/workspace-copy-owner'
import type { ResolvedAiInstruction } from './ai-instruction-status'
import { AiInstructionSendMenuBody } from './ai-instruction-send-menu'

const NO_ENTRIES: readonly ResolvedAiInstruction[] = []

/** The popover that opens on an `@ai` instruction's gutter glyph. */
export function AiInstructionGutterPopover(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: { x: number; y: number }
  worktreeId: string | undefined
  noteSource: WorkspaceResource
  relativePath: string
  clickedLineNumber: number | null
}): React.JSX.Element {
  const t = useTranslate()
  const { owner } = useAiInstructionComments(props.worktreeId, props.noteSource)
  const fileKey = props.worktreeId
    ? aiInstructionFileKey(props.worktreeId, props.relativePath)
    : null
  const entries = useAppStore((s) =>
    fileKey ? (s.aiInstructionEntriesByFile[fileKey] ?? NO_ENTRIES) : NO_ENTRIES
  )
  const groupId =
    useAppStore((s) =>
      props.worktreeId ? s.activeGroupIdByWorktree[props.worktreeId] : undefined
    ) ??
    props.worktreeId ??
    ''
  const clicked = useMemo(
    () => entries.find((entry) => entry.lineNumber === props.clickedLineNumber) ?? null,
    [entries, props.clickedLineNumber]
  )
  const markDone = useCallback(() => {
    if (!owner || !clicked?.recordId) {
      return
    }
    void useAppStore.getState().markAiInstructionsCompleted(owner, [clicked.recordId])
  }, [clicked, owner])

  return (
    <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: props.point.x, top: props.point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={0} align="start" className="min-w-[220px]">
        <DropdownMenuLabel variant="instruction" className="max-w-[280px] whitespace-normal">
          {clicked?.instruction}
        </DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sparkles className="size-3.5" />
            {t('components.aiInstruction.sendToAgent', 'Send to agent')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[240px]">
            <AiInstructionSendMenuBody
              worktreeId={props.worktreeId ?? ''}
              groupId={groupId}
              owner={owner}
              filePath={props.relativePath}
              entries={clicked ? [clicked] : NO_ENTRIES}
              currentInstructions={entries}
              scope="single"
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {clicked?.status === 'dispatched' && clicked.recordId ? (
          <DropdownMenuItem onSelect={markDone}>
            <CheckCircle2 className="size-3.5" />
            {t('components.aiInstruction.markDone', 'Mark as done')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
