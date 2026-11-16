import { ipcRenderer } from 'electron'
import type {
  ClaudeBackgroundAgentCommandResult,
  ClaudeBackgroundAgentDetail,
  ClaudeBackgroundAgentDispatchArgs,
  ClaudeBackgroundAgentIdArgs,
  ClaudeBackgroundAgentListResult
} from '../../shared/claude-background-agents'
import type { PreloadApi } from '../api-types'

export const claudeAgentsApi = {
  list: (): Promise<ClaudeBackgroundAgentListResult> => ipcRenderer.invoke('claudeAgents:list'),
  readDetails: (ids: string[]): Promise<Record<string, ClaudeBackgroundAgentDetail>> =>
    ipcRenderer.invoke('claudeAgents:readDetails', ids),
  dispatch: (
    args: ClaudeBackgroundAgentDispatchArgs
  ): Promise<ClaudeBackgroundAgentCommandResult> =>
    ipcRenderer.invoke('claudeAgents:dispatch', args),
  cancelDispatch: (): Promise<void> => ipcRenderer.invoke('claudeAgents:cancelDispatch'),
  stop: (args: ClaudeBackgroundAgentIdArgs): Promise<ClaudeBackgroundAgentCommandResult> =>
    ipcRenderer.invoke('claudeAgents:stop', args),
  remove: (args: ClaudeBackgroundAgentIdArgs): Promise<ClaudeBackgroundAgentCommandResult> =>
    ipcRenderer.invoke('claudeAgents:remove', args)
} satisfies PreloadApi['claudeAgents']
