# 向量预检裁决

组号同 precheck_triage.md；依据只取 docs/rules.md 条文与各向量 source_text，oracle 行为只看 .cache/oracle-out/ 输出。与初分诊相比只改组3（S→V）。

组号｜最终分类｜裁决理由｜处理

1｜S｜§12.5 labels「标签代码；…与§11.4原文一致」；§11.4「“历史不足”（D24、§7.1）」「同价方案标注“同价”」。仅D62规定labels必含代码，未定这两项须进labels还是只在tie_group、unavailable_reason表达。｜读法A（向量）：结果中出现§11.4文案，就在labels给对应代码。T018-08#1含HISTORY_INSUFFICIENT（9/1案例都会带上）；可行候选出现同价时含SAME_PRICE（cB_topk的C06、C07会显示“同价”）。读法B（oracle）：同价只用candidates[].tie_group表达，情景历史不足只用scenarios[].unavailable_reason表达，HISTORY_INSUFFICIENT标签只随预测出现；两条labels断言登记争议、单条跳过。推荐A：只多披露限制，不涉及数字，结论不更乐观；也与T010-07「近月情景与价格预测显示“历史不足”」一致。T016-07须先按组3改输入，否则两种读法下都不该有SAME_PRICE。

2｜S｜source_text「行动清单保留购买前核价和条件复核事项」。R017第7条只写「待核价条件」；R020第9条「活动窗口、付款日期、资格和其他必要条件仍须独立完整」。条文未写没有优惠时是否另列条件复核。｜读法A（向量）：已确认的预测估算在购买前仍须复核窗口、资格、库存等条件，pending_checks含RECHECK_PRICE与RECHECK_OFFER_CONDITIONS。读法B（oracle）：条件复核只对应优惠条件，本例offers_used为空，只列RECHECK_PRICE；该断言登记争议、单条跳过。推荐A：多一项购买前复核，不改任何数字，结论不更乐观。A下另需团队定：沿用名称含OFFER的RECHECK_OFFER_CONDITIONS表示一般条件复核，还是新增代码（改枚举）。

3｜V｜source_text「可行候选净支出…C03=870、C04=870…C03标注与C04同价」要两个不同组合同价；但输入中C04与C03逐字段相同，按R016第6条「重复记录同一组合不得用于凑数」和T016-08「…与C02完全相同…视为重复记录」，oracle排除C04符合条文。｜expect不改（与source_text一致），错在input：把candidates[candidate_id=C04].items[0].channel改成与C03不同的渠道（如“渠道丁”），price仍为87000，使C04成为同价的另一组合（input不在AGENTS.md禁改范围）。改输入会使该向量的oracle指纹过期，需人工更新oracle输入后再对拍；预期本组随之通过（oracle对真实同价共用tie_group，如cB_topk的C06、C07）。同一向量的SAME_PRICE断言按组1裁决。

4｜O｜source_text「150写入 cost.possible_refund（金额150、条件为平台审核通过），不入账」。§9.4「amount 为金额，condition 为条件；没有则为 null」；§11.1已取消须显示「可能退回的金额及条件」。输入有E-RF，oracle为null。｜违反§9.4和§11.1“已取消”行。应得：cost.possible_refund.amount.value=15000（E-RF金额）；condition见组5。该款仍不入账、不进时间轴（向量中这两条断言已通过）。

5｜O｜同组4：E-RF的trigger_condition为「平台审核通过」；R012「继续保留已付金额、退款条件、不可退费用…」；D61「可能退款仍不入账（T012-02）」。oracle整个possible_refund为null，condition也就缺失。｜违反§9.4、R012。应得：cost.possible_refund.condition="平台审核通过"（E-RF.trigger_condition原文），与组4同一处修复。

