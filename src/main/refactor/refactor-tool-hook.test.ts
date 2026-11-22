import { describe, expect, it } from 'vitest'
import type { HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { createRefactorToolHook } from './refactor-tool-hook'

const workspaceRoot = '/repo'
const scratchRoot = '/repo/.orca/refactor/job-1'

function preToolUseInput(toolName: string, toolInput: unknown): HookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'session-1',
    transcript_path: '/repo/.orca/refactor/transcript.jsonl',
    cwd: workspaceRoot,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'tool-1'
  }
}

async function runHook(toolName: string, toolInput: unknown): Promise<HookJSONOutput> {
  const matcher = createRefactorToolHook({ scratchRoot, workspaceRoot })[0]
  return matcher.hooks[0](preToolUseInput(toolName, toolInput), undefined, {
    signal: new AbortController().signal
  })
}

function denyReason(output: HookJSONOutput): string | null {
  if (!('hookSpecificOutput' in output)) {
    return null
  }
  const specific = output.hookSpecificOutput
  if (
    !specific ||
    specific.hookEventName !== 'PreToolUse' ||
    specific.permissionDecision !== 'deny'
  ) {
    return null
  }
  return specific.permissionDecisionReason ?? ''
}

describe('createRefactorToolHook', () => {
  it('registers one matcher that matches every tool', () => {
    const matchers = createRefactorToolHook({ scratchRoot, workspaceRoot })
    expect(matchers).toHaveLength(1)
    expect(matchers[0].matcher).toBeUndefined()
    expect(matchers[0].hooks).toHaveLength(1)
  })

  it('blocks the tool when the hook cannot answer, so the gate never fails open', () => {
    const matchers = createRefactorToolHook({ scratchRoot, workspaceRoot })
    expect(matchers[0].onFailure).toBe('block')
  })

  it('allows a read inside the workspace', async () => {
    expect(denyReason(await runHook('Read', { file_path: '/repo/src/foo.ts' }))).toBeNull()
  })

  it('allows a write inside the scratch root', async () => {
    expect(
      denyReason(await runHook('Write', { file_path: '/repo/.orca/refactor/job-1/p1/src/foo.ts' }))
    ).toBeNull()
  })

  it('denies a write outside the scratch root, with a reason the agent can read', async () => {
    const reason = denyReason(await runHook('Write', { file_path: '/repo/src/foo.ts' }))
    expect(reason).not.toBeNull()
    expect(reason).not.toBe('')
  })

  it('names the tool, the refused path and the scratch root in the reason', async () => {
    const reason = denyReason(await runHook('Write', { file_path: '/repo/src/foo.ts' }))
    expect(reason).toContain('Write')
    expect(reason).toContain('/repo/src/foo.ts')
    expect(reason).toContain(scratchRoot)
  })

  it('denies a read outside the workspace', async () => {
    expect(denyReason(await runHook('Read', { file_path: '/home/mac/.ssh/id_rsa' }))).not.toBeNull()
  })

  it('denies an unknown tool', async () => {
    expect(denyReason(await runHook('Bash', { command: 'cp a b' }))).not.toBeNull()
  })

  it('denies a tool input that is null', async () => {
    expect(denyReason(await runHook('Write', null))).not.toBeNull()
  })

  it('denies a tool input that is a string', async () => {
    expect(denyReason(await runHook('Write', '/repo/src/foo.ts'))).not.toBeNull()
  })

  it('denies a tool input that is an array', async () => {
    expect(denyReason(await runHook('Write', ['/repo/src/foo.ts']))).not.toBeNull()
  })

  it('denies when the gate itself throws', async () => {
    // The getter makes the gate throw while it reads the path, so the deny path runs for real.
    const explodingInput = {
      get file_path(): string {
        throw new Error('the gate exploded')
      }
    }
    expect(denyReason(await runHook('Write', explodingInput))).not.toBeNull()
  })
})
