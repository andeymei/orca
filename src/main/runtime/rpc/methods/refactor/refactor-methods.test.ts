import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcRequest, RpcResponse } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { refactorJobRegistry } from '../../../../refactor/refactor-job-registry'
import {
  refactorBaselineMap,
  refactorBaselineReader,
  type RefactorBaselineDeps
} from '../../../../refactor/refactor-baselines'
import { computeRefactorHunks } from '../../../../../shared/refactor/refactor-hunk-computation'
import { REFACTOR_METHODS } from './refactor-methods'

const ORIGINAL = 'a\nb\nc\n'
const MODIFIED = 'A\nb\nC\n'
/** The hunk ids name the file they belong to, the way the plan builds them. */
const FOO_HUNKS = computeRefactorHunks(ORIGINAL, MODIFIED, 'src/foo.ts:')
const BAR_HUNKS = computeRefactorHunks(ORIGINAL, MODIFIED, 'src/bar.ts:')

const roots: string[] = []
const jobIds: string[] = []

async function workspaceRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-methods-'))
  roots.push(root)
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'foo.ts'), ORIGINAL)
  await fs.writeFile(path.join(root, 'src', 'bar.ts'), ORIGINAL)
  return root
}

/** A job whose plan accepts the first hunk of every file it names. */
function createJob(root: string, jobId: string, paths: string[] = ['src/foo.ts']): void {
  jobIds.push(jobId)
  const files = paths.map((filePath) => ({
    path: filePath,
    originalContent: ORIGINAL,
    hunks: computeRefactorHunks(ORIGINAL, MODIFIED, `${filePath}:`)
  }))
  refactorJobRegistry.create({
    jobId,
    scratchRoot: path.join(root, '.orca', 'refactor', jobId),
    worktree: 'id:wt-1',
    relativePath: 'src/foo.ts'
  })
  refactorJobRegistry.update(jobId, {
    state: 'done',
    plan: {
      jobId,
      sourcePath: 'src/foo.ts',
      proposals: [{ id: 'p1', title: 't', rationale: 'r', files }]
    },
    diskContents: new Map(paths.map((filePath) => [filePath, ORIGINAL]))
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

/** Whether two paths name the same file here: the filesystem's own answer. */
async function isSameFile(left: string, right: string): Promise<boolean> {
  try {
    const [leftStat, rightStat] = await Promise.all([fs.stat(left), fs.stat(right)])
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
  } catch {
    return false
  }
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
    expect(response).toMatchObject({
      ok: false,
      error: { message: 'The refactoring target must be inside the workspace' }
    })
  })

  it('names the trailing space in a refused target path', async () => {
    // A trailing space is stripped by Windows before it reads the name, so the path means
    // something else there; the user has to be told that a segment of the path ends wrongly.
    const root = await workspaceRoot()
    const runtime = createRuntime({ executionHostId: 'local', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.propose', {
      ...PROPOSE_PARAMS,
      relativePath: 'src/foo.ts '
    })
    expect(response).toMatchObject({
      ok: false,
      error: {
        message: 'The path of the refactoring target has a segment that ends with a space or a dot'
      }
    })
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
      error: {
        message:
          'Refactoring on a remote host is not supported: start it in a workspace on this machine.'
      }
    })
  })

  it('refuses an apply on a remote workspace', async () => {
    const root = await workspaceRoot()
    createJob(root, 'job-remote')
    const runtime = createRuntime({ executionHostId: 'ssh:target-1', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-remote',
      acceptedHunkIds: [FOO_HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: false,
      error: {
        message:
          'Refactoring on a remote host is not supported: start it in a workspace on this machine.'
      }
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
      acceptedHunkIds: [FOO_HUNKS[0].id]
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
      acceptedHunkIds: [FOO_HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [
          {
            path: 'src/foo.ts',
            reason: 'The file changed during the review; generate the refactoring suggestions again'
          }
        ]
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
      acceptedHunkIds: [FOO_HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: { applied: [], refusals: [{ path: 'src/foo.ts', reason: 'The file was deleted' }] }
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
      acceptedHunkIds: [FOO_HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [
          {
            path: 'src/foo.ts',
            reason: 'The file is not valid UTF-8 text and cannot be written safely'
          }
        ]
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
      acceptedHunkIds: [FOO_HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [
          {
            path: 'src/foo.ts',
            reason: 'The write failed: Workspace host changed; refresh and try again'
          }
        ]
      }
    })
  })

  it('finds the baseline when the manifest spells the path with another separator', async () => {
    // A backslash is a separator on Windows and part of the name on POSIX, so the two spellings
    // name the same file only on Windows; on POSIX the spelled path names a file that is not
    // there, and it has no baseline.
    const root = await workspaceRoot()
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/foo.ts',
      content: 'buffer\n'
    })
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root })
    const sameFile = await isSameFile(
      path.join(root, 'src', 'foo.ts'),
      path.join(root, 'src\\foo.ts')
    )
    expect(await readBaseline('src\\foo.ts')).toBe(sameFile ? 'buffer\n' : null)
  })

  it('gives the buffer to the file it names and to no other file', async () => {
    // `src/Foo.ts` and `src/foo.ts` are one file on macOS and Windows and two files on Linux,
    // and only the filesystem knows which. The buffer belongs to the one file either way.
    const root = await workspaceRoot()
    await fs.writeFile(path.join(root, 'src', 'Foo.ts'), ORIGINAL)
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/Foo.ts',
      content: 'the user buffer\n'
    })
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root })
    const sameFile = await isSameFile(
      path.join(root, 'src', 'Foo.ts'),
      path.join(root, 'src', 'foo.ts')
    )
    expect(await readBaseline('src/foo.ts')).toBe(sameFile ? 'the user buffer\n' : ORIGINAL)
    // A file the manifest names and the job is not about gets its own disk content.
    expect(await readBaseline('src/bar.ts')).toBe(ORIGINAL)
  })

  it('gives the buffer to a hardlinked twin of the file', async () => {
    // A hardlink is another name of one file: the same inode, another path. The buffer is
    // the user's edit of that file, so the twin is the same file.
    const root = await workspaceRoot()
    const target = path.join(root, 'src', 'foo.ts')
    await fs.link(target, path.join(root, 'src', 'twin.ts'))
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/foo.ts',
      content: 'the user buffer\n'
    })
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root })
    expect(await readBaseline('src/twin.ts')).toBe('the user buffer\n')
  })

  it("does not hand the buffer to a file that took the target's inode", async () => {
    // The target was deleted during the turn and the filesystem handed its inode to
    // another file: the identity answers, the content does not, so the buffer is not that
    // file's baseline. The collision is forced, not waited for — no filesystem hands a
    // freed inode over on demand.
    const root = await workspaceRoot()
    const deps: RefactorBaselineDeps = { stat: async () => ({ dev: 1, ino: 42 }) }
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/foo.ts',
      content: 'the user buffer\n',
      deps
    })
    await fs.writeFile(path.join(root, 'src', 'bar.ts'), 'a different file\n')
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root, deps })
    expect(await readBaseline('src/bar.ts')).toBe('a different file\n')
  })

  it('gives the buffer to a file the manifest spells with another case, changed or not', async () => {
    // The canonical path answers for the file, and a path answer needs no witness: the
    // user saved the file during the review, so its content is not the content the job
    // started with, and the buffer is still the right baseline for the path.
    const root = await workspaceRoot()
    await fs.writeFile(path.join(root, 'src', 'Foo.ts'), ORIGINAL)
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/Foo.ts',
      content: 'the user buffer\n'
    })
    await fs.writeFile(path.join(root, 'src', 'Foo.ts'), 'the saved version\n')
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root })
    const sameFile = await isSameFile(
      path.join(root, 'src', 'Foo.ts'),
      path.join(root, 'src', 'foo.ts')
    )
    if (sameFile) {
      // One file: the canonical path answers, and the buffer is its baseline.
      expect(await readBaseline('src/foo.ts')).toBe('the user buffer\n')
    } else {
      // Two files: the manifest named another one, and a file with no baseline of its own
      // gets its own disk content — not null, the file is there.
      expect(await readBaseline('src/foo.ts')).toBe(ORIGINAL)
    }
  })

  it('gives the buffer to a file that was replaced under it', async () => {
    // An editor that saves by renaming leaves the path alone and the inode different. The
    // buffer belongs to the path the user is editing, so the inode alone would lose it.
    const root = await workspaceRoot()
    const target = path.join(root, 'src', 'foo.ts')
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/foo.ts',
      content: 'the user buffer\n'
    })
    await fs.rm(target)
    await fs.writeFile(target, 'the saved version\n')
    const readBaseline = refactorBaselineReader({ baselines, workspaceRoot: root })
    expect(await readBaseline('src/foo.ts')).toBe('the user buffer\n')
  })

  it('stores the buffer under the path as well as under the inode', async () => {
    // The inode alone would not do: an editor that saves by renaming leaves the name alone
    // and changes the inode, and a filesystem that hands the freed inode to the next file
    // would make the inode answer for a file that is not this one. The name has to be a key
    // of its own, whatever the allocator does.
    const root = await workspaceRoot()
    const baselines = await refactorBaselineMap({
      workspaceRoot: root,
      relativePath: 'src/foo.ts',
      content: 'the user buffer\n'
    })
    expect([...baselines.keys()]).toContain(path.join(root, 'src', 'foo.ts'))
  })

  it('refuses an apply on a job whose turn never produced a plan', async () => {
    // A turn that timed out or was cancelled has no plan; the apply must say so rather than
    // report an empty success.
    const root = await workspaceRoot()
    jobIds.push('job-no-plan')
    refactorJobRegistry.create({
      jobId: 'job-no-plan',
      scratchRoot: path.join(root, '.orca', 'refactor', 'job-no-plan'),
      worktree: 'id:wt-1',
      relativePath: 'src/foo.ts'
    })
    refactorJobRegistry.update('job-no-plan', { state: 'timed_out' })
    const runtime = createRuntime({ executionHostId: 'local', workspacePath: root })
    const response = await dispatch(runtime, 'refactor.apply', {
      jobId: 'job-no-plan',
      acceptedHunkIds: [FOO_HUNKS[0].id]
    })
    expect(response).toMatchObject({
      ok: false,
      error: { message: 'The refactoring task has no proposals to review yet' }
    })
  })

  it('stops an in-flight apply when the job is discarded', async () => {
    // The user applies and then discards: the files the apply had not reached must not be written.
    const root = await workspaceRoot()
    createJob(root, 'job-discarded', ['src/foo.ts', 'src/bar.ts'])
    const writeGate = Promise.withResolvers<void>()
    const writeFileExplorerFile = vi.fn(async () => {
      await writeGate.promise
      return { ok: true }
    })
    const runtime = createRuntime({
      executionHostId: 'local',
      workspacePath: root,
      writeFileExplorerFile
    })
    const applying = dispatch(runtime, 'refactor.apply', {
      jobId: 'job-discarded',
      acceptedHunkIds: [FOO_HUNKS[0].id, BAR_HUNKS[0].id]
    })
    await vi.waitFor(() => expect(writeFileExplorerFile).toHaveBeenCalledTimes(1))
    await dispatch(runtime, 'refactor.discard', { jobId: 'job-discarded' })
    writeGate.resolve()
    const response = await applying
    expect(writeFileExplorerFile).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [{ path: 'src/foo.ts', hunksApplied: 1 }],
        refusals: [
          { path: 'src/bar.ts', reason: 'The refactoring was cancelled; the file was not written' }
        ]
      }
    })
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
      { jobId: 'job-aborted', acceptedHunkIds: [FOO_HUNKS[0].id] },
      { signal: controller.signal }
    )
    expect(writeFileExplorerFile).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      ok: true,
      result: {
        applied: [],
        refusals: [
          { path: 'src/foo.ts', reason: 'The refactoring was cancelled; the file was not written' }
        ]
      }
    })
  })
})
