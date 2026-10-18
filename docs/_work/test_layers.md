# 测试分层

traceability.csv 的 161 个子用例按断言对象分层，父行（T001、T002……）不列。一行涉及多层的拆成多行，覆盖列括注该部分的内容。

- ENGINE：用 evaluate＋ops 断言 ResultCore。“A4 向量”指 fixtures/vectors 中有对应向量（文件名为测试编号，分情形的加 #n）；写不出的断言登记在 vector_gaps.md。“A4 不可表达”指整行写不成向量，只登记在 vector_gaps.md。
- NL：依赖自然语言提取、追问或解释句，由 A6 覆盖。
- UI：断言页面、组件或 §11.4 以外的文案（含 AGENTS.md 要求的“模拟数据”标识），由 A7 e2e 覆盖。
- DOC：文档检查，由 C4 doc:lint 覆盖。

向量的结构与断言语义见 spec_gaps.md SG-38，输入建模约定见 SG-39。

| 测试编号 | layer | 由哪一步覆盖 |
| --- | --- | --- |
| T001-01 | ENGINE | A4 向量；设备日期改变后重算、与改动前逐项比较见 vector_gaps |
| T001-02 | ENGINE | A4 向量 |
| T001-03 | ENGINE | A4 向量（10月1日独立快照） |
| T001-03 | UI | A7 e2e（用“切换案例／模拟日期”切换；界面不提供任意日期推进） |
| T001-04 | ENGINE | A4 向量 |
| T001-05 | ENGINE | A4 向量（#1 09:00 按 DAY_START 计算，#2 按 AFTER_EVENT(1) 重算） |
| T001-06 | ENGINE | A4 向量 |
| T001-07 | ENGINE | A4 向量（#1、#2、#3） |
| T002-01 | ENGINE | A4 向量 |
| T002-02 | ENGINE | A4 向量 |
| T002-03 | ENGINE | A4 向量 |
| T002-04 | ENGINE | A4 向量；餐饮日均参考 30.00 见 vector_gaps |
| T002-05 | ENGINE | A4 向量；C02 的预计消费净支出见 vector_gaps |
| T002-06 | ENGINE | A4 向量 |
| T002-07 | ENGINE | A4 向量；不进入历史统计和价格预测见 vector_gaps |
| T003-01 | ENGINE | A4 向量 |
| T003-02 | ENGINE | A4 向量 |
| T003-03 | ENGINE | A4 向量；“该80计入P”见 vector_gaps |
| T003-04 | ENGINE | A4 向量（①②为同一向量的两个检查点）；“不执行核销”见 vector_gaps |
| T003-05 | ENGINE | A4 向量 |
| T003-06 | ENGINE | A4 向量 |
| T003-07 | ENGINE | A4 向量 |
| T003-08 | ENGINE | A4 向量 |
| T004-01 | ENGINE | A4 向量 |
| T004-02 | ENGINE | A4 向量 |
| T004-03 | ENGINE | A4 向量 |
| T004-04 | ENGINE | A4 向量 |
| T004-05 | ENGINE | A4 向量 |
| T004-06 | ENGINE | A4 向量；x=100 的探测节点见 vector_gaps |
| T004-07 | ENGINE | A4 向量 |
| T005-01 | ENGINE | A4 向量（延期前、延期后两个检查点） |
| T005-02 | ENGINE | A4 向量（推迟前、推迟后两个检查点） |
| T005-03 | ENGINE | A4 向量 |
| T005-04 | ENGINE | A4 向量；“仍为EXPECTED”见 vector_gaps |
| T005-05 | ENGINE | A4 向量 |
| T005-06 | ENGINE | A4 向量；“50只体现为C02的预计消费净支出较低”见 vector_gaps |
| T006-01 | ENGINE | A4 向量 |
| T006-02 | ENGINE | A4 向量 |
| T006-03 | ENGINE | A4 向量；x 排在该收入之前见 vector_gaps |
| T006-04 | ENGINE | A4 向量 |
| T006-05 | ENGINE | A4 向量 |
| T006-06 | ENGINE | A4 向量（#1 含交换 event_id 前后两个检查点，#2 声明超额） |
| T007-01 | ENGINE | A4 向量 |
| T007-02 | ENGINE | A4 向量 |
| T007-03 | ENGINE | A4 向量 |
| T007-04 | ENGINE | A4 向量 |
| T007-05 | ENGINE | A4 不可表达，见 vector_gaps（舍入函数的单元测试） |
| T007-06 | ENGINE | A4 向量（#1 渠道规则舍去分以下，#2 渠道舍入规则未知） |
| T008-01 | ENGINE | A4 向量 |
| T008-02 | ENGINE | A4 向量 |
| T008-03 | ENGINE | A4 向量 |
| T008-04 | ENGINE | A4 向量 |
| T008-05 | ENGINE | A4 向量 |
| T008-06 | ENGINE | A4 向量 |
| T008-07 | ENGINE | A4 向量 |
| T009-01 | ENGINE | A4 向量；“不自动降为估算”见 vector_gaps |
| T009-02 | ENGINE | A4 向量；D13 的档位次序见 vector_gaps |
| T009-02 | UI | A7 e2e（报价标“估算”，不称为已核实的可执行报价） |
| T009-03 | ENGINE | A4 向量（#1、#2、#3） |
| T009-04 | UI | A7 e2e（价格依据显示为模拟报价并带模拟数据标识；“有效”只表示模拟时点满足所列条件） |
| T009-05 | ENGINE | A4 不可表达，见 vector_gaps（9/10 的合格预测在 9/1 案例中造不出） |
| T009-06 | ENGINE | A4 向量；“说明未得到历史预测支持”见 vector_gaps |
| T009-06 | UI | A7 e2e（不保证未来同价成交的说明） |
| T009-07 | ENGINE | A4 向量 |
| T010-01 | ENGINE | A4 向量 |
| T010-02 | ENGINE | A4 向量；住宿按0计入并保留确认依据见 vector_gaps |
| T010-03 | ENGINE | A4 向量 |
| T010-04 | ENGINE | A4 向量 |
| T010-04 | UI | A7 e2e（结论限定为已评估子集） |
| T010-05 | ENGINE | A4 向量 |
| T010-06 | ENGINE | A4 向量 |
| T010-07 | ENGINE | A4 向量 |
| T010-08 | ENGINE | A4 向量；省略该字段视为 PROVIDED 见 vector_gaps |
| T010-09 | ENGINE | A4 向量（①—④为同一向量的四个检查点） |
| T011-01 | ENGINE | A4 向量 |
| T011-02 | ENGINE | A4 向量 |
| T011-03 | ENGINE | A4 向量 |
| T011-03 | UI | A7 e2e（只表述为已评估子集内最低，不宣称全部已知候选最低或全部无解） |
| T011-04 | ENGINE | A4 不可表达，见 vector_gaps（与独立穷举或人工表格对拍） |
| T011-05 | ENGINE | A4 向量 |
| T011-05 | UI | A7 e2e（结论句与“不表述为确定成本”） |
| T012-01 | ENGINE | A4 向量 |
| T012-01 | UI | A7 e2e（不出现“取消＝0元”或“取消最省钱”） |
| T012-02 | ENGINE | A4 向量；可能退回150及其条件见 vector_gaps |
| T012-03 | ENGINE | A4 向量；机动预留的释放时点见 vector_gaps |
| T012-04 | ENGINE | A4 向量 |
| T012-05 | ENGINE | A4 向量 |
| T012-06 | ENGINE | A4 向量 |
| T013-01 | ENGINE | A4 向量 |
| T013-01 | UI | A7 e2e（四页显示的金额和状态都来自 v2） |
| T013-02 | ENGINE | A4 向量 |
| T013-03 | ENGINE | A4 向量 |
| T013-04 | ENGINE | A4 向量（住宿仍为待填） |
| T013-04 | NL | A6（AI 回复中的 300 不进入计算，解释句不出现该数字） |
| T013-05 | ENGINE | A4 向量 |
| T013-05 | UI | A7 e2e（页面显示模拟数据标识） |
| T013-06 | ENGINE | A4 不可表达，见 vector_gaps（两次读取逐字节相同、结果相同） |
| T013-06 | NL | A6（重算时不调用大模型重新生成数据） |
| T013-07 | ENGINE | A4 向量；待确认差异见 vector_gaps |
| T013-08 | ENGINE | A4 向量 |
| T014-01 | DOC | C4 doc:lint（模拟案例不当访谈证据） |
| T014-02 | DOC | C4 doc:lint（访谈计划不写成已访谈） |
| T014-03 | DOC | C4 doc:lint（技术通过不触发需求成立） |
| T014-04 | DOC | C4 doc:lint（虚拟回测不证明真实效果） |
| T014-05 | DOC | C4 doc:lint（规则确认不等于实现） |
| T014-06 | DOC | C4 doc:lint（演示配置不写成已批准默认） |
| T014-07 | DOC | C4 doc:lint（项目书功能状态与测试运行记录一致） |
| T014-08 | DOC | C4 doc:lint（可选问卷如实标注） |
| T015-01 | NL | A6（固定话术提取，后续追问不再问已提供字段） |
| T015-02 | NL | A6（只追问影响付款检查的 D30 缺失字段，每轮最多2问、最多3轮） |
| T015-03 | ENGINE | A4 向量（初始数据为 T015-01 话术提取后的结构化输入） |
| T015-04 | ENGINE | A4 向量；费用清单中住宿为400见 vector_gaps |
| T015-05 | ENGINE | A4 向量（#1 确认免费，#2 未提及）；住宿为0元并保留确认依据见 vector_gaps |
| T015-06 | ENGINE | A4 向量 |
| T015-07 | ENGINE | A4 向量 |
| T015-08 | ENGINE | A4 向量（计划状态） |
| T015-08 | NL | A6（输出需求草稿、费用清单草稿和关键待办） |
| T015-09 | NL | A6（结构化结果只含 D30 的13个字段，话术未提及的为空并进入待办） |
| T016-01 | ENGINE | A4 向量 |
| T016-02 | ENGINE | A4 向量 |
| T016-03 | ENGINE | A4 向量 |
| T016-04 | ENGINE | A4 向量 |
| T016-04 | UI | A7 e2e（说明 K=3 不是最终定案） |
| T016-05 | ENGINE | A4 向量 |
| T016-06 | ENGINE | A4 向量 |
| T016-07 | ENGINE | A4 向量；C03 与 C04 同属一个同价组见 vector_gaps |
| T016-08 | ENGINE | A4 向量 |
| T016-09 | ENGINE | A4 向量 |
| T017-01 | ENGINE | A4 向量；“草案预览，未确认”对应的标签代码见 vector_gaps |
| T017-01 | UI | A7 e2e（资金日历页标“草案预览，未确认”） |
| T017-02 | ENGINE | A4 向量；“重新检查通过后才进入确认”见 vector_gaps |
| T017-03 | ENGINE | A4 向量 |
| T017-04 | ENGINE | A4 向量 |
| T017-04 | UI | A7 e2e（界面名称“建议分配额（不减少今日可额外支出）”） |
| T017-05 | ENGINE | A4 向量 |
| T017-06 | ENGINE | A4 向量 |
| T017-07 | ENGINE | A4 向量；待确认差异见 vector_gaps |
| T017-08 | ENGINE | A4 向量 |
| T017-09 | ENGINE | A4 向量（行动清单字段） |
| T017-09 | UI | A7 e2e（没有独立的购买日历组件；资金日历时间轴标购买日与付款日） |
| T017-10 | ENGINE | A4 向量（#1 确认 C01，#2 确认 C02） |
| T017-11 | ENGINE | A4 向量 |
| T017-12 | ENGINE | A4 向量 |
| T017-12 | UI | A7 e2e（界面名称“建议分配额（不减少今日可额外支出）”） |
| T018-01 | ENGINE | A4 向量；餐饮日均参考 30.00 见 vector_gaps |
| T018-02 | ENGINE | A4 向量 |
| T018-02 | UI | A7 e2e（只展示覆盖情况或描述统计） |
| T018-03 | ENGINE | A4 向量 |
| T018-04 | ENGINE | A4 向量 |
| T018-05 | ENGINE | A4 向量；分支内 C 与 L 同步减少见 vector_gaps |
| T018-06 | ENGINE | A4 向量 |
| T018-07 | ENGINE | A4 不可表达，见 vector_gaps（可获得时间晚于 as_of 的记录是否使当日不完整没有写定） |
| T018-08 | ENGINE | A4 向量（#1）；②情景结果未引用配置版本见 vector_gaps |
| T018-09 | UI | A7 e2e（只显示最早潜在缺口、相关项目、金额和依据，不显示失败概率） |
| T018-10 | ENGINE | A4 向量（#1、#2） |
| T018-11 | ENGINE | A4 向量；各类别是否由生活预留覆盖、是否同口径见 vector_gaps |
| T018-12 | ENGINE | A4 向量 |
| T019-01 | ENGINE | A4 向量；x=100、x=101 的探测节点见 vector_gaps |
| T019-02 | ENGINE | A4 向量 |
| T019-03 | ENGINE | A4 向量（仅已确认安排的 D 与检查期间）；近月情景各项见 vector_gaps |
| T019-04 | ENGINE | A4 向量 |
| T019-05 | ENGINE | A4 向量 |
| T019-06 | ENGINE | A4 向量 |
| T019-07 | ENGINE | A4 向量 |
| T019-08 | ENGINE | A4 向量；x≤50 的探测节点见 vector_gaps |
| T019-09 | ENGINE | A4 向量 |
| T019-10 | ENGINE | A4 向量；新一期预测650与待确认差异见 vector_gaps |
| T020-01 | ENGINE | A4 不可表达，见 vector_gaps（固定参数的公式单元测试） |
| T020-02 | ENGINE | A4 向量；64组参数的训练 SSE 见 vector_gaps |
| T020-02 | UI | A7 e2e（MAE_h 与基线相同时如实显示） |
| T020-03 | ENGINE | A4 不可表达，见 vector_gaps（起点20的回测预测值不在 ResultCore 中） |
| T020-04 | UI | A7 e2e（训练 SSE 与各 h 的回测 MAE_h 分列显示，标明样本数和步长） |
| T020-05 | ENGINE | A4 向量；购买日10/13的回退见 vector_gaps |
| T020-06 | ENGINE | A4 向量（“模拟历史数据生成的预测估算，不是确定报价”标签） |
| T020-06 | UI | A7 e2e（模拟数据标识；不表述为真实市场预测效果） |
| T020-07 | ENGINE | A4 向量（#1 不可比，#2 预测值为负）；③预测结果未引用配置版本见 vector_gaps |
| T020-08 | ENGINE | A4 向量（#1 有有效参考价，#2 没有） |
| T020-09 | ENGINE | A4 向量 |
| T020-09 | UI | A7 e2e（不显示为确定报价） |
| T020-10 | ENGINE | A4 向量（#1 缺 9/20，#2 缺 9/11） |
| T020-11 | ENGINE | A4 不可表达，见 vector_gaps（舍入函数的单元测试） |
| T020-12 | ENGINE | A4 向量；未确认预测取下一档并提示待确认见 vector_gaps |

