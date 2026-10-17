# 图表索引

全部图由 `pnpm figures` 从 `book/data` 的正式导出结果生成；数值图不含手工填写的数字。

| 编号 | 图名 | 文件名 | 数据来源 | 口径说明 |
| --- | --- | --- | --- | --- |
| 图 1 | 系统总体架构 | fig_architecture.svg | src/engine/ | 按仓库现有目录与 rules.md §12 绘制 |
| 图 2 | 确定性引擎执行流程 | fig_engine_pipeline.svg | src/engine/evaluate.ts | 按 evaluate() 的实际调用顺序 |
| 图 3 | 数据流与依赖 | fig_data_flow.svg | package.json<br>book/data | 由脚本串联，可整体重跑 |
| 图 4 | 费用组成（主线流程） | fig_cost_composition.svg | book/data/flows/01_cB_topk_main.json | 按费用项目汇总后续应付 |
| 图 5 | 资金分区（快照） | fig_funding_partition.svg | book/data/cases/c01_base.json | C = L + M + O/N + A + 未分配 |
| 图 6 | 资金节点与 U 曲线 | fig_cash_curve.svg | book/data/flows/01_cB_topk_main.json | 按 D05、D36 由节点金额重算 |
| 图 7 | 最早资金缺口与两项依据 | fig_earliest_gap.svg | book/data/flows/04_cA_gap_living.json | D34 两项依据 |
| 图 8 | 候选方案净支出与 Top-K | fig_candidate_compare.svg | book/data/cases/cB_topk.json | R016、D15、D62 |
| 图 9 | 优惠类型与约束 | fig_offer_scope.svg | fixtures/cases/cB_topk.json | D17、D45、V-03 |
| 图 10 | 三类状态与计划状态取值 | fig_plan_state_tree.svg | docs/rules.md §11 | §11.1—§11.3 |
| 图 11 | 确认与行动清单流程 | fig_confirm_flow.svg | docs/rules.md R017、D18、D46、D63 | 确认写入与拒绝路径 |
| 图 12 | Holt 预测参数与判定 | fig_holt_grid.svg | docs/rules.md §6、§7.2<br>src/engine/holt/ | D24、D25、D50、SG-49 |
| 图 13 | 预测条目状态 | fig_forecast_status.svg | book/data/cases/cB_topk.json | D24、D76 |
| 图 14 | 每日参考与情景可用性 | fig_daily_reference.svg | book/data/flows/01_cB_topk_main.json<br>book/data/flows/04_cA_gap_living.json<br>book/data/cases/c00_v1_living_not_provided.json | R018、R019、D26、D27、D59 |
| 图 15 | 测试覆盖矩阵 | fig_test_matrix.svg | book/data/status.json | 按规则汇总子用例状态 |
| 图 16 | 追溯表状态分布 | fig_trace_state.svg | book/data/status.json<br>docs/traceability.csv | trace:update 结果 |
