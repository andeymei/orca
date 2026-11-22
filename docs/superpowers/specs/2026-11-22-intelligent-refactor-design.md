# 智能重构 — 设计稿

日期：2026-11-22
状态：待实现

## 1. 背景与目标

Orca 已有「Next Edit Suggestion」（NES，`docs/superpowers/specs/2026-11-17-next-edit-suggestion-design.md`）：
光标处的内联补全与下一处编辑预测。NES 的能力边界是**单文件、单点、行级编辑**——它的协议
（`NesEdit`）只允许一行一段的替换，因为内联 ghost text 画不出跨行的改动。

本设计补上另一条链路：**文件级、审阅后落地**的——用户对某个文件提出重构诉求，AI 给出带理由的
重构建议，应用把建议落成**临时重构文件**，用户**逐个文件 diff 对比**后，在**全方案 / 全文件 /
代码块**三个粒度上决定接受哪些改动。

目标：

1. 对当前文件发起重构，产生 1..N 条**带重构理由**的建议。
2. 每条建议可以横跨多个文件；每条建议落到**工作区内的临时重构文件**（`.orca/refactor/<jobId>/`），
   用户能在文件树里打开它、与原文件并排看。
3. 审查界面按「方案 → 文件 → 代码块」三级组织，逐级展示 diff 与理由。
4. 三级接受：**全方案**、**全文件**、**代码块**，任意组合都落到真实源码文件上。
5. 接受前校验原文未被改动，改过就拒绝写入并提示重新生成。

### 非目标

- **不做**自动重构（没有用户触发就不跑）。重构是分钟级、可能花钱的动作，必须显式发起。
- **不做**跨方案的依赖分析或编译验证。接受后代码能否编译不在本期保证范围内。
- **不做**重构历史、回滚、版本管理。暂存目录是一次性的，用完即弃。
- **不做**把重构理由导出成 PR 评论 / 评审意见。
- **不做**多模型选择。模型固定是 Claude Agent SDK 那条链路（见 §2）。

## 2. 关键决策

| 决策            | 选择                                                            | 理由                                                                                                           |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 产出形态        | **Agent 把重构后的文件写进暂存目录**，应用读回来算 diff         | 模型不产出行号、不产出 diff、也不产出"整份文件塞进 JSON"。行号是 NES 栽过两次的坑（模型数错行 → 编辑画错地方） |
| 清单形态        | **清单也写成文件**（`manifest.json`），不放在模型回答里         | SDK 的 `outputFormat: json_schema` 在 Orca 里没接线，且结构化输出有重试预算，整份文件塞 schema 会撞上          |
| 模型通道        | **Claude Agent SDK**（`openClaudeStreamJsonConnection`）        | `text-generation` 那条路是 `claude -p`，有 60s 硬超时 + 4MiB 输出上限 + 自然语言解析，三条都撞                 |
| 会话形态        | **不复用 `agentSession.*` 聊天链路**，做独立的 runner           | 重构是一次性任务不是对话。聊天链路是 journal 行 + 订阅边 + resume + 会话持久化，全是这里不需要的重量           |
| 工具策略        | `permissionMode:'default'` + 自建 `canUseTool` 闸门             | 不用仓库里的 full-access（`dangerously-skip-permissions`）——它能让 Claude 无提示写任何文件                     |
| 写入范围        | 只允许写 `.orca/refactor/<jobId>/`                              | Agent 碰不到源码；用户的文件在被接受之前一个字节都不会变                                                       |
| 基准文本        | **编辑器缓冲区**的内容（B），磁盘内容（D）单独用于陈旧检测      | 你眼前看到什么，diff 就对着什么；但 agent 必须被明确告知 B 才是目标文件的权威内容（§6.3）                      |
| diff 的唯一真相 | **应用自己算 hunk**（`diff` 包的 `diffLines`）                  | Monaco 自己的 hunk 分组和我们的可能不一致 → "点代码块 2、高亮的是块 3"。我们自己算，视图和接受逻辑共用一份数据 |
| 接受语义        | **用被接受的 hunk 重算整份文件内容，再整体写回**                | 不做 patch 应用。我们有完整原文和每段的起止行，重算比维护偏移量简单也更不容易错                                |
| 落地通道        | runtime RPC（`refactor.*`）                                     | 本地 / SSH / WSL 一条路。仓库规矩：凡涉及工作区的功能都必须能在远端主机上跑                                    |
| 任务进度        | `refactor.propose` 立刻返回 jobId，渲染层轮询 `refactor.status` | 结构化路径没有 turn 超时也没有进度订阅；轮询比新造一套订阅简单，且跨传输稳                                     |
| 轮询间隔        | 1.5s                                                            | 重构是分钟级任务，1.5s 的进度延迟换来的实现复杂度不值得                                                        |

