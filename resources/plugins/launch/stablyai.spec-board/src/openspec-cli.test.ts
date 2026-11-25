import { assert, test } from 'orca/testing'
import { cliBinaryFor, probeOpenspecCli } from './openspec-cli'

test('the probe cannot run a Windows command without a shell, so it says nothing', async () => {
  // A `.cmd` needs a terminal: the probe could not tell, and it does not claim the CLI is missing.
  assert.equal(cliBinaryFor('win32'), null)
  assert.equal(await probeOpenspecCli('win32'), null)
  // Everywhere else the binary runs on its own.
  assert.equal(cliBinaryFor('darwin'), 'openspec')
  assert.equal(cliBinaryFor('linux'), 'openspec')
})
