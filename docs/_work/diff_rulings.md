# 对拍差异裁决

对象为 docs/_work/diff_report.md（1842 行）。依据只取 docs/rules.md 条文；oracle 的行为只看 .cache/oracle-out/ 输出，TS 的行为看 .cache/ts-out/。同一差异模式合并为一条，括号内为报告行数或检查点数；1842 行全部归入下列 44 条。

条目｜结论｜依据｜推荐写入 §12.7 的统一约定（仅“未规定”）

1 states.plan_target：没有已确认方案、也没有 SELECT_CANDIDATE 时，TS 取 NONE 并报 NO_PLAN；oracle 只要 events[] 或 cost_items[] 非空就取 INITIAL_DRAFT，随之生成机动预留释放节点（cB_* 的 nodes[11] 起因此错位）、把未定价的必要项目列入 cost.pending_cost_item_ids、把 T003-03、T003-06、T006-06#1 判为按当前假设可行（252 行，53 个检查点，含 cA_gap、cB_*）｜未规定｜D47「计划状态所针对的方案：已确认方案 > 当前选中的候选 > 用户初始描述形成的草案。三者都没有时为“暂无法完整判断”，原因为尚未形成方案」；§12.2 CaseFile 没有表示该草案的字段；§12.7「events[] 中的收付款是所有候选共同的」「计划对象（D47）的时间轴＝全部共同事件＋该候选的价格项与返还＋引擎生成的机动预留释放」，没有说共同事件或费用清单本身构成草案｜CaseFile 不单独表示“用户初始描述形成的草案”，用户描述的方案写成候选（同 SG-37）；没有 confirmed_plan 且未执行 SELECT_CANDIDATE 时 plan_target 为 NONE，input_issues 报 NO_PLAN，计划状态为暂无法完整判断（尚未形成方案）；时间轴只含共同事件，不生成机动预留释放（D73）；此时 cost.pending_cost_item_ids 只列 amount_status 为 PENDING 的必要项目。已分发（r1）

2 nodes：两边 plan_target 都是 NONE，oracle 仍在活动结束日次日生成 AUTO:CONTINGENCY_RELEASE 节点（8 行：c01_base、T001-01、T004-03、T008-01、T013-02 三个检查点、T015-07）｜oracle 错｜D73「引擎只在有计划对象（D47）、且 reserves[] 中有 CONTINGENCY 预留时生成机动预留释放；没有计划对象时时间轴只含共同事件，不生成（§12.7）」｜—已分发（r1）

3 input_issues 与 nodes：选中候选的价格项金额待填（price 为 null）时，TS 报 MISSING_KEY_INFO 并在该笔付款处截断；oracle 不报，跳过该笔继续执行，还生成其后的机动预留释放节点（12 行：T009-07、T010-01、T010-03、T010-09①、T013-04、T020-08#2）｜oracle 错｜§12.7「candidates[].items[] 是该候选特有的价格项，每项在 payment_at 形成一笔本目标付款」；D74「时间轴遇到金额或日期未知（含无法解析）或金额为负的流出时，报 MISSING_KEY_INFO（R010），局部检查在该笔处截断：按 §10.2 排在它之前的节点照常判定，该笔及其后的事件不再执行和判定」｜—已分发（r1）

4 nodes[0].at：T001-06 的 as_of 原文为“2026-09-01 09:00”，TS 原样写出，oracle 改写为“2026-09-01T09:00:00+08:00”（1 行）｜oracle 错｜§12.7「节点的 at：起始节点取 as_of 原文…不做格式转换」；同一检查点的 check_period.start 两边都取原文｜—已分发（r1）

5 nodes[1].at：T017-06 已确认方案的高铁付款 payment_at 为 2026-09-10，as_of 为 9/11，逾期未付；TS 写“2026-09-10”，oracle 写 as_of 时刻（1 行）｜oracle 错｜§12.7「价格项触发的节点取其 payment_at 原文；不做格式转换」；§10.1 第7步「逾期流出按as_of时刻立即发生处理…记录的预计日期不变」只改执行位置，不改节点 at 的取值｜—已分发（r1）

6 input_issues：T005-03 的押金退款金额未知（RETURN，amount 为 null），oracle 报 MISSING_KEY_INFO，计划状态却仍为按当前假设可行；TS 不报（1 行）｜oracle 错｜D74「金额或日期未知的流入不计入，也不报问题（R005）」；按 §11.1，关键信息缺失属于暂无法完整判断的触发条件，oracle 的报告与它自己的计划状态也不一致｜—已分发（r1）

7 input_issues[1]：T015-08 的 goal.budget_cap 为 null，oracle 报 MISSING_KEY_INFO（refs goal.budget_cap），TS 不报预算缺失（该位置 TS 为 NO_PLAN，NO_PLAN 的取舍见第1条）（1 行）｜TS 错｜§12.1「null表示规格允许的“未知或未填写”：…现金与预算（§11.1）」；§11.1 暂无法完整判断的触发条件含「关键费用、付款时间、资金信息、预算或优惠条件缺失（R010）」，界面「列出缺失或冲突原因」，且「同时成立的其他问题仍须分别列明（R010）」｜—已分发（r1）

8 input_issues：T001-06 的 as_of 缺少时区偏移，cash_as_of 带 +08:00；TS 报 AS_OF_FORMAT 与 CASH_AS_OF_MISMATCH，oracle 只报 AS_OF_FORMAT（1 行）｜未规定｜D03「as_of缺少时区偏移或缺少快照阶段时，按R001、R010视为输入冲突」；§11.1 分列「cash_as_of与as_of不对应（R001）、as_of格式不符（D03）」，没有说 as_of 无法解析时是否还要判断“不对应”｜as_of 或 cash_as_of 不符合 D03 格式时只报 AS_OF_FORMAT，不再判断两者是否对应；两者都能解析时才比较，不对应报 CASH_AS_OF_MISMATCH。已分发（r1）

9 input_issues：T001-07#2 的快照阶段为 AFTER_EVENT(1)，而当日 8:00 已实际发生的 E1 未计入快照；TS 报一条 SNAPSHOT_PHASE_MISMATCH（refs E1），oracle 报两条（refs 分别为 E1、snapshot.snapshot_phase）（1 行）｜未规定｜D03 把「快照阶段与计入标记不符」「已实际发生且实际时刻不晚于cash_as_of的事件未计入快照」列为不同的输入冲突情形，§11.1 要求「同时成立的其他问题仍须分别列明」，但没有规定 input_issues 的条目粒度｜D03 的三种快照冲突情形各报一条 SNAPSHOT_PHASE_MISMATCH：阶段计数不符的 refs 为 snapshot.snapshot_phase，计入标记不符的 refs 为相关事件编号；同一情形只报一次。已分发（r1）

