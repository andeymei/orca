// The instruction the refresh hands the agent.
//
// It states the task, not just the schema: an agent handed a schema and two file paths does not
// know it is being asked to scan a registry and write a snapshot. It also states the schema
// exactly as the validator enforces it — a mismatch shows the user a broken-snapshot card
// instead of a board — and asks for plain slugs, because a change id and a topic end up in a
// terminal command and in an agent prompt.

/** The rule every change id and every topic has to match. */
const SLUG_RULE = '/^[A-Za-z0-9][A-Za-z0-9._-]*$/'

/** The snapshot, as the validator wants it. */
const SCHEMA = `{
  "schemaVersion": 1,
  "generatedAt": "2026-11-25T10:00:00.000Z",
  "generatedBy": { "agent": "claude" },
  "projects": [
    {
      "id": "local|/Users/me/repo",
      "name": "repo",
      "host": "local",
      "path": "/Users/me/repo",
      "openspec": { "present": true, "capabilities": ["core"], "activeChanges": 1, "archived": 0 },
      "superpowers": { "present": true, "specs": 1, "plans": 1 },
      "openspecCli": { "available": true, "version": "1.8.0" },
      "scannedAt": "2026-11-25T10:00:00.000Z"
    }
  ],
  "items": [
    {
      "id": "local|/Users/me/repo#add-x",
      "projectId": "local|/Users/me/repo",
      "title": "新增 X",
      "topic": "add-x",
      "openspec": {
        "changeId": "add-x",
        "stage": "implementing",
        "hasProposal": true,
        "hasDesign": true,
        "hasTasks": true,
        "tasksDone": 1,
        "tasksInProgress": 0,
        "tasksTotal": 4,
        "capabilities": []
      },
      "superpowers": {
        "designSpec": "docs/superpowers/specs/add-x-design.md",
        "plan": "docs/superpowers/plans/add-x.md",
        "stage": "executing",
        "planDone": 1,
        "planInProgress": 0,
        "planTotal": 4
      }
    }
  ]
}`

/**
 * The prompt the refresh sends. It names the registry and the snapshot file, the artifacts to
 * look for, the rule for a remote project, and the schema with every rule the validator
 * enforces.
 */
export function buildRefreshPrompt(input: { registryPath: string; snapshotPath: string }): string {
  return `你的任务是扫描一批项目，把它们的 OpenSpec 与 Superpowers 产物写成一份快照，供看板读取。

## 第一步：读项目注册表

注册表在：
${input.registryPath}

它列出要扫描的项目，每项一个对象：

\`\`\`json
{ "name": "prism_orca", "host": "local", "path": "/Users/a1234/ctjt/code/prism_orca" }
\`\`\`

- \`name\`：项目的名字，随便起，看板上显示用。
- \`host\`：项目所在的主机。\`local\` 表示就在这台机器上；\`ssh:<target>\` 表示在一台 SSH 主机上，\`<target>\` 是它的名字。
- \`path\`：项目在那台主机上的绝对路径。

注册表是**远程项目的唯一来源**：本地扫描只看得到这台机器，一个你没有扫描的项目，看板上就不会出现。所以注册表里的每一项都要扫。

## 第二步：逐个项目扫描

每个项目要看的产物：

- OpenSpec：\`openspec/changes/\`（进行中的变更，每个变更一个目录）和 \`openspec/specs/\`（已归档的能力，每个能力一个目录）。
- Superpowers：\`docs/superpowers/specs/\`（设计 spec）和 \`docs/superpowers/plans/\`（实施计划），都是 \`.md\` 文件。

一个变更目录里有 \`proposal.md\`、\`design.md\`、\`tasks.md\`，以及 \`specs/<能力>/spec.md\`（增量 spec）。\`tasks.md\` 里的复选框就是进度：\`- [ ]\` 未完成，\`- [x]\` 已完成，\`- [-]\` 进行中。代码块里的复选框不算。

远程项目（\`host\` 是 \`ssh:<target>\`）要 **ssh 到那台主机上读**：\`ssh <target> 'cat <路径>'\`，或者 \`ssh <target> ls <路径>\`。不要猜路径，也不要把远程项目的路径当成本地路径读。

## 第三步：写快照

快照要写到：
${input.snapshotPath}

先写 \`${input.snapshotPath}.tmp\`，写完再 rename 成正式文件——这样读的人永远看不到写了一半的文件。

快照的格式（字段名一字不差，\`schemaVersion\` 必须是 1）：

\`\`\`json
${SCHEMA}
\`\`\`

校验器会按下面的规则检查，写之前先自己核对一遍：

- \`id\` / \`name\` / \`host\` / \`path\` / \`title\` / \`topic\` 必须是非空字符串。
- 项目 id 形如 \`<host>|<path>\`；工作项 id 形如 \`<项目 id>#<topic>\`，\`projectId\` 指向它所属的项目 id。
- 所有计数必须是非负整数。
- **六个进度计数必须逐个写出来**：\`tasksDone\`、\`tasksInProgress\`、\`tasksTotal\`、\`planDone\`、\`planInProgress\`、\`planTotal\`。进行中数量为 \`0\` 是合法的值，**不写这个字段不是**。
- 两边都要满足 \`done + inProgress <= total\`。
- \`openspec.stage\` 只能是 \`proposed\` / \`implementing\` / \`validated\` / \`archived\`；\`superpowers.stage\` 只能是 \`designed\` / \`planned\` / \`executing\` / \`done\`。
- \`openspec.capabilities\` 是这次变更改到的能力名（\`openspec/changes/<变更>/specs/\` 下的目录名）；项目级的 \`openspec.capabilities\` 是 \`openspec/specs/\` 下的目录名。
- \`superpowers.designSpec\` 与 \`superpowers.plan\` 是相对项目根目录的路径，没有就写 \`null\`。
- 可选字段——\`error\`、\`summary\`、\`nextAction\`、\`openspecCli.version\`、\`openspecCli.path\`、\`generatedBy.workspace\`、\`generatedBy.host\`、\`notes\`——**没有就整个省略，不要写成 \`null\`**。
- 某个项目读不了，就把错误写进那个项目的 \`error\`，其他项目照常写。

**每个 \`changeId\` 和每个 \`topic\` 都必须是纯 slug**，也就是要匹配：

\`\`\`
${SLUG_RULE}
\`\`\`

首字符必须是字母或数字，后面只能是字母、数字、点、短横和下划线。这些值会被拼进终端命令和 agent 提示词，一个不合规的变更 id 会让这个工作项一个命令都没有。写不出来就换一个名字，不要把不合规的值写进快照。

## 第四步：报告

最后用几句话说明你扫到了什么：扫了几个项目、哪些项目没扫到、哪些变更卡在了哪一步。`
}
