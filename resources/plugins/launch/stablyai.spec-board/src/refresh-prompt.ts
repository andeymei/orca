// The instruction the refresh hands the agent.
//
// It states the task, not just a schema: an agent handed a schema and two file paths does not know
// it is being asked to scan projects and write a snapshot. It also states the rules the validator
// enforces — a mismatch shows the user a broken-snapshot card instead of a board — and asks for
// plain slugs, because a change id and a topic end up in a terminal command and in an agent
// prompt.
//
// The projects and the snapshot's shape are in a file the agent reads, not in the prompt: the
// prompt has a hard limit of 4096 characters, and Orca knows projects this machine cannot see by
// itself — the ones on another host, above all.
//
// There are two prompts. The board's refresh scans every project and writes the board's snapshot;
// a refresh of one project scans that one project and writes a file of its own, which the plugin
// merges into the board's snapshot. The rules for reading a project and for writing the file are
// the same in both, so they are written once here.

import { remoteHostRules } from './remote-host'

/** The rule every change id and every topic has to match. */
const SLUG_RULE = '/^[A-Za-z0-9][A-Za-z0-9._-]*$/'

/**
 * The prompt has to fit: `agent.launch` refuses a prompt of more than 4096 characters, and a
 * refresh that cannot start collects nothing. The projects and the snapshot's shape are in the
 * file the agent reads; the prompt keeps the task and the rules.
 */
export const PROMPT_MAX_CHARS = 4096

/**
 * The room the prompt has to keep under the limit.
 *
 * The limit is a hard line and the prompt is measured on one path, while the real one is longer
 * on some machines: a prompt that sits on the line fits the test and breaks the refresh. The
 * headroom is the room that absorbs that difference — and it is smaller than the rule that would
 * fit into it, so a rule still goes into the file the agent reads.
 */
export const PROMPT_HEADROOM = 64

/** How one project is read, and what is read out of it. The same for every project. */
const SCAN_RULES = `每个项目要看的产物：

- OpenSpec：\`openspec/changes/\`（进行中的变更）和 \`openspec/specs/\`（已归档的能力）。
- Superpowers：\`docs/superpowers/specs/\`（设计 spec）和 \`docs/superpowers/plans/\`（实施计划），都是 \`.md\` 文件。

变更目录里有 \`proposal.md\`、\`design.md\`、\`tasks.md\` 和 \`specs/<能力>/spec.md\`。\`tasks.md\` 里的复选框就是进度：\`- [ ]\` 未完成，\`- [x]\` 已完成，\`- [-]\` 进行中。代码块里的复选框不算。

远程项目（\`host\` 不是 \`local\`）要 **ssh 到那台主机上读**。不要猜路径，也不要把远程项目的路径当成本地路径读。

**路径永远不要拼进命令。** 目录名和文件名是那台机器上的内容，可能是别人放的；拼进命令行就是把命令交给对方。

路径要先变成 base64 再传过去（base64 里没有 shell 语法）。路径含换行或特殊字符时，**先把它写进一个临时文件**——用你的文件工具写，文件内容就是路径本身，一个字节都不要改——再 \`base64 < 那个文件\` 编码；不要把路径放进任何命令行。没有文件工具时，用随机分隔符的 heredoc（\`<<'DELIM_…'\`，分隔符随机取，并确认路径里没有整行正好等于它）。

- POSIX 主机：读文件 \`ssh -- <名字> 'cat -- "$(printf %s "<B64>" | base64 --decode)"'\`；列目录把 \`cat\` 换成 \`ls -1A --\`。
- Windows 主机（PowerShell，没有 \`cat\`/\`head\`/\`find\`）：读文件 \`ssh -- <名字> powershell -NoProfile -Command "Get-Content -Raw -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<B64>')))"\`；列目录换成 \`Get-ChildItem -Name -LiteralPath (...)\`。

路径以盘符开头（\`D:/…\`）或用反斜杠分隔的，是 Windows 主机，用 PowerShell 那条。

\`<名字>\` 是上面换出来的 ssh 名字，用它的原样，不要改写它；\`ssh\` 后面那个 \`--\` 不能省（它让主机名不会被当成选项）。

连不上时，在本机的 \`~/.ssh/config\` 里找这台机器（按地址或别名），找到就用那个名字。连不上的项目，把原因写进它的 \`error\` 字段——**不要跳过它**，看板要看得见它没扫到。

每个项目还要写下它自己的 OpenSpec CLI：在**项目所在的那台机器上**运行 \`openspec --version\`，结果写进这个项目的 \`openspecCli\`——本地项目在本地跑，远程项目 ssh 到那台主机跑（\`ssh -- <名字> openspec --version\`）。有就写 \`{ "available": true, "version": "1.8.0" }\`，没有写 \`{ "available": false }\`。写漏了这一项，远程项目的命令就会悄悄变成交给 agent 的提示词。

**每扫完一个项目就写一次进度**：按第一步那个清单文件里 \`progress\` 说的路径和字段写。看板靠它显示进度条，不要攒到最后。`

