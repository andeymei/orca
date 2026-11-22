import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcRequest, RpcResponse } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { refactorJobRegistry } from '../../../../refactor/refactor-job-registry'
import { computeRefactorHunks } from '../../../../../shared/refactor/refactor-hunk-computation'
import { REFACTOR_METHODS, refactorBaselineMap, refactorBaselineReader } from './refactor-methods'

const ORIGINAL = 'a\nb\nc\n'
const MODIFIED = 'A\nb\nC\n'
const HUNKS = computeRefactorHunks(ORIGINAL, MODIFIED)

const roots: string[] = []
const jobIds: string[] = []

async function workspaceRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-methods-'))
  roots.push(root)
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'foo.ts'), ORIGINAL)
  return root
}

/** A job whose plan accepts the first hunk of `src/foo.ts`. */
function createJob(root: string, jobId: string): void {
  jobIds.push(jobId)
  refactorJobRegistry.create({
    jobId,
    scratchRoot: path.join(root, '.orca', 'refactor', jobId),
    worktree: 'id:wt-1'
  })
  refactorJobRegistry.update(jobId, {
    plan: {
      jobId,
      sourcePath: 'src/foo.ts',
      proposals: [
        {
          id: 'p1',
          title: 't',
          rationale: 'r',
          files: [{ path: 'src/foo.ts', originalContent: ORIGINAL, hunks: HUNKS }]
        }
      ]
    },
    diskContents: new Map([['src/foo.ts', ORIGINAL]])
  })
}

function createRuntime(stub: {
  executionHostId: string
  workspacePath: string
  writeFileExplorerFile?: (...args: unknown[]) => Promise<unknown>
}): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the refactor handlers read only resolveRuntimeFileTarget, requireStore, prepareHostAgentLaunch, getHostAgentLaunchEnv and writeFileExplorerFile.
  const runtime = {
    getRuntimeId: () => 'runtime-a',
    resolveRuntimeFileTarget: async () => ({
      worktree: { path: stub.workspacePath },
      executionHostId: stub.executionHostId
    }),
    requireStore: () => ({ getSettings: () => ({}) }),
    // The safety net: a test that lets the background run start must never spawn an agent.
    prepareHostAgentLaunch: async () => {
      throw new Error('the test must not start an agent')
    },
    getHostAgentLaunchEnv: () => ({}),
    writeFileExplorerFile: stub.writeFileExplorerFile ?? (async () => ({ ok: true }))
  } as unknown as OrcaRuntimeService
  return runtime
}

function dispatch(
  runtime: OrcaRuntimeService,
  method: string,
  params: unknown,
  options?: { signal?: AbortSignal }
): Promise<RpcResponse> {
  const dispatcher = new RpcDispatcher({ runtime, methods: [...REFACTOR_METHODS] })
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return dispatcher.dispatch(request, options)
}

const PROPOSE_PARAMS = {
  worktree: 'id:wt-1',
  relativePath: 'src/foo.ts',
  content: ORIGINAL
}

