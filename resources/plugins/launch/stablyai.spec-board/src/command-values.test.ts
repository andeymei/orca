import { assert, test } from 'orca/testing'
import { isSafeCommandPath, isSafeCommandValue } from './command-values'

test('a plain name may reach a command', () => {
  assert.equal(isSafeCommandValue('add-x'), true)
  assert.equal(isSafeCommandValue('x-design.md'), true)
  assert.equal(isSafeCommandValue('a1'), true)
  assert.equal(isSafeCommandValue('A_b.c-9'), true)
})

test('a value carrying a shell character may not', () => {
  assert.equal(isSafeCommandValue('x; rm -rf /'), false)
  assert.equal(isSafeCommandValue('a b'), false)
  assert.equal(isSafeCommandValue('$(id)'), false)
  assert.equal(isSafeCommandValue('`id`'), false)
  assert.equal(isSafeCommandValue('a|b'), false)
  assert.equal(isSafeCommandValue('a>b'), false)
  assert.equal(isSafeCommandValue('a/b'), false)
  assert.equal(isSafeCommandValue('a\\b'), false)
})

test('a value that could be read as an option may not', () => {
  assert.equal(isSafeCommandValue('--help'), false)
  assert.equal(isSafeCommandValue('-rf'), false)
  assert.equal(isSafeCommandValue('.hidden'), false)
  assert.equal(isSafeCommandValue('..'), false)
  assert.equal(isSafeCommandValue(''), false)
})

test('a path is safe when every segment of it is', () => {
  assert.equal(isSafeCommandPath('docs/superpowers/specs/x-design.md'), true)
  assert.equal(isSafeCommandPath('/abs/specs/x-design.md'), true)
  assert.equal(isSafeCommandPath('docs//specs/x.md'), true)
})

test('a path with one unsafe segment is not safe', () => {
  assert.equal(isSafeCommandPath('docs/; rm -rf /'), false)
  assert.equal(isSafeCommandPath('../etc/passwd'), false)
  assert.equal(isSafeCommandPath('docs/../secrets'), false)
  assert.equal(isSafeCommandPath('docs/a b.md'), false)
})
