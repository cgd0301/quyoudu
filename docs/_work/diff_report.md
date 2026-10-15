# 引擎与参考实现对拍

## 总体

案例 10，向量 152，检查点 TS 180 / oracle 180
差异 合计 6（P1 6，P2 0，P3 0）
运行失败 0

## P1 演示案例

对象｜字段路径｜TS｜oracle｜相关条款
cB_v3_lodging_unknown/final｜candidates[candidate_id=C01].pending_reasons[0].code｜"COMPARISON_FIELD_MISSING"｜"PRICE_PENDING"｜R016、§12.7
cB_v3_lodging_unknown/final｜candidates[candidate_id=C01].pending_reasons[2].code｜"PRICE_PENDING"｜"COMPARISON_FIELD_MISSING"｜R016、§12.7
cB_v3_lodging_unknown/final｜candidates[candidate_id=C02].pending_reasons[0].code｜"COMPARISON_FIELD_MISSING"｜"PRICE_PENDING"｜R016、§12.7
cB_v3_lodging_unknown/final｜candidates[candidate_id=C02].pending_reasons[2].code｜"PRICE_PENDING"｜"COMPARISON_FIELD_MISSING"｜R016、§12.7
cB_v3_lodging_unknown/final｜candidates[candidate_id=C05].pending_reasons[0].code｜"COMPARISON_FIELD_MISSING"｜"PRICE_PENDING"｜R016、§12.7
cB_v3_lodging_unknown/final｜candidates[candidate_id=C05].pending_reasons[2].code｜"PRICE_PENDING"｜"COMPARISON_FIELD_MISSING"｜R016、§12.7

## P2 向量中未被断言的字段

无

## P3 其余

无
