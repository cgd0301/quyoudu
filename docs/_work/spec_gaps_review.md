# 规格复核与裁决记录（V4 收尾轮）

依据：`docs/rules.md`（权威顺序第一）、`docs/policy_card.md`、`docs/scope.md`、`docs/traceability.csv`。
本文件记录**本轮人工裁决的写回结果、证据与仍未解决的事项**；正式条文写在 `docs/rules.md`，缺口状态写在 `docs/_work/spec_gaps.md`，向量缺口写在 `docs/_work/vector_gaps.md`。

## 一、原 14 条 AI 暂定项：已全部裁决并写回

本轮开始前 `spec_gaps.md` 有 14 条状态为"AI暂定（保守）"、1 条为 SG-76，`pnpm spec:lint` 报 15 条警告；本轮结束后 AI暂定（保守）为 **0** 条。逐条写回位置如下（"已裁决"不等于"已实现"或"已验证"，两者分开列）。

| 编号 | 裁决结论 | 写回位置（正式条文） | 实现位置 | 验证证据 |
| --- | --- | --- | --- | --- |
| SG-47 | 公式内部不额外提前舍入，按 §6 原式整体算完再保留 12 位 | §8.8 D78 | `src/engine/holt/holt.ts`、`forecast.ts` | `tests/unit/holt.test.ts`（T020-01/02/03） |
| SG-48 | 回测不使用相应回测时点尚不可获得的数据 | §8.8 D79 | `src/engine/holt/samples.ts`（`availableAt > origin` 剔除）、`backtest.ts`（按起点切前 t 笔） | `tests/unit/holt.test.ts` 性质「改动回测起点之后的数据，不影响该起点的预测」 |
| SG-49 | 预测状态判定优先级固定，顺序写入条文 | §8.8 D80 | `src/engine/holt/forecast.ts` | `tests/unit/holt.test.ts`「D80 多个条件同时成立时按固定顺序取前者」 |
| SG-64 | 重复确认幂等；版本不符只存草案；只存草案不加版本 | §8.8 D81 | `src/engine/confirm/index.ts`、`evaluate.ts` | `tests/unit/confirm.test.ts`、`m1.test.ts`（T017-02 等） |
| SG-65 | 无法写入确认时不输出误导性的有效预览金额 | §12.7（22）（本轮确认，无需新增条文） | `src/engine/confirm/index.ts`（`confirmView`） | `tests/unit/confirm.test.ts`、`contract.test.ts` |
| SG-66 | 仅为已确认方案生成任务；缺购买记录关联字段时恒为 `PENDING_PURCHASE` | §8.8 D82 | `src/engine/confirm/tasks.ts` | `tests/unit/confirm.test.ts` |
| SG-68 | `limited_by.node_index` 为返回的 `ResultCore.nodes[]` 的零起始下标 | §10.5 第6步、§12.7（25） | 已按该口径实现，未改引擎 | `tests/unit/daily.test.ts`「SG-68 limited_by.node_index 是返回的 nodes[] 的零起始下标」 |
| SG-69 | 遵循 M9 现有接口；历史条件不足时不给可用预测 | §10.5 第4步、§12.7（35）（本轮确认） | `src/engine/scenarios/recent-month.ts`、`daily/scenarios.ts` | `tests/unit/scenarios.test.ts`、`daily.test.ts` |
| SG-70 | 不使用 `as_of` 时点尚不可获得的数据；完整历日与窗口边界明确 | §8.8 D83 | `src/engine/scenarios/window.ts` | `tests/unit/scenarios.test.ts`（观察窗口一组） |
| SG-71 | 标记与固定类别映射冲突时不静默覆盖，按保守异常处理 | §8.8 D84 | `src/engine/scenarios/categories.ts`（`flagsConflict`） | `tests/unit/scenarios.test.ts`（SG-74 用例中的类别冲突分支） |
| SG-72 | 无对应预留的连续日期按确定性规则成组，金额与舍入明确 | §8.8 D85 | `src/engine/scenarios/groups.ts`（`segmentsByReserve`、`buildGroup`） | `tests/unit/scenarios.test.ts` |
| SG-73 | 当日实际支出仅在 `as_of` 已可获得时参与；情景支出不冒充实际 | §8.8 D86 | `src/engine/scenarios/recent-month.ts`（`spentToday`） | `tests/unit/scenarios.test.ts`、性质「历史记录不进入现金流」 |
| SG-74 | 多个不可用原因只按一个固定优先级输出 | §8.8 D87（顺序取自实现与既有测试，未自行发明） | `src/engine/scenarios/recent-month.ts` 的四处 `unavailable(...)` 依次判断 | `tests/unit/scenarios.test.ts`「SG-74 不可用原因的先后」「SG-74 检查期间终点未定…」 |
| SG-75 | 引用标识按与区域设置无关的 UTF-16 码元顺序排序 | §8.8 D88 | `src/engine/compare/index.ts`（`compareRefs`） | `tests/unit/compare.test.ts`（pending/excluded 排序） |
| SG-76 | NL 证据映射严格匹配规范编号，禁止宽松包含匹配 | **不是业务计算规则**，写回 `docs/_work/test_layers.md`「证据映射契约」 | `scripts/lib/results.ts`（`subIdOf`） | `tests/unit/tooling-trace.test.ts`「results 编号映射的健壮性」 |

