import type { AiInstruction, AiInstructionStatus } from '../../../../../shared/ai-instruction-types'
import type { DiffComment } from '../../../../../shared/diff-comment-types'

export type ResolvedAiInstruction = AiInstruction & {
  status: AiInstructionStatus
  recordId?: string
}

type InstructionRecordPair = {
  instructionIndex: number
  instructionLine: number
  record: DiffComment
  distance: number
}

function statusOfRecord(record: DiffComment): AiInstructionStatus {
  if (record.completedAt !== undefined) {
    return 'completed'
  }
  return record.sentAt !== undefined ? 'dispatched' : 'pending'
}

/**
 * Whether an agent's status completes a dispatched instruction. Only a `done` status that arrived
 * after the dispatch counts; a status from before it belongs to an earlier turn.
 */
export function isAiInstructionCompletedByStatus(args: {
  sentAt: number | undefined
  completedAt: number | undefined
  status: { state: string; updatedAt: number } | undefined
}): boolean {
  const { sentAt, completedAt, status } = args
  if (completedAt !== undefined || sentAt === undefined || status === undefined) {
    return false
  }
  if (status.state !== 'done') {
    return false
  }
  return status.updatedAt >= sentAt
}

/** A record serves only the nearest instruction with the same text, so a repeated one stays pending. */
export function resolveAiInstructionStatuses(
  instructions: readonly AiInstruction[],
  records: readonly DiffComment[]
): ResolvedAiInstruction[] {
  const recordsByBody = new Map<string, DiffComment[]>()
  for (const record of records) {
    const bucket = recordsByBody.get(record.body)
    if (bucket) {
      bucket.push(record)
    } else {
      recordsByBody.set(record.body, [record])
    }
  }

  const pairs: InstructionRecordPair[] = []
  for (const [instructionIndex, instruction] of instructions.entries()) {
    for (const record of recordsByBody.get(instruction.instruction) ?? []) {
      pairs.push({
        instructionIndex,
        instructionLine: instruction.lineNumber,
        record,
        distance: Math.abs(record.lineNumber - instruction.lineNumber)
      })
    }
  }
  // Closest pairs settle first, so a record goes to the instruction nearest to it.
  pairs.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.record.lineNumber - b.record.lineNumber ||
      a.instructionLine - b.instructionLine
  )

  const recordByInstruction = new Map<number, DiffComment>()
  const claimedRecordIds = new Set<string>()
  for (const pair of pairs) {
    if (recordByInstruction.has(pair.instructionIndex) || claimedRecordIds.has(pair.record.id)) {
      continue
    }
    recordByInstruction.set(pair.instructionIndex, pair.record)
    claimedRecordIds.add(pair.record.id)
  }

  return instructions.map((instruction, index) => {
    const record = recordByInstruction.get(index)
    if (!record) {
      return { ...instruction, status: 'pending', recordId: undefined }
    }
    return { ...instruction, status: statusOfRecord(record), recordId: record.id }
  })
}
