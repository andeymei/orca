# 终端 agent 富文本输入框 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在终端面板底部加一个可展开的覆盖层 composer:多行输入(Enter 换行、`Mod+Enter` 发送)、内联附件 pill、附件上传到该终端所在的工作区;终端直接敲键盘的方式完全保留。

**Architecture:** 复用原生 chat 的 TipTap 富文本内核,把它抽成 `src/renderer/src/components/prompt-editor/` 下的共用件;终端侧新增一个 store slice 存展开态与草稿,新增三个模块负责附件落地(intake / workspace copy)、发送编排(清 TUI → 写图片路径 → 写正文 → 单独写 Enter)。覆盖层通过 portal 挂进 `activePane.container`,与 `TerminalSearch` 同法。

**Tech Stack:** TypeScript、React 19、TipTap v3 / ProseMirror、Zustand、Electron IPC + Runtime RPC、Vitest(@testing-library/react, `happy-dom` 环境)、Playwright E2E。

**Spec:** `docs/superpowers/specs/2026-11-18-terminal-agent-rich-text-composer-design.md` —— 本计划与 spec 同读;spec 决定「要什么」,本计划决定「怎么落地」。

## Global Constraints

以下约束来自 spec,每个 task 都隐含包含:

- **只做桌面端。** 不碰 `mobile/`。
- **Enter 只换行,永不发送。** 发送用 `Mod+Enter`(macOS `⌘↵`,其它 `Ctrl+↵`)+ 发送按钮。IME 组合中的 Enter 只结束组合。
- **不改变终端现有键盘行为。** 直接往终端敲键盘的每一个键行为不变。
- **不实现富文本格式**(加粗/斜体/标题)。「富」= 多行 + 内联附件引用。
- **附件一律落到 `<workspace>/.orca/drops/`**,该目录自带 `.gitignore`(`DROP_STAGING_GITIGNORE_CONTENT`),不污染 `git status`。
- **附件必须落在拥有该终端的那台机器上**(本地 / SSH / WSL / 配对 runtime)。
- **发送写序列固定为四步**:清 TUI 输入 → 每个图片路径一次独立 bracketed paste → 正文一次写 → **Enter 单独一次延迟写**(`\r`)。Enter 与 paste 同一次写会被 TUI 吞掉。逐字节对齐原生 chat(`native-chat-runtime-image-send.ts` 的 `sendNativeChatMessageWithImageAttachments`):图片与正文之间等 `NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS`(300ms,TUI 异步建 chip);只有空白的正文等于没有正文(不写正文,最后一张图片的 paste 也不带尾随空格)。**清输入那一步无条件做**(有 agent 也好,普通 shell 也好;**唯一的例外是空消息** —— 正文为空且没有附件时一个字节都不写,连清输入与 Enter 都不写):spec §6 的理由是「用户在终端里可能已经敲了半句。不清的话我们的正文会接在旧草稿后面」,而 spec §8 说普通 shell 里正文是**当命令发**的 —— 不清就会把命令接在用户敲了一半的命令后面(`ls` + `echo hi` = `lsecho hi`),跑出一个谁也没写过的命令。丢掉那半行是更便宜的那个失败。
- **图片路径形态由 `agentImagePastePath(agent, path)` 决定**:支持附件语义的 agent 给裸路径,其余给 `@"path"`。图片 pill **永远不进正文**。
- **文件 pill 进正文的形式是 `@path`**,含空白或 `@` 时加引号(`formatNativeChatFileReference`)。
- **快捷键**:`terminal.toggleComposer`,默认 `Mod+Shift+P`(darwin `⌘⇧P`,win/linux `Ctrl+Shift+P`)。
- **草稿 v1 只放内存**,不接 native chat 的 IndexedDB 草稿库,不持久化。
- **平台差异**:`navigator.userAgent.includes('Mac')` 判 macOS;绝不硬编码 `e.metaKey`。快捷键标签用 `<ShortcutKeyCombo />`。
- **UI 只用 token**(`src/renderer/src/assets/main.css`)与 `src/renderer/src/components/ui/` 原语,不硬编码色值。
- **新增文案**走 `translate(key, defaultValue)`,并补齐 `src/renderer/src/i18n/locales/` 下全部语言文件。
- **命名**:不用 `helpers` / `utils` / `common` / `misc`;文件名按领域概念命名。
- **注释**:只在代码不能自我描述时写,一行,说「为什么」不写「怎么做」。
- **测试**:`pnpm test <path> --maxWorkers=2`。**绝不同时跑两个 vitest**(共享 transform 缓存会互相损坏)。
- **DOM 测试环境**:`// @vitest-environment happy-dom` 放在**第一行**—— 仓库里 880 个文件这么写,只有 63 个放在别处。`render` 直接来自 `@testing-library/react`,没有 `renderWithProviders` 这类包装。
- **截图 fixture** 用 `*.fixture.tsx`,放在组件旁边,由 glob 自动发现(没有手写清单);id 是「去掉 `components/` 前缀与 `.fixture.tsx` 后缀的路径」+ `:` + 导出名,例如 `terminal-pane/composer/TerminalComposerField:empty`。**单测用的 fixture 是另一种后缀** `*.test.fixture.ts(x)`。
- **不加低价值测试**:只写「回退改动就会失败」的测试;不测 CSS 类、复制文案、DOM 结构、耗时。

## Review Focus

spec 暗示、但没有 task 的测试直接覆盖的五类输入 / 失败模式。每一条在下面标注的 task 里都有对应测试钉住。

1. **中文输入法组合中按回车**(IME `keyCode 229` / `isComposing`)——必须只结束候选,**不得触发发送**,也不得把组合字符写进正文。→ Task 7
2. **剪贴板里同时有图片和文本**(多数截图工具两种都写)——图片进附件 pill,文本进正文,**两者都不能丢**。→ Task 4
3. **上传途中 pane 被关闭 / 宿主被切换**——附件不能落到一个已经没有终端的 pane 上,UI 也不能永远停在 pending。→ Task 3
4. **同一个文件被添加两次**——`.orca/drops` 里出现重名时,两个 pill 不能指向同一个路径而其中一个已被覆盖。→ Task 3
5. **Windows 路径含空格或引号**(`C:\Users\A B\…`、`…\"x` )——`@"…"` 的引号与转义必须正确,否则 agent 收到的是坏路径。→ Task 1

---

## File Structure

**新增**

| 路径                                                                                                    | 职责                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/renderer/src/components/prompt-editor/prompt-editor-nodes.ts`                                      | 共用 TipTap 节点定义(文件引用 / 图片引用)与纯文本 ⇄ 文档互转 |
| `src/renderer/src/components/prompt-editor/prompt-editor-labels.ts`                                     | 共用 pill 的标签解析契约(context + 默认解析)                 |
| `src/renderer/src/components/prompt-editor/PromptEditor.tsx`                                            | 共用 TipTap 编辑器组件(textarea 形状的 facade)               |
| `src/renderer/src/components/prompt-editor/PromptPill.tsx`                                              | 共用 pill 外壳(图标 + 标签 + selected 态)                    |
| `src/renderer/src/components/prompt-editor/PromptFileReferencePill.tsx`                                 | 共用文件 pill 渲染                                           |
| `src/renderer/src/components/prompt-editor/PromptImageReferencePill.tsx`                                | 共用图片 pill 渲染                                           |
| `src/renderer/src/store/slices/terminal-composer/terminal-composer.ts`                                  | 展开态 + 草稿的 store slice                                  |
| `src/renderer/src/components/terminal-pane/composer/TerminalComposerOverlay.tsx`                        | 覆盖层外壳(portal / 卡片 / 焦点交接)                         |
| `src/renderer/src/components/terminal-pane/composer/TerminalComposerField.tsx`                          | 正文 + 工具条 + 提示行                                       |
| `src/renderer/src/components/terminal-pane/composer/terminal-composer-agent.ts`                         | pane 的 agent 类型解析(前景优先,跳过 restored 行)            |
| `src/renderer/src/components/terminal-pane/composer/TerminalComposerShortcut.ts`                        | `terminal.toggleComposer` 的快捷键匹配                       |
| `src/renderer/src/components/terminal-pane/composer/use-terminal-composer-state.ts`                     | 读 slice 的 hook(展开态 / 草稿 / 附件)                       |
| `src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.ts`                      | 发送编排 + 纯函数写序列构造                                  |
| `src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.ts` | 三路来源(按钮 / 粘贴 / 拖放)→ 统一 intake                    |
| `src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-workspace-copy.ts`    | 附件落到工作区(按宿主路由)                                   |

**修改**

| 路径                                                                                          | 改动                                                                                    |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/renderer/src/store/index.ts`                                                             | 注册 `createTerminalComposerSlice`                                                      |
| `src/renderer/src/store/testing/app-store-test-fixture.ts`                                    | 注册 `createTerminalComposerSlice`(漏了单测就红)                                        |
| `src/renderer/src/store/types.ts`                                                             | `AppState` 加上 `TerminalComposerSlice`                                                 |
| `src/shared/keybindings/types.ts`                                                             | `KeybindingActionId` 联合类型加 `'terminal.toggleComposer'`                             |
| `src/shared/keybindings/definitions-core-4.ts`                                                | 新增 `terminal.toggleComposer` 定义                                                     |
| `src/renderer/src/components/settings/shortcuts/keybinding-title-copy.ts`                     | 新增该 action 的标题文案                                                                |
| `src/renderer/src/components/terminal-pane/controller/TerminalPaneSurface.tsx`                | 把 composer 覆盖层 portal 进 `activePane.container`                                     |
| `src/renderer/src/components/terminal-pane/input/file-drop/terminal-native-file-drop.ts`      | **不改**。composer 直接用 `importExternalPathsToRuntime`,不共用拖放的外层包装(语义不同) |
| `src/renderer/src/i18n/locales/*.json`                                                        | 新增文案                                                                                |
| `src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document.ts`      | Task 10:改用共用节点                                                                    |
| `src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document-text.ts` | Task 10:委托给共用的 `promptLeafString`                                                 |
| `src/renderer/src/components/native-chat/composer/editor/NativeChatPromptEditor.tsx`          | Task 10:扩展改指向共用节点(编辑器组件本身保留)                                          |
| `src/renderer/src/components/native-chat/composer/editor/NativeChatFileReferencePill.tsx`     | Task 10:用 `PromptFileLabelContext` 保留 pasted-text 态                                 |
| `src/renderer/src/components/native-chat/composer/editor/NativeChatImageReferencePill.tsx`    | Task 10:用 `PromptImageLabelContext` 保留编号                                           |

---

### Task 1: 共用 prompt 节点与纯文本互转

**Files:**

- Create: `src/renderer/src/components/prompt-editor/prompt-editor-nodes.ts`
- Test: `src/renderer/src/components/prompt-editor/prompt-editor-nodes.test.ts`

**Interfaces:**

- Consumes: `formatNativeChatFileReference(path)` from `src/shared/agent-image-paste.ts`;`imageReferenceToken(attachmentId)` from `src/shared/native-chat/native-chat-image-reference.ts`
- Produces:
  ```ts
  export const FILE_REFERENCE_NODE = 'nativeChatFileReference'
  export const IMAGE_REFERENCE_NODE = 'nativeChatImageReference'
  export const PromptFileReference: Node          // TipTap Node.create
  export const PromptImageReference: Node         // TipTap Node.create
  export function fileReferenceContent(path: string): JSONContent
  export function imageReferenceContent(attachmentId: string, name: string): JSONContent
  export function promptLeafString(type: string | undefined, attrs: Readonly<Record<string, unknown>> | undefined, text?: string | null): string
  export function promptText(doc: ProseMirrorNode, from?: number, to?: number): string
  export function promptTextContent(text: string): JSONContent
  export function promptHasAttachmentReferences(document: JSONContent | undefined): boolean
  export function withoutImageReferenceNodes(document: JSONContent, attachmentId: string): JSONContent
  ```

**Note on node type names:** `FILE_REFERENCE_NODE` / `IMAGE_REFERENCE_NODE` 的**字符串值必须保持 `nativeChatFileReference` / `nativeChatImageReference`**。这两个名字被写进 native chat 持久化的草稿文档(IndexedDB),改名会让已存的草稿丢失 pill。加一行注释说明原因。

- [ ] **Step 1: Write the failing test**

