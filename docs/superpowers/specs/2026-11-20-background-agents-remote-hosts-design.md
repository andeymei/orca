# 远端工作区的 background agents —— 设计

> 接 `2026-11-15-claude-background-agents-supervisor-design.md`。那份 spec 的 §8 写着「列表只答本机」；
> 这份把那条限制拆掉（**只读**），并且**不需要升级远端**。

## 1. 问题

用户选了一个**在远端主机上的项目**（`ctjt-service`，宿主是配对环境 `frp-yolocalc`），
面板什么都不显示。

**这是设计如此**：lister 跑的是**本机**的 `claude agents --json --all`，所以它只能列出本机的 agent；
远端工作区的目录在远端主机上 ⇒ 作用域过滤之后 0 行。

**实测**（2026-11-20，探针）：那台主机上 **108 个 job 目录**，其中 **7 个是后台 agent（`template: "bg"`）**，
**5 个的 `cwd` 就在 `D:\ctjt\code\ctjt-platform\ctjt-service`**。也就是说面板确实藏着真东西。

## 2. 约束

- 远端是 **Windows**，Orca **1.4.253**（release build，不是本仓库的 checkout）。
- **Windows 包在 macOS 上做不出来**（native addons 会是 macOS 的）⇒ **不能靠升级远端**。
- 因此只能用 **1.4.253 已经有的 RPC**。用 tag `v1.4.222` / `v1.4.228` / `v1.4.256` 逐个 `git grep` 验过
  （这个 fork 的 `main` 从 2026-11-08 的 squashed commit 起，`git log` 的日期对老代码没意义）。

## 3. 决定性事实（探针实测，不是推断）

- **任意绝对文件可以读**：`files.resolveTerminalPath` 对 `C:\Users\andey\.claude\jobs\<id>\state.json`
  返回 `openTarget.kind === "absolute-file"` + `grantId`，`files.readTerminalArtifact` 读回完整内容。
  远端的 capability 列表里有 `files.resolve-terminal-path.absolute-files.v1` ——
  **1.4.228 那套「只允许 temp 目录」的收紧策略在 1.4.253 上已经不存在了**。
- **必须走 `callRuntimeEnvironment`**：grant 绑定的是**设备的 clientId**，设备最后一条连接关闭时
  会被 `onClientDisconnected` 撤销。裸的一次性 socket 会拿到 `terminal_file_grant_expired`。
  app 的 `callRuntimeEnvironment` 走 `shouldRouteCallBySupport` → **持久 shared-control 连接**，不会踩到。
- **grant 是设备级的，不是 socket 级的**：保留一条连接、再用一次性 socket resolve + read 也能过 ——
  所以 feature 只要走 app 的正常路由即可。
- **`files.read` / `readDir` / `stat` 不接受绝对路径**（`invalid_relative_path`），所以「读文件」只有 grant 这一条路。
- **`browseServerDir` 的 entry 没有 stat**：只有 `{ name, isDirectory, isSymlink }`。⇒
  **没法靠 mtime 跳过没变的 job**，每次轮询都得重读所有 `state.json` 才知道每个 job 的 template / cwd / state。
- **时延**（持久连接）：一次 resolve+read 中位 **49 ms**；108 个目录全扫（183 个请求）**4.77 s**。
  15 s 的轮询今天放得下，但 job 一多就放不下。
- **远端 home**：`files.browseServerDir { path: '~' }` → `resolvedPath: "C:\\Users\\andey"`，`pathFlavor: "win32"`。
- **`state.json` 的字段**：`state`、`detail`、`name`、`cwd`、`sessionId`、`intent`、`template`、
  `createdAt`、`updatedAt`、`needs`/`block`（被卡住时）。**没有 `startedAt`**、**没有 `kind`**。
  `template` 是背景/交互的判据：`"bg"` = 后台 agent，`"claude"` = 交互会话。
  `jobs/` 里还有 `pins.json`（文件）和**没有 `state.json` 的目录**（108 个里有 33 个）—— 都要跳过。

## 4. 设计

