# AGENTS.md：「趣有度」Demo 开发规则（所有 AI 代理必须遵守）

## 1 规格来源（按优先级）
1. docs/rules.md（含 §8 演示配置与默认裁决、§9–§12）
2. docs/policy_card.md（V2.1）
3. docs/scope.md
4. docs/traceability.csv（测试与预期）
docs/sources.md 原文只读；docs/_inputs/ 只作参考，不是规格。

## 2 规格没写到时
不要自行发明业务规则，也不要停下来等人。采用更保守的处理（不给可行结论、不输出无依据数字、显示"暂无法完整判断"），
在 docs/_work/spec_gaps.md 追加：编号 G-xxx｜位置｜问题｜临时处理｜影响的测试｜状态；代码相应位置注释 // SPEC-GAP G-xxx。

## 3 硬性约束
- 金额一律整数分（Number.isSafeInteger），禁止浮点金额运算；显示只用 formatCents。
- 只用模拟时钟 as_of；禁止 Date.now()、无参 new Date()、Math.random()。
- 金额、日期、约束、排序、预测只在 src/engine/ 中由确定性代码计算。src/nl/ 的 LLM 输出只能成为"待确认值"，不得直接进入计算，也不得改写任何数字、状态或排序。
- 禁止修改：tests/golden/**、tests/golden.lock、oracle/**、docs/sources.md 原文。测试不过就改实现；认为预期有误，记 SPEC-GAP 并跳过该项。
- 模拟数据在界面和导出中都带"模拟数据"标识；不得出现真实平台名称、真实价格、真实用户反馈或虚构接口。
- 不新增正式文档；规则改动只写入 docs/ 五份文件的对应章节。

## 4 工作方式
- 一次只做一个模块；先写测试再实现；完成后运行 pnpm typecheck && pnpm test，全部通过才提交，提交信息带规则编号（如 "R004: allocation conflict"）。
- 不引入 package.json 以外的依赖；确需引入时在汇报中说明理由。
- 汇报用简体中文，只写：做了什么、测试结果、新增的 SPEC-GAP。