10 T005-06 的候选、成本、时间轴与状态：C02 的住宿 price_basis 为 FORECAST（550 元），forecast_confirmations 有 S-LODGING 的确认，但 price_series 为空；TS 判价格待填（PRICE_PENDING、MISSING_KEY_INFO，暂无法完整判断，部分可评估）；oracle 按 550 元计入（9/27 保护性资金缺口，C02 以 PAYMENT_GAP 排除，未找到已知可行方案，并给出 cost.net_spend、future_payable、future_payments、earliest_gap、gap_list）（17 行）｜oracle 错｜D13「已确认的合格预测…“合格”指满足§7.2的样本门槛和回测门槛」；§12.7「序列中有观测与候选价格项的 cost_item_id、channel、spec 都相同时，按该价格项的 purchase_date 为该序列生成一条 forecasts[] 条目」，没有观测就没有可确认的合格预测；R016 第3条「预测估算须满足R020并经确认」；C02 没有其他价格依据，按 D13 依次下推为待填｜—已分发（r1）

11 T019-10 的全部差异：已确认方案 C01@v1 的门票 price_basis 为 FORECAST（600 元），forecast_confirmations 有 S-TICKET 的确认，但 price_series 为空；TS 判待填（暂无法完整判断，部分可评估，行动清单金额为 null 且只列 RECHECK_PRICE，每日参考为“暂无法给出建议金额”）；oracle 按 600 元计算（按当前假设可行，行动清单 600 元并列两项复核，D=100 元，依赖条件 CONFIRMED_FORECAST）（26 行；其中两条已登记为待团队裁决的向量争议）｜未规定｜条文在“已确认方案的预测序列缺失”时冲突：D13 与 §12.7 要求合格预测有对应观测（支持 TS）；§10.5 第3步「方案金额取已确认方案版本」、R017 第10条「须保留已确认方案原依据和版本，显示待确认差异，不静默改写正式行动安排」（支持 oracle）｜已确认方案中 price_basis 为 FORECAST、且有同 series_id 与 purchase_date 的 forecast_confirmations 的价格项，计划检查、行动清单和每日参考按该确认的 price 计算，当前序列缺失或不再合格时不改为待填，只在 forecasts[] 和待确认差异中体现（§10.5 第3步、R017 第10条）；行动清单照 §12.7 同时列 RECHECK_PRICE 与 RECHECK_OFFER_CONDITIONS；candidates[] 的比较仍按 D13 判断。已分发（r1）

12 T008-05 的候选与优化：as_of 为 9/1，另有 8/25 的价格与消费记录；TS 因这些超范围记录把 C01 记为 SHARED_INPUT_INCOMPLETE 待确认（evaluable、feasible、net_spend、rank、tie_group 为 false 或 null，优化状态为部分可评估，evaluated_count 0、pending_count 1）；oracle 照常评估 C01（住宿参考价 400 元，可行，rank 1，已完成-有可行方案）（9 行）｜TS 错｜R008「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」；R010「历史不足、价格预测不可用和每日建议不可用分别说明；只限制依赖该数据或配置的输出，不自动使其他完整候选或基础检查失效」；C01 有有效参考价，按 D13 取「有效参考价（标“估算”）」，不依赖超范围记录｜—已分发（r1）

13 check_period.out_of_range：T008-05 中 TS 为 true，oracle 为 false，两边 end 都是 2027-01-01（1 行）｜TS 错｜§12.5「check_period | start、end、out_of_range（D04、D41、D56）」；D04 的超界只指「按上述规则应取的收入日晚于2027-01-01」或「该日期或任一必要事件晚于2027-01-01」；早于 9/1 的历史记录按 R008 只是不进入观察窗口，不影响检查期间｜—已分发（r1）

14 cost.pending_cost_item_ids：T002-03、T008-04 选中的 C01 没有门票价格项，两边都把 C01 记为 PRICE_PENDING；oracle 在 pending_cost_item_ids 列出 TICKET，TS 为空（2 行）｜TS 错｜R010「必要费用区分已填、估算、待填和明确不适用，不能默认0」；R016 第1条「每个候选须覆盖完成同一目标所需的全部必要费用」；计划对象缺少必要项目的金额时，该项目在成本结果中应列为待填｜—已分发（r1）

15 net_spend_if_received（cost 与 candidates[]）：没有依赖后续条件的返还时，TS 为 null，oracle 照抄 net_spend；有条件返现时两边一致（cB_topk 的 C05、cB_v5_cancel）（353 行，165 个检查点）｜未规定｜D12「依赖后续条件的返现不计入R，结果中另显示“若到账”时的净支出」只规定有条件返现的情形｜只有存在依赖后续条件、不计入 R 的返还（D12 的返现、带 trigger_condition 的 RETURN）时才给出 net_spend_if_received，取这些返还到账后的净支出；否则为 null，不显示“若到账”。已分发（r1）

16 candidates[].net_spend：两边都判为待确认（evaluable 为 false）的候选，TS 为 null，oracle 照算（10 行，如 T001-02、T006-06#2、T008-07、T017-06；T007-06#2 的 12345 分是没有扣该候选所用 9.5 折优惠的原价）｜未规定｜R011「只评估完整子集时，只能声称该已评估子集内的结果，不能覆盖仍待确认的候选」；R010「不可评估不等于已证实不可行」；条文没有规定待确认候选是否给出净支出。另按 R007「涉及优惠舍入时使用已知规则，未知则标记条件不完整」和 D17「rounding未知时该优惠条件不完整，依赖它的候选不能完整评估」，T007-06#2 的 12345 分不是该候选的净支出｜evaluable 为 false 的候选，net_spend 与 net_spend_if_received 一律为 null，不给出未完整评估的净支出。已分发（r1）

17 candidates[].net_spend.value：因超出优惠使用次数被排除的候选（T009-03#3 的 C03、T016-02 的 C02），TS 按不计该优惠的原价（600、1000 元），oracle 两次都扣减（560、900 元）（2 行）｜未规定｜R009「已确定不符合优惠条件的组合则明确排除」；D17 规定 max_uses，但没有规定被排除候选的净支出怎样算｜因优惠条件被排除（excluded_reasons 含 OFFER_*）的候选，net_spend 不计违规使用的优惠减免；其他确定性排除的候选照常按其组合计算。已分发（r1）

18 candidates[].pending_reasons：价格项已有 PRICE_PENDING、NON_CNY 或 QUOTE_EXPIRED 时，oracle 另加一条候选级 PRICE_PENDING（rule 为 R010/R016，refs 为候选与项目），TS 不加（14 行，如 T008-02、T009-01、T010-01、T020-12）｜未规定｜R011「列明本次比较范围、可评估数、待确认数及排除原因」只要求列明原因，没有规定同一价格项的原因报几条｜pending_reasons 每个价格项每种原因只报一条，refs 为该价格项的 cost_item_id；价格项已有 NON_CNY、QUOTE_EXPIRED、PRICE_PENDING 等原因时，不另加候选级 PRICE_PENDING。已分发（r1）

