import { assert, test } from 'orca/testing'
import { correlate, normalizeTopic, topicSimilarity } from './correlation'

test('normalizes a dated design-spec file name to its topic', () => {
  assert.equal(normalizeTopic('2026-11-17-next-edit-suggestion-design.md'), 'next-edit-suggestion')
  assert.equal(normalizeTopic('next-edit-suggestion'), 'next-edit-suggestion')
})

test('scores partial overlap below an exact match', () => {
  assert.equal(topicSimilarity('add-two-factor-auth', 'add-two-factor-auth'), 1)
  assert.ok(topicSimilarity('add-two-factor-auth', 'add-two-factor-auth-ui') < 1)
  assert.equal(topicSimilarity('abc-def', 'xyz'), 0)
})

test('scores two empty topics as no overlap', () => {
  assert.equal(topicSimilarity('', ''), 0)
})

test('pairs exact topics first, then the best remaining overlap', () => {
  const result = correlate(
    [
      { id: 'o1', topic: 'next-edit-suggestion' },
      { id: 'o2', topic: 'intelligent-refactor' }
    ],
    [
      { id: 's1', topic: 'intelligent-refactor' },
      { id: 's2', topic: 'next-edit-suggestion-design' }
    ]
  )
  assert.deepEqual(
    result.matches.map((m) => [m.openspecId, m.superpowersId]),
    [
      ['o2', 's1'],
      ['o1', 's2']
    ]
  )
  assert.deepEqual(result.unmatchedOpenspec, [])
  assert.deepEqual(result.unmatchedSuperpowers, [])
})

test('pairs one-to-one when two changes share a topic', () => {
  const result = correlate(
    [
      { id: 'o1', topic: 'add-x-auth' },
      { id: 'o2', topic: 'update-x-auth' }
    ],
    [{ id: 's1', topic: 'x-auth' }]
  )
  // Exactly one of the two changes gets the single plan, and the other is reported unmatched.
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]!.superpowersId, 's1')
  assert.equal(result.unmatchedOpenspec.length, 1)
  assert.deepEqual(result.unmatchedSuperpowers, [])
})

test('leaves everything unmatched when nothing overlaps', () => {
  const result = correlate([{ id: 'o1', topic: 'alpha' }], [{ id: 's1', topic: 'beta' }])
  assert.deepEqual(result.matches, [])
  assert.deepEqual(result.unmatchedOpenspec, ['o1'])
  assert.deepEqual(result.unmatchedSuperpowers, ['s1'])
})

test('finds a second match that a greedy walk would strand', () => {
  const result = correlate(
    [
      { id: 'o1', topic: 'add-x' },
      { id: 'o2', topic: 'add-x-ui' }
    ],
    [
      { id: 's1', topic: 'add-x' },
      { id: 's2', topic: 'add-x-v2' }
    ]
  )
  assert.equal(result.matches.length, 2)
  assert.deepEqual(result.unmatchedOpenspec, [])
  assert.deepEqual(result.unmatchedSuperpowers, [])
})

test('never pairs two topics that are both empty', () => {
  const result = correlate([{ id: 'o1', topic: '---' }], [{ id: 's1', topic: '.md' }])
  assert.deepEqual(result.matches, [])
  assert.deepEqual(result.unmatchedOpenspec, ['o1'])
  assert.deepEqual(result.unmatchedSuperpowers, ['s1'])
})

test('takes the most confident candidate of an artifact first', () => {
  const result = correlate(
    [
      { id: 'o1', topic: 'add-x' },
      { id: 'o2', topic: 'add-x-ui' }
    ],
    [{ id: 's1', topic: 'add-x-ui' }]
  )
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0]!.openspecId, 'o2')
  assert.deepEqual(result.unmatchedOpenspec, ['o1'])
})

test('never lets one change claim two Superpowers artifacts', () => {
  const result = correlate(
    [{ id: 'o1', topic: 'x-auth' }],
    [
      { id: 's1', topic: 'add-x-auth' },
      { id: 's2', topic: 'update-x-auth' }
    ]
  )
  assert.equal(result.matches.length, 1)
  assert.deepEqual(result.unmatchedOpenspec, [])
  assert.deepEqual(result.unmatchedSuperpowers, ['s2'])
})

test('reports how sure the pairing is', () => {
  const exact = correlate([{ id: 'o1', topic: 'add-x' }], [{ id: 's1', topic: 'add-x' }])
  assert.equal(exact.matches[0]?.confidence, 1)
  const partial = correlate(
    [{ id: 'o1', topic: 'add-two-factor-auth' }],
    [{ id: 's1', topic: 'add-two-factor-auth-ui' }]
  )
  assert.equal(partial.matches[0]?.confidence, 0.8)
})

test('refuses to pair topics that share too little', () => {
  const result = correlate(
    [{ id: 'o1', topic: 'add-two-factor-auth' }],
    [{ id: 's1', topic: 'two-factor' }]
  )
  assert.deepEqual(result.matches, [])
  assert.deepEqual(result.unmatchedOpenspec, ['o1'])
  assert.deepEqual(result.unmatchedSuperpowers, ['s1'])
})

test('pairs an exact topic before the same words in another order', () => {
  const result = correlate(
    [{ id: 'o1', topic: 'add-x' }],
    [
      { id: 's1', topic: 'x-add' },
      { id: 's2', topic: 'add-x' }
    ]
  )
  assert.equal(result.matches[0]?.superpowersId, 's2')
  assert.deepEqual(result.unmatchedSuperpowers, ['s1'])
})
