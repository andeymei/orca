import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeStructuredAuthPolicy } from '../claude-accounts/runtime-auth/claude-structured-auth-policy'
import type { ClaudeEnvDeps } from '../claude/structured/launch/claude-structured-child-env'
import {
  CLAUDE_STRUCTURED_BASE_OPTIONS,
  resolveClaudeStructuredInvocation,
  type ClaudeStructuredSdkOptions
} from '../claude/structured/launch/claude-structured-launch-resolution'

/**
 * Tools that leave the path model: they can move files, spawn work or reach the network without a
 * file path the write gate could check. The gate denies them anyway; removing them from the model's
 * context is the second line.
 */
export const REFACTOR_DISALLOWED_TOOLS: readonly string[] = [
  'Bash',
  'PowerShell',
  'Task',
  'Agent',
  'NotebookEdit',
  'WebFetch',
  'WebSearch'
]

/**
 * The CLI's own fence, one layer below the gate. The managed settings tier is still read from disk
 * even in isolation mode, and no allow rule lifts a block, so an IT-managed allow rule cannot buy a
 * write past the gate either.
 */
export const REFACTOR_PERMISSION_SETTINGS = {
  permissions: {
    // A read the CLI never asks about would skip the gate's workspace fence.
    blockReadsOutsideWorkingDirectories: true,
    // The working directory is the workspace root and the scratch tree lives under it.
    blockWritesOutsideWorkingDirectories: true,
    disableBypassPermissionsMode: 'disable',
    disableAutoMode: 'disable'
  }
} satisfies Settings

export type RefactorAgentLaunch = {
  pathToClaudeCodeExecutable: string
  prefixArgs?: readonly string[]
  env: Record<string, string>
  cwd: string
  options: ClaudeStructuredSdkOptions
}

export async function resolveRefactorAgentLaunch(input: {
  cwd: string
  deps: ClaudeEnvDeps & {
    resolveAuthPolicy: () => Promise<ClaudeStructuredAuthPolicy> | ClaudeStructuredAuthPolicy
  }
  /** Aborts the resolution; it takes precedence over a signal carried on the deps. */
  signal?: AbortSignal
}): Promise<RefactorAgentLaunch> {
  const invocation = await resolveClaudeStructuredInvocation({
    ...input.deps,
    ...(input.signal ? { signal: input.signal } : {})
  })
  return {
    pathToClaudeCodeExecutable: invocation.command,
    prefixArgs: invocation.prefixArgs,
    env: invocation.env,
    cwd: input.cwd,
    options: {
      ...CLAUDE_STRUCTURED_BASE_OPTIONS,
      // Only 'default' hands every tool call to canUseTool; the gate is the sole decision maker.
      permissionMode: 'default',
      disallowedTools: [...REFACTOR_DISALLOWED_TOOLS],
      // SDK isolation mode: a user setting that auto-allows a write tool would bypass the gate.
      settingSources: [],
      settings: REFACTOR_PERMISSION_SETTINGS
    }
  }
}