19 pending_reasons、excluded_reasons 的顺序：T008-04（PRICE_PENDING 与 SHARED_INPUT_INCOMPLETE）、T010-09②（PAYMENT_GAP 与 BUDGET_EXCEEDED）两边原因相同、先后相反（4 行）｜未规定｜R016 第2条「检查日期、地点、规格及用户要求是否相容，再执行优惠、预算及付款节点检查」只规定检查次序，没有规定原因列表的顺序｜excluded_reasons 按 R016 第2条的检查次序排列：相容性、优惠、预算（BUDGET_EXCEEDED）、付款节点（PAYMENT_GAP、ALLOCATION_CONFLICT），最后 DUPLICATE_CANDIDATE；pending_reasons 先列价格项原因、后列 SHARED_INPUT_INCOMPLETE；同类按 refs 字典序。已分发（r1）

20 candidates[].pending_reasons[0].code：T017-06 已确认方案的高铁价格项逾期未付，TS 记 PAYMENT_TIME_MISSING，oracle 记 SHARED_INPUT_INCOMPLETE（1 行）｜未规定｜R010「共同资金信息缺失影响全部依赖该信息的候选；某候选特有信息缺失只影响该候选」；D54 与 §10.1 第7步只规定逾期事件使计划状态为暂无法完整判断，待确认原因代码不在 rules.md 中（§12.3 指向 enums.ts）｜候选自身的价格项逾期未履行时，该候选计入待确认数，原因记 PAYMENT_TIME_MISSING（refs 为该价格项），不记 SHARED_INPUT_INCOMPLETE；只有快照、共同事件等共同输入有问题时才记 SHARED_INPUT_INCOMPLETE。已分发（r1）

21 T012-02 的底层检查与成本：已取消方案 C01 没有门票价格项，仍有效义务只有 9/15 的住宿付款 200 元；TS 因门票待填把 underlying_plan_state 判为暂无法完整判断，cost.future_payable、net_spend 为 null；oracle 只计仍有效义务，底层为按当前假设可行，后续应付与净支出 200 元，若到账 50 元（4 行）｜TS 错｜D61「已取消的底层检查从释放未使用的 A 之后的快照开始，只计入 cancellable 不为 true 的尚未发生付款，以及生活安排」；D47「已取消：底层检查从释放A之后的快照开始，只计仍有效义务和生活安排」；未购的门票不是仍有效义务，不应使底层检查和后续应付变为不完整｜—已分发（r1）

22 confirmation（待用户确认，或 CONFIRM 后只存为草案）：确认前模拟不是按当前假设可行时，TS 为 null，oracle 照 D46 算出 w、m、ΔA；可行时两边一致（36 个检查点，含 T017-08 的 CONFIRM 后 DRAFT）｜未规定｜§11.3 待用户确认须显示「拟发生的分配差额（D46、R017第2条）」；而 D46「确认前模拟的计划状态不是“按当前假设可行”时，只能存草案」，R017 第4条「不能包装成已经可执行的购买安排」「只能保存为“草案”，不写入正式分配」；条文没有说只能存草案时是否仍输出分配差额｜confirmation 只在确认前模拟为 FEASIBLE_UNDER_ASSUMPTIONS 时给出（待用户确认时的预览，或本次 ops 中已写入正式安排的 CONFIRM，含重复确认）；只能存为草案时为 null，界面按 §11.3 显示问题和风险，不显示拟发生的分配差额。已分发（r1）

23 confirmation（案例输入已确认、本次未执行 CONFIRM）：TS 为 null，oracle 按当前输入重算 w、m、ΔA 和计划分配（35 个检查点，含已暂停、已取消；如 c00_r019_minimal 给出 ΔA=200 元，而快照中的 A 已含确认时的分配）｜未规定｜D46 规定的是「确认时的建议分配额」；R017 第5条「同一目标、方案版本及确认操作重复提交时，不重复分配资金或重复生成任务」；§11.3 已确认只须显示「方案版本和输入版本」；条文没有说对已确认方案是否重算｜案例输入自带 confirmed_plan、本次 ops 没有执行 CONFIRM 时，confirmation 为 null，不按当前输入重算 w、m、ΔA；§11.3 已确认所需的方案版本取 candidates[].plan_version，输入版本取案例 confirmed_plan.input_version。已分发（r1）

24 dependencies：计划状态为暂无法完整判断、发现付款缺口或存在约束问题时，oracle 仍列出预计收入（T005-06 另列已确认预测）为依赖条件，TS 为空（34 行，18 个检查点，含 cA_gap、cB_topk、cB_v1—v4）｜oracle 错｜§12.5「dependencies[] | kind、refs、amount、at（“按当前假设可行”的依赖条件）」；§11.1 只在按当前假设可行一行要求「列出依赖条件：尚未到账的预计收入及日期、已确认的预测估算和其他估算费用（R010）」；R005「依赖它通过检查时必须列出依赖条件」｜—已分发（r1）

25 dependencies：cB_v5_cancel（按当前假设可行）中 11/28 的餐饮 100 元、本地交通 40 元两笔共同事件属 ESTIMATE 项目，TS 列为 ESTIMATE 依赖，oracle 不列（2 行）｜oracle 错｜§11.1 按当前假设可行「列出依赖条件：尚未到账的预计收入及日期、已确认的预测估算和其他估算费用（R010）」；R010「“按当前假设可行”须列明预计收入、价格预测、估算费用及其他依赖条件」｜—已分发（r1）

26 dependencies[0].at：参考价估算的住宿（purchase_date 9/10，payment_at 9/27），TS 取 9/27，oracle 取 9/10（T009-06、T020-08#1，2 行）｜未规定｜§12.5 的 dependencies 只列「kind、refs、amount、at」，没有规定估算类依赖的 at 取哪个日期｜dependencies[].at：EXPECTED_INCOME、EXPECTED_RETURN 取到账日；ESTIMATE、CONFIRMED_FORECAST 取对应价格项的 payment_at，与 nodes、cost.future_payments 一致。已分发（r1）

27 daily_reference.label：display 不是 AMOUNT 时，oracle 把同名代码（NEED_CONFIRMED_PLAN 137 处、NOT_RECOMMENDED 5 处、UNAVAILABLE 3 处）或 LIVING_ARRANGEMENT_MISSING（3 处）写入 label，两个情景都可用的 T018-10 写 DAILY_DISCLAIMER；TS 不写（150 行；T019-10 的 CONFIRMED_ONLY 见第11条）｜oracle 错｜§10.6 dailyReference 中「确认方案后可计算」「暂无法给出建议金额」两处提前返回和「当前不建议新增非计划支出」的返回都不带 label，label 只有「const label = usable.length === 1 ? '仅依据已确认安排' : undefined」一处；生活安排未提供写在 missing_reasons（D59、§10.5 第2步），两边已一致｜—已分发（r1）

