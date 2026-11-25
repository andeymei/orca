# OpenSpec × Superpowers 看板

把 OpenSpec 的规格变更和 Superpowers 的设计/计划画在同一块看板上，并标出两者脱节的地方。

侧边栏面板有三个 Tab：

- **看板** — 按「提案 → 设计 → 计划 → 实现 → 校验 → 归档」排布的工作项。每张卡带 OpenSpec 与 Superpowers 两条进度、缺口标记，以及可以直接执行的动作。
- **全貌** — 两个框架各自的静态全貌：OpenSpec 的三个阶段、产物文件与「要不要写 proposal」的判定树，Superpowers 的十五个技能、产物与门禁，以及两边产物的对应关系。每个阶段下列出该框架自己的命令，可以直接 ▶ 执行。
- **项目** — 已登记的项目，以及每个项目的扫描结果。

插件只做两件事：读取工作区里的 OpenSpec 与 Superpowers 产物，然后调用这两个框架自己的命令（`openspec …` 或 Superpowers 技能）。它自己不往项目里写文件——它只发起动作，改状态的是这两个框架自己的命令。

## 开发

```sh
orca plugin validate .   # 校验清单
orca plugin test .      # 跑 src 下的测试
orca plugin dev watch . # 把这个文件夹加载进 Orca，改动自动重载
```