**一句话**：面板的名单改成**跟着工作区的宿主走**。本机宿主走现在的 CLI；`runtime:<envId>` 宿主
**读那台主机上的 job 文件**，不跑任何命令。

### 4.1 查询面（渲染层 → 主进程）

`claudeAgents:list` 增加一个参数：`{ worktreeId: string, executionHostId: string }`。

- `local`（或空）⇒ 现在的 lister，**行为不变**。
- `runtime:<envId>` ⇒ 下面的远端 lister。
- `ssh:<targetId>` ⇒ **v1 不支持**：按「作用域内没有 agent」返回 `ready` + 0 个，
  并让面板显示「这个宿主还答不了」的说明（§4.5）。远端 SSH 的 orcad 是另一条路，不在这次范围里。

主进程用 `worktreeId` 找 worktree，用 `executionHostId` 找环境 —— 两个都来自渲染层已经有的状态。

### 4.2 远端 lister

新模块 `src/main/claude/background-agents/claude-background-agent-remote-list.ts`：

1. `files.browseServerDir { path: '~' }` → 拿到远端 home（**按环境缓存**，不要每次轮询都问）。
2. `files.browseServerDir { path: '<home>/.claude/jobs' }` → 只保留 `isDirectory && /^[0-9a-f]{8}$/.test(name)`。
   目录不存在 ⇒ `ready` + 0 个（这个项目所在的主机上还没有后台 agent）。
3. 对每个 job 目录：`files.resolveTerminalPath { worktree: <远端 worktree 选择器>, pathText: '<id 的 state.json 绝对路径>' }`
   → `openTarget.grantId` → `files.readTerminalArtifact { worktree, grantId, absolutePath }`。
   - **没有 grant / 文件不存在 / 读失败 ⇒ 跳过这个 job**（实测 108 个里有 33 个是这种清理过的目录）。
4. 解析、过滤、映射（§4.3），返回**同一个** `ClaudeBackgroundAgentListResult`。
   `readDetail` 对远端**不额外发请求** —— `state.json` 里已经有 detail，further 让 `readDetails` 直接返回
   上一次 list 缓存的 details（渲染层因此不用改）。

**路径分隔符**：远端是 win32，`<home>/.claude/jobs` 里的 `/` 由远端自己解析；**不要**在本地用 `path.join`
拼一个 win32 路径（本地是 darwin）。用一个小的 `joinRemotePath(home, '…')`，或者直接把远端报回来的
`resolvedPath` 当基准拼。

**并发**：实测一次扫描 4.77 s（串行风格的 183 个请求）。实现里对 job 的读取**限个并发**（比如 6–8），
既压得住时延也不会把链路打满；并且**容忍单个 job 失败**（跳过，下一轮再来）。

### 4.3 `state.json` → 面板的行

| 行需要的                                 | 来源                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                                     | job 目录名（8 位十六进制）                                                                           |
| `name`                                   | `name`                                                                                               |
| `cwd`                                    | `cwd`                                                                                                |
| `state`                                  | `state`；**不在已知集合里就当作缺失**（`sectionForState(undefined)` ⇒ Completed，和更旧的 CLI 一样） |
| `startedAt`                              | **`createdAt`**（没有 `startedAt`）                                                                  |
| details.`detail` / `needs` / `updatedAt` | `detail` / `needs` / `updatedAt`（ISO → epoch ms）                                                   |
| 背景 vs 交互                             | **`template === 'bg'`** 才要                                                                         |

### 4.4 轮询

- **远端用更慢的节拍**：本机 15 s 不变；远端 **60 s**。理由是 §3 的 4.77 s（而且它会随 job 数量长）。
- 第一次进远端工作区时立刻拉一次，之后按 60 s；窗口不可见时照样暂停（沿用 `installWindowVisibilityInterval`）。
- 不做 mtime 优化 —— server 不给 stat，没有可靠的「没变」信号。

### 4.5 UI

- **远端宿主的名单是只读的**：行可以看，**不能点开**（attach 要远端 PTY，见 §6），
  composer（派发）**隐藏**，停止/删除**不提供**。