28 daily_reference.unavailable：“确认方案后可计算”和“暂无法给出建议金额”两种提前返回时，oracle 仍列出 RECENT_MONTH 的 HISTORY_INSUFFICIENT，TS 为空（135 行）｜oracle 错｜§10.5 第1步「不存在已确认方案时，不计算D」，第2步关键信息不足时「显示“暂无法给出建议金额”及原因」，列出不可用情景属于第4步计算 D 的环节；§10.6 两处提前返回都不带 unavailable；历史不足仍由 scenarios[].unavailable_reason 和顶层 labels 表达（§12.7）｜—已分发（r1）

29 daily_reference.limited_by.node_index：TS 取 x＝D＋1 时第一个未通过的节点在 nodes[] 中的下标，oracle 的下标与 nodes[] 对不上（c00_r019_minimal、T019-01 等 10 个检查点 TS 为 1、oracle 为 2，似按含待测额 x 的探测时间轴计数）；T018-10 的限制节点只在近月情景时间轴中，TS 为 null，oracle 为 10，而 nodes[] 只有 2 个（12 行）｜未规定｜R019 输出含「限制节点」，§12.5 只列「limited_by?」，没有规定 node_index 指哪一份节点表；只有 earliest_gap、gap_list 的 node_index 明确指 nodes[]（D11、D35）｜limited_by.node_index 为 x＝D＋1 时第一个未通过的节点在 ResultCore nodes[] 中的下标，按触发类型与事件编号对应；D 已到 U0 上界，或该节点只在情景、探测时间轴中时为 null（即 SG-68③ 现行处理）。已分发（r1）

30 daily_reference.amount 与 scenarios[0].daily_reference：T012-03 用户确认取消、释放 A=400 元后 U0=500 元且没有后续流出，TS 为 500 元，oracle 为 100 元（即释放前的 U0）（2 行）｜oracle 错｜D47 只对已暂停规定「底层检查和每日参考仍按原已确认方案计算」，已取消则「底层检查从释放A之后的快照开始」；D55「取消只释放未使用的A，不增加现金」；§4「D = max { x：x为非负整数分，x <= U0，且对所有s属于S，Check(V, s, I, x)均通过 }」。R012「也不能以取消或释放保护性预留的方式提高每日非计划支出参考金额」的主语是「风险更新」，约束的是自动处理，A 也不是保护性预留｜—已分发（r1）

31 forecasts：没有可生成的预测条目时，TS 省略该键，oracle 输出 []（164 行）｜未规定｜§12.5「forecasts?、scenarios?」带“?”，按 §12.1「省略即没有该项」，省略与 [] 都表示没有预测；§12.7 只对 scenarios 规定「总列出 CONFIRMED_ONLY 与 RECENT_MONTH 两项」｜forecasts 总是输出；没有可生成的条目时为 []，不省略。已分发（r1）

32 forecasts[].predicted、amount：T020-05、T020-06、T020-10#2 中 h=13 回测不足（BACKTEST_INSUFFICIENT）的条目，TS 把 predicted、amount 置为 null，oracle 给出 58000 分；T020-07#2 结果无效（INVALID_RESULT）的条目，TS 的 predicted 为 null，oracle 给出 -159803.592776172798（两边 amount 都为 null）（7 行）｜TS 错｜§6「模型输出须保存：…参数、初始化及拟合结果；预测中间值及最终整数分金额；回测起点、步长、有效数量和误差；估算确认状态及异常原因」；§7.2 回测不足只是不再用于候选比较，「不足时显示该步长回测不足，按R009处理有效价格参考或缺失状态」；结果无效时按 R020 第11条与 §7.2「停止相应预测成本使用」，amount 为 null，但预测中间值仍须保存。TS 对这些条目保留了 level、trend、train_sse，只删去 predicted 与 amount｜—已分发（r1）

33 forecasts[S-TICKET]：T020-07#1 的序列混有两个票档（NOT_COMPARABLE），TS 的 sample_count、history_end、horizon 为 0、null、0，oracle 为 30、2026-09-30、12（3 行）｜未规定｜§12.7「序列混有不同规格时为不可比（R020 第1条）」；R020 输出要求「历史窗口及有效样本数」，§6 的 yi 为「第i个可比日级历史价格」、h 为「从最后历史观测日到目标预测日的日级步长」，都没有规定不可比序列怎样填写｜status 为 NOT_COMPARABLE 时不认定有效样本：sample_count 为 0，history_end 为 null，horizon 为 0，不拟合、不回测，限制由 status 表示。已分发（r1）

34 forecasts[S-LODGING].backtest_mae：T020-07#2 中 TS 为 30196.373516103225，oracle 为 30196.373516099213（1 行）｜TS 错｜D25「§7.2所称“模型中间数值”包括每步的l、b，以及φ幂和、一步预测值、误差平方、SSE、MAE和转为整数分前的预测值：每个量按其公式算出后保留12位小数」，D50 两端为 34 位有效数字、ROUND_HALF_UP。按此用 Python decimal 独立复算（α=0.8、β=0.8、φ=0.98，h=12，起点 t=14—18 共 5 个误差）得 30196.373516099213，与 oracle 相同；回测预测中不把 φ+φ²+…+φ¹² 保留 12 位小数时恰得 TS 的值｜—已分发（r1）

35 scenarios[1].observation_start、observation_end：9/1 的检查点 TS 为 null，oracle 为 2026-08-02—2026-08-31；as_of 为 9/10、9/11 的 T002-02、T005-04、T017-06，TS 从 2026-09-01 起，oracle 从 8/11、8/12 起（300 行，152 个检查点）｜oracle 错｜§7.1「使用as_of之前最近30个完整历日（定义见§12.7），窗口仍须全部位于原支持日期范围内」；R008「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」｜—已分发（r1）

36 scenarios[1].groups：近月情景中，观察窗口没有记录的日常类别，TS 仍按 0 列出一组，oracle 不列；T018-10 的 category、daily_amounts、scenario_group_total、scenario_increment 差异只是组下标因此错位，ENTERTAINMENT 组的数值两边相同（56 行，10 个检查点）｜未规定｜D48 固定餐饮、本地交通、日用、娱乐进入日常情景；D67「组按 §5 为同一类别、同一覆盖期间」；R018 第4条要求说明「覆盖类别」；没有规定窗口内金额为 0 的类别是否成组｜近月情景可用时，D48 的四个日常类别在各自覆盖期间都列出一组，窗口内没有记录的类别 Pg、Eg、Δg 为 0，组内每日都列出（含 0）；groups 按 MEALS、LOCAL_TRANSPORT、DAILY_GOODS、ENTERTAINMENT 再按 coverage_start 排序（即 SG-72 现行处理）。已分发（r1）

37 scenarios[1].groups[].coverage_end：由生活预留覆盖的类别，TS 取该预留的覆盖期末 2026-10-31，oracle 取检查期间终点 2026-10-10（7 行：T018-04、T018-05、T018-06、T018-11、T018-12）｜oracle 错｜D67「由生活预留覆盖的类别，按对应生活预留的覆盖期间切分；不由预留覆盖的类别，整个检查期间为一组。组内天数为该组覆盖期间与检查期间交集的自然日数」，条文把组的覆盖期间与它和检查期间的交集分开，覆盖期间即对应预留的覆盖期间；组内天数（daily_amounts 10 天）两边一致｜—已分发（r1）

