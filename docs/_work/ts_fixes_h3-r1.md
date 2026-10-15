当前值取自本次计算输出。应得结果只按条文说明，不补条文里没有的数。

T-01｜T015-08/final｜input_issues｜[{"code":"MISSING_KEY_INFO","refs":["snapshot.cash"]},{"code":"NO_PLAN","refs":["G1"]}]｜§12.1「null表示规格允许的“未知或未填写”：……现金与预算（§11.1）」；§11.1「关键费用、付款时间、资金信息、预算或优惠条件缺失（R010）」且「同时成立的其他问题仍须分别列明（R010）」｜goal.budget_cap 为 null 时另报一条 MISSING_KEY_INFO，refs 为 goal.budget_cap。已经成立的其他问题仍各自列出。｜M1
T-02｜T008-05/final｜candidates[candidate_id=C01].evaluable｜false｜R008「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」；R010「只限制依赖该数据或配置的输出，不自动使其他完整候选或基础检查失效」；D13「有效参考价（标“估算”）」｜早于 2026-09-01 的价格或消费记录不进入观察窗口，也不使本候选待确认。该候选有有效参考价时按 D13 评估，不记 SHARED_INPUT_INCOMPLETE。｜M5
T-03｜T008-05/final｜optimization｜{"evaluated_count":0,"pending_count":1}｜R010「不自动使其他完整候选或基础检查失效」｜该候选可以评估时，计入已评估数，不计入待确认数。优化状态随之按 §11.2 重算。｜M5
T-04｜T008-05/final｜check_period.out_of_range｜true｜D04「按上述规则应取的收入日晚于2027-01-01」或「该日期或任一必要事件晚于2027-01-01」时才超界；R008「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」｜检查期间终点未晚于 2027-01-01、也没有必要事件晚于该日时，out_of_range 为 false。早于 2026-09-01 的记录只是不进入观察窗口。｜M3
T-05｜T002-03/final｜cost.pending_cost_item_ids｜[]｜R010「必要费用区分已填、估算、待填和明确不适用，不能默认0」；R016 第1条「每个候选须覆盖完成同一目标所需的全部必要费用」｜计划对象缺少必要项目的金额时，该项目列入 cost.pending_cost_item_ids。本检查点选中的候选没有门票价格项。｜M4
T-06｜T008-04/final｜cost.pending_cost_item_ids｜[]｜R016 第1条「每个候选须覆盖完成同一目标所需的全部必要费用」｜同 T-05。｜M4
T-07｜T012-02/final｜states.underlying_plan_state｜"INCOMPLETE"｜D61「已取消的底层检查从释放未使用的 A 之后的快照开始，只计入 cancellable 不为 true 的尚未发生付款，以及生活安排」；D47「已取消：底层检查从释放A之后的快照开始，只计仍有效义务和生活安排」｜未购买的门票不是仍有效义务，不使底层检查变为暂无法完整判断。底层状态只按仍有效义务和生活安排判定。｜M4
T-08｜T012-02/final｜cost.net_spend｜null｜D61「只计入 cancellable 不为 true 的尚未发生付款，以及生活安排」｜净支出只计仍有效义务和生活安排，不因未购门票待填而留空。｜M4
T-09｜T012-02/final｜cost.future_payable｜null｜D61「只计入 cancellable 不为 true 的尚未发生付款，以及生活安排」｜后续应付同样只计仍有效义务，不因未购门票留空。｜M4
T-10｜T020-05/final｜forecasts[status=BACKTEST_INSUFFICIENT].predicted｜null｜§6「模型输出须保存：……预测中间值及最终整数分金额；回测起点、步长、有效数量和误差」；§7.2「不足时显示该步长回测不足，按R009处理有效价格参考或缺失状态」｜回测不足只表示该步长不再用于候选比较。预测中间值仍要保存，不改为 null。T020-06、T020-10#2 的回测不足条目同此。｜M8
T-11｜T020-05/final｜forecasts[status=BACKTEST_INSUFFICIENT].amount｜null｜§6「预测中间值及最终整数分金额」；§7.2「不足时显示该步长回测不足」｜回测不足时仍保存转为整数分的预测金额。是否用于候选比较由状态表示，不把 amount 改成 null。｜M8
T-12｜T020-07#2/final｜forecasts[status=INVALID_RESULT].predicted｜null｜§6「预测中间值及最终整数分金额」；R020 第11条与 §7.2「停止相应预测成本使用」｜结果无效时停止把该预测用作成本，amount 保持 null。预测中间值仍要保存，不改为 null。｜M8
T-13｜T020-07#2/final｜forecasts[status=INVALID_RESULT].backtest_mae｜"30196.373516103225"｜D25「每个量按其公式算出后保留12位小数」；D50 两端为 34 位有效数字、ROUND_HALF_UP｜MAE 按 D25：φ 的幂和、一步预测、误差平方等每个中间量先保留 12 位小数，再汇总。不要在回测预测里把整段幂和留到更后才一次性舍入。｜M8
T-14｜T001-06/final｜input_issues｜[{"code":"AS_OF_FORMAT","refs":["as_of"]},{"code":"CASH_AS_OF_MISMATCH","refs":["cash_as_of"]}]｜§12.7（13）「as_of 或 cash_as_of 不符合 D03 格式时只报 AS_OF_FORMAT，不再判断两者是否对应；两者都能解析时才比较，不对应报 CASH_AS_OF_MISMATCH」｜as_of 缺少时区偏移时只报 AS_OF_FORMAT，不再报 CASH_AS_OF_MISMATCH。｜M1
T-15｜T001-07#2/final｜input_issues｜[{"code":"SNAPSHOT_PHASE_MISMATCH","refs":["E1"]}]｜§12.7（14）「D03 列出的三种快照冲突情形各报一条 SNAPSHOT_PHASE_MISMATCH，同一情形只报一次。快照阶段与计入标记不符的 refs 为 snapshot.snapshot_phase」；D03「快照阶段与计入标记不符；……已实际发生且实际时刻不晚于cash_as_of的事件未计入快照」｜阶段计数不符与未计入快照是两种情形，各报一条。阶段不符的 refs 为 snapshot.snapshot_phase；未计入的 refs 为相关事件编号。｜M1
T-16｜T019-10/final｜states.plan_state｜"INCOMPLETE"｜§12.7（15）「已确认方案中 price_basis 为 FORECAST、且有同 series_id 与 purchase_date 的 forecast_confirmations 的价格项，计划检查、行动清单和每日参考按该确认的 price 计算。当前序列缺失或不再合格时不改为待填」｜计划检查使用该确认的 price，不因当前序列缺失改成待填，也不因此变成暂无法完整判断。｜M4
T-17｜T019-10/final｜input_issues｜[{"code":"MISSING_KEY_INFO","refs":["PLAN:C01:0:TICKET"]}]｜§12.7（15）「当前序列缺失或不再合格时不改为待填，只在 forecasts[] 和待确认差异中体现」｜不为这条已确认预测另报价格缺失。序列问题写在 forecasts[] 和待确认差异里。｜M1
T-18｜T019-10/final｜cost.net_spend｜null｜§12.7（15）「计划检查、行动清单和每日参考按该确认的 price 计算」｜净支出按该确认的 price 计算，不因序列缺失留空。｜M4
T-19｜T019-10/final｜action_list｜[{"cost_item_id":"TICKET","amount":null,"pending_checks":["RECHECK_PRICE"]}]｜§12.7（15）「行动清单……按该确认的 price 计算」；§12.7「即使没有优惠，pending_checks 也须同时包含 RECHECK_PRICE 与 RECHECK_OFFER_CONDITIONS」｜行动清单金额取该确认的 price。pending_checks 同时含 RECHECK_PRICE 与 RECHECK_OFFER_CONDITIONS。｜M6
T-20｜T019-10/final｜daily_reference.display｜"UNAVAILABLE"｜§12.7（15）「每日参考按该确认的 price 计算。当前序列缺失或不再合格时不改为待填」｜每日参考按该确认的 price 计算，不因序列缺失显示暂无法给出建议金额。｜M7
T-21｜T008-04/final｜candidates[candidate_id=C01].pending_reasons｜[{"code":"SHARED_INPUT_INCOMPLETE"},{"code":"PRICE_PENDING"}]｜§12.7（20）「pending_reasons 先列价格项原因，后列 SHARED_INPUT_INCOMPLETE；同类按 refs 的字典序」｜价格项原因在前，SHARED_INPUT_INCOMPLETE 在后。｜M5
T-22｜T010-09/②｜candidates[candidate_id=C01].excluded_reasons｜[{"code":"PAYMENT_GAP"},{"code":"BUDGET_EXCEEDED"}]｜§12.7（20）「excluded_reasons 按 R016 第2条的检查次序排列：相容性、优惠、预算（BUDGET_EXCEEDED）、付款节点（PAYMENT_GAP、ALLOCATION_CONFLICT）」｜BUDGET_EXCEEDED 排在 PAYMENT_GAP 之前。｜M5
T-23｜c01_base/final｜forecasts｜缺少该键｜§12.7（26）「forecasts 总是输出；没有可生成的条目时为 []，不省略」｜没有可生成的预测条目时输出空数组。其余省略该键的检查点同此。｜M8
T-24｜T006-01/final｜labels｜["SIMULATED_DATA","TOP_K_DEMO","DRAFT_PREVIEW","PREVIEW_UNCONFIRMED","HISTORY_INSUFFICIENT"]｜§12.7（30）「检查期间内存在由流出或流出组触发的保护性资金缺口节点时，labels 含 PROTECTED_SQUEEZE。文案中的金额取其中最早一个这种节点的 -U」；§11.4「由付款引起的保护性资金缺口：“这笔付款会挤占生活、机动等保护性预留 X 元”，X取该节点的-U（D34）」｜本检查点已有由流出触发的保护性资金缺口节点。labels 含 PROTECTED_SQUEEZE，金额取最早一个这种节点的 -U。T019-05 等同此。｜M4