`src/renderer/src/components/prompt-editor/prompt-editor-nodes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  FILE_REFERENCE_NODE,
  IMAGE_REFERENCE_NODE,
  fileReferenceContent,
  promptHasAttachmentReferences,
  promptLeafString,
  promptTextContent,
  withoutImageReferenceNodes
} from './prompt-editor-nodes'

describe('prompt editor nodes', () => {
  it('serializes a file pill as an @path reference', () => {
    expect(
      promptLeafString(FILE_REFERENCE_NODE, { token: '@/tmp/a.txt', path: '/tmp/a.txt' })
    ).toBe('@/tmp/a.txt')
  })

  it('quotes a file path that carries whitespace or an @', () => {
    expect(fileReferenceContent('/tmp/my file.txt').attrs?.token).toBe('@"/tmp/my file.txt"')
    expect(fileReferenceContent('/tmp/a@b.txt').attrs?.token).toBe('@"/tmp/a@b.txt"')
  })

  it('quotes a windows path that carries spaces', () => {
    expect(fileReferenceContent('C:\\Users\\A B\\a.txt').attrs?.token).toBe(
      '@"C:\\Users\\A B\\a.txt"'
    )
  })

  it('serializes an image pill as its token', () => {
    expect(promptLeafString(IMAGE_REFERENCE_NODE, { attachmentId: 'a1', name: 'shot.png' })).toBe(
      '[Image](orca-image:a1)'
    )
  })

  it('reads a hard break as a newline', () => {
    expect(promptLeafString('hardBreak', undefined, null)).toBe('\n')
  })

  it('keeps a blank line as an empty paragraph', () => {
    // ProseMirror rejects empty text nodes, so a blank line must not become one.
    expect(promptTextContent('a\n\nb')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }
      ]
    })
  })

  it('removes an image pill and keeps the spaces around it', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'look at ' },
            { type: IMAGE_REFERENCE_NODE, attrs: { attachmentId: 'a1', name: 'shot.png' } },
            { type: 'text', text: ' please' }
          ]
        }
      ]
    }
    expect(withoutImageReferenceNodes(document, 'a1')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'look at  please' }] }]
    })
  })

  it('finds an attachment reference anywhere in the document', () => {
    const document = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [fileReferenceContent('/tmp/a.txt')] }]
    }
    expect(promptHasAttachmentReferences(document)).toBe(true)
    expect(promptHasAttachmentReferences(promptTextContent('plain'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/prompt-editor/prompt-editor-nodes.test.ts --maxWorkers=2`
Expected: FAIL — "Cannot find module './prompt-editor-nodes'"

- [ ] **Step 3: Implement `src/renderer/src/components/prompt-editor/prompt-editor-nodes.ts`**

要点:

- `PromptFileReference`:`Node.create({ name: FILE_REFERENCE_NODE, group: 'inline', inline: true, atom: true, selectable: true, addAttributes: () => ({ token: { default: '' }, path: { default: '' } }), renderText: ({ node }) => node.attrs.token, renderHTML: ({ node }) => ['span', { 'data-prompt-file-reference': node.attrs.path }] })`。
  `addNodeView` 留到 Task 6(共用 pill 组件就绪后再挂),本 task 先不挂 node view。
- `PromptImageReference`:`Node.create({ name: IMAGE_REFERENCE_NODE, ..., addAttributes: () => ({ attachmentId: { default: '' }, name: { default: '' } }), renderText: ({ node }) => imageReferenceToken(node.attrs.attachmentId), renderHTML: ({ node }) => ['span', { 'data-prompt-image-reference': node.attrs.attachmentId }] })`。
- `promptLeafString(type, attrs, text)`:依次判断 `type === 'hardBreak'` → `'\n'`;`type === IMAGE_REFERENCE_NODE` → `imageReferenceToken(String(attrs?.attachmentId))`;`type === FILE_REFERENCE_NODE` → `String(attrs?.token ?? '')`;否则 `text ?? String(attrs?.token ?? '')`。
- `promptTextContent(text)`:把纯文本按 `\n` 切成 `paragraph`,每段一个 `text` 节点。**不要**复用 native chat 的 `promptTextContent`——那个会切 pasted-text token 与图片引用,是 native chat 专属。
- `withoutImageReferenceNodes`:从 `native-chat-prompt-document-text.ts` 的同名函数搬过来,并去掉「紧邻 chip 的前导空格」那一条(终端侧不需要;native chat 的版本保留在自己的文件里,直到 Task 10 切换)。
- **另外要把相邻的两个 text 节点合成一个**(marks 相同才合)。ProseMirror 自己会用 `Fragment.fromArray` 合并同 marks 的相邻文本;不合并的话,删掉一个 chip 之后的 JSON 与 ProseMirror 规范化后的文档不一致,草稿会被误判成「改过了」。native chat 的版本不做这件事(它的输出直接进 ProseMirror,会被规范化),共用件输出的是**要存起来的 JSON**,所以必须自己合并。

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/prompt-editor/prompt-editor-nodes.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/prompt-editor/prompt-editor-nodes.ts src/renderer/src/components/prompt-editor/prompt-editor-nodes.test.ts
git commit -m "feat(prompt-editor): the shared pill nodes and their text form"
```

---

### Task 2: terminal-composer 的 store slice

**Files:**

- Create: `src/renderer/src/store/slices/terminal-composer/terminal-composer.ts`
- Create: `src/renderer/src/store/slices/terminal-composer/terminal-composer.test.ts`
- Modify: `src/renderer/src/store/types.ts`
- Modify: `src/renderer/src/store/index.ts`
- Modify: `src/renderer/src/store/testing/app-store-test-fixture.ts`

**Interfaces:**

- Consumes: 无(纯状态)
- Produces:

  ```ts
  export type TerminalComposerAttachment = {
    id: string
    name: string
    /** Where the bytes landed, on the host that owns this terminal. Null while uploading or after a failure. */
    workspacePath: string | null
    isImage: boolean
    /** The upload did not land; the user must attach it again. */
    failed?: boolean
    /** Why the upload did not land; the chip says it in words. */
    reason?: string
  }
  export type TerminalComposerDraft = {
    document: JSONContent
    attachments: TerminalComposerAttachment[]
  }
  export type TerminalComposerSlice = {
    terminalComposerOpenByPaneKey: Record<string, boolean>
    terminalComposerDraftByPaneKey: Record<string, TerminalComposerDraft>
    setTerminalComposerOpen: (paneKey: string, open: boolean) => void
    toggleTerminalComposer: (paneKey: string) => void
    setTerminalComposerDraft: (paneKey: string, draft: TerminalComposerDraft) => void
    clearTerminalComposerDraft: (paneKey: string) => void
  }
  ```

- [ ] **Step 1: Write the failing test**

`src/renderer/src/store/slices/terminal-composer/terminal-composer.test.ts` — 用 `createTestStore()`(从 `../../testing/app-store-test-fixture` 导入),断言:

```ts
it('toggles the composer open and closed for one pane', () => {
  const store = createTestStore()
  store.getState().toggleTerminalComposer('tab1:leaf1')
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBe(true)
  store.getState().toggleTerminalComposer('tab1:leaf1')
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBe(false)
})

it('keeps one pane’s draft out of another pane’s', () => {
  const store = createTestStore()
  store.getState().setTerminalComposerDraft('tab1:leaf1', {
    document: { type: 'doc', content: [{ type: 'paragraph' }] },
    attachments: []
  })
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf2']).toBeUndefined()
})

