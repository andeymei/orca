import type { OrchestrationDb } from '../orchestration-db'
import { readCoordinatorMail } from './dispatch-read-mail'

/** Whether the worker's worker_done since the coordinator's latest mail was rejected: the coordinator
 *  already holds that rejection with its reason, so the turn did not end without reporting. */
export function rejectedReportSinceLatestMail(db: OrchestrationDb, dispatchId: string): boolean {
  const dispatch = db.getDispatchContextById(dispatchId)
  // The worker's own handle sent it, as when Orca restarted under its report; another terminal's says nothing.
  if (!dispatch?.assignee_handle) {
    return false
  }
  const after = readCoordinatorMail(db, dispatchId).at(-1)?.sequence ?? 0
  const row = db.db
    .prepare(
      `SELECT 1 FROM messages
        WHERE run_id = ? AND sequence > ? AND from_handle = ? AND type = 'worker_done'
          AND json_valid(payload)
          AND json_extract(payload, '$.dispatchId') = ?
          AND json_type(payload, '$._orcaLifecycleRejection.code') IS 'text'
        LIMIT 1`
    )
    .get(dispatch.run_id, after, dispatch.assignee_handle, dispatchId)
  return row !== undefined
}
