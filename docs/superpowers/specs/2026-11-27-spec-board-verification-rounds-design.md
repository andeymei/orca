# 看板的验证轮次：让 Superpowers 侧的工作有一个终点 — 设计

## 1. 背景与问题

看板上一个只有 Superpowers 侧的工作项（设计 spec + 实施计划，没有 OpenSpec 变更），
在计划全部勾完之后会卡在**「校验」**这一栏，永远不出来。

原因有两层：

1. **归档只属于 OpenSpec。** `openspec.archive`（`openspec archive <change-id> --yes`）是
   OpenSpec 的动作；`SUPERPOWERS_SKILLS`（`action-catalog.ts:126-164`）只有设计、写实施计划、
   执行计划、代码评审、验证五个技能，**没有归档**。Superpowers 流程的收尾是
   `finishing-a-development-branch`（合并或清理分支），它不产生归档物。
2. **「校验」这一步不推进任何东西。** 校验跑完，工作项的事实一个字节都没变——计划还是
   47/47 全勾，阶段还是「校验」，主按钮还是「验证」。用户按一次，状态不动。

结果就是：一张做完了的卡片，看起来永远像在等一件事。

## 2. 目标与非目标

### 目标

1. 工作项被验证通过后，看板能说出**它被验证过几轮**。
2. 验证通过的工作项**离开「校验」栏**，进入一个说得清的终点状态。
3. 验证记录**跟着工作走**：在项目里、人看得见、远程主机同样成立、Orca 重装不丢。
4. 失败方向是安全的：没有证据就**不**显示"已验证"。

### 非目标

- **插件自己不改任何文件。** 沿用
  `2026-11-25-openspec-superpowers-board-design.md:30-35` 的约束：写记录的是**验证 agent**
  （技能调用的一方），插件只读、只发起。
- 不做"验证轮次的时间线"、不做趋势图、不做跨项目的验证统计。
- 不让插件自己去判断"验证通过了没有"——那是 agent 的结论，不是插件能重新得出的结论。

## 3. 已核实的技术事实

| 事实                                                                                                                     | 出处                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| worker 派发完动作就返回，**不记录任何东西**——没有"某动作跑过没有"的记忆                                                  | `resources/plugins/launch/stablyai.spec-board/src/worker.ts:89-159`                                      |
| `countCheckboxes` **不分节**：文件里任何一行的 `- [x]` 都被算成进度                                                      | `resources/plugins/launch/stablyai.spec-board/src/markdown-tasks.ts:12-64`                               |
| `SUPERPOWERS_SKILLS` 五个技能，无归档                                                                                    | `resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts:126-164`                             |
| `openspec.archive` 的标签是"归档"，命令 `openspec archive <change-id> --yes`                                             | `resources/plugins/launch/stablyai.spec-board/src/action-catalog.ts:105-113`                             |
| `archiveReady()` 要求 `openspec?.stage === 'validated'`——OpenSpec 侧为 null 时恒假                                       | `resources/plugins/launch/stablyai.spec-board/src/panel-primary-action.ts:49-51`                         |
| `UnifiedStage` 六档：proposal / design / plan / implement / validate / archive                                           | `resources/plugins/launch/stablyai.spec-board/src/model.ts:5`                                            |
| 导轨六栏，标签「提案 设计 计划 实现 校验 归档」                                                                          | `resources/plugins/launch/stablyai.spec-board/src/panel-board.tsx:19-27`                                 |
| `Badge` 的 tone 枚举含 `success`                                                                                         | `src/shared/plugins/declarative/plugin-declarative-prop-schemas.ts:20-25`                                |
| `agent.launch` 拒绝超过 **4096 字符**的提示词；刷新提示词有测试卡着这个上限                                              | `resources/plugins/launch/stablyai.spec-board/src/refresh-prompt.ts:24-28`、`refresh-prompt.test.ts:107` |
| 刷新提示词在**真实路径**下只剩约 100 字符（单项目 4008 / 整盘 3936）；超限时**远程刷新根本起不来**，本地扫描那条路不报错 | 2026-11-27 实测（记忆 `spec-board-refresh-prompt-is-near-the-host-limit`）                               |
| 快照的形状由 `snapshot-format.ts` 给 agent 看，规则由校验器 `board-schema.ts` 强制                                       | `resources/plugins/launch/stablyai.spec-board/src/snapshot-format.ts`、`board-schema.ts:189`             |
| `docs/superpowers/plans/` 下**每个 .md 都是一个 plan**——同目录放侧车文件会被当成另一个工作项                             | `resources/plugins/launch/stablyai.spec-board/src/local-scan-artifacts.ts:55-56,213-241`                 |
| 插件不改任何文件，只发起动作                                                                                             | `docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md:30-35`                           |
| 阶段表是设计文档里的表，`stage.ts` 按它的次序推导                                                                        | `docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md:303,366-377`                     |

