# 附录 C　数据字典与复现方式

## C.1 环境

- Node.js 24（`pnpm` 12）；Python 3.11 仅参考实现需要。依赖以 `pnpm install --frozen-lockfile` 恢复，不升级、不改锁文件。
- 不需要网络：单元测试、向量、对拍（参考实现为本地 Python 模块）与文档链路全部离线可跑。
- PDF 生成需要 Playwright 的 Chromium（`pnpm exec playwright install chromium`）；中文字体使用系统已装的思源系列（Noto Serif SC／Noto Sans SC），缺失时回退到系统宋体／雅黑。

## C.2 复现步骤

| 步骤 | 命令 | 产物 |
| --- | --- | --- |
| 类型与静态检查 | `pnpm typecheck`、`pnpm lint` | 无（终端结果） |
| 单元测试 | `pnpm test` | 无（终端结果） |
| 测试向量 | `pnpm vec --all` | 终端结果；`--json` 可写文件 |
| 案例与向量结构 | `pnpm validate:cases` | 无 |
| Golden 冻结 | `pnpm golden:check` | 无（仅人工可 `golden:freeze`） |
| 参考实现对拍 | `pnpm diff:oracle` | `docs/_work/diff_report.md` |
| 结果导出 | `pnpm export:results` | `book/data/cases`、`book/data/flows`、`book/data/index.json` |
| 市场与单位经济模型 | `pnpm model:economics` | `book/data/model/business_model.json`、`docs/_work/business_model.md` |
| 问卷接收检查 | `pnpm survey:intake --input <导出件>` | `docs/_work/survey/intake/report.md`、`inventory.json` |
| 问卷统计 | `pnpm survey:report` | `docs/_work/survey/report.md` |
| 界面截图 | `pnpm shots` | `submission/screenshots/*.png`（真实启动后截取） |
| 测试报告 | `pnpm test:report` | `book/chapters/91_appendix_test_report.md`（附录 B）、`book/data/status.json` |
| 追溯状态 | `pnpm trace:update` | `docs/traceability.csv` 的状态列 |
| 图表 | `pnpm figures` | `book/figures/*.svg`、`book/figures/index.md` |
| 文档检查 | `pnpm doc:lint` | 终端结果、`.cache/report/doc-lint.json` |
| 篇幅统计 | `pnpm count:chars` | 终端结果、`.cache/report/chars.json` |
| 成稿构建 | `pnpm book:build` | `book/build/趣有度_项目书.md` |
| PDF 排版 | `pnpm book:pdf` | `submission/趣有度_项目书.pdf`、`book/build/趣有度_项目书.html`、逐页图 `.cache/pdf-pages/` |
| 一次跑完 | `pnpm presubmit` | 上述大部分步骤，按依赖顺序并逐步核对退出码 |

**构建顺序**（不可颠倒）：源章节 → `export:results`／`test:report`／`figures` → `doc:lint` → `count:chars` → `book:build` → `book:pdf`。`book:build` 会拒绝缺章、缺图、占位符解析失败与图表不足 15 张；`book:pdf` 会拒绝缺图、脚注缺定义、分页溢出与页数不一致。

## C.3 数据字典（导出结果）

`book/data/cases/<案例编号>.json` 与 `book/data/flows/<流程编号>.json` 结构一致：

- `meta`：`engine`（固定 ts）、`commit`／`commit_time`、`config_version`、`done_modules`、`simulated`、`notice`、`generated_by`、`kind`、`id`、`source`（受控输入的仓库路径）、`case_data_version`、`source_type`。
- `checkpoints[]`：每个检查点的 `label` 与完整 `result`（键名 snake_case，金额为整数分）。案例只有一个 `final` 检查点；流程带 `EVALUATE` 时有多个。
- 关键路径：`snapshot.*.value`（资金分区）、`cost.net_spend.value`（净支出）、`earliest_gap.*`（最早缺口）、`nodes[].*`（逐节点金额与判定）、`candidates[]`（候选可行性、净支出与排除原因）、`states.*`（三类状态）、`daily_reference.*`（每日参考）、`confirmation.*`（W、m、ΔA 与计划分配）、`forecasts[]`（预测条目）、`scenarios[]`（情景可用性）。

`book/data/status.json` 汇总结论性计数（单元测试、向量与断言、golden、规格自洽、对拍、文档检查、端到端、追溯分布、逐规则状态）。正文的数字通过数据占位符（构建时由导出结果填入）引用，正文不手写数字——这也是"正文数值可追溯到导出结果"的实现方式。

`book/data/index.json` 是目录索引：每个导出文件一条摘要，含 `id`、`title`、`file` 与各检查点的 `label`、`input_version`、三类状态与标签，不含金额。

## C.4 案例与规模

当前导出结果包含演示案例 <!-- data: index.json#entries.0.id --> 等 <!-- data: index.json#meta.entries --> 个受控输入文件（案例与流程）、测试向量 <!-- data: status.json#vectors.vectors_total --> 个。案例覆盖的情形包括：主线 Top-K 比较、两个候选都可行、零个候选可行、住宿价格未知、住宿确认免费、暂停与取消、生活安排未提供、快照当天新增支出等。

## C.5 已登记缺口的位置

- `docs/_work/spec_gaps.md`：规则缺口、处理方式与状态（原 AI 暂定项已裁决并写回 `docs/rules.md`；仍有"延后"项由 V 约束强制）。
- `docs/_work/spec_gaps_review.md`：裁决、写回位置与验证证据。
- `docs/_work/vector_gaps.md`：写不成向量断言的子用例及原因（含类别 B／C 的剩余限制）。
- `docs/_work/test_layers.md`：每条子用例由哪一层测试覆盖，以及证据映射契约。
- `docs/_work/diff_report.md`：`pnpm diff:oracle` 本轮实跑的对拍结果。
- `docs/traceability.csv`：规则—测试—状态，由 `pnpm trace:update` 按真实结果写入。