SG-74 的优先级依据：实现里四处提前返回的顺序为 配置版本 → 历史 → 类别标注 → 覆盖关系，`tests/unit/scenarios.test.ts` 已用"多条件同时成立"的用例锁定该顺序（配置版本+历史+覆盖同时成立时只报配置版本；历史+覆盖同时成立时只报历史）；因此按实现与既有测试把这一个顺序写进条文，没有另选顺序。

SG-76 的处理理由：它约束的是"哪条测试算作哪个子用例的证据"，属于测试证据层契约，不是会改变演示数字的业务规则；若为编号整齐硬塞一个 D 编号，会让人误以为它是计算规则。因此写在 `docs/_work/test_layers.md` 并配解析器回归测试。

## 二、SG-68：已裁决，历史差异当前未复现

- **裁决**：`daily_reference.limited_by.node_index` 表示**本检查点返回的 `ResultCore.nodes[]` 数组中的零起始下标**（`nodes[0]` 是起始节点）。这样该字段能直接定位到对外返回的数据节点，而不是内部探测时间轴的位置。
- **写回**：`docs/rules.md` §12.7（25）与 §10.5 第6步。
- **实现**：`src/engine/daily/index.ts` 的 `nodeIndexOf` 本来就是按 `ctx.nodes`（即 `ResultCore.nodes[]`）查找，**本轮未改引擎**。
- **测试**：`tests/unit/daily.test.ts` 新增两条。T019-01 上 `nodes[] = [START, 9/10 付款, 9/15 生活支出]`，`nodeIndex = 1`；而 `x = D+1` 的探测时间轴因为插入了 `DAILY:X`，同一节点的位置是 **2**。测试同时断言 `nodes[1]` 就是限制节点，且 `probe.failingNode(2) ≠ nodeIndex(1)`，因此该测试能区分两种口径；若实现改回按探测时间轴计数，它会失败。第二条覆盖"没有限制节点时为 null"（T004-06，D 已到 U0）。
- **历史记录（当前未复现）**：早先记录过"参考实现给 2、本实现给 1"的差异。本轮 `pnpm diff:oracle` 实跑结果差异 **0**（P1/P2/P3 均为 0）；逐个比对 `.cache/ts-out/vectors` 与 `.cache/oracle-out/vectors` 中 30 个含 `daily_reference.limited_by` 的向量，`node_index`、`scenario`、`display`、`amount` 完全一致。该差异**不再作为当前事实**，`spec_gaps.md` 已改写为历史记录。要再次触发，需要"限制节点的 `nodes[]` 下标与探测时间轴下标不同"且参考实现按探测时间轴计数的案例；本轮没有构造出来，因此不声称参考实现仍与该口径相反。

## 三、自然语言确认通道：已裁决采用方案 A，不启用 B

