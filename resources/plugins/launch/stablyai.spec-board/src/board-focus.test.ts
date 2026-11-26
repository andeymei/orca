// The project the sidebar has selected. The board follows the sidebar, so this is what decides
// which project's work the board shows.
import { assert, test } from 'orca/testing'
import { focusOf } from './board-focus'

const workspaces = [
  { id: 'w1', path: '/repo/demo', hostId: 'local', projectId: 'p1' },
  { id: 'w2', path: '/repo/demo/.orca/worktrees/feat-x', hostId: 'local', projectId: 'p1' },
  { id: 'w3', path: 'C:/work/remote', hostId: 'ssh:yolo', projectId: 'p2' }
]

const projects = [
  { id: 'p1', name: 'demo', hostId: 'local', path: '/repo/demo' },
  { id: 'p2', name: 'remote', hostId: 'ssh:yolo', path: 'C:/work/remote' }
]

test('the focused workspace names the project the board shows', () => {
  const focus = focusOf({ workspaceId: 'w1', workspaces, projects })
  assert.equal(focus?.projectId, 'local|/repo/demo')
  assert.equal(focus?.workspaceId, 'w1')
  assert.equal(focus?.host, 'local')
})

test('a worktree of the project is the same project', () => {
  const focus = focusOf({ workspaceId: 'w2', workspaces, projects })
  assert.equal(focus?.projectId, 'local|/repo/demo')
  // The workspace's own path is not the project's path.
  assert.equal(focus?.path, '/repo/demo/.orca/worktrees/feat-x')
})

test('a project on another host is named with that host', () => {
  const focus = focusOf({ workspaceId: 'w3', workspaces, projects })
  assert.equal(focus?.projectId, 'ssh:yolo|C:/work/remote')
  assert.equal(focus?.host, 'ssh:yolo')
})

test('nothing focused is no focus', () => {
  assert.equal(focusOf({ workspaceId: null, workspaces, projects }), null)
})

test('a workspace Orca does not report names nothing', () => {
  assert.equal(focusOf({ workspaceId: 'w9', workspaces, projects }), null)
})

test('without Orca project list, the shortest path of the project is its checkout', () => {
  const focus = focusOf({ workspaceId: 'w2', workspaces, projects: [] })
  assert.equal(focus?.projectId, 'local|/repo/demo')
})

test('a workspace of its own is its own project', () => {
  const focus = focusOf({
    workspaceId: 'w4',
    workspaces: [{ id: 'w4', path: '/folder', hostId: null }],
    projects: []
  })
  assert.equal(focus?.projectId, 'local|/folder')
})
