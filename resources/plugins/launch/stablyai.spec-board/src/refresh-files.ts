// The files a refresh writes before the agent starts.
//
// They are the plugin's own files, not the board's: the progress says how far the agent has come,
// and the prompt is kept so a person can read what the agent was asked.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { OrcaWorkerApi } from 'orca/worker'
import { requestError } from './request-error'
import { boardStoreDir, progressPath, refreshPromptPath } from './store-paths'
import { messageOf } from './unknown-values'

/**
 * Writes the prompt of this refresh, so a person can read what the agent was asked. A store
 * directory that cannot be made is logged and the write is tried anyway; a write that fails is a
 * refusal the panel can show, with the reason in it — a raw errno reaches the panel as a code it
 * does not recognise, and the person sees nothing useful.
 */
export async function writeRefreshPrompt(orca: OrcaWorkerApi, prompt: string): Promise<void> {
  try {
    await mkdir(boardStoreDir(), { recursive: true })
  } catch (error) {
    orca.log(`[spec-board] 无法创建 ${boardStoreDir()}：${messageOf(error)}`)
  }
  try {
    await writeFile(refreshPromptPath(), prompt, 'utf8')
  } catch (error) {
    throw requestError('unavailable', `无法写入 ${refreshPromptPath()}：${messageOf(error)}`)
  }
}

/**
 * Takes the last refresh's progress away.
 *
 * The progress belongs to the refresh that is starting: a bar that counts the projects of the last
 * run would say the agent is halfway when it has not begun. A file that cannot be removed is
 * logged — the agent overwrites it with its first report anyway — and never refuses the refresh,
 * because the snapshot is what the board reads.
 */
export async function clearProgress(orca: OrcaWorkerApi): Promise<void> {
  try {
    await rm(progressPath(), { force: true })
  } catch (error) {
    orca.log(`[spec-board] 无法清掉旧的进度文件：${messageOf(error)}`)
  }
}