38 labels：display 不是 AMOUNT 时的 NEED_CONFIRMED_PLAN、UNAVAILABLE、NOT_RECOMMENDED，以及 daily_reference.label 为 CONFIRMED_ONLY 时的 CONFIRMED_ONLY，oracle 写入顶层 labels，TS 只写在 daily_reference（175 个检查点）｜未规定｜§12.5 labels 只规定「未确认方案同时含 DRAFT_PREVIEW 与 PREVIEW_UNCONFIRMED（D62）。结果中出现§11.4的“同价”“历史不足”时，顶层 labels 须含对应代码」，§12.7 另规定以 SIMULATED_DATA、TOP_K_DEMO 开头；其他 §11.4 文案是否进顶层 labels 未写｜顶层 labels 汇总本检查点出现的全部 §11.4 固定文案代码（与 §12.7 对“同价”“历史不足”的做法一致）：daily_reference.display 不是 AMOUNT 时含同名代码，生活安排未提供时 UNAVAILABLE 与 LIVING_ARRANGEMENT_MISSING 都含；daily_reference.label 为 CONFIRMED_ONLY 时含 CONFIRMED_ONLY。已分发（r1）

39 labels：每日参考显示金额且只用一个情景时，TS 含 DAILY_DISCLAIMER，oracle 的 labels 与 daily_reference.label 都没有这句说明（29 个检查点，含 c00_r019_minimal、cB_v5_cancel）｜oracle 错｜R019 输出「当前模拟时点、剩余参考金额、检查期间、限制节点、所用情景和收入依赖，以及“按当前输入和假设测算，不是资金安全保证”的说明」；§11.4 把该句列为每日参考的固定文案｜—已分发（r1）

40 labels：FORECAST_DISCLAIMER，TS 只在 forecasts[] 有给出 amount 的条目时加；oracle 只要 forecasts[] 非空就加，包括全部为 HISTORY_INSUFFICIENT、NOT_COMPARABLE、INVALID_RESULT、没有任何预测金额的检查点（9 个检查点，含 cB_topk、cB_v1_two_feasible、cB_v2_zero_feasible）｜未规定｜§11.4 只列出文案「“模拟历史数据生成的预测估算，不是确定报价”（政策卡第六节）」，rules.md 没有写出现条件｜forecasts[] 中有 amount 不为 null 的条目时，labels 含 FORECAST_DISCLAIMER；没有给出预测估算金额时不加。已分发（r1）

41 labels：FORECAST_UNAVAILABLE，TS 在有 BACKTEST_INSUFFICIENT、NOT_COMPARABLE、INVALID_RESULT 条目时加（T020-05、T020-06、T020-07#1、T020-07#2、T020-10#2），oracle 不加；没有 price_series、价格项落到参考价或有效期未知报价时，oracle 加，TS 不加（T009-02、T009-06、T020-08#1）（8 个检查点）｜未规定｜R010「历史不足、价格预测不可用和每日建议不可用分别说明」；§11.4「“预测不可用”及原因」；R020 异常「历史不足、不可比、缺失影响拟合、拟合失败、配置未确认或结果无效时显示具体原因；有有效参考价时明确降级」；没有写何时进顶层 labels｜forecasts[] 有 status 不是 AVAILABLE 的条目，或价格项因该项目、该购买日没有 AVAILABLE 预测而按 D13 落到有效参考价、有效期未知报价或待填时，labels 含 FORECAST_UNAVAILABLE；status 为 HISTORY_INSUFFICIENT、CONFIG_NOT_FROZEN 的另含 HISTORY_INSUFFICIENT、FORECAST_CONFIG_NOT_FROZEN。已分发（r1）

42 labels：IF_RECEIVED，oracle 只在 cost 的若到账净支出与 net_spend 不同时加（cB_v5_cancel），TS 不加；候选级有条件返现（cB_topk 的 C05）两边都不加（1 个检查点）｜未规定｜D12「结果中另显示“若到账”时的净支出」，§11.4 推荐文案含「“若到账”（D12）」，没有写进顶层 labels 的条件｜cost 或任一 candidates[] 的 net_spend_if_received 不为 null 时（按第15条只在有条件返还时给出），labels 含 IF_RECEIVED。已分发（r1）

43 labels：PROTECTED_SQUEEZE，存在由流出触发的保护性资金缺口节点时 oracle 加，TS 不加（17 个检查点，如 T005-01、T006-01、T019-05）｜未规定｜§11.4「由付款引起的保护性资金缺口：“这笔付款会挤占生活、机动等保护性预留 X 元”，X取该节点的-U（D34）」，没有写进顶层 labels 的条件｜检查期间内存在 trigger.kind 为 OUTFLOW 或 OUTFLOW_GROUP 的 PROTECTED_SHORTFALL 节点时，labels 含 PROTECTED_SQUEEZE，X 取其中最早一个节点的 -U。已分发（r1）

44 labels：NEED_RECONFIRM，已确认方案在 DELAY_INCOME、ADD_TODAY_SPEND、ADD_LIVING_EXPENSE、PAUSE、CANCEL 使输入版本升为 v2 后，oracle 加，TS 不加；这些检查点没有 confirmations[]，user_confirmations 为空（9 个检查点，如 T010-05、T012-02、T019-02）；有 NEEDS_RECONFIRM 记录的 T015-07 两边都加｜oracle 错｜§11.4「旧确认：“需重新确认”（D60、R015）」，D60 只对早于当前版本的 confirmations[] 记录标 NEEDS_RECONFIRM；R017 第9条「风险、可行性和每日参考金额可以自动更新」；§11.3「确认后计划状态可能因输入变化而改变，确认状态不随之自动改变」｜—已分发（r1）

合计 44 条：TS 错 7 条（7、12、13、14、21、32、34）；oracle 错 15 条（2、3、4、5、6、10、24、25、27、28、30、35、37、39、44）；未规定 22 条（1、8、9、11、15、16、17、18、19、20、22、23、26、29、31、33、36、38、40、41、42、43）。

## 第 2 轮

对象为重新生成的 docs/_work/diff_report.md（差异合计 106 行），只裁决其中 P1（20 行）与 P2（84 行）；P3 的 2 行不在本轮范围。依据只取 docs/rules.md 条文，含第 1 轮之后写入的 §12.7（12）—（33）；oracle 的行为只看 .cache/oracle-out/ 输出，TS 的行为看 .cache/ts-out/。同一差异模式合并为一条，括号内为报告行数或检查点数；104 行全部归入下列 9 条，编号接第 1 轮。

条目｜结论｜依据｜推荐写入 §12.7 的统一约定（仅“未规定”）