### 已否决的方案

- **在模型回答里内联返回整份文件内容**：整份文件进 JSON 要过转义、token、输出上限三关；
  原文还得再传一遍。记忆里 `nes-the-answer-was-good-but-the-app-dropped-it` 记的就是这一类——
  模型给对了，应用在传输和解析环节把它弄丢了。
- **Agent 直接改真实文件，Orca 拿 git diff 展示**：直接摧毁"先审后用"。审的时候文件已经变了，
  "全文件 / 代码块接受"无从谈起；也无法给出多个互斥的候选方案。
- **`text-generation` 那条 `claude -p` 路径**：`SOURCE_CONTROL_GENERATION_TIMEOUT_MS = 60_000` 与
  `MAX_SOURCE_CONTROL_AGENT_OUTPUT_BYTES = 4MiB` 是硬墙，且工具被强制限制为 `Read,Grep,Glob`。
- **接 SDK 的 `outputFormat: json_schema`**：SDK 支持（v0.3.318 的 `JsonSchemaOutputFormat`，
  result 帧带 `structured_output`），但 `ClaudeStructuredSdkOptions` 里没有这个字段；
  且 SDK 的结构化输出有 `error_max_structured_output_retries` 预算，整份文件内容会撞上它。
  清单走文件，这条路以后要做"模型直接给结构化回答"时再接。
- **把暂存文件放系统临时目录**：用户选了工作区内 `.orca/refactor/<id>/`。放工作区外的代价是
  用户在文件树里看不到那些临时文件，"生成临时重构文件"这个诉求就落空了。
- **把 hunk 列表和 diff 视图都交给 Monaco**：见 §7.3。

## 3. 术语

| 术语        | 含义                                                        |
| ----------- | ----------------------------------------------------------- |
| 方案        | 一条完整的重构建议：有标题、有理由、可横跨多个文件          |
| 代码块      | 方案在某个文件里造成的一段连续改动（一个 hunk），可单独接受 |
| 暂存目录    | `.orca/refactor/<jobId>/`，一次重构任务的产物落地处         |
| 暂存文件    | 暂存目录下的一个文件，是某个方案对某个文件的重构后版本      |
| 清单        | `manifest.json`，agent 写出的方案索引                       |
| 任务（job） | 一次重构请求的运行实例，有 jobId，有状态                    |
| 基准文本    | 发起重构时编辑器缓冲区的内容（不是磁盘内容）                |

## 4. 端到端数据流

