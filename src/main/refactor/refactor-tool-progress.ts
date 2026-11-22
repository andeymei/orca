import path from 'node:path'
import { refactorToolTargetPath, type RefactorGateRoots } from './refactor-write-gate'

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The path of a file as the user knows it: relative to the workspace.
 *
 * Why the physical root comes first: the CLI names a file by its real path, and that is the
 * path the tree the user is looking at holds. Why the spelled root comes second: the agent may
 * name the same file by the path it was given. Why the absolute path is the last resort: a
 * relative path that climbs out of the workspace names nothing the user could use.
 */
function refactorProgressRelativePath(roots: RefactorGateRoots, target: string): string {
  const absolute = path.resolve(roots.workspaceRoot, target)
  for (const base of [roots.physicalWorkspaceRoot, roots.workspaceRoot]) {
    const relative = path.relative(base, absolute)
    if (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
      return relative
    }
  }
  return absolute
}

/**
 * Why no text for an unknown tool or a missing path: a progress line that names a file the tool
 * never touched is worse than no line at all.
 */
function refactorToolProgressText(
  toolName: string,
  toolInput: Record<string, unknown>,
  roots: RefactorGateRoots
): string | null {
  const target = refactorToolTargetPath(toolInput)
  if (!target) {
    return null
  }
  const relative = refactorProgressRelativePath(roots, target)
  if (toolName === 'Read') {
    return `正在读取 ${relative}`
  }
  if (WRITE_TOOL_NAMES.has(toolName)) {
    return `正在写入 ${relative}`
  }
  return null
}

export function parseRefactorToolProgress(
  message: Record<string, unknown>,
  roots: RefactorGateRoots
): string | null {
  const envelope = message.message
  if (!isRecord(envelope)) {
    return null
  }
  const content = envelope.content
  if (!Array.isArray(content)) {
    return null
  }
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_use') {
      continue
    }
    const toolName = typeof block.name === 'string' ? block.name : ''
    if (!toolName) {
      continue
    }
    const toolInput = isRecord(block.input) ? block.input : {}
    const text = refactorToolProgressText(toolName, toolInput, roots)
    if (text !== null) {
      return text
    }
  }
  return null
}