## 证据映射契约（SG-76）

追溯表的状态由**真实运行记录**推出，不由测试文件是否存在、名称是否相似推出。映射规则只有一条，写在 `scripts/lib/results.ts` 的 `subIdOf`，实现与测试如下：

- **只从用例名开头提取编号。** 取 vitest 的 `title`（即 `test()` 的第一个参数），不取含 describe 前缀的 `fullName`；`fullName` 只用于核对 `vector_gaps.md` 里“已覆盖：<文件>「<测试名>」”指向的测试确实存在。因此 describe 前缀不会让正确的测试被判为未执行，也不会让“补充 T015-01 的用例”这类只提到编号的名称命中。
- **编号形态固定为 `T`+3 位数字+`-`+2 位数字**，其后必须是空格、`#`、圈号（①、②、③）、全角标点等非 ASCII 数字/字母的字符。`T015-010`、`T015-011` 不会被截成 `T015-01`；`T015-01a`、`T015-01gap` 这类非法写法一律不命中（保守记为“未执行”，不猜）。
- **同一编号多条测试：任一失败即失败，任一跳过即不算通过。** 合并顺序为失败 > 跳过 > 通过，所以“另一条同名测试通过”不能把失败的翻转成通过，被跳过的也不能计入通过。
- **名称缺失、为空或没有编号的测试不产生证据。** 注册了但没跑（没有 assertionResults）、运行错误、向量断言失败都会把该编号记为失败或未执行。
- 该契约是测试证据层的规则，不是业务计算规则，因此不写入 `docs/rules.md` 的 D 编号；对应实现见 `scripts/lib/results.ts`，回归测试见 `tests/unit/tooling-trace.test.ts`「results 编号映射的健壮性」。