```
用户点「智能重构」（文件 F，缓冲区内容 B，磁盘内容 D）
  │
  ├─▶ refactor.propose { worktreeId, filePath, content: B, instruction? }
  │      立即返回 { jobId }
  │
  ▼ main (runtime)
  ┌──────────────────────────────────────────────────────────────┐
  │ ① 建 .orca/refactor/<jobId>/                                 │
  │    写 .orca/refactor/<jobId>/_source/<相对路径> = B           │
  │    （agent 拿到的目标文件权威内容就是 B，不是磁盘上的 D）       │
  │ ② 解析 Claude 可执行文件 / 账号 / 环境（复用 launch 解析）    │
  │ ③ openClaudeStreamJsonConnection(                             │
  │      cwd = 工作区根,                                           │
  │      options = { permissionMode:'default',                     │
  │                   disallowedTools:[Bash,Task],                  │
  │                   settingSources:[] },                        │
  │      canUseTool = 写闸门：Write/Edit 只放行暂存目录内 )        │
  │ ④ agent 读 _source 下的 F（以及它想看的其它文件）              │
  │    写 .orca/refactor/<jobId>/<proposalId>/<相对路径>            │
  │    写 .orca/refactor/<jobId>/manifest.json                      │
  └──────────────────────────────────────────────────────────────┘
  │
  ▼ 应用读文件
  ┌──────────────────────────────────────────────────────────────┐
  │ ⑤ 读 manifest → 校验（proposal 之间不共享文件）                 │
  │ ⑥ 读暂存文件 + 读原文 → 算 hunk                               │
  │ ⑦ 组装 RefactorPlan                                            │
  └──────────────────────────────────────────────────────────────┘
  │
  ├─▶ refactor.status  （渲染层 1.5s 轮询，拿进度文案）
  ├─▶ refactor.plan    （完成后拿完整 RefactorPlan）
  │
  ▼ renderer
  ┌──────────────────────────────────────────────────────────────┐
  │ 开「重构审查」tab                                              │
  │ 左：方案树（方案 → 文件 → 代码块）                             │
  │ 右：选中代码块的 diff（DiffViewer）+ 接受按钮                  │
  └──────────────────────────────────────────────────────────────┘
  │
  └─▶ refactor.apply { jobId, acceptedHunkIds[] }
         → 用被接受的 hunk 重算文件内容 → 写回真实路径（带前置条件）
```

## 5. 数据契约

全部放在 `src/shared/refactor/`，用 zod 定义（`src/shared/refactor/refactor-types.ts`）。

```ts
/** 一次重构任务的完整产物 */
export const RefactorPlan = z.object({
  jobId: z.string(),
  /** 发起重构时的源文件（相对工作区路径）。 */
  sourcePath: z.string(),
  proposals: z.array(RefactorProposal)
})

export const RefactorProposal = z.object({
  id: z.string(),
  /** 一句话标题，方案树里显示。 */
  title: z.string(),
  /** 重构理由。 */
  rationale: z.string(),
  files: z.array(RefactorFileProposal)
})

export const RefactorFileProposal = z.object({
  /** 相对工作区路径。 */
  path: z.string(),
  /** 基准文本（发起时的编辑器缓冲区内容）。 */
  originalContent: z.string(),
  hunks: z.array(RefactorHunk)
})

export const RefactorHunk = z.object({
  id: z.string(),
  /** 被替换区间在原文中的起始行（1-based）与行数；插入点的 originalLineCount 为 0。 */
  originalStartLine: z.number().int().positive(),
  originalLineCount: z.number().int().nonnegative(),
  /** 替换文本在重构后文件中的起始行与行数。 */
  modifiedStartLine: z.number().int().positive(),
  modifiedLineCount: z.number().int().nonnegative(),
  /** 被替换掉的原文（精确匹配原文的那一段）。 */
  originalText: z.string(),
  /** 替换成的新文本。 */
  modifiedText: z.string()
})
```

### 5.1 agent 写出的清单

`manifest.json` 的形状（应用侧同样用 zod 校验）：

```jsonc
{
  "proposals": [
    {
      "id": "p1",
      "title": "提取重复的参数校验",
      "rationale": "两处分支各自校验 userId，规则相同但写法不同；抽成 assertUser 后规则只有一处。",
      "files": ["src/api/user.ts", "src/api/order.ts"]
    }
  ]
}
```

`files` 里是**相对工作区的路径**，对应暂存目录下的同名相对路径。

## 6. Agent 运行层

### 6.1 启动

复用 `src/main/claude/structured/launch/claude-structured-launch-resolution.ts` 的
`claudeStructuredLaunchPart` 解析出可执行文件路径、账号环境与 env，然后覆盖三处：

