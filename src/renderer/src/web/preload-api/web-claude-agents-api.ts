import { translate } from '@/i18n/i18n'
import type { PreloadApi } from '../../../../preload/api-types'
import type {
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentListResult
} from '../../../../shared/claude-background-agents'

export function createWebClaudeAgentsApi(): NonNullable<Partial<PreloadApi>['claudeAgents']> {
  return {
    // Why: the browser has no Claude Code CLI of its own to ask about agents.
    list: (): Promise<ClaudeBackgroundAgentListResult> =>
      Promise.resolve({ status: 'unsupported', agents: [], details: {}, message: null }),
    // Why: without a roster there are no activity lines to read.
    readDetails: (): Promise<Record<string, ClaudeBackgroundAgentDetail>> => Promise.resolve({}),
    // Why: the CLI that starts an agent runs on the desktop, not in the browser.
    dispatch: (): Promise<ClaudeBackgroundAgentCommandResult> =>
      Promise.resolve({
        ok: false,
        message: translate('auto.web.web.preload.api.31bfe8ae1a', 'Unavailable in the web client.')
      }),
    // Why: the browser never starts a dispatch of its own, so there is none to cancel.
    cancelDispatch: (): Promise<void> => Promise.resolve(),
    // Why: the CLI that stops an agent runs on the desktop, not in the browser.
    stop: (): Promise<ClaudeBackgroundAgentCommandResult> =>
      Promise.resolve({
        ok: false,
        message: translate('auto.web.web.preload.api.31bfe8ae1a', 'Unavailable in the web client.')
      }),
    // Why: the CLI that deletes an agent runs on the desktop, not in the browser.
    remove: (): Promise<ClaudeBackgroundAgentCommandResult> =>
      Promise.resolve({
        ok: false,
        message: translate('auto.web.web.preload.api.31bfe8ae1a', 'Unavailable in the web client.')
      })
  }
}
