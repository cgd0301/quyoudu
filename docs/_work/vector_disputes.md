# 向量争议

登记认为向量预期有误的断言。列：向量编号｜断言路径｜预期｜实际｜依据条款｜理由｜状态。团队授权改写 expect 后，把该条标为已裁决。不得据此跳过整个向量。

| 向量编号 | 断言路径 | 预期 | 实际 | 依据条款 | 理由 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T017-01 | final labels includes DRAFT_PREVIEW | 只断言“草案预览” | 同时断言 DRAFT_PREVIEW 与 PREVIEW_UNCONFIRMED | D62 | 未确认方案的资金日历两句都显示 | 已裁决 |
| T017-02 | 确认 confirmation.input_version not_eq v1 | 只要求不等于 v1 | 断言等于 v2，且确认状态为 CONFIRMED | D63 | 复查通过后直接按当前版本确认 | 已裁决 |
| T003-03 | final cost.future_payments / paid_payments | 行文写计入 P，向量未断言 | 80 元在后续应付中，不在已付中 | §3 | 9 月 1 日看，9 月 20 日的支出尚未发生 | 已裁决 |
| T012-02 | final cost.possible_refund | 行文要求显示可能退回，结果没有字段 | 金额 15000 分，条件为平台审核通过 | §11.1 | 取消页要能写出可能退回的金额和条件 | 已裁决 |
| T016-07 | final labels includes SAME_PRICE | 含 SAME_PRICE | 无此标签 | §12.7、§11.4 | 组1读法A：出现“同价”时顶层 labels 含 SAME_PRICE。须先按组3把 C04 改成另一渠道，才是真实同价。expect 不改。oracle 仍缺该标签，待 oracle 窗口修复 | 已修正（A4-0） |
| T018-08#1 | final labels includes HISTORY_INSUFFICIENT | 含 HISTORY_INSUFFICIENT | 无此标签 | §12.7、§11.4 | 组1读法A：出现“历史不足”时顶层 labels 含 HISTORY_INSUFFICIENT。expect 不改。oracle 仍缺该标签，待 oracle 窗口修复 | 已修正（A4-0） |
| T020-09 | final action_list[cost_item_id=LODGING].pending_checks includes RECHECK_OFFER_CONDITIONS | RECHECK_PRICE 与 RECHECK_OFFER_CONDITIONS | 只有 RECHECK_PRICE | §12.7、R020 | 组2读法A：已确认预测估算即使没有优惠，pending_checks 也同时含两项。沿用现有代码，不新增枚举。expect 不改。oracle 待窗口修复 | 已修正（A4-0） |
| T016-07 | final candidates[candidate_id=C03].tie_group not_eq null | 非 null | null | R016 第6、7条 | 组3：C04 与 C03 原为重复记录，已把 C04.items[0].channel 改为渠道丁，price 仍为 87000。C04 的 tie_group 断言预检未失败（路径不存在时 not_eq 仍通过）；改正后 C04 才是真实同价候选。expect、source_text、ops 不改。oracle 指纹过期，待人工导出后再对拍 | 已修正（A4-0） |
| T019-09 | final daily_reference.unavailable includes RECENT_MONTH / HISTORY_INSUFFICIENT | reason=HISTORY_INSUFFICIENT | reason=RECORDS_INCOMPLETE | §12.7、§7.1 | 组6读法A：完整历日（COMPLETE 或 NO_SPEND）不足 30 个时近月情景不可用，原因 HISTORY_INSUFFICIENT。expect 不改。oracle 仍为 RECORDS_INCOMPLETE，待 oracle 窗口修复 | 已修正（A4-0） |
| T012-02 | final cost.possible_refund.amount.value eq | 15000 | 不存在 | §9.4、§11.1 | 组4：E-RF 金额写入 possible_refund.amount，该款仍不入账、不进时间轴。expect 不改、不跳过。待 oracle 窗口修复 | 待修复（O组） |
| T012-02 | final cost.possible_refund.condition eq | 平台审核通过 | 不存在 | §9.4、R012 | 组5：condition 取 E-RF.trigger_condition 原文，与组4同一处修复。expect 不改、不跳过。待 oracle 窗口修复 | 待修复（O组） |
| T008-05 | final forecasts[series_id=S-LODGING].sample_count eq | 0 | 1 | R008 | 组7：8月记录超出观察窗口，sample_count=0；history_end 不应为 2026-08-25，horizon 也不从 8/25 起算；status 仍为 HISTORY_INSUFFICIENT。expect 不改、不跳过。待 oracle 窗口修复 | 待修复（O组） |
| T004-07 | final nodes[trigger.event_ids=E-INC].related includes R-LIV-0908 | 含 E-INC 与 R-LIV-0908 | 只有 E-INC | D37、§10.4 | 组8：related 同时含该收入及其建立的生活预留；constraint_issues.allocation_conflicts 中该条的 related 同理。expect 不改、不跳过。待 oracle 窗口修复 | 待修复（O组） |
| T005-03 | final states.plan_state eq | FEASIBLE_UNDER_ASSUMPTIONS | INCOMPLETE | R005、§11.1、§12.1 | 组9：不计未知退款时节点已通过，计划状态为按当前假设可行；不因 E-DEP 报 MISSING_KEY_INFO；optimization_state 不因此为 PARTIALLY_EVALUABLE。dependencies 不含 E-DEP 的断言已通过。expect 不改、不跳过。待 oracle 窗口修复 | 待修复（O组） |

前四条已按团队授权改写 expect，不跳过。A4-0 各行的 expect 均不改、不写入 tests/vector-disputes.json，故不跳过：标“已修正（A4-0）”的已写入 rules.md 或改正输入；标“待修复（O组）”的应得行为待 oracle 窗口修复。改 rules.md 与 T016-07 输入后 oracle 指纹过期，须人工导出后再对拍。