- `cwd` = 工作区根目录（agent 要能读工作区里的其它文件）。
- `options.permissionMode = 'default'`（不设 `dangerously-skip-permissions`）。
- **不给 `options.allowedTools`**。SDK 对 `allowedTools` 的定义是"自动放行、不再询问"，
  而 `canUseTool` 是"每次工具执行前调用"——把 `Write`/`Edit` 列进 `allowedTools`，
  CLI 可能就绕过写闸门直接放行写操作，agent 就能改用户的真实源码。
  闸门必须是唯一裁决者，所以一个工具都不许被预先自动放行。
- `options.disallowedTools = ['Bash','Task']`（脱离路径模型的两个逃逸口，从模型上下文里去掉）。
- `options.settingSources = []`（SDK 隔离模式，不加载用户/项目/本地的 Claude 设置；
  否则用户自己写的 `permissions.allow: ["Write"]` 同样会被自动放行）。

`allowedTools` / `disallowedTools` 目前不在 `ClaudeStructuredSdkOptions` 里，需要加进这个 Pick
类型。SDK 支持这两个字段，且 `claude-structured-launch-args.ts` 的 `OWNED_FLAGS` 已经把它们挡在
用户自定义参数之外——这块策略所有权本来就是我们的，只是还没接线。

### 6.2 写闸门

`handlers.canUseTool` 回调逐个工具调用裁决：

- `Read` / `Grep` / `Glob`：放行（限制在工作区内）。
- `Write` / `Edit` / `MultiEdit`：**目标路径必须落在 `.orca/refactor/<jobId>/` 之内**，否则拒绝。
  `MultiEdit` 必须放行——它是 Claude Code 真实存在的编辑工具，拒掉它等于堵死一条正当的编辑路径。
- 其它工具：拒绝（`Bash`、`Task`、MCP 工具都不给）。

路径裁决必须做**规范化后再比较**（resolve 相对路径、消除 `..`），不能只做字符串前缀匹配。
另外要逐段拒绝**末尾带点或空格**的分量：Win32 在识别 `.` / `..` 之前先剥掉它们，
`.. ` 对操作系统就是"上一级目录"，而 Node 的 `path.win32.resolve` 不剥。

### 6.3 prompt

给 agent 的指令分三部分：

1. **任务**：针对哪个文件、什么样的重构（用户可以在 UI 上补一句自然语言指令）。
2. **硬约束**：只读工作区、只写暂存目录、每个方案一个子目录、必须写 `manifest.json`。
   其中必须写明：**目标文件 `<相对路径>` 的当前内容以 `_source/<相对路径>` 为准**——
   用户可能有未保存的修改，那个副本才是权威内容；磁盘上的版本可能过期。
3. **产出契约**：最多 5 个方案、每个方案最多 5 个文件；`rationale` 要说清"为什么这么改"
   而不是"改了什么"；方案之间不能改同一个文件。

prompt 里明确要求：**不要在回答里贴文件内容或 JSON**，一切通过写文件产出。

### 6.4 进度

SDK 的每条消息都带 `tool_use` 块。运行器把工具名翻成一句进度文案
（"正在读取 src/foo.ts"、"正在写入 src/bar.ts"），供 `refactor.status` 返回。
不解析模型的自然语言输出——进度是给人看的，不是契约。

### 6.5 任务的结束与丢弃

结构化路径本身没有 turn 超时，重构任务自己加：

- 硬上限 **5 分钟**，超时即中止并把 job 标记为失败。
- `refactor.discard` 中止进行中的 turn，并关闭子进程（走 `openClaudeStreamJsonConnection` 的
  `close()`，那套关闭证明 ladder 是现成的）。对已结束的任务，它删除暂存目录并把 job 从注册表里摘掉。
- 任务结束后暂存目录**保留**（用户还要看 diff），但下次发起新任务时清理超过一天的旧目录。

## 7. 差异计算

### 7.1 hunk 的算法

纯函数，`src/shared/refactor/refactor-hunk-computation.ts`：

