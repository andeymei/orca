import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import { salvagingRecord } from '../../shared/zod-salvage'
import { emptyCompletionUsage, type CompletionUsage } from './completion-backend'

/** A total older than this is never read; the file keeps a window instead of growing forever. */
const COMPLETION_USAGE_RETENTION_DAYS = 30

/** The day totals, keyed by local `YYYY-MM-DD`. */
type CompletionUsageDays = Record<string, CompletionUsage>

const completionUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative()
})

// Why salvaging: one hand-edited day must not wipe the rest of the window.
const completionUsageDaysSchema = salvagingRecord(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completionUsageSchema
)

function completionUsageFile(): string {
  return join(homedir(), '.orca', 'code-completion-usage.json')
}

/** Why local: the user reads "today" in their own timezone. */
function localDayKey(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The saved days, or none when the file is missing, unreadable or not the shape we wrote. */
async function readUsageDays(): Promise<CompletionUsageDays> {
  const path = completionUsageFile()
  try {
    const parsed = completionUsageDaysSchema.safeParse(
      JSON.parse((await readFile(path)).toString('utf8'))
    )
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/** What the completions spent on the day of `now`; zero when nothing was recorded. */
export async function readCompletionUsageToday(now = Date.now()): Promise<CompletionUsage> {
  const days = await readUsageDays()
  return days[localDayKey(now)] ?? emptyCompletionUsage()
}

/**
 * The writes, one after the other.
 *
 * Why: two completions that land together would each read the file and each write their own
 * total, and the second write would drop the first one's tokens.
 */
let usageWrites: Promise<void> = Promise.resolve()

/** Adds one completion to the day's total; a total that cannot be written is lost, not fatal. */
export function recordCompletionUsage(entry: {
  model: string
  usage: CompletionUsage
  at: number
}): Promise<void> {
  usageWrites = usageWrites.then(() => writeUsageDays(entry))
  return usageWrites
}

/** Adds one completion to the day's total and writes the window back. */
async function writeUsageDays(entry: {
  model: string
  usage: CompletionUsage
  at: number
}): Promise<void> {
  const days = await readUsageDays()
  const day = localDayKey(entry.at)
  const spent = days[day] ?? emptyCompletionUsage()
  days[day] = {
    inputTokens: spent.inputTokens + entry.usage.inputTokens,
    outputTokens: spent.outputTokens + entry.usage.outputTokens,
    cacheReadTokens: spent.cacheReadTokens + entry.usage.cacheReadTokens
  }
  pruneDays(days, entry.at)
  try {
    writeSecureFile(completionUsageFile(), JSON.stringify(days, null, 2))
  } catch (error) {
    console.warn('[code-completion] Failed to record the completion usage.', error)
  }
}

/** Drops the cutoff day and everything before it, so the file keeps exactly the last 30 local days. */
function pruneDays(days: CompletionUsageDays, at: number): void {
  const cutoff = new Date(at)
  cutoff.setDate(cutoff.getDate() - COMPLETION_USAGE_RETENTION_DAYS)
  const oldest = localDayKey(cutoff.getTime())
  for (const day of Object.keys(days)) {
    if (day <= oldest) {
      delete days[day]
    }
  }
}
