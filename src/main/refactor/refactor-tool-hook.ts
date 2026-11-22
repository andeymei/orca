import type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput
} from '@anthropic-ai/claude-agent-sdk'
import { refactorToolAllowed, refactorToolTargetPath } from './refactor-write-gate'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Why the reason names the tool, the path and the scratch root: a refusal the agent cannot read
 * only makes it try another spelling, and the path is the thing it has to change.
 */
function refactorToolDenyReason(input: {
  toolName: string
  targetPath: string | null
  scratchRoot: string
}): string {
  const target = input.targetPath ?? '未知的路径'
  return `该工具在此任务中不可用：${input.toolName} 只能读工作区里的文件，只能写暂存目录 ${input.scratchRoot} 下的文件；被拒绝的路径：${target}。`
}

/** Why the try: a path that throws while it is read must not turn the refusal into an approval. */
function refactorHookTargetPath(toolInput: Record<string, unknown>): string | null {
  try {
    return refactorToolTargetPath(toolInput)
  } catch {
    return null
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
  const deny = (toolName: string, targetPath: string | null): HookJSONOutput => ({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: refactorToolDenyReason({ toolName, targetPath, scratchRoot })
    }
  })
  const hook: HookCallback = async (hookInput) => {
    const toolName = hookInput.hook_event_name === 'PreToolUse' ? hookInput.tool_name : ''
    let targetPath: string | null = null
    try {
      if (hookInput.hook_event_name !== 'PreToolUse') {
        return {}
      }
      const toolInput = hookInput.tool_input
      // Fail closed: without a path the gate cannot prove the call lands where it is allowed to.
      if (!isRecord(toolInput)) {
        return deny(toolName, null)
      }
      targetPath = refactorHookTargetPath(toolInput)
      const allowed = refactorToolAllowed({
        toolName,
        toolInput,
        scratchRoot,
        workspaceRoot
      })
      return allowed ? {} : deny(toolName, targetPath)
    } catch {
      // Fail closed: an exception must never reach the CLI as an approval.
      return deny(toolName, targetPath)
    }
  }
  // Why the block: a hook that cannot be delivered would leave the gate silent while the action
  // goes ahead, and an allow rule in a settings tier means canUseTool is not consulted either.
  // The SDK probes the CLI for this option and refuses the session when it is not honored, so a
  // CLI that cannot enforce the gate never runs the agent at all.
  return [{ hooks: [hook], onFailure: 'block' }]
}