1. `diffLines(original, modified)` 拿到变更序列。
2. 把**相邻的变更段合并成一个变更组**（removed 后面紧跟 added 是一个组，不是两个）。
3. 每个变更组产出一个 hunk：
   - `originalStartLine` = 组开始时原文的下一个行号
   - `originalLineCount` = 组里 removed 段覆盖的原文行数（纯插入为 0）
   - `modifiedStartLine` = 组开始时重构后文件的下一个行号
   - `modifiedLineCount` = 组里 added 段覆盖的行数（纯删除为 0）
   - `originalText` = 组里 removed 段的原文拼接
   - `modifiedText` = 组里 added 段的新文本拼接

相邻的 removed/added 合并成组，是为了让"删一段旧代码 + 加一段新代码"成为**一个**代码块——
它们本来就是一个改动，拆成两个会让"接受其一"产出坏代码。

### 7.2 应用 hunk

纯函数，`src/shared/refactor/refactor-hunk-application.ts`：

按 `originalStartLine` **降序**依次替换原文区间（先改后面的，前面行的偏移才不受影响）。
hunk 之间不重叠（`diffLines` 保证），降序应用后每个 hunk 的行号仍然有效。

### 7.3 为什么不用 Monaco 自己的 hunk

如果 hunk 列表来自 `diffEditor.getLineChanges()`，而 diff 视图由 Monaco 渲染，两边的分组可能不一致
（Monaco 按上下文距离把变更合并成一个大 hunk，我们按"变更是否连续"分组）——就会出现"点代码块 2、
高亮的是块 3"。**自己算 hunk，视图和接受逻辑共用同一份数据**，这类错位从根上不存在。

代价：hunk 视图里 Monaco 的行号是 hunk 内的相对行号（1..N），不是文件的绝对行号。
绝对行号显示在代码块的标题上（"第 42-58 行"）。这是代码评审的惯例（片段 + 位置标注）。

## 8. 三级接受

| 级别       | 用户动作      | 结果                                         |
| ---------- | ------------- | -------------------------------------------- |
| **全方案** | 勾选一个方案  | 该方案所有文件的所有 hunk 应用，写回这些文件 |
| **全文件** | 勾选一个文件  | 该文件的所有 hunk 应用，写回该文件           |
| **代码块** | 勾选一个 hunk | 只有该 hunk 应用，重算该文件后写回           |

接受集合是"方案 / 文件 / hunk"三层树上的一个**勾选集合**，最终展开成 hunk id 集合。

### 8.1 部分接受的警告

一个方案的多个 hunk 之间可能互相依赖（抽方法要同时改定义处和调用处）。
只接受一部分可能产出不能编译的代码。

规则：**若被接受的 hunk 是某个方案的真子集**，在界面上提示——"这个改动由 N 处修改共同组成，
只接受其中一处可能无法编译"，并给一个「接受该方案全部改动」的按钮。

### 8.2 陈旧检测

发起重构时，每个文件有两个快照：

- **B**：编辑器缓冲区的内容（diff 的基准，agent 的输入）。
- **D**：磁盘上的内容。

接受时重新读磁盘，得到当前内容 `C`：

- `C === D` → 没人动过，正常写入。
- `C === B` → 用户在评审期间把缓冲区存盘了，正常写入。
- 其它 → **拒绝写入**，提示"文件在评审期间被改动过，请重新生成重构建议"。

写入的内容 `N` 是由 `B` + 被接受的 hunk 重算出来的。所以当 `C === D`（缓冲区还有未保存修改）时，
写盘会**一并把那些未保存的修改保存进去**。这不是副作用而是语义的一部分——重构是基于用户眼前的内容
做的，落盘结果理应包含那些内容。界面上要写明这一点。

写入本身还要带磁盘前置条件（`files.writeIfUnchanged` 语义），防止比对和写入之间又被改一次。

### 8.3 多个方案改同一个文件

方案之间**不共享文件**：一个方案可以改多个文件，但两个方案不能改同一个文件。
清单里出现冲突时，后一个方案被丢弃并在 job 的警告里记一笔。
这条约束保证了"接受任意 hunk 子集"永远是无歧义的。

