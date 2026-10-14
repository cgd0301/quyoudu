*Thinking...*

> **Evaluating event income and expenses**
> 
> I'm trying to figure out the differences in financial snapshots after an event. If I've got event income at 200 and expenses at 100 in a chronological order, I need to ensure the numbers align consistently throughout. Also, I see a mention of "DAY_START at 09:00" and how that impacts timing. In parts of this analysis, I'm considering grouping overdue items and ensuring there's clarity in financial definitions and validations, especially regarding known and unknown payments.
> 
> **Clarifying timestamps and outcomes**
> 
> I'm trying to establish an example where timestamps are equal but order references are absent. There's a notion of needing `time_precision` and how to handle gaps without creating ambiguity in outcomes. If two times are identical, it can become inconclusive, leading to potential ties. 
> 
> Then there’s the shared reserve groups. If claims exceed the reserve, we need to figure out what's leftover for various goals. The idea is that despite the complexity in order and distribution, we aim for a logical approach to ensure clarity and avoid duplication.
> 
> **Considering event IDs and reserves**
> 
> I’m pondering how equal event IDs impact which reserves are exhausted and how that affects goal allocation. There’s a bit of ambiguity here since the physical aspects aren’t entirely clear. However, the choice of a deterministic ID allows for express computation, even though it doesn’t reflect reality directly. I need to ensure I’m considering how this might influence various outcomes and adjustments within the system based on these event IDs.
> 
> **Clarifying numeric entries**
> 
> I'm looking at the numeric entries using C1000, L300, A400, P200, F600, and B700, which gives me U300, a budget over 100, and a minimum cash of 100. The engine returns D100, but the requirement is 0, and it seems all records are proper. I've already confirmed this, and it looks like actual cost updates are allowed. I think I need to establish an important block here.
> 
> **Evaluating distribution methods**
> 
> I'm considering how to distribute something using Method 2, first by splitting 50/50. Then, I’m thinking about possibly dividing it as 30/30. For the second example, if payments cover two days and amount for each day matches, that could result in a change of 20 per day. This seems like an interesting calculation process, but I need to ensure all parts align correctly for clarity.

以下仅依据已提供的五份文件审查；引用的 `docs/_work/spec_gaps.md` 未提供，不能视为相关问题已有可执行裁决。下列数例金额均为元，日期均指模拟时间，不代表已经运行测试。

## 阻塞

### 1. 阻塞｜冲突｜`rules.md` D05、D07、§10.4
**问题：**D05规定“L + N + O + M > C，为保护性资金缺口”；D07规定“不足即付款缺口”。从c01发生600元非目标、无覆盖支出后，C=400、H=-100、U=-500：两处措辞给出不同缺口类型，而且保护性缺口金额尚未明确采用100还是500。若D07只是泛指计划状态，也没有明确说明。

**最小修改建议：**统一D05与D07的类型含义，并固定保护性资金缺口的金额口径及相关项目归属。

### 2. 阻塞｜歧义｜`defaults_v1.md` D18；`rules.md` D18、R017
**问题：**“建议分配额”没有说明是新增分配还是调整后的总额。以c01为例，现有A=400、U=100，剩余未覆盖目标付款500，公式得到建议100：作为新总额时，A=100、U=400；作为追加额时，A=500、U=0。“不足部分”的计划分配金额也随之不同。

**最小修改建议：**明确建议值是新增额还是新总额，并把现有A纳入剩余待分配需求的计算。

### 3. 阻塞｜缺口｜`rules.md` R017、D18、§11.3
**问题：**没有明确要求按“确认后拟建立的分配”重新验证未来节点。例：C=1000、所有预留及A均为0，9/5非目标支出600、9/8预计收入600、9/10目标付款600；确认前全部通过，但D18建立A=600后，9/5出现C=400、A=600、U=-200。原本通过的候选可能在确认操作本身之后变成有缺口。

**最小修改建议：**确认前以拟变更后的A和任务集合重跑完整检查，再一次性提交确认与分配变更。

