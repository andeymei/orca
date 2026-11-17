# Next Edit Suggestion — 设计稿

日期：2026-11-17
状态：待实现
参考：[Qoder NEXT 文档](https://docs.qoder.cn/user-guide/next-edit-suggestion)、[Qoder NEXT 性能优化揭秘](https://qoder.com/zh/blog/qoder-next)

## 1. 背景与目标

Orca 已有「注释驱动 AI 编辑」（`// @ai` → gutter 派发 → agent 改文件，见
`docs/superpowers/specs/2026-11-14-comment-driven-agent-code-generation-design.md`）。
那条链路是**分钟级、事件驱动**的：用户写一条注释、点一下 gutter、把 prompt 交给一个已经在跑的
agent，然后监听 agent 的**状态**。

本设计补上另一条链路：**按键级、连续**的——用户在写代码的过程中，编辑器在光标处给出代码建议，
按 Tab 接受。

目标（对齐 Qoder NEXT）：

1. 光标处给出多行内联建议（ghost text），`Tab` 接受、`Esc` 拒绝、逐字部分接受。
2. 预测**下一个编辑位置**：同文件多处、跨文件；行号槽打标记，`Tab` 可跳转到下一处。
3. 支持新增 / 修改 / 删除三类编辑，并按类型展示 Diff。
4. 自动补依赖导入。
5. `⌥` / `Alt` 按住预览修改，松开还原。
6. 设置：总开关、按扩展名开关、自动导入开关、模型与端点配置。

### 非目标

- 不训练 next-edit 专用模型。用通用 LLM + 严格 JSON 协议逼近 Qoder 的效果。
- 不做 Copilot 式全量符号补全——Monaco 自带 TypeScript 智能感知。
- 不做 Qoder 的「评论块触发」场景（那是 Qoder 自家评论功能的联动，Orca 的 `@ai` 是另一套东西）。
- 不嵌入 Qoder 的 VS Code 插件（理由见 §11）。
- 不做 Cursor 式的「下一句话」预测。

## 2. 关键决策

| 决策       | 选择                                                               | 理由                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发形态   | 光标处单点内联补全 + 多位置预测                                    | 通用 LLM 做「下一步改哪」的推断质量有限；但把协议设计成 `EditPlan`，质量差的代价可控                                                                                |
| 协议       | 严格 JSON 的 Edit Plan（位置 + 原文 + 意图）                       | 多位置预测必须结构化；纯文本撑不住「改哪/怎么改/为什么」                                                                                                            |
| 定位方式   | 行号区间 + `originalText` 双重校验                                 | 模型给的行号会因上下文截断偏移；原文对不上就**丢弃这一条**，宁可少一条不可插错地方                                                                                  |
| 编辑器渲染 | 光标处吃 Monaco 内置 inline completions；其余位置自研              | 内置白嫖 ghost text、逐字部分接受、内置 debounce/取消；单位置以外的自己做                                                                                           |
| 键位接管   | capture 阶段 DOM keydown（仓库既有风格）                           | 仓库里 `KeyCode.Tab` 零命中、Monaco 默认 keymap 未改；`editor-shortcuts.ts` 已是这个形状                                                                            |
| 模型接入   | 直连 HTTP，**Anthropic Messages + OpenAI Chat Completions 双协议** | 与 Qoder CN 的 BYOK 体验一致，用户零学习成本迁移；两家协议覆盖了国内绝大多数端点                                                                                    |
| 第三端点   | 额外支持 **OpenAI Completions（`/v1/completions`，FIM）**          | FIM 才是「补全」的原生协议（vLLM / SGLang / Ollama / llama.cpp 都暴露它），CodeGeeX4 的补全就走这个。但 FIM **只能驱动单点补全**，多位置预测不可用 → 降级档（§6.2） |
| 多文件格式 | prompt 里用 `###PATH:` 分隔各文件内容                              | 抄 CodeGeeX4 的仓库级上下文格式：强制模型基于真实代码作答，比 JSON 数组省 token 且贴合训练分布                                                                      |
| 缓存       | 30s TTL、每文件 10 条上限、LRU                                     | 照抄 Qoder 公开的参数（约 23% 命中，首 Action <10ms）                                                                                                               |
| 传输       | 流式优先，光标处建议先出                                           | Qoder 公开博客说感知延迟 1200ms→300ms 靠的是流式 + 就近 + 缓存，不是模型能力                                                                                        |
| 后端可插拔 | `NesBackend` 接口                                                  | 将来 Qoder 若开放补全 API，或接本地 FIM 模型，只换实现，上层 UI 不动                                                                                                |

### 已否决的方案

- **嵌入 Qoder 的 VS Code 插件**：见 §11。技术上属于平台工程，且插件操作的是自己那份文档模型。
- **复用 `claude -p` / `qodercli -p` 一次性 CLI 当补全后端**：延迟 1–3s，每次一个完整 agent turn 的
  token，而且 CLI 是 agentic 工具不是 FIM 引擎，提示它「预测下一个编辑位置」效果远不如专门协议。
- **常驻 `claude --input-format stream-json` 进程**：省掉冷启，但延迟仍在 1–2s 量级，且 token 成本
  问题依然存在。补全是高频无状态调用，agent CLI 的形状恰好相反。
- **直接复用 `@ai` 的派发链路**：那条链路不流式回传内容，只监听 agent 状态，两者正交。
- **API key 存进 `GlobalSettings`**：全局设置是明文 JSON 落盘。key 走加密文件存储
  （`createEncryptedApiKeyFileStore`），且**不经过渲染进程**。

## 3. 术语

| 术语      | 含义                                                   |
| --------- | ------------------------------------------------------ |
| Edit Plan | 一次请求返回的完整修改清单，含若干条 edit              |
| Edit      | 一条修改：文件、位置、类型、新文本、原文、意图标签     |
| 锚点位置  | 光标处的那条 edit（primary），渲染成 inline ghost text |
| 远端位置  | 其余 edit，在行号槽打标记，可跳转                      |

## 4. 端到端数据流

```
打字 / 移光标 ──> ────────────────────────────────┐
                                                  ▼
                    ┌───────────────────────────────────────────┐
                    │ 触发器                                     │
                    │ · idle 去抖（默认 500ms，可配）              │
                    │ · 单飞：同一编辑器同一时刻只允许一个请求在飞     │
                    │ · 新输入立即取消在飞请求（AbortSignal）         │
                    └────────────────────┬──────────────────────┘
                                         ▼
                    ┌───────────────────────────────────────────┐
                    │ 上下文构造                                   │
                    │ · 当前文件 prefix/suffix（带光标标记）         │
                    │ · 相关文件（import 图 + 光标符号引用）         │
                    │ · 最近接受过的编辑（短期记忆）                  │
                    └────────────────────┬──────────────────────┘
                                         ▼  runtime RPC: codeCompletion.plan
                    ┌───────────────────────────────────────────┐
                    │ 主进程 code-completion 服务                 │
                    │ · 缓存命中 → 直接返回                        │
                    │ · 未命中 → HTTP → Anthropic / OpenAI 兼容端点 │
                    │ · 超时 · 并发上限 · 输出上限                  │
                    │ · 用量记账                                  │
                    └────────────────────┬──────────────────────┘
                                         ▼  EditPlan JSON
                    ┌───────────────────────────────────────────┐
                    │ 渲染层 NES 状态                             │
                    │ · 锚点位置 → Monaco 内置 inline ghost text    │
                    │ · 远端位置 → 行号槽标记 + 跳转列表             │
                    └───────────────────────────────────────────┘
```

**缓存命中路径**是同步的，不经过网络。

## 5. 模型契约：Edit Plan

### 5.1 响应结构

模型必须返回严格 JSON（system prompt 约束 + zod 校验）：

```jsonc
{
  "edits": [
    {
      "id": "e1",
      "path": "src/foo.ts",
      "kind": "insert" | "replace" | "delete",
      "range": { "startLine": 42, "startColumn": 1, "endLine": 42, "endColumn": 1 },
      "originalText": "…", // replace / delete 的原文；insert 为空串
      "text": "…", // insert / replace 的新文本；delete 为空串
      "label": "补上错误分支" // 人类可读意图，UI 上展示
    }
  ]
}
```

### 5.2 约束

写进 system prompt，并且用 zod 二次校验：

- `edits.length ≤ 5`
- 只允许修改上下文里出现过的 `path`
- `replace` / `delete` 的 `originalText` 必须与 `range` 覆盖的内容逐字一致
- 同一个文件最多 2 处编辑
- 不带 markdown 围栏；解析失败按「无建议」处理，不报错给用户
- **每个文件的行号各自从 1 开始**（`###PATH:` 头之后的那一行是该文件的第 1 行）；后端按每个文件展示时的起始行号换算成绝对行号（见 §5.5）

### 5.5 行号与截断

prefix 会从行边界截断以适配 token 预算（§7.1），所以**模型看到的文件不是从第 1 行开始的**。若模型返回绝对行号，它要么算错，要么在截断处算错——而 `replace` / `delete` 还有 `originalText` 兜底（对不上就丢弃），**`insert` 没有**：自动补 import 这类 insert 会插进错误的行。

所以契约规定：

- 请求带上每个文件展示时的**起始行号**（当前文件是 `prefixStartLine`，每个相关文件是自己的 `startLine`），以及光标的**绝对行列**（`cursorLine` / `cursorColumn`）。
- prompt 告诉模型：**每个文件的行号各自从 1 开始**（`###PATH:` 头之后的那一行是该文件的第 1 行），不要跨文件连续计数。
- **后端**在返回计划前把行号换算成绝对行号，渲染层拿到的永远是绝对坐标。

换算由代码做，不由模型做——模型只要照抄它看到的行号。

### 5.3 校验失败的处理

| 失败点                                     | 处理                              |
| ------------------------------------------ | --------------------------------- |
| JSON 解析失败                              | 整份丢弃，安静返回「无建议」      |
| `edits` 超过 5 条                          | 截断到前 5 条（按模型给出的顺序） |
| `path` 不在上下文里                        | 丢弃这一条                        |
| `originalText` 与 range 不符               | 丢弃这一条                        |
| `kind` 与 `text`/`originalText` 组合不合法 | 丢弃这一条                        |

**丢弃而不是修复**：模型给的行号不可信时，猜一个位置写进去比不写更糟。

### 5.4 应用前的最终校验

应用 edit 到 buffer 前再校验一次 `originalText`（模型返回之后用户可能又改了文件）。
不符则丢弃该条并清掉对应的位置标记。位置标记的清理必须同时处理：

- 该位置的 ghost text
- 该位置的行号槽标记
- 跳转列表里的条目

## 6. 模型接入层

### 6.1 三种端点

| 端点                     | 协议             | 请求体形态                                          | 响应解析                       | 能做什么       |
| ------------------------ | ---------------- | --------------------------------------------------- | ------------------------------ | -------------- |
| Anthropic Messages       | Anthropic        | `{model, max_tokens, system, messages, stream}`     | SSE `content_block_delta`      | 完整 Edit Plan |
| OpenAI Chat Completions  | OpenAI 兼容 chat | `{model, max_tokens, messages, stream}`             | SSE `choices[0].delta.content` | 完整 Edit Plan |
| OpenAI Completions (FIM) | OpenAI 兼容 FIM  | `{model, max_tokens, prompt, stream}`（前后缀拼接） | SSE `choices[0].text`          | **仅单点补全** |

三种都支持流式。baseUrl 的拼接规则由**协议下拉框**决定（`/v1/messages` / `/chat/completions` /
`/completions`）。OpenAI 兼容端点的 `baseUrl` 通常要带 `/v1`，Anthropic 兼容端点通常不带。

**FIM 端点是降级档**：FIM 的语义是「给前缀、补出中间」，没有表达「预测下一个编辑位置」的能力。
选 FIM 端点时，多位置预测自动关闭——UI 不显示位置标记，Edit Plan 只保留光标处那一条。

### 6.2 后端接口

```ts
export type NesBackend = {
  /** 端点标识，用于设置项与遥测。 */
  readonly id: 'anthropic-messages' | 'openai-chat' | 'openai-completions-fim'
  /** 能否产出多位置编辑计划。FIM 端点为 false。 */
  readonly planCapable: boolean
  /** 返回一份编辑计划；失败返回 null，不抛给用户。 */
  plan(input: NesRequest, signal: AbortSignal): Promise<EditPlan | null>
}
```

`planCapable` 为 false 时，渲染层只驱动层一（光标处内联补全），不驱动层二（位置标记）。

v1 只实现 HTTP 后端。接口留在这里是为了将来接本地 FIM 或第三方补全服务时只换实现。

### 6.3 缓存

- key：`hash(filePath + 光标上下文 + 上下文摘要 + prefixStartLine)`
  —— 行号换算依赖 `prefixStartLine`（§5.5），同一段文本在不同绝对偏移处对应不同的绝对行号，
  所以起始行号必须进 key，否则在 prefix 窗口之外的改动会让缓存返回错位的计划
- TTL：30s
- 每文件上限：10 条，LRU 淘汰
- 命中直接返回，不发网络请求
- 缓存放在主进程（多窗口共享，且不把 key 拉到渲染层），**并且是模块级单例**——
  每次请求新建的 service 若各带各的缓存，缓存就等于不存在

### 6.4 限流与超时

- 单个编辑器同时只允许一个请求在飞（触发器层面保证）
- 全局并发上限：4
- 请求超时：8s（超时按「无建议」处理）
- 输出上限：8000 字符，超出截断并按 JSON 解析失败处理

## 7. 上下文构造

### 7.1 当前文件

- prefix：光标前最多 4000 token
- suffix：光标后最多 1000 token
- 光标位置用一个不会出现在源码里的标记（例如 `⟪CURSOR⟫`）标出
- 文件超过预算时，prefix 从更早处截断，suffix 保持完整（suffix 对补全更重要）
- prefix 从**行边界**截断（不从半行开始），并带上 prefix 起始行号 `prefixStartLine` 与光标绝对行列 `cursorLine` / `cursorColumn`（§5.5）

### 7.2 相关文件

**检索器是可插拔的**（`NesContextRetriever` 接口），v1 用 ripgrep 实现，将来可换成索引。

v1 实现（ripgrep + 缓存）三条来源：

1. **当前文件的 import 语句** → 直接相关，零成本
2. **光标处符号的定义处** → `spawnBundledRipgrep` 搜符号名
3. **反向引用**（谁 import 了当前文件）→ ripgrep 搜文件名

每个相关文件最多 1000 token，总预算约 12k token。

**为什么把检索器做成接口**：ripgrep 每次现场搜在超大仓库里会偏慢。CodexGraph（NAACL 2025）
那套方案是「单遍扫描抽符号与关系建浅层索引 → DFS 补全跨文件边（相对导入转绝对导入）」，
边类型 `CONTAINS` / `HAS_METHOD` / `HAS_FIELD` / `INHERITS` / `USES`；CodeGeeX4 的仓库级理解
也是「智能过滤 → 内容提取 + 路径索引并行 → 仓库结构化表示」，并明确仓库超出上下文窗口时
用检索做优先级筛选。这些都说明**索引是规模化后的正解**。v1 不做索引，但接口留好，
避免将来重写上下文构造。

### 7.3 多文件上下文的组织格式

发给模型的 prompt 里，各文件用 `###PATH:` 分隔：

```
###PATH: src/foo.ts
<文件内容>

###PATH: src/bar.ts
<文件内容>
```

抄 CodeGeeX4 仓库级上下文的格式：强制模型基于真实代码作答，而不是把文件内容当散文去续写。
比 JSON 数组省 token，也更贴合模型见过的训练分布。

### 7.3 缓存与失效

按文件缓存相关文件列表，**文件保存后或 idle 5s 时刷新**。每次触发都 ripgrep 不可接受。

### 7.4 最近接受过的编辑

记录最近 N 条（建议 10）被接受的 edit，作为「此前接受的编辑」喂回模型——Qoder 的 NEXT 明确用到这条。

## 8. 编辑器侧

### 8.1 双层渲染

**层一 · 光标处的建议 → Monaco 内置 inline completions**

```ts
monaco.languages.registerInlineCompletionsProvider('*', provider)
```

provider 收到 position → 查 Edit Plan 里落在该位置的 edit → 有就返回 `InlineCompletion`。
白嫖的能力：ghost text 渲染、`handlePartialAccept` 逐字接受、内置 debounce 与取消、
`editor.action.inlineSuggest.commit`、Esc 隐藏。

**所有权**：照抄 `monaco-markdown-doc-completions.ts` 的 WeakMap + 引用计数模式，
避免同一文件被两个编辑器打开时互相顶掉 provider。

**层二 · 其余位置 → 自研标记**

- 行号槽装饰：照 `use-monaco-ai-instructions.ts:238` 的 `createDecorationsCollection` +
  `glyphMarginClassName` 写法
- ⚠️ 动行号槽前先看 `config/patches/monaco-editor@0.55.1.patch`（gutter 销毁补丁）
- 跳转列表：编辑器右上角一个轻量小组件，列出所有预测位置（文件 + 行 + label）

### 8.2 键位

仓库里 `KeyCode.Tab` 与 `monaco.KeyMod` **零命中**，Monaco 默认 keymap 未改。

走仓库既有风格：`editor-shortcuts.ts:18-30` 的 **capture 阶段 DOM keydown 监听 +
`preventDefault()` + `stopPropagation()`**。新增两个 `KeybindingActionId`：

- `editor.acceptAiSuggestion`
- `editor.nextAiSuggestion`

**Tab 分流**（对齐 VS Code 的 `editor.tabCompletion: "on"`）：

1. 光标处有 inline suggestion → 接受它
2. 否则 Edit Plan 里还有别的位置 → 跳到下一个
3. 否则 → **不拦截**，放行给 Monaco 的 TS 智能感知

### 8.3 内容同步

Orca 拥有内容同步（`MonacoEditor.tsx:341` 用 `defaultValue` 是刻意的，
`monaco-programmatic-sync.ts` 负责抑制回声）。写回必须走这条链路，不能直接
`model.setValue`，否则会产生重复写或丢编辑。

应用一条 edit 的步骤：

1. 校验 `originalText`（§5.4）
2. `executeEdits` 或 `pushEditOperations` 写入
3. 通过 sync bridge 通知 store
4. 标记这条 edit 已接受，写入「最近接受过的编辑」

### 8.4 ⌥ / Alt 预览

按住 `⌥` / `Alt` 时，把该 edit 的新文本以叠加形式显示（Monaco 的 injected text 或
decoration），松开还原。

⚠️ **待实测**：Monaco 0.55 的 injected text 能否承载多行、是否会被当成真实内容、
是否污染 undo 栈。

### 8.5 Diff 预览

复用现成的 `EditorDiffFileSurface.tsx`（Monaco diff editor）打开「当前文件 vs 应用后的文件」。
按变更类型着色：新增绿、修改黄、删除红。

## 9. 交互契约

| 操作           | 行为                                                               |
| -------------- | ------------------------------------------------------------------ |
| `Tab`          | 有建议则接受；无建议但还有别的预测位置则跳转；都没有则放行         |
| `Esc`          | 拒绝当前建议（Monaco 内置 `editor.action.inlineSuggest.hide`）     |
| 逐字输入       | 若输入的字符与建议前缀匹配，部分接受（内置 `handlePartialAccept`） |
| `⌥` / `Alt`    | 按住预览，松开还原                                                 |
| 点击行号槽标记 | 跳到该位置                                                         |
| 继续打字       | 立即取消在飞请求，清掉当前 ghost text                              |

## 10. qodercli --acp 接入（独立子项目）

与 NES 完全独立，但同属「借 Qoder」这条线，成本低很多。

Qoder CLI 支持 `--acp`（官方自述就是「给 Zed 这类编辑器用」）。Orca 的 ACP 启动注册表
（`src/main/acp/launch/acp-launch-registry.ts`）已有现成契约，
`src/main/copilot/copilot-acp-launch-spec.ts` 就是 `args: () => ['--acp']` 的现成模板。

需要新增：

- `src/main/qoder/qoder-acp-launch-spec.ts` — `QODER_LAUNCH_SPEC`
- `src/main/acp/acp-dialects/qoder-dialect.ts` — 若 Qoder CLI 的 ACP 行为与标准一致，
  可复用现有 dialect；否则新增一个
- `src/main/acp/launch/acp-launch-registry.ts` — 注册

已有的基础：

- `src/shared/agent-launch/catalog/tui-agent-config.ts:148`（`detectCmd: 'qodercli'`）
- `src/shared/agent-launch/catalog/tui-agent-config.ts:155`（`detectCmd: 'qoderclicn'`）
- `src/renderer/src/lib/agent-catalog/agent-catalog-entries-primary.ts:98-107`

注意区分 `qoder`（全球版，`qodercli`）与 `qoder-cn`（国内版，`qoderclicn`）——两者是不同包
（`@qoder-ai/qodercli` / `@qodercn-ai/qoderclicn`），账号体系不通用。

## 11. 为什么不能直接用 Qoder 的 VS Code 插件

1. **VS Code 插件 = Node 扩展宿主 + `require('vscode')` 的 API**。Orca 用的是
   `@monaco-editor/react` 的 Monaco——那是**编辑器内核**，不是 VS Code **平台**。要让插件跑起来，
   得实现 `vscode.workspace` / `window` / `languages` / `extensions` 全套 API 加一个扩展宿主进程。
   那是 Theia 级别的平台工程，不是加一个功能。
2. **两份文档模型必然发散**。插件的补全逻辑操作的是插件自己那份 VS Code 文档模型；Orca 的
   buffer 在渲染进程的 Monaco 里。NEXT 的全部价值就是作用在光标处那个 buffer，跨不过去。
3. 专有插件打包进 Orca 安装包还有授权问题。

另外：Qoder 官方**没有**对外公开的「NEXT 补全接口」文档（现有的开放方向都是反过来的——
Qoder 当客户端接第三方模型，即 BYOK）。所以「直接调 Qoder 的 NEXT 云服务」目前没有公开可用的
正规入口，逆向插件私有协议既有 ToS 风险也不该做。

## 12. 设置

在 `src/renderer/src/components/settings/editor/` 新增一节：

| 设置项         | 类型     | 默认                                            |
| -------------- | -------- | ----------------------------------------------- |
| 总开关         | boolean  | 开                                              |
| 按扩展名开关   | 映射     | ts/tsx/js/jsx/py/go/rs… 开                      |
| 自动导入       | boolean  | 开                                              |
| 协议           | 枚举     | Anthropic Messages（FIM 端点为降级档，见 §6.1） |
| 端点 baseUrl   | string   | 空                                              |
| 模型           | string   | 空                                              |
| API key        | 加密存储 | 空                                              |
| 触发延迟（ms） | number   | 500                                             |

**API key 不进 `GlobalSettings`**（全局设置是明文 JSON 落盘）。走独立的 preload bridge +
`createEncryptedApiKeyFileStore`（参考 `src/main/minimax/minimax-api-key-store.ts`），
key **不经过渲染进程**，只存主进程。

## 13. 用量记账

`src/main/usage/` 新增一个 source（kind = `completion`）。

现有记账靠扫 agent 的 transcript 文件并按 worktree 归属（`src/main/claude-usage/scanner.ts`、
`src/main/usage/worktree-attribution.ts`）。补全请求不属于任何 worktree，扫不到，必须走新路径。

## 14. 远程与能力协商

走 `window.api.runtime.call`（IPC `runtime:call`）→ 主进程 dispatcher，
新增方法族 `src/main/runtime/rpc/methods/code-completion/code-completion-methods.ts`
（方法名 `codeCompletion.plan`），注册进 `rpc-method-registry.ts`。

新方法在旧的对端 host 上会 `method_not_found`，需要：

- 在 `src/main/runtime/runtime-client-capabilities.ts` 声明能力
- 渲染层遇到 `method_not_found` 时静默关闭该功能（不弹错误）

## 15. 改动清单

### 15.1 shared

| 文件                                                      | 改动                                               |
| --------------------------------------------------------- | -------------------------------------------------- |
| `src/shared/code-completion-types.ts`（新）               | Edit / EditPlan / 请求响应类型 + zod schema        |
| `src/shared/code-completion-prompt.ts`（新）              | system prompt 与上下文拼装                         |
| `src/shared/global-settings-types.ts`                     | 加 `codeCompletion` 设置块                         |
| `src/shared/default-global-settings.ts`                   | 默认值                                             |
| `src/shared/keybindings/types.ts`                         | 加两个 `editor.*` action id                        |
| `src/shared/keybindings/definitions-core-3.ts`            | 两个 action 的默认键位                             |
| `src/shared/rpc-contract/rpc-params-catalog.generated.ts` | 由 `pnpm generate:rpc-params-catalog` 生成，不手改 |

### 15.2 main

| 文件                                                                            | 改动                                  |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| `src/main/code-completion/completion-backend.ts`（新）                          | `NesBackend` 接口                     |
| `src/main/code-completion/anthropic-messages-backend.ts`（新）                  | Anthropic Messages 协议               |
| `src/main/code-completion/openai-chat-backend.ts`（新）                         | OpenAI Chat Completions 协议          |
| `src/main/code-completion/openai-fim-backend.ts`（新）                          | OpenAI Completions（FIM）协议，仅单点 |
| `src/main/code-completion/completion-request.ts`（新）                          | 请求编排、超时、并发上限              |
| `src/main/code-completion/completion-cache.ts`（新）                            | TTL / 每文件上限 / LRU                |
| `src/main/code-completion/completion-settings.ts`（新）                         | 读设置、解析端点                      |
| `src/main/code-completion/completion-usage.ts`（新）                            | 用量记账                              |
| `src/main/code-completion/completion-api-key-store.ts`（新）                    | 加密 key 存储                         |
| `src/main/runtime/rpc/methods/code-completion/code-completion-methods.ts`（新） | RPC 方法族                            |
| `src/main/runtime/rpc/methods/rpc-method-registry.ts`                           | 注册新方法族                          |
| `src/main/qoder/qoder-acp-launch-spec.ts`（新）                                 | `QODER_LAUNCH_SPEC`                   |
| `src/main/acp/acp-dialects/qoder-dialect.ts`（新或复用）                        | Qoder CLI 的 ACP dialect              |
| `src/main/acp/launch/acp-launch-registry.ts`                                    | 注册 Qoder                            |

### 15.3 preload

| 文件                                              | 改动                             |
| ------------------------------------------------- | -------------------------------- |
| `src/preload/api/code-completion-api.ts`（新）    | key 的读写接口（类型）           |
| `src/preload/api/code-completion-bridge.ts`（新） | key 的读写实现（加密存储的入口） |
| `src/preload/api-types.ts`                        | 挂上 `window.api.codeCompletion` |

模型请求本身走 `window.api.runtime.call`，不需要新的 preload domain。

### 15.4 renderer

| 文件                                                                                | 改动                            |
| ----------------------------------------------------------------------------------- | ------------------------------- |
| `src/renderer/src/components/editor/code-completion/nes-context-builder.ts`（新）   | 上下文拼装                      |
| `src/renderer/src/components/editor/code-completion/nes-related-files.ts`（新）     | 相关文件挑选 + 缓存             |
| `src/renderer/src/components/editor/code-completion/nes-context-retriever.ts`（新） | 检索器接口（v1 = ripgrep 实现） |
| `src/renderer/src/components/editor/code-completion/nes-plan-state.ts`（新）        | Edit Plan 状态                  |
| `src/renderer/src/components/editor/code-completion/nes-inline-provider.ts`（新）   | 内置 inline provider            |
| `src/renderer/src/components/editor/code-completion/nes-location-markers.ts`（新）  | 行号槽标记                      |
| `src/renderer/src/components/editor/code-completion/nes-ghost-text.ts`（新）        | 预览叠加                        |
| `src/renderer/src/components/editor/code-completion/nes-edit-application.ts`（新）  | 应用 edit（含原文校验）         |
| `src/renderer/src/components/editor/code-completion/use-monaco-nes.ts`（新）        | 挂载与生命周期                  |
| `src/renderer/src/components/editor/editor-shortcuts.ts`                            | Tab / ⌥ 拦截                    |
| `src/renderer/src/components/editor/MonacoEditor.tsx`                               | 挂载                            |
| `src/renderer/src/components/settings/editor/CodeCompletionSection.tsx`（新）       | 设置 UI                         |
| `src/renderer/src/components/settings/editor/GeneralEditorSettingsSection.tsx`      | 挂进设置                        |
| `src/renderer/src/assets/main.css`                                                  | ghost text 样式                 |

## 16. 测试策略

按 AGENTS.md「不默认加测试」，只覆盖会随改动失效的纯逻辑：

| 目标                                                   | 层次                |
| ------------------------------------------------------ | ------------------- |
| Edit Plan 的 zod 校验与逐条丢弃规则                    | 单元测试            |
| 上下文拼装（光标标记、prefix/suffix 截断、token 预算） | 单元测试            |
| 相关文件挑选（import 图解析、排序、预算截断）          | 单元测试            |
| 缓存 key、TTL、每文件上限、LRU 淘汰                    | 单元测试            |
| 应用 edit 前的 `originalText` 校验                     | 单元测试            |
| Tab 分流决策（纯函数）                                 | 单元测试            |
| 两种协议各自的响应解析                                 | 单元测试            |
| 行号槽装饰、ghost text 渲染、设置 UI                   | 不加测试            |
| 端到端：打开文件 → 触发 → 看到 ghost text → Tab 接受   | E2E（`tests/e2e/`） |

## 17. 已知限制与风险

### 风险

1. **多位置预测质量不如 Qoder**。Qoder 的 NEXT 用的是专门训练的 next-edit 模型；我们用通用 LLM
   - JSON 协议逼近。**这是本设计最大的不确定性。**
     缓解：`edits ≤ 5`；要求模型给出 `label`；UI 上让用户一眼看出这是猜测且可一键忽略；
     `NesBackend` 接口保证将来换模型不用重写上层。
2. **延迟 0.8–2s**（一次 plan = 完整生成时间）。Qoder 靠流式 + 就近接入 + 缓存做到 300ms 感知，
   我们第一版只做流式 + 缓存。**双通道（快通道只补光标 + 慢通道出计划）留到有实测数据再决定。**
3. **误报污染**。模型可能预测一堆无关编辑。缓解：位置标记做得很轻（行号槽一个小图标），不打断。
4. **与 TS 智能感知的 Tab 冲突**。分流规则已定（§8.2），但 Monaco 0.55 在 suggest 框打开时的默认
   Tab 行为需要实测确认。
5. **写回绕过 Orca 内容同步**会重复写或丢编辑。必须走 `monaco-programmatic-sync.ts`（§8.3）。

### 限制

- 仅 Monaco 源码编辑器；富文本 markdown、notebook、插件编辑器不支持。
- 跨文件预测只改**已打开**的文件；未打开的文件只提示位置，跳转过去才应用。
- 相关文件检索用 ripgrep，超大仓库里首次检索可能偏慢（有缓存兜底）。检索器接口已留好，
  规模化后可换成索引（§7.2）。
- 选 FIM 端点时**只有单点补全**，多位置预测与位置标记不可用（§6.1）。
- 补全请求不受工作区归属影响，因此不进现有按 worktree 的用量报表（§13 单独记账）。
- 远程工作区：补全请求发往**本地**运行时（文件内容本来就在渲染层），不跟随文件所在的主机。
- `qodercli --acp` 与 `qoderclicn --acp` 是两个不同的包，账号体系不通用，需要分别安装。

## 18. 外部借鉴

### Qoder NEXT

- 官方技术博客称 NEXT 的用户感知延迟从 1200ms 降到 300ms，靠的是 **HTTP/2 流式 + 首 Action 优先 +
  就近接入 + 结果缓存**（约 23% 命中，单文件 10 条上限、30s TTL、LRU 淘汰）。
  **结论：300ms 是传输与调度问题，不是模型能力问题。** 本设计的缓存参数直接照抄。
- 官方文档没有公开「NEXT 补全接口」的对外文档——现有的开放方向都是反过来的（Qoder 当客户端接
  第三方模型，即 BYOK）。所以「直接调 Qoder 的 NEXT 云服务」没有公开可用的正规入口。

### Qoder CLI

- 支持 `-p` / `--print` 无头模式，`--output-format text|json|stream-json`，以及 `--acp`
  （官方自述是「给 Zed 这类编辑器用」）。
- 全球版 `qodercli`（`@qoder-ai/qodercli`）与国内版 `qoderclicn`（`@qodercn-ai/qoderclicn`）
  是两个不同的包，账号体系不通用。

### CodeGeeX4（智谱 / 清华）

- **FIM 走 `/v1/completions` 而不是 `/v1/chat/completions`**——补全的原生协议。本设计据此增加
  第三种端点（§6.1）。
- **多文件上下文用 `###PATH:` 分隔**（§7.3）。
- **仓库级理解是多阶段流水线**：智能过滤（剔除 `.git`、二进制等）→ 内容提取与路径索引并行 →
  生成相对项目根目录的结构化表示；仓库超出上下文窗口时用检索做优先级筛选。
- **CodeGeeX4-ALL-9B 支持 Infilling，权重开源**（GLM-4-9B 上持续训练）。这既说明「本地 FIM」
  有现成模型可跑，也说明**它的补全质量来自专门训练而非提示词**——这正是 §17 风险 1 的由来。

### CodexGraph（NAACL 2025）

代码图数据库方案：浅层索引（单遍扫描提取符号与关系）→ 边补全（DFS 解析跨文件关系、
相对导入转绝对导入）。边类型 `CONTAINS` / `HAS_METHOD` / `HAS_FIELD` / `INHERITS` / `USES`。
本设计用它作为**相关文件检索器规模化后的替换方案**（§7.2）。

### VS Code 插件路线

Qoder / CodeGeeX 都有 VS Code 插件，但都不能直接嵌进 Orca（§11）。原因与具体产品无关：
VS Code 插件依赖 Node 扩展宿主与 `vscode` API，而 Orca 只有 Monaco 编辑器内核。

## 19. 参考链接

- [Qoder NEXT 用户指南](https://docs.qoder.cn/user-guide/next-edit-suggestion)
- [Qoder NEXT 性能优化揭秘](https://qoder.com/zh/blog/qoder-next)
- [Qoder CLI 命令与参数](http://docs.qoder.com/zh/cli/cli-reference)
- [Qoder CLI 在脚本中运行](https://docs.qoder.com/zh/cli/run-in-scripts)
- [CodeGeeX4 仓库](https://github.com/zai-org/CodeGeeX4)
- [CodeGeeX4 代码库级代码理解](https://zread.ai/zai-org/CodeGeeX4/15-repository-level-code-understanding)
- [CodexGraph（NAACL 2025）](https://arxiv.org/html/2408.03910)