- 提示语要跟着改：现在的 `listsThisMachineOnly` 说「This panel lists background agents running on this machine」——
  对 `runtime:` 宿主**已经不成立了**。改成两种：
  - `runtime:` 宿主 ⇒ 新键，例如「Showing this project's agents on its host. Opening, stopping and starting them there is not supported yet.」
  - `ssh:` 宿主 ⇒ 保留现在那句（那个宿主确实还答不了）。
- 空状态文案不变（`No background agents found for this project` / `Open a project…`）—— 它对远端也准确。

### 4.6 作用域

**不变**：还是按工作区的目录集合过滤。只是两边现在都是**远端的路径**（`cwd` 是 `D:\…`，工作区路径也是
`D:\…`），`createAiVaultScopeCwdMatcher` 已经会折大小写、归一化分隔符。实测那 5 个 job 的 `cwd`
就是规范形式（大写盘符、反斜杠、无尾分隔符），但保留归一化当保险。

## 5. 降级与已知限制

| 情况                                             | 表现                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 远端没有 `.claude/jobs`                          | `ready` + 0 个 —— 这个项目所在的主机上确实没有后台 agent                                                                                      |
| 某个 job 没有 / 读不出 `state.json`              | 跳过它（不占行、不报错）。实测 108 个里有 33 个                                                                                               |
| 单个 job 的读失败（并发写 / grant 过期）         | 跳过，下一轮再来                                                                                                                              |
| 远端 home 不是默认的 `~/.claude`（例如托管账号） | **v1 不处理**：读的就是 `~/.claude/jobs`。远端报错就退回「0 个」而不是猜                                                                      |
| **存活权威**                                     | CLI 的 listing 能证明 agent 还活着；只读 `state.json` 分不出「daemon 死了但文件还写着 working」。⇒ 远端看到的是**最后写入的状态**，可能是陈的 |
| `ssh:` 宿主                                      | v1 不支持，面板显示「答不了」的说明                                                                                                           |
| 远端连不上 / 超时                                | `error` + 消息；保留上一次的名单（和本机一样的规矩）                                                                                          |

## 6. 不在这次范围（明确不做）

- **attach（点开 agent）**：要远端 PTY。`terminal.create` 打给环境是可行的（1.4.222 就有），但面板现在那个
  内嵌终端走的是**本地** `pty.spawn` + 本地 sidecar，`window.api.pty.*` 不处理 `remote:<envId>@@<handle>` 的 PTY。
  要做得把终端渲染换成远端 transport —— 那是自己的一块工作。
- **派发 / 停止 / 删除**：**没有一次性远端命令执行的 RPC**。唯一能跑命令的是 `terminal.create { command }`，
  而它**一定**会发布一个真实终端 surface（`presentation: 'background'` 只是不聚焦）。要不要为一个后台命令
  在远端弹一个 tab，是产品决定，不该夹在这次里。
- **SSH 宿主**。

## 7. 测试

- **远端 lister 的单测**（注入一个假的 RPC 调用）：
  - `template: 'claude'` 的 job **不出现**；`'bg'` 的出现。
  - 没有 `state.json` 的目录、`pins.json` **被跳过**。
  - `startedAt` 来自 `createdAt`；`updatedAt` 的 ISO 解析成 epoch ms。
  - 未知的 `state` 词 ⇒ 落到 Completed（和更旧 CLI 的行为一致）。
  - 一个 job 读失败**不影响**其它 job。
- **宿主路由的测试**：`executionHostId` 为 `local` ⇒ 走本地 lister；`runtime:<id>` ⇒ 走远端；
  `ssh:` ⇒ 0 个 + 说明。
- **渲染层**：远端宿主下 composer 不渲染、行不可点；提示语是新的那句。
- **活的验证**：跑一次对 `frp-yolocalc` 的真实查询，确认 `ctjt-service` 那 **5 个 done** 的 agent 出现。

## 8. 一条实现规则（探针踩出来的）

**resolve 和 read 必须走 `callRuntimeEnvironment`**（app 的正常路由，持久 shared-control 连接），
**不能**自己 dial 一次性 socket —— grant 绑设备，设备最后一条连接一关就被撤销。
这条要写进代码注释，否则下一个人很容易踩。
