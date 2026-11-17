# 终端 agent 富文本输入框 — 设计

> 日期：2026-11-18 · 状态：待评审 · 范围：Orca 桌面端终端面板新增一个可展开的 composer 覆盖层

## 1. 为什么要做

终端面板今天只有一条输入通路：键盘逐键进 xterm，xterm 再逐键进 PTY。对跑在 PTY 里的 CLI agent（Claude Code、Codex…）来说，这条通路有三个硬伤：

1. **多行输入不可用。** TUI 的输入框是单行；想发一段带换行的 prompt，只能把光标移到 TUI 的多行模式，或者干脆把内容写成一行。用户要的是「像 chat 一样写多行」。
2. **没有附件通道。** 终端面板只能靠「把文件拖到终端上」间接带文件；没有「点按钮挑文件」「粘贴截图」的入口。
3. **没有富文本。** 要引用一张截图，只能在终端里手打路径。

而 Orca 自己的原生 chat（`src/renderer/src/components/native-chat/`）**已经有**这套东西：TipTap 富文本编辑器 + 内联附件 pill + 附件落到工作区 + 把路径送进 agent。缺的不是能力，是**终端面板这条路上的接线**。

本设计把原生 chat 的 composer 能力接到**终端面板**上，作为**终端直接输入之外的第二条发送通道**。直接往终端敲键盘的方式**完全保留**。

### 1.1 已核实的现状（本机代码勘察）

| 事实                                                                                                                                         | 证据                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 终端面板**没有**任何浮在 xterm 之上的可输入覆盖层                                                                                            | `terminal-pane/` 下只有 quick-commands（下拉菜单）、dictation（麦克风胶囊，无文本框）、`NativeChatPaneCover`（整个盖住 xterm 并把 xterm 置 `inert`） |
| 原生 chat 的编辑器是 **TipTap v3（ProseMirror）**，`StarterKit` 被剥到近纯文本，只留 `HardBreak` + `Paragraph`                               | `native-chat/composer/editor/NativeChatPromptEditor.tsx:84-101`                                                                                      |
| 内联 pill 是自定义 inline atom 节点：`nativeChatSkill` / `nativeChatFileReference` / `nativeChatImageReference` / `nativeChatAgentReference` | `native-chat/composer/editor/native-chat-prompt-document.ts:16-65`                                                                                   |
| 非图片附件进 prompt 的形式是 `@path`（含空白或 `@` 时加引号）                                                                                | `src/shared/agent-image-paste.ts:30-42` `formatNativeChatFileReference`                                                                              |
| 图片附件对**支持附件语义的 agent**（claude/openclaude/codex/gemini/cursor/copilot/droid/grok）给**裸路径**，其余给 `@path`                   | `src/shared/agent-image-paste.ts:11-58` `getAgentImageHandling` / `formatAgentImagePath`                                                             |
| 往 PTY 程序化写文本的通道是 `PtyTransport.sendInput(data, 'driving')`                                                                        | `terminal-pane/pty-transport/pty-transport-types.ts:216`                                                                                             |
| **Enter 必须单独一次延迟写**；和 paste 同一次写会被 TUI 吞掉                                                                                 | `native-chat/session/terminal/send/native-chat-runtime-image-send.ts:46`、`:78-86`                                                                   |
| 清空 TUI 里已有的半截输入有现成原语                                                                                                          | `src/shared/agent-launch/startup/agent-tui-input-clear.ts` `buildAgentTuiClearInputForText`                                                          |
| 拖文件进终端**已经**能把文件上传到工作区并把路径写进 PTY                                                                                     | `terminal-pane/input/file-drop/terminal-native-file-drop.ts:27` `deliverNativeTerminalFileDrop`                                                      |
| 工作区里的落地目录是 `.orca/drops`，自带 `.gitignore`                                                                                        | `src/shared/drop-staging-ignore.ts:3-9`                                                                                                              |
| 剪贴板图片已经能存到**目标宿主**上的临时文件并返回路径                                                                                       | `window.api.ui.saveClipboardImageAsTempFile({connectionId, runtimeEnvironmentId})`                                                                   |
| 终端面板里每个 pane 的 agent 类型是可读的                                                                                                    | `state.agentLaunchConfigByPaneKey[paneKey]?.identity?.agentType`、`paneForegroundAgentByPaneKey[paneKey]?.agent`                                     |
| xterm 只有**一个** custom key handler 槽位（覆盖式）                                                                                         | `terminal-pane/input/terminal-pane-pane-input.ts:186-188`                                                                                            |