6｜S｜§7.1「使用as_of之前最近30个完整历日」「各日明确为记录完整或确认无支出」「不足30个完整历日时…不按该建议配置自动生成完整近月消费情景」；R018异常分列「历史不足、记录不完整」。“完整历日”可读作记录完整的日，也可读作整个自然日，条文未定。｜读法A（向量，T018-02同读）：完整历日＝COMPLETE或NO_SPEND的日，范围内只有29个，按§7.1不足30，reason=HISTORY_INSUFFICIENT。读法B（oracle）：窗口固定为as_of前30个自然日（9/1—9/30），9/15缺记录，reason=RECORDS_INCOMPLETE。两种读法下近月情景都不可用，D=100、CONFIRMED_ONLY相同，只差原因代码。推荐A：10/1案例结论相同；演示外更晚的as_of下，A可跳过缺记录日凑满30日而给出近月情景，主展示取较低者，D不会高于B；且用的是§11.4固定文案「“历史不足”（D24、§7.1）」，追溯表不用改。若选B：追溯表T019-09「（历史不足）」改为「（记录不完整）」，T018-02「少于§7.1的30个门槛」同步改写，向量source_text与expect随之更新（需团队授权）。

7｜O｜source_text「8月记录超出范围，不进入统计；可用历史为0」。R008「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」；R020输出含「历史窗口及有效样本数」。oracle已报OUT_OF_RANGE，仍以8/25为history_end、sample_count=1。｜违反R008的观察窗口限制。应得：forecasts[series_id=S-LODGING].sample_count=0，history_end不应为2026-08-25，horizon也不应从8/25起算；status仍为HISTORY_INSUFFICIENT（已通过）。

8｜O｜source_text「按D37为分配冲突100，相关项目为该收入及其建立的生活预留」。D37「相关项目为该收入及其建立的预留或计划分配」，§10.4第3步同文。oracle的related只有E-INC，R-LIV-0908只出现在金额basis中。｜违反D37、§10.4第3步。应得：nodes[trigger.event_ids=E-INC].related同时含E-INC与R-LIV-0908；constraint_issues.allocation_conflicts中该条的related同理。

9｜O｜source_text「退款不进入时间轴…节点通过；计划状态＝按当前假设可行」。R005「金额、日期或必要条件未知时，不得靠该笔入账得出可行结论」只禁止依赖该款；§11.1可行为「检查期间内全部节点通过，预算检查和分配检查通过」。不计该款时均已通过，oracle仍判INCOMPLETE。｜违反R005（把“不得依赖”扩大成“无法判断”）。另据§12.1「null表示规格允许的“未知或未填写”：事件的金额与预计时间（R005）」，金额未知不是输入缺失；R010「共同资金信息缺失影响全部依赖该信息的候选」，C01不依赖E-DEP。应得：states.plan_state=FEASIBLE_UNDER_ASSUMPTIONS；input_issues不因E-DEP报MISSING_KEY_INFO；dependencies不含E-DEP（已通过）；optimization_state也不应因此为PARTIALLY_EVALUABLE。

## ① 需要团队拍板的 S 组

- 组1：§11.4 的“同价”“历史不足”是否必须进顶层 labels。推荐 A（进）。会改画面：9/1 演示案例都带“历史不足”，cB_topk 显示“同价”。
- 组2：没有优惠时，已确认预测估算的行动清单是否另列条件复核；若列，沿用 RECHECK_OFFER_CONDITIONS 还是新增代码。推荐 A（列）。
- 组6：缺记录使完整历日不足 30 个时，原因记“历史不足”还是“记录不完整”。推荐 A（历史不足）。

## ② T 组（会改追溯表）

- 无。组6若团队选 B，才需改 T019-09 的「（历史不足）」并改写 T018-02 的理由句。

## ③ oracle 和向量都错的组

- 组3（连带组1中的 T016-07）：向量输入把 C04 写成了 C03 的重复记录，向量必须改；若组1按 A 裁决，oracle 在真实同价时（cB_topk 的 C06、C07，T020-05、T020-06 等）也不输出 SAME_PRICE，oracle 同样要改。
- 其余各组只有一边有误。