45 labels：c00_v1_living_not_provided 的生活安排未提供，两边 daily_reference 都是 display 为 UNAVAILABLE、missing_reasons 为 LIVING_ARRANGEMENT_MISSING；TS 的顶层 labels 含 LIVING_ARRANGEMENT_MISSING，oracle 不含，两边都不含 UNAVAILABLE（1 行）｜oracle 错｜§12.7（31）「每日参考已经用 display 或 label 写出的句子，不重复写入顶层 labels。……生活安排未提供仍只由 LIVING_ARRANGEMENT_MISSING 表示」：本条约定的是顶层 labels，不重复写入的只限 display、label 已写出的句子；“生活安排未提供”写在 missing_reasons（§10.5 第2步「missing_reasons 含 LIVING_ARRANGEMENT_MISSING」），不在其列，末句写明它仍只由 LIVING_ARRANGEMENT_MISSING 这一个代码表示、不另加 UNAVAILABLE；§11.4 把「每日参考缺生活安排：“生活安排未提供”（D59、R019）」列为固定文案｜—已分发（r2）

46 cost.future_payable、cost.net_spend：plan_target 为 NONE（报 NO_PLAN），且门票、交通、住宿等必要项目的金额只能取自候选价格项（amount_status 为 CONFIRMED 或 ESTIMATE，不在 pending_cost_item_ids 中）时，TS 两项为 null；oracle 只按共同事件和已付款计算：cA_gap 两项为 10000 分，cB_topk、cB_v1、cB_v2、cB_v4 为 14000 分，T016-03 的净支出为已付门票 58000 分，其余都是 0。没有这类项目的 22 个 NONE 检查点（如 c01_base、T003-03）两边一致（74 行，37 个检查点：P1 5 个、P2 32 个）｜oracle 错｜§3「资料完整时：预计消费净支出 = P + F - R」，其中 F 为「后续实际应付额，或明确标注并经确认的估算应付额」；R007「资料完整时，目标净支出按“已付＋后续应付－归属于本目标且符合规则的返还”计算」；R010「必要费用区分已填、估算、待填和明确不适用，不能默认0」；R015 第5条「未知金额不能按0处理」；D47「三者都没有时为“暂无法完整判断”，原因为尚未形成方案」。§12.7（12）只限定此时 pending_cost_item_ids 的范围，§12.7 首条只要求时间轴「仍逐节点计算和输出」，都没有让这些必要项目按 0 计入 F 和净支出｜—已分发（r2）

47 dependencies：cB_v5_cancel（按当前假设可行）中，oracle 把带触发条件的退票款 E-TICKET-REFUND（60000 分，2026-09-20，条件为「用户取消计划后申请退票，经审核通过后退还（扣手续费80元）」）列为 EXPECTED_RETURN 依赖，TS 不列（与第 48 条合计 9 行）｜oracle 错｜§12.5「dependencies[] | kind、refs、amount、at（“按当前假设可行”的依赖条件）」；R005「依赖它通过检查时必须列出依赖条件」「触发条件尚未成立的款项只进入对应条件模拟」；§10.3 RETURN「依赖后续条件的：基础时间轴不计入，只在对应条件模拟中计入（R005、D12）」。该笔不在基础时间轴上，可行结论不依赖它；它已按 §12.7（16）体现在 net_spend_if_received（两边都是 110000 分），并列为 possible_refund｜—已分发（r2）

48 dependencies 的顺序：同一检查点 TS 先列预计收入、后列 ESTIMATE，oracle 按 at 升序，2026-12-01 的预计收入与 2026-11-28 的两笔估算先后相反（与第 47 条合计 9 行）｜未规定｜§12.5 只列「kind、refs、amount、at」，§12.7（24）只规定 at 的取值；§11.1「列出依赖条件：尚未到账的预计收入及日期、已确认的预测估算和其他估算费用（R010）」与 R010「须列明预计收入、价格预测、估算费用及其他依赖条件」只列种类，没有规定列表顺序｜dependencies[] 先按 kind 排列：EXPECTED_INCOME、EXPECTED_RETURN、CONFIRMED_FORECAST、ESTIMATE（同 §11.1 的列举顺序）；同一 kind 内按 at 升序；at 也相同时，来自共同事件的按 events[] 中的先后排在前，来自计划对象价格项或返还的按其在 items[]、returns[] 中的先后排在后。已分发（r2）

49 scenarios[1].observation_start、observation_end：as_of 为 2026-09-10、09-11 的 T002-02（转实付前、转实付后）、T005-04、T017-06，TS 取 2026-09-01 至 as_of 前一日，oracle 为 null；两边都判近月情景不可用（HISTORY_INSUFFICIENT），complete_days 都为 0（8 行）｜未规定｜§7.1「使用as_of之前最近30个完整历日（定义见§12.7），窗口仍须全部位于原支持日期范围内」「不足30个完整历日时，只展示覆盖情况或描述统计」；§12.7「观察窗口内完整历日（COMPLETE 或 NO_SPEND）不足30个时，近月情景不可用，原因记为 HISTORY_INSUFFICIENT」；R008「历史分析通过推进as_of获得范围内的观察窗口」；R001 只写了 10 月 1 日「观察此前2026年9月1日至9月30日的数据」和「9月1日案例保留历史不足提示」。条文要求窗口不越出支持范围，但没有规定 as_of 之前的范围内日期不足 30 天时，窗口取范围内的部分还是不给出｜近月情景的观察窗口为 as_of 所在日之前、不早于 2026-09-01 的最近至多 30 个自然日：observation_end 为 as_of 所在日的前一日，observation_start 为 observation_end 前推 29 日与 2026-09-01 中的较晚者；as_of 所在日为 2026-09-01 时两者为 null。complete_days 为窗口内 COMPLETE 或 NO_SPEND 的天数，不足 30 个时近月情景不可用（HISTORY_INSUFFICIENT），仍按 §7.1 给出该窗口及覆盖情况（即 TS 现行处理）。已分发（r2）

50 input_issues：T008-05 的 as_of 为 2026-09-01，price_series 中有一笔 2026-08-25 的 S-LODGING 观测；oracle 报 OUT_OF_RANGE（refs 为 S-LODGING，rule 为 R008），TS 不报。两边该序列的预测都为 HISTORY_INSUFFICIENT、sample_count 为 0（2 行）｜oracle 错｜§12.5「input_issues[] | code、rule、refs（§11.1“暂无法完整判断”的原因）」；§11.1 中与日期范围有关的触发条件只有「必要事件晚于2027-01-01（D04、R008）」，§12.1 把日期范围交由引擎「报告输入冲突（§11.1）」；R008 虽要求「余额快照、活动、历史观察记录……须满足范围限制」，但只规定「必要事件超范围时，说明不支持完整判断」，对 2026-09-01 之前的其他记录规定的处理是「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」；R010「只限制依赖该数据或配置的输出，不自动使其他完整候选或基础检查失效」。该观测是价格历史，不是必要事件，不进入预测样本即可，不构成暂无法完整判断的原因（与第 12、13 条依据相同）｜—已分发（r2）

