# 图表索引

全部图由 `pnpm figures` 从 `book/data` 的正式导出结果生成；数值图不含手工填写的数字。图号按正文出现顺序编排。

| 编号 | 图名 | 文件名 | 数据来源 | 口径说明 |
| --- | --- | --- | --- | --- |
| 图 1 | 问卷证据与反证 | fig_survey_evidence.svg | docs/_work/survey/report.md | n=30 便利样本；标签为 n/N |
| 图 2 | 产品决策流程（泳道） | fig_decision_flow.svg | docs/rules.md D05、D15、D30、D36、D46、D52<br>src/App.tsx | 用户动作／引擎处理／系统输出三泳道；不含未实现的自动组合生成 |
| 图 3 | 费用组成（主线流程） | fig_cost_composition.svg | book/data/flows/01_cB_topk_main.json | 按费用项目汇总后续应付 |
| 图 4 | 方案变化前后对照 | fig_plan_change.svg | book/data/flows/02_cB_topk_reconfirm.json<br>book/data/flows/01_cB_topk_main.json | 同一模拟案例 v2→v3；金额为模拟数据 |
| 图 5 | 资金分区（快照） | fig_funding_partition.svg | book/data/cases/c01_base.json | C = L + M + O/N + A + 未分配 |
| 图 6 | 资金节点与 U 曲线 | fig_cash_curve.svg | book/data/flows/01_cB_topk_main.json | 按 D05、D36 由节点金额重算 |
| 图 7 | 最早资金缺口与两项依据 | fig_earliest_gap.svg | book/data/flows/04_cA_gap_living.json | D34 两项依据 |
| 图 8 | 候选方案净支出与 Top-K | fig_candidate_compare.svg | book/data/cases/cB_topk.json | R016、D15、D62 |
| 图 9 | 确认与行动清单流程 | fig_confirm_flow.svg | docs/rules.md R017、D18、D46、D63 | 确认写入与拒绝路径 |
| 图 10 | 系统总体架构 | fig_architecture.svg | src/engine/ | 按仓库现有目录与 rules.md §12 绘制 |
| 图 11 | 确定性引擎执行流程 | fig_engine_pipeline.svg | src/engine/evaluate.ts | 按 evaluate() 的实际调用顺序 |
| 图 12 | 数据流与依赖 | fig_data_flow.svg | package.json<br>book/data | 由脚本串联，可整体重跑 |
| 图 13 | 测试覆盖矩阵 | fig_test_matrix.svg | book/data/status.json | 按规则汇总子用例状态 |
| 图 14 | 追溯表状态分布 | fig_trace_state.svg | book/data/status.json<br>docs/traceability.csv | trace:update 结果 |
| 图 15 | 竞品能力矩阵 | fig_competitor_matrix.svg | docs/sources.md E20—E30 | 已核实／未核实／需自建分开标注 |
| 图 16 | 市场证据边界 | fig_market_boundary.svg | docs/sources.md E07、E08、E09、E13、E14、E19 | 变量依赖与证据状态；不给点估计 |
| 图 17 | 三条商业模式对比 | fig_business_model.svg | docs/_work/business_model.params.json<br>docs/policy_card.md 第十节 | 付费方／价值／条件／证据／首个验证动作 |
| 图 18 | 路线图阶段闸门 | fig_roadmap_gates.svg | book/chapters/08_roadmap.md<br>docs/_work/test_layers.md | S1—S5 通过条件与依赖；不编造日期 |
| 图 19 | 优惠类型与约束 | fig_offer_scope.svg | fixtures/cases/cB_topk.json | D17、D45、V-03 |
| 图 20 | 每日参考与情景可用性 | fig_daily_reference.svg | book/data/flows/01_cB_topk_main.json<br>book/data/flows/04_cA_gap_living.json<br>book/data/cases/c00_v1_living_not_provided.json | R018、R019、D26、D27、D59 |
| 图 21 | Holt 预测参数与判定 | fig_holt_grid.svg | docs/rules.md §6、§7.2<br>src/engine/holt/ | D24、D25、D50、SG-49 |
| 图 22 | 预测条目状态 | fig_forecast_status.svg | book/data/cases/cB_topk.json | D24、D76 |
| 图 23 | 三类状态与计划状态取值 | fig_plan_state_tree.svg | docs/rules.md §11 | §11.1—§11.3 |
