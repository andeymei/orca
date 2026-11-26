// The host a project lives on has to be nameable in a command the agent runs on this machine:
// a name a shell would read as an option is not a host.
import { assert, test } from 'orca/testing'
import { isSafeHostId, safeHostOf } from './host-identity'

test('names the hosts Orca mints', () => {
  assert.equal(isSafeHostId('local'), true)
  assert.equal(isSafeHostId('ssh:yolocalc'), true)
  assert.equal(isSafeHostId('ssh:ssh-1795441139047-rxj28g'), true)
  assert.equal(isSafeHostId('runtime:db289643-131b-44b3-be01-eac5b5410e48'), true)
})

test('refuses a host that could be read as an option', () => {
  assert.equal(isSafeHostId('ssh:-oProxyCommand=evil'), false)
  assert.equal(isSafeHostId('ssh:'), false)
  assert.equal(isSafeHostId('-oProxyCommand=evil'), false)
  assert.equal(isSafeHostId(''), false)
})

test('refuses a host that carries shell syntax', () => {
  assert.equal(isSafeHostId('ssh:a b'), false)
  assert.equal(isSafeHostId('ssh:a;rm'), false)
  assert.equal(isSafeHostId("ssh:a'b"), false)
  assert.equal(isSafeHostId('ssh:a$(x)'), false)
  assert.equal(isSafeHostId('ssh:a/b'), false)
})

test('the safe host is the host itself, or nothing', () => {
  assert.equal(safeHostOf('local'), 'local')
  assert.equal(safeHostOf('ssh:-oProxyCommand=evil'), null)
})
