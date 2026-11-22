import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClaudeStreamJsonConnectionHandlers } from '../claude/claude-stream-json-connection'
import { runRefactorTurn } from './refactor-runner'
import type { RefactorAgentLaunch } from './refactor-agent-launch'
import {
  closeRefactorTurnConnection,
  type RefactorTurnConnection,
  type RefactorTurnConnectionFactory
} from './refactor-turn-connection'

function launchFor(workspaceRoot: string): RefactorAgentLaunch {
  return {
    pathToClaudeCodeExecutable: '/usr/bin/claude',
    env: {},
    cwd: workspaceRoot,
    options: { permissionMode: 'default', allowedTools: [], disallowedTools: ['Bash'] }
  }
}

async function makeWorkspace(): Promise<{ workspaceRoot: string; scratchRoot: string }> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'orca-refactor-turn-'))
  const scratchRoot = path.join(workspaceRoot, '.orca', 'refactor', 'job-1')
  await mkdir(scratchRoot, { recursive: true })
  await writeFile(
    path.join(scratchRoot, 'manifest.json'),
    JSON.stringify({
      proposals: [{ id: 'p1', title: '抽出校验', rationale: '重复了两遍', files: ['src/foo.ts'] }]
    }),
    'utf8'
  )
  return { workspaceRoot, scratchRoot }
}

function connectionFactory(input: {
  onSend: (handlers: ClaudeStreamJsonConnectionHandlers) => void
  close: () => Promise<boolean>
  exitVerdict?: { root: string; tree: string }
}): RefactorTurnConnectionFactory {
  return async (_launch, handlers) => ({
    send: async () => {
      input.onSend(handlers)
    },
    close: input.close,
    exitVerdict: input.exitVerdict
  })
}

const successFrame = { type: 'result', subtype: 'success', is_error: false }

describe('closeRefactorTurnConnection', () => {
  const connection = (close: () => Promise<boolean>): RefactorTurnConnection => ({
    send: async () => {},
    close
  })

  it('says nothing when the child is proven gone', async () => {
    expect(await closeRefactorTurnConnection(connection(async () => true))).toEqual([])
  })

  it('warns when the close does not prove the child exited', async () => {
    const warnings = await closeRefactorTurnConnection({
      ...connection(async () => false),
      exitVerdict: { root: 'live', tree: 'live' }
    })
    expect(warnings.join('\n')).toContain('子进程未确认退出')
    expect(warnings.join('\n')).toContain('根进程未退出：live')
  })

  it('turns a throwing close into a warning instead of letting it escape', async () => {
    const warnings = await closeRefactorTurnConnection(
      connection(async () => {
        throw new Error('the connection refused to close')
      })
    )
    expect(warnings.join('\n')).toContain('关闭连接失败：the connection refused to close')
  })
})

describe('runRefactorTurn', () => {
  it('keeps the verdict when the connection refuses to close', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runRefactorTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      prompt: { system: 'system', user: 'user' },
      signal: new AbortController().signal,
      openConnection: connectionFactory({
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => {
          throw new Error('the connection refused to close')
        }
      })
    })
    expect(turn.state).toBe('done')
    expect(turn.manifest?.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
    expect(turn.warnings.join('\n')).toContain('关闭连接失败：the connection refused to close')
  })

  it('keeps the verdict when the close cannot prove the child exited', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runRefactorTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      prompt: { system: 'system', user: 'user' },
      signal: new AbortController().signal,
      openConnection: connectionFactory({
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => false,
        exitVerdict: { root: 'live', tree: 'live' }
      })
    })
    expect(turn.state).toBe('done')
    expect(turn.warnings.join('\n')).toContain('子进程未确认退出')
  })

  it('fails the turn when the CLI refuses the hook that keeps the gate', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runRefactorTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot,
      workspaceRoot,
      prompt: { system: 'system', user: 'user' },
      signal: new AbortController().signal,
      openConnection: connectionFactory({
        onSend: (handlers) =>
          handlers.onFault?.(
            new Error('claude stream-json exited', {
              cause: new Error(
                'The process answering initialize does not honor onFailure on hook matchers'
              )
            })
          ),
        close: async () => true
      })
    })
    expect(turn.state).toBe('failed')
    expect(turn.warnings.join('\n')).toContain('does not honor onFailure on hook matchers')
  })

  it('reads the scratch root relative to the workspace, not to the process', async () => {
    const { workspaceRoot, scratchRoot } = await makeWorkspace()
    const turn = await runRefactorTurn({
      launch: launchFor(workspaceRoot),
      scratchRoot: path.relative(workspaceRoot, scratchRoot),
      workspaceRoot,
      prompt: { system: 'system', user: 'user' },
      signal: new AbortController().signal,
      openConnection: connectionFactory({
        onSend: (handlers) => handlers.onMessage?.(successFrame),
        close: async () => true
      })
    })
    expect(turn.manifest?.proposals.map((proposal) => proposal.id)).toEqual(['p1'])
  })
})
