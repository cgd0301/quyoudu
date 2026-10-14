# AGENTS.md：「趣有度」Demo 开发规则（所有 AI 代理必须遵守）

## 1 规格来源（按优先级）
1. docs/rules.md（含 §8 演示配置与默认裁决、§9–§12）
2. docs/policy_card.md（V2.1）
3. docs/scope.md
4. docs/traceability.csv（测试与预期）
docs/sources.md 原有内容只读，只允许在文末标题'外部公开资料核验记录（V2.1 新增，原文未改）'之下追加；docs/_inputs/ 只作参考，不是规格；docs/past_policy_card(do not read)/ 不读。

## 2 规格没写到时
先归类再处理，不要因为缺口停工：
- 技术约定（不改变演示主线显示的数字和文案、不改变案例数据结构、不需要改 policy_card/scope 原文）：按更保守的读法实现（结论不更乐观、不输出无依据的数字），在 docs/_work/spec_gaps.md 记录，状态"AI暂定（保守）"。
- 产品取舍（会改变评委看到的画面或话术、改变案例数据结构，或需要改 policy_card/scope 原文）：采用保守的临时处理继续开发，状态"待团队裁决"，附 A/B 选项和推荐；相关测试先不断言。
- 提交版不会触发的情形：在 rules.md §8"提交版数据约束"补一条 V-xx，由 validate:cases 强制，状态"延后（V-xx）"。
编号用 SG-xx，代码注释 // SPEC-GAP SG-xx。"AI暂定"和"待团队裁决"由团队批量复核，代理不得自行改为"已裁决"。

## 3 硬性约束
- 金额一律整数分（Number.isSafeInteger），禁止浮点金额运算；显示只用 formatCents（不带千分位和货币符号的两位小数，rules.md D70）。
- 只用模拟时钟 as_of；禁止 Date.now()、无参 new Date()、Math.random()。
- 金额、日期、约束、排序、预测只在 src/engine/ 中由确定性代码计算。src/nl/ 的 LLM 输出只能成为"待确认值"，不得直接进入计算，也不得改写任何数字、状态或排序。
- 禁止修改：tests/golden/**、tests/golden.lock、oracle/**、fixtures/vectors/** 中的 expect 与 source_text 字段、docs/sources.md 原有内容。测试或向量断言不过就改实现；认为预期有误，记入 docs/_work/vector_disputes.md（向量编号｜断言路径｜预期｜实际｜依据条款｜理由），只把这一条断言登记到 tests/vector-disputes.json 跳过，不得跳过整个向量。团队在对话中明确授权的修改除外。
- 模拟数据在界面和导出中都带"模拟数据"标识；不得出现真实平台名称、真实价格、真实用户反馈或虚构接口。
- 不新增正式文档；规则改动只写入 docs/ 五份文件的对应章节。
- 终端是 Windows PowerShell：不用 >、>>、Out-File、Set-Content 写文件，一律用编辑工具或 Node/Python 脚本写 UTF-8（无 BOM）、LF；新脚本只写 tsx 或 Python，不写 .sh/.ps1。
- 金额字段名不带单位后缀（rules.md §9.1）；D32、D52 中的'_cents 值'指 ResultCore 中登记为金额的字段（src/engine/money.ts 的 moneyPaths）。
- oracle/ 只能用 python -m oracle 运行（通过 pnpm vec --impl oracle 或对拍脚本），不得打开、阅读、引用其源码；分析参考实现只看 .cache/oracle-out/ 的输出。

## 4 工作方式
- 一次只做一个模块；先写测试再实现；完成后运行 pnpm check，全部通过才提交，提交信息带规则或测试编号。pnpm spec:lint 不在 check 中，新增'待团队裁决'不阻塞提交，但要在汇报中列出。
- 不引入 package.json 以外的依赖；确需引入时在汇报中说明理由。
- 汇报用简体中文，只写：做了什么、测试结果、新增的 SPEC-GAP。
- 跑向量用 pnpm vec，不要通读向量文件。单元测试覆盖 vector_gaps 条目时，测试名以“<编号> gap”开头，并把 vector_gaps.md 该条原因列改为“已覆盖：<测试文件>「<测试名>」”。模块的向量全部通过后才把模块号加入 doneModules。换对话前写 .cache/handoff/<模块或任务>.md（不超过 300 字：已完成、失败摘要、下一步），新对话 @ 它继续。

## 5 分工边界
- 主仓库的代理不读写 ../quyoudu-oracle。
- 分支 ui 只改 src/ui/**、src/App.tsx、src/main.tsx、src/*.css、tests/e2e/**、fixtures/mock/**；分支 holt 只改 src/engine/holt/**、tests/unit/holt*。
- 分支 scen 只改 src/engine/scenarios/**、tests/unit/scenarios*。
- 项目书相关工作只改 book/**、submission/**、docs/_work/evidence*、docs/_work/survey/**、docs/_work/team_story.md、docs/_work/judge_*.md，以及 docs/sources.md 文末追加区。
- 标"仅限人工运行"的脚本（golden:freeze、golden:write、oracle:import、oracle:export）代理不得运行。