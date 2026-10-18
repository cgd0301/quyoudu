# 附录B 复现与数据字典

## 环境

- Node.js 24（`pnpm` 12），Python 3.11（仅参考实现需要）。依赖以 `pnpm install --frozen-lockfile` 恢复，不升级、不改锁文件。
- 不需要网络：单元测试、向量、对拍（参考实现为本地 Python 模块）与文档链路全部离线可跑。

## 复现步骤

| 步骤 | 命令 | 产物 |
| --- | --- | --- |
| 类型与静态检查 | `pnpm typecheck`、`pnpm lint` | 无 |
| 单元测试 | `pnpm test` | 无（终端结果） |
| 测试向量 | `pnpm vec --all` | 终端结果；`--json` 可写文件 |
| 案例与向量结构 | `pnpm validate:cases` | 无 |
| Golden 冻结 | `pnpm golden:check` | 无（仅人工可 `golden:freeze`） |
| 参考实现对拍 | `pnpm diff:oracle` | `docs/_work/diff_report.md` |
| 结果导出 | `pnpm export:results` | `book/data/cases`、`book/data/flows`、`book/data/index.json` |
| 测试报告 | `pnpm test:report` | `book/chapters/91_appendix_test_report.md`、`book/data/status.json` |
| 追溯状态 | `pnpm trace:update` | `docs/traceability.csv` 的状态列 |
| 图表 | `pnpm figures` | `book/figures/*.svg`、`book/figures/index.md` |
| 文档检查 | `pnpm doc:lint` | 终端结果、`.cache/report/doc-lint.json` |
| 篇幅统计 | `pnpm count:chars` | 终端结果、`.cache/report/chars.json` |
| 成稿构建 | `pnpm book:build` | `book/build/趣有度_项目书.md` |
| 一次跑完 | `pnpm presubmit` | 上述全部，按依赖顺序并逐步核对退出码 |

## 数据字典（导出结果）

`book/data/cases/<案例编号>.json` 与 `book/data/flows/<流程编号>.json` 的结构一致：

- `meta`：`engine`（固定 ts）、`commit`／`commit_time`（最后一次改动代码与数据的提交）、`config_version`、`done_modules`、`simulated`、`notice`、`generated_by`、`kind`、`id`、`source`（受控输入的仓库路径）、`case_data_version`、`source_type`。
- `checkpoints[]`：每个检查点的 `label` 与完整 `result`（键名为 snake_case，金额为整数分）。案例只有一个 `final` 检查点；流程带 `EVALUATE` 时有多个。
- 关键路径：`snapshot.*.value`（资金分区）、`cost.net_spend.value`（净支出）、`earliest_gap.*`（最早缺口）、`nodes[].*`（逐节点金额与判定）、`candidates[]`（候选可行性、净支出与排除原因）、`states.*`（三类状态）、`daily_reference.*`（每日参考）、`forecasts[]`（预测条目状态）、`scenarios[]`（情景可用性）。

`book/data/status.json` 汇总结论性计数（单元测试、向量与断言、golden、规格自洽、对拍、文档检查、端到端、追溯分布、逐规则状态），本稿正文的数字通过数据占位符（构建时由 `book/data` 的导出结果填入）引用，正文不手写数字。

`book/data/index.json` 是目录索引：每个导出文件一条摘要，含 `id`、`title`、`file` 与各检查点的 `label`、`input_version`、三类状态与标签，不含金额。

## 图表索引

全部 16 张图的文件名、数据来源与口径见 `book/figures/index.md`；其中数值图的数据来自上表的导出结果，架构与流程图按仓库真实模块绘制。

## 已登记缺口的位置

- `docs/_work/spec_gaps.md`：规则缺口、处理方式与状态（14 条原 AI 暂定项已裁决并写回 `docs/rules.md`；仍有 2 条"延后"由 V 约束强制）。
- `docs/_work/spec_gaps_review.md`：本轮裁决、写回位置与验证证据。
- `docs/_work/vector_gaps.md`：写不成向量断言的子用例及原因（含类别 B／C 的剩余限制）。
- `docs/_work/test_layers.md`：每条子用例由哪一层测试覆盖，以及证据映射契约。
- `docs/_work/diff_report.md`：`pnpm diff:oracle` 本轮实跑的对拍结果（含命令、提交与环境版本）。
- `docs/traceability.csv`：规则—测试—状态，由 `pnpm trace:update` 按真实结果写入。
