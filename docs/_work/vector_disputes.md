# 向量争议

登记认为向量预期有误的断言。列：向量编号｜断言路径｜预期｜实际｜依据条款｜理由｜状态。团队授权改写 expect 后，把该条标为已裁决。不得据此跳过整个向量。

| 向量编号 | 断言路径 | 预期 | 实际 | 依据条款 | 理由 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T017-01 | final labels includes DRAFT_PREVIEW | 只断言“草案预览” | 同时断言 DRAFT_PREVIEW 与 PREVIEW_UNCONFIRMED | D62 | 未确认方案的资金日历两句都显示 | 已裁决 |
| T017-02 | 确认 confirmation.input_version not_eq v1 | 只要求不等于 v1 | 断言等于 v2，且确认状态为 CONFIRMED | D63 | 复查通过后直接按当前版本确认 | 已裁决 |
| T003-03 | final cost.future_payments / paid_payments | 行文写计入 P，向量未断言 | 80 元在后续应付中，不在已付中 | §3 | 9 月 1 日看，9 月 20 日的支出尚未发生 | 已裁决 |
| T012-02 | final cost.possible_refund | 行文要求显示可能退回，结果没有字段 | 金额 15000 分，条件为平台审核通过 | §11.1 | 取消页要能写出可能退回的金额和条件 | 已裁决 |

无未裁决条目。上述断言已按团队授权改写 expect，不跳过。
