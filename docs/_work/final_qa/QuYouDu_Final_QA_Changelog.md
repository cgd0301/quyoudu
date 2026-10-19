# 趣有度项目书 · 最终 QA 变更记录

- 执行时间：2026-10-19 19:37—21:20（+08:00）
- 对照基线：上一轮交付（`git` 提交 `1f7c2d9` 之后的工作区，PDF 59 页，SHA-256 `217E6DEA…`）
- 交付状态：`git` 两次提交 —— `049a3c6`（代码与文档改动）、`31bb2e1`（重新生成的附录 B 与 PDF）；交付时工作区干净
- 总影响：**59 页 → 58 页**；单元测试 1181 → **1194**；图号 **未变**（仍是图 1—23，无增删）

> 只列实际发生的改动。"差异"一栏写的是可核对的前后内容，不是"优化了文档"这类无法核验的描述。

---

## A. 代码与测试

### A.1 `src/ui/dailyText.ts`（**新增**）

| 项 | 内容 |
| --- | --- |
| 原因 | 修复每日参考「不建议新增」被渲染成 `0.00 元` 的缺陷（R019、§11.4）。原逻辑散落在 `App.tsx` 的三个渲染点，无法单测 |
| 改动前 | `App.tsx` 内联：`amount == null ? dailyLabel : moneyText(amount.value)`；`dailyReasonText` 首行 `if (amount != null) return DAILY_DISCLAIMER` |
| 改动后 | 新增纯函数模块：`dailyStatusText(display)`、`dailyValueText(reference)`（**只有 `display === 'AMOUNT'` 才返回金额**，否则返回状态文案）、`dailyReasonText(reference)`（`AMOUNT` 走免责说明；`NOT_RECOMMENDED` 走"待测额为 0 时已不通过…"） |
| 核验方式 | `tests/unit/ui-daily-text.test.ts` 13 条用例；`T018-09` 端到端断言；旧逻辑临时还原后该断言失败（反向验证） |
| 连带影响 | 无章节/图号/交叉引用影响；PDF §5.4 增加对该文件的引用说明 |

### A.2 `src/App.tsx`

| 项 | 内容 |
| --- | --- |
| 原因 | 接入 A.1；删除三处重复的内联判断与两个本地函数 |
| 改动前 | 第 123—156 行定义 `dailyStatusText`、`SCENARIO_REASON_TEXT`、`dailyReasonText`；第 469 行 `const dailyLabel = …`；三处渲染 `amount == null ? dailyLabel : moneyText(...)` |
| 改动后 | `import { dailyReasonText, dailyValueText } from './ui/dailyText.ts'`；删除上述定义；三处渲染改为 `{dailyValueText(result.dailyReference)}`；`dailyReason` 仍由 `dailyReasonText` 提供 |
| 核验方式 | `pnpm typecheck` 通过；`pnpm test:e2e` 17 条全通过；`App.tsx` 内已无 `dailyReference.amount == null` 的渲染分支 |
| 连带影响 | 概览页、资金日历页、计划管理页三处显示同步改变（同一函数） |

### A.3 `tests/unit/ui-daily-text.test.ts`（**新增**）

| 项 | 内容 |
| --- | --- |
| 原因 | 锁定两种易混状态：`NOT_RECOMMENDED` 不得显示 0.00 元；`AMOUNT` 的真实 0 元仍须显示为金额 |
| 内容 | 13 条，覆盖 `dailyValueText`（AMOUNT 140.00／AMOUNT 0／NOT_RECOMMENDED／UNAVAILABLE／NEED_CONFIRMED_PLAN／AMOUNT 缺金额）、`dailyStatusText`（4 种）、`dailyReasonText`（5 种） |
| 核验方式 | `pnpm exec vitest run tests/unit/ui-daily-text.test.ts` → 13 passed |
| 连带影响 | 单元测试总数 1181 → 1194（+13），附录 B.1 与 §5.3 随之更新 |

