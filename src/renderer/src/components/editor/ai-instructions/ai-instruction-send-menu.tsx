import React, { useCallback, useMemo, useState } from 'react'
import { CheckIcon, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store'
import type { DiffCommentOwner } from '@/store/slices/diff-comments/diff-comment-owner'
import { aiInstructionFileKey } from '@/store/slices/ai-instructions/ai-instruction-entries'
import { useAiInstructionComments } from '../../diff-comments/use-diff-comment-owner'
import type { WorkspaceCopySource } from '@/lib/workspace/ownership/workspace-copy-owner'
import {
  formatAiInstructionBatchPrompt,
  formatAiInstructionPrompt
} from '../../../../../shared/ai-instruction-prompt'
import {
  ReviewNotesSendMenuContent,
  type AiInstructionDeliveryContext
} from '../review-note-delivery/ReviewNotesSendMenuContent'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { ResolvedAiInstruction } from './ai-instruction-status'

// The send menu owns the dispatch; these callers have nothing left to do once it lands.
const IGNORE_DELIVERY = (): void => {}

export type AiInstructionSendMenuProps = {
  worktreeId: string
  groupId: string
  /** The copy the records belong to; without it the dispatch writes no record. */
  owner: DiffCommentOwner | null
  /** The relative path of the file the instructions belong to. */
  filePath: string
  /** The instructions this send carries. */
  entries: readonly ResolvedAiInstruction[]
  /** Every instruction of the file, so the dispatch can prune the file's orphan records. */
  currentInstructions: readonly ResolvedAiInstruction[]
  scope: 'single' | 'batch'
  /** The prompt reached an agent; the context names the panel that took it, when there is one. */
  onDelivered: (
    entries: readonly ResolvedAiInstruction[],
    context?: AiInstructionDeliveryContext
  ) => void
  /** Given the delivery result while the prompt is still on its way. */
  onPromptHandedOff?: (delivered: Promise<unknown>) => void
  /** The button that opens the menu; it must be a single element that takes a ref. */
  trigger?: React.ReactNode
}

/** The prompt that carries the instructions of one file to an agent. */
function buildAiInstructionPrompt(args: {
  filePath: string
  entries: readonly ResolvedAiInstruction[]
  scope: 'single' | 'batch'
}): string {
  const first = args.entries[0]
  if (!first) {
    return ''
  }
  if (args.scope === 'single') {
    return formatAiInstructionPrompt({
      filePath: args.filePath,
      lineNumber: first.lineNumber,
      instruction: first.instruction,
      contextStartLine: first.contextStartLine,
      contextEndLine: first.contextEndLine,
      contextExcerpt: first.contextExcerpt
    })
  }
  return formatAiInstructionBatchPrompt({
    filePath: args.filePath,
    instructions: args.entries.map((entry) => ({
      lineNumber: entry.lineNumber,
      instruction: entry.instruction
    }))
  })
}

/** Writes the records of the dispatched instructions and drops the file's orphan records. */
async function writeAiInstructionDispatch(args: {
  owner: DiffCommentOwner | null
  filePath: string
  entries: readonly ResolvedAiInstruction[]
  currentInstructions: readonly ResolvedAiInstruction[]
  context?: AiInstructionDeliveryContext
}): Promise<void> {
  const { owner, filePath, entries, currentInstructions, context } = args
  if (!owner) {
    console.error('AI instruction dispatch has no comment owner, so no record was written')
    return
  }
  await useAppStore.getState().markAiInstructionsDispatched(
    owner,
    entries.map((entry) => ({
      filePath,
      lineNumber: entry.lineNumber,
      body: entry.instruction,
      selectedText: entry.contextExcerpt,
      dispatchedPaneKey: context?.paneKey
    })),
    { currentInstructions }
  )
}

/** The agent target list that carries the instructions to an agent. */
export function AiInstructionSendMenuBody(props: AiInstructionSendMenuProps): React.JSX.Element {
  const { owner, filePath, entries, currentInstructions, onDelivered, onPromptHandedOff } = props
  const prompt = useMemo(
    () => buildAiInstructionPrompt({ filePath, entries, scope: props.scope }),
    [filePath, entries, props.scope]
  )
  const handleDelivered = useCallback(
    (context?: AiInstructionDeliveryContext) => {
      void writeAiInstructionDispatch({
        owner,
        filePath,
        entries,
        currentInstructions,
        context
      })
      onDelivered(entries, context)
    },
    [currentInstructions, entries, filePath, onDelivered, owner]
  )
  const handlePromptHandedOff = useCallback(
    (delivered: Promise<unknown>) => {
      onPromptHandedOff?.(delivered)
    },
    [onPromptHandedOff]
  )
  return (
    <ReviewNotesSendMenuContent
      worktreeId={props.worktreeId}
      groupId={props.groupId}
      prompt={prompt}
      promptDelivery="submit-after-ready"
      launchSource="ai_instruction_send"
      onPromptDelivered={handleDelivered}
      onPromptHandedOff={handlePromptHandedOff}
    />
  )
}

/** The menu that sends the instructions of a file to an agent. */
export function AiInstructionSendMenu(props: AiInstructionSendMenuProps): React.JSX.Element {
  const t = useTranslate()
  const [includeDispatched, setIncludeDispatched] = useState(false)
  const dispatchedEntries = useMemo(
    () => props.currentInstructions.filter((entry) => entry.status === 'dispatched'),
    [props.currentInstructions]
  )
  const sentEntries = useMemo(() => {
    if (props.scope !== 'batch' || !includeDispatched) {
      return props.entries
    }
    const sentLines = new Set(props.entries.map((entry) => entry.lineNumber))
    return [
      ...props.entries,
      ...dispatchedEntries.filter((entry) => !sentLines.has(entry.lineNumber))
    ]
  }, [dispatchedEntries, includeDispatched, props.entries, props.scope])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{props.trigger ?? <SendToAgentTrigger />}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {props.scope === 'batch' && dispatchedEntries.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="[&>svg:last-child]:ml-0">
              {includeDispatched ? <CheckIcon className="size-3.5" /> : null}
              <span className="truncate">
                {t('components.aiInstruction.includeDispatched', 'Include dispatched instructions')}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {dispatchedEntries.length}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuCheckboxItem
                checked={includeDispatched}
                onCheckedChange={(checked) => setIncludeDispatched(checked === true)}
                // Why: ticking the box must not close the menu, or the target list is gone.
                onSelect={(event) => event.preventDefault()}
              >
                {t(
                  'components.aiInstruction.includeDispatchedCount',
                  'Also send {{count}} dispatched instructions',
                  { count: dispatchedEntries.length }
                )}
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <AiInstructionSendMenuBody {...props} entries={sentEntries} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The trigger of a send menu that names no count. */
function SendToAgentTrigger({ ref }: { ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  const t = useTranslate()
  return (
    <button
      ref={ref}
      type="button"
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] font-medium leading-none text-foreground/80 hover:bg-accent hover:text-foreground"
    >
      <Sparkles className="size-3 text-violet-500 dark:text-violet-400" />
      {t('components.aiInstruction.sendToAgent', 'Send to agent')}
    </button>
  )
}

/**
 * The header button that sends the file's pending instructions to an agent. It hides itself
 * when the file has nothing pending.
 */
export function AiInstructionBatchSendMenu(props: {
  worktreeId: string
  groupId: string
  /** The tab the file is open in; the instruction records belong to the copy it names. */
  source: WorkspaceCopySource
  filePath: string
}): React.JSX.Element | null {
  const { owner } = useAiInstructionComments(props.worktreeId, props.source)
  const entries = useAppStore((s) =>
    s.getAiInstructionEntries(aiInstructionFileKey(props.worktreeId, props.filePath))
  )
  const pending = useMemo(() => entries.filter((entry) => entry.status === 'pending'), [entries])
  if (pending.length === 0) {
    return null
  }
  return (
    <AiInstructionSendMenu
      worktreeId={props.worktreeId}
      groupId={props.groupId}
      owner={owner}
      filePath={props.filePath}
      entries={pending}
      currentInstructions={entries}
      scope="batch"
      onDelivered={IGNORE_DELIVERY}
      trigger={<AiInstructionSendMenuButton count={pending.length} />}
    />
  )
}

/** The header button that opens the batch send menu. */
function AiInstructionSendMenuButton({
  count,
  ref
}: {
  count: number
  /** The menu trigger anchors to this button, so the ref has to reach the element. */
  ref?: React.Ref<HTMLButtonElement>
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        'h-6 shrink-0 gap-1 rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] font-medium leading-none text-foreground/80'
      )}
      title={t('components.aiInstruction.headerTitle', 'AI instructions ({{count}})', { count })}
      aria-label={t('components.aiInstruction.headerTitle', 'AI instructions ({{count}})', {
        count
      })}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Sparkles className="size-3 text-violet-500 dark:text-violet-400" />
      <span className="whitespace-nowrap">
        {t('components.aiInstruction.headerLabel', 'AI instructions')}
      </span>
      <span className="rounded-full bg-background/80 px-1 text-[10px] tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  )
}
