import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acpLaunchSpecFor } from '../acp/launch/acp-launch-registry'
import { GENERIC_ACP_DIALECT } from '../acp/acp-dialects/acp-dialect'

describe('Qoder ACP launch spec', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('launches the global build in ACP mode', () => {
    const spec = acpLaunchSpecFor('qoder')
    expect(spec?.command).toBe('qodercli')
    expect(spec?.args({ fullAccess: false, pluginDir: null })).toEqual(['--acp'])
    expect(spec?.dialect).toBe(GENERIC_ACP_DIALECT)
    // /compact takes focus areas after the command.
    expect(spec?.compaction).toBe(true)
    expect(spec?.compactionInstructions).toBe(true)
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

  it('gives each build its own account home path', async () => {
    vi.stubEnv('QODER_CONFIG_DIR', undefined)
    vi.stubEnv('QODERCN_CONFIG_DIR', undefined)
    expect(
      await acpLaunchSpecFor('qoder')?.account.resolve({
        launchEnv: { QODER_CONFIG_DIR: '/accounts/global' },
        stateDirectory: '/state'
      })
    ).toEqual({ variable: 'QODER_CONFIG_DIR', path: '/accounts/global' })
    expect(
      await acpLaunchSpecFor('qoder-cn')?.account.resolve({
        launchEnv: { QODERCN_CONFIG_DIR: '/accounts/china' },
        stateDirectory: '/state'
      })
    ).toEqual({ variable: 'QODERCN_CONFIG_DIR', path: '/accounts/china' })
    expect(
      await acpLaunchSpecFor('qoder')?.account.resolve({ launchEnv: {}, stateDirectory: '/state' })
    ).toEqual({ variable: 'QODER_CONFIG_DIR', path: join(homedir(), '.qoder') })
    expect(
      await acpLaunchSpecFor('qoder-cn')?.account.resolve({
        launchEnv: {},
        stateDirectory: '/state'
      })
    ).toEqual({ variable: 'QODERCN_CONFIG_DIR', path: join(homedir(), '.qoder-cn') })
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

  it('resumes a Qoder session by every documented spelling', () => {
    const history = acpLaunchSpecFor('qoder')?.sessionHistory
    expect(history?.parseResumeArgs(['-r', 'session-42'])).toEqual({ target: 'session-42' })
    expect(history?.parseResumeArgs(['--resume=session-42'])).toEqual({ target: 'session-42' })
    expect(history?.parseResumeArgs(['-c'])).toEqual({ target: null })
    expect(history?.parseResumeArgs(['--continue'])).toEqual({ target: null })
    // A marker with no value could open any session, so the guard reads it as targetless.
    expect(history?.parseResumeArgs(['--resume'])).toEqual({ target: null })
    expect(history?.parseResumeArgs(['-r=session-42'])).toEqual({ target: 'session-42' })
  })

  it('scrubs the permission-mode variables that would bypass the prompts', () => {
    const env: Record<string, string> = {
      QODER_PERMISSION_MODE: 'bypass_permissions',
      QODERCN_PERMISSION_MODE: 'bypass_permissions'
    }
    expect(acpLaunchSpecFor('qoder')?.scrubEnvironment?.(env, {})).toEqual([
      'QODER_PERMISSION_MODE',
      'QODERCN_PERMISSION_MODE',
      'QODERCN_CONFIG_DIR'
    ])
    expect(env).toEqual({})
    const chinaEnv: Record<string, string> = {
      QODER_PERMISSION_MODE: 'bypass_permissions',
      QODERCN_PERMISSION_MODE: 'bypass_permissions'
    }
    expect(acpLaunchSpecFor('qoder-cn')?.scrubEnvironment?.(chinaEnv, {})).toEqual([
      'QODER_PERMISSION_MODE',
      'QODERCN_PERMISSION_MODE',
      'QODER_CONFIG_DIR'
    ])
    expect(chinaEnv).toEqual({})
  })

  it("scrubs the other build's config home but keeps this build's own", () => {
    // An inherited QODERCN_CONFIG_DIR must not point the global build at the China home.
    const globalEnv: Record<string, string> = {
      QODER_CONFIG_DIR: '/home/dev/.qoder',
      QODERCN_CONFIG_DIR: '/home/dev/.qoder-cn'
    }
    expect(acpLaunchSpecFor('qoder')?.scrubEnvironment?.(globalEnv, {})).toContain(
      'QODERCN_CONFIG_DIR'
    )
    expect(globalEnv.QODER_CONFIG_DIR).toBe('/home/dev/.qoder')
    expect(globalEnv.QODERCN_CONFIG_DIR).toBeUndefined()

    // And the other way round.
    const chinaEnv: Record<string, string> = {
      QODER_CONFIG_DIR: '/home/dev/.qoder',
      QODERCN_CONFIG_DIR: '/home/dev/.qoder-cn'
    }
    expect(acpLaunchSpecFor('qoder-cn')?.scrubEnvironment?.(chinaEnv, {})).toContain(
      'QODER_CONFIG_DIR'
    )
    expect(chinaEnv.QODERCN_CONFIG_DIR).toBe('/home/dev/.qoder-cn')
    expect(chinaEnv.QODER_CONFIG_DIR).toBeUndefined()
  })
})