### A.4 `tests/e2e/ui-coverage.spec.ts`

| 项 | 内容 |
| --- | --- |
| 原因 | 在真实渲染中验证修复；**不新增 spec**（保持"17 条 spec"口径不变） |
| 改动前 | `T018-09` 只断言最早缺口与"无失败概率" |
| 改动后 | 追加两条：`.daily-reference-block` 内可见「当前不建议新增非计划支出」；该块内**不存在** `0.00 元` |
| 核验方式 | `pnpm test:e2e` → 17 passed；临时还原旧逻辑 → `T018-09` failed（`locator(...).toBeVisible()` 找不到文案） |
| 连带影响 | UI 覆盖计数不变（13／3／5）；不改变追溯表状态 |

### A.5 `tests/unit/tooling-report.test.ts`

| 项 | 内容 |
| --- | --- |
| 原因 | 两条用例断言的是附录 B 的**旧模板**（"端到端已运行并通过"、20 行表的 `| R001 | 是 | 是 | 否 | …`），与 B.3/B.4 的改进互斥 |
| 改动前 | 断言旧措辞与旧表格行 |
| 改动后 | 保留原意并改断言新契约：e2e 通过时须含「UI 层未整体通过」「不计为整体通过」，且**同一句不得连写两次**（新增 `/），UI 层 21 条子用例/` 反向断言）；规则汇总须含「没有任何一条规则的"测试通过"为"是"」，且全部子行通过时才出现「**测试通过**：1 条（R001）」 |
| 核验方式 | `pnpm exec vitest run tests/unit/tooling-report.test.ts` → 14 passed |
| 连带影响 | 无（仅测试） |

---

## B. 生成脚本

### B.1 `scripts/figures.ts`

| 项 | 内容 |
| --- | --- |
| 原因 | ① 四张结构图落款为"模拟数据"，来源标注失实；② 图 3／图 8 纵轴单位写"分"而数值已是元；③ 图 22 十列合计 1140px 超出 1000px 画布，右侧两列被裁切 |
| 改动前 | `frame(title, subtitle, body, height = 560, footer = '模拟数据｜数据来源见 book/figures/index.md')`，`viewBox` 固定 `0 0 1000 H`；`barChart` 未传 `unit`；`fig_forecast_status` 用默认参数 |
| 改动后 | ① 新增 `STRUCTURE_FOOTER = '结构图：按 docs/rules.md 与仓库现有目录/代码人工整理，非引擎导出'`，用于 `fig_architecture`、`fig_engine_pipeline`、`fig_data_flow`、`fig_plan_state_tree`；② 两处 `barChart` 传 `unit: '元'`；③ `frame` 新增第 6 个参数 `width = W`，`viewBox`/背景矩形改用 `width`，`fig_forecast_status` 传 1200 与专门落款 |
| 核验方式 | `git diff --unified=0 book/figures/*.svg` 仅 7 个文件、改动仅限目标 `<text>` 行；`viewBox="0 0 1200 560"`、内容最大 x=1108 < 1200；页面实查 p14（图 3 显示"元"）、p24（图 11/12 落款）、p44（图 22 十列完整）、p45（图 23 落款） |
| 连带影响 | **图号不变**（未增删图，编号仍按正文顺序 1—23）；附录 F 索引的图名/文件名/来源列不变 |

### B.2 `scripts/test-report.ts`

| 项 | 内容 |
| --- | --- |
| 原因 | 附录 B.3 的 20 行表四列取值几乎全同（信息量≈0）、B.4 首句把同一串"13／3／5"连写两次；上一轮只在生成物上手工改，重跑即丢 |
| 改动前 | `B.3 功能实现状态表` + 20 行循环输出；`e2eRemaining()` 返回 `端到端已运行并通过（${detail}），UI 层 21 条…`，其中 `detail` 已含同一串 |
| 改动后 | B.3 改为 4 条汇总结论，动态计算"已实现 N/N""测试通过 X 条（编号）""覆盖最薄的是 R0xx（通过/部分/待执行）"，无通过项时输出"没有任何一条规则…"；`e2eRemaining()` 去掉重复拼接，改为「UI 层未整体通过：{detail}。5 条未覆盖为 T001-03…（说明哪两条是回测指标）。界面因此不计为整体通过…」 |
| 核验方式 | `pnpm test:report` 实跑生成 B；`Get-Content 91_appendix_test_report.md` 检查 B.3/B.4；渲染 p47 目视 |
| 连带影响 | `book/data/status.json` 的 `unfinished[0]` 文案同步变化（正文未引用该字段）；附录 B 页码不变 |

