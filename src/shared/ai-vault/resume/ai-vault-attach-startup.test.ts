import { describe, expect, it } from 'vitest'
import { buildClaudeAttachStartup } from './ai-vault-attach-startup'

describe('buildClaudeAttachStartup', () => {
  it('opens the running agent instead of resuming the conversation', () => {
    expect(
      buildClaudeAttachStartup({ platform: 'darwin', agentId: '8857ad86', cwd: '/repos/app' })
    ).toEqual({ command: "claude attach '8857ad86'", cwd: '/repos/app' })
  })

  it('quotes the agent id for the shell that runs it', () => {
    expect(
      buildClaudeAttachStartup({ platform: 'win32', shell: 'powershell', agentId: '82d5c3ec' })
    ).toEqual({ command: "claude attach '82d5c3ec'" })
  })

  it('leaves the working folder to the workspace when the session has none', () => {
    expect(
      buildClaudeAttachStartup({ platform: 'darwin', agentId: '82d5c3ec', cwd: null })
    ).toEqual({
      command: "claude attach '82d5c3ec'"
    })
  })
})
