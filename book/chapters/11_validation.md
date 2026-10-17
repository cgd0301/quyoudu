# 技术验证与局限性

## 已验证的部分

- **确定性**：同一输入与配置重复执行结果逐字节相同；金额全程整数分，不使用浮点（R007）。
- **规则—实现—测试一致**：R001—R020 的 161 条子用例登记在追溯表中；已执行的向量、单元测试与文档检查结果由 `pnpm test:report` 汇总（附录A）。当前测试口径：单元测试通过 <!-- data: status.json#unit.passed --> 条（跳过 <!-- data: status.json#unit.skipped --> 条），测试向量 <!-- data: status.json#vectors.vectors_total --> 个、断言 <!-- data: status.json#vectors.assertions_total --> 条，失败 <!-- data: status.json#unit.failed --> 条。
- **与独立参考实现对拍**：参考实现按同一规则独立实现，逐检查点比对；本轮的差异数为 <!-- data: status.json#oracle_diff.differences -->，比较的检查点 TS <!-- data: status.json#oracle_diff.checkpoints_ts --> 个、参考实现 <!-- data: status.json#oracle_diff.checkpoints_oracle --> 个。
- **golden 冻结**：案例与流程的全部检查点被冻结，任何计算结果变化都会使 `golden:check` 失败，必须走人工审批流程（`golden:freeze` 只允许人工运行）。
- **数据约束**：`validate:cases` 校验案例与向量的结构、禁用词、日期范围与提交版数据约束（V-01—V-07）。

## 当前覆盖的真实状况

追溯表共 <!-- data: status.json#traceability.rows --> 条数据行：通过 <!-- data: status.json#traceability.pass -->、部分覆盖 <!-- data: status.json#traceability.partial -->、已执行未通过 <!-- data: status.json#traceability.failed -->、待执行 <!-- data: status.json#traceability.pending -->。**"部分覆盖"与"待执行"不折算为通过**：它们对应尚未交付的界面层、尚未运行的端到端，以及结果契约里没有对应字段、只能由单元测试或人工复核的断言。

![测试覆盖矩阵](../figures/fig_test_matrix.svg)

![追溯表状态分布](../figures/fig_trace_state.svg)

## 局限

1. **界面与端到端未交付**：四页界面、路由与页面状态不在本轮范围，`tests/e2e` 没有业务用例，Playwright 不会以"无测试"当成功；项目书未使用任何界面截图或占位图片。
2. **自然语言的确认方式（方案 A）**：抽取→追问→草稿→确认→重建输入版本→重算已实现并可离线回放，确认值会写入案例输入的 `confirmations[]` 并参与判断；但"在一次会话内追加确认并自动加版本"需要规则未定义的写入操作，属正式数据契约变更，需业务裁决（见第八章与 `docs/_work/spec_gaps_review.md`）。
3. **结果契约的表达力**：部分断言（如无日均参考字段、无待确认差异字段、价格依据不逐项输出）无法写成向量，只能由单元测试覆盖或明确登记为缺口（`docs/_work/vector_gaps.md`），不通过修改预期值来"消除"缺口。
4. **预测方法简单**：Holt 阻尼趋势只在少量样本上评估，结论限定为"按当前假设"，不构成价格承诺；历史不足时不给预测。
5. **用户价值未验证**：所有关于"用户是否需要"的判断都是假设，本阶段不做需求调研，也不以模拟数据冒充调研。
6. **规则中的 AI 暂定项**：14 条只影响第 12 位小数或输出细节的规则按保守读法实现并登记，等待团队批量复核（`docs/_work/spec_gaps.md`）。

## 复现方式

全部结果可由仓库内的受控输入重建：`pnpm test:report` 生成附录A 与计数，`pnpm export:results` 生成 `book/data`，`pnpm figures` 生成图表，`pnpm doc:lint`、`pnpm count:chars`、`pnpm book:build` 依次检查并合成成稿。步骤与环境要求见附录B。