---

## C. 项目书章节

### C.1 `book/chapters/05_validation.md`

| 项 | 内容 |
| --- | --- |
| 原因 | §5.4 把 T020-02／T020-04 误标为"每日参考金额的展示分支"；同时需要如实记录每日参考的真实缺陷与修复 |
| 改动前 | 「未覆盖的 5 条中有 2 条（T020-02、T020-04）对应"每日参考金额"的展示分支，属于高风险区域——一旦渲染层把"暂无法给出建议金额"显示成 0 元，用户会得到错误结论。」 |
| 改动后 | ① 说明 5 条未覆盖的真实原因（T020-02／T020-04 要求分列训练 SSE 与各 h 的回测 MAE_h，界面只有"价格趋势"状态与观测条数；T001-03、T009-06 同类；T013-01 需契约级断言）；② 明确"上一轮误标，本轮已纠正"；③ 记录 `NOT_RECOMMENDED` 的 `amount=0` 导致显示 `0.00 元` 的缺陷、修复方式（按 `display === 'AMOUNT'`）、测试锁定，以及"真实 0 元仍显示为金额""覆盖计数不变（仍 13／3／5）" |
| 核验方式 | 渲染 p25 目视；`doc:lint` 的 T014 系列仍全通过 |
| 连带影响 | 无交叉引用；页数 +0（与 §5.3 表格同页） |

### C.2 `book/chapters/93_appendix_reproduce.md`

| 项 | 内容 |
| --- | --- |
| 原因 | 上一轮在此写入字面 `<!-- data: … -->` 作为说明，成稿残留 `<!-- data:`，触发 `tooling-book.test.ts` 的"成稿不得含未解析占位符"断言（全量单测因此变红） |
| 改动前 | 「通过数据占位符 `<!-- data: … -->` 在构建时由导出结果填入（本版 44 处）」 |
| 改动后 | 「通过构建期的数据占位注释（形如 `data: 文件#路径`，由 `book:build` 解析并替换）…（本版 44 处）」 |
| 核验方式 | `pnpm test` 全部通过（改前 1 failed → 改后 0 failed）；`book:build` 仍报 44 处占位符 |
| 连带影响 | 无 |

### C.3 `book/chapters/95_appendix_risk.md`

| 项 | 内容 |
| --- | --- |
| 原因 | E.1「用户误解"0 元"」一行的证据状态需指向本轮真实落点 |
| 改动前 | 「文案已在 §11.4 固定并有测试」 |
| 改动后 | 「文案已在 §11.4 固定；`src/ui/dailyText.ts` 把"不建议新增"与"无法给出"从真实的 0 元里分出来，13 条单元测试与 T018-09 的断言覆盖」 |
| 核验方式 | 渲染 p55 目视 |
| 连带影响 | 无 |

### C.4 `book/chapters/91_appendix_test_report.md`（**生成物**）

| 项 | 内容 |
| --- | --- |
| 原因 | `pnpm test:report` 实跑后重新生成 |
| 变化 | 套件 154→158、测试文件 31→32、单元用例 1181/1182→**1194/1195**（新增 13 条）；生成来源提交 `33b68b5`→**`049a3c6`**；B.3 由 20 行表改为 4 条汇总结论；B.4 去掉重复句 |
| 核验方式 | 见 B.2；渲染 p47 |
| 连带影响 | 正文通过占位符引用的 `unit.passed` 等数值同步变为 1194 |