/** How the file is written, and the rules the validator enforces. */
function snapshotRules(snapshotPath: string): string {
  return `快照要写到：
${snapshotPath}

先写同一个路径加上 \`.tmp\`，写完再 rename 成正式文件——这样读的人永远看不到写了一半的文件。

快照该有的样子在清单文件（第一步那个路径）的 \`snapshotFormat\` 字段里。

校验器会按下面的规则检查，写之前先自己核对一遍：

- \`schemaVersion\` 必须是 1。
- \`id\` / \`name\` / \`host\` / \`path\` / \`title\` / \`topic\` 必须是非空字符串。
- 项目 id 形如 \`<host>|<path>\`；工作项 id 形如 \`<项目 id>#<topic>\`，\`projectId\` 指向它所属的项目 id。
- 所有计数必须是非负整数。
- **六个进度计数必须逐个写出来**：\`tasksDone\`、\`tasksInProgress\`、\`tasksTotal\`、\`planDone\`、\`planInProgress\`、\`planTotal\`。进行中数量为 \`0\` 是合法的值，**不写这个字段不是**。
- 两边都要满足 \`done + inProgress <= total\`。
- \`openspec.stage\` 只能是 \`proposed\` / \`implementing\` / \`validated\` / \`archived\`；\`superpowers.stage\` 只能是 \`designed\` / \`planned\` / \`executing\` / \`done\`。
- \`openspec.capabilities\` 是这次变更改到的能力名（\`openspec/changes/<变更>/specs/\` 下的目录名）；项目级的 \`openspec.capabilities\` 是 \`openspec/specs/\` 下的目录名。
- \`superpowers.designSpec\` 与 \`superpowers.plan\` 是相对项目根目录的路径，没有就写 \`null\`。
- \`scannedAt\` 写这次扫描的时刻（ISO 8601）。
- 可选字段——\`error\`、\`summary\`、\`nextAction\`、\`openspecCli.version\`、\`openspecCli.path\`、\`generatedBy.workspace\`、\`generatedBy.host\`、\`notes\`——**没有就整个省略，不要写成 \`null\`**。
- 某个项目读不了，就把错误写进那个项目的 \`error\`，其他项目照常写。

**每个 \`changeId\` 和每个 \`topic\` 都必须是纯 slug**，也就是要匹配：

\`\`\`
${SLUG_RULE}
\`\`\`

首字符必须是字母或数字，后面只能是字母、数字、点、短横和下划线。这些值会被拼进终端命令和 agent 提示词，一个不合规的变更 id 会让这个工作项一个命令都没有。写不出来就换一个名字，不要把不合规的值写进快照。`
}

/**
 * The prompt the refresh sends. It names the projects to scan, the artifacts to look for, the rule
 * for a remote project, and the schema with every rule the validator enforces.
 *
 * The list is the whole of what there is to scan: the plugin filtered it, and a host it could not
 * name safely is not in it. The agent is therefore told to scan the list and nothing else — it is
 * not sent to the registry, whose projects are in the list already and whose host ids nobody
 * checked.
 */
export function buildRefreshPrompt(input: {
  scanListPath: string
  snapshotPath: string
}): string {
  return `你的任务是扫描一批项目，把它们的 OpenSpec 与 Superpowers 产物写成一份快照，供看板读取。

## 第一步：扫哪些项目

要扫的项目在这个文件里：
${input.scanListPath}

文件里每一项都要扫，每项一个对象：

\`\`\`json
{ "name": "prism_orca", "host": "local", "path": "/Users/me/code/prism_orca" }
\`\`\`

- \`name\`：项目的名字，看板上显示用。
- \`host\`：项目所在的主机。\`local\` 表示就在这台机器上；\`ssh:<id>\` 表示一台 SSH 主机；\`runtime:<id>\` 表示一台配对的 Orca 服务器。
- \`path\`：项目在那台主机上的绝对路径，**逐字照抄清单里的**（看板按字符串比对）。

**每一项都要扫**，包括别的机器上的。漏掉一项，看板上那个项目就是空的。

### 远程主机怎么连

${remoteHostRules()}

换出来的 ssh 名字，那台机器上所有项目都用它。

## 第二步：逐个项目扫描

${SCAN_RULES}

## 第三步：写快照

${snapshotRules(input.snapshotPath)}

## 第四步：报告

最后用几句话说明你扫到了什么：扫了几个项目、哪些项目没扫到、哪些变更卡在了哪一步。`
}

/**
 * The prompt a refresh of one project sends.
 *
 * It is the same task for one project: scan it, and write what you found. The file it writes is
 * the project's own, and the plugin merges that file into the board's snapshot — so the other
 * projects are not this agent's to touch.
 */
export function buildProjectRefreshPrompt(input: {
  scanListPath: string
  snapshotPath: string
}): string {
  return `你的任务是扫描一个项目，把它的 OpenSpec 与 Superpowers 产物写成一份快照，供看板读取。

## 第一步：扫哪一个项目

要扫的项目在这个文件里：
${input.scanListPath}

文件里只有一项，就是这一个项目：

\`\`\`json
{ "name": "prism_orca", "host": "local", "path": "/Users/me/code/prism_orca" }
\`\`\`

- \`name\`：项目的名字，看板上显示用。
- \`host\`：项目所在的主机。\`local\` 表示就在这台机器上；\`ssh:<id>\` 表示一台 SSH 主机；\`runtime:<id>\` 表示一台配对的 Orca 服务器。
- \`path\`：项目在那台主机上的绝对路径，**逐字照抄清单里的**（看板按字符串比对）。

**只扫这一个项目**，别的项目不在这次的范围里。

### 远程主机怎么连

${remoteHostRules()}

换出来的 ssh 名字，这个项目就在那台机器上，用它。

## 第二步：扫描这个项目

${SCAN_RULES}

## 第三步：写快照

${snapshotRules(input.snapshotPath)}

这个快照里**只写这一个项目**：\`projects\` 只有它一项，\`items\` 只有属于它的工作项。

## 第四步：报告

最后用几句话说明你扫到了什么：这个项目有什么、哪些变更卡在了哪一步。`
}
