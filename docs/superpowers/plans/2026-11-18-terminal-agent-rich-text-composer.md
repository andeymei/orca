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
- **发送写序列固定为四步**:清 TUI 输入 → 每个图片路径一次独立 bracketed paste → 正文一次写 → **Enter 单独一次延迟写**(`\r`)。Enter 与 paste 同一次写会被 TUI 吞掉。
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
- **DOM 测试环境**:`// @vitest-environment happy-dom` 放在**第二行**(第一个 import 之后)—— 仓库的既有写法。`render` 直接来自 `@testing-library/react`,没有 `renderWithProviders` 这类包装。
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

| 路径                                                                                          | 改动                                                        |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/renderer/src/store/index.ts`                                                             | 注册 `createTerminalComposerSlice`                          |
| `src/renderer/src/store/testing/app-store-test-fixture.ts`                                    | 注册 `createTerminalComposerSlice`(漏了单测就红)            |
| `src/renderer/src/store/types.ts`                                                             | `AppState` 加上 `TerminalComposerSlice`                     |
| `src/shared/keybindings/types.ts`                                                             | `KeybindingActionId` 联合类型加 `'terminal.toggleComposer'` |
| `src/shared/keybindings/definitions-core-4.ts`                                                | 新增 `terminal.toggleComposer` 定义                         |
| `src/renderer/src/components/settings/shortcuts/keybinding-title-copy.ts`                     | 新增该 action 的标题文案                                    |
| `src/renderer/src/components/terminal-pane/controller/TerminalPaneSurface.tsx`                | 把 composer 覆盖层 portal 进 `activePane.container`         |
| `src/renderer/src/components/terminal-pane/input/file-drop/terminal-native-file-drop.ts`      | 抽出「解析路径」与「写进 PTY」两步,composer 复用前一步      |
| `src/renderer/src/i18n/locales/*.json`                                                        | 新增文案                                                    |
| `src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document.ts`      | Task 10:改用共用节点                                        |
| `src/renderer/src/components/native-chat/composer/editor/native-chat-prompt-document-text.ts` | Task 10:委托给共用的 `promptLeafString`                     |
| `src/renderer/src/components/native-chat/composer/editor/NativeChatPromptEditor.tsx`          | Task 10:改用共用件                                          |
| `src/renderer/src/components/native-chat/composer/editor/NativeChatFileReferencePill.tsx`     | Task 10:用 `PromptFileLabelContext` 保留 pasted-text 态     |
| `src/renderer/src/components/native-chat/composer/editor/NativeChatImageReferencePill.tsx`    | Task 10:用 `PromptImageLabelContext` 保留编号               |

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
  imageReferenceContent,
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

  it('removes an image pill and the space that followed it', () => {
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
- Modify: `src/renderer/src/components/terminal-pane/input/file-drop/terminal-native-file-drop.ts`

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
    expectedExecutionHostId?: ExecutionHostId
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
  5. 若 `copied.length > 0` 且不是 runtime 路径(`!request.runtimeEnvironmentId`),best-effort 写 `.gitignore`。
- 整个函数**不吞异常**:`assertCurrent` 抛出的错误要往上抛(调用方转成「宿主已改变,请重试」);单个文件的失败已经在 `results` 里,不要额外抛。

- [ ] **Step 4: Split the drop flow so both callers share the resolve step**

`src/renderer/src/components/terminal-pane/input/file-drop/terminal-native-file-drop.ts`:
把 `uploadRuntimeDropPaths` / `pasteLocalDropPaths` / `uploadRemoteDropPaths` 里「算出 `resolvedPaths`」的部分抽成一个导出的纯函数 `resolveNativeDropPaths(args): Promise<ResolveDroppedPathsResult>`,三个分支各自调用它,再把结果交给 `pasteResolvedDropPaths`。
**本次改动只做「抽出来」,不改任何现有行为** —— 拖放的用户可见行为必须完全不变。

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/attachments/terminal-composer-workspace-copy.test.ts --maxWorkers=2` && `pnpm test src/renderer/src/components/terminal-pane/input/file-drop --maxWorkers=2`
Expected: PASS(两个都过;拖放那组证明重构没改行为)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/terminal-pane/composer/attachments/ src/renderer/src/components/terminal-pane/input/file-drop/terminal-native-file-drop.ts
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
  - `window.api.ui.saveClipboardImageAsTempFile({ connectionId?, runtimeEnvironmentId? }): Promise<string | null>`
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
    expectedExecutionHostId?: ExecutionHostId
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
  1. 先看 `clipboardData.files` 里有没有图片(`file.type.startsWith('image/')`)。有 → `window.api.ui.saveClipboardImageAsTempFile({ connectionId, runtimeEnvironmentId })` 拿到**目标宿主上**的临时路径,把它当成一个 source path。
  2. 非图片的 `files` 直接当 source path。
  3. `clipboardData.items` 里的 `text/plain` **不进附件** —— 它是正文文本,由编辑器自己的 paste handler 处理(见 Task 7)。本函数只负责附件。
  4. 调 `landAttachments`。
- `dropTerminalComposerAttachments`:`droppedPaths` → `landAttachments`。
- `landAttachments`:调 `copyTerminalComposerAttachmentsToWorkspace`,把 `copied` 变成 `TerminalComposerAttachment[]`(`id` 用 `crypto.randomUUID()`;`name` 用 `basename(workspacePath)`;`isImage` 按源文件扩展名判定,用 `isImageDropPath(path)`);把 `failed` 变成 `failed[]`。
- 体积上限按 `AGENT_SESSION_ATTACHMENT_MAX_BYTES`(50 MiB)判定;超限的文件**不进上传**,直接进 `failed`,reason 写明上限。

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

**Interfaces:**

- Consumes:
  - `AGENT_TUI_CLEAR_INPUT_MAX` from `src/shared/agent-launch/startup/agent-tui-input-clear`
  - `buildNativeChatPasteBytes(text)`, `buildNativeChatImagePasteBytes(filePath)`, `NATIVE_CHAT_SUBMIT`, `NATIVE_CHAT_SUBMIT_DELAY_MS` from `src/shared/native-chat/input/native-chat-paste-bytes`
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
    reason?: 'pane-changed' | 'write-rejected' | 'pty-disconnected'
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
    expect(writes[1].data).toBe(wrapTerminalBracketedPasteText('/ws/.orca/drops/shot.png'))
    expect(writes[2].data).toBe(buildNativeChatPasteBytes('look at this'))
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

  it('writes Enter separately even with no attachments', () => {
    const writes = buildTerminalComposerWrites({ body: 'hello', imagePaths: [], agent: 'claude' })
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
  const writes: TerminalComposerWrite[] = [{ data: AGENT_TUI_CLEAR_INPUT_MAX, delayBeforeMs: 0 }]
  const framed = agentImagePasteWrites(
    agent,
    imagePaths.map((path) => buildNativeChatImagePasteBytes(agentImagePastePath(agent, path))),
    body.length > 0
  )
  for (const data of framed) {
    writes.push({ data, delayBeforeMs: 0 })
  }
  writes.push({ data: buildNativeChatPasteBytes(body), delayBeforeMs: 0 })
  writes.push({ data: NATIVE_CHAT_SUBMIT, delayBeforeMs: NATIVE_CHAT_SUBMIT_DELAY_MS })
  return writes
}
```

- [ ] **Step 4: Implement `useTerminalComposerSend`**

- **transport 的取法照抄拖放**:`captureTerminalDropTarget(pane, transport)` 在发送前捕获身份,之后每次写之前用 `getCurrentTerminalDropTransport(manager, paneTransports, target)` 复核。`managerRef` 与 `paneTransportsRef` 由 `TerminalPaneSurface` 的 controller 提供,**通过 props 传进来**,不要去 store 里找(它们不是 store 状态)。
- 复核失败 → `{ sent: false, reason: 'pane-changed' }`,**不写**。
- 按 `delayBeforeMs` 串行写:用 `setTimeout` 链,第一次 `delayBeforeMs` 为 0 时立即写。
- `transport.sendInput(write.data, 'driving')` 返回 false → `{ sent: false, reason: 'write-rejected' }`。
- transport 不存在 → `{ sent: false, reason: 'pty-disconnected' }`。

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
- Create: `src/renderer/src/components/prompt-editor/PromptFileReferencePill.tsx`
- Create: `src/renderer/src/components/prompt-editor/PromptImageReferencePill.tsx`
- Create: `src/renderer/src/components/prompt-editor/PromptEditor.tsx`
- Create: `src/renderer/src/components/prompt-editor/PromptEditor.test.tsx`

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
  export type PromptEditorInput = Pick<
    HTMLTextAreaElement,
    'value' | 'selectionStart' | 'selectionEnd' | 'disabled' | 'focus' | 'select' | 'setSelectionRange'
  > & {
    insertText?: (text: string) => void
    insertFileReferences?: (paths: readonly string[]) => void
    insertImageReference?: (attachmentId: string, name: string) => void
    removeImageReferences?: (attachmentId: string) => void
    stagePastedText?: (token: string) => void
  }
  export type PromptEditorProps = {
    inputRef: React.RefObject<PromptEditorInput | null>
    initialDocument: JSONContent
    disabled: boolean
    placeholder: string
    onChange?: (input: PromptEditorInput) => void
    onSelect?: (input: PromptEditorInput) => void
    className?: string
  }
  export const PromptEditor: React.FC<PromptEditorProps>
  ```

**Notes:**

- `PromptEditor` 的 TipTap 装配照抄 `NativeChatPromptEditor` 的 `useEditor` 配置:`StarterKit.configure({ blockquote:false, bold:false, bulletList:false, code:false, codeBlock:false, dropcursor:false, gapcursor:false, heading:false, horizontalRule:false, italic:false, link:false, listItem:false, orderedList:false, strike:false, underline:false, trailingNode:false })` + `HardBreak` + `Placeholder` + `PromptFileReference` + `PromptImageReference`。
- **不要**带 native chat 的草稿库、pasted-text scope、图片编号 provider、unkerned 装饰。
- `handlePaste` 只插纯文本(与 native chat 一致)。
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
  act(() => inputRef.current!.insertFileReferences?.(['/tmp/a.txt']))
  expect(inputRef.current!.value).toContain('@/tmp/a.txt')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/prompt-editor/PromptEditor.test.tsx --maxWorkers=2`
Expected: FAIL — "Cannot find module './PromptEditor'"

- [ ] **Step 3: Implement the four files**

- `prompt-editor-labels.ts`:两个 `createContext<...>(null)` + 类型。
- `PromptPill.tsx`(共用 pill 外壳):照 `NativeChatPromptPill.tsx` 的结构写一个不依赖 native chat 的版本(icon + label + `selected` 态 + `data-*` 属性)。
- `PromptFileReferencePill.tsx`:`NodeViewProps` → 读 `PromptFileLabelContext`;没有 resolver 时用默认(`basename(path)` + `getFileTypeIcon(path)`);`contentEditable={false}` 的 `NodeViewWrapper`。
- `PromptImageReferencePill.tsx`:同上,读 `PromptImageLabelContext`;没有 resolver 时 label 为附件名、`missing` 为 true(显示 `ImageOff` 图标)。
- `PromptEditor.tsx`:TipTap 装配 + facade。`insertFileReferences` / `insertImageReference` 用 `editor.commands.insertContent` 插入对应节点;`removeImageReferences` 用 `withoutImageReferenceNodes` 重写文档。

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
  export type TerminalComposerFieldProps = {
    paneKey: string
    disabled: boolean
    onSend: () => void
    onAttach: () => void
    onDismiss: () => void
  }
  export const TerminalComposerField: React.FC<TerminalComposerFieldProps>

  // TerminalComposerOverlay.tsx
  export type TerminalComposerOverlayProps = {
    paneKey: string
    paneId: number
    leafId: string
    tabId: string
    workspacePath: string
    worktreeId: string
    runtimeEnvironmentId?: string | null
    connectionId?: string | null
    expectedExecutionHostId?: ExecutionHostId
    expectedSshTargetId?: string
    expectedSshConnectionGeneration?: number
    agent: string | null
    /** The tab's pane manager; proves the pane is still mounted before a write. */
    managerRef: React.RefObject<PaneManager | null>
    /** The tab's live transports, keyed by pane id. */
    paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  }
  export const TerminalComposerOverlay: React.FC<TerminalComposerOverlayProps>
  ```

**Notes:**

- **Enter 只换行。** 在 `PromptEditor` 的 `editorProps.handleKeyDown` 里:IME 组合中(`event.isComposing` 或 `event.keyCode === 229`)→ 放行;`Enter` 且无 `metaKey`/`ctrlKey` → `return true`(阻止默认),**不**插入换行? —— **要插入换行**:TipTap 的 `HardBreak` 默认只绑 `Shift+Enter` 与 `Mod-Enter`。所以这里要**手动** `editor.commands.setHardBreak()` 并返回 `true`,让 Enter 永远换行。
- **`Mod+Enter` 发送**:`(event.metaKey || event.ctrlKey) && event.key === 'Enter'` → `event.preventDefault()`,调 `onSend()`。
- **Esc 收起**:`event.key === 'Escape'` → `onDismiss()`。
- **pill 的删除**:pill 是 `atom: true` 的 inline 节点,ProseMirror 默认在光标紧贴 pill 后方时 Backspace 删掉整个 pill;**不要**自己再实现一遍。
- **pill 的三种态**:上传中(spinner + `Hourglass` 图标,取自 `NativeChatFileReferencePill` 的既有做法)、失败(`FileX` 图标 + 「需要重新添加」提示)、就绪。失败只摘掉那一个 pill,**其余附件保留**。
- **正文里的图片 pill 在发送时被摘掉**,由 Task 5 的写序列负责;编辑器本身不知道 agent 的存在。
- 提示行用 `<ShortcutKeyCombo />`;标签按平台显示 `⌘↵` / `Ctrl+↵`。
- 工具条:Paperclip ghost icon button(`Tooltip`「添加附件」)+ 发送 primary button。
- 覆盖层卡片:`absolute inset-x-0 bottom-0`,`rounded-lg`,`border`,`bg-popover`/`bg-card` token,`shadow-lg`;**不**改终端高度。
- 焦点:展开时 `inputRef.current?.focus()`;收起时把焦点还给终端(`pane.terminal.focus()`)。

- [ ] **Step 1: Write the failing test**

`TerminalComposerField.test.tsx`(`// @vitest-environment happy-dom`):

