import { describe, expect, it } from 'vitest'
import { listPluginProjects, listPluginWorkspaces } from './plugin-host-workspace-list'
import type { PluginPairedHosts } from './plugin-host-paired-hosts'
import type { PluginRuntimeRpc } from './plugin-host-runtime-call'

const REMOTE_PATH = 'D:/ctjt/code/ctjt-platform/ctjt-service'

/** This machine's own runtime: one local worktree of one local project. */
const localCall: PluginRuntimeRpc = async (method) => {
  switch (method) {
    case 'worktree.list':
      return {
        worktrees: [
          {
            id: 'wt-local-1',
            repoId: 'repo-local-1',
            displayName: 'prism_orca',
            path: '/Users/me/code/prism_orca',
            branch: 'refs/heads/main'
          }
        ],
        totalCount: 1
      }
    case 'repo.list':
      return {
        repos: [
          {
            id: 'repo-local-1',
            kind: 'git',
            displayName: 'prism_orca',
            path: '/Users/me/code/prism_orca'
          }
        ]
      }
    case 'folderWorkspace.list':
      return { folderWorkspaces: [] }
    default:
      throw new Error(`unexpected method ${method}`)
  }
}

/** The paired server, reached over the relay: one project, one worktree of it. */
function pairedHosts(
  answers: Record<string, unknown> | null = {
    'worktree.ps': {
      worktrees: [
        {
          worktreeId: 'wt-remote-1::D:/ctjt/code/ctjt-platform/ctjt-service',
          repoId: 'repo-remote-1',
          path: REMOTE_PATH,
          branch: 'refs/heads/main',
          displayName: 'ctjt-service',
          repo: 'ctjt-service'
        }
      ]
    },
    'repo.list': {
      repos: [
        {
          id: 'repo-remote-1',
          kind: 'git',
          displayName: 'ctjt-service',
          path: REMOTE_PATH
        }
      ]
    }
  }
): PluginPairedHosts {
  return {
    list: async () => ['env-1'],
    call: async (_environmentId, method) => {
      const answer = answers?.[method]
      if (answer === undefined) {
        throw new Error('the server cannot answer')
      }
      return { ok: true, result: answer }
    }
  }
}

describe('the workspace and project lists of a host Orca reaches', () => {
  it('carries the paired server’s worktrees, under the server as their host', async () => {
    const { workspaces } = await listPluginWorkspaces(localCall, false, localCall, pairedHosts())

    expect(workspaces).toEqual([
      {
        id: 'wt-local-1',
        kind: 'worktree',
        name: 'prism_orca',
        project: 'prism_orca',
        projectId: 'repo-local-1',
        path: '/Users/me/code/prism_orca',
        branch: 'main',
        hostId: null
      },
      {
        id: 'wt-remote-1::D:/ctjt/code/ctjt-platform/ctjt-service',
        kind: 'worktree',
        name: 'ctjt-service',
        project: 'ctjt-service',
        projectId: 'repo-remote-1',
        path: REMOTE_PATH,
        branch: 'main',
        hostId: 'runtime:env-1'
      }
    ])
  })

  it('carries the paired server’s projects, under the server as their host', async () => {
    const { projects } = await listPluginProjects(localCall, pairedHosts())

    expect(projects).toEqual([
      {
        id: 'repo-local-1',
        name: 'prism_orca',
        kind: 'git',
        hostId: 'local',
        path: '/Users/me/code/prism_orca',
        hidden: false
      },
      {
        id: 'repo-remote-1',
        name: 'ctjt-service',
        kind: 'git',
        hostId: 'runtime:env-1',
        path: REMOTE_PATH,
        hidden: false
      }
    ])
  })

  it('leaves this machine’s list standing when a paired server cannot answer', async () => {
    const unreachable: PluginPairedHosts = {
      list: async () => ['env-1'],
      call: async () => {
        throw new Error('the relay is down')
      }
    }

    const { workspaces } = await listPluginWorkspaces(localCall, false, localCall, unreachable)
    const { projects } = await listPluginProjects(localCall, unreachable)

    expect(workspaces.map((row) => row.id)).toEqual(['wt-local-1'])
    expect(projects.map((row) => row.id)).toEqual(['repo-local-1'])
  })

  it('leaves this machine’s list standing when a paired server refuses', async () => {
    const refused: PluginPairedHosts = {
      list: async () => ['env-1'],
      call: async () => ({ ok: false, error: 'not paired any more' })
    }

    const { workspaces } = await listPluginWorkspaces(localCall, false, localCall, refused)

    expect(workspaces.map((row) => row.id)).toEqual(['wt-local-1'])
  })
})
