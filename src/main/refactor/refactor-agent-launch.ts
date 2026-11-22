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
 * The CLI's own fence for the file tools, one layer below the gate: a read or a write outside the
 * working directory is refused in every permission mode. It does not close the managed-settings
 * hole — an allow rule still approves a write inside the working directory, where the user's
 * sources live, without the gate seeing it. The PreToolUse hook owns that.
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
  // Settings.permissions carries an index signature, so a misspelled key typechecks; the test pins them.
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
      // Only 'default' consults canUseTool for every call; the other modes decide before the gate.
      permissionMode: 'default',
      disallowedTools: [...REFACTOR_DISALLOWED_TOOLS],
      // SDK isolation mode: a user setting that auto-allows a write tool would bypass the gate.
      settingSources: [],
      settings: REFACTOR_PERMISSION_SETTINGS
    }
  }
}
