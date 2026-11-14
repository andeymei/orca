# 注释驱动的智能体代码生成 — 设计稿

日期：2026-11-14
状态：待实现

## 1. 背景与目标

Orca 已有完整的「评论 → 智能体」链路，但它长在 **diff 审查**上：`addDiffComment` → 落盘到工作区 notes →
`formatDiffComments` 拼 prompt → `NotesSendMenu` → `ReviewNotesSendMenuContent` 选智能体 →
`sendMessageToAgent`。

源码编辑器里没有这条路。本设计在**源码编辑器**中补上一条：以源码内的标记注释作为规格，
把注释交给智能体生成代码，并让 Orca 记录每条注释的派发/完成状态，避免重复生成。

### 目标

1. 用户在源码里写 `// @ai <指令>`，Orca 识别它并在行号槽给出可发送的入口。
2. 支持逐条发送，也支持把一个文件里的多条指令合并成一份规格一次性发出。
3. Orca 侧持久化每条指令的状态（待派发 / 已派发 / 已完成），批量时默认跳过已完成的。
4. 派发链路复用现有机制，不另建智能体启动通道。

### 非目标

- 不做「保存文件即自动派发」。
- 不做跨文件批量。
- 不识别自然语言 TODO，只有 `@ai` 前缀算指令。
- 不做插入指令片段的快捷键。
- 不支持非 Monaco 编辑器（富文本 markdown、插件自定义编辑器）。
- 不支持 `// @ai` 空指令（没有正文就没有可执行的内容）。

## 2. 关键决策

| 决策     | 选择                   | 理由                                                                              |
| -------- | ---------------------- | --------------------------------------------------------------------------------- |
| 指令载体 | 源码内的标记注释       | 规格跟着代码走，用户直接写在最懂的位置                                            |
| 标记语法 | `@ai`                  | 显式、无歧义、批量模式能圈定范围；设置项后续再扩展                                |
| 识别方式 | Monaco 分词器          | 语言无关，自动支持 `//` `#` `/* */` `<!-- -->` `--` `%`；正则会误伤字符串         |
| 状态存储 | 复用工作区 notes 列表  | 工作区级状态的难点在「哪一份副本」（孪生/写队列/回滚/远程同步），复用可零新增管道 |
| 触发方式 | 逐条手动 + 批量手动    | 不做自动派发，避免误触发                                                          |
| 批量组织 | 合成一个 prompt        | 智能体一次性改完整个文件，上下文共享                                              |
| 生命周期 | 注释保留 + Orca 记状态 | 注释即规格说明；状态在 Orca 侧，避免重复生成                                      |

### 已否决的方案

- **独立字段 `WorktreeMeta.aiInstructions` + 独立 store slice**：模型更干净，但要泛化或重写
  `diff-comment-persistence.ts` 里那套最脆弱的队列/回滚逻辑，或并行造一份（AGENTS.md 明令禁止并行版本）。
- **MVP 不持久化**：重启后「已完成」丢失，批量会重发全部指令，与「Orca 记状态」冲突。
- **智能体删掉注释 / Orca 自动降级标记**：用户选择保留注释、由 Orca 记状态。

## 3. 指令识别

### 3.1 标记

默认 `@ai`。MVP 只落这一个默认值，不做设置项 UI；标记名集中在一个常量里，后续加设置项时改这一处。

### 3.2 识别规则

用 Monaco 的分词结果判定注释，不做语言正则：

- `model.getLineTokens(line)` 逐行取 token；token 类型名以 `comment` 开头才算注释（`comment`、`comment.line`、
  `comment.block`、`comment.doc` 等）。
- 注释文本 trim 后必须**以标记开头**，标记后须是空白或结尾（`@aider` 不匹配）。
- 块注释的前导 `*`（`/** @ai … */`）在 trim 时剥掉。
- 去掉标记后的剩余文本是**指令正文**；正文为空则该注释不是指令。
- 指令的行号 = 注释 token 所在行（1-based）。