describe('the refactoring RPC methods', () => {
  afterEach(async () => {
    for (const jobId of jobIds.splice(0)) {
      refactorJobRegistry.remove(jobId)
    }
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a target path that climbs out of the workspace', async () => {
    const root = await workspaceRoot()
    const runtime = createRuntime({ executionHostId: 'local', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.propose', {
      ...PROPOSE_PARAMS,
      relativePath: '../outside.ts'
    })
    expect(response).toMatchObject({ ok: false })
  })

  it('refuses a drive-relative target path', async () => {
    // The first two path checks accept `C:foo`: it resolves against another drive's current
    // directory, so it names no file of this workspace.
    const root = await workspaceRoot()
    const runtime = createRuntime({ executionHostId: 'local', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.propose', {
      ...PROPOSE_PARAMS,
      relativePath: 'C:foo'
    })
    expect(response).toMatchObject({ ok: false, error: { message: '重构目标必须位于工作区内' } })
  })

  it('refuses an absolute target path', async () => {
    const root = await workspaceRoot()
    const runtime = createRuntime({ executionHostId: 'local', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.propose', {
      ...PROPOSE_PARAMS,
      relativePath: '/etc/passwd'
    })
    expect(response).toMatchObject({ ok: false })
  })

  it('refuses a remote workspace', async () => {
    // The agent is a child process on this machine, so a remote workspace's paths belong to
    // another machine.
    const root = await workspaceRoot()
    const runtime = createRuntime({ executionHostId: 'ssh:target-1', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.propose', PROPOSE_PARAMS)
    expect(response).toMatchObject({
      ok: false,
      error: { message: '远程主机上的重构暂不支持：请在本机的工作区发起重构。' }
    })
  })

  it('refuses an apply on a remote workspace', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-remote')
    const runtime = createRuntime({ executionHostId: 'ssh:target-1', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-remote',
      acceptedHunkIds: [HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: false,
      error: { message: '远程主机上的重构暂不支持：请在本机的工作区发起重构。' }
    })
  })

  it('writes the accepted hunks', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-apply')
    const writeFileExplorerFile = vi.fn(async () => ({ ok: true }))
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile
    })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-apply',
      acceptedHunkIds: [HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: { applied: [{ path: 'src/foo.ts', hunksApplied: 1 }], refusals: [] }
    })
    expect(writeFileExplorerFile).toHaveBeenCalledTimes(1)
  })

  it('tells the user that the file changed during the review', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-changed')
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile: async () => ({ ok: false, diskConflict: 'changed' })
    })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-changed',
      acceptedHunkIds: [HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [{ path: 'src/foo.ts', reason: '文件在评审期间被改动过，请重新生成重构建议' }]
      }
    })
  })

  it('tells the user that the file is gone', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-missing')
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile: async () => ({ ok: false, diskConflict: 'missing' })
    })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-missing',
      acceptedHunkIds: [HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: { applied: [], refusals: [{ path: 'src/foo.ts', reason: '文件已被删除' }] }
    })
  })

  it('tells the user that the file is not UTF-8 text', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-not-utf8')
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile: async () => ({ ok: false, diskConflict: 'not-utf8' })
    })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-not-utf8',
      acceptedHunkIds: [HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [{ path: 'src/foo.ts', reason: '文件不是有效的 UTF-8 文本，无法安全写入' }]
      }
    })
  })

  it('turns a throwing write into a refusal of that file', async () => {
    // The files already written stay written, so a throwing write must not fail the whole apply.
    const root = await workspaceRoot()
    createJob(root, 'job-throw')
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile: async () => {
        throw new Error('Workspace host changed; refresh and try again')
      }
    })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-throw',
      acceptedHunkIds: [HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [
          { path: 'src/foo.ts', reason: '写入失败：Workspace host changed; refresh and try again' }
        ]
      }
    })
  })

  it('finds the baseline when the manifest spells the path with another separator', async () => {
    // The baseline is the buffer the user saw; the disk would drop their unsaved edits.
    const root = await workspaceRoot()
    const baselines = refactorBaselineMap('src/foo.ts', 'buffer\n')
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root })
    expect(await readBaseline('src\\foo.ts')).toBe('buffer\n')
  })

  it('writes nothing when the client gave up', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-aborted')
    const writeFileExplorerFile = vi.fn(async () => ({ ok: true }))
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile
    })
    const controller = new AbortController()
    controller.abort()
    const response = await dispatch(
      runtime,
      'refactor.apply',
      { jobId: 'job-aborted', acceptedHunkIds: [HUNKS[0].id] },
      { signal: controller.signal }
    )
    expect(writeFileExplorerFile).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [{ path: 'src/foo.ts', reason: '重构任务已取消，该文件未写入' }]
      }
    })
  })
})
