// A registry path is written by hand, so it has to match the row Orca reports even when the two
// spell the same directory differently.
import { assert, test } from 'orca/testing'
import { findWorkspaceId, normalizePath, projectRefsFromWorkspaces } from './workspace-match'

const rows = [
  { id: 'w1', path: '/Users/me/repo', hostId: 'local' },
  { id: 'w2', path: 'C:/work/remote', hostId: 'ssh:yolo' }
]

test('normalizes separators and case for Windows-style paths', () => {
  assert.equal(normalizePath('C:\\Work\\Remote\\'), 'c:/work/remote')
  assert.equal(normalizePath('/Users/me/repo/'), '/users/me/repo')
  assert.equal(normalizePath('C://Work//Remote'), 'c:/work/remote')
})

test('matches a hand-written registry path against the reported row', () => {
  assert.equal(findWorkspaceId(rows, { path: 'c:\\work\\remote', host: 'ssh:yolo' }), 'w2')
})

test('never falls back to a different workspace', () => {
  assert.equal(findWorkspaceId(rows, { path: 'C:/work/other', host: 'ssh:yolo' }), null)
})

test('collapses the worktrees of one project into a single entry', () => {
  const refs = projectRefsFromWorkspaces([
    { id: 'a', path: '/repo', hostId: 'local', projectId: 'p1' },
    { id: 'b', path: '/repo/.orca/worktrees/feat-x', hostId: 'local', projectId: 'p1' },
    { id: 'c', path: '/other', hostId: 'local', projectId: 'p2' },
    { id: 'd', path: 'C:/remote', hostId: 'ssh:yolo', projectId: 'p3' }
  ])
  assert.deepEqual(
    refs.map((ref) => ref.path),
    ['/repo', '/other']
  )
})

test('two workspaces that differ only in case are not confused', () => {
  const same = [
    { id: 'w1', path: '/work/App', hostId: 'local' },
    { id: 'w2', path: '/work/app', hostId: 'local' }
  ]
  assert.equal(findWorkspaceId(same, { path: '/work/app', host: 'local' }), 'w2')
  assert.equal(findWorkspaceId(same, { path: '/work/App', host: 'local' }), 'w1')
})

test('a row without a host belongs to a local project', () => {
  const local = [{ id: 'w3', path: '/Users/me/group', hostId: null }]
  assert.equal(findWorkspaceId(local, { path: '/users/me/group', host: 'local' }), 'w3')
  assert.equal(findWorkspaceId(local, { path: '/users/me/group', host: 'ssh:yolo' }), null)
})

test('the same path on another host is another directory', () => {
  const same = [
    { id: 'w1', path: '/repo', hostId: 'local' },
    { id: 'w2', path: '/repo', hostId: 'ssh:yolo' }
  ]
  assert.equal(findWorkspaceId(same, { path: '/repo', host: 'ssh:yolo' }), 'w2')
  assert.equal(findWorkspaceId(same, { path: '/repo', host: 'local' }), 'w1')
})

test('a project without a name of its own is named after its directory', () => {
  const refs = projectRefsFromWorkspaces([
    { id: 'a', path: '/repo/demo', hostId: 'local', projectId: 'p1' }
  ])
  assert.deepEqual(refs, [{ name: 'demo', host: 'local', path: '/repo/demo' }])
})

test('the projects the local workspaces stand for are local and named', () => {
  const refs = projectRefsFromWorkspaces([
    { id: 'a', path: '/repo', hostId: 'local', projectId: 'p1', project: 'demo' },
    { id: 'b', path: '/repo/.orca/worktrees/feat-x', hostId: 'local', projectId: 'p1' }
  ])
  assert.deepEqual(refs, [{ name: 'demo', host: 'local', path: '/repo' }])
})