### 4. 阻塞｜缺口｜`rules.md` D05、D08、§10.3—§10.4
**问题：**收入节点建立生活预留后首次出现U<0，没有判定类型。以c01为起点，某笔收入100同时建立生活预留300，得到C=1100、L=600、M=200、A=400、H=300、U=-100；保护性预留没有超过现金，但该节点既不是起始节点，也不是流出节点，无法落入现有明确分支。

**最小修改建议：**为收入建预留等非流出节点首次出现U<0规定判定类型、金额及对应计划状态，并补测试。

### 5. 阻塞｜冲突｜`policy_card.md`“每日非计划支出参考金额”；`rules.md` D04、§10.1
**问题：**政策卡要求检查期间“必须覆盖完成当前判断所需的付款、仍有效义务和生活保障安排”；D04则以“其后第一笔已确认收入到账日”确定终点。若最后目标付款在9/10、下一收入在9/20，而已确认必查生活付款在9/25、保障期至9/30，公式会止于9/20，未覆盖已经明确需要保障的安排。

**最小修改建议：**明确必须纳入检查的义务和保障期间集合，并让D04的终点覆盖该集合。

### 6. 阻塞｜缺口｜`rules.md` D03、§10.1；`traceability.csv` T001-05
**问题：**`AFTER_EVENT(n)`缺少可执行的计数规则：n按原始事件、排序后的事件还是流出组计数，是否包含机动预留释放，以及与`in_snapshot`、`actual_at`发生矛盾时如何处理，都未明确。仅有“已计入至第n个事件”不足以保证历史收付款不重扣、不漏扣。

**最小修改建议：**固定快照纳入的事件集合、n的计数顺序及时间／阶段／计入标记冲突时的拒绝规则。

### 7. 阻塞｜缺口｜`rules.md` R005、R017、§10.1、§10.6；T005-04、T017-06
**问题：**预计日期已过但尚未履行的事件，没有进入新时间轴的处理规则。例如9/30应付400，到10/1仍未付款且未计入快照，按检查期间过滤可能直接消失；“不自动标记完成”并不能说明该义务应该怎样继续参与检查。逾期未到账收入也存在相同问题。

**最小修改建议：**补全逾期未履行事件的状态与时间轴处理，禁止直接丢弃、自动完成或擅自改到新的付款日期。

### 8. 阻塞｜冲突｜`rules.md` §4、§10.6 `passesAll`
**问题：**§4要求检查“付款义务和适用预算约束”；`passesAll`却定义为“全部节点为PASS时返回true”。例如当前C=1000、L=300、A=400、其他占用为0，已确认方案新增实付后P=200、F=600、B=700：资金节点仍允许额外支出100，但完整目标已经预算超限100，仅检查节点会错误给出正数参考金额。

**最小修改建议：**让每日参考的通过条件同时包含预算及其他适用约束，而不是仅判断资金节点PASS。

### 9. 阻塞｜缺口｜`rules.md` R019、D26、§10.5—§10.6
**问题：**每日参考伪代码缺少“不可评估”的传递分支。10月1日基础安排完整、但近月历史只有29个完整日时，D26要求的第二个情景不可用；布尔型`passesAll`及统一的`blocked → amount: 0`处理无法区分“确实有缺口”和“没有条件完成判断”，也未明确在哪里拦截这种情形。

**最小修改建议：**将检查结果区分为通过、不通过、不可评估，并规定不可评估时不输出金额。

### 10. 阻塞｜缺口｜`rules.md` D17、§9.7；T009-03、T016-02
**问题：**优惠字段不足以计算应付金额：没有明确减免金额、折扣比例、返现金额等字段，也没有订单归组、门槛计算基数及多优惠执行顺序。仅知道`THRESHOLD_OFF`和门槛500，不能计算究竟减50还是减100，更不能独立核对组合优惠。

**最小修改建议：**补齐优惠金额／比例、作用订单、门槛基数及叠加和舍入顺序，并给出可复算组合样例。

