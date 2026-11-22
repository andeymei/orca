import type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput
} from '@anthropic-ai/claude-agent-sdk'
import { refactorToolAllowed } from './refactor-write-gate'

/** Why a visible reason: a refusal the agent cannot read only makes it try another spelling. */
const REFACTOR_TOOL_DENY_REASON =
  '该工具在此任务中不可用：只能读工作区里的文件，只能写暂存目录下的文件。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function denyRefactorTool(): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: REFACTOR_TOOL_DENY_REASON
    }
  }
}

/**
 * The gate as a PreToolUse hook: an allow rule in any settings tier approves a tool before the
 * `canUseTool` callback is consulted, and the managed tier is read from disk whatever the launch
 * passes. Hooks run before the permission decision, so this is the one place the gate stays the
 * authority; `canUseTool` stays as the second layer.
 */
export function createRefactorToolHook(input: {
  scratchRoot: string
  workspaceRoot: string
}): HookCallbackMatcher[] {
  const { scratchRoot, workspaceRoot } = input
  const hook: HookCallback = async (hookInput) => {
    try {
      if (hookInput.hook_event_name !== 'PreToolUse') {
        return {}
      }
      const toolInput = hookInput.tool_input
      // Fail closed: without a path the gate cannot prove the call lands where it is allowed to.
      if (!isRecord(toolInput)) {
        return denyRefactorTool()
      }
      const allowed = refactorToolAllowed({
        toolName: hookInput.tool_name,
        toolInput,
        scratchRoot,
        workspaceRoot
      })
      return allowed ? {} : denyRefactorTool()
    } catch {
      // Fail closed: an exception must never reach the CLI as an approval.
      return denyRefactorTool()
    }
  }
  return [{ hooks: [hook] }]
}
