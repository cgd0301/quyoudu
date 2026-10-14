# 向量预检分诊

组号｜签名｜涉及向量｜分类｜依据｜建议

1｜labels includes｜T016-07、T018-08#1｜S｜T016「C03标注与C04同价」：R016第6条「重复记录同一组合不得用于凑数」与第7条「同价标注并列」对相同明细都成立。T018「显示历史不足」；§11.4文案为「历史不足」，未写必须入labels。｜两条分开看；先不改向量
2｜action_list[cost_item_id=*].pending_checks includes｜T020-09｜S｜原文「行动清单保留购买前核价和条件复核事项」。R017第7条「待核价条件」。oracle仅RECHECK_PRICE，本例offers为空。条文未写是否必须再加条件复核。｜先不改；确认无优惠时是否还要条件复核
3｜candidates[candidate_id=*].tie_group not_eq｜T016-07｜S｜原文「C03标注与C04同价」。R016第6条「重复记录同一组合不得用于凑数」，第7条「同价标注并列」「末位同价不突破K」。两条明细相同，两边各取一条。｜先不改；确认相同明细的两个编号算同价还是重复组合
4｜cost.possible_refund.amount.value eq｜T012-02｜O｜原文「150写入 cost.possible_refund（金额150、条件为平台审核通过）」。§12.5「possible_refund{amount, condition}或null」。oracle为null。｜先不改向量；取消后的条件退款应写入 possible_refund
5｜cost.possible_refund.condition eq｜T012-02｜O｜原文「条件为平台审核通过」。§9「condition 为条件；没有则为 null」；§11.1「可能退回的金额及条件」。oracle该字段为null。｜同组4，先不改向量
6｜daily_reference.unavailable includes｜T019-09｜S｜原文「按§7.1不可用（历史不足）」且「9/15为MISSING」。§7.1「不足30个完整历日」；R018异常另有「记录不完整」。两条都符合，未写谁优先。oracle为RECORDS_INCOMPLETE。｜先不改；缺记录且不足30日时先定原因优先级
7｜forecasts[series_id=*].sample_count eq｜T008-05｜O｜原文「8月记录超出范围，不进入统计；可用历史为0」。R008「不把2026-09-01之前的其他记录当作观察窗口」。oracle的history_end为2026-08-25，sample_count=1。｜先不改向量；范围外日期不应计入样本
8｜nodes[trigger.event_ids=*].related includes｜T004-07｜O｜原文「相关项目为该收入及其建立的生活预留」。D37「相关项目为该收入及其建立的预留或计划分配」。oracle的related只有E-INC，没有该预留。｜先不改向量；related 应包含该收入建立的预留
9｜states.plan_state eq｜T005-03｜O｜原文「退款不进入时间轴」「计划状态＝按当前假设可行」。R005「不得靠该笔入账得出可行结论」；§10.2「金额、日期和条件均明确的进入假设时间线」；§11.1「检查期间内全部节点通过」。oracle标INCOMPLETE。｜先不改向量；未知退款不应把已通过节点打成无法判断

## 第 2 轮

向量 152／152，断言 1004／1004（跳过 0），运行错误 0。失败分组 0。无剩余失败组，没有可按 V／T／S／X／O 归类的条目。
