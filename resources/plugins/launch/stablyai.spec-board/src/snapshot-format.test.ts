// The shape the agent is shown has to be a shape the board accepts: the example in the file the
// agent reads is the snapshot the validator has to take.
import { assert, test } from 'orca/testing'
import { parseBoardSnapshot } from './board-schema'
import {
  AGENT_SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT,
  VERIFICATION_COUNT_RULE
} from './snapshot-format'

test('the example the agent is shown is a snapshot the validator accepts', () => {
  const result = parseBoardSnapshot(JSON.parse(JSON.stringify(SNAPSHOT_FORMAT)))
  assert.equal(result.ok, true, result.ok ? '' : result.error)
})

test('what the agent is shown is a snapshot the validator accepts, rules and all', () => {
  // The rules ride along with the shape, so an agent that copies the whole field into its
  // snapshot writes a key the board does not know — and the board has to drop that key rather
  // than refuse the snapshot over it.
  const result = parseBoardSnapshot(JSON.parse(JSON.stringify(AGENT_SNAPSHOT_FORMAT)))
  assert.equal(result.ok, true, result.ok ? '' : result.error)
})

test('the agent is shown the rule with the shape of the snapshot', () => {
  assert.equal(AGENT_SNAPSHOT_FORMAT.rules.verification, VERIFICATION_COUNT_RULE)
})

test('the rule says where the verification rounds go', () => {
  assert.equal(VERIFICATION_COUNT_RULE, '「## 验证记录」轮次写进 `superpowers.verification`')
})

test('the rule is short', () => {
  // The bound the rule was given: it has to fit where it goes, and a rule cut short says
  // nothing the agent can act on.
  assert.ok(VERIFICATION_COUNT_RULE.length <= 40, `${VERIFICATION_COUNT_RULE.length} > 40`)
})