### 11. 阻塞｜缺口｜`rules.md` D16、§9.7、R016
**问题：**相容性字段尚未形成可执行判断：住宿只核对晚数还是必须覆盖指定日期，`refundable_required`约束门票、交通还是全部项目，返程间隔采用哪个演出结束时刻，均未确定。缺少这些定义，候选“确定排除”与“待确认”的分类也无法稳定实现。

**最小修改建议：**逐项固定约束的比较对象、所需候选字段、适用项目及缺值处理，并关联相应测试。

## 重要

### 12. 重要｜缺口｜`rules.md` §10.2—§10.3、R003
**问题：**共享预留不足时，事件编号可能决定是否可行。设C=400、L=100、A=200，两笔同日未知先后的支出各200，一笔目标付款、一笔非目标支出，均声明覆盖同一生活预留100：按现有逐笔`min`核销，非目标先执行时组末U=0；目标先执行时U=-100。仅交换`event_id`大小就改变结论，而编号不代表真实先后；文档未确定是否应先拒绝这类跨事件超额覆盖。

**最小修改建议：**明确同一预留跨事件超额覆盖的处理，并在执行流出组前确定合法覆盖额或拒绝冲突。

### 13. 重要｜歧义｜`rules.md` R013、R017第10条、R019
**问题：**新预测可用于风险重评，但未确认差异是否进入每日参考，口径未定。C=1000、L=300、A=400，正式方案后续付款600时参考为100；新预测升至650且尚未确认，按正式安排计算仍为100，按新风险金额计算则为50。两者都可以保留原行动清单，却给出不同主展示金额。

**最小修改建议：**分别指定正式安排、风险重评和每日参考使用的价格版本，以及未确认价格差异的参与方式。

### 14. 重要｜歧义｜`rules.md` D18、§10.3 `INCOME`；T017-04
**问题：**挂在收入上的“计划分配”何时转成A，没有规则。按T017-04，9/20收入600后，不转正350计划分配时A=200、U=600；转正时A=550、U=250。该测试只固定此前及最终付款后的关键数值，两种实现都能满足这些断言。

**最小修改建议：**明确计划分配在预计／实际收入节点的转换条件、确认要求及不足处理，并补该节点A、U的断言。

### 15. 重要｜歧义｜`rules.md` R009、D13；T009-02
**问题：**有效期未知的报价没有明确落入价格优先级哪一层。只有一条600元报价、有效期未知、用户已同意作为估算且没有其他价格依据时，按R009可以使用600元估算；按D13仅接受“有效参考价”的严格实现，则可能保留待填。T009-02也明确不判断其优先级位置。

**最小修改建议：**在D13中明确有效期未知报价的所属分支、使用前提及与其他价格依据的优先关系。

### 16. 重要｜歧义｜`defaults_v1.md` D12；`rules.md` D12、§3
**问题：**“付款即返”可能指付款时取得返现权利，也可能指现金立即到账。方案A付600、付款后无须其他行为但9/20才返100，方案B无返现、成本550：按前一种解释A净支出500并优先，按后一种解释A不计该返现、成本600，B优先。

**最小修改建议：**把“付款即返”定义为可机器判断的时序和条件，并补无后续条件但延迟到账返现的排序用例。

### 17. 重要｜缺口｜`rules.md` D21、R018、§9.5
**问题：**类别的两项标注没有给出Demo实际取值，也未规定怎样映射到具体预留编号、覆盖期间和覆盖额。“餐饮由生活预留覆盖”这一布尔值不能直接生成R003所需核销关系；同一类别同时存在必要支出和额外自由支出时，也没有明确拆分办法。

**最小修改建议：**固定案例中的类别标注及具体预留映射，并规定同类部分覆盖和同口径拆分规则。

### 18. 重要｜歧义｜`rules.md` §5、§7.1、D23；T018-04
**问题：**先分摊Pg还是先去重后分摊Δg，会产生不同逐日金额。例如三天Pg=10.00，Eg=5.00，已安排金额依次为1.67、1.67、1.66：直接分摊Δg，得到1.67、1.67、1.66；先分摊Pg为3.34、3.33、3.33，再逐日去重，则得到1.67、1.66、1.67。总额相同，但付款节点可能差1分；T018-04使用均匀Eg，不能区分两种实现。