it('clears a draft without touching the composer’s open state', () => {
  const store = createTestStore()
  store.getState().setTerminalComposerOpen('tab1:leaf1', true)
  store.getState().clearTerminalComposerDraft('tab1:leaf1')
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf1']).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/store/slices/terminal-composer/terminal-composer.test.ts --maxWorkers=2`
Expected: FAIL — "Cannot find module './terminal-composer'"

- [ ] **Step 3: Implement the slice**

`src/renderer/src/store/slices/terminal-composer/terminal-composer.ts` — 照抄 `src/renderer/src/store/slices/dictation/dictation.ts` 的形状:`export const createTerminalComposerSlice: StateCreator<AppState, [], [], TerminalComposerSlice> = (set) => ({ ... })`。`toggleTerminalComposer` 用 `set((prev) => ({ terminalComposerOpenByPaneKey: { ...prev.terminalComposerOpenByPaneKey, [paneKey]: !prev.terminalComposerOpenByPaneKey[paneKey] } }))`。

- [ ] **Step 4: Register the slice — 三处,少一处测试就红**

- `src/renderer/src/store/types.ts`:加 `import type { TerminalComposerSlice } from './slices/terminal-composer/terminal-composer'`,并在 `AppState` 的交叉类型里加 `TerminalComposerSlice &`。
- `src/renderer/src/store/index.ts`:加 `import { createTerminalComposerSlice } from './slices/terminal-composer/terminal-composer'`,并在 `create(...)` 的返回对象里加 `...createTerminalComposerSlice(...a),`。
- `src/renderer/src/store/testing/app-store-test-fixture.ts`:**同样要加 import + `...createTerminalComposerSlice(...a),`**。漏了这一处,`createTestStore()` 返回的 store 里就没有这个 slice,单测会在 `store.getState().toggleTerminalComposer` 上炸成 `undefined is not a function`。

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/store/slices/terminal-composer/terminal-composer.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/slices/terminal-composer/ src/renderer/src/store/types.ts src/renderer/src/store/index.ts
git commit -m "feat(store): the terminal composer's open state and drafts"
```

---

### Task 3: 附件落到工作区(按宿主路由)

**Files:**

- Create: `src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-workspace-copy.ts`
- Create: `src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-workspace-copy.test.ts`
- Modify: `src/main/ipc/filesystem/filesystem-mutations.ts`

**Interfaces:**

- Consumes:
  - `importExternalPathsToRuntime(context, sourcePaths, destinationDir, options)` from `@/runtime/files/imports/runtime-file-import-client`
  - `RuntimeFileOperationArgs` from `@/runtime/files/runtime-file-client-types`
  - `joinRuntimeTerminalDropDir(worktreePath)` from `../../input/file-drop/terminal-drop-worktree-path`
  - `DROP_STAGING_GITIGNORE_CONTENT` from `src/shared/drop-staging-ignore`
  - `window.api.fs.writeFile({ filePath, content })` from the preload bridge
- Produces:
  ```ts
  export type TerminalComposerWorkspaceCopyRequest = {
    /** Local absolute paths of the picked or pasted files. */
    sourcePaths: readonly string[]
    /** The workspace root that owns the terminal. */
    workspacePath: string
    worktreeId: string
    /** The runtime environment that owns the terminal, when it is a paired runtime. */
    runtimeEnvironmentId?: string | null
    /** The SSH target that owns the terminal, when it is a direct SSH host. */
    connectionId?: string | null
    expectedExecutionHostId?: 'local' | `ssh:${string}`
    expectedSshTargetId?: string
    expectedSshConnectionGeneration?: number
    /** Throws when the host changed under the copy; the caller turns it into a retry notice. */
    assertCurrent?: () => void
  }
  export type TerminalComposerWorkspaceCopyResult = {
    copied: { sourcePath: string; workspacePath: string }[]
    skipped: { sourcePath: string; reason: string }[]
    failed: { sourcePath: string; reason: string }[]
  }
  export async function copyTerminalComposerAttachmentsToWorkspace(
    request: TerminalComposerWorkspaceCopyRequest
  ): Promise<TerminalComposerWorkspaceCopyResult>
  export function terminalComposerDropDir(workspacePath: string): string
  ```

**Notes:**

- **落地目录**:`terminalComposerDropDir(workspacePath)` 返回 `<workspacePath>/.orca/drops`,复用 `joinRuntimeTerminalDropDir`(它已经处理 Windows 分隔符)。
- **重名**:`importExternalPaths` 用 `COPYFILE_EXCL` + `deconflictCopyName` 去重,同名文件会被改名(`renamed: true`)。结果里必须带**去重后的** `destPath`,不能回写源路径。
- **本地 `.gitignore`**:runtime 路径由 `ensureRuntimeDropStagingIgnored` 自动写;**本地路径要自己写** —— 拷贝成功后调用 `window.api.fs.writeFile({ filePath: join(destDir, '.gitignore'), content: DROP_STAGING_GITIGNORE_CONTENT })`,**best effort**(失败不影响附件)。
- **SSH 宿主**:`importExternalPathsToRuntime` 在 `target.kind !== 'environment'` 时落到 `window.api.fs.importExternalPaths({ connectionId })`,由该宿主的文件系统通路服务。**这一条要实机验一次**:若该宿主把请求落到本机(main 侧对 `connectionId != null` 抛 `SshHostNotServedError`),则 SSH 附件会失败,此时把该宿主路由到 runtime environment 分支。spec §11 已把这条列为待验风险。

- [ ] **Step 1: Write the failing test**

`terminal-composer-workspace-copy.test.ts` — 用 `vi.mock` 替换 `@/runtime/files/imports/runtime-file-import-client` 的 `importExternalPathsToRuntime` 与 `window.api.fs`,断言:

```ts
it('copies into the workspace drop staging directory', async () => {
  importExternalPathsToRuntime.mockResolvedValue({
    results: [
      { sourcePath: '/tmp/a.txt', status: 'imported', destPath: '/ws/.orca/drops/a.txt', kind: 'file', renamed: false }
    ]
  })
  const result = await copyTerminalComposerAttachmentsToWorkspace({
    sourcePaths: ['/tmp/a.txt'],
    workspacePath: '/ws',
    worktreeId: 'w1'
  })
  expect(importExternalPathsToRuntime).toHaveBeenCalledWith(
    expect.anything(),
    ['/tmp/a.txt'],
    '/ws/.orca/drops',
    expect.objectContaining({ ensureDestinationDir: true })
  )
  expect(result.copied).toEqual([{ sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a.txt' }])
})

it('reports a skipped source without failing the others', async () => {
  importExternalPathsToRuntime.mockResolvedValue({
    results: [
      { sourcePath: '/tmp/a', status: 'skipped', reason: 'unsupported' },
      { sourcePath: '/tmp/b', status: 'imported', destPath: '/ws/.orca/drops/b', kind: 'file', renamed: false }
    ]
  })
  const result = await copyTerminalComposerAttachmentsToWorkspace({ ... })
  expect(result.skipped).toEqual([{ sourcePath: '/tmp/a', reason: 'unsupported' }])
  expect(result.copied).toHaveLength(1)
})

it('gives a deconflicted copy its own path', async () => {
  importExternalPathsToRuntime.mockResolvedValue({
    results: [
      { sourcePath: '/tmp/a.txt', status: 'imported', destPath: '/ws/.orca/drops/a (1).txt', kind: 'file', renamed: true }
    ]
  })
  const result = await copyTerminalComposerAttachmentsToWorkspace({ ... })
  expect(result.copied[0].workspacePath).toBe('/ws/.orca/drops/a (1).txt')
})

it('propagates a host change instead of reporting a copied file', async () => {
  importExternalPathsToRuntime.mockRejectedValue(new Error('Terminal upload host changed; retry the drop.'))
  await expect(
    copyTerminalComposerAttachmentsToWorkspace({ ..., assertCurrent: () => { throw new Error('Terminal upload host changed; retry the drop.') } })
  ).rejects.toThrow('host changed')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-workspace-copy.test.ts --maxWorkers=2`
Expected: FAIL — "Cannot find module './terminal-composer-workspace-copy'"

- [ ] **Step 3: Implement `terminal-composer-workspace-copy.ts`**

- `terminalComposerDropDir(workspacePath)` → `joinRuntimeTerminalDropDir(workspacePath)`。
- `copyTerminalComposerAttachmentsToWorkspace`:
  1. `const destDir = terminalComposerDropDir(request.workspacePath)`
  2. `const context: RuntimeFileOperationArgs = { target: runtimeTargetForOwnerEnvironment(request.runtimeEnvironmentId) , worktreeId, worktreePath: request.workspacePath, expectedExecutionHostId, expectedSshTargetId, expectedSshConnectionGeneration, connectionId }` —— `runtimeTargetForOwnerEnvironment` 在 `@/runtime/rpc/targets/runtime-client-target`。
  3. `const { results } = await importExternalPathsToRuntime(context, [...request.sourcePaths], destDir, { ensureDestinationDir: true, assertCurrent: request.assertCurrent, nameExtensionlessImages: true })`
  4. 把 `results` 映射成 `copied` / `skipped` / `failed` 三组(`skipped` 的 `reason` 是 `ImportSkipReason` 字符串;`failed` 的 `reason` 是字符串)。
  5. 若 `copied.length > 0` 且**拷贝实际发生在本机**,best-effort 写 `.gitignore`。
- 整个函数**不吞异常**:`assertCurrent` 抛出的错误要往上抛(调用方转成「宿主已改变,请重试」);单个文件的失败已经在 `results` 里,不要额外抛。
- **「拷贝实际发生在哪台机器」只能算一次。** importer 的分支条件是 `target.kind !== 'environment' || !worktreeId || !worktreePath`(`runtime-file-import-client.ts:41`);「要不要写 `.gitignore`」必须用**同一个**判断,否则会出现「拷到本机了但不写 ignore」或「传到 runtime 了却往本机写 ignore」。抽一个 `copiesLocally` 布尔量,两处都用它。
- `sourcePaths` 为空时**直接返回**,不要走一趟远端(会白建一个空的 drop 目录)。

- [ ] **Step 4: Honor `ensureDir` in main's `fs:importExternalPaths`**

`fs:importExternalPaths` **声明了 `ensureDir` 却从不读它**(`filesystem-mutations.ts` 的 handler 里没有任何 mkdir),所以目标目录不存在时拷贝必然 ENOENT(`filesystem-import-local-tree-copy.ts:87` 的 `open(dstPath, 'wx')` 不会建父目录)。

**这不只是 composer 的问题**:`editor-dropped-file-open.ts` 和 `attachment-drop-state.ts` 早就传了 `ensureDestinationDir: true`,目标目录同样是 `.orca/drops`——也就是说**在本机工作区把文件拖进编辑器或聊天框,今天就是坏的**。

修在 main:在 `resolveLocalRequestPath` 之后、拷贝之前,`if (args.ensureDir) await mkdir(windowsFsPath(resolvedDest), { recursive: true })`。

- 这是**兑现已声明的契约**,不是新加行为:preload 的类型、main 的参数类型、renderer 的 client 都传了这个选项,只有 handler 忽略了它。
- 对现有调用方是**严格改进**:传了 `ensureDir: true` 的调用方今天在目录缺失时静默失败,修好后正常;没传的不受影响(不会建目录)。
- 不要改 renderer 去建目录:`fs:createDir` 拒绝已存在的路径(`filesystem-create-path-guards.ts`),要额外写「已存在就放过」的容错,更脆,而且留着契约仍然是坏的。

`.gitignore` 那一步不用另建目录:本机路径下 `.orca/drops` 由上面这步建出来了。

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-workspace-copy.test.ts --maxWorkers=2` && `pnpm test src/main/ipc/filesystem --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/terminal-pane/composer/attachments/ src/main/ipc/filesystem/filesystem-mutations.ts
git commit -m "feat(composer): copy attachments into the workspace that owns the terminal"
```

---

### Task 4: 附件 intake(按钮 / 粘贴 / 拖放)

**Files:**

- Create: `src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.ts`
- Create: `src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.test.ts`

**Interfaces:**

- Consumes:
  - `window.api.shell.pickAttachments(): Promise<string[]>`
  - `window.api.ui.saveClipboardImageAsTempFile(): Promise<string | null>` —— **不带** host 参数,即存到本机
  - `copyTerminalComposerAttachmentsToWorkspace(request)` from Task 3
  - `imageReferenceContent(attachmentId, name)` / `fileReferenceContent(path)` from Task 1
- Produces:

  ```ts
  export type TerminalComposerIntakeHost = {
    /** The workspace root that owns the terminal. */
    workspacePath: string
    worktreeId: string
    runtimeEnvironmentId?: string | null
    connectionId?: string | null
    expectedExecutionHostId?: 'local' | `ssh:${string}`
    expectedSshTargetId?: string
    expectedSshConnectionGeneration?: number
    assertCurrent?: () => void
  }
  export type TerminalComposerIntakeResult = {
    attachments: TerminalComposerAttachment[]
    failed: { name: string; reason: string }[]
  }
  export async function pickTerminalComposerAttachments(
    host: TerminalComposerIntakeHost
  ): Promise<TerminalComposerIntakeResult>
  export async function pasteTerminalComposerAttachments(
    host: TerminalComposerIntakeHost,
    clipboardData: { files: File[]; items?: DataTransferItem[] }
  ): Promise<TerminalComposerIntakeResult>
  export async function dropTerminalComposerAttachments(
    host: TerminalComposerIntakeHost,
    droppedPaths: readonly string[]
  ): Promise<TerminalComposerIntakeResult>
  /** The reason code for a pasted file with no file behind it. */
  export const TERMINAL_COMPOSER_NO_LOCAL_PATH_REASON = 'no-local-path'
  ```

- [ ] **Step 1: Write the failing test**

```ts
it('keeps the image and the text from one clipboard paste', async () => {
  // 剪贴板同时带图片文件和纯文本
  const result = await pasteTerminalComposerAttachments(host, {
    files: [pngFile],
    items: [
      { kind: 'string', type: 'text/plain', getAsString: () => 'look at this' } as DataTransferItem
    ]
  })
  expect(result.attachments).toHaveLength(1)
  expect(result.attachments[0].isImage).toBe(true)
})

it('reports a failed upload without losing the other attachments', async () => {
  copyTerminalComposerAttachmentsToWorkspace.mockResolvedValue({
    copied: [{ sourcePath: '/tmp/a.txt', workspacePath: '/ws/.orca/drops/a.txt' }],
    skipped: [],
    failed: [{ sourcePath: '/tmp/b.png', reason: 'disk full' }]
  })
  const result = await pickTerminalComposerAttachments(host)
  expect(result.attachments).toHaveLength(1)
  expect(result.failed).toEqual([{ name: 'b.png', reason: 'disk full' }])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.test.ts --maxWorkers=2`
Expected: FAIL — "Cannot find module './terminal-composer-attachment-intake'"

- [ ] **Step 3: Implement `terminal-composer-attachment-intake.ts`**

三个来源共享一条尾巴:

```ts
async function landAttachments(
  host,
  sourcePaths: readonly string[]
): Promise<TerminalComposerIntakeResult>
```

- `pickTerminalComposerAttachments`:`const paths = await window.api.shell.pickAttachments()`;空数组直接返回空结果(不开 toast)。
- `pasteTerminalComposerAttachments`:
  1. **遍历 `clipboardData.files` 的每一个文件**,按 `file.type.startsWith('image/')` 分成图片与非图片两类。
  2. **每个文件都按自己的本机路径当 source path**(`localPathForFile(file)`)。解析不出本机路径的(浏览器里复制的 blob 之类)**不许消失**:进 `failed`,reason 用导出的 `TERMINAL_COMPOSER_NO_LOCAL_PATH_REASON`。
  3. **剪贴板保存只顶一次,而且只顶给「没有本机路径的图片」**:`window.api.ui.saveClipboardImageAsTempFile()`(**不带** `connectionId` / `runtimeEnvironmentId`,即存到**本机**)拿到本机临时路径。**不要**把图片先存到目标宿主——上传通路的源路径按契约是客户端本机路径,已经在远端的临时路径它读不到。保存失败或返回 null 时,那一张图片按第 2 条进 `failed`。
  4. `clipboardData.items` 里的 `text/plain` **不进附件** —— 它是正文文本,由 Task 7 的字段插进正文(编辑器自己的 paste handler 在这一步不会跑:事件被 preventDefault 了)。本函数只负责附件。
  5. 调 `landAttachments`。
- `dropTerminalComposerAttachments`:`droppedPaths` → `landAttachments`。
- `landAttachments`:调 `copyTerminalComposerAttachmentsToWorkspace`,把 `copied` 变成 `TerminalComposerAttachment[]`:
  - `id` 用 `createNonSecureContextUuid()`(来自 `src/shared/non-secure-context-uuid.ts`)。**不要用 `crypto.randomUUID()`** —— 仓库的 oxlint 规则禁止在 renderer 里用它(非安全上下文没有它)。
  - `name` 用 `basename(workspacePath)`——即**去重后的**那个名字,和实际存在的文件一致。
  - `isImage` 用 **`isImageDropPath(copied.workspacePath) || isImageDropPath(copied.sourcePath)`**:**先看落地后的路径**。拷贝那一层开着 `nameExtensionlessImages`,会给无扩展名的图片补上图片扩展名(`Screenshot` → `Screenshot.png`);只看源路径的话,一个无扩展名的图片会被判成非图片,于是正文里发出去的是 `@path` 文件引用而不是图片附件——和拷贝自己的判断矛盾。落地路径的扩展名是拷贝已经认过的那个,所以它更可信。
  - 把 `failed` 变成 `failed[]`;`copy.skipped[]` 也并进 `failed[]`(它同样没落地,悄悄丢掉才是错的)。**注意 `reason` 是机器可读的码**(`missing` / `symlink` / `permission-denied` / `unsupported`),不是给用户看的句子——Task 7 负责把它翻成人话。
- 体积上限按 `AGENT_SESSION_ATTACHMENT_MAX_BYTES`(50 MiB)判定;超限的文件**不进上传**,直接进 `failed`,reason 写明上限。**多个源文件的体积检查要并行**(`Promise.all`),不要在循环里一个个 await。
- **一次粘贴里的每一张图片都要处理。** 早先的写法用 `files.find(...)` 只取第一张图片,循环又对每张图片 `continue` —— 第 2..n 张既不进源路径、也不进 `failed`、也没有 pill(Finder 里选两张 PNG 粘贴就会这样;Windows 上剪贴板给的是图片字节,走的又是另一条路,表现还不一致)。正确做法:**遍历每一个文件**,各自按自己的本机路径落地;剪贴板保存出来的临时路径**只在某个图片没有本机路径时顶上,而且只顶一次**。
- **解析不出本机路径的粘贴源不许消失。** 浏览器里复制的 blob 之类没有磁盘文件的粘贴,`localPathForFile` 会返回 null —— 这时要进 `failed`(reason 用 `'no-local-path'`),不能悄悄丢掉。**这个 reason 码要导出**,Task 7 要靠它把码翻成人话;写死字符串会漂。
- **`id` 用 `createNonSecureContextUuid()`**(`src/shared/non-secure-context-uuid.ts`)。**不要用 `crypto.randomUUID()`** —— 仓库的 oxlint 规则禁止在 renderer 里用它(非安全上下文没有它)。

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.ts src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-attachment-intake.test.ts
git commit -m "feat(composer): one intake for picked, pasted and dropped attachments"
```

---

### Task 5: 发送编排

**Files:**

- Create: `src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.ts`
- Create: `src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.test.ts`
- Modify: `src/shared/native-chat/input/native-chat-answer-stepping.ts`(加图片落定的等待常量)
- Modify: `src/renderer/src/components/native-chat/session/terminal/send/native-chat-runtime-image-send.ts`(改成从 shared 引那个常量)

**Interfaces:**

- Consumes:
  - `AGENT_TUI_CLEAR_INPUT_MAX` from `src/shared/agent-launch/startup/agent-tui-input-clear`
  - `buildNativeChatPasteBytes(text)`, `buildNativeChatImagePasteBytes(filePath)`, `NATIVE_CHAT_SUBMIT` from `src/shared/native-chat/input/native-chat-paste-bytes`
  - `NATIVE_CHAT_SUBMIT_DELAY_MS` from `src/shared/native-chat/input/native-chat-answer-stepping`(不在 paste-bytes 里)
  - `NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS` from the same file —— **这个常量现在住在 native chat 的 renderer 模块里,把它挪到 shared**:composer 不能 import native chat 的发送模块(那会把整条发送链路拖进来),而两个 300ms 各写一份必然会漂。挪完让 `native-chat-runtime-image-send.ts` 从 shared 引,原生 chat 自己的测试照过。
  - `agentImagePastePath(agent, path)` from `src/shared/agent-image-paste-path`
  - `agentImagePasteWrites(agent, framedPastes, followedByText)` from `src/shared/agent-image-paste`
  - `PtyTransport.sendInput(data, 'driving')` from `../../pty-transport/pty-transport-types`
- Produces:

  ```ts
  export type TerminalComposerWrite = { data: string; delayBeforeMs: number }
  export type TerminalComposerSendRequest = {
    paneId: number
    leafId: string
    tabId: string
    /** The prompt body: file pills serialized as @path, image pills already removed. */
    body: string
    /** Workspace paths of the image attachments, in pill order. */
    imagePaths: readonly string[]
    /** The agent running in this pane, when one is detected. */
    agent: string | null
  }
  export type TerminalComposerSendResult = {
    sent: boolean
    reason?: 'pane-changed' | 'host-changed' | 'write-rejected' | 'pty-disconnected'
  }
  export function buildTerminalComposerWrites(args: {
    body: string
    imagePaths: readonly string[]
    agent: string | null
  }): TerminalComposerWrite[]
  export function useTerminalComposerSend(args: {
    /** The tab's pane manager; proves the pane is still mounted before a write. */
    managerRef: React.RefObject<PaneManager | null>
    /** The tab's live transports, keyed by pane id. */
    paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  }): {
    send: (request: TerminalComposerSendRequest) => Promise<TerminalComposerSendResult>
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe('terminal composer writes', () => {
  it('clears the agent input, writes the image path, the body, then Enter last', () => {
    const writes = buildTerminalComposerWrites({
      body: 'look at this',
      imagePaths: ['/ws/.orca/drops/shot.png'],
      agent: 'claude'
    })
    expect(writes[0].data).toBe(AGENT_TUI_CLEAR_INPUT_MAX)
    // The last image paste takes a space so the body does not merge into the chip.
    expect(writes[1].data).toBe(`${wrapTerminalBracketedPasteText('/ws/.orca/drops/shot.png')} `)
    expect(writes[2].data).toBe(buildNativeChatPasteBytes('look at this'))
    // The chip is created asynchronously; the body waits for it.
    expect(writes[2].delayBeforeMs).toBe(NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS)
    expect(writes[3].data).toBe(NATIVE_CHAT_SUBMIT)
    expect(writes[3].delayBeforeMs).toBe(NATIVE_CHAT_SUBMIT_DELAY_MS)
  })

  it('gives an agent without attachment support an @path reference', () => {
    const writes = buildTerminalComposerWrites({
      body: '',
      imagePaths: ['/ws/.orca/drops/shot.png'],
      agent: 'some-shell'
    })
    expect(writes[1].data).toContain('@"/ws/.orca/drops/shot.png"')
  })

  it('gives each image its own paste, in pill order', () => {
    const writes = buildTerminalComposerWrites({
      body: 'two',
      imagePaths: ['/ws/.orca/drops/a.png', '/ws/.orca/drops/b.png'],
      agent: 'claude'
    })
    expect(writes[1].data).toBe(wrapTerminalBracketedPasteText('/ws/.orca/drops/a.png'))
    expect(writes[2].data).toBe(`${wrapTerminalBracketedPasteText('/ws/.orca/drops/b.png')} `)
  })

  it('writes Enter separately even with no attachments', () => {
    const writes = buildTerminalComposerWrites({ body: 'hello', imagePaths: [], agent: 'claude' })
    expect(writes.map((w) => w.data)).toEqual([
      AGENT_TUI_CLEAR_INPUT_MAX,
      buildNativeChatPasteBytes('hello'),
      NATIVE_CHAT_SUBMIT
    ])
  })

  it('writes no body when there is only whitespace to send', () => {
    const writes = buildTerminalComposerWrites({ body: '   ', imagePaths: [], agent: 'claude' })
    expect(writes.map((w) => w.data)).toEqual([AGENT_TUI_CLEAR_INPUT_MAX, NATIVE_CHAT_SUBMIT])
  })

  it('clears the terminal input line even when no agent was detected', () => {
    const writes = buildTerminalComposerWrites({ body: 'hello', imagePaths: [], agent: null })
    expect(writes.map((w) => w.data)).toEqual([
      AGENT_TUI_CLEAR_INPUT_MAX,
      buildNativeChatPasteBytes('hello'),
      NATIVE_CHAT_SUBMIT
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.test.ts --maxWorkers=2`
Expected: FAIL — "Cannot find module './use-terminal-composer-send'"

- [ ] **Step 3: Implement `buildTerminalComposerWrites`**

```ts
export function buildTerminalComposerWrites({
  body,
  imagePaths,
  agent
}: {
  body: string
  imagePaths: readonly string[]
  agent: string | null
}): TerminalComposerWrite[] {
  const writes: TerminalComposerWrite[] = []
  // The clear empties the pending input line — the agent's TUI line, or the shell's line when
  // no agent runs. Without it the body would be concatenated onto whatever the user half-typed.
  writes.push({ data: AGENT_TUI_CLEAR_INPUT_MAX, delayBeforeMs: 0 })
  // A body of only whitespace is no body: native chat treats it as no text.
  const hasText = body.trim().length > 0
  const framed = agentImagePasteWrites(
    agent,
    imagePaths.map((path) => buildNativeChatImagePasteBytes(agentImagePastePath(agent, path))),
    hasText
  )
  for (const data of framed) {
    writes.push({ data, delayBeforeMs: 0 })
  }
  if (hasText) {
    writes.push({
      data: buildNativeChatPasteBytes(body),
      // The chip is created asynchronously; the body waits for it to exist.
      delayBeforeMs: imagePaths.length > 0 ? NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS : 0
    })
  }
  writes.push({ data: NATIVE_CHAT_SUBMIT, delayBeforeMs: NATIVE_CHAT_SUBMIT_DELAY_MS })
  return writes
}
```

- [ ] **Step 4: Implement `useTerminalComposerSend`**

- **transport 的取法照抄拖放**:`captureTerminalDropTarget(pane, transport)` 在发送前捕获身份,之后每次写之前用 `getCurrentTerminalDropTransport(manager, paneTransports, target)` 复核。`managerRef` 与 `paneTransportsRef` 由 `TerminalPaneSurface` 的 controller 提供,**通过 props 传进来**,不要去 store 里找(它们不是 store 状态)。
- **写进 PTY 之前必须再复核一次宿主。** Task 3 的上传通路在本机分支**不强制** `assertCurrent`(它只在 runtime 分支强制)。所以发送层要自己复核:写入前确认 transport 仍是同一个、宿主没变;变了就取消并告诉用户「宿主已改变,请重试」,不要写。**宿主变了要单独报 `'host-changed'`**,不要和「pane 没了」共用 `'pane-changed'` —— 两者的用户提示不同,Task 7 手里有 `hostChanged` 这条文案。
- **WSL 工作区的路径要转成 WSL 里的样子。** 一个 WSL 拥有的工作区,附件落地的路径是 Windows 侧的 UNC 形式(`\\wsl.localhost\…`),但**跑在 WSL 里的 agent 要的是 Linux 路径**。写进 PTY 之前用 `toLocalWslDropPath(path)`(在 `terminal-pane/input/file-drop/terminal-drop-local-wsl.ts`)把路径转过来;拖放那条路就是这么做的。
- **只 import 共用件的那三份函数**,不要 import 原生 chat 的同名副本(`promptTextContent` / `withoutImageReferenceNodes` / `promptLeafString`)。两份同名不同语义,import 错了会让 agent 收到不同的正文。
- 复核失败 → `{ sent: false, reason: 'pane-changed' }`,**不写**。
- 按 `delayBeforeMs` 串行写:用 `setTimeout` 链,第一次 `delayBeforeMs` 为 0 时立即写。
- `transport.sendInput(write.data, 'driving')` 返回 false → `{ sent: false, reason: 'write-rejected' }`。
- transport 不存在 → `{ sent: false, reason: 'pty-disconnected' }`。
- **写序列要与原生 chat 逐字节对齐。** 对照物是 `src/renderer/src/components/native-chat/session/terminal/send/native-chat-runtime-image-send.ts` 的 `sendNativeChatMessageWithImageAttachments`,它有三条本 task 原先漏掉的规则:
  1. **图片与正文之间要等 `NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS`(300ms)。** TUI 是异步把图片变成 chip 的,不等这一下,正文可能先落地,agent 收到的顺序就是反的。
  2. **正文按 trim 后的长度判断有没有文字。** 只有空白的正文等于没有正文:不写正文,最后一张图片的 paste 也不带尾随空格。
  3. **清输入那一步无条件做。** spec §6 的理由是「用户在终端里可能已经敲了半句。不清的话我们的正文会接在旧草稿后面」,spec §8 说普通 shell 里正文是**当命令发**的。不清就会把命令接在用户敲了一半的命令后面,跑出一个谁也没写过的命令;丢掉那半行是更便宜的那个失败。清的字节在 shell 里也有效(Ctrl+U / Ctrl+K 是 readline 与 zsh 的行编辑键)。
- **`NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS` 挪到 `src/shared/native-chat/input/native-chat-answer-stepping.ts`**(和 `NATIVE_CHAT_SUBMIT_DELAY_MS` 放一起),`native-chat-runtime-image-send.ts` 改成从 shared 引。两个 300ms 各写一份必然会漂,而 composer 不能 import native chat 的发送模块。
- **测试要钉住「每个图片路径一次独立的 bracketed paste」。** 这是本 task 最重要的载荷规则,只用一张图的话,「把两个路径并进一次 paste」的回归会照样通过。

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.ts src/renderer/src/components/terminal-pane/composer/use-terminal-composer-send.test.ts
git commit -m "feat(composer): clear the agent input, then write the paths, the body and Enter"
```

---

### Task 6: 共用编辑器组件与 pill 渲染

**Files:**

- Create: `src/renderer/src/components/prompt-editor/prompt-editor-labels.ts`
- Create: `src/renderer/src/components/prompt-editor/PromptPill.tsx`
- Create: `src/renderer/src/components/prompt-editor/PromptFileReferencePill.tsx`
- Modify: `src/renderer/src/components/prompt-editor/prompt-editor-nodes.ts`(给两个节点挂 `addNodeView` —— Task 1 特意把这一步留到共用 pill 组件就绪之后)
- Create: `src/renderer/src/components/prompt-editor/PromptImageReferencePill.tsx`
- Create: `src/renderer/src/components/prompt-editor/PromptEditor.tsx`
- Create: `src/renderer/src/components/prompt-editor/PromptEditor.test.tsx`
- Modify: `src/renderer/src/components/prompt-editor/prompt-editor-nodes.test.ts`(加 `// @vitest-environment happy-dom` —— 节点模块现在会 import 两个 React pill 组件,纯 node 环境下不再可靠)

**Interfaces:**

- Consumes: Task 1 的节点与序列化;`NativeChatPromptPill` 风格的渲染(`src/renderer/src/components/native-chat/composer/editor/NativeChatPromptPill.tsx` —— **不要**直接 import 它,那会把 native chat 拖进来;照它的样式写一个共用版 `PromptPill.tsx`)
- Produces:
  ```ts
  // prompt-editor-labels.ts
  export type PromptFileLabel = { label: string; icon: LucideIcon; title?: string }
  export type PromptFileLabelResolver = (path: string, token: string) => PromptFileLabel | null
  export const PromptFileLabelContext: React.Context<PromptFileLabelResolver | null>
  export type PromptImageLabel = { label: string; missing: boolean }
  export type PromptImageLabelResolver = (attachmentId: string) => PromptImageLabel | null
  export const PromptImageLabelContext: React.Context<PromptImageLabelResolver | null>

  // PromptEditor.tsx
  export type PromptEditorInput = {
    /** The editor's text: file pills as their `@path` reference, image pills as their token. */
    readonly value: string
    readonly disabled: boolean
    focus: () => void
    insertText?: (text: string) => void
    insertFileReferences?: (paths: readonly string[]) => void
    insertImageReference?: (attachmentId: string, name: string) => void
    removeImageReferences?: (attachmentId: string) => void
  }
  export type PromptEditorProps = {
    inputRef: React.RefObject<PromptEditorInput | null>
    initialDocument: JSONContent
    disabled: boolean
    placeholder: string
    /** The editor owns the document, so it reports it; the text facade alone cannot carry pills. */
    onDocumentChange?: (document: JSONContent) => void
    onChange?: (input: PromptEditorInput) => void
    onSelect?: (input: PromptEditorInput) => void
    className?: string
  }
  export const PromptEditor: React.FC<PromptEditorProps>
  ```

**Notes:**

- `PromptEditor` 的 TipTap 装配照抄 `NativeChatPromptEditor` 的 `useEditor` 配置:`StarterKit.configure({ blockquote:false, bold:false, bulletList:false, code:false, codeBlock:false, dropcursor:false, gapcursor:false, heading:false, horizontalRule:false, italic:false, link:false, listItem:false, orderedList:false, strike:false, underline:false, trailingNode:false })` + `Placeholder` + `PromptFileReference` + `PromptImageReference`。**不要**再单独加 `HardBreak` —— StarterKit 已经带了它(`@tiptap/starter-kit` 依赖 `@tiptap/extension-hard-break`),再加一次会重复注册同名节点。
- **不要**带 native chat 的草稿库、pasted-text scope、图片编号 provider、unkerned 装饰。
- `handlePaste` 只插纯文本(与 native chat 一致)。
- **facade 的 `value` 是 `promptText(editor.state.doc)`** —— 文件 pill 读成它的 `@path` token,图片 pill 读成它的 `[Image](orca-image:<id>)` token。**图片 token 会留在 `value` 里**:正文(发给 agent 的 body)去掉图片 token 是 **Task 7** 的事,它用 `splitImageReferences`(`src/shared/native-chat/native-chat-image-reference.ts`)把文本拆开、只留字符串部分拼回去。编辑器的 `value` 与「发给 agent 的正文」是两件事,不要在共用组件里替 Task 7 做这个决定。
- **facade 只做终端侧真用到的成员**(`value` / `disabled` / `focus` / `insertText` / `insertFileReferences` / `insertImageReference` / `removeImageReferences`)。**不要**把原生 chat 的 `selectionStart` / `selectionEnd` / `select` / `setSelectionRange` 搬过来:终端侧一处都不用,而要正确实现它们,得把 `promptTextOffset` / `promptTextPosition` 两个纯函数从 native chat 的模块搬进共用件 —— 那是为一个没人用的需求铺子系统。原生 chat 的 `NativeChatPromptEditor` 自己留着那一份。
- 节点类型名保持 Task 1 的 `nativeChatFileReference` / `nativeChatImageReference`,**Task 10 切换原生 chat 时不需要迁移草稿**。

- [ ] **Step 1: Write the failing test**

`PromptEditor.test.tsx`(`// @vitest-environment happy-dom`):

```ts
it('renders a file pill as the attachment it names', () => {
  const inputRef = createRef<PromptEditorInput>()
  render(
    <PromptEditor
      inputRef={inputRef}
      initialDocument={{ type: 'doc', content: [{ type: 'paragraph', content: [fileReferenceContent('/tmp/a.txt')] }] }}
      disabled={false}
      placeholder="Message"
    />
  )
  expect(screen.getByText('a.txt')).toBeVisible()
})

it('shows the image pill the label resolver names', () => {
  render(
    <PromptImageLabelContext.Provider value={() => ({ label: 'shot.png', missing: false })}>
      <PromptEditor ... initialDocument 含 imageReferenceContent('a1', 'shot.png') ... />
    </PromptImageLabelContext.Provider>
  )
  expect(screen.getByText('shot.png')).toBeVisible()
})

it('inserts a file pill at the caret', () => {
  const inputRef = createRef<PromptEditorInput>()
  render(<PromptEditor inputRef={inputRef} ... />)
  act(() => inputRef.current!.focus())
  act(() => inputRef.current!.insertText?.('hi '))
  act(() => inputRef.current!.insertFileReferences?.(['/tmp/a.txt']))
  // The pill lands where the caret is, not at the end of the document.
  expect(inputRef.current!.value).toBe('hi @/tmp/a.txt ')
})

it('takes the image pill out, and the space that sat after it', () => {
  const inputRef = createRef<PromptEditorInput>()
  const onSelect = vi.fn()
  render(
    <PromptEditor
      inputRef={inputRef}
      onSelect={onSelect}
      initialDocument={{ type: 'doc', content: [{ type: 'paragraph', content: [imageReferenceContent('a1', 'shot.png')] }] }}
      disabled={false}
      placeholder="Message"
    />
  )
  act(() => inputRef.current!.focus())
  onSelect.mockClear()
  act(() => inputRef.current!.removeImageReferences?.('a1'))
  // The chip is gone and the gap it left is gone with it.
  expect(inputRef.current!.value).toBe('')
  // The caret did not move: taking a chip out is not a selection change.
  expect(onSelect).not.toHaveBeenCalled()
})
```

**undo 那一条(`addToHistory: false`)没有用例**:facade 不暴露 editor 实例,测不了 `undo()`,原生 chat 那边同样没有用例 —— 这一条靠实现保证,评审读代码确认。

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/prompt-editor/PromptEditor.test.tsx --maxWorkers=2`
Expected: FAIL — "Cannot find module './PromptEditor'"

- [ ] **Step 3: Implement the five files and wire the node views**

- `prompt-editor-labels.ts`:两个 `createContext<...>(null)` + 类型。
- `PromptPill.tsx`(共用 pill 外壳):照 `NativeChatPromptPill.tsx` 的结构写一个不依赖 native chat 的版本(icon + label + `selected` 态 + `data-*` 属性)。
- `PromptFileReferencePill.tsx`:`NodeViewProps` → 读 `PromptFileLabelContext`;没有 resolver 时用默认(`basename(path)` + `getFileTypeIcon(path)`);`contentEditable={false}` 的 `NodeViewWrapper`。
- `PromptImageReferencePill.tsx`:同上,读 `PromptImageLabelContext`;没有 resolver 时 label 为附件名、`missing` 为 true(显示 `ImageOff` 图标)。
- `PromptEditor.tsx`:TipTap 装配 + facade。`insertFileReferences` / `insertImageReference` 用 `editor.commands.insertContent` 插入对应节点;`removeImageReferences` **不要**用 `withoutImageReferenceNodes` 重写整个文档 —— `setContent` 会把光标甩到文末,而且这条 transaction 会进 undo 历史,Cmd+Z 能把一个附件已经没了的 pill 复活回来。照 `NativeChatPromptEditor.tsx:362-378` 的做法:一次 `doc.descendants` 找到该 attachmentId 的图片节点,连同它后面的一个空格一起 `tr.delete`(用 mapping 保证多个 chip 时位置不错位),`tr.docChanged` 时 `dispatch(tr.setMeta('addToHistory', false))`。**JSON 规则照旧归 `withoutImageReferenceNodes`**:存草稿、删 chip 之后把相邻的文本 run 合一,还是它的事;删除发生在 ProseMirror 文档上,两者不冲突。
- `prompt-editor-nodes.ts`:给 `PromptFileReference` / `PromptImageReference` 加 `addNodeView: () => ReactNodeViewRenderer(Pill)`(原生 chat 就是这么挂的,见 `native-chat-prompt-document.ts:46,58`)。
- **两个 pill 组件不要 import `prompt-editor-nodes.ts`** —— 节点模块要 import pill 才能挂 `addNodeView`,pill 再 import 节点模块就是一个环。pill 只读节点的属性(`attrs.path` / `attrs.token` / `attrs.attachmentId` / `attrs.name`),不需要节点名。

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/prompt-editor/PromptEditor.test.tsx --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/prompt-editor/
git commit -m "feat(prompt-editor): the shared editor and its attachment pills"
```

---

### Task 7: 终端 composer 的字段与覆盖层

**Files:**

- Create: `src/renderer/src/components/terminal-pane/composer/use-terminal-composer-state.ts`
- Create: `src/renderer/src/components/terminal-pane/composer/TerminalComposerField.tsx`
- Create: `src/renderer/src/components/terminal-pane/composer/TerminalComposerOverlay.tsx`
- Create: `src/renderer/src/components/terminal-pane/composer/TerminalComposerField.test.tsx`
- Create: `src/renderer/src/components/terminal-pane/composer/TerminalComposerField.fixture.tsx`
- Modify: `src/renderer/src/components/prompt-editor/PromptEditor.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json`

**Interfaces:**

- Consumes: Task 2 的 slice;Task 4 的 intake;Task 5 的 send;Task 6 的 `PromptEditor`
- Produces:
  ```ts
  // use-terminal-composer-state.ts
  export function useTerminalComposerState(paneKey: string): {
    open: boolean
    draft: TerminalComposerDraft
    setOpen: (open: boolean) => void
    toggle: () => void
    saveDraft: (draft: TerminalComposerDraft) => void
  }

  // TerminalComposerField.tsx
  /** The seam between the field and the overlay: the editor lives in the field, the intake in the parent. */
  export type TerminalComposerFieldHandle = {
    /** The body as the editor reads it: file pills as their `@path`, image pills as their token. */
    value: () => string
    /** Lands what the intake returned: the pills go into the body, the records into the draft. */
    landAttachments: (result: TerminalComposerIntakeResult) => void
    /** Whether an upload is still on its way to the host that owns the terminal. */
    setUploading: (uploading: boolean) => void
  }
  export type TerminalComposerFieldProps = {
    paneKey: string
    disabled: boolean
    onSend: () => void
    onAttach: () => void
    onDismiss: () => void
    /** Builds the host that owns this terminal; the intake needs it to land attachments on the right machine. */
    buildHost: () => TerminalComposerIntakeHost | null
    /** Claims a paste that carries images or files; plain text falls through to the editor. */
    onPasteCapture?: (event: React.ClipboardEvent) => void
    /** Lands dropped files; the parent owns the intake. */
    onDrop: (paths: readonly string[]) => void
  }
  export function TerminalComposerField(
    props: TerminalComposerFieldProps & { ref?: React.Ref<TerminalComposerFieldHandle> }
  ): React.JSX.Element

  // TerminalComposerOverlay.tsx
  export type TerminalComposerOverlayProps = {
    paneKey: string
    paneId: number
    leafId: string
    tabId: string
    /** The pane's cwd; a folder workspace lands its drops here. */
    cwd: string | undefined
    worktreeId: string
    agent: string | null
    /** The tab's pane manager; proves the pane is still mounted before a write. */
    managerRef: React.RefObject<PaneManager | null>
    /** The tab's live transports, keyed by pane id. */
    paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  }
  export function TerminalComposerOverlay(props: TerminalComposerOverlayProps): React.JSX.Element
  ```

**Notes:**

- **`PromptEditor` 要多一个 `handleKeyDown` 出口。** 共用的编辑器现在**没有** `editorProps.handleKeyDown`,`EditorContent` 上也**没有** prop spread(`PromptEditor.tsx:27-37` / `:179-185`)。Enter / Mod+Enter / Esc 的规则必须在 **PM 的按键处理之前**拦住(PM 自己的 Enter 是 `splitBlock`,先把段落拆了再补就晚了),所以这条规则得**进** `PromptEditor`:加一个可选 prop `handleKeyDown?: (event: KeyboardEvent, editor: Editor) => boolean`,由 `PromptEditor` 接到 `editorProps.handleKeyDown` 上**先**跑;终端字段把自己的规则(Enter → `editor.commands.setHardBreak()` 再 `return true`)传进去。**paste 不走这条路** —— `onPasteCapture` 挂在字段里 `PromptEditor` **外面**那层包裹元素上就行:React 的 capture 阶段先于编辑器自己的 paste 处理,而 TipTap 的 `handlePaste` 见到 `event.defaultPrevented` 会放行不插内容(共用件已经是这个形状)。
- **`TerminalComposerDraft` 有两个同名类型。** store 那份在 `src/renderer/src/store/slices/terminal-composer/terminal-composer.ts:15`(`{ document, attachments }`);`src/shared/terminal/input/terminal-composer-draft.ts:20` 还有一份**同名但完全不同**的(`{ text, promptRow, cursorRow, endRow, promptGlyph }` —— 那是终端输入行的探测类型)。**按路径 import** store 那份。
- **`window.api.shell.pickAttachments()` 返回 `string[]`,空数组 = 用户取消**(没有别的哨兵值,见 `src/preload/api/shell-api.ts:28`):取消就当无事发生,不要弹错误。
- **提示行的 `⌘↵` 用 `ShortcutKeyCombo` + `renderKey`,别指望 `formatKeybinding`**:它把 `Enter` 格式化成字面量 `'Enter'`(`src/shared/keybindings/formatting.ts`),不产出 `↵`。`↵` 那个字形在 `ButtonKeyHint`(`src/renderer/src/components/ButtonKeyHint.tsx`)里,修饰键用 `getScreenSubmitModifierLabel()`(`src/renderer/src/lib/keyboard/screen-submit-shortcut.ts:32`)拿 `⌘` / `Ctrl`。
- **`toLocalWslDropPath` 只吃 POSIX / Windows 盘符 / WSL UNC**:非 WSL 的 UNC(`\\server\share\x`)会被它算成 `/mnt/\/erver/share/x` 这种垃圾(`src/shared/cross-platform-path.ts:5` 把任何 `\\` 开头都当成 Windows 绝对路径)。拼写前先判一下。
- **Enter 只换行。** 在 `PromptEditor` 的 `editorProps.handleKeyDown` 里:IME 组合中(`event.isComposing` 或 `event.keyCode === 229`)→ 放行;`Enter` 且无 `metaKey`/`ctrlKey` → `return true`(阻止默认),**不**插入换行? —— **要插入换行**:TipTap 的 `HardBreak` 默认只绑 `Shift+Enter` 与 `Mod-Enter`。所以这里要**手动** `editor.commands.setHardBreak()` 并返回 `true`,让 Enter 永远换行。
- **`Mod+Enter` 发送**:`(event.metaKey || event.ctrlKey) && event.key === 'Enter'` → `event.preventDefault()`,调 `onSend()`。
- **Esc 收起**:`event.key === 'Escape'` → `onDismiss()`。
- **pill 的删除**:pill 是 `atom: true` 的 inline 节点,ProseMirror 默认在光标紧贴 pill 后方时 Backspace 删掉整个 pill;**不要**自己再实现一遍。
- **pill 的三种态**:上传中(spinner + `Hourglass` 图标,取自 `NativeChatFileReferencePill` 的既有做法)、失败(`FileX` 图标 + 「需要重新添加」提示)、就绪。失败只摘掉那一个 pill,**其余附件保留**。
- **失败的 `reason` 是机器码,不是给用户看的句子。** intake 回的 `reason` 形如 `missing` / `symlink` / `permission-denied` / `unsupported`,UI 要把它翻成用户能懂的话(「文件不在了」「没有权限」……),不要把码直接甩到 toast 或 pill 上。**但词表是混的**:拷贝自己的 `skipped` 原因是码,拷贝的 `failed` 原因是原始错误消息,intake 的体积超限原因是一句完整的话。UI 要**先认码、认不出来的按原文显示**,不能假设每条 reason 都能翻译。
- **只有「没有本机路径」的粘贴图片会用临时文件名。** 一张粘贴进来的图片如果自己就有磁盘文件(比如从 Finder 复制的),它按自己的路径落地,pill 显示的就是用户自己的文件名;只有浏览器里复制出来的 blob 这种没有磁盘文件的,才会走剪贴板保存,那时 main 把它命名成 `orca-paste-<时间>-<uuid>.<扩展名>`。UI **不要**假设 pill 一定是临时文件名。
- **正文里的图片 pill 在发送时被摘掉**,由 Task 5 的写序列负责;编辑器本身不知道 agent 的存在。
- **正文(body)要去掉图片 token。** 编辑器的 `value` 里图片 pill 读成 `[Image](orca-image:<id>)`,直接当正文发出去会让 agent 收到一串机器 token。用 `splitImageReferences`(shared,`src/shared/native-chat/native-chat-image-reference.ts`)把正文拆开,**只把字符串部分拼回去**;图片本身走 Task 5 的独立路径写。**同一次拆分顺带给出图片附件的 id 顺序** —— 拆分结果里那些 `{ attachmentId }` 就是文档里图片 pill 的先后,Task 5 的 `imagePaths` 要按这个顺序(用户可以在正文里挪动 pill,附件数组的顺序不等于 pill 的顺序)。
- **正文里的 `@path` 文件引用要按目标主机改写拼写 —— 在插 pill 的时候改,不要在正文上做字符串手术。** Task 5 只安全地改写了独立的图片路径列表;正文里的文件引用是 `@path` 形式的文本,WSL 宿主上的 agent 读不了 Windows 拼写。`fileReferenceContent(path)` 的 token 是从 path 算出来的,所以只要插 pill 时传的就是 agent 看得见的路径(`toLocalWslDropPath`,与 Task 5 的 `agentVisibleImagePath` 同源、同样的 WSL 判据),正文里的 `@path` 自然是对的。store 里那份落地路径仍是 Windows 侧的原始路径。
- **写草稿时必须在写入时刻从 store 读当前草稿,不要用捕获的快照。** `setTerminalComposerDraft` 是**整份替换**(带 ProseMirror 文档)。附件的「上传中」状态是**那个还没 resolve 的 promise**,不是「`workspacePath` 为 null 的附件」——Task 4 的 intake 是先落地再返回,回来的每个 attachment 都**已经**带着落地路径。所以:在上传 resolve 之前不要写草稿;resolve 之后写,写之前读最新的 draft。
- **失败的附件没有 id。** intake 的 `failed[]` 是 `{ name, reason }`,没有 id;要给它一个 pill,UI 得自己造一个 id。
- **收起时要把编辑器整个卸掉。** 共用的 `PromptEditor` 只在挂载时用 `initialDocument` 种一次文档,facade 里**没有 `setContent`**(Ruling U:终端侧没有别的理由要它)。所以「收起 → 再展开」要拿到最新草稿,靠的是**收起时把 `PromptEditor` 卸载、展开时重新挂载**,而不是往已挂载的编辑器里灌文档。覆盖层本身可以一直挂着,字段要跟着展开态挂载。
- 提示行用 `<ShortcutKeyCombo />`;标签按平台显示 `⌘↵` / `Ctrl+↵`。
- 工具条:Paperclip ghost icon button(`Tooltip`「添加附件」)+ 发送 primary button。
- **三路来源的接线**(Task 4 的产出在这里落地,否则那一层无人使用):
  - **粘贴**:编辑器容器的 **capture 阶段** `onPasteCapture`(与 `NativeChatComposerField.tsx:348` 同法)。剪贴板里有图片/文件 → 调 `pasteTerminalComposerAttachments(host, clipboardData)` 并 `preventDefault()`(否则 ProseMirror 会把图片当二进制文本插进去);只有纯文本 → **不** preventDefault,让编辑器的 `handlePaste` 插纯文本。**事件被独占,编辑器自己的 paste handler 就不会跑,所以正文那半边得自己插**:用 `clipboardEventPromptText(event, true)`(`src/shared/native-chat/input/native-chat-clipboard-event.ts:56`)取正文 —— 它只在正文**只是那些被复制文件的标签**时返回空(macOS Finder 的情形),真正的正文原样返回 —— 再经 facade 的 `insertText` 插进正文。**两样都不能丢**(计划的 Review Focus #2):图片进 pill,正文进正文。
  - **按钮**:Paperclip → `window.api.shell.pickAttachments()` → `pickTerminalComposerAttachments(host)`。
  - **拖放**:覆盖层的 `onDragOver`(`preventDefault()` 让它成为合法 drop 目标)+ `onDrop` → `dropTerminalComposerAttachments(host, paths)`。**只有带文件的拖放才被接管**(拖放类型里有 `Files`);纯文本的拖放要留给 ProseMirror 自己处理,不然用户在 composer 里拖不动自己的文字。
- **宿主与工作区路径由覆盖层自己从 pane 的 transport 解析**,照既有终端拖放链路(`terminal-native-file-drop-destination.ts:42-67`):`captureTerminalDropTransportOwner(transport)` 给出宿主事实(运行时环境 / SSH 目标 / 连接代次 / `assertCurrent`),`resolveTerminalDropWorktreePath(worktreeId, cwd, owner.executionHostId, owner.runtimeEnvironmentId)`(`terminal-drop-worktree-path.ts:12`)给出工作区根(spec §5.2 的规矩:folder workspace 走 `cwd` 兜底)。**传输的这些事实要在 intake 发生的那一刻读**,不是渲染时抓一份快照 —— 宿主在抓取与上传之间变了,快照就是过期的。解析不出来(没有 transport / 宿主已被换掉)就**不落附件**,并告诉用户为什么。挂载时**不用**传 `connectionId` / `expectedExecutionHostId` 那一串:transport 才是事实的来源。
- **空发送什么也不写。** 正文为空且没有附件时不写任何字节(连清 TUI 输入与 Enter 都不写);发送按钮在这种状态下是 disabled 的。判据:文档里没有正文、也没有附件(pill 本身也算内容 —— 只有 `@path` 的消息是有意义的)。
- **失败的附件要说自己的理由。** intake 回的 `failed[]` 是 `{ name, reason }`,reason 可能是机器码也可能是整句;草稿里的附件记录要带上 reason(可选字段),chip 上把它翻成人话(`reason` 认码、认不出来的按原文显示)。**不能只给第一个失败弹 toast**:第二个失败的理由不能凭空消失。
- 覆盖层卡片:`absolute inset-x-0 bottom-0`,`rounded-lg`,`border`,`bg-popover`/`bg-card` token,`shadow-lg`;**不**改终端高度。
- 焦点:展开时 `inputRef.current?.focus()`;收起时把焦点还给终端(`pane.terminal.focus()`)。
- **稳定的定位钩子**:编辑器容器带 `data-terminal-composer-editor="true"`(与原生 chat 的 `data-native-chat-prompt-editor` 同法)。E2E 用它定位,**不要**用 placeholder 文案——那会绑死语言。

- [ ] **Step 1: Write the failing test**

`TerminalComposerField.test.tsx`(`// @vitest-environment happy-dom`):

```ts
function setup(overrides: Partial<TerminalComposerFieldProps> = {}) {
  const onSend = vi.fn()
  const onAttach = vi.fn()
  const onDismiss = vi.fn()
  const view = render(
    <TerminalComposerField
      paneKey="tab1:leaf1"
      disabled={false}
      onSend={onSend}
      onAttach={onAttach}
      onDismiss={onDismiss}
      {...overrides}
    />
  )
  const editor = within(view.container).getByRole('textbox')
  return { ...view, editor, onSend, onAttach, onDismiss }
}

it('turns Enter into a line break and never sends', () => {
  const { editor, onSend } = setup()
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(onSend).not.toHaveBeenCalled()
})

it('sends on Mod+Enter', () => {
  const { editor, onSend } = setup()
  fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
  expect(onSend).toHaveBeenCalledOnce()
})

it('does not send while an IME composition is open', () => {
  const { editor, onSend } = setup()
  fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 })
  expect(onSend).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/TerminalComposerField.test.tsx --maxWorkers=2`
Expected: FAIL — "Cannot find module './TerminalComposerField'"

- [ ] **Step 3: Implement the three files**

按上面的 Notes 实现。`useTerminalComposerState` 直接读写 Task 2 的 slice(`useAppStore((s) => s.terminalComposerDraftByPaneKey[paneKey] ?? EMPTY_DRAFT)`)。

- [ ] **Step 4: Add the copy to every locale**

在 `src/renderer/src/i18n/locales/` 的**每一个** `*.json` 里加同一组键(值按语言翻译,键名一致):
`terminalComposer.attach` / `terminalComposer.send` / `terminalComposer.placeholder` / `terminalComposer.open` / `terminalComposer.enterHint` / `terminalComposer.sendHint` / `terminalComposer.uploadFailed` / `terminalComposer.hostChanged` / `terminalComposer.disconnected` / `terminalComposer.paneChanged` / `terminalComposer.writeRejected`。

**发送的四个 reason 码都要有文案**:`'host-changed'` → `hostChanged`,`'pty-disconnected'` → `disconnected`,`'pane-changed'` → `paneChanged`(pane 被换掉或关掉了,消息没发出去),`'write-rejected'` → `writeRejected`(宿主拒收了这批字节)。UI 层把码翻成句子,不要把码直接甩到 toast 上。

加完跑 `pnpm verify:localization-catalogs` —— 仓库有门禁检查各语言文件的键是否一致。

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/TerminalComposerField.test.tsx --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Add a screenshot fixture for the overlay**

Create `src/renderer/src/components/terminal-pane/composer/TerminalComposerField.fixture.tsx`,导出两个 `defineFixture`:`empty`(只有提示行)与 `withAttachments`(正文里有一个文件 pill 与一个图片 pill)。
截图:`pnpm fixtures:shot terminal-pane/composer/TerminalComposerField:empty terminal-pane/composer/TerminalComposerField:withAttachments --theme both`
目视确认:卡片没有压住不该压的东西、pill 读得清、提示行显示的是本平台的 `⌘↵` 而不是 `Ctrl+↵`。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/terminal-pane/composer/ src/renderer/src/i18n/locales/
git commit -m "feat(composer): the terminal composer's field and overlay"
```

---

### Task 8: 挂载到终端面板 + 快捷键

**Files:**

- Modify: `src/shared/keybindings/types.ts`
- Modify: `src/shared/keybindings/definitions-core-4.ts`
- Modify: `src/renderer/src/components/settings/shortcuts/keybinding-title-copy.ts`
- Modify: `src/renderer/src/components/terminal-pane/input/keyboard/terminal-shortcut-policy.ts`
- Modify: `src/renderer/src/components/terminal-pane/input/keyboard/terminal-keyboard-action-dispatch.ts`
- Modify: `src/renderer/src/components/terminal-pane/input/keyboard/terminal-keyboard-hook.ts`
- Modify: `src/renderer/src/components/terminal-pane/input/keyboard/terminal-keyboard-runtime.ts`
- Modify: `src/renderer/src/components/terminal-pane/controller/use-terminal-pane-global-listeners.ts`
- Modify: `src/renderer/src/components/terminal-pane/controller/TerminalPaneSurface.tsx`
- Modify: `src/renderer/src/components/terminal-pane/layout/close/use-terminal-pane-close-actions.ts`
- Modify: `src/renderer/src/store/slices/terminal-composer/terminal-composer.ts`
- Modify: `src/renderer/src/components/terminal-pane/input/paste/terminal-agent-paste-bracketing.ts`(与 composer 共用同一份 agent 取证规则)
- Create: `src/renderer/src/components/terminal-pane/agent-status/pane-foreground-agent-type.ts`(spec §6 要求的那份共用实现)
- Create: `src/renderer/src/components/terminal-pane/composer/terminal-composer-agent.ts`
- Create: `src/renderer/src/components/terminal-pane/input/keyboard/terminal-shortcut-policy.test.ts`

**Interfaces:**

- Consumes: `keybindingMatchesAction(actionId, e, platform, keybindings)` from `src/shared/keybindings/matching`;`resolveTerminalShortcutAction(...)` from `src/renderer/src/components/terminal-pane/input/keyboard/terminal-shortcut-policy.ts`
- Produces:

  ```ts
  // terminal-shortcut-policy.ts
  export type TerminalShortcutAction = ... | { type: 'toggleComposer' }

  // terminal-composer.ts (slice)
  /** Drops one pane's draft and open flag. */
  clearTerminalComposerPane: (paneKey: string) => void
  /** Drops every draft and open flag this tab's panes owned. */
  clearTerminalComposerStateForTab: (tabId: string) => void
  ```

- [ ] **Step 1: Write the failing test**

`src/renderer/src/components/terminal-pane/input/keyboard/terminal-shortcut-policy.test.ts` —— 断言**解析结果**,不是库的行为:

```ts
import { resolveTerminalShortcutAction } from './terminal-shortcut-policy'
import type { TerminalShortcutEvent } from './terminal-shortcut-policy'

const event = (over: Partial<TerminalShortcutEvent> = {}): TerminalShortcutEvent => ({
  key: 'P',
  code: 'KeyP',
  metaKey: true,
  shiftKey: true,
  ctrlKey: false,
  altKey: false,
  ...over
})

it('resolves Mod+Shift+P to the composer toggle and nothing else', () => {
  expect(resolveTerminalShortcutAction(event(), true)).toEqual({ type: 'toggleComposer' })
  expect(resolveTerminalShortcutAction(event({ shiftKey: false }), true)).toBeNull()
})
```

`resolveTerminalShortcutAction(event, isMac)` 的其余参数都有默认值,所以这个调用是完整的。

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/terminal-pane/input/keyboard/terminal-shortcut-policy.test.ts --maxWorkers=2`
Expected: FAIL —— 还没有 `toggleComposer` 这个动作,`Mod+Shift+P` 解析不出东西(或解析成别的动作)。

- [ ] **Step 3: Register the keybinding**

- `src/shared/keybindings/types.ts`:在 `KeybindingActionId` 联合类型里加 `| 'terminal.toggleComposer'`。
- `src/shared/keybindings/definitions-core-4.ts`:加定义
  ```ts
  {
    id: 'terminal.toggleComposer',
    title: 'Toggle the terminal composer',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'terminal', 'composer', 'prompt', 'agent', 'attach', 'toggle'],
    defaultBindings: platformBindings(['Mod+Shift+P'])
  }
  ```
- `src/renderer/src/components/settings/shortcuts/keybinding-title-copy.ts`:加一条 `'terminal.toggleComposer': () => translate('keybindings.title.terminalToggleComposer', 'Toggle the terminal composer')`。
  - 这一条**必须加**:`STATIC_TITLE_COPY` 是 `satisfies Record<StaticKeybindingActionId, () => string>`(`keybinding-title-copy.ts:157`),少一个 id 就**编译不过**。
- **快捷键走终端面板已有的那条管线,不要新挂一条 `onKeyDown`。** 终端面板的按键不是 React 的 `onKeyDown`,而是 `window` 上的 capture 监听器(`src/renderer/src/components/terminal-pane/input/keyboard/terminal-keyboard-hook.ts:133`),而且**先过一道 scope 检查**(`keyboardEventBelongsToScope(e, keyboardScope)`,scope 就是 pane 的 container,`terminal-keyboard-event-handlers.ts:117`)。自己再挂一条 `onKeyDown` 的话,快捷键在**焦点根本不在终端里**的时候也会触发 —— 包括在 composer 自己的输入框里按 `Mod+Shift+P`,那会把刚展开的 composer 关掉。
  - `terminal-shortcut-policy.ts`:`TerminalShortcutAction` 联合类型里加 `| { type: 'toggleComposer' }`;在 `resolveTerminalShortcutAction` 里用和其它动作一样的 `matches('terminal.toggleComposer')` 解析(注意**顺序**:它在 `terminal.switchInputSource` / `terminal.selectAll` / `terminal.copySelection` 之后,和 `terminal.search` 那一段一样放在 `if (!event.repeat)` 里)。
  - `terminal-keyboard-action-dispatch.ts`:`ActionDispatchContext` 加 `toggleComposer: (paneId: number) => void`;处理 `action.type === 'toggleComposer'` —— `event.preventDefault()` + `event.stopImmediatePropagation()`,然后对**当前 pane**(`manager.getActivePane() ?? manager.getPanes()[0]`)调 `toggleComposer(pane.id)`。
  - 回调的链路:`use-terminal-pane-global-listeners.ts` → `terminal-keyboard-hook.ts` → `terminal-keyboard-runtime.ts`(把回调放进 dispatch 的 context)。回调本身从 controller 来:`useAppStore.getState().toggleTerminalComposer(makePaneKey(tabId, leafId))`。
  - **不要**动 `attachCustomKeyEventHandler` —— xterm 只有一个该槽位。

- [ ] **Step 4: Mount the overlay**

先加一个 agent 解析助手,规则与 `src/renderer/src/components/terminal-pane/input/paste/terminal-agent-paste-bracketing.ts:53-57` 一致(前景 agent 优先,其次是状态行里的 agentType,且跳过 `restoredUnconfirmed` 的行;两者都要过 `isTuiAgent`):

**但规则只写一份。** spec §6 明写「抽一个 `resolvePaneForegroundAgentType(...)` 供两处共用」—— paste 那侧与 composer 这侧共用同一个实现,不是各抄一份。这条规则决定 agent 类型,agent 类型决定 `agentImagePastePath(agent, path)`(图片载荷形态,全局约束里最重要的一条);两份拷贝一旦漂移,只有在真 agent 上才看得出来。所以另建一个中性模块(例如 `src/renderer/src/components/terminal-pane/agent-status/pane-foreground-agent-type.ts`)导出 `resolvePaneForegroundAgentType(foregroundAgent, entry)`,两侧都 import 它。

`src/renderer/src/components/terminal-pane/composer/terminal-composer-agent.ts`

```ts
export function resolveTerminalComposerAgentType(
  state: {
    paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
    agentStatusByPaneKey: Record<string, AgentStatusEntry>
  },
  paneKey: string
): string | null
```

`TerminalPaneSurface.tsx`:

- import `TerminalComposerOverlay` 与 `resolveTerminalComposerAgentType`。
- 在 `activePane?.container && createPortal(...)` 那一段旁边加:
  ```tsx
  {
    activePane?.container &&
      createPortal(
        <TerminalComposerOverlay
          paneKey={makePaneKey(tabId, activePane.leafId)}
          paneId={activePane.id}
          leafId={activePane.leafId}
          tabId={tabId}
          cwd={cwd}
          worktreeId={worktreeId}
          agent={resolveTerminalComposerAgentType(
            useAppStore.getState(),
            makePaneKey(tabId, activePane.leafId)
          )}
          managerRef={managerRef}
          paneTransportsRef={paneTransportsRef}
        />,
        activePane.container,
        `terminal-composer-${activePane.id}`
      )
  }
  ```
  **注意**:`activeAgentId` 虽名为 id,实际是 agent **类型**字符串(来自 `tabAgentTypeByLeaf`),可以用;但它不含「前景 vs 状态行」的取证规则,所以用上面的助手更准。
  **宿主那一串不用传**(`connectionId` / `expectedExecutionHostId` / `expectedSshTargetId` / `expectedSshConnectionGeneration`):覆盖层自己从 pane 的 transport 读(见 Task 7 的 Note),传了反而是第二份可能过期的事实。`workspacePath` 也不传 —— 它要由 `resolveTerminalDropWorktreePath` 在上传那一刻算出来(见 Task 7 的 Note),`cwd` 传过去只是 folder workspace 的兜底。
- 快捷键的接线在**上面的 Step 3** 里(terminal-shortcut-policy + action-dispatch + hook/runtime/global-listeners 四层),不在 `TerminalPaneSurface.tsx` 里 —— 那里没有按键监听器。

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/terminal-pane/input/keyboard/terminal-shortcut-policy.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Drop the composer's state with the pane**

spec §4.4 说「pane 关闭时清掉草稿」。pane 的移除有**两条**路径,两条都要覆盖:

1. **关掉一个兄弟 pane** → `use-terminal-pane-close-actions.ts` 的 `closePaneLocally`。在已有的 `dropAgentStatus(...)` / `setCacheTimerStartedAt(...)` 旁边加一句 `clearTerminalComposerPane(makePaneKey(tabId, leafId))`。
2. **关掉整个 tab(含最后一个 pane)** → `closePaneLocally` 在只剩一个 pane 时会转去 `onCloseTab(reason)` 并**提前返回**,所以第 1 条覆盖不到。tab 关掉时清**这个 tab 的所有 pane**:给 slice 加 `clearTerminalComposerStateForTab(tabId)`,在 tab 的关闭路径上调它。`onCloseTab` 在两处被接线(`TerminalOverlaySlot.tsx:91-94` 与 `TerminalLegacyTerminalPanes.tsx:98`),两处最终都汇到 `closeTerminalTab`(`src/renderer/src/components/terminal/terminal-tab-actions.ts`)—— **在那里调一次**,比在两个接线点各调一次更稳。

两个方法都要把**草稿和展开标记**一起清掉:只清草稿会留下一个 `false` 的展开标记挂在死掉的 pane 上,两条路径不对称。

**找 tab 的 pane 时用 `parsePaneKey`(在 `src/shared/workspace-layout/stable-pane-id.ts`),不要用前缀匹配** —— 前缀虽然安全(`makePaneKey` 拒绝含 `':'` 的 tabId),但 `parsePaneKey` 本来就能把 key 拆回 tabId,更准。

草稿只在内存里,但它带着一整个 ProseMirror 文档;不清就是每次关 pane 漏一份。

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm tc:web`
Expected: 0 errors

```bash
git add src/shared/keybindings/ src/renderer/src/components/terminal-pane/ src/renderer/src/store/slices/terminal-composer/
git commit -m "feat(composer): mount the composer in the terminal pane and bind its shortcut"
```

---

### Task 9: 端到端验证

**Files:**

- Create: `tests/e2e/terminal-composer-prompt.spec.ts`

**Interfaces:**

- Consumes: Task 5 的写序列;Task 7 的覆盖层;Task 8 的快捷键
- Produces: 一个证明「多行输入 + `Mod+Enter` → PTY 收到 bracketed paste 与独立的 `\r`」的 E2E

**Conventions(照抄现有 e2e,不要自己发明):**

- `import { test, expect } from './helpers/orca-app'` —— **永远不要**从 `@stablyai/playwright-test` 直接导入。
- `test.use({ launchEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })`。
- `waitForSessionReady(orcaPage)` + `ensureTerminalVisible(orcaPage)` + `waitForActiveTerminalManager(orcaPage)` 打开一个终端 tab。
- ptyId:`await orcaPage.evaluate((id) => window.__paneManagers?.get(id)?.getActivePane()?.container.dataset.ptyId, tabId)`。
- **断言写入 PTY 的字节**用 main 进程的写间谍:`installTerminalPtyWriteSpy(electronApp)` / `clearTerminalPtyWriteLog(electronApp)` / `readTerminalPtyWriteEntries(electronApp)`(从 `./helpers/terminal-pty-write-spy` 导入)。
- **`window.__store` 只用来搭场景**(开 tab、切状态),断言一律走 DOM 或写间谍。
- **用稳定的 `data-*` 选择器定位 composer**(`[data-terminal-composer-editor="true"]`),**不要**用 placeholder 文案——那会绑死语言。
- **本机是中文 locale**:仓库既有 E2E 都硬编码英文标签,跑之前先 `defaults write com.github.Electron AppleLanguages -array en`(跑完可 `defaults delete com.github.Electron AppleLanguages` 还原)。composer 自己的断言不依赖它,但同一条 spec 里若有别的英文文案断言就会中招。
- **这个间谍在每个 Electron 进程里是单例**,所以本 spec 必须 `test.describe.configure({ mode: 'serial' })`,或者用一个独一无二的 marker 字符串,避免与其它 spec 的字节串撞车。
- **展开 composer 的快捷键在终端面板自己的按键路径上**(不是 window):想打开 composer,先照 `tests/e2e/terminal-attention.spec.ts:106` 的 `focusActiveXterm` 那样把焦点交给 `.xterm-helper-textarea`,再 `orcaPage.keyboard.press('Meta+Shift+P')`。往 `window` 上派发合成事件**不会**冒泡到终端容器的处理器。

- [ ] **Step 1: Write the failing spec**

```ts
import { test, expect } from './helpers/orca-app'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'

test.describe.configure({ mode: 'serial' })

test.use({ launchEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('the terminal composer writes a multi-line prompt and then Enter', async ({
  electronApp,
  orcaPage
}) => {
  await installTerminalPtyWriteSpy(electronApp)
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)

  const tabId = await orcaPage.evaluate(() => window.__store!.getState().activeTabId)
  const ptyId = await orcaPage.evaluate(
    (id) => window.__paneManagers?.get(id)?.getActivePane()?.container.dataset.ptyId ?? null,
    tabId
  )
  expect(ptyId).toBeTruthy()

  // 展开 composer:快捷键挂在终端面板自己的按键路径上,不是 window —— 往 window 派发不会
  // 冒泡到终端容器的处理器。先按既有 E2E 的做法把焦点交给 xterm,再按 Mod+Shift+P。
  await orcaPage.evaluate((targetTabId) => {
    const pane = window.__paneManagers?.get(targetTabId)?.getActivePane?.()
    pane?.terminal.focus()
    pane?.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, tabId)
  await orcaPage.keyboard.press('Meta+Shift+P')
  const editor = orcaPage.locator('[data-terminal-composer-editor="true"]')
  await expect(editor).toBeVisible()

  // Type it: `fill` sets the DOM text directly, which ProseMirror does not always read back
  // into the document. Keystrokes are what the editor actually sees.
  await editor.click()
  await editor.type('first line')
  await editor.press('Enter')
  await editor.type('second line')

  await clearTerminalPtyWriteLog(electronApp)
  await editor.press('Meta+Enter')

  await expect
    .poll(async () =>
      (await readTerminalPtyWriteEntries(electronApp))
        .filter((entry) => entry.id === ptyId)
        .map((entry) => entry.data)
        .join('')
    )
    .toContain('\x1b[200~first line\nsecond line\x1b[201~')
  // The composer's Enter is a hard break: the body's newline serializes as a newline, not a
  // carriage return. Enter must still be a write of its own: joining the writes would match a
  // CR inside the paste above and pass even when the submit was swallowed.
  await expect
    .poll(async () =>
      (await readTerminalPtyWriteEntries(electronApp))
        .filter((entry) => entry.id === ptyId)
        .map((entry) => entry.data)
    )
    .toContain('\r')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e -- tests/e2e/terminal-composer-prompt.spec.ts`
Expected: FAIL —— composer 的覆盖层还不存在(`getByRole('textbox')` 找不到)。

**若 spec 超时等 `window.__store`**:那是 build 不是 `--mode e2e`。跑 `pnpm exec electron-vite build --mode e2e` 之后用 `SKIP_BUILD=1` 重跑,不要改 harness。

- [ ] **Step 3: Make it pass**

修实现,不改断言。

- [ ] **Step 4: Run the terminal e2e group**

Run: `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e -- tests/e2e/terminal-composer-prompt.spec.ts tests/e2e/terminal-shortcuts.spec.ts tests/e2e/terminal-paste-ownership.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/terminal-composer-prompt.spec.ts
git commit -m "test(composer): the terminal composer writes a multi-line prompt and Enter"
```

---

### Task 10: 把原生 chat 切到共用件

**Files:**

- Modify: `src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document.ts`
- Modify: `src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document-text.ts`
- Modify: `src/renderer/src/components/native-chat/composer/editor/NativeChatPromptEditor.tsx`
- Modify: `src/renderer/src/components/native-chat/composer/editor/NativeChatFileReferencePill.tsx`
- Modify: `src/renderer/src/components/native-chat/composer/editor/NativeChatImageReferencePill.tsx`
- Modify: `src/renderer/src/components/native-chat/composer/editor/NativeChatSkillPill.tsx`
- Modify: `src/renderer/src/components/native-chat/composer/editor/native-chat-agent-reference.tsx`(它也用 `NativeChatPromptPill`)
- Modify: `src/renderer/src/components/native-chat/composer/editor/native-chat-composer-image-references.ts`(它 import 了 `withoutImageReferenceNodes`)
- Modify: `src/renderer/src/components/native-chat/queue/editing/native-chat-queued-edit-draft.ts`(同上)
- Delete: `src/renderer/src/components/native-chat/composer/editor/NativeChatPromptPill.tsx`(它与共用的 `PromptPill` 逐字等价)
- Modify: `src/renderer/src/components/prompt-editor/prompt-editor-nodes.ts`
- Test: `src/renderer/src/components/native-chat/composer/editor/NativeChatPromptEditor.test.tsx`(已有,必须仍然过)
- Test: `src/renderer/src/components/native-chat/attachments/chips/native-chat-image-references.test.tsx`(已有,必须仍然过)
- Test: `src/renderer/src/components/native-chat/attachments/intake/native-chat-composer-workspace-file-drop.test.tsx`(已有,必须仍然过)

**Interfaces:**

- Consumes: Task 1 与 Task 6 的共用件
- Produces: 无新导出;原生 chat 的重复实现消失

**Notes:**

- **本 task 的「切换」范围 = 节点定义 + pill 的外壳 + 序列化规则**,原生 chat **保留自己的 `NativeChatPromptEditor`**(它带草稿库、pasted-text scope、图片编号 provider、unkerned 装饰;共用的 `PromptEditor` 刻意不带这些)。共享的 `PromptEditor` 只有终端侧在用。依据:spec §4.2「原生 chat 保留自己的扩展、草稿库、图片编号 provider、pasted-text 解析」+ §4.2 的第二步「把原生 chat 的 `fileReference` / `imageReference` 切到共用件,删掉旧的重复实现」。
- **节点类型名不变**(`nativeChatFileReference` / `nativeChatImageReference`),所以**已持久化的草稿不需要迁移** —— IndexedDB 里存的就是这两个字符串(`native-chat-prompt-document-text.ts:10-11` 与共用件 `prompt-editor-nodes.ts:8-10` 同值)。
- **原生 chat 保留自己的 pill 组件**(`NativeChatFileReferencePill` / `NativeChatImageReferencePill`):它们身上带着共用件**没有**的东西 —— 点击打开附件的按钮(`NativeChatTextAttachmentOpener`)、pasted-text 的 `saving` / `unsaved` 态、图片编号(`Image #1`)、以及 DOM 上的 `data-native-chat-file-reference` / `data-native-chat-image-reference`(仓库里**一堆测试在断言这两个属性**:`NativeChatPromptEditor.test.tsx:70`、`native-chat-image-references.test.tsx:85`、`native-chat-composer-workspace-file-drop.test.tsx:276`)。所以切换的是**节点定义**,不是节点视图。
- **节点视图怎么换**:TipTap 的 `extend` 会把 config 盖在旧 config 上(`node_modules/@tiptap/core/dist/index.js:4931-4939`),所以原生 chat 可以从共用件的节点规格派生自己的一份:
  ```ts
  export const NativeChatFileReference = PromptFileReference.extend({
    addNodeView: () => ReactNodeViewRenderer(NativeChatFileReferencePill)
  })
  ```
  节点名、attrs、renderText、renderHTML 都跟共用件一致(只有 `renderHTML` 的 `data-*` 属性名不同 —— 那只影响复制出去的 HTML,DOM 上的属性来自节点视图)。
- **pill 的外壳共用**:共用的 `PromptPill` 与 `NativeChatPromptPill` **逐字等价**(同一个 `Badge variant="promptPill"`、同一个 `data-selected`、同样的图标 + `truncate` 标签),所以原生 chat 的三个 pill(文件 / 图片 / skill)都改用 `PromptPill`,`NativeChatPromptPill.tsx` 删掉。共用件的 `PromptPillProps` 带 `data-${string}` 索引签名,原生 chat 的 `data-native-chat-*` 属性照样传得进去。
- **`withoutImageReferenceNodes` 要多一个显式的空格规则参数**(Ruling I):`stripFollowingSpace?: boolean`,默认 `false` = **保留** chip 周围的空格(终端侧要的);**原生 chat 传 `true`** —— 它的规则是「每颗 chip 跟着一个空格」,去掉 chip 时那个空格也去掉。这是两边**真实**的插入约定差异,不是一个 bug,所以做成参数而不是两份实现。
- native chat 的 `promptLeafString` 保留自己的 `nativeChatAgentReference` 分支,其余委托给共用的 `promptLeafString` —— 那个分支是原生 chat 专属的(`nativeChatAgentReference` 节点只有它有),其余规则(file / image / hardBreak)必须**只有一份**,否则 agent 收到的字面量会漂移(spec §4.2:「复制一份必然漂移」)。连带地,原生 chat 的 `promptText` / `promptLeafText` 保留本地那两行(它们要用本地那个 leaf 函数)。
- native chat 的 `promptTextContent`(会切 pasted-text token 与图片引用)**保持原样**——那是 native chat 专属,终端侧用共用的纯文本版本。

- [ ] **Step 1: Switch the nodes and the pill shell**

把原生 chat 的三个文件改成从 `@/components/prompt-editor/…` 导入:节点用 `PromptFileReference.extend({ addNodeView: … })` / `PromptImageReference.extend({ addNodeView: … })` 派生(节点视图是原生 chat 自己的 pill,DOM 上的 `data-native-chat-*` 属性不受影响),pill 外壳统一用 `PromptPill`(`NativeChatPromptPill.tsx` 删除)。共用件的 `withoutImageReferenceNodes` 加上 `stripFollowingSpace?: boolean` 参数,原生 chat 的调用点传 `true`。

`NativeChatPromptEditor.test.tsx` 里的 `[data-native-chat-file-reference]` 断言**不许改**:它们钉住的是原生 chat 的 DOM 契约,切换之后必须原样通过。

- [ ] **Step 2: Run the native chat tests**

Run: `pnpm test src/renderer/src/components/native-chat --maxWorkers=2`
Expected: PASS(全部绿;任何红的都要先判断是不是**基线就红** —— 用 `git stash` 在 `origin/main` 上复跑同一条命令对比)

- [ ] **Step 3: Typecheck**

Run: `pnpm tc:web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/native-chat/
git commit -m "refactor(native-chat): use the shared prompt editor pieces"
```

---

## 收尾

- [ ] **Step 1: 跑完整的改动门禁**

```bash
pnpm check:changed
```

若因**基线就存在**的失败而红,与 `origin/main` 对比确认后记录,不修无关项。

- [ ] **Step 2: 五个 typecheck 全过**

```bash
pnpm tc
```

- [ ] **Step 3: 提交收尾**

```bash
git status --short
git commit -m "chore(composer): the terminal composer feature"
```