### C.5 未改动的章节

`01_positioning.md`、`02_problem.md`、`03_solution.md`、`04_technology.md`、`06_market.md`、`07_business.md`、`08_roadmap.md`、`09_conclusion.md`、`90_product_advice.md`、`92_appendix_rules.md`、`94_appendix_sources.md` 本轮**未改内容**（§2.4 子样本、§8.6 团队标准、A.1 列表、A.9 图 22 均只做复核，不改）。

---

## D. 图表与数据产物

| 文件 | 变化 | 说明 |
| --- | --- | --- |
| `book/figures/fig_architecture.svg` | 落款 1 行 | 模拟数据 → 结构图说明 |
| `book/figures/fig_engine_pipeline.svg` | 落款 1 行 | 同上 |
| `book/figures/fig_data_flow.svg` | 落款 1 行 | 同上 |
| `book/figures/fig_plan_state_tree.svg` | 落款 1 行 | 同上 |
| `book/figures/fig_cost_composition.svg` | 纵轴单位 1 处 | 分 → 元 |
| `book/figures/fig_candidate_compare.svg` | 纵轴单位 1 处 | 分 → 元 |
| `book/figures/fig_forecast_status.svg` | `viewBox` 1000→1200、宽度属性、落款 | 修列裁切；补"10 列字段与 ResultCore.forecasts[] 一一对应" |
| `book/figures/index.md` | 由模板重新生成 | 内容与本轮前一致（五类来源分类不变） |
| `book/data/status.json` | 由 `test:report` 重新生成 | 单元 1194/1195、提交 `049a3c6`、`unfinished[0]` 文案更新 |
| `submission/趣有度_项目书.pdf` | 重新排版 | 59 → **58 页** |

**图号影响**：无。未新增/删除任何图，`figures.ts` 按正文出现顺序赋号的结果仍为图 1—23，正文手写的"图 N"引用无需改动。

---

## E. 排版与页码影响

| 项 | 变化 |
| --- | --- |
| 总页数 | 59 → **58**（附录 A.11 回收至 p45，原 p46 近空白页消失） |
| 目录页 | 仍 2 页；页码由分页器按真实版面位置生成，自动同步 |
| 各附录起始页 | A 40（不变）、B 47→**46**、C 49→**48**、D 51→**50**、E 56→**55**、F 58→**57** |
| 正文各章起始页 | 摘要 4、一 5、二 9、三 13、四 18、五 23、六 28、七 32、八 35、结论 38、产品建议 39（**均不变**） |
| 交叉引用 | 正文不使用页码引用，因此无需改；"图 N""X.Y 节""附录 X"经 `doc:lint` 的 LINKS/FIGURES 检查通过 |

---

## F. 交付物

| 文件 | 变化 |
| --- | --- |
| `deliverables/final/QuYouDu_ICBC_Cup_Final.pdf` | 覆盖为本轮 58 页版本（SHA-256 `80858269…`） |
| `deliverables/final/QuYouDu_ICBC_Cup_Final_Source/` | 重新组装：83 文件 / 3.10 MB；新增 `code/src_ui/dailyText.ts`、`code/tests/ui-daily-text.test.ts`；README 更新为 58 页与四类落款说明 |
| `deliverables/final/QuYouDu_Final_QA_Report.md` | 新增（本报告主体） |
| `deliverables/final/QuYouDu_Final_QA_Changelog.md` | 新增（本文件） |
| `deliverables/final/QuYouDu_Final_Submission_Checklist.md` | 新增 |
| `deliverables/final/QuYouDu_Claim_Source_Ledger.csv` | 更新 C22（1194 条）、C47（58 页／6,458,685 B）、新增 C51（每日参考缺陷）；现 51 条 |
| `deliverables/final/QuYouDu_Revision_Audit_Report.md` | 顶部加"已被本轮更正"说明（59→58 页、T020 归属、1181→1194） |