字符串里的 `@ai` 不在注释 token 内，天然不匹配。

### 3.3 扫描结果

```ts
type AiInstruction = {
  /** 1-based 行号 */
  lineNumber: number
  /** 去掉标记后的指令正文 */
  instruction: string
  /** 注释原始文本（trim 后） */
  commentText: string
}
```

扫描结果**实时从 buffer 推导，不持久化**。文件是存在性的唯一真相来源。

## 4. 状态模型与持久化

### 4.1 记录

复用 `DiffComment`，新增一个 `source` 取值和两个可选字段：

```ts
export type DiffCommentSource = 'diff' | 'markdown' | 'ai-instruction'

export type DiffComment = {
  // …现有字段…
  source?: DiffCommentSource
  /** AI 指令的上下文代码片段 */
  selectedText?: string
  /** Set after the note has been handed to an agent. Edits clear it. */
  sentAt?: number
  /** AI 指令：智能体完成该轮工作的时间 */
  completedAt?: number
  /** AI 指令：接收派发的智能体面板 */
  dispatchedPaneKey?: string
}
```

AI 指令记录各字段的填法：

| 字段                                    | 值                       |
| --------------------------------------- | ------------------------ |
| `source`                                | `'ai-instruction'`       |
| `body`                                  | 指令正文                 |
| `filePath` / `lineNumber` / `startLine` | 指令所在文件与行         |
| `selectedText`                          | 上下文代码片段（§5.4）   |
| `sentAt`                                | 派发时刻                 |
| `completedAt`                           | 完成时刻                 |
| `dispatchedPaneKey`                     | 接收派发的智能体面板     |
| `side`                                  | `'modified'`（现有约束） |

### 4.2 状态机

指令与记录按 `filePath` + `body`（指令正文）对齐；同一文件内正文相同的多条指令，取行号最近的那条记录。

| 状态   | 判定                              | 行号槽图标 |
| ------ | --------------------------------- | ---------- |
| 待派发 | 文件里有该指令，无对应记录        | ⚡         |
| 已派发 | 记录有 `sentAt`、无 `completedAt` | ⏳         |
| 已完成 | 记录有 `completedAt`              | ✓          |

### 4.3 完成判定

派发时把目标智能体的 `paneKey` 记进 `dispatchedPaneKey`。之后监听
`agentStatusByPaneKey[paneKey]`：当该面板报 `state === 'done'` 且该状态的 `updatedAt >= sentAt` 时，
给记录补上 `completedAt`。

- `blocked` / `waiting`（智能体在提问或等待输入）不算完成。
- 新建智能体时，面板 key 要等 tab 建好才存在；派发动作从 launch 结果里取。取不到面板 key 的场景（例如 launch
  结果里没有该字段），该指令停在「已派发」，由手动标记兜底。
- 兜底：菜单里提供「标记为已完成」手动操作，覆盖智能体状态不可观测的场景。

### 4.4 孤儿清理

- 指令正文被改写 → 视为一条新指令（回到待派发）；旧记录成为孤儿。
- 用户删掉 `// @ai` → 该记录在**下一次针对该文件的派发写入**时剔除。

清理只覆盖当前操作涉及的文件；其他文件的孤儿记录保留（已知限制，MVP 不做全量巡检）。

### 4.5 复用 notes 存储带来的连带改动

1. `getDiffCommentSource`（`src/renderer/src/lib/source-control/review/comments/diff-comment-compat.ts`）
   目前把未知 source 归一为 `'diff'`；必须识别 `'ai-instruction'`，并新增 `isAiInstructionComment`。