51 states.underlying_plan_state：T012-02、T012-03 用户已取消，两边 input_issues 都为空、各节点都为通过、没有预算超限或分配冲突；TS 为按当前假设可行，oracle 为暂无法完整判断（2 行）｜oracle 错｜§11.1 按当前假设可行的触发条件为「检查期间内全部节点通过，预算检查和分配检查通过」，暂无法完整判断须「列出缺失或冲突原因」，而这两个检查点的暂无法完整判断触发条件一条也不成立；D47「已取消：底层检查从释放A之后的快照开始，只计仍有效义务和生活安排（R012、D61）」；D61「只计入 cancellable 不为 true 的尚未发生付款，以及生活安排」。T012-02 的仍有效义务只有 2026-09-15 的住宿付款 200 元，未购的门票不是仍有效义务（与第 21 条依据相同）；T012-03 没有费用项目和事件｜—已分发（r2）

52 T012-02 的每日参考：TS 按释放 A 之后的快照（U0 为 500 元）算出 300 元，label 为 CONFIRMED_ONLY，limited_by 为 2026-09-15 住宿付款的节点，unavailable 列出近月情景历史不足，顶层 labels 含 DAILY_DISCLAIMER，scenarios[0].daily_reference 为 300 元；oracle 显示“暂无法给出建议金额”（UNAVAILABLE），missing_reasons 为空，以上各项都没有（7 行）｜oracle 错｜§10.5 第2步只在「关键资金、付款、生活安排、用途或检查期间不足时，显示“暂无法给出建议金额”及原因（R019）」，这些信息在本检查点都完整（见第 51 条），oracle 也没有给出原因；D47、D61 规定已取消时从释放 A 之后的快照只计仍有效义务和生活安排；§10.5 第4步近月情景不可用时「结果按“仅已确认安排”给出，标“仅依据已确认安排”，并列出不可用的情景及原因」；R019 输出须含「“按当前输入和假设测算，不是资金安全保证”的说明」（与第 39 条依据相同）。oracle 对同样已取消的 T012-03 照常给出 500 元｜—已分发（r2）

53 forecasts[S-LODGING].predicted：T020-07#2（status 为 INVALID_RESULT）两边的 level、trend 相同（50124.378109437492、-19900.497512450860），φ=0.98，h=12；TS 为 -159803.592776168785，oracle 为 -159803.592776172798（1 行）｜TS 错｜§6「预测价格(n+h | n) = ln + bn × (φ + φ² + ... + φ^h)」；D25「§7.2所称“模型中间数值”包括每步的l、b，以及φ幂和、一步预测值、误差平方、SSE、MAE和转为整数分前的预测值：每个量按其公式算出后保留12位小数，公式内部不另行舍入」；D50「两端运算均为34位有效数字、ROUND_HALF_UP」。用 Python decimal 独立复算：φ 幂和为 10.548880536994798364…，保留 12 位为 10.548880536995，代入得 -159803.592776172798，与 oracle 相同；φ 幂和不先保留 12 位时恰得 TS 的值。与第 34 条同一原因：TS 的回测已经改正，最终预测仍未把 φ 幂和保留 12 位｜—已分发（r2）

合计 9 条：TS 错 1 条（53）；oracle 错 6 条（45、46、47、50、51、52）；未规定 2 条（48、49）。

## 第 3 轮

对象为重新生成的 docs/_work/diff_report.md（差异合计 46 行：P1 2 行，P2 44 行，P3 无），全部在本轮范围。依据只取 docs/rules.md 当前条文（§12.7 已写到（35））；oracle 的行为只看 .cache/oracle-out/ 输出，TS 的行为看 .cache/ts-out/，第 2 轮修正单的内容取 docs/_work/oracle_fixes/h3-r2.md。同一差异模式合并为一条，括号内为报告行数或检查点数；46 行全部归入下列 2 条，编号接第 2 轮。两条都是第 2 轮已裁决事项的遗留：第 54 条对应第 46 条，第 55 条对应第 50 条。

条目｜结论｜依据｜推荐写入 §12.7 的统一约定（仅“未规定”）

54 cost.future_payable、cost.net_spend：plan_target 为 NONE 的 22 个检查点，TS 照 §3 给出两项，oracle 两项都为 null。这 22 个检查点都没有候选，也没有金额未知的必要项目：c01_base、T001-01、T001-03、T001-05#1、T001-05#2、T003-01、T003-02、T004-03、T004-05、T005-05、T006-02、T008-01、T013-01、T013-02 的三个检查点、T013-08、T015-07 共 18 个，费用清单为空，也没有本目标付款，TS 两项为 0；T003-03、T003-06 与 T006-06#1 的两个检查点只有一个 CONFIRMED 的必要项目，金额由共同事件中的本目标付款给出，TS 两项分别为 8000、30000、20000 分。两边的 paid_total、eligible_return 都为 0，cost.future_payments 相同，pending_cost_item_ids 都为空（44 行，22 个检查点：P1 1 个、P2 21 个）｜oracle 错｜修复后仍有差异的原因：第 46 条判 oracle 错，依据是 R010「必要费用区分已填、估算、待填和明确不适用，不能默认0」与 R015 第5条「未知金额不能按0处理」，即那 37 个检查点的门票、交通、住宿只能取自候选价格项，只按共同事件计算等于把它们按 0 计入；该条写明这 22 个检查点当时「两边一致」，不在裁决之列。本次输出中，oracle 在全部 61 个 NONE 检查点都给 null，有计划对象的 119 个检查点两边一致，可见 oracle 把修正扩大成“没有计划对象一律不给”：第 46 条的 37 个检查点因此一致，这 22 个却由一致变为不一致。修正单 F-02 虽注明「已经一致的检查点不在本条」，后半句「也不给出只按共同事件算出的这项」仍容易被读成一律适用。本组没有金额未知的必要项目，第 46 条的依据不成立，适用 §3「资料完整时：预计消费净支出 = P + F - R」与 R007「资料完整时，目标净支出按“已付＋后续应付－归属于本目标且符合规则的返还”计算」；§10.8 对 c01 写明「各测试列出的本目标收付款即所检查计划的全部收付款，其余必要费用均已填或明确不适用，P = 0，无返还」，22 个中有 20 个就是 c01 或以 c01 为底。D47「三者都没有时为“暂无法完整判断”，原因为尚未形成方案」只规定计划状态，没有说成本因此未知；§12.7 首条规定此时「时间轴只含共同事件，仍逐节点计算和输出」，§12.7（12）规定此时 cost.pending_cost_item_ids「只列 amount_status 为 PENDING 的必要项目」，都以没有计划对象时仍给出时间轴和成本结果为前提。oracle 的输出本身也不一致：T003-06 的 cost.future_payments 列出 E1 的 30000 分，future_payable 却为 null；T001-02、T001-06 同以 c01 为底、选中没有价格项的 C01，计划状态同为暂无法完整判断，oracle 给出净支出 0，而费用数据相同、只是没有选中候选的 T001-01 却为 null。本轮处理：第 46 条结论不变；按本条重新分发 oracle，写明是否给出 future_payable 与 net_spend 只看必要项目和本目标付款的金额是否都已知，与有无计划对象无关：有金额只能取自候选价格项或仍待填的必要项目时为 null（第 46 条），没有时照 §3 按共同事件计算。TS 不改｜—已分发（r3）

