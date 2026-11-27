// 计划文件末尾的「验证记录」一节：验证 agent 自己写的每一轮。解析器只认格式，不判断对错。
import { assert, test } from 'orca/testing'
import { VERIFICATION_RECORD_RULE } from './action-catalog'
import { VERIFICATION_COUNT_RULE } from './snapshot-format'
import {
  PASSED,
  SEPARATOR,
  parseVerificationRecords
} from './verification-records'
import { filledRecordLine, recordLinesOf } from './verification-rule-fixture'

test('一节里的一行是一轮', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '', '- 2026-11-27 · 通过 · pnpm tc · 421 tests'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('未通过不是通过', () => {
  // 「未通过」里含着「通过」：先找「通过」的解析器会把每一次失败都数成成功。
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-27 · 未通过 · worker-refresh-project.test.ts flaky'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 0, lastPassed: false })
})

test('最近一轮决定这一份工作算不算验证过', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-26 · 通过 · pnpm tc', '- 2026-11-27 · 未通过 · pnpm lint'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 2, passed: 1, lastPassed: false })
})

test('不认识的结论词不算一轮', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-27 · 基本通过 · pnpm tc'].join('\n')
  )
  assert.equal(facts, null)
})

test('日期不对不算一轮', () => {
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026/11/27 · 通过 · pnpm tc',
      '- 2026-13-01 · 通过 · pnpm tc',
      '- 2026-02-30 · 通过 · pnpm tc'
    ].join('\n')
  )
  assert.equal(facts, null)
})

test('没有这一节就没有记录', () => {
  assert.equal(parseVerificationRecords('# 计划\n\n- [x] 一步\n'), null)
})

test('标题之前的内容不算', () => {
  const facts = parseVerificationRecords(
    ['- 2026-11-27 · 通过 · pnpm tc', '', '## 验证记录', '- 2026-11-28 · 通过 · pnpm tc'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('代码块里的行不算', () => {
  // 一份展示记录格式的计划文件会把自己的例子放进代码块；例子不是事实。
  const facts = parseVerificationRecords(
    ['## 验证记录', '', '```md', '- 2026-11-27 · 通过 · pnpm tc', '```'].join('\n')
  )
  assert.equal(facts, null)
})

test('下一个同级或更高级的标题结束这一节', () => {
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026-11-27 · 通过 · pnpm tc',
      '## 别的节',
      '- 2026-11-28 · 通过 · pnpm tc'
    ].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('更高级的标题（一个井号）也结束这一节', () => {
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026-11-27 · 通过 · pnpm tc',
      '# 标题',
      '- 2026-11-28 · 通过 · pnpm tc'
    ].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('更浅的标题（三个井号）不结束这一节', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '### 小节', '- 2026-11-27 · 通过 · pnpm tc'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('没有空格的标题也结束这一节', () => {
  // 「##别的节」也是标题：这一节到那里为止。它后面的记录是别的节的，不能算进这一节——
  // 算进来会把最近一轮的结论翻掉。
  const facts = parseVerificationRecords(
    [
      '## 验证记录',
      '- 2026-11-26 · 通过 · pnpm tc',
      '##别的节',
      '- 2026-11-27 · 未通过 · pnpm lint'
    ].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('复选框不是一轮', () => {
  // 一行复选框会被 countCheckboxes 算成计划进度；它不是一轮验证。
  const facts = parseVerificationRecords(
    ['## 验证记录', '- [x] 验证通过', '- [ ] 还没验证'].join('\n')
  )
  assert.equal(facts, null)
})

test('跑了什么里面也可以有分隔符', () => {
  const facts = parseVerificationRecords(
    ['## 验证记录', '- 2026-11-27 · 通过 · pnpm tc · 421 tests'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('Windows 的换行也算一轮', () => {
  // 计划文件是原样读进来的：Windows 的检出里每行都留着 \r，标题后面那个 \r 会让这一节
  // 永远进不去，于是每一份计划都成了「没有验证过」。
  const facts = parseVerificationRecords('## 验证记录\r\n\r\n- 2026-11-27 · 通过 · pnpm tc\r\n')
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('没有项目符号的行不是一轮', () => {
  // 缩进了四格的代码块不是围栏，它里面的例子照样会到达解析器；没有项目符号的行不是一轮。
  const facts = parseVerificationRecords(
    ['## 验证记录', '2026-11-27 · 通过 · pnpm tc'].join('\n')
  )
  assert.equal(facts, null)
})

test('标题里的全角空格也是分隔符', () => {
  const facts = parseVerificationRecords(
    ['##　验证记录', '- 2026-11-27 · 通过 · pnpm tc'].join('\n')
  )
  assert.deepEqual(facts, { rounds: 1, passed: 1, lastPassed: true })
})

test('两条规则里的每一行记录，解析器都读得出来', () => {
  // 写记录的 agent 与数记录的 agent 读的是两条规则：规则与解析器认的行不一样，轮次就静默地
  // 丢掉——验证 agent 写了一行，刷新 agent 没数进去，看板上没有一处报错。
  for (const rule of [VERIFICATION_RECORD_RULE, VERIFICATION_COUNT_RULE]) {
    const lines = recordLinesOf(rule)
    assert.ok(lines.length > 0, 'the rule must show a record line')
    for (const line of lines) {
      const filled = filledRecordLine(line)
      const facts = parseVerificationRecords(['## 验证记录', filled].join('\n'))
      assert.ok(facts !== null, line)
      assert.equal(facts.rounds, 1, line)
      // 这一行自己的结论，就是解析器读出来的结论。
      assert.equal(facts.lastPassed, filled.split(SEPARATOR)[1]!.trim() === PASSED, line)
    }
  }
})
