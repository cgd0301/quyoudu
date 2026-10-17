# 核心计算逻辑

## 资金分区与本目标分配

任一节点上，把现金 C 拆成：生活预留 L、机动预留 M、其他保护性预留 N 与第二目标固定占用 O、本目标分配 A，其余为未分配资金。由此定义：

- 本目标可用 G = C − L − N − O
- 付款空间 H = G − M
- 可额外支出 U = H − A

本目标付款先按覆盖关系核销预留 q（每项不超过对应剩余额），剩余部分 r = x − q 先冲减 A，仍不足才使用未分配资金；不属于本目标的支出只能用未分配资金，不得挪用 A 或保护资金（D06、D07）。

![资金分区（快照）](../figures/fig_funding_partition.svg)

以 `c01_base` 的快照为例，现金合计 <!-- data: cases/c01_base.json#checkpoints.0.result.snapshot.cash.value | cents --> 元，其中生活预留 <!-- data: cases/c01_base.json#checkpoints.0.result.snapshot.living_reserve.value | cents --> 元、机动预留 <!-- data: cases/c01_base.json#checkpoints.0.result.snapshot.contingency_reserve.value | cents --> 元、本目标分配 <!-- data: cases/c01_base.json#checkpoints.0.result.snapshot.goal_allocation.value | cents --> 元、未分配资金 <!-- data: cases/c01_base.json#checkpoints.0.result.snapshot.unallocated.value | cents --> 元。

## 节点判定与缺口

每个节点依次判定（D05、D36）：

1. 若 L + N + O + M > C，为**保护性资金缺口**，界面金额为该节点的 −U，并分列"保护性预留超出现金"与"本目标分配无现金支撑"两项依据（D34）。
2. 否则若 U < 0，按引起 U 下降的原因分为**分配冲突**（快照、用户修改分配或预留、收入节点建立预留）或**付款缺口**（某笔流出之后）。
3. 其余为通过。

最早缺口只取检查期间内第一个保护性资金缺口或付款缺口；U 已为负但未继续下降的节点标"缺口延续"，金额一律为该节点 −U（D11、D35）。在主线流程中，最早缺口出现在 <!-- data: flows/01_cB_topk_main.json#checkpoints.0.result.earliest_gap.at -->，金额 <!-- data: flows/01_cB_topk_main.json#checkpoints.0.result.earliest_gap.amount.value | cents --> 元，类型为 <!-- data: flows/01_cB_topk_main.json#checkpoints.0.result.earliest_gap.node_verdict -->。

## 成本、付款与净支出

净支出按候选分支计算：P（已付）+ F（后续应付）− R（可计入的返还），优惠按订单落到具体付款上（D45、D65），返现只有"付款即返、金额与日期明确、不依赖后续行为"才计入 R（D12、D42）。金额全程整数分，不使用浮点（R007）。

![费用组成（主线流程）](../figures/fig_cost_composition.svg)

主线流程的净支出为 <!-- data: flows/01_cB_topk_main.json#checkpoints.0.result.cost.net_spend.value | cents --> 元，其中门票 <!-- data: flows/01_cB_topk_main.json#checkpoints.0.result.cost.future_payments.0.amount.value | cents --> 元。

## 信息不足时的取舍

关键费用、预算、付款时间、资金信息或优惠条件不全，或关键报价过期、必要事件超界时，计划状态统一为"暂无法完整判断"，并允许附已确认的局部缺口（R010、§11.1）。这条规则优先于给出结论：宁可说不出结论，也不给出乐观但错误的结论。
