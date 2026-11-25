import path from 'node:path'

import { refactorPathKey } from './refactor-path-rules'
import type { RefactorGateRoots } from './refactor-write-gate'

/** The tools that put a file on disk. */
const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit'])

/**
 * The files the agent wrote in full.
 *
 * Why the tool result matters: a write the agent was cut off in the middle of leaves a truncated
 * file behind, and a truncated file offered as a proposal would be applied as one.
 */
export type RefactorAgentWrites = {
  /** Reads a message from the agent and remembers the writes it finished. */
  note(message: Record<string, unknown>): void
  /** The keys of the files that were written in full. */
  completedKeys(): ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The tracker of the files the agent wrote.
 *
 * Why the ids: a tool use and its result are two frames, and the id is what binds them.
 */
export function refactorAgentWrites(roots: RefactorGateRoots): RefactorAgentWrites {
  // The tool use id of a write, and the key of the file it was going to write.
  const pending = new Map<string, string>()
  const completed = new Set<string>()

  const note = (message: Record<string, unknown>): void => {
    const envelope = message.message
    if (!isRecord(envelope)) {
      return
    }
    const content = envelope.content
    if (!Array.isArray(content)) {
      return
    }
    for (const block of content) {
      if (!isRecord(block)) {
        continue
      }
      if (block.type === 'tool_use') {
        const name = typeof block.name === 'string' ? block.name : ''
        if (!WRITE_TOOL_NAMES.has(name)) {
          continue
        }
        const toolInput = isRecord(block.input) ? block.input : {}
        const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
        const id = typeof block.id === 'string' ? block.id : ''
        if (filePath.length === 0 || id.length === 0) {
          continue
        }
        const key = scratchKey(roots, filePath)
        if (key !== null) {
          pending.set(id, key)
        }
        continue
      }
      if (block.type === 'tool_result') {
        const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        const key = pending.get(id)
        if (key !== undefined) {
          completed.add(key)
          pending.delete(id)
        }
      }
    }
  }

  return {
    note,
    completedKeys: () => completed
  }
}

/**
 * The key of a written file, or null when it was written outside the scratch tree.
 *
 * Why the physical root comes first: the CLI names a file by its real path, and the spelled root
 * is the one the agent was told about.
 */
function scratchKey(roots: RefactorGateRoots, filePath: string): string | null {
  for (const base of [roots.physicalScratchRoot, roots.scratchRoot]) {
    const relative = path.relative(base, path.resolve(base, filePath))
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue
    }
    return refactorPathKey(relative)
  }
  return null
}
