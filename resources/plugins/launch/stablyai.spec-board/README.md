# OpenSpec × Superpowers 看板

把 OpenSpec 的规格变更和 Superpowers 的设计/计划画在同一块看板上，并标出两者脱节的地方。

侧边栏面板有三个 Tab：

- **看板** — 按「提案 → 设计 → 计划 → 实现 → 校验 → 归档」排布的工作项。每张卡带 OpenSpec 与 Superpowers 两条进度、缺口标记，以及可以直接执行的动作。**看板跟随左侧选中的项目**：侧边栏选中哪个工作空间，这里就显示哪个项目的工作项。
- **全貌** — 两个框架各自的静态全貌：OpenSpec 的三个阶段、产物文件与「要不要写 proposal」的判定树，Superpowers 的十五个技能、产物与门禁，以及两边产物的对应关系。每个阶段下列出该框架自己的命令，可以直接 ▶ 执行。
- **项目** — Orca 知道的所有项目，**包括别的机器上的**，以及每个项目的扫描结果。还没采集的项目标着「需 agent 采集」。

插件只做两件事：读取工作区里的 OpenSpec 与 Superpowers 产物，然后调用这两个框架自己的命令（`openspec …` 或 Superpowers 技能）。它自己不往项目里写文件——它只发起动作，改状态的是这两个框架自己的命令。

## 远程项目

本机的产物由插件自己扫；别的机器上的产物由 agent 采集——插件的 host API 没有读文件的方法（连本地都没有），所以采集必须在那边跑。

刷新时插件在本机启动 agent，把要扫的项目清单和快照格式写进 `~/.orca/spec-board/scan-list.json`，让 agent 按清单逐个扫：本地项目直接读，别的机器上的项目用 `ssh` 去读（Windows 主机用 PowerShell）。快照写回本机的 `~/.orca/spec-board/board.json`，插件再把它和本地扫描合并。

清单里的 `host` 是 Orca 的主机 id（`local`、`ssh:<目标id>`、`runtime:<环境id>`），不是 ssh 名字，agent 先向 Orca 问出那台机器的 ssh 名字再连。

刷新一定在本机跑：快照只有写在本机，插件才读得到它。

## 开发

```sh
orca plugin validate .   # 校验清单
orca plugin test .      # 跑 src 下的测试
orca plugin dev watch . # 把这个文件夹加载进 Orca，改动自动重载
```