55 input_issues：T008-05 中 oracle 仍在 NO_PLAN 之前多报一条 OUT_OF_RANGE（refs 为 S-LODGING，rule 为 R008），TS 只报 NO_PLAN；两边 S-LODGING 的预测都为 HISTORY_INSUFFICIENT、sample_count 为 0（2 行，都因多出的这一条使 NO_PLAN 后移）｜oracle 错｜维持第 50 条。修复未生效的原因：oracle 这一条的 code、rule、refs 与第 2 轮完全相同，而同一修正单的其余各条（c00_v1 的 labels、cB_v5_cancel 的 dependencies、T002-02 等的观察窗口、T012-02 与 T012-03 的底层状态和每日参考，以及第 54 条所说的成本两项）都已在本次输出中生效，NO_PLAN 的 rule 也已改为「§12.7(12)/D47」，所以不是输出没有重新生成，而是 F-14 没有被采纳。修正单首句为「不同意的不改，写入 AMBIGUOUS.md」，应是 oracle 侧核对后不同意（AMBIGUOUS.md 在 oracle/ 下，本裁决未查阅）。F-14 只引了 §11.1、R008「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」和 R010，没有回应字面上可以当作报告依据的两处：R008「余额快照、活动、历史观察记录及本计划判断所需的收付款事件须满足范围限制」与 §12.1「币种、日期范围……由引擎报告输入冲突（§11.1）」。这两处不支持报告：R008 在同一段只对必要事件规定后果「必要事件超范围时，说明不支持完整判断」，对 2026-09-01 之前、不属 D57 豁免的其他记录，规定的处理是「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」，即不使用；§12.1 这句划分 schema 与引擎的分工，报什么由 §11.1 规定，而 §11.1 中与日期范围有关的触发条件只有「必要事件晚于2027-01-01（D04、R008）」。§12.5 把 input_issues 定为「§11.1“暂无法完整判断”的原因」，报出这一条就是让一笔价格历史使计划状态变为暂无法完整判断，与 R010「只限制依赖该数据或配置的输出，不自动使其他完整候选或基础检查失效」相抵；这笔观测的影响已由该预测条目和顶层 labels 的 HISTORY_INSUFFICIENT 说明（R010「历史不足、价格预测不可用和每日建议不可用分别说明」）。oracle 自己也没有按“超范围的历史观察记录都报”执行：同一检查点同为 2026-08-25、同样不属 D57 豁免（不是只用于 P 或 R 的收付款）的消费记录 H-0825-MEALS，oracle 并不报。本轮处理：重新分发 F-14，补上以上对 R008「须满足范围限制」和 §12.1 的说明，并写明 2026-09-01 之前的价格观测与消费记录都不报 OUT_OF_RANGE；oracle 侧仍不接受时交团队裁决。TS 不改｜—已分发（r3）

合计 2 条：TS 错 0 条；oracle 错 2 条（54、55）；未规定 0 条。本轮不新增 §12.7 约定，TS 不改。

## 第 4 轮

对象为重新生成的 docs/_work/diff_report.md（差异合计 2：P1 0 行，P2 2 行，P3 0 行）。P1 无差异。只裁决 P2 的 2 行。依据只取 docs/rules.md 当前条文（§12.7 仍写到（35），本事项没有新条文）；oracle 的行为只看 .cache/oracle-out/ 输出，TS 的行为看 .cache/ts-out/。2 行是同一条多出来的输入问题使后续条目后移，归为 1 条，编号接第 3 轮。本条是第 50、55 条的遗留，本次输出与第 3 轮相同。

条目｜结论｜依据｜推荐写入 §12.7 的统一约定（仅“未规定”）

56 input_issues：T008-05/final 的 as_of 为 2026-09-01T09:00:00+08:00，没有 confirmed_plan，ops 为空。price_series 有一笔 2026-08-25 的 S-LODGING（人民币），consumption_records 有同日的 H-0825-MEALS。TS 的 input_issues 只有 NO_PLAN（rule 为 D47，refs 为 G1）。oracle 在其前多一条 OUT_OF_RANGE（refs 为 S-LODGING，rule 为 R008），NO_PLAN 落到 [1]（rule 为 §12.7(12)/D47，refs 为 G1）。两边 plan_target 都是 NONE，计划状态都是暂无法完整判断；S-LODGING 的预测都是 HISTORY_INSUFFICIENT、sample_count 为 0、history_end 为 null；顶层 labels 都含 HISTORY_INSUFFICIENT；check_period.out_of_range 都是 false。oracle 不报 H-0825-MEALS（2 行）｜oracle 错｜维持第 50、55 条。§12.7（12）「没有 confirmed_plan 且本次 ops 未执行 SELECT_CANDIDATE 时，plan_target 为 NONE，input_issues 报 NO_PLAN」：两边都报了 NO_PLAN，这一条符合条文。多出的 OUT_OF_RANGE 不符合：§12.5 把 input_issues 定为「§11.1“暂无法完整判断”的原因」；§11.1 中与日期范围有关的触发条件只有「必要事件晚于2027-01-01（D04、R008）」；§12.1「日期范围……由引擎报告输入冲突（§11.1）」报什么以 §11.1 的清单为准。R008「余额快照、活动、历史观察记录及本计划判断所需的收付款事件须满足范围限制。必要事件超范围时，说明不支持完整判断」只对必要事件规定了不支持完整判断；对 2026-09-01 之前、不属于 D57 豁免的其他记录，同条规定的处理是「历史分析仍不把2026-09-01之前的其他记录当作观察窗口」。这笔是价格观测，不是必要事件，也不是 D57 的范围前收付款。R001「9月1日案例保留历史不足提示」；R010「历史不足、价格预测不可用和每日建议不可用分别说明；只限制依赖该数据或配置的输出，不自动使其他完整候选或基础检查失效」；R018 异常「不能把历史不足当作全计划失败」。两边已由该预测条目和 HISTORY_INSUFFICIENT 说明历史不足，且没有把 8 月 25 日计入样本。写入 input_issues 就是把它当成暂无法完整判断的原因。D04 的超界只指晚于 2027-01-01，与两边 out_of_range 为 false 一致（第 13 条）。本次 oracle 这一条的 code、refs、rule 与第 3 轮完全相同。TS 不改｜—已分发（r4）

合计 1 条：TS 错 0 条；oracle 错 1 条（56）；未规定 0 条。本轮不新增 §12.7 约定，TS 不改。