## 4. 设计

### 4.1 记录：计划文件末尾的「验证记录」一节

验证 agent 在**计划文件**末尾维护一节：

```markdown
## 验证记录

- 2026-11-27 · 通过 · pnpm tc · 421 tests
- 2026-11-27 · 未通过 · worker-refresh-project.test.ts flaky
```

**为什么落在计划里**：计划本来就是这项工作自己的账本，它跟着 git 走；远程项目上验证 agent
写在那台机器，看板的刷新 agent ssh 过去读，一个机制覆盖两边。**不能在
`docs/superpowers/plans/` 旁边放侧车文件**——那里每个 `.md` 都会被扫成一个 plan，
凭空多出工作项。

**不能写复选框。** `countCheckboxes` 不分节（事实表第 2 条），一行 `- [x] 验证通过` 会被算成
计划进度，47/47 变成 48/49，阶段机直接歪掉。因此记录是「·」分隔的普通行，**并且验证提示词里
必须明确告诉 agent 不许写复选框**——agent 写复选框是很自然的事，不说它就会那么写。

**行的格式**（解析器按这个认，别的写法一律不算一轮）：

```
- <YYYY-MM-DD> · <结论> · <跑了什么>
```

- 结论只认两个词：**`通过`** 或 **`未通过`**。
- ⚠️ **`未通过` 里含有 `通过` 这个子串**——分类必须**先判 `未通过`**，再判 `通过`。
  顺序反了，每次失败都会被数成通过。
- 结论词不在这两个里 → 这一行不算一轮（宁可少算，不要数错）。
- 日期不是 `YYYY-MM-DD` → 不算一轮。
- 标题只认 `## 验证记录` 这一个；它下面直到下一个同级或更高级标题之间的行，才属于这一节。
  标题之前的内容、代码块里的行，都不算。

### 4.2 新事实：`superpowers.verification`

```ts
export type VerificationFacts = {
  /** 记录里一共有几轮。 */
  rounds: number
  /** 其中通过的几轮。 */
  passed: number
  /** 最近一轮通过了吗；没有记录时为 null。 */
  lastPassed: boolean | null
}
```

`lastPassed` 取**文件里最后一条算一轮的行**的结论，不是"最后一次通过"。

