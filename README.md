# GridDraft

GridDraft 是一款独立的网络图绘制工具。桌面界面和命令行共同使用可校验的 JSON 图文件、ELK 自动排版和 SVG 导出。

## 桌面版

打开 GridDraft-Desktop-0.1.0-x64.exe。从「新建」开始，也可打开已有 JSON。用「＋节点」或双击空白处新增节点。拖动节点调整位置，拖动空白处平移画布。点击「连接节点」后依次选定起点与终点。可在右侧修改属性和删除，使用撤销、重做恢复操作。自动排版提供四种方向。

录入工期的无环工程图可显示关键路径与逻辑时间轴。绘制普通流程图时，可保留反馈环和返工线。CPM 仅接受无环的完成到开始关系及非负时滞，以 D0 为起算点。逻辑时间轴的日期来自依赖计算，班组、资源日历、实际进度和材料供应都需由后续计划模块管理。

## 命令行

Windows CLI ZIP 解压后运行 griddraft.cmd，无需另装 Node.js。跨平台可从源码运行 node bin/griddraft.cjs 或用 npm link 将命令加入 PATH。

```powershell
.\griddraft.cmd validate .\examples\fuyu-demo.json
.\griddraft.cmd layout .\examples\fuyu-demo.json --direction DOWN --out layout.json
.\griddraft.cmd render layout.json --critical --out network.svg
.\griddraft.cmd cpm .\examples\fuyu-demo.json
.\griddraft.cmd batch .\examples --out .\output --format svg
```

- 输入可用单个连字符读取标准输入。未指定 --out 时，结果输出到 stdout。错误以 JSON 写入 stderr。
- 批处理逐个处理输入目录顶层 JSON 文件，保留成功结果，并输出逐文件 JSON 清单。退出码 0 表示全部成功，1 表示处理失败，2 表示用法错误，3 表示批次内有文件失败。
- edit 接收一组 JSON 操作，例如 [{"op":"put-edge","edge":{"id":"new-edge","from":"RD","to":"CL-C","lag":1}}]，并在校验通过后输出新图。支持 set-title、put-node、put-edge、remove-node、remove-edge。删除节点时一并删除关联线。可先生成新文件，再比对或替换原图。
- 图文件契约在 schema/graph-v1.schema.json。节点及连线 ID 唯一、端点存在、工期和坐标合法等会在引擎中交叉校验。layout 写回节点位置和折线路由。GUI 中手动移动会重画相关连线，重新执行自动排版可重新路由。

后续智能体可作为独立调用者，生成图数据或变更操作，调用 validate、edit、layout、render 和 batch。命令行可由脚本、其他编程语言和 CI 调用。建议把模型输出先当草稿，通过数据校验和人工审核再应用到计划。

## 参考项目

对照 [vue3-gantt](https://github.com/lee576/vue3-gantt/tree/ea00cb9fd2509a0c5e2620276ce2fc8ca4d68c55) 的任务与视图分层、共享行索引、独立的连线路径以及拖动后失败回滚。GridDraft 对时间轴的名称和条形使用同一个行容器，对画布拖动只提交最后一次坐标变化。在大规模甘特图中，参考项目的共享虚拟窗口可用于后续按需渲染行。当前时间轴基于 GridDraft 的逻辑工期和工序主键。

[源码对标与实现取舍](docs/vue3-gantt-reference.md)

## 开发与构建

需要 Node.js 22 或以上。执行 npm ci、npm test 和 npm start。Windows 便携版用 npm run build:desktop 构建。引擎接口可直接通过 require('./src/engine.cjs') 调用。示例只是用于验证图编辑与计算的演示数据。
