import { assert, test } from 'orca/testing'
import {
  cliBinaryFor,
  cliClock,
  probeOpenspecCli,
  readCliProbe,
  resetCliProbeCache
} from './openspec-cli'

test('the probe cannot run a Windows command without a shell, so it says nothing', async () => {
  // A `.cmd` needs a terminal: the probe could not tell, and it does not claim the CLI is missing.
  assert.equal(cliBinaryFor('win32'), null)
  assert.equal(await probeOpenspecCli('win32'), null)
  // Everywhere else the binary runs on its own.
  assert.equal(cliBinaryFor('darwin'), 'openspec')
  assert.equal(cliBinaryFor('linux'), 'openspec')
})

test('the machine is asked once a minute, not once a read', async () => {
  let calls = 0
  const probe = async (): Promise<{ available: boolean; version?: string }> => {
    calls += 1
    return { available: true, version: '1.8.0' }
  }
  const realClock = cliClock.now
  let now = 1_700_000_000_000
  cliClock.now = () => now
  resetCliProbeCache()
  try {
    assert.deepEqual(await readCliProbe(probe), { available: true, version: '1.8.0' })
    assert.deepEqual(await readCliProbe(probe), { available: true, version: '1.8.0' })
    // Two reads, one process.
    assert.equal(calls, 1)
    now += 59_000
    await readCliProbe(probe)
    assert.equal(calls, 1)
    // A minute later the machine may have changed its mind.
    now += 2_000
    await readCliProbe(probe)
    assert.equal(calls, 2)
  } finally {
    resetCliProbeCache()
    cliClock.now = realClock
  }
})
