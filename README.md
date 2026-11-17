# GridDraft

GridDraft 是一款独立的施工进度网络图工具。桌面端和 CLI 从同一份工序与依赖数据计算关键线路，并生成双代号时标网络图、双代号结构图和事件数据。

[下载最新版](https://github.com/Maskicruis/griddraft/releases/latest) · [查看示例时标图](https://github.com/Maskicruis/griddraft/releases/latest/download/GridDraft-Time-Scaled-Example.svg) · [维护与发布](docs/releases.md)

## 桌面版

下载并打开 Windows 桌面版 EXE，默认展示扶余工序示例的**双代号时标网络图**。圆圈为编号事件，箭线为有工期的工作，红色为关键线路，虚线为虚工作，橙色为时滞。横轴按 D0 起算，工作实线的水平投影表示持续时间，波形表示从工作完成到箭头所指事件发生的间隔。点击圆圈可查询事件最早、最迟时间，点击工作名称可编辑。图纸可用滚轮缩放，拖动空白处平移。

- 「双代号结构」按逻辑层级布局，便于检查依赖、汇合和虚工作。箭长随布局变化。
- 「工作表」按双代号列出工期、最早开始（ES）、最早完成（EF）、总时差（TF）和自由时差（FF）。点击工作名称可改名称、工期等字段。工作表中的自由时差按源工序及后续约束计算。
- 「流程编辑」用于录入工序、修改连接与时滞、拖动节点。新建或打开 JSON 后，从「＋节点」添加工作并填写工期，再通过「连接节点」设置前置和后续工作。完成录入后，切回「双代号时标」查看计算结果。
- 「导出 SVG」保存当前制图视图。「事件 JSON」保存双代号数据，包含事件、起止代号、箭线类型、时差与关键工作标识。「保存」保存可继续编辑的源计划。

计算支持无环的完成到开始关系（FS）、非负整数天时滞，以及零工期里程碑。事件编号随网络重新生成，跨系统关联使用原始 `activityId`。工期由逻辑约束推算，资源、班组、天气、现场进度及日历约束尚未参与计算。包含反馈环或缺少工期的源图可在「流程编辑」中修改。扶余示例的 34 天是演示计算值。

## 命令行

Windows CLI ZIP 解压后运行 griddraft.cmd，无需另装 Node.js。跨平台可从源码运行 node bin/griddraft.cjs 或用 npm link 将命令加入 PATH。

```powershell
.\griddraft.cmd validate .\examples\fuyu-demo.json
.\griddraft.cmd network .\examples\fuyu-demo.json --view time --out network-time.svg
.\griddraft.cmd network .\examples\fuyu-demo.json --view logic --out network-logic.svg
.\griddraft.cmd network .\examples\fuyu-demo.json --format json --out events.json
.\griddraft.cmd cpm .\examples\fuyu-demo.json
.\griddraft.cmd batch .\plans --out .\output --format network --view time
```

- 输入可用单个连字符读取标准输入。未指定 --out 时，结果输出到 stdout。错误以 JSON 写入 stderr。
- 批处理逐个处理输入目录顶层 JSON 文件，保留成功结果，并输出逐文件 JSON 清单。目录中可有校验失败的输入。退出码 0 表示全部成功，1 表示处理失败，2 表示用法错误，3 表示批次内有文件失败。
- edit 接收一组 JSON 操作，例如 [{"op":"put-edge","edge":{"id":"new-edge","from":"RD","to":"CL-C","lag":1}}]，并在校验通过后输出新图。支持 set-title、put-node、put-edge、remove-node、remove-edge。删除节点时一并删除关联线。可先生成新文件，再比对或替换原图。
- 图文件契约在 schema/graph-v1.schema.json。节点及连线 ID 唯一、端点存在、工期和坐标合法等会在引擎中交叉校验。layout 写回节点位置和折线路由。GUI 中手动移动会重画相关连线，重新执行自动排版可重新路由。

后续智能体可以生成源工序数据，调用 `validate`、`edit`、`network` 和 `batch`，并通过 JSON 读取计算结果。命令行可由脚本、其他编程语言和 CI 调用。

## 参考项目

对照 [vue3-gantt](https://github.com/lee576/vue3-gantt/tree/ea00cb9fd2509a0c5e2620276ce2fc8ca4d68c55) 的任务与视图分层、共享行索引、独立的连线路径以及拖动后失败回滚。GridDraft 对时间轴的名称和条形使用同一个行容器，对画布拖动只提交最后一次坐标变化。在大规模甘特图中，参考项目的共享虚拟窗口可用于后续按需渲染行。当前时间轴基于 GridDraft 的逻辑工期和工序主键。

[源码对标与实现取舍](docs/vue3-gantt-reference.md)

[双代号时标网络计划教学资料](https://study.hip.edu.cn/static/upload_img/admin/ico/20250725/474f0905dfb282ec67986e275ab82827.pdf)

## 开发与构建

需要 Node.js 22 或以上。执行 npm ci、npm test 和 npm start。Windows 便携版用 npm run build:desktop 构建。引擎接口可直接通过 require('./src/engine.cjs') 调用。示例只是用于验证图编辑与计算的演示数据。
