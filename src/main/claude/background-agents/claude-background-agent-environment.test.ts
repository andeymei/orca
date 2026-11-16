import { describe, expect, it } from 'vitest'
import { PARENT_AGENT_SESSION_STAMP_ENV_KEYS } from '../../../shared/agent-launch/startup/parent-agent-session-env'
import { backgroundAgentCommandEnvironment } from './claude-background-agent-environment'

const stampKeys = new Set<string>(PARENT_AGENT_SESSION_STAMP_ENV_KEYS)

/** An environment that carries every session stamp the repo knows, plus the job dir. */
function environmentWithSessionStamps(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/local/bin' }
  for (const key of PARENT_AGENT_SESSION_STAMP_ENV_KEYS) {
    env[key] = 'stamped'
  }
  env.CLAUDE_JOB_DIR = '/tmp/claude-jobs/4f5d4302'
  return env
}

describe('backgroundAgentCommandEnvironment', () => {
  it('carries none of the parent session stamps, so the CLI cannot continue that session', () => {
    const stripped = backgroundAgentCommandEnvironment(environmentWithSessionStamps())
    const carried = Object.keys(stripped).filter((key) => stampKeys.has(key))
    expect(carried).toEqual([])
  })

  it('carries no inherited job dir, because a panel agent is not a Claude background job', () => {
    const stripped = backgroundAgentCommandEnvironment(environmentWithSessionStamps())
    expect(stripped.CLAUDE_JOB_DIR).toBeUndefined()
  })

  it('leaves the shared shell capture alone, because the capture is cached and reused', () => {
    const captured = environmentWithSessionStamps()
    backgroundAgentCommandEnvironment(captured)
    expect(captured.CLAUDE_CODE_SESSION_ID).toBe('stamped')
    expect(captured.CLAUDE_JOB_DIR).toBe('/tmp/claude-jobs/4f5d4302')
  })

  it('keeps the environment the CLI needs to be found and to run', () => {
    const stripped = backgroundAgentCommandEnvironment(environmentWithSessionStamps())
    expect(stripped.PATH).toBe('/usr/local/bin')
  })
})
