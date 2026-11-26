// The prompt the refresh hands the agent. It has to state the task and the schema exactly as the
// validator enforces it: a mismatch shows the user a broken-snapshot card instead of a board.
import { assert, test } from 'orca/testing'
import { buildRefreshPrompt, PROMPT_MAX_CHARS } from './refresh-prompt'

const prompt = buildRefreshPrompt({
  registryPath: '/home/me/.orca/spec-board/projects.json',
  scanListPath: '/home/me/.orca/spec-board/scan-list.json',
  snapshotPath: '/home/me/.orca/spec-board/board.json'
})

test('names the registry, the scan list and the snapshot file', () => {
  assert.ok(prompt.includes('/home/me/.orca/spec-board/projects.json'))
  assert.ok(prompt.includes('/home/me/.orca/spec-board/scan-list.json'))
  assert.ok(prompt.includes('/home/me/.orca/spec-board/board.json'))
})

test('says every project of the list has to be scanned, the remote ones included', () => {
  assert.match(prompt, /每一项都要扫/)
  assert.match(prompt, /别的机器/)
  // The host is what tells a project on another machine from one on this one.
  assert.match(prompt, /ssh:<target>/)
})

test('states the task: read the registry, scan the projects, write the snapshot', () => {
  assert.match(prompt, /注册表/)
  assert.match(prompt, /扫描/)
  assert.match(prompt, /openspec\/changes\//)
  assert.match(prompt, /openspec\/specs\//)
  assert.match(prompt, /docs\/superpowers\/specs\//)
  assert.match(prompt, /docs\/superpowers\/plans\//)
  assert.match(prompt, /ssh/)
})

test('tells the agent how to read a Windows host', () => {
  assert.match(prompt, /PowerShell/)
  assert.match(prompt, /Get-Content -Raw/)
})

test('never lets a path be interpolated into a command', () => {
  // The path is data: it comes from the other machine's filesystem, where a directory name may
  // be anything. A path pasted into a command line is a command line somebody else wrote.
  assert.match(prompt, /路径永远不要拼进命令/)
  assert.match(prompt, /base64/)
  assert.match(prompt, /--decode/)
  // The Windows form reads the path as data and passes it literally.
  assert.match(prompt, /Get-Content -Raw -LiteralPath/)
  assert.match(prompt, /FromBase64String/)
})

test('encodes a path without a heredoc delimiter the path could end', () => {
  // A fixed delimiter is not safe: a path holding a newline and that delimiter ends the heredoc
  // early, and what follows is a command on this machine.
  assert.equal(prompt.includes("<<'EOF'"), false)
  // The path goes through a file the agent writes, or through a delimiter it made up.
  assert.match(prompt, /base64 < 那个文件/)
  assert.match(prompt, /随机分隔符/)
  assert.match(prompt, /没有整行正好等于它/)
})

test('the ssh target cannot be read as an option', () => {
  assert.match(prompt, /ssh -- <target>/)
})

test('asks for the snapshot to be written in two steps, so no reader sees half a file', () => {
  assert.match(prompt, /\.tmp/)
  assert.match(prompt, /rename/)
})

test('states the rules the validator enforces', () => {
  assert.match(prompt, /schemaVersion/)
  // The stage enums, spelled as the validator spells them.
  assert.match(prompt, /proposed.*implementing.*validated.*archived/s)
  assert.match(prompt, /designed.*planned.*executing.*done/s)
  // The optional fields are omitted, never written as null.
  for (const field of ['error', 'summary', 'nextAction', 'notes']) {
    assert.ok(prompt.includes(field), field)
  }
  assert.match(prompt, /省略/)
})

test('points the agent at the file that holds the projects and the snapshot shape', () => {
  assert.match(prompt, /snapshotFormat/)
})

test('fits the prompt the host accepts', () => {
  // `agent.launch` refuses a longer prompt, and a refresh that cannot start collects nothing.
  assert.ok(prompt.length <= PROMPT_MAX_CHARS, `${prompt.length} > ${PROMPT_MAX_CHARS}`)
})

test('names all six progress counts, and says they have to be written', () => {
  for (const count of [
    'tasksDone',
    'tasksInProgress',
    'tasksTotal',
    'planDone',
    'planInProgress',
    'planTotal'
  ]) {
    assert.ok(prompt.includes(count), count)
  }
  assert.match(prompt, /done \+ inProgress <= total/)
})

test('asks for the CLI answer of every project, local and remote', () => {
  assert.match(prompt, /openspec --version/)
  assert.match(prompt, /openspecCli/)
  assert.match(prompt, /ssh -- <target> openspec --version/)
})

test('asks for plain slugs', () => {
  assert.ok(prompt.includes('/^[A-Za-z0-9][A-Za-z0-9._-]*$/'))
  assert.match(prompt, /changeId/)
  assert.match(prompt, /topic/)
})