## 2. 目标与非目标

### 目标

1. 终端面板底部一个**可展开的覆盖层** composer。
2. **Enter 换行**；`Mod+Enter`（macOS `⌘↵` / 其它 `Ctrl+↵`）发送。
3. 附件三路来源（**按钮挑选** / **剪贴板粘贴** / **拖放**）统一进同一 intake，一律**落到该终端所在的工作区**，以内联 pill 出现在正文里。
4. 直接往终端敲键盘的方式**完全保留**；composer 是**另加**的一条通道。
5. 本地 / SSH / WSL / 配对 runtime 宿主，以及 folder workspace（不假设是 git worktree）都能用。
6. 发送进 TUI 的载荷与原生 chat 保持同一套规则（图片走附件路径、文件走 `@path` 引用）。

### 非目标

1. **不做移动端。**（用户已确认只做桌面。）
2. **不做加粗 / 斜体 / 标题。** 载荷是纯文本，格式标记对 TUI 没有意义；「富」体现在多行 + 内联附件引用。
3. **不改原生 chat 的对外行为。** 允许把共用件抽出去（见 §4），但原生 chat 的草稿、图片编号、skill/agent 引用节点留在原地。
4. **不改终端的键盘策略。** 终端里直接敲键盘的每一个键，行为不变。
5. **不做语音输入。** dictation 已有，且它的插入目标解析里已经有 `composer` kind，天然能落到本 composer（v1 不接线，见 §11）。

## 3. 用户可见行为

### 3.1 收起态

终端面板右下角浮一个 ghost 图标按钮（lucide `MessageSquarePlus` 或 `Paperclip`），带 Tooltip「给 agent 发消息」。终端画面不受影响。

### 3.2 展开态

覆盖层浮在终端画面**底部**（`absolute inset-x-0 bottom-0`），卡片式，带圆角、边框、阴影。