```

一个嵌套对象（快照与 schema 都已有嵌套对象的先例），挂在 `SuperpowersFacts` 上，没有记录时
为 `null`。

两条来源：

| 项目类型 | 谁来数 | 走哪条路 |
| --- | --- | --- |
| 本地 | 插件自己读计划文件（精确解析器） | `local-scan.ts` → `superpowersFacts()`；整盘刷新时以快照里 agent 那块为准 |
| 远程 | 刷新 agent ssh 过去读 | 写进快照 → `board-schema.ts` 校验 → 合并 |

**哪条路赢**：合并整块取用（`board-merge.ts:198` 的 `agent ?? local`），所以 **agent 覆盖到的
项目——本地项目也一样——用的是 agent 数的那块**；插件自己那份精确的解析只在 agent 没有这个
工作项时说了算（项目 tab 里单独刷新过的项目，或者 agent 跳过的那个）。插件的解析器是精确的，
agent 的数法不是——但合并策略是取舍，不是本次改动。

远程那条路的三个落点都要动：`snapshot-format.ts` 的示例里加上这个对象、清单文件（不是提示词）
里带上数记录的规则、`board-schema.ts` 校验它。

### 4.3 新阶段「已验证」

`UnifiedStage` 加 `'verified'`，排在 `validate` 与 `archive` 之间；导轨多一栏「已验证」。

`deriveStage` 的次序（在现有规则上加一条，其余不动）：

1. `openspec.stage === 'archived'` → `archive`（不变）。
2. **所有有信息的清单都勾完**（现有规则）：
   - 最近一轮验证通过（`verification?.lastPassed === true`）→ **`verified`**
   - 否则 → `validate`（不变）
3. 清单没勾完的各条规则不变——**验证过了又加了新任务，就该回「实现」**，阶段机先看清单。

最近一轮没过就退回「校验」：卡片说"已验证"而最近一次验证其实没过，那是撒谎。

### 4.4 主按钮：「收尾」

`finishing-a-development-branch` 是 superpowers 流程里"验证"之后的真实下一步
（`framework-map.ts:117` 的 `SUPERPOWERS_FLOW` 画着这一步，只是它没有 `actionId`）。给它加一个
动作 id `superpowers.finish`，标签「收尾」，任务「收尾本次改动」。

于是「已验证」栏卡片的主按钮是「收尾」，「验证」退到「更多」里——想再跑一轮验证仍然可以，
验证轮次因此会继续往上走。

`PREFERRED_BY_STAGE`（`panel-primary-action.ts:25-35`）加一档：
`verified: ['superpowers.finish']`。

### 4.5 徽标

`panel-card.tsx:153-156` 那一行已经有徽标（项目名 + `无 CLI`），验证徽标进同一行：

| 情况 | 徽标 | 色 |
| --- | --- | --- |
| 最近一轮通过，且卡片在「已验证」栏 | `已验证 ×{passed}` | `success` |
| 最近一轮未通过 | `上次验证未通过` | `warning` |

`passed` 是通过轮数——正是"成功跑完的轮数"。

徽标说的是卡片的状态，不是那一轮的事实：验证过了又加了新任务，卡片退回「实现」栏，它就不再是
「已验证」，那个徽标也就不戴了。「上次验证未通过」说的是事实——最后一轮没过——所以哪个栏都照说。

### 4.6 缺口规则

不加新缺口。已有的 `tasks-complete-not-archived` 是 OpenSpec 侧的，与本设计无关；验证没通过
这件事由徽标（warning）说出来就够，不必再占一条缺口。

### 4.7 提示词改动

**验证动作的提示词**（`action-catalog.ts:156-161` 的 `superpowers.verify` 任务文本）追加一句：

> 验证结束后，在 `<plan>` 的「## 验证记录」一节末尾追加一行：`- <YYYY-MM-DD> · <结论> · <跑了什么>`。
> 日期写真实的 YYYY-MM-DD；结论只写「通过」或「未通过」里的一个整词，不要写「通过了」，也不要两个都写。
> 例如 `- 2026-11-27 · 通过 · pnpm tc`。
> 没有这一节就新建一节。**这一节不要写复选框**（`- [x]`），看板把复选框当任务进度数。

只有工作项**有计划**时才带这句（没有计划就没有地方放记录；`actions.ts` 里计划路径缺省时是
`'实施计划'` 这个占位串）。

**刷新 agent 数记录的规则**（不在提示词里，在清单文件里，见下）：

> 「## 验证记录」一节的轮次写进 `superpowers.verification`。

规则的全文在 `snapshot-format.ts` 的 `VERIFICATION_COUNT_RULE`：它说清哪一行算一轮、结论只认
「通过」与「未通过」两个整词、`lastPassed` 是**最后一条算作轮次的行**的结论。它与解析器读的
是同一个格式（`verification-records.ts` 的 `RECORD_LINE_FORMAT`），漂移了就是静默丢轮次。

⚠️ **这条规则进不了提示词，而且必须先量长度。** 2026-11-27 实测（真实临时路径，非测试里的
短示例路径；项目文件名带 16 位十六进制的 hash）：单项目刷新提示词 **4008 字符（余 88）**，整盘
那份 **3936（余 160）**。规则全文 **343 字符**，加上它单项目那份约 **4351——超了 255 个字符**。

**超 255 个字符不是余量问题，是放不下**：宿主那条线一超，**远程刷新根本起不来**（回
`Too big: expected string to have <=4096 characters`），而本地扫描那条路一声不吭。

因此：

- **规则不进提示词，进清单文件。** 放清单文件里 **agent 一定会读到的地方**：
  `scan-list.json` 的 `snapshotFormat` 里面（例如 `snapshotFormat.rules.verification`）——提示词
  已经明确让 agent 去 `snapshotFormat` 看快照的形状，规则就写在那里，它读形状时一并读到。
  清单文件没有长度上限，规则一个字都不用删短。
  （别把规则做成清单文件的**兄弟键**：提示词只指向 `snapshotFormat` 与 `progress` 两个字段，
  兄弟键 agent 可能根本不看。）
- 提示词因此**不用为规则改一个字**。
- **余量是棘轮**：`refresh-prompt.test.ts` 除了断言提示词不超过 4096，还断言它在真实路径下至少
  留 **64** 个字符的余量。真实路径比测试里那条长（用户名、home 的位置都算），提示词只在测试的
  路径上合身，刷新就会静悄悄地起不来。剩下的那 88 个字符也放不下 343 字符的规则——规则因此留在
  文件里。
- 若日后仍要塞进提示词：正文 ≤20 字符，并且**用真实路径量一遍**再提交——
  `refresh-prompt.test.ts` 用的是短示例路径，它过了不代表真实路径过得了。

### 4.8 失败方向是安全的

agent 没写记录 → `rounds = 0` → 卡片留在「校验」栏。**没有证据就不显示"已验证"。**
agent 写了但格式不对 → 解析不出来 → 同样当作没有记录。

## 5. 改动清单

| 文件 | 改什么 |
| --- | --- |
| `src/model.ts` | `UnifiedStage` 加 `'verified'`；`SuperpowersFacts` 加 `verification` |
| `src/stage.ts` | 清单全勾后按最近一轮结果分 `verified` / `validate` |
| `src/verification-records.ts`（新） | 解析计划文件的「验证记录」一节：轮次、通过数、最近一轮 |
| `src/local-scan.ts` | 本地项目读计划文件，取记录 |
| `src/board-schema.ts` | 校验快照里的 `superpowers.verification`；旧快照按无记录处理 |
| `src/snapshot-format.ts` | 示例里加这个对象（agent 照着写） |
| `src/refresh-prompt.ts` | **不必改**——规则进清单文件，不进提示词（见 §4.7） |
| `src/worker.ts` | 写清单文件时多带一条规则（`snapshotFormat.rules.verification`） |
| `src/action-catalog.ts` | `superpowers.verify` 的任务文本加记录要求；新增 `superpowers.finish` |
| `src/actions.ts` | 把计划路径带进验证提示词；只有有计划时才带记录要求 |
| `src/framework-map.ts` | `finishing-a-development-branch` 挂上 `superpowers.finish` |
| `src/panel-primary-action.ts` | `PREFERRED_BY_STAGE` 加 `verified` 一档 |
| `src/panel-board.tsx` | 导轨加「已验证」一栏 |
| `src/panel-card.tsx` | 验证徽标 |
| `resources/plugins/launch/bundled-plugins.json` | `contentHash` 重算（插件内容变了必须重算，否则打包校验失败） |

**不用改 `board-merge.ts`**：合并是 `agent ?? local` 整块取用（`board-merge.ts:195-198`），新事实
挂在 `SuperpowersFacts` 上就跟着整块走了，两条路都不需要额外的合并逻辑。

### 5.1 文档改动

`docs/superpowers/specs/2026-11-25-openspec-superpowers-board-design.md` 是看板设计的正本，
它的阶段表（`:303`、`:366-377`）、导轨与卡片说明（`:459`）、命令表（`:495-497`）都要跟着改，
并补一句：验证记录由**agent** 写，插件不写（守住 `:30-35` 那条约束）。

本设计文档是这次改动的**变更说明**，不替代那份正本。

## 6. 测试与验收

### 单测

- `verification-records.test.ts`：只认「## 验证记录」标题下的行；**`未通过` 必须先于 `通过` 判定**
  （一行 `- 2026-11-27 · 未通过 · …` 不得被数成通过）；结论词不认识就不算一轮；日期格式不对
  就不算一轮；没有这一节 → 无记录；标题前的内容不算；代码块里的行不算。
- `stage.test.ts`：清单全勾 + 最近一轮通过 → `verified`；清单全勾 + 最近一轮
  未通过 → `validate`；清单全勾 + 无记录 → `validate`（旧行为不变）；清单没勾完 → `implement`。
- `panel-primary-action.test.ts`：`verified` 的主按钮是 `superpowers.finish`；`superpowers.verify`
  落到「更多」。
- `panel-card.test.tsx`：通过 → `已验证 ×N`（success）；未通过 → `上次验证未通过`（warning）。
- `board-schema` 测试：新字段被接受；旧快照（没有这个字段）仍然被接受。
- `refresh-prompt.test.ts`：提示词仍在 4096 字符以内。

### 面板与实机

- 装包后刷新看板：一个验证通过的工作项从「校验」栏移到「已验证」栏，徽标显示轮数，主按钮是
  「收尾」。
- 验证没通过时，徽标是 warning，卡片留在「校验」栏。

## 7. 风险与权衡

| 风险 | 处置 |
| --- | --- |
| agent 不写记录 | 轮次为 0，卡片留在「校验」——失败方向安全，但这个特性就没生效 |
| agent 写了复选框 | 提示词明确禁止；解析器只认「·」分隔的行，复选框行会被忽略（但 `countCheckboxes` 仍会把它算成计划进度——所以提示词那句禁止是必需的，不是可选的） |
| 远程项目的轮数由 agent 数 | 和现有的 `planDone` 一样是 agent 报的事实，本地路径才是精确的 |
| 刷新提示词超 4096 | 规则**不进提示词**，进清单文件的 `snapshotFormat` 里；隔离 home 下单项目那份实测 4008/4096，只剩 88 字符，规则全文 343 字符——**它放不下**；提示词另留 64 字符的余量棘轮兜底 |
| 多一个新阶段动到阶段机 | 阶段表在设计文档里，本次一并更新；`deriveStage` 只加一条分支，其余规则不动 |
| **计划文件名带空格或非 ASCII**（如 `新增功能.md`） | `isSafeCommandPath` 拒收这样的路径 → 规则不随提示词走 → 这类工作项永远停在「校验」。失败方向安全（不会谎报已验证），但特性对它们**静默失效**。本仓库的计划命名约定是 ASCII slug，影响面小；别的项目若用中文命名就会中招 |

## 8. 后续（不在本次范围）

- 把「验证轮次」做成跨项目的统计（哪类工作验证得最多）。
- OpenSpec 侧对称的「已校验」标记（`openspec validate --strict` 通过之后）。
- 验证记录里带上跑的耗时，得出"验证很慢"的提示。
```