链路（已实现、可离线回放）：`提取 → 追问 → 草稿 → 用户逐字段确认 → 构建 CaseFile 输入（confirmations[]）→ caseFileSchema 复验 → 重新计算`。输入一旦变化，旧确认按 D60 进入 `NEEDS_RECONFIRM`。

- **方案 A（已采用）**：确认只在形成输入版本时写入，会话内"再确认一个字段"通过**重建输入版本并重算**完成。不新增 Op、不使用 `PATCH`（D58），规则文字不变。
- **方案 B（不启用）**：新增流程操作 `CONFIRM_FIELDS`，直接写入 `confirmations[]` 并加版本。需要改 `rules.md` §12.4／D29 与 `UI_OP_TYPES`，补 Schema、枚举、验证器、向量与追溯，属数据结构变更，**须单独授权**。本轮**没有**新增 `CONFIRM_FIELDS`。
- **测试与状态映射**：`tests/unit/nl.test.ts` 区分确认成功、非法值、版本变化、超时、服务失败、失败测试与跳过测试；NL 子用例在追溯表中按单元测试层计数（6/6），**不宣传为端到端覆盖**。
- **项目书**：第八章已删去"等待团队裁决 A/B"的表述，改为"已采用 A、B 不启用且需单独授权"。

## 四、向量缺口：T002-05 与类别 B／C

### T002-05 独立核算（人工核算，不等于向量断言通过）

- 本轮用 `evaluate` 复核 `fixtures/vectors/T002-05.json`：`candidates[].net_spend` 对 **C01、C02 均为 88000 分**。
- 构成：`cost.paid_payments` 中 `E0 = 58000`（门票 580.00 元按历史已付款计入），`cost.future_payments` 中 `PLAN:C02:0:LODGING = 30000`；58000 + 30000 = 88000。
- 520 元的报价不覆盖该笔历史实付：向量已断言 `cost.paid_total.value = 58000`、`paid_payments[event_id=E0].amount.value = 58000` 且 `not_eq 52000`。
- **仍未写成向量断言的部分**：原文没有给出 C02 预计消费净支出的数值，按项目规则不得用未写明的数字补预期，`fixtures/vectors/**` 的 `expect` 也受 AGENTS.md §3 保护。因此该条仍按"结算总额只能由人工核算/单元测试核对"登记，**没有**把"人工核算可确认"改写成"向量断言已通过"。

### 类别 B：需要扩展结果契约才能完整断言（本轮不扩展 `ResultCore`）

| 编号 | 缺什么 | 当前只能做到 |
| --- | --- | --- |
| T002-04、T018-01 | 情景组级日均参考 | 组总额 Pg、已列安排 Eg、Δg 与逐日补入额；日均只能人工核算 |
| T002-07 | 逐条是否纳入历史统计的标记 | "不进入时间轴"已断言；入选标记无字段 |
| T018-05 | 情景分支逐节点数值 | 只断言主记录 C0、L0 不变 |
| T018-11 | 是否由生活预留覆盖、是否同口径两个标记 | 只断言类别进出情景 |
| T020-05、T020-12 | 逐项价格依据档位、"存在待确认的预测"标签 | 只断言回测不足与三条预测的确认状态 |

本轮**没有**新增任何 `ResultCore` 字段，也没有为了消除缺口而假造字段值。

### 类别 C：规则或样本条件未解决

| 编号 | 未解决之处 | 处置 |
| --- | --- | --- |
| T018-07 | `available_at` 晚于 `as_of` 时当日是否算完整历日，正式条文未写定 | 保留缺口；D83 只写了"可获得时间晚于 as_of"的记录不算完整历日这一条，条件分支仍未覆盖 |
| T009-06 | "说明未得到历史预测支持"的展示文案与标签语义，§11.4 未定义 | 保留缺口；只断言按参考价 600 计入并列为估算依赖 |
| T009-05、T019-10 | 9 月示例无法满足 §7.2 的 14 个历史样本门槛 | 保留缺口；**不降低门槛、不补造历史数据**，预测在 9 月案例中如实为"历史不足" |

## 五、M2（价格与优惠）边界测试复核