```
┌─ Terminal pane ─────────────────────────┐
│ $ claude                                │
│ > fix the bug                          │
│                                        │
│  ┌─ composer ─────────────────────────┐ │
│  │ 请看 [📎 shot.png] 这张截图          │ │
│  │ 第二行描述…                          │ │
│  │                                     │ │
│  │ [📎]  ⌘↵ 发送          Enter 换行   │ │
│  └─────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

- **正文**：TipTap contenteditable。Enter 换行；`Mod+Enter` 发送。
- **pill**：内联在正文里，可随光标移动、可删除（`Backspace` 在 pill 紧后方时删掉整个 pill）。图片 pill 显示缩略图 + 文件名；文件 pill 显示文件名。
- **附件按钮**：lucide `Paperclip`，ghost icon button，Tooltip「添加附件」。点开系统文件选择器（多选）。
- **发送按钮**：primary，文案「发送」。
- **底部提示行**：`Enter 换行 · ⌘↵ 发送`，用 `<ShortcutKeyCombo />`，标签按平台显示 `⌘` / `Ctrl+`。
- 展开时焦点进编辑器；收起后焦点回终端。

### 3.3 收起 / 展开的入口

- 新增 keybinding action **`terminal.toggleComposer`**（scope `terminal`，用户可在设置里改）。
  默认绑定 **`Mod+Shift+P`**（macOS `⌘⇧P`；Windows/Linux `Ctrl+Shift+P`）。
  选它的原因：全仓未被任何 action 占用（`Mod+Shift+A` 已被 `editor.addReviewNote` 和 `terminal.selectAll` 占用，`Mod+Shift+J` 是 `terminal.toggleNativeChat`），且与 `terminal.toggleNativeChat` 不同族、不会误认。
- 收起态 affordance 按钮点击展开。
- 展开态按 `Esc` 收起；草稿保留，下次展开还在。

## 4. 架构

### 4.1 模块

新增 `src/renderer/src/components/terminal-pane/composer/`：

| 文件                                                 | 职责                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `TerminalComposerOverlay.tsx`                        | 覆盖层外壳：portal、卡片、展开/收起、焦点交接      |
| `TerminalComposerField.tsx`                          | 正文编辑器 + 工具条 + 提示行                       |
| `use-terminal-composer-state.ts`                     | 按 pane key 的展开态与草稿（读写 store slice）     |
| `use-terminal-composer-send.ts`                      | 发送编排（清 TUI → 写图片路径 → 写正文 → 写 `\r`） |
| `attachments/terminal-composer-attachment-intake.ts` | 三路来源 → 统一 intake                             |
| `attachments/terminal-composer-workspace-copy.ts`    | 落到工作区（按宿主路由）                           |
| `editor/terminal-composer-prompt-editor.tsx`         | 终端侧的瘦版 TipTap 编辑器（用 §4.2 的共用件）     |

### 4.2 编辑器：抽出共用件

原生 chat 的 `NativeChatPromptEditor` 里只有一部分是通用富文本；另一部分绑死 native chat（IndexedDB 草稿库、pasted-text token、图片编号 provider、skill/agent 引用节点、unkerned 装饰）。

**做法**：把通用部分抽到 `src/renderer/src/components/prompt-editor/`，两边共用：

| 新文件                         | 内容                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `prompt-editor-nodes.ts`       | `fileReference` / `imageReference` 两个 inline atom 节点 + **pill ↔ 纯文本的序列化规则**                                        |
| `PromptEditor.tsx`             | TipTap 装配（`StarterKit` 剥到近纯文本 + `HardBreak` + `Placeholder`）、粘贴只插纯文本、`NativeChatComposerInput` 形状的 facade |
| `PromptFileReferencePill.tsx`  | 文件 pill 渲染                                                                                                                  |
| `PromptImageReferencePill.tsx` | 图片 pill 渲染                                                                                                                  |

原生 chat 保留自己的扩展（`nativeChatSkill` / `nativeChatAgentReference`）、草稿库、图片编号 provider、pasted-text 解析。

**为什么值得动原生 chat**：pill → 纯文本的序列化规则是**载荷正确性**的核心——它决定 agent 最终收到什么字面量。复制一份必然漂移，而漂移的表现是「agent 收不到附件路径」，只有实机才看得出来。

**拆分的落点**（按风险从低到高）：

1. 先在 `prompt-editor/` 建共用件，让**终端侧**先跑通（原生 chat 暂不改）。
2. 再把原生 chat 的 `fileReference` / `imageReference` 切到共用件，删掉旧的重复实现。

这样第二步任何时候都能停，不阻塞第一交付。

### 4.3 挂载

照抄 `TerminalSearch` 的做法：`TerminalPaneSurface` 里 `createPortal(<TerminalComposerOverlay …/>, activePane.container, 'terminal-composer-<paneId>')`。

- 定位：`absolute inset-x-0 bottom-0`，`z-index` 在 xterm 之上、在 native chat cover 之下。
- 终端面板本身不做任何布局改动（覆盖层不挤压终端画面）。

### 4.4 状态

新增 store slice `terminal-composer`：

- `openByPaneKey: Record<string, boolean>`
- `draftByPaneKey: Record<string, { document: JSONContent; attachments: TerminalComposerAttachment[] }>`

```ts
type TerminalComposerAttachment = {
  /** The attachment id the pill carries; also the image chip's row key. */
  id: string
  /** Display name in the pill (the file's base name). */
  name: string
  /** Where the bytes landed, on the host that owns this terminal. */
  workspacePath: string | null
  /** True for image pills, which the agent receives as a separate path write. */
  isImage: boolean
  /** The upload did not land; the user must attach it again. */
  failed?: boolean
}
```

**草稿只放内存，v1 不持久化**（用户已确认）。理由：native chat 的草稿库带 workspace owner 语义（workspace 被删就删草稿）、setup/edit/launch 三种特殊 scope、pasted-text token 还原——把终端草稿塞进去会引入两套草稿语义互相干扰。要持久化就另起一个 IndexedDB store，不复用 native chat 那套。

草稿按 `makePaneKey(tabId, leafId)` 归属；pane 关闭时清掉。

## 5. 附件流水线

### 5.1 三路来源 → 统一 intake

| 来源       | 入口                                                    | 已有原语                                                                           |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 按钮挑选   | 工具条 Paperclip → `window.api.shell.pickAttachments()` | `native-chat/attachments/intake/use-native-chat-file-attachment-actions.ts:6`      |
| 剪贴板图片 | 编辑器 `onPaste` 捕获 `clipboardData.files` / 图片      | `window.api.ui.saveClipboardImageAsTempFile({connectionId, runtimeEnvironmentId})` |
| 拖放       | 覆盖层 `onDragOver` / `onDrop`                          | 复用终端拖放的路径准备（`prepareOsFileDropPaths`）                                 |

三者都产出「一组本地绝对路径」→ 交给同一个 **workspace copy** 步骤 → 产出「一组工作区路径」→ 插入 pill。

### 5.2 落到工作区

**附件必须落在拥有该终端的那台机器上**——否则 agent 读不到。

| 宿主         | 机制                                                                                     | 落地目录                        |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------- |
| 本地         | `window.api.fs.importExternalPaths({sourcePaths, destDir, ensureDir: true})`             | `<workspace>/.orca/drops/`      |
| 配对 runtime | `importExternalPathsToRuntime(...)`（`runtime-file-import-client.ts:28`）                | `<workspace>/.orca/drops/`      |
| SSH / WSL    | 复用现有终端拖放的上传分支（`terminal-native-file-drop.ts:200` `uploadRemoteDropPaths`） | 远端 `<workspace>/.orca/drops/` |

工作区根目录用 `resolveTerminalDropWorktreePath(worktreeId, cwd, executionHostId, runtimeEnvironmentId)`（`terminal-drop-worktree-path.ts:12`）取，folder workspace 走 `cwd` 兜底。

**做法**：把拖放链路拆成「解析路径」与「写进 PTY」两步，composer 只用前一步。
`deliverNativeTerminalFileDrop` 的三个分支各自已经算出了 `resolvedPaths`，把它们抽成独立的 `resolveDroppedPathsToWorkspace(...)`，拖放流程与 composer 共用。

`.orca/drops` 自带 `.gitignore`（`DROP_STAGING_GITIGNORE_CONTENT`），不会污染 `git status`。

### 5.3 剪贴板图片

`saveClipboardImageAsTempFile` 已经会把图片存到**目标宿主**上的临时文件（远端走 `clipboard.startImageUpload` / `appendImageUploadChunk` / `commitImageUpload` 的分片 base64 通道），返回该宿主上的路径。之后再走 §5.2 拷进 `.orca/drops`，让「附件都在工作区里」这条规则统一成立。

### 5.4 失败语义

| 情况             | 表现                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| 单个文件拷贝失败 | 该 pill 标为「需要重新添加」，**其余附件保留**；行内提示，不静默                   |
| 上传中           | pill 显示 pending 态（spinner）                                                    |
| 全部失败         | toast + 明确文案（「上传附件失败」），不静默                                       |
| 上传途中宿主变了 | `assertCurrent` 抛错 → toast「宿主已改变，请重试」                                 |
| 文件超过体积上限 | 该 pill 拒绝并说明上限（复用 `AGENT_SESSION_ATTACHMENT_MAX_BYTES` 的口径：50 MiB） |

## 6. 发送编排

`use-terminal-composer-send.ts` 的写序列（**顺序是载荷正确性的一部分**）：

```
1. 清 TUI 里已有的半截输入
   → buildAgentTuiClearInputForText(null)  // AGENT_TUI_CLEAR_INPUT_MAX
