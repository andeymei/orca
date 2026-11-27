// The prompt the refresh hands the agent. It has to state the task and the schema exactly as the
// validator enforces it: a mismatch shows the user a broken-snapshot card instead of a board.
import { assert, test } from 'orca/testing'
import {
  PROMPT_HEADROOM,
  PROMPT_MAX_CHARS,
  buildProjectRefreshPrompt,
  buildRefreshPrompt
} from './refresh-prompt'
import { VERIFICATION_COUNT_RULE } from './snapshot-format'
import { projectFileKey } from './store-paths'

const prompt = buildRefreshPrompt({
  scanListPath: '/home/me/.orca/spec-board/scan-list.json',
  snapshotPath: '/home/me/.orca/spec-board/board.json'
})

const projectPrompt = buildProjectRefreshPrompt({
  scanListPath: '/home/me/.orca/spec-board/scan-list-ab12cd34.json',
  snapshotPath: '/home/me/.orca/spec-board/project-ab12cd34.json'
})

/**
 * The home a temp directory makes, as the isolated profiles and the packaged app's own check make
 * one: long, and the file names in it carry the sixteen hex characters a project id hashes to.
 *
 * It is spelled out rather than taken from this machine's temp directory, so that the margin it
 * measures is the same everywhere the suite runs.
 */
const realHome = '/var/folders/db/vtj54kp928z7sqphxz7_t9bm0000gn/T/spec-board-home-BMNsqV'

/**
 * The prompt fits the host, and keeps the room the headroom asks for.
 *
 * The limit is a hard line the host refuses to cross, and the prompt is measured on one path
 * while the real one is longer on some machines: a prompt that sits on the line passes the test
 * and breaks the refresh. The headroom is the room that absorbs that difference.
 */
function assertFits(text: string): void {
  assert.ok(text.length <= PROMPT_MAX_CHARS, `${text.length} > ${PROMPT_MAX_CHARS}`)
  const margin = PROMPT_MAX_CHARS - text.length
  assert.ok(margin >= PROMPT_HEADROOM, `margin ${margin} < ${PROMPT_HEADROOM}`)
}

test('names the scan list and the snapshot file', () => {
  assert.ok(prompt.includes('/home/me/.orca/spec-board/scan-list.json'))
  assert.ok(prompt.includes('/home/me/.orca/spec-board/board.json'))
})

test('sends the agent to the list and nowhere else', () => {
  // The list is what the plugin filtered: a host it could not name safely is not in it, and the
  // registry holds ids nobody checked. The agent that reads the registry would ssh them.
  assert.equal(prompt.includes('注册表'), false)
  assert.equal(projectPrompt.includes('注册表'), false)
})

test('says every project of the list has to be scanned, the remote ones included', () => {
  assert.match(prompt, /每一项都要扫/)
  assert.match(prompt, /别的机器/)
  // The host is what tells a project on another machine from one on this one.
  assert.match(prompt, /ssh:<id>/)
  assert.match(prompt, /runtime:<id>/)
})

test('tells the agent how to turn a host id into an ssh name', () => {
  // A host id is Orca's own name for a machine, not something ssh accepts: the agent has to
  // ask Orca what the machine is called, or it never reaches the remote project at all.
  assert.match(prompt, /主机 id 不是 ssh 名字/)
  assert.match(prompt, /orca host list --json/)
  assert.match(prompt, /orca environment show --environment <id> --json/)
  assert.match(prompt, /environment\.orcadDeployment\.sshTargetId/)
})

test('states the task: scan the projects, write the snapshot', () => {
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
  assert.match(prompt, /ssh -- <名字>/)
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

test('says the path is copied from the list as it stands, because the board compares it', () => {
  // The board compares the path and the id as strings, so a path spelled a little differently is
  // a different place — and the snapshot of that project is not taken.
  for (const text of [prompt, projectPrompt]) {
    assert.match(text, /逐字照抄清单里的/)
    assert.match(text, /项目 id 形如 `<host>\|<path>`/)
  }
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
  assert.match(prompt, /ssh -- <名字> openspec --version/)
})

test('asks for plain slugs', () => {
  assert.ok(prompt.includes('/^[A-Za-z0-9][A-Za-z0-9._-]*$/'))
  assert.match(prompt, /changeId/)
  assert.match(prompt, /topic/)
})

test('asks the agent to report the progress after every project', () => {
  // The panel's bar is drawn from what the agent reports. A prompt that never asks for it leaves
  // the board with a bar that never moves.
  assert.match(prompt, /每扫完一个项目/)
  assert.match(prompt, /进度/)
  // The shape of the progress file travels in the list the agent reads, not in the prompt.
  assert.match(prompt, /`progress`/)
})

test('the prompt of one project says it is one project', () => {
  assert.match(projectPrompt, /只扫这一个项目/)
  assert.match(projectPrompt, /只写这一个项目/)
  // The board's snapshot is the plugin's to write: the agent writes the project's own file, and
  // the plugin merges that file in.
  assert.equal(projectPrompt.includes('/home/me/.orca/spec-board/board.json'), false)
  assert.ok(projectPrompt.includes('/home/me/.orca/spec-board/project-ab12cd34.json'))
})

test('the prompt of one project keeps the rules that keep a path out of a command', () => {
  assert.match(projectPrompt, /路径永远不要拼进命令/)
  assert.match(projectPrompt, /base64/)
  assert.match(projectPrompt, /ssh -- <名字>/)
  assert.match(projectPrompt, /每扫完一个项目/)
  assert.match(projectPrompt, /snapshotFormat/)
})

test('the prompt of one project fits the host too', () => {
  assert.ok(projectPrompt.length <= PROMPT_MAX_CHARS, `${projectPrompt.length} > ${PROMPT_MAX_CHARS}`)
})

test('the prompt of one project names the list it was given', () => {
  // The progress rules travel in the list the agent reads: a prompt that names another list
  // sends the agent to a file that is not there, or to the whole board's list.
  assert.ok(projectPrompt.includes('/home/me/.orca/spec-board/scan-list-ab12cd34.json'))
  assert.equal(projectPrompt.includes('scan-list.json'), false)
})

test('the prompt of the whole board fits the host on a real path', () => {
  // The example above is shorter than the truth: a real home is longer, and a prompt that fits
  // the example may not fit the machine.
  const real = buildRefreshPrompt({
    scanListPath: `${realHome}/scan-list.json`,
    snapshotPath: `${realHome}/board.json`
  })
  assertFits(real)
})

test('the prompt of one project fits the host on a real path', () => {
  // The file names of a project carry the sixteen hex characters its id hashes to: eight of them
  // are sixteen characters shorter than the truth, and sixteen characters is the whole margin
  // there is.
  const key = projectFileKey('ssh:yolo|C:/work/app')
  const real = buildProjectRefreshPrompt({
    scanListPath: `${realHome}/scan-list-${key}.json`,
    snapshotPath: `${realHome}/project-${key}.json`
  })
  assertFits(real)
})

test('the rule that counts the verification records is not in the prompt', () => {
  // It travels in the list file the agent reads: on a real path the prompt is a few dozen
  // characters short of the limit, and the rule is over that. A prompt over the limit is refused
  // by the host, and the refresh never starts.
  for (const text of [prompt, projectPrompt]) {
    assert.equal(text.includes(VERIFICATION_COUNT_RULE), false)
  }
})
