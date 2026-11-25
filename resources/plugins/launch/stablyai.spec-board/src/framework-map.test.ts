import { assert, test } from 'orca/testing'
import { CORRESPONDENCE, OPENSPEC_STAGES, SUPERPOWERS_FLOW } from './framework-map'

test('every OpenSpec stage names artifacts and commands', () => {
  assert.equal(OPENSPEC_STAGES.length, 3)
  for (const stage of OPENSPEC_STAGES) {
    assert.ok(stage.artifacts.length > 0, stage.id)
    assert.ok(stage.commands.length > 0, stage.id)
  }
})

test('the Superpowers flow covers all fifteen skills and marks its gates', () => {
  assert.equal(SUPERPOWERS_FLOW.length, 15)
  assert.ok(SUPERPOWERS_FLOW.filter((step) => step.gate !== null).length >= 2)
  assert.ok(SUPERPOWERS_FLOW.every((step) => step.skill.length > 0 && step.role.length > 0))
})

test('every correspondence row names both frameworks', () => {
  assert.equal(CORRESPONDENCE.length, 4)
  for (const row of CORRESPONDENCE) {
    assert.ok(row.openspec.length > 0)
    assert.ok(row.superpowers.length > 0)
    assert.ok(row.note.length > 0)
  }
})