2. **四处过滤点**必须排除 `ai-instruction`，否则 AI 记录会被当成 review note 渲染和发送：
   - diff 视图的评论卡渲染（`useDiffCommentDecorator` 一侧）
   - notes 侧栏（右侧 source-control 的 notes shelf，`use-visible-worktree-diff-comments.ts` 一侧）
   - 「发送未读评论」类菜单的 notes 列表（`DiffNotesSendMenu` 的 scopes）
   - 合并 diff 的 notes 操作（`use-combined-diff-notes-actions.ts` 一侧）
3. `recordReviewNoteInteraction` 遥测：AI 指令的写入不记成 `review-notes` 交互，需按 source 加守卫。
4. `normalizeDiffComment`（`src/renderer/src/store/slices/diff-comments/diff-comment-persistence.ts`）
   的 source 白名单要加上 `'ai-instruction'`，并处理 `completedAt` / `dispatchedPaneKey` 的清洗。
5. `DiffCommentSchema`（`src/shared/diff-comment-schema.ts`）的 `source` 枚举与两个新字段要同步。

### 4.6 新增的 store 动作

在 `create-diff-comments-slice.ts` 增加两个动作，复用 `mutateDiffComments` +
`enqueueDiffCommentPersist`（因此副本归属、写队列、回滚全部现成），但**不触发 review-notes 遥测**：

- `markAiInstructionsDispatched(owner, records)` —— 写入/更新一条 AI 指令记录（`sentAt` + `dispatchedPaneKey`）。
- `markAiInstructionsCompleted(owner, recordIds, completedAt)` —— 补 `completedAt`。

## 5. 交互

### 5.1 行号槽（gutter）

- 用 Monaco `glyphMargin` 装饰 + `glyphMarginClassName` 渲染三态图标（仓库目前没有 glyph margin 先例，需新写
  CSS 类与装饰逻辑，挂在既有的 `use-monaco-editor-decorations.ts` 体系里）。
- `glyphMarginHoverMessage` 显示指令正文。
- 点击图标 → 在该图标的屏幕坐标处弹出菜单（定位思路复用 `diff-comment-popover-position.ts`）。

菜单内容：

- 指令正文（只读展示）
- **发送给智能体** → 展开智能体目标列表（复用 `ReviewNotesSendMenuContent`）
- 已派发时额外给「标记为已完成」「重新派发」

### 5.2 编辑器头部批量

编辑器头部工具区加按钮「AI 指令 (N)」，N = 当前文件的待派发数量（为 0 时不显示）。

点击 → 本地下拉菜单（与行号槽共用同一个目标列表组件）：

- 默认发送范围：待派发的指令
- 子项「同时包含已派发的 (M)」：把已派发未完成的也带上
- 已完成的永远不自动带上

### 5.3 智能体目标

两种触发都复用现成的目标选择：

- 已有智能体 → `sendMessageToAgent({ worktreeId, prompt, target })`
- 新建智能体 → `QuickLaunchAgentMenuItems` → `launchAgentInNewTab`

目标列表用 `ReviewNotesSendMenuContent`（其 props：`worktreeId` / `groupId` / `prompt` /
`onPromptDelivered` / `onPromptHandedOff` / `promptDelivery` / `launchSource`）。

### 5.4 上下文片段

用 Monaco folding ranges 找**包含该指令行的最内层块**（≈ 所在函数/类），上限 60 行；取不到则退回该行 ±10 行。

片段存进记录的 `selectedText`，并进入 prompt。智能体本来就能读文件，这段是保险不是必需。

### 5.5 结果回写

智能体按 Orca 现有模型改工作区文件，产物出现在 Changes 视图；本设计不引入新的回写通道，也不做行内 diff 预览。

## 6. Prompt 格式

scaffold 用英文，与 `formatDiffComments` 保持一致；指令正文原样保留（用户写什么语言就是什么语言）。
末句里的标记名取当前配置的标记（默认 `@ai`），不是写死的字面量。

单条：

```
Implement the AI instruction at src/foo.ts:42.

Instruction: 指数退避重试，最多 5 次

Context (src/foo.ts:38-70):
<excerpt>

Keep the `// @ai` comment in place.
```

批量：

```
Implement the following AI instructions in src/foo.ts.

