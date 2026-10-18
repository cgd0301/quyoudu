# 系统架构

## 分层

![系统总体架构](../figures/fig_architecture.svg)

1. **输入层**：案例文件（`fixtures/cases`，结构与 `docs/rules.md` §12.2 一致）、操作白名单（D29）与演示流程（`fixtures/flows`）。读入时按 §9 的字段表一一转换，未知字段一律拒绝，旧字段名不会被静默丢弃。
2. **确定性引擎**（`src/engine`）：按固定顺序执行 normalize → snapshot → states → timeline → cost → pricing → compare → confirm → daily → scenarios → holt。金额、日期、约束、排序与预测只在这里计算；不使用系统时钟、随机数与网络。
3. **结果契约**：`ResultCore` 共 24 个一级字段，TS 内为 camelCase，对外序列化时转 snake_case；每个金额为 `{value, basis}`，`value` 为整数分。
4. **交付层**：`book/data`（导出结果）、`book/figures`（图表）、`book/chapters`（正文）、附录与成稿。四页界面（`src/App.tsx` 与样式文件）已与主线合并，只消费 `ResultCore`。

## 执行流程

![确定性引擎执行流程](../figures/fig_engine_pipeline.svg)

一次 `evaluate(caseFile, ops, config)` 会按顺序执行操作序列，每个 `EVALUATE` 产出一个检查点；没有 `EVALUATE` 时在末尾补一个（SG-32）。`PATCH` 只用于规则测试构造输入版本，界面不提供（D58）。

## 数据流

![数据流与依赖](../figures/fig_data_flow.svg)

从受控输入到成稿的每一步都由脚本串联，可整体重跑：向量与案例 → golden 冻结与对拍 → `book/data` → 市场与单位经济模型 → 图表 → 正文 → `doc:lint` → `count:chars` → `book:build`。任一环节失败即以非零退出码结束，不覆盖上一份成稿。

## 本轮没有做的部分

界面已与主线合并（四页：概览、方案比较、资金日历、草稿与确认），端到端有 1 条 spec 覆盖主流程；UI 层 21 条子用例尚未逐条覆盖。为保证接入不改动计算口径，引擎侧已经固定：结果字段名与含义、状态取值（§11）、标签代码与文案表、操作白名单与输入版本规则。界面只消费 `ResultCore`，不参与任何金额计算：金额一律经 `formatCents` 显示，页面内的元→分转换只用于用户输入。

当前引擎模块完成度为 <!-- data: index.json#meta.done_modules.0 -->—<!-- data: index.json#meta.done_modules.8 -->，配置版本 <!-- data: index.json#meta.config_version -->（比赛演示配置，非最终批准默认）。
