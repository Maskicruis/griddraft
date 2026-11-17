# vue3-gantt 对标记录

对照仓库的提交为 [ea00cb9](https://github.com/lee576/vue3-gantt/tree/ea00cb9fd2509a0c5e2620276ce2fc8ca4d68c55)。

| 参考源码 | GridDraft 的实现 |
| --- | --- |
| src/types/gantt.ts、src/components/gantt/core/Gantt.vue 将任务的 ID、父任务、日期、进度和视图配置分开，并通过 mapFields 接收外部表结构。 | 图文件包含稳定的节点和依赖编号。自动排版写入可持久化坐标，工期与图形位置可以分别修改。视图只消费同一份图文件和计算结果。后续表格导入可作为适配器实现。 |
| src/components/gantt/composables/useSharedVerticalVirtualScroll.ts 与 src/test/sharedVerticalVirtualScroll.test.ts 让任务列表与时间轴复用同一可见行和行索引。 | 时间轴把任务名称、选中状态和时间条放在同一个行容器，滚动和点选天然一致。现版为全量渲染。大图可再按参考项目的方法做共享窗口，继续保留行 ID 稳定。 |
| src/components/gantt/links/linkPath.ts 将连接路径与组件拆分，支持直线、折线、曲线和箭头。 | engine.cjs 统一计算路由和输出 SVG，GUI 与 CLI 使用同一渲染结果。自动排版调用 ELK，拖动只使相关连线的旧路由失效。 |
| src/test/taskMovePersistence.test.ts 测试拖动失败回滚以及避免旧请求覆盖新状态。 | GUI 拖动期间只预览位置，松手才校验并提交一条编辑操作。成功的修改进入撤销历史。CLI edit 也在整组变更校验通过后才输出新图。 |
| src/components/gantt/workers 与 src/components/gantt/state/DerivedState.ts 把计算从视图中拆出。 | 桌面将布局和 SVG 渲染放在 Worker 中。命令行直接调用同一模块，可在无图形界面环境执行。 |

第一版时间轴从依赖计算的 ES／EF 得到相对天数。日期、WBS 和实际进度字段留给后续导入适配器。单纯流程图可带反馈环。关键路径计算要求关系无环，仅支持完成到开始和非负时滞。
