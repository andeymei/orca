// The progress the agent reports while it scans: what the panel draws its bar from.
//
// A progress file that is not there, or that does not have the shape, is not a failed refresh —
// the snapshot is what the board reads. It means only that there is no number to show, and the
// panel falls back to a bar that does not claim to know.

import { assert, test } from 'orca/testing'
import { parseRefreshProgress, progressPercent } from './refresh-progress'

test('reads the progress the agent wrote', () => {
  const progress = parseRefreshProgress({ done: 2, total: 5, current: 'ctjt-service' })
  assert.deepEqual(progress, { done: 2, total: 5, current: 'ctjt-service' })
})

test('a progress that counts more than it has is no progress', () => {
  assert.equal(parseRefreshProgress({ done: 6, total: 5, current: 'x' }), null)
  // A total of zero would make the bar's percent undefined.
  assert.equal(parseRefreshProgress({ done: 0, total: 0, current: 'x' }), null)
  assert.equal(parseRefreshProgress({ done: -1, total: 5, current: 'x' }), null)
})

test('a progress whose counts are not whole numbers is no progress', () => {
  assert.equal(parseRefreshProgress({ done: '2', total: 5, current: 'x' }), null)
  assert.equal(parseRefreshProgress({ done: 1.5, total: 5, current: 'x' }), null)
})

test('a progress that names no project is no progress', () => {
  assert.equal(parseRefreshProgress({ done: 1, total: 5 }), null)
  assert.equal(parseRefreshProgress({ done: 1, total: 5, current: 7 }), null)
})

test('something that is not a progress is no progress', () => {
  assert.equal(parseRefreshProgress(null), null)
  assert.equal(parseRefreshProgress('done'), null)
  assert.equal(parseRefreshProgress([1, 2]), null)
})

test('the bar shows how far along the agent is', () => {
  assert.equal(progressPercent({ done: 2, total: 5, current: '' }), 40)
  assert.equal(progressPercent({ done: 0, total: 5, current: '' }), 0)
  assert.equal(progressPercent({ done: 5, total: 5, current: '' }), 100)
})