`tests/unit/pricing.test.ts` 现有 27 条。本轮对既有 3 条新增边界逐条复核（未改语义、未动既有 24 条）：

1. 满减门槛未达到时不减免，付款仍为原价，断言 `OFFER_THRESHOLD_NOT_MET`；
2. 同订单多笔付款时，即时类优惠从付款时刻**最晚**的一笔开始冲减（D65）；
3. 同订单多张即时优惠未给计算顺序时计入待确认（`OFFER_ORDER_MISSING`，D45），不静默选择任意顺序。

三条都是独立构造的输入、各有明确的关键输出断言，反向实现（例如改成正向冲减、或静默取第一个顺序）会使对应断言失败。演示数据里同订单合法叠加多张即时优惠仍受 V-03 约束，只能由单元测试覆盖，未新增违反 V-03 的演示向量。

## 六、doc:lint 的自动检查与人工审查项

- **自动检查**：`pnpm doc:lint` 现有 **16 项**（FILES、HEADINGS、PLACEHOLDER、LINKS、CODEPATHS、BANNED、FIGURES、T014-01…06、T014-08、T014-07、NUM），逐项写在 `.cache/report/doc-lint.json` 的 `checks` 里。
- **人工审查项**：同一文件的 `review` 数组，由脚本生成，**当前 10 项**，构成为"没有数据占位符的正文章节"+"图表未被引用"+"两条固定的人工判断项"。本轮实测清单：
  1. `01_problem.md` 没有任何数据占位符：确认正文数字是否都来自导出结果
  2. `05_data_algo.md` 同上
  3. `06_price_offer.md` 同上
  4. `08_confirm.md` 同上
  5. `09_business.md` 同上
  6. `10_safety.md` 同上
  7. `12_roadmap.md` 同上
  8. `90_product_advice.md` 同上
  9. 叙事与论证是否成立、价值假设是否充分，脚本无法判断，需人工审查
  10. 图表与正文结论是否一致，需人工抽查
- **与历史报告的差异**：早先报告写"12 项待人工审查"。该数字由上面这条动态规则生成，随"没有占位符的章节数"变化：本轮是 8 个章节 + 2 条固定项 = 10 项，历史"12 项"对应的是当时 10 个章节无占位符的状态，**具体分项无法从当前仓库重建**。因此本文件只登记当前可核实的 10 项，不编造历史那 12 项的内容。
- **统计口径**：自动检查 16 项与人工审查 10 项分开统计，不合并成"26 项通过"。

## 七、本轮增量核验发现并修正的问题

1. **`status.json` 的 `precheck.assertions` 被截断（已修）**：`scripts/test-report.ts` 原用 `/- 断言通过数：(\S+)/` 从报告正文截取整段文字，`\S` 遇空格即停，于是 `1004／1004（跳过 0）` 被写成 `1004／1004（跳过`。现改为只取整数、由整数拼出展示串 `1004／1004（跳过 0 条）`，结构与数值保持 JSON 类型；并新增"预检记录与本轮向量运行逐项比对"的校验，不一致直接中止生成（不拿过期记录冒充本轮结果）。
2. **`unit.files` 语义歧义（已修）**：该字段实际取的是 vitest 的 `numTotalTestSuites`（含 `describe` 分组，148），不是文件数（28）。现拆成 `unit.suites`（148）与 `unit.files`（28，取 `testResults` 长度），附录 A 也分成"测试套件""测试文件"两行并注明口径。
3. **NL 编号映射加固（已修）**：`subIdOf` 收紧为 `^T\d{3}-\d{2}(?![0-9A-Za-z])`，`T015-010`／`T015-011` 不截断，`T015-01a` 这类非法写法不命中，`T015-05#1`、`T020-07③` 仍归同一子用例。加固后追溯计数不变（116/43/0/22）。
4. **对拍报告缺来源（已修）**：`docs/_work/diff_report.md` 现在带"来源与版本"一节（生成命令、代码提交与提交时间、Node／pnpm／Python 版本、比较对象与"未读 oracle 源码"的声明），由 `pnpm diff:oracle` 实跑写入，不使用系统时钟。
