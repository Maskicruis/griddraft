# GridDraft

GridDraft 是一款独立的施工进度网络图工具。桌面端和 CLI 从同一份工序与依赖数据计算关键线路，并生成双代号时标网络图、双代号结构图和事件数据。

[下载最新版](https://github.com/Maskicruis/griddraft/releases/latest) · [查看示例时标图](https://github.com/Maskicruis/griddraft/releases/latest/download/GridDraft-Time-Scaled-Example.svg) · [维护与发布](docs/releases.md)

## 桌面版

下载并打开 Windows 桌面版 EXE，首先从项目基本信息建立网络。已有图文件可关闭项目信息窗口后打开；左侧保留扶余演示入口。双代号图中的圆圈为编号事件，箭线为有工期的工作，红色为关键线路，虚线为虚工作，橙色为时滞。横轴按 D0 起算，工作实线的水平投影表示持续时间，波形表示从工作完成到箭头所指事件发生的间隔。点击圆圈可查询事件最早、最迟时间，点击工作名称可编辑。图纸可用滚轮缩放，拖动空白处平移。

## 从项目概况开始

1. 在「项目信息 → 生成网络」中粘贴文字描述、CSV 或从 Excel 复制的表格，也可导入 TXT、Markdown、CSV、TSV、项目 JSON。表格可用「类型、数量、长度km」列，也可使用两列参数表或一行宽表。简单 JSON 支持 `turbineCount`、`substationCount`、`collectorLengthKm` 等字段。示例输入见 `examples/project-brief.json` 与 `examples/project-info.csv`。
2. 检查识别后的工程数量、编号前缀、线路长度、基础型式及集电线路型式。数量有冲突或使用模糊范围时需要补充确切值。只有线路长度而没有回路数量时，先按一个总体模块建立，后续调整划分。
3. 在同一窗口分别调整风机、升压站、集电线路和道路模块的名称、工期、紧前工序，并预览该模块的双代号网络。保存「信息与模板」后可在下一项目中导入复用。
4. 生成后默认显示全项目双代号结构图，通过「单位工程视图」选择 WT01、SS01 等逐个查看与细化。单位工程视图仅包含内部关系，跨模块关系在全项目中查看。保存图文件会同时保留项目基本信息和模板来源。

内置模块是可编辑的规划骨架。默认工期统一采用 1 天占位，图纸与导出的 SVG 会标明待估算数量。初稿先按单位工程并行、道路共同前置、全场受电条件汇合生成，未输入的资源、养护与验收时长、线路分段及分批并网安排需要按设计和施工组织补充。线路总长保留为项目资料，未据此推算工期。再次生成会建立新的初稿，细化结果可先另存为图文件。

模块按场地准备、基础、安装、电气与调试等常见工作组织。工程实际工序和条件需要逐项核实。[美国能源部风电建设工作介绍](https://www.energy.gov/cmei/systems/windexchange/large-community-wind-handbook)

- 「双代号结构」按逻辑层级布局，便于检查依赖、汇合和虚工作。箭长随布局变化。
- 「工作表」按双代号列出工期、最早开始（ES）、最早完成（EF）、总时差（TF）和自由时差（FF）。点击工作名称可改名称、工期等字段。工作表中的自由时差按源工序及后续约束计算。
- 「流程编辑」用于录入工序、修改连接与时滞、拖动节点。新建或打开 JSON 后，从「＋节点」添加工作并填写工期，再通过「连接节点」设置前置和后续工作。完成录入后，切回「双代号时标」查看计算结果。
- 「导出 SVG」保存当前制图视图。「事件 JSON」保存双代号数据，包含事件、起止代号、箭线类型、时差与关键工作标识。「保存」保存可继续编辑的源计划。

计算支持无环的完成到开始关系（FS）、非负整数天时滞，以及零工期里程碑。事件编号随网络重新生成，跨系统关联使用原始 `activityId`。工期由逻辑约束推算，资源、班组、天气、现场进度及日历约束尚未参与计算。包含反馈环或缺少工期的源图可在「流程编辑」中修改。扶余示例的 34 天是演示计算值。

## 计划智能体与设置

1. 在「设置 → 模型配置」选择 DeepSeek 官方 API 或 OpenAI 兼容 API，填写 API 地址、服务商的完整模型 ID 和密钥。官方模式默认 `https://api.deepseek.com/anthropic`。以 SiliconFlow 为例，兼容模式填写 `https://api.siliconflow.cn/v1` 及该平台提供的模型 ID。选择支持工具调用的模型。
2. 点击「测试连接」，成功后保存。密钥通过系统安全存储加密，适用于同一用户继续使用。更换服务地址后填写对应的密钥。
3. 打开「计划智能体」。可输入「在道路后插入质量验收，接回原后续工序」，继续说「把刚新增的那道改为 3 天，改名为道路验收」。同一会话会保留前文和工具结果，修改持续累积在一份草稿中。智能体还会结合当前视图和选中对象理解后续请求。
4. 「预览草稿」可查看修改后的图纸，「应用到当前计划」提交整份变更并支持撤销。新增、删除、连接、断开、修改名称、工期、时滞和节点位置均通过同一图文件校验。循环依赖等计算问题会显示在草稿上。手动编辑正式图后，旧草稿会被判定过期，后续请求基于新的正式图继续。
5. 可通过对话请求「切换到双代号结构图」「定位 F08-B」「从上到下自动排版」「保存」「另存为」「导出 SVG」或「导出事件 JSON」。有待应用草稿时，相关界面操作在应用草稿后执行。文件操作使用软件现有的文件选择对话框。
6. 从「设置 → 软件更新」查看 GitHub 新版、下载和校验 EXE，保存工作后手动启动新版程序。「第三方插件」保留了后续扩展的入口。

桌面端嵌入 DeepSeek Harness 的官方代理循环和模型适配器，提供整图创建、结构编辑、分页查询、草稿撤销、试算和界面操作工具。查询覆盖当前整图，按需分页读取。同一软件进程中的会话会持续保留，点击「新对话」可重新开始。复杂图可以分轮构建和修改。运行时会向所配置的模型服务发送会话和相关计划数据。[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3)

## 命令行

Windows CLI ZIP 解压后运行 griddraft.cmd，无需另装 Node.js。跨平台可从源码运行 node bin/griddraft.cjs 或用 npm link 将命令加入 PATH。

```powershell
.\griddraft.cmd validate .\examples\fuyu-demo.json
.\griddraft.cmd project .\examples\project-brief.json --out initial-network.json
.\griddraft.cmd project .\examples\project-info.csv --format svg --out initial-network.svg
.\griddraft.cmd network initial-network.json --unit WT01 --view logic --out wind-unit.svg
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

外部智能体可以生成源工序数据，调用 `validate`、`edit`、`network` 和 `batch`，并通过 JSON 读取计算结果。命令行可由脚本、其他编程语言和 CI 调用。

## 参考项目

对照 [vue3-gantt](https://github.com/lee576/vue3-gantt/tree/ea00cb9fd2509a0c5e2620276ce2fc8ca4d68c55) 的任务与视图分层、共享行索引、独立的连线路径以及拖动后失败回滚。GridDraft 对时间轴的名称和条形使用同一个行容器，对画布拖动只提交最后一次坐标变化。在大规模甘特图中，参考项目的共享虚拟窗口可用于后续按需渲染行。当前时间轴基于 GridDraft 的逻辑工期和工序主键。

[源码对标与实现取舍](docs/vue3-gantt-reference.md)

[双代号时标网络计划教学资料](https://study.hip.edu.cn/static/upload_img/admin/ico/20250725/474f0905dfb282ec67986e275ab82827.pdf)

## 开发与构建

需要 Node.js 24.9 或以上。执行 npm ci、npm test 和 npm start。Windows 便携版用 npm run build:desktop 构建。引擎接口可直接通过 require('./src/engine.cjs') 调用。示例只是用于验证图编辑与计算的演示数据。
