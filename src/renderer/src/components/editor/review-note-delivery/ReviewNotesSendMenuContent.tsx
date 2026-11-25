import {
  useAppStateValue,
  useAppStateView,
  useAppStateViewActive
} from '@/store/retained-views/app-state-view'
import { selectSendApprovalGuardEnvironmentIds } from '@/runtime/hosts/capabilities/send-approval-guard-hosts'
import type { RuntimeStatuses } from '@/store/slices/runtime-status/views/runtime-status-owner'
import { useAppStateValueWithHostStatuses } from '@/store/slices/runtime-status/views/use-runtime-status-view'
import { toast } from 'sonner'
import { shallow } from 'zustand/shallow'
import { useShallow } from 'zustand/react/shallow'
import {
  selectLiveAgentStatusEntriesForWorktree,
  selectTerminalLayoutsForWorktree
} from '@/components/sidebar/workspace-card/activity/worktree-agent-row-selectors'
import {
  selectRuntimePaneTitlesForWorktree,
  selectLivePtyIdsForWorktree
} from '@/components/sidebar/workspace-card/activity/worktree-card-status-inputs'
import { useAppStore } from '@/store/index'
import { selectKnownWorktreeById } from '@/store/workspaces/selection/known-worktree-selection'
import {
  useWorktreeStructuredChatTabNames,
  getStructuredChatTabNames
} from '@/runtime/native-chat/naming/structured-chat-name-observation'
import { QuickLaunchAgentMenuItems } from '@/components/agent/launch-menu/AgentMenuItems'
import { DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { focusTerminalTabSurface } from '@/components/terminal-pane/input/focus/focus-terminal-tab-surface'
import '@/lib/agent-session/messaging/terminal/active-agent-note-send'
import {
  activeAgentNotesSendFailureMessage,
  type ActiveAgentNotesSendResult
} from '@/lib/agent-session/messaging/terminal/active-agent-note-send-result'
import { sendMessageToAgent } from '@/lib/agent-session/messaging/agent-message-send'
import {
  deriveNotesSendAgentTargets,
  type NotesSendAgentTarget
} from '@/lib/agent-session/messaging/notes-send-agent-targets'
import { agentKindForAgentType } from '@/lib/agent-status/aggregation/worktree-agent-status'
import { track } from '@/diagnostics/telemetry/telemetry'
import { useNow } from '@/lib/window-activity/use-now'
import { useWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/useWorktreeAgentRows'
import type { LaunchSource } from '../../../../../shared/telemetry/schemas/telemetry-property-schemas'
import { translate } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { agentSendDisabledReasonLabel } from '@/lib/agent-session/messaging/agent-send-disabled-reason-label'
import { addQuoteToAgent } from '@/components/native-chat/selection-quotes/native-chat-workspace-selection'
import React, { useCallback, useMemo } from 'react'
import { orderSendTargetsByWorktreeAgentRows } from './review-notes-send-target-order'
import { AgentRowTargetMenuItem, AgentTargetMenuItem } from './review-notes-send-target-menu-item'

/** Where a prompt landed: the agent panel that took it. */
export type AiInstructionDeliveryContext = { paneKey?: string; tabId?: string }

export function ReviewNotesSendMenuContent({
  worktreeId,
  groupId,
  prompt,
  promptDelivery = 'submit-after-ready',
  launchSource = 'notes_send',
  onPromptDelivered,
  onPromptHandedOff,
  mode = 'send',
  sendMenuLabel,
  sendingToastLabel,
  sentToastLabel
}: {
  worktreeId: string
  groupId: string
  prompt: string
  /** 'add-to-chat' puts the prompt where the picked or new agent takes input, never sending it. */
  mode?: 'send' | 'add-to-chat'
  promptDelivery?: 'auto-submit' | 'draft' | 'submit-after-ready'
  launchSource?: LaunchSource
  onPromptDelivered?: (context?: AiInstructionDeliveryContext) => void
  /** Given each send's own result the moment its prompt is handed to an agent. */
  onPromptHandedOff?: (delivered: Promise<unknown>) => void
  /** Already translated wording overrides, for callers that do not send notes. */
  sendMenuLabel?: string
  sendingToastLabel?: string
  sentToastLabel?: string
}): React.JSX.Element {
  const t = useTranslate()
  const hasPrompt = prompt.trim().length > 0

  const viewActive = useAppStateViewActive()
  const store = useAppStateView()
  const agentRows = useWorktreeAgentRows(worktreeId)
  const now = useNow(30_000, viewActive)
  const worktree = useAppStateValue(
    useShallow((state) => {
      const row = selectKnownWorktreeById(state, worktreeId)
      return row
        ? {
            id: row.id,
            hostId: row.hostId,
            runtimeOwnerEnvironmentId: row.runtimeOwnerEnvironmentId
          }
        : null
    })
  )
  const tabsKey = useAppStateValue((state) => state.unifiedTabsByWorktree[worktreeId])
  const chatNames = useWorktreeStructuredChatTabNames(worktree, tabsKey, true)
  const selectTargets = useMemo(() => {
    let inputs: unknown[] = []
    let previous: NotesSendAgentTarget[] = []
    return (state: ReturnType<typeof store.getState>, statuses: RuntimeStatuses) => {
      const nextInputs = [
        state.tabsByWorktree[worktreeId],
        state.unifiedTabsByWorktree[worktreeId],
        selectLiveAgentStatusEntriesForWorktree(state, worktreeId),
        selectTerminalLayoutsForWorktree(state, worktreeId),
        selectLivePtyIdsForWorktree(state, worktreeId),
        selectRuntimePaneTitlesForWorktree(state, worktreeId),
        selectSendApprovalGuardEnvironmentIds(statuses),
        state.agentStatusEpoch
      ]
      if (shallow(inputs, nextInputs)) {
        return previous
      }
      inputs = nextInputs
      // A narrow projection: only the fields target derivation reads, with the view's guard set.
      const next = deriveNotesSendAgentTargets(
        {
          agentStatusByPaneKey: state.agentStatusByPaneKey,
          tabsByWorktree: state.tabsByWorktree,
          unifiedTabsByWorktree: state.unifiedTabsByWorktree,
          terminalLayoutsByTabId: state.terminalLayoutsByTabId,
          ptyIdsByTabId: state.ptyIdsByTabId,
          runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
          sendApprovalGuardEnvironmentIds: selectSendApprovalGuardEnvironmentIds(statuses)
        },
        worktreeId,
        chatNames
      )
      if (
        next.length !== previous.length ||
        next.some((target, i) => !shallow(target, previous[i]))
      ) {
        previous = next
      }
      return previous
    }
  }, [worktreeId, chatNames])
  const sendTargets = useAppStateValueWithHostStatuses(selectTargets)
  const orderedSendTargets = useMemo(
    () => orderSendTargetsByWorktreeAgentRows(sendTargets, agentRows),
    [agentRows, sendTargets]
  )

  const runNotesSend = useCallback(
    (
      send: () => Promise<ActiveAgentNotesSendResult>,
      onSent: () => void,
      options: { explicitTarget?: boolean; structured?: boolean } = {}
    ) => {
      // Settle the loading toast in place: immediate sends can resolve before Sonner mounts, racing a separate dismissal.
      const pending = toast.loading(
        sendingToastLabel ??
          translate(
            'auto.components.editor.ReviewNotesSendMenuContent.50f7e753ea',
            'Sending notes...'
          )
      )

      const sending = send()
        .then((result) => {
          if (result.status === 'sent') {
            onSent()
            toast.success(
              sentToastLabel ??
                translate(
                  'auto.components.editor.ReviewNotesSendMenuContent.bb9c69a0c9',
                  'Notes sent.'
                ),
              { id: pending }
            )
            return
          }

          if (options.structured && result.status === 'unconfirmed') {
            toast.dismiss(pending)
            return
          }

          // Use a typed toast update; toast.message preserves the loading spinner.
          toast.info(
            activeAgentNotesSendFailureMessage(result.status, {
              explicitTarget: options.explicitTarget,
              code: result.code
            }),
            { id: pending }
          )
        })
        .catch(() => {
          console.error('Failed to send notes:', { code: 'runtime-unverifiable' })
          toast.error(
            activeAgentNotesSendFailureMessage('status-unavailable', {
              explicitTarget: options.explicitTarget,
              code: 'runtime-unverifiable'
            }),
            { id: pending }
          )
        })
      onPromptHandedOff?.(sending)
    },
    [onPromptHandedOff, sendingToastLabel, sentToastLabel]
  )

  const sendToAgentTarget = useCallback(
    (target: NotesSendAgentTarget) => {
      if (!hasPrompt || target.status !== 'eligible') {
        return
      }

      const currentEligibility = resolveCurrentSendTargetEligibility(target, worktreeId)
      if (currentEligibility.status !== 'eligible') {
        toast.message(currentEligibility.disabledReason)
        return
      }
      if (mode === 'add-to-chat') {
        void addQuoteToAgent(worktreeId, target.messageTarget, prompt).then((result) => {
          if (result.status !== 'sent') {
            toast.info(
              activeAgentNotesSendFailureMessage(result.status, {
                explicitTarget: true,
                subject: 'selection'
              })
            )
          }
        })
        return
      }

      runNotesSend(
        () => sendMessageToAgent({ worktreeId, prompt, target: target.messageTarget }),
        () => {
          onPromptDelivered?.({ paneKey: target.paneKey, tabId: target.tabId })
          // Match sidebar telemetry for follow-up notes sent through the dropdown.
          track('agent_prompt_sent', {
            agent_kind: agentKindForAgentType(target.agentType),
            launch_source: launchSource,
            request_kind: 'followup'
          })
        },
        { explicitTarget: true, structured: target.messageTarget.kind === 'structured-session' }
      )
    },
    [hasPrompt, mode, runNotesSend, worktreeId, prompt, onPromptDelivered, launchSource]
  )

  return (
    <>
      <DropdownMenuLabel>
        {mode === 'add-to-chat'
          ? t('components.native-chat.addSelectionToChat', 'Add to chat')
          : (sendMenuLabel ??
            t('auto.components.editor.ReviewNotesSendMenuContent.03378aea75', 'Send notes to'))}
      </DropdownMenuLabel>
      {orderedSendTargets.map(({ target, agent }) => {
        const itemProps = {
          target,
          now,
          disabled: !hasPrompt || target.status !== 'eligible',
          onSend: sendToAgentTarget
        }
        return agent ? (
          <AgentRowTargetMenuItem key={target.paneKey} {...itemProps} agent={agent} />
        ) : (
          <AgentTargetMenuItem key={target.paneKey} {...itemProps} agent={null} name="" />
        )
      })}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>
        {t('auto.components.editor.ReviewNotesSendMenuContent.a49800405b', 'New agent')}
      </DropdownMenuLabel>
      <QuickLaunchAgentMenuItems
        worktreeId={worktreeId}
        groupId={groupId}
        onFocusTerminal={focusTerminalTabSurface}
        prompt={prompt}
        promptDelivery={mode === 'add-to-chat' ? 'draft' : promptDelivery}
        launchSource={launchSource}
        onPromptDelivered={onPromptDelivered}
        onPromptHandedOff={onPromptHandedOff}
        disabled={!hasPrompt}
      />
    </>
  )
}

function resolveCurrentSendTargetEligibility(
  target: NotesSendAgentTarget,
  worktreeId: string
): { status: 'eligible' } | { status: 'disabled'; disabledReason: string } {
  const goneReason =
    target.messageTarget.kind === 'terminal'
      ? translate(
          'auto.components.editor.ReviewNotesSendMenu.terminalGone',
          'Terminal is no longer available'
        )
      : translate('auto.components.editor.ReviewNotesSendMenu.chatGone', 'Chat is no longer open')
  const state = useAppStore.getState()
  const currentTarget = deriveNotesSendAgentTargets(
    state,
    worktreeId,
    getStructuredChatTabNames()
  ).find((candidate) => candidate.paneKey === target.paneKey)
  if (currentTarget) {
    return currentTarget.status === 'eligible'
      ? { status: 'eligible' }
      : {
          status: 'disabled',
          disabledReason: currentTarget.disabledReason
            ? agentSendDisabledReasonLabel(currentTarget.disabledReason)
            : goneReason
        }
  }

  return { status: 'disabled', disabledReason: goneReason }
}
