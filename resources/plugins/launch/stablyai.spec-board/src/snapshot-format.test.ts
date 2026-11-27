// The shape the agent is shown has to be a shape the board accepts: the example in the file the
// agent reads is the snapshot the validator has to take.
import { assert, test } from 'orca/testing'
import { parseBoardSnapshot } from './board-schema'
import {
  AGENT_SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT,
  VERIFICATION_COUNT_RULE
} from './snapshot-format'
import { PASSED, parseVerificationRecords } from './verification-records'
import { filledRecordLine } from './verification-rule-fixture'

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

test('规则说清哪一行算一轮', () => {
  // 规则是 agent 的唯一通道：它得说清行是什么、结论是什么、三个字段各是什么。
  assert.match(VERIFICATION_COUNT_RULE, /验证记录/)
  assert.match(VERIFICATION_COUNT_RULE, /YYYY-MM-DD/)
  assert.match(VERIFICATION_COUNT_RULE, /轮/)
})

test('规则里的结论词就是解析器认的两个词', () => {
  // 词不一样，agent 写出的行就不算一轮——而且是静默地不算。
  assert.ok(VERIFICATION_COUNT_RULE.includes(PASSED))
  assert.ok(VERIFICATION_COUNT_RULE.includes('未通过'))
  // 斜杠并列读起来像「两个都要写」，agent 照抄就写出一行解析器不认的记录。
  assert.equal(VERIFICATION_COUNT_RULE.includes('通过/未通过'), false)
})

test('规则说清 lastPassed 是最后一条算一轮的行的结论', () => {
  // 「有过一轮通过」和「最后一轮通过」是两回事：agent 读错就会在最后一轮失败时写 true。
  assert.match(VERIFICATION_COUNT_RULE, /lastPassed/)
  assert.match(VERIFICATION_COUNT_RULE, /最后一条算作轮次的行/)
  assert.match(VERIFICATION_COUNT_RULE, /rounds/)
  assert.match(VERIFICATION_COUNT_RULE, /passed/)
})

test('规则说复选框不算一轮', () => {
  // 解析器本来就不数复选框，但 agent 不知道：它数的是自己看见的行。
  assert.match(VERIFICATION_COUNT_RULE, /复选框/)
  assert.match(VERIFICATION_COUNT_RULE, /不算一轮/)
})

test('规则里的格式行，解析器读得出来', () => {
  // 规则与解析器必须同时认同一行：规则是 agent 的唯一通道，漂移了就是静默丢轮次。
  const format = VERIFICATION_COUNT_RULE.match(/`(- <[^`]+>)`/)?.[1]
  assert.ok(format, 'the rule must spell the record line inside backticks')
  const facts = parseVerificationRecords(['## 验证记录', filledRecordLine(format)].join('\n'))
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('规则里的例子，只有一种读法', () => {
  // 例子是 agent 照着抄的形状：两轮里最后一轮没过，只有「lastPassed 是最后一条的结论」这一种
  // 读法说得通。规则里的例子和快照的示例必须说同一件事。
  const example = VERIFICATION_COUNT_RULE.match(/`(\{"rounds"[^`]*)`/)?.[1]
  assert.ok(example, 'the rule must spell the counts it wants')
  assert.deepEqual(JSON.parse(example!), {
    rounds: 2,
    passed: 1,
    lastPassed: false
  })
  assert.deepEqual(SNAPSHOT_FORMAT.items[0]!.superpowers.verification, {
    rounds: 2,
    passed: 1,
    lastPassed: false
  })
})