**最小修改建议：**明确分摊对象和去重顺序，并用非均匀Eg固定逐日金额预期。

### 19. 重要｜歧义｜`rules.md` §7.2、D25；T020-01、T020-11
**问题：**只固定了l、b等递推值的12位舍入，没有固定SSE等中间量的精度和比较口径。若较小编号参数组SSE为1.0000000000004，另一组为1.0000000000003，保留原精度应选后者；先舍入12位则两者相同，按稳定次序选前者，后续预测可能不同。

**最小修改建议：**固定十进制运算精度、各中间量舍入时点及SSE同值比较规则，并补跨语言边界用例。

### 20. 重要｜测试｜`rules.md` §10.8；T005-01、T004-06、T010-07
**问题：**c01只是资金片段，但若干子用例直接要求完整状态或每日金额，未补B等必要输入。例如T005-01付款700、延期前资金节点通过，但B=650时还应预算超限50，B=800时才可能显示“按当前假设可行”；现有初始数据无法推出其唯一预期。

**最小修改建议：**定义完整业务测试数据并补齐B等必填项，纯资金单元测试另行标明测试层级。

### 21. 重要｜测试｜T001-03、T020-03—T020-04
**问题：**关键测试数据仍是占位描述。T001-03的10月1日余额写为“C0由该案例给出”，但所给材料没有该完整案例；T020-03仅称30个样本“不是常量序列”，没有序列、可获得时间、修改值及固定版本，不能形成可重复的独立核对数据。

**最小修改建议：**落实所引用案例和序列的固定数据版本，并在对应行补足必要数值及独立核对预期。

### 22. 重要｜测试／冲突｜`rules.md` R008；T002-01、T002-03
**问题：**R008要求“本计划判断所需的收付款事件须满足范围限制”，支持范围始于2026年9月1日；T002-01却使用“9月1日前已付门票200”，T002-03使用9月1日前已到账退款。若按完整校验执行，应先触发范围问题，而不能无条件按当前预期纳入成本计算。

**最小修改建议：**将两例改为10月1日快照搭配9月范围内的历史收付款。

### 23. 重要｜测试｜T012-03；`rules.md` R012、D09
**问题：**同一行既断言“A=0、U0=500”，又写“机动预留M是否同时释放不断言”。从c01取消并释放A后，保留M=200才能得到U=500；若同时释放M，则U=700。现有金额断言实际上已经暗中决定了其声称不判断的事项。

**最小修改建议：**先明确该用例取消后的M值，再固定U的数值预期。

### 24. 重要｜冲突｜`rules.md` §10.4判定分支及末尾推论
**问题：**判定分支规定“由一笔流出触发：付款缺口……金额为-U”；末尾却称“‘付款缺口’类型只由不属于本目标、且无预留覆盖的支出产生”。从c01发生非目标生活支出450、由生活预留覆盖300后，C=550、L=0、M=200、A=400、H=350、U=-50，应为付款缺口50，但这笔支出并非“无预留覆盖”。

**最小修改建议：**将推论限定为非目标支出的未覆盖部分导致相应缺口，并补产生缺口的部分覆盖用例。

## 可延后

### 25. 可延后｜测试｜`rules.md` D29；T004-03、T010-09、T015-07
**问题：**D29规定“白名单之外的模拟字段不提供编辑入口”，但测试包含改分配名称、改付款金额和B、改演出日期。没有说明这些是内部输入变异测试还是实际界面操作；若作为四页交互验收，相关操作越过了已批准白名单。

**最小修改建议：**将这些行标明为内部规则测试，并另行验证界面不提供相应编辑入口。

**结论：现在可以开始四页界面骨架和无争议的纯计算单元，但尚不能按这套文档实施完整业务链路，须先解决阻塞项。**