## 9. 审查界面

### 9.1 位置

编辑器区新开一个 **虚拟 tab**（`mode: 'refactor-review'`），和 `git-graph`、`check-details` 是同类
——不是文件，是一个 view。`OpenFile` / `EditorTabView` / `EditorTabContentType` 各加一个成员，
`isVirtualEditorFile` 把它算进去。

tab 上只存 `jobId` 和 `worktreeId`，其余状态按 jobId 拉。

### 9.2 布局

```
┌────────────────────────────────────────────────────────────────┐
│ ⟳ 智能重构 · src/foo.ts          [接受全部方案] [丢弃]  ⟳ 生成中 │
├──────────────────┬─────────────────────────────────────────────┤
│ 方案 (2)          │  src/foo.ts · 方案「提取参数校验」            │
│                  │  理由: 两处校验逻辑重复…                       │
│ ▾ 提取参数校验    │  ┌─────────────────────────────────────────┐ │
│   ▾ foo.ts       │  │ [✓ 接受] 第 42-58 行                    │ │
│     ▸ 代码块 1   │  │  原文            │ 重构后                │ │
│     ▸ 代码块 2   │  │  ────────────────┼─────────────────────  │ │
│   ▸ bar.ts       │  │  if (!u.id)      │ assertUser(u)        │ │
│ ▸ 简化嵌套条件    │  └─────────────────────────────────────────┘ │
│   ▾ baz.ts       │  ┌─────────────────────────────────────────┐ │
│     ▸ 代码块 1   │  │ [ ] 接受 第 90 行                       │ │
└──────────────────┴─────────────────────────────────────────────┘
```

- 左树：方案 → 文件 → 代码块，每级都有勾选框（全选 / 全不选）。
- 右区：选中代码块的 diff。一个代码块 = 一个 `DiffViewer`，`originalContent` 是原文片段，
  `modifiedContent` 是新文片段。
- 「查看完整文件」切换：显示整个文件的 `DiffViewer`（用完整的原文和重构后全文）。
- 顶部「接受全部方案」= 勾选所有 hunk 后应用；「丢弃」= `refactor.discard`（中止运行中的任务，
  或删掉已结束任务的暂存目录并关掉这个 tab）。

### 9.3 复用的既有设施

- `src/renderer/src/components/editor/diff/monaco-view/DiffViewer.tsx` —— 吃两个纯字符串，
  和 git 无关；`originalContent` / `modifiedContent` 正好对上。
- `src/renderer/src/components/editor/diff/monaco-view/diff-editor-*-options.ts` —— 选项构造器。
- `src/shared/editor-language/editor-language-detect` 的 `detectLanguage` —— 按路径判语言。

**不复用** `diff/sections/DiffSectionItem.tsx`：它和 git source-control 深度耦合
（`section.area === 'unstaged'`、虚拟化行高、diff comments、save 快捷键），改造它比重写还贵。

## 10. RPC 契约

5 个方法，都注册在 `src/main/runtime/rpc/methods/refactor/refactor-methods.ts`，
`permission: 'workspace'`。

| 方法               | 入参                                              | 出参                                    |
| ------------------ | ------------------------------------------------- | --------------------------------------- |
| `refactor.propose` | `{ worktreeId, filePath, content, instruction? }` | `{ jobId }`                             |
| `refactor.status`  | `{ jobId }`                                       | `{ state, progress, warnings[] }`       |
| `refactor.plan`    | `{ jobId }`                                       | `{ plan } \| null`                      |
| `refactor.apply`   | `{ jobId, acceptedHunkIds[] }`                    | `{ applied: [{ path, hunksApplied }] }` |
| `refactor.discard` | `{ jobId }`                                       | `{ discarded: boolean }`                |

`state` 取值：`running` | `done` | `failed` | `cancelled`。

参数与结果类型放在 `src/shared/rpc-contract/refactor-params.ts`，并按仓库规矩跑
`pnpm generate:rpc-params-catalog` 更新生成目录。

