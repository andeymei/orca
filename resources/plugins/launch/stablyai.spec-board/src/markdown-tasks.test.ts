import { assert, test } from 'orca/testing'
import { countCheckboxes } from './markdown-tasks'

test('counts done and open boxes, including nested and upper-case ones', () => {
  const md = ['- [x] a', '- [ ] b', '  - [X] c', '    - [-] d', '* [~] e'].join('\n')
  assert.deepEqual(countCheckboxes(md), { done: 2, total: 5, inProgress: 2 })
})

test('ignores boxes inside fenced code blocks', () => {
  const md = [
    '- [x] real',
    '```md',
    '- [ ] example',
    '- [x] example',
    '```',
    '- [ ] also real'
  ].join('\n')
  assert.deepEqual(countCheckboxes(md), { done: 1, total: 2, inProgress: 0 })
})

test('returns zeros for a file with no boxes', () => {
  assert.deepEqual(countCheckboxes('# Plan\n\nNothing here.'), { done: 0, total: 0, inProgress: 0 })
})

test('skips a tilde-fenced block too', () => {
  const md = ['- [x] real', '~~~md', '- [ ] example', '~~~', '- [ ] also real'].join('\n')
  assert.deepEqual(countCheckboxes(md), { done: 1, total: 2, inProgress: 0 })
})