1. Line 42: 指数退避重试，最多 5 次
2. Line 88: 把这个校验提取成独立的 schema

Keep every `// @ai` comment in place.
```

## 7. 改动清单

### 7.1 shared

| 文件                                        | 改动                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/shared/diff-comment-types.ts`          | `DiffCommentSource` 加 `'ai-instruction'`；`DiffComment` 加 `completedAt?` / `dispatchedPaneKey?` |
| `src/shared/diff-comment-schema.ts`         | `source` 枚举 + 两个新字段                                                                        |
| `src/shared/ai-instruction-types.ts`（新）  | `AiInstruction`、状态枚举                                                                         |
| `src/shared/ai-instruction-prompt.ts`（新） | 单条与批量 prompt 拼装                                                                            |
| `src/shared/telemetry-property-schemas.ts`  | `launchSourceSchema` 加 `'ai_instruction_send'`                                                   |

### 7.2 renderer

| 文件                                                                               | 改动                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `components/editor/ai-instructions/ai-instruction-marker.ts`（新）                 | 从注释文本解析标记与指令正文                                 |
| `components/editor/ai-instructions/ai-instruction-scan.ts`（新）                   | Monaco token 扫描出指令清单                                  |
| `components/editor/ai-instructions/ai-instruction-context.ts`（新）                | folding ranges 求上下文片段                                  |
| `components/editor/ai-instructions/ai-instruction-status.ts`（新）                 | 指令 ⇄ 记录对齐，算出三态                                    |
| `components/editor/ai-instructions/use-monaco-ai-instruction-decorations.ts`（新） | 行号槽装饰与点击                                             |
| `components/editor/ai-instructions/ai-instruction-send-menu.tsx`（新）             | 行号槽弹层与头部批量共用                                     |
| `components/editor/MonacoEditor.tsx`                                               | 挂扫描与装饰（该组件已有 `filePath` / `relativePath` props） |
| `components/editor/EditorPanelHeader.tsx`                                          | 批量按钮                                                     |
| `lib/source-control/review/comments/diff-comment-compat.ts`                        | source 归一 + `isAiInstructionComment`                       |
| `store/slices/diff-comments/create-diff-comments-slice.ts`                         | 两个新动作                                                   |
| `store/slices/diff-comments/diff-comment-persistence.ts`                           | `normalizeDiffComment` 扩展                                  |

### 7.3 过滤点（§4.5）

diff 视图评论卡渲染、notes 侧栏（`use-visible-worktree-diff-comments.ts`）、发送菜单的 scopes、合并 diff 的
notes 操作。

## 8. 测试策略

按 AGENTS.md「不默认加测试」，只覆盖会随改动失效的纯逻辑：

| 目标                                                                   | 层次                               |
| ---------------------------------------------------------------------- | ---------------------------------- |
| 标记解析（`@ai` 命中 / `@aider` 不命中 / 空正文忽略 / 块注释前导 `*`） | 单元测试                           |
| prompt 格式（单条与批量，硬编码期望字符串）                            | 单元测试                           |
| 指令 ⇄ 记录对齐（同名取最近行 / 状态推导 / 孤儿判定）                  | 单元测试                           |
| store 动作（派发打戳、完成补戳、不触发 review-notes 遥测）             | store 测试，用 `createTestStore()` |
| 行号槽装饰与菜单接线                                                   | 不加测试                           |

## 9. 已知限制

- 孤儿记录只在涉及该文件的下一次派发时清理，其他文件不巡检。
- 「已完成」依赖 `agentStatusByPaneKey` 可观测；观测不到时靠手动标记。
- 仅 Monaco 源码编辑器；富文本 markdown 与插件编辑器不识别指令。
- 指令正文改写即视为新指令，旧指令的完成状态不会继承。