### 10.1 触发入口

- 编辑器文件头（`src/renderer/src/components/editor/EditorPanelHeader.tsx`）上的「智能重构」按钮。
- 命令面板里的同名命令。

两者都作用于当前激活的文件。发起时的缓冲区内容从
`src/renderer/src/components/editor/editor-panel-draft-selector.ts` 的
`createEditorPanelDraftSelector` 取（`EditorPanel.tsx` 已经在用同一个选择器）。

## 11. 改动清单

### 11.1 shared

| 文件                                               | 作用                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| `src/shared/refactor/refactor-types.ts`            | zod 契约：RefactorPlan / Proposal / FileProposal / Hunk |
| `src/shared/refactor/refactor-hunk-computation.ts` | 由原文 + 新文算出 hunk 列表（纯函数）                   |
| `src/shared/refactor/refactor-hunk-application.ts` | 由原文 + 被接受的 hunk 算出新内容（纯函数）             |
| `src/shared/refactor/refactor-manifest.ts`         | agent 写出的清单的 zod 契约                             |
| `src/shared/refactor/refactor-prompt.ts`           | agent 的 system / user prompt                           |
| `src/shared/rpc-contract/refactor-params.ts`       | RPC 参数与结果契约                                      |

### 11.2 main

| 文件                                                                       | 作用                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/main/refactor/refactor-job-registry.ts`                               | job 状态、取消句柄、警告                                                                            |
| `src/main/refactor/refactor-agent-launch.ts`                               | 解析 Claude 可执行文件 / 账号 / env，拼 SDK 启动参数                                                |
| `src/main/refactor/refactor-write-gate.ts`                                 | `canUseTool` 写闸门                                                                                 |
| `src/main/refactor/refactor-runner.ts`                                     | 驱动一次 agent turn，超时与取消                                                                     |
| `src/main/refactor/refactor-plan-builder.ts`                               | 读清单 + 读暂存文件 + 读基准文本 → 组装 RefactorPlan                                                |
| `src/main/refactor/refactor-scratch-cleanup.ts`                            | 清理过期暂存目录                                                                                    |
| `src/main/runtime/rpc/methods/refactor/refactor-methods.ts`                | 5 个 RPC 方法                                                                                       |
| `src/main/claude/structured/launch/claude-structured-launch-resolution.ts` | `ClaudeStructuredSdkOptions` 加 `allowedTools` / `disallowedTools`（`settingSources` 已在 Pick 里） |

### 11.3 renderer

| 文件                                                                     | 作用                                  |
| ------------------------------------------------------------------------ | ------------------------------------- |
| `src/renderer/src/components/editor/refactor/refactor-review-tab.tsx`    | 审查 tab 的内容                       |
| `src/renderer/src/components/editor/refactor/refactor-proposal-tree.tsx` | 左树（方案 → 文件 → 代码块）          |
| `src/renderer/src/components/editor/refactor/refactor-hunk-view.tsx`     | 一个代码块的 diff + 接受按钮          |
| `src/renderer/src/components/editor/refactor/refactor-review-store.ts`   | 模块级 store（对齐 `nes-plan-store`） |
| `src/renderer/src/components/editor/refactor/refactor-runtime-client.ts` | renderer → runtime 的 5 个调用        |
| `src/renderer/src/components/editor/refactor/refactor-job-poller.ts`     | 轮询 job 状态                         |
| `src/renderer/src/store/slices/editor/types/open-file.ts`                | `mode` 加 `'refactor-review'`         |
| `src/shared/editor-tab-view-types.ts`                                    | `EditorTabView` 加该 mode             |
| `src/renderer/src/store/slices/editor/tabs/editor-tab-content-type.ts`   | `EditorTabContentType` 加该成员       |
| `src/renderer/src/components/editor/EditorPanelHeader.tsx`               | 「智能重构」按钮                      |

### 11.4 preload

无。走 runtime RPC，渲染层用 `window.api.runtime.call`（与 NES 同一条路）。

## 12. 测试策略

按仓库规矩（`docs/agents-md-refs/test-antipatterns.md`）：测试必须**在改动被回退时会失败**，
且**坐在拥有该行为的那一层**。

| 层            | 测什么                                                      | 位置                                                    |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| shared 纯函数 | hunk 计算、hunk 应用、清单校验、方案冲突丢弃                | `src/shared/refactor/*.test.ts`                         |
| main          | 写闸门的路径裁决（`..`、绝对路径、符号链接、大小写）        | `src/main/refactor/refactor-write-gate.test.ts`         |
| main          | plan builder：清单缺字段、暂存文件不存在、方案共享文件      | `src/main/refactor/refactor-plan-builder.test.ts`       |
| renderer      | 审查树的勾选集合展开（方案/文件/代码块三级 → hunk id 集合） | `src/renderer/src/components/editor/refactor/*.test.ts` |
| 组件          | 审查 tab 的 fixture 截图（`pnpm fixtures:shot`）            | `refactor-review-tab.fixture.tsx`                       |

**不测**：模型返回什么、agent 实际写了什么、端到端的重构质量。这些是模型能力，不是代码行为。

## 13. 已知限制与风险

### 风险

- **agent 不遵守产出契约**：它可能不写 `manifest.json`、可能把文件写到别的目录、可能改了工作区里的
  真实文件。写闸门是第一道防线（越界的写直接被拒）；清单缺失时按目录结构兜底还原方案列表，
  并在界面上标记"agent 未给出理由"。
- **agent 改了真实文件**：写闸门只拦 Write/Edit 工具。agent 若用 `Bash` 里的 `mv`/`cp` 就能绕过——
  所以 `Bash` 根本不给。
- **暂存目录污染仓库**：`.orca/refactor/` 需要进 `.gitignore`。应用在发起任务时检查工作区是不是
  git 仓库，是的话把 `.orca/refactor/` 追加到 `.git/info/exclude`（本地生效，不动被跟踪的
  `.gitignore`）。非 git 的 folder workspace 没有这一步，暂存目录就在那里。
- **接受后代码不能编译**：见 §8.1 的警告。本期不做编译验证。

### 限制

- 一次任务最多 5 分钟、方案数与文件数有上限。
- 只接受单个文件的"内容"，不处理文件的新增与删除（方案不能新建或删除文件）。
- 不处理跨文件的重命名。
- 远端主机（SSH / WSL）上，暂存目录和 agent 都跑在远端——这符合仓库的远端优先规矩，
  但意味着远端上必须有可用的 Claude 安装与登录态。
- **重构 agent 不加载项目的 CLAUDE.md 与用户设置**。为了保证写闸门是写操作的唯一裁决者，
  这次运行用 SDK 的隔离模式（`settingSources: []`）：不加载 `user` / `project` / `local`
  三层设置文件。代价是 agent 看不到项目自己的约定，重构质量会打折扣；
  收益是用户的 `permissions.allow` 规则无法把写操作自动放行、绕过闸门。
  （SDK 文档：`Pass [] to disable filesystem settings (SDK isolation mode)`，
  `Must include 'project' to load CLAUDE.md files`。）
  将来要让 agent 读到项目约定，正确做法是由应用自己读 CLAUDE.md 并放进 prompt，
  而不是把设置文件加载回来。

## 14. 参考

- `docs/superpowers/specs/2026-11-17-next-edit-suggestion-design.md` —— 同源的编辑建议链路，
  以及"模型不数行号"这条教训的来源。
- `src/main/claude/claude-stream-json-connection.ts` —— SDK 的实际调用点。
- `src/main/claude/structured/launch/claude-structured-launch-resolution.ts` —— SDK 选项与权限模式。
- `src/main/claude/structured/claude-full-access-policy.ts` —— full-access 的语义（本设计不用它）。
- `src/renderer/src/components/editor/diff/monaco-view/DiffViewer.tsx` —— 审查界面用的 diff 组件。
