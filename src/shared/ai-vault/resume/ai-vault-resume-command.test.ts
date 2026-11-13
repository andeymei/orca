import { describe, expect, it } from 'vitest'

import {
  buildAiVaultResumeCommand,
  buildAiVaultResumeShellCommand
} from './ai-vault-resume-command'
import { buildAiVaultLocalResumeStartup } from './ai-vault-resume-startup'

describe('buildAiVaultResumeCommand', () => {
  // The CLI continues a resumed conversation under a new id when it supersedes the one it was
  // given, and names that session "<title> (2)": the conversation then shows up twice.
  it('pins the conversation id when resuming a Claude conversation', () => {
    const command = buildAiVaultResumeCommand({
      agent: 'claude',
      sessionId: '84693fdb-e203-4b59-81b1-ce59940554aa',
      cwd: null,
      platform: 'linux'
    })
    expect(command).toBe(
      "claude --resume '84693fdb-e203-4b59-81b1-ce59940554aa' --fork-session --session-id '84693fdb-e203-4b59-81b1-ce59940554aa'"
    )
  })

  it('pins the conversation id in a local Claude resume too', () => {
    const startup = buildAiVaultLocalResumeStartup({
      session: {
        agent: 'claude',
        sessionId: '84693fdb-e203-4b59-81b1-ce59940554aa',
        cwd: '/repo/app',
        codexHome: null,
        filePath: '/transcripts/84693fdb-e203-4b59-81b1-ce59940554aa.jsonl',
        resumeCommand: 'claude --resume 84693fdb-e203-4b59-81b1-ce59940554aa',
        executionHostId: 'local'
      },
      host: {
        platform: 'linux',
        agentHostPlatform: 'linux',
        codexHome: null,
        liveShell: undefined
      },
      settings: {},
      embedCwd: true
    })
    expect(startup.command).toContain(
      "'--fork-session' '--session-id' '84693fdb-e203-4b59-81b1-ce59940554aa'"
    )
  })

  it('leaves the other agents their own resume form', () => {
    const command = buildAiVaultResumeCommand({
      agent: 'codex',
      sessionId: 'session-1',
      cwd: null,
      platform: 'linux'
    })
    expect(command).toBe("codex resume 'session-1'")
  })
})

describe('buildAiVaultResumeShellCommand env removal', () => {
  const base = {
    resumeCommand: "codex 'resume' 'sid'",
    cwd: '/repo',
    clearEnvNames: ['CODEX_HOME', 'ORCA_CODEX_HOME']
  }

  // Filter assigned variables from env -u or the pinned home silently becomes real-home resume.
  it('keeps a pinned CODEX_HOME authoritative instead of stripping it', () => {
    const command = buildAiVaultResumeShellCommand({
      ...base,
      platform: 'darwin',
      codexHome: '/home/a/.codex-work'
    })

    expect(command).toBe(
      "cd '/repo' && CODEX_HOME='/home/a/.codex-work' env -u ORCA_CODEX_HOME codex 'resume' 'sid'"
    )
    expect(command).not.toContain('-u CODEX_HOME')
  })

  it('keeps a pinned CODEX_HOME authoritative under a git-bash shell too', () => {
    expect(
      buildAiVaultResumeShellCommand({
        ...base,
        platform: 'win32',
        shell: 'posix',
        codexHome: '/c/users/a/.codex-work'
      })
    ).toBe(
      "cd '/repo' && CODEX_HOME='/c/users/a/.codex-work' env -u ORCA_CODEX_HOME codex 'resume' 'sid'"
    )
  })

  // Shell grammar wins over host platform; platform routing emitted POSIX env -u into PowerShell.
  it('uses PowerShell grammar for a PowerShell shell on a non-Windows host', () => {
    const command = buildAiVaultResumeShellCommand({
      ...base,
      platform: 'linux',
      shell: 'powershell'
    })

    expect(command).not.toContain('env -u')
    expect(command).toBe(
      'Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue; ' +
        'Remove-Item Env:ORCA_CODEX_HOME -ErrorAction SilentlyContinue; ' +
        "Set-Location -LiteralPath '/repo'; codex 'resume' 'sid'"
    )
  })

  it('keeps the cmd clear ahead of the cd so a failed cd cannot launch the agent', () => {
    expect(
      buildAiVaultResumeShellCommand({
        ...base,
        cwd: 'C:\\repo',
        platform: 'win32',
        shell: 'cmd'
      })
    ).toBe(
      'set "CODEX_HOME=" & set "ORCA_CODEX_HOME=" & cd /d "C:\\repo" && codex \'resume\' \'sid\''
    )
  })
})
