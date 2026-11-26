// The shape the agent is shown has to be a shape the board accepts: the example in the file the
// agent reads is the snapshot the validator has to take.
import { assert, test } from 'orca/testing'
import { parseBoardSnapshot } from './board-schema'
import { SNAPSHOT_FORMAT } from './snapshot-format'

test('the example the agent is shown is a snapshot the validator accepts', () => {
  const result = parseBoardSnapshot(JSON.parse(JSON.stringify(SNAPSHOT_FORMAT)))
  assert.equal(result.ok, true, result.ok ? '' : result.error)
})