```ts
it('turns Enter into a line break and never sends', () => {
  const onSend = vi.fn()
  const inputRef = createRef<PromptEditorInput>()
  render(<PromptEditor ... />)   // 或直接测字段
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(onSend).not.toHaveBeenCalled()
})

it('sends on Mod+Enter', () => {
  const onSend = vi.fn()
  fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
  expect(onSend).toHaveBeenCalledOnce()
})

it('does not send while an IME composition is open', () => {
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
`terminalComposer.attach` / `terminalComposer.send` / `terminalComposer.placeholder` / `terminalComposer.open` / `terminalComposer.enterHint` / `terminalComposer.sendHint` / `terminalComposer.uploadFailed` / `terminalComposer.hostChanged` / `terminalComposer.disconnected`。

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
- Modify: `src/renderer/src/components/terminal-pane/controller/TerminalPaneSurface.tsx`
- Create: `src/renderer/src/components/terminal-pane/composer/TerminalComposerShortcut.ts`
- Create: `src/renderer/src/components/terminal-pane/composer/TerminalComposerShortcut.test.ts`
- Create: `src/renderer/src/components/terminal-pane/composer/terminal-composer-agent.ts`

**Interfaces:**

- Consumes: `keybindingMatchesAction(actionId, e, platform, keybindings)` from `src/shared/keybindings/matching`
- Produces:

  ```ts
  // TerminalComposerShortcut.ts
  export function matchesTerminalComposerToggleShortcut(
    e: KeybindingInput,
    platform: NodeJS.Platform,
    keybindings?: KeybindingOverrides
  ): boolean
  ```

- [ ] **Step 1: Write the failing test**

```ts
it('matches Mod+Shift+P and nothing else', () => {
  expect(
    matchesTerminalComposerToggleShortcut(
      { key: 'P', code: 'KeyP', metaKey: true, shiftKey: true },
      'darwin',
      {}
    )
  ).toBe(true)
  expect(
    matchesTerminalComposerToggleShortcut({ key: 'P', code: 'KeyP', metaKey: true }, 'darwin', {})
  ).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/TerminalComposerShortcut.test.ts --maxWorkers=2`
Expected: FAIL — "Cannot find module './TerminalComposerShortcut'"

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
- `TerminalComposerShortcut.ts`:照 `native-chat-shortcut.ts` 的写法实现 `matchesTerminalComposerToggleShortcut`。

- [ ] **Step 4: Mount the overlay**

先加一个 agent 解析助手,规则与 `terminal-agent-paste-bracketing.ts` 一致(前景 agent 优先,其次是状态行里的 agentType,且跳过 `restoredUnconfirmed` 的行):

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
          workspacePath={cwd ?? ''}
          worktreeId={worktreeId}
          runtimeEnvironmentId={activePaneRuntimeEnvironmentId ?? null}
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
- 在终端面板的 `onKeyDown` 路径上接快捷键:命中 `matchesTerminalComposerToggleShortcut` 时 `preventDefault()` 并 `toggleTerminalComposer(paneKey)`。**不要**动 `attachCustomKeyEventHandler` —— xterm 只有一个该槽位。

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/renderer/src/components/terminal-pane/composer/TerminalComposerShortcut.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm tc:web`
Expected: 0 errors

```bash
git add src/shared/keybindings/ src/renderer/src/components/terminal-pane/
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
- **这个间谍在每个 Electron 进程里是单例**,所以本 spec 必须 `test.describe.configure({ mode: 'serial' })`,或者用一个独一无二的 marker 字符串,避免与其它 spec 的字节串撞车。

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

  // 展开 composer
  await orcaPage.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'P',
        code: 'KeyP',
        metaKey: true,
        shiftKey: true,
        bubbles: true
      })
    )
  )
  const editor = orcaPage.getByRole('textbox', { name: /message/i })
  await expect(editor).toBeVisible()

  await editor.fill('first line')
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
    .toContain('\x1b[200~first line\rsecond line\x1b[201~')
  await expect
    .poll(async () =>
      (await readTerminalPtyWriteEntries(electronApp))
        .filter((entry) => entry.id === ptyId)
        .map((entry) => entry.data)
        .join('')
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
- Test: `src/renderer/src/components/native-chat/composer/editor/NativeChatPromptEditor.test.tsx`(已有,必须仍然过)

**Interfaces:**

- Consumes: Task 1 与 Task 6 的共用件
- Produces: 无新导出;原生 chat 的重复实现消失

**Notes:**

- **节点类型名不变**(`nativeChatFileReference` / `nativeChatImageReference`),所以**已持久化的草稿不需要迁移**。
- native chat 的 `promptLeafString` 保留自己的 `nativeChatAgentReference` 分支,其余委托给共用的 `promptLeafString`。
- native chat 的文件 pill 要保留**pasted-text** 的 `saving` / `unsaved` 态:用 `PromptFileLabelContext` 注入一个 resolver,而不是把 pasted-text 逻辑搬进共用件。
- native chat 的图片 pill 要保留**编号**(`Image #1`)与 `Image removed`:同样用 `PromptImageLabelContext` 注入 resolver。
- native chat 的 `promptTextContent`(会切 pasted-text token 与图片引用)**保持原样**——那是 native chat 专属,终端侧用共用的纯文本版本。

- [ ] **Step 1: Switch the imports**

把 native chat 的三个文件改成从 `@/components/prompt-editor/…` 导入节点与 pill,删掉重复的节点定义。

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
