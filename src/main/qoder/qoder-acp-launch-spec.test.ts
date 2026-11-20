import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acpLaunchSpecFor } from '../acp/launch/acp-launch-registry'
import { GENERIC_ACP_DIALECT } from '../acp/acp-dialects/acp-dialect'

describe('Qoder ACP launch spec', () => {
  it('launches the global build in ACP mode', () => {
    const spec = acpLaunchSpecFor('qoder')
    expect(spec?.command).toBe('qodercli')
    expect(spec?.args({ fullAccess: false, pluginDir: null })).toEqual(['--acp'])
    expect(spec?.dialect).toBe(GENERIC_ACP_DIALECT)
  })

  it('launches the China build under its own command', () => {
    const spec = acpLaunchSpecFor('qoder-cn')
    expect(spec?.command).toBe('qoderclicn')
    expect(spec?.args({ fullAccess: false, pluginDir: null })).toEqual(['--acp'])
  })

  it('keeps the two builds on separate account homes', () => {
    expect(acpLaunchSpecFor('qoder')?.account.pin).toEqual({
      accountHomeVariable: 'QODER_CONFIG_DIR'
    })
    expect(acpLaunchSpecFor('qoder-cn')?.account.pin).toEqual({
      accountHomeVariable: 'QODERCN_CONFIG_DIR'
    })
  })

  it('signs in with the command each build ships', () => {
    expect(acpLaunchSpecFor('qoder')?.loginCommand).toEqual(['qodercli', 'login'])
    expect(acpLaunchSpecFor('qoder-cn')?.loginCommand).toEqual(['qoderclicn', 'login'])
  })

  it('finds each build in its own install directory', () => {
    const home = '/home/dev'
    expect(acpLaunchSpecFor('qoder')?.installDirectories({ env: {}, homePath: home })).toEqual([
      join(home, '.qoder', 'bin', 'qodercli')
    ])
    expect(acpLaunchSpecFor('qoder-cn')?.installDirectories({ env: {}, homePath: home })).toEqual([
      join(home, '.qoder-cn', 'bin')
    ])
  })

  it('gives each build its own History rows', () => {
    expect(acpLaunchSpecFor('qoder')?.sessionHistory.rowAgents).toEqual(['qoder'])
    expect(acpLaunchSpecFor('qoder-cn')?.sessionHistory.rowAgents).toEqual(['qoder-cn'])
  })

  it('resumes a Qoder session by its --resume argument', () => {
    const history = acpLaunchSpecFor('qoder')?.sessionHistory
    expect(history?.parseResumeArgs(['--resume', 'session-42'])).toEqual({ target: 'session-42' })
    expect(history?.parseResumeArgs(['--acp'])).toBeNull()
  })
})