2. 图片附件：每个图片路径**单独一次** bracketed paste 写，彼此用空格分隔
   → buildNativeChatImagePasteBytes(agentImagePastePath(agent, path))
   → agentImagePasteWrites(agent, [framed…], followedByText) 决定分隔与尾随空格
   → 路径形态由 agentImagePastePath 决定（见下）
3. 正文：一次写
   → buildNativeChatPasteBytes(text)  // 多行或超长时自动加 bracketed 框，否则裸写
   - 文件 pill 序列化成 @"path"（留在正文里）
   - 图片 pill 从正文里**摘掉**（路径已在第 2 步单独送过）
4. 延迟 NATIVE_CHAT_SUBMIT_DELAY_MS 后，单独一次写 '\r'
```

**图片路径的两种形态**（由 agent 能力决定，与「是否单独写」无关）：

| agent                                                                    | 形态                                                     | 效果                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------- |
| 支持附件语义（claude/openclaude/codex/gemini/cursor/copilot/droid/grok） | **裸路径**（再按目标 shell 转义，`agentImagePastePath`） | TUI 把它当**图片附件**收下 |
| 其余                                                                     | `@"path"`                                                | TUI 当**文件引用**去读     |

**图片 pill 永远不进正文**——路径已经在第 2 步送过了，正文里再出现一次会让 agent 收到重复的引用。

**为什么 Enter 要单独一次写**：`native-chat-runtime-image-send.ts` 已经踩过这个坑——Claude/Codex 的 TUI 会吞掉与 paste 同一次写里的 CR。

**为什么先清 TUI 输入**：用户在终端里可能已经敲了半句。不清的话我们的正文会接在旧草稿后面。

**agent 类型的取法**：与 `terminal-agent-paste-bracketing.ts` 同源——
`paneForegroundAgentByPaneKey[paneKey]?.agent`（是 TUI agent 时）优先，否则 `agentStatusByPaneKey[paneKey]?.agentType`（`restoredUnconfirmed !== true` 时）。
抽一个 `resolvePaneForegroundAgentType(...)` 供两处共用。

**写通道**：`PtyTransport.sendInput(bytes, 'driving')`（本地走 `pty:write` IPC；远端 runtime 走 `terminal.send` RPC）。异步写之前要复核 pane / PTY 身份仍指向同一目标（复用 `captureTerminalDropTransportOwner` 的 `assertCurrent` 模式），否则取消并提示，不写到别的 pane。

## 7. 键盘与焦点

| 按键                            | 行为                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| Enter                           | **换行**，绝不发。IME 组合中（`keyCode 229` / `isComposing`）只结束组合 |
| `Mod+Enter`                     | 发送（macOS `⌘↵`；其它 `Ctrl+↵`）                                       |
| Esc                             | 收起覆盖层；草稿保留                                                    |
| Backspace（光标紧贴 pill 后方） | 删掉整个 pill                                                           |

**焦点交接**：展开时把焦点从 xterm 的 helper textarea 移进编辑器；收起时移回终端。

**不要**再调 `terminal.attachCustomKeyEventHandler` —— xterm 只有**一个**该槽位（`this._customKeyEventHandler = e`，覆盖式），再调一次会把复制/粘贴/快捷键/IME 全顶掉。靠焦点切换即可。

**全局快捷键**：编辑器是 contenteditable，`isEditableTarget` 命中 → 关闭类全局快捷键（`Cmd+W` 等）自动让路，与既有规则一致。

## 8. 失败与降级

| 情况                          | 表现                                               |
| ----------------------------- | -------------------------------------------------- |
| pane 在发送途中被切换/关闭    | 取消发送 + toast，不写到别的 pane                  |
| PTY 断开                      | toast「终端已断开」，草稿保留                      |
| 宿主在上传途中变了            | `assertCurrent` 抛错 → toast「宿主已改变，请重试」 |
| 附件全部上传失败              | toast + 行内错误态                                 |
| 没有 agent 在跑（普通 shell） | 仍然可用：正文当命令发，文件当 `@path` 引用追加    |

## 9. i18n

新增文案走 `translate(key, defaultValue)` / `useTranslate()`，并补 `src/renderer/src/i18n/locales/*.json`（10 个语言）。文案遵守 STYLEGUIDE 的「不夸大」：pending 用中性过程语气，只有真出结果才用结果动词。

## 10. 测试策略

按 `AGENTS.md`「不加测试除非回退改动就会失败」，只加这三类：

1. **pill ↔ 纯文本序列化**（共用件层）：文件 pill 序列化成 `@path`；含空白/`@` 的路径加引号；图片 pill **不**进正文（路径单独送）。
2. **宿主路由选择**（workspace copy 层）：本地 / 配对 runtime / SSH 三种宿主各选对上传机制。
3. **发送写序列**（send 层）：断言写的**顺序与内容**——图片路径在前、正文一次、Enter 最后且是独立一次写。

不写：CSS 类断言、复制文案、DOM 结构、耗时。

E2E（`tests/e2e/`）：终端面板展开 composer → 输入多行 → `Mod+Enter` → 断言 PTY 收到 bracketed paste + `\r`；附件走 fixture 文件。

## 11. 已知风险与取舍

| 风险                                                                                                             | 缓解                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| TipTap 叠在 xterm 之上的焦点 / IME 行为需要真机验（尤其 Windows ConPTY）                                         | E2E 覆盖输入路径；Windows 的 modified-Enter 策略不受影响（我们只发 `\r`，不发 modified Enter） |
| 抽共用件要动原生 chat，回归面比「直接复用」大                                                                    | 分两步走（§4.2）：终端侧先用共用件跑通，原生 chat 的切换可延后                                 |
| 直接 SSH 宿主的附件落地分支需要实机确认（现代路径下 SSH 走 runtime environment，老路径 `SshHostNotServedError`） | 实现时先在本地与配对 runtime 验通；SSH 分支单独一轮实机验证                                    |
| `Mod+Shift+P` 在某些终端模拟器/远程 shell 里可能被占用                                                           | keybinding 可改；且有 affordance 按钮兜底                                                      |
| 草稿不持久化，重启丢失                                                                                           | v1 明确接受；后续可另起 IndexedDB store                                                        |

## 12. 与既有工作的关系

- **原生 chat composer**：共用件抽出后仍是同一套编辑器；原生 chat 的行为、草稿、图片编号不变。
- **终端拖放**：拆出「解析路径」这一步后与 composer 共用；拖放的现有行为不变。
- **keybindings**：新增一个 action（`terminal.toggleComposer`），进设置页的快捷键列表。
- **背景 agent 监管器**（`docs/superpowers/specs/2026-11-15-claude-background-agents-supervisor-design.md`）：面板里的派发 composer 仍走 `claude --bg "<prompt>"`，**不在本设计范围内**。若日后要给它也加附件，可以复用本设计的「落到工作区 + 路径引用」这一段。

## 13. 明确的取舍记录

1. **覆盖层而不是停靠条**：停靠条会压缩终端高度，破坏「终端画面不被遮挡」的既有预期；覆盖层只在展开时遮挡底部若干行。
2. **Enter 换行而不是 Enter 发送**：与终端里其它输入（xterm 的 Enter = 回车）的心智模型冲突，但用户明确要求，且多行是这次的主诉求；发送改用 `Mod+Enter` + 按钮，两条路径都有。
3. **图片走路径而不是内联 base64**：TUI 只认路径；base64 进 PTY 会撑爆读缓冲。
4. **附件一律拷进 `.orca/drops`，本地也不例外**：本地拖放现有行为是「就地引用、不拷贝」。composer 走「上传到工作区」的语义，所以拷贝——代价是本地多一次复制，收益是附件位置可预期、不会因为原文件被移动而失效。
5. **v1 不持久化草稿**：避免与 native chat 的草稿库语义纠缠。
6. **不做富文本格式**：载荷是纯文本。
