// 计划文件末尾的「验证记录」一节：验证 agent 自己写的每一轮。解析器只认格式，不判断对错。
import { assert, test } from 'orca/testing'
import { parseVerificationRecords } from './verification-records'

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
