import type { ClaudeStreamJsonConnectionHandlers } from '../claude/claude-stream-json-connection'
import type { RefactorAgentLaunch } from './refactor-agent-launch'

/** The part of the connection a turn drives; the real connection satisfies it structurally. */
export type RefactorTurnConnection = {
  send: (message: Record<string, unknown>) => Promise<void>
  close: () => Promise<boolean>
  exitVerdict?: { root: string; tree: string } | null
}

/** How a turn opens its connection; the real opener is the default. */
export type RefactorTurnConnectionFactory = (
  launch: RefactorAgentLaunch,
  handlers: ClaudeStreamJsonConnectionHandlers
) => Promise<RefactorTurnConnection>

/**
 * Why the warnings instead of a throw: a connection that will not close is another matter, and it
 * must not discard the verdict the turn already reached.
 */
export async function closeRefactorTurnConnection(
  connection: RefactorTurnConnection | null
): Promise<string[]> {
  if (!connection) {
    return []
  }
  try {
    const proven = await connection.close()
    if (proven !== false) {
      return []
    }
    const warnings = ['子进程未确认退出']
    const exitVerdict = connection.exitVerdict
    if (exitVerdict && exitVerdict.root !== 'exited') {
      warnings.push(`根进程未退出：${exitVerdict.root}，后代树：${exitVerdict.tree}`)
    }
    return warnings
  } catch (error) {
    return [`关闭连接失败：${error instanceof Error ? error.message : String(error)}`]
  }
}
