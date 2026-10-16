# 「趣有度」A5-prep 至 A7 执行计划（按 10/16 现状改写）

基准：docs/_inputs/plan_base_a5_a7.md（下称"源计划"）。现状全部来自 `python .cache/plan/survey.py` 生成的 .cache/plan/survey.md（2026-10-16 01:58 运行；下文"survey §n"指该文件第 n 节）。与 AGENTS.md 冲突时以 AGENTS.md 为准，与 docs/rules.md 冲突时以 rules.md 为准。

## 推送说明（10/16 10:34，给拉取后开工的队友）

H0 第 1、2 项已完成并随本次推送入库。第一节是 01:58 的调查快照，下面几条以本次推送为准：

- `bb1e3e3`：`docs/_work/diff_report.md` 已是差异合计 0（P1 0，P2 0，P3 0）。`oracle/oracle_inputs.json` 只改了 1 行，`docs/rules.md` 指纹为 `adaa1404d231`。
- `77f321c`：本计划与源计划 `docs/_inputs/plan_base_a5_a7.md` 已入库。
- 引擎标签 `engine-golden-v1` 仍是 `44309a3`。第一节第 2 条写的是当时的 HEAD；此后只有上面两个文档提交，`src/engine` 未改。M1—M9 仍锁定。
- 第一节第 4、16 条里的“未提交 / 未跟踪”已过时，不要再提交那两处对拍改动或这两份计划。
- 第二十四节 Q1–Q8 的“团队决定”仍是（未填）。没填时按各题“未决时默认”执行。注意：Q3 推荐 A、默认 B；Q5 推荐 A、默认 B。其余各题默认与推荐相同（Q1 A、Q2 A、Q4 A、Q6 A、Q7 A、Q8 A）。
- `handoff_a4.md`、`handoff_a4_bundle.md` 留在编写者本机 `.cache/handoff/`，不入库。当前执行以本计划为准。
- 界面、自然语言、`book/`（除 `meta.yml` 外）仍是零起点。现在可以写项目书第 1–3 章。第 4–6 章要等 `book/data`（计划 10/16 12:30 由主窗口推送）。下一步代码任务是 H0 第 3 项填团队决定，然后做第六节 A5-prep。

## 一、现状核对结论

1. 时间：本机 2026-10-16 01:58（周五，UTC+8），距 F1 代码冻结（10/18 14:00）60.0 小时，距提交（10/18 21:00）67.0 小时。依据：survey §1。
2. 引擎 M1—M9 已全部完成并锁定：doneModules 为 M1—M9（src/engine/modules.ts:5）；tag engine-golden-v1 指向 44309a3，就是当前 HEAD，之后没有提交。依据：`git for-each-ref refs/tags`；`git rev-list --count engine-golden-v1..HEAD` 为 0。
3. 测试全绿：`pnpm check` 退出码 0（tsc 0 个错误，vitest 23 个文件 1072 通过、1 跳过）；`pnpm golden:check` 0（"golden lock 一致"）；`pnpm vec --all` 0（"向量 152/152；断言 1004/1004/0；运行错误数 0"）；另跑的 `pnpm spec:lint`、`pnpm validate:cases` 也为 0。依据：survey §3，原始输出在 .cache/plan/cmd/。
4. 对拍已收敛但没有提交：工作区的 docs/_work/diff_report.md:6 为"差异 合计 0（P1 0，P2 0，P3 0）"，已提交版本仍是 6 条 P1（`git show HEAD:docs/_work/diff_report.md`）；oracle/oracle_inputs.json 有 1 行未提交改动（`git diff --stat`，未打开该文件）。diff_rulings.md 共 57 条，没有标"延后（H3）"的；tests/vector-disputes.json 为 0 条；docs/_work/freeze_report.md 不存在。依据：survey §2、§4。
5. 界面和自然语言从零开始：src/ui、src/nl 只有 .gitkeep；src/App.tsx（122 行）仍是 Vite 模板（:2—4 引入 hero.png、react.svg、vite.svg）；vite.config.ts:6 只有 react()、tailwindcss() 两个插件，没有中间件；tests/e2e 只有 .gitkeep；fixtures/flows、fixtures/mock 不存在，fixtures/llm-replay 只有 .gitkeep。依据：survey §6。
6. A7 要用的脚本都没实现：package.json 的 test:e2e（:12）、trace:update（:17）、test:report（:18）、export:results（:36）、doc:lint（:37）等 9 个脚本仍指向 scripts/not-implemented.mjs；scripts/ 下没有 make-mocks.ts、export-results.ts、test-report.ts、trace-update.ts；scripts/lib/oracle-run.ts:215 导出 runOracleOne。依据：survey §5。
7. `pnpm check` 带一个隐藏钩子：package.json:32 的脚本名 precheck 被 pnpm 当作 check 的前置钩子，本次 `pnpm check` 先执行了 `tsx scripts/precheck-report.ts`（.cache/plan/cmd/check.txt）。它运行 python -m oracle unit 并重写 docs/_work/precheck_report.md（scripts/precheck-report.ts:863、:875—877；本次内容无变化，git 无差异）。新建的工作树没有 .cache/precheck.json（.gitignore:32 忽略 .cache/），钩子在 :857 报错，`pnpm check` 会直接失败。
8. 演示流程的文件格式已被现有代码约定：scripts/golden-write.ts:24—28 的 flowFileSchema 是严格对象 {flow_id, input, ops}，:84—103 在人工运行 golden:write --cases 时读取 fixtures/flows/*.json；tests/unit/cases-golden.test.ts:37—45 用它核对 tests/golden/flows。源计划的 {flow_id, case, title, demo_point, ops, screenshots} 会让人工的 golden:write 解析失败。
9. 对照表能由现有引擎完整复现：policy_card.md"演示点—案例对照表"30 行（:1143—1172），涉及 10 个案例，其中 cB_topk 14 行。按"同一案例、同一操作序列取前缀"可合并为 14 组，逐个前缀运行都无报错，状态与对照表文字相符。例如 cB_topk 选 C02、确认、收入延期后，计划状态为 PAYMENT_GAP，确认状态仍为 CONFIRMED，每日参考为 NOT_RECOMMENDED。依据：survey §7 探针表。
10. 结果契约：ResultCore 有 24 个一级键（src/engine/result.ts:309），TS 内为 camelCase，toWire() 才转成 snake_case（src/engine/wire.ts:7）；LABEL_CODES 21 个，与 LABEL_TEXT 一一对应（enums.ts:274、result.ts:355，tests/unit/contract.test.ts:437 有断言）；UI_OP_TYPES 为 D29 白名单 7 个加流程操作 3 个，不含 PATCH、EVALUATE（ops/schema.ts:126；contract.test.ts:456—457）。依据：survey §7。
11. 源计划和规则文件里有几处引用与代码不一致：没有 src/engine/ops.ts（rules.md:1159 仍这样写），实际是 src/engine/ops/schema.ts 与 ops/index.ts；formatCents 已在 src/engine/money/format.ts:4，界面不必另写；.cursor/rules/ui.mdc:9 把 D62 的两句写成一句"草案预览，未确认"，rules.md:649 要求两句分开同时显示；rules.md §8.8 标题（:617）和 §9.9（:830）的编号范围停在 D75，D76、D77 已存在（:663—664）。
12. 引擎可以直接在浏览器里运行：src/engine 下没有 node: 导入、process 或 import.meta（对 src/engine 搜索这三种写法无结果）。因此界面不需要预置结果（mock）或参考实现桥。
13. 自然语言的确认值没有进入计算的通道：cB_topk 有 3 句 nl_script，但 10 个案例的 confirmations[] 都是 0 条（survey §7 案例表）；确认记录只能写在案例输入的 confirmations[]（src/engine/schema.ts:319，D60），UI_OP_TYPES 里没有写入它的操作，D58 又禁止界面使用 PATCH。
14. 规格侧：test_layers.md 共 182 行，UI 层 21 行、NL 层 6 行、DOC 层 8 行；traceability.csv 181 行（20 个父行、161 个子行），"状态"列全部是"待执行"，文件无 BOM、LF；vector_gaps.md 46 行中有 17 行原因列不以"已裁决""已覆盖"开头；spec_gaps.md 最大编号 SG-75，14 条"AI暂定（保守）"。依据：survey §4、§8、§11。
15. `pnpm spec:lint` 只要 spec_gaps.md 全文出现"待团队裁决"就退出码 1（scripts/spec-lint.ts:93—94），它还核对追溯表每行出现的 SG、V、D 编号是否存在（:126—142）。F1 的 `pnpm check:all` 包含 spec:lint。当前没有"待团队裁决"，14 条 AI暂定只打印警告。
16. 分支与工作树：ui 分支在本地和远程都不存在；holt、scen 两个工作树（../quyoudu-holt、../quyoudu-scen）已并入 main，分别落后 30、31 个提交、领先 0。当前未提交：docs/_work/diff_report.md、oracle/oracle_inputs.json；未跟踪：docs/_inputs/plan_base_a5_a7.md、docs/_work/handoff_a4.md（129 KB）、docs/_work/handoff_a4_bundle.md（248 KB）。依据：`git worktree list --porcelain`、`git rev-list --left-right --count main...<分支>`、`git status --porcelain=v1`。
17. 端到端环境已就绪：@playwright/test 1.64.0，chromium-1248 已下载；playwright.config.ts 视口 390×844、deviceScaleFactor 2，webServer 固定 `pnpm dev` 与 5173 端口（:7、:12—13），两个窗口同时跑会抢端口。.env 不存在（.gitignore:2 已忽略）。pandoc 3.12.1 可用；Node v25.9.0、pnpm 12.11.2、Python 3.13.6。依据：survey §6、§11。
18. 项目书侧：book/ 只有 meta.yml（195 个非空白字符，book/meta.yml:4 的 team_name 为"NaiLong(tmp)"）和四个 .gitkeep；docs/_work 下没有 evidence*、team_story.md、survey/、judge_*；全部 55 个提交都来自 cgd0301，队友还没有提交。依据：survey §9（`git shortlog -sn HEAD`）。
19. 当前最大的进度风险：项目书和界面都是零起点，而项目书依赖界面截图、book/data 和 status.json。关键路径是"界面→端到端→截图→项目书"，按本计划最早 10/17 17:00 才有截图；队友如果等截图才动笔，10/18 18:00 的终版构建来不及。对策：book/data 提前到 10/16 12:30、status.json 第一版 10/16 22:00 交付，第 4—6 章的数字先写占位符。

## 二、这一版改了什么

| 改动 | 原因 | 依据 |
| --- | --- | --- |
| A5 的数据源改为界面直接调用 TS 引擎 evaluate；取消 mock 模式、scripts/make-mocks.ts、fixtures/mock 和 mocks 脚本，顶栏不再有数据模式切换 | M1—M9 已完成并锁定，对拍 0 差异；引擎没有 Node 依赖，可在浏览器运行 | src/engine/modules.ts:5；tag engine-golden-v1＝HEAD；diff_report.md:6；第一节第 12 条 |
| A5b 参考实现桥本版不做；只保留一个"开发服务器端 TS 引擎桥"的应急提示词 | 参考实现桥要在演示时依赖 Python，并要标"参考实现"角标；剩余 60 小时不值得做 | scripts/lib/oracle-run.ts:215；第一节第 12 条 |
| 演示流程改用 golden-write 已约定的 {flow_id, input, ops}（由 pnpm flows 生成），标题、步骤、截图等元数据放 fixtures/flow_index.json | 源计划格式会让人工 golden:write --cases 解析失败；借现有机制还能把演示流程的全部检查点锁进 golden | scripts/golden-write.ts:24—28、:84—103；tests/unit/cases-golden.test.ts:37—45 |
| 对照表 30 行合并成 14 个流程，每步标出覆盖的对照表行号（团队可在 Q6 改回每行一个） | 10 行都是"cB_topk 载入"；合并后 e2e 和截图不重复 | policy_card.md:1143—1172；survey §7 探针表 |
| A5-prep 先修工具：precheck 改名 vec:precheck，test:e2e 接 playwright test，Playwright 端口可由 E2E_PORT 改 | 隐藏钩子会让工作树里的 pnpm check 失败，并在主仓库反复重写 docs/_work/precheck_report.md；两个窗口会抢 5173 端口 | package.json:32；scripts/precheck-report.ts:857、:863、:875—877；playwright.config.ts:12—13 |
| A5 拆成 A5-1（框架、目标页、费用页）、A5-2（资金日历页、调整页、流程）、A5-3（冒烟与自查），各开一个对话 | 界面从零开始，一个对话做不完四页 | src/ui 只有 .gitkeep；src/App.tsx:2—4 |
| ui 分支不写 tests/unit，也不改 docs/_work/spec_gaps.md：单元测试和 SG 登记放到"合并 ui"一步在 main 上补；ui 分支的 SPEC-GAP 先写成代码注释 | AGENTS.md §5 只允许 ui 分支改 src/ui/** 等路径（源计划 A5-cal 的 tests/unit/calendar-model.test.ts 越界） | AGENTS.md:36 |
| 提示词引用改为现有文件：src/engine/ops/schema.ts 代替 src/engine/ops.ts；formatCents 用 src/engine/money/format.ts，不在 src/ui 另写 | 源计划和 rules.md 引用的文件不存在；formatCents 已存在 | rules.md:1159；src/engine/money/format.ts:4 |
| 界面字段名统一写 ResultCore 的 camelCase（如 result.earliestGap、result.actionList[].purchaseDate）；导出到 book/data 时才用 toWire 的 snake_case | 界面直接拿 evaluate 的输出；源计划写的是 snake_case | src/engine/result.ts:309；src/engine/wire.ts:7 |
| "草案预览""预览，未确认"两句分开同时显示 | rules.md 优先于 ui.mdc | rules.md:649（D62）；.cursor/rules/ui.mdc:9 |
| A7 拆成 A7-1 导出、A7-2 报告与追溯、A7-3 端到端与截图；A7-1、A7-2 提前到 10/16，与界面并行 | 引擎已锁定，book/data 可以先交给队友；报告脚本不依赖界面 | package.json:12、:17、:18、:36 |
| export:results 只用 TS 引擎，meta.engine 固定为 ts；去掉 runOracleOne 分支和"计算结果来自确定性参考实现"的图注逻辑 | doneModules 已含 M1—M7 | src/engine/modules.ts:5 |
| 报告和导出里的哈希与时间一律取最后一次改动 src、scripts、tests、fixtures 的提交（git log -1 -- 这些路径），录制日期取接口返回的 created 字段；A7 各步先提交代码、再生成并单独提交产出 | AGENTS.md §3 禁止 Date.now() 和无参 new Date()；用 HEAD 的话，提交产出后再跑一次就会变 | AGENTS.md:19；scripts/ 下没有任何读系统时钟的代码（搜索 new Date、Date.now 无结果） |
| trace:update 增加父行汇总规则，写回时保持无 BOM、LF，状态文本不写 SG、D、V 编号 | 追溯表有 20 个父行，源计划的规则只针对子行；spec:lint 会核对追溯表中出现的编号 | survey §8；scripts/spec-lint.ts:126—142 |
| test:report 的 A4-0 预检和单元核对改读 docs/_work/precheck_report.md，对拍改读 docs/_work/diff_report.md，不再汇总"oracle-reference" | 这两份是现成产出；diff:oracle 由人工运行 | precheck_report.md:3、:17；diff_report.md:3—7 |
| A6 拆成 A6-1（核心与录制，10/16 在 main 上与界面并行）和 A6-2（合并后接入目标页）；录制改由新脚本 nl:record 完成 | 核心不依赖界面；目标页合并前在 ui 分支上 | src/nl 只有 .gitkeep |
| A6 的提取字段直接引用 CONFIRMATION_FIELDS 前 13 项；补 T015-08 的草稿输出；"确认值怎样进入计算"改为团队问题 Q1 | 没有写 confirmations[] 的操作，cB_topk 没有确认记录；源计划漏了 T015-08 的草稿 | src/engine/enums.ts CONFIRMATION_FIELDS；schema.ts:319；test_layers.md:130 |
| 新增 H0（收尾提交与团队决定）、A6-prep（密钥）、H-SG6（SPEC-GAP 批量裁决）、数据刷新与预冻结演练 | 有未提交改动；.env 不存在；"待团队裁决"会让 F1 的 check:all 失败；F1 前要演练一遍 | 第一节第 4、15、16、17 条 |
| 前端补充按时间收缩：A5-design 不单独做（风格变量并入 A5-1，方向由 Q4 定）；月历（H-SG5、A5-cal）改为团队选做（Q2）；视觉评审只排一轮，评审结果写 .cache/ui_review/review.md | 时间；ui 分支不能写 docs/_work | 源计划第九部分；AGENTS.md:36 |
| oracle 窗口本阶段默认不开 | 对拍 0 差异，参考实现无需改动 | diff_report.md:6 |
| 新写"提交版范围"一节 | 源计划没有这一节（搜索"提交版范围""必须有""尽量有"均无结果），按源计划 9.3 的砍范围顺序和第三节保底改写 | docs/_inputs/plan_base_a5_a7.md |
| 日程从 10/16 02:00 起重排，队友部分按"零起点"压缩 | 源计划日程覆盖 10/14—10/17，已过期；队友尚无提交 | survey §1、§9 |
| 常见失控表补上现状风险（隐藏钩子、端口、待团队裁决、未跟踪大文件等） | 见第一节第 7、15、16、17 条 | 同左 |

## 三、日程、范围与保底

### 3.1 日程

| 时段 | 主窗口（你） | 工作树 | 队友 | 人工检查点 |
| --- | --- | --- | --- | --- |
| 10/16 02:00—09:00 | 休息。可选：睡前做完 H0 第 1、2 项（10 分钟） | — | — | — |
| 10/16 09:00—09:30 | H0：收尾提交、团队决定 | — | 拉取仓库；读本计划第三节和第二十四节 | 09:30 第二十四节各题填好"团队决定" |
| 10/16 09:30—09:45 | A5-prep 第一部分（Grok） | — | 第 1—3 章（不需要数据） | 09:45 看到第一部分提交后建 ui 工作树 |
| 10/16 09:45—11:00 | A5-prep 第二部分 | A5-1（Grok，Plan Mode 起步） | 同上 | 11:00 人工锁定流程结果（golden:write、golden:freeze） |
| 10/16 11:00—12:30 | A7-1 export:results | A5-1 | 同上 | 12:30 book/data 第一版推送，通知队友 |
| 10/16 12:30—13:30 | 午饭；A6-prep（密钥、.env）；Q2 选 B 时做 H-SG5（Opus） | A5-1 收尾 | — | 13:30 看 A5-1 的页面 |
| 10/16 13:30—18:00 | A6-1 自然语言核心与录制（Grok，Plan Mode 起步） | A5-2 | 第 4—5 章（用 book/data） | 18:00 看 A5-2 |
| 10/16 19:00—22:00 | A7-2 test:report、trace:update | A5-3 | 第 6 章框架（数字写占位符） | 20:00 砍范围检查点；22:00 status.json 第一版推送 |
| 10/16 22:00—24:00 | 收尾、推送 | A5-review（Opus）→ A5-fix（Grok） | — | 24:00 `git push` |
| 10/17 09:00—10:00 | 合并 ui（Grok） | Q2 选 B 时建 ui-cal 工作树 | 第 7—11 章 | 10:00 人工逐页检查 |
| 10/17 10:00—12:30 | A6-2 目标页接入（Grok） | Q2 选 B 时做 A5-cal | 同上 | 12:00 检查：四页、流程、自然语言都能演示 |
| 10/17 13:30—17:00 | A7-3 端到端与截图（Grok） | Q2 选 B 时 13:30 前合并 ui-cal | 第 6、12 章和附录 | 17:00 截图第一版推送 |
| 10/17 17:00—18:00 | H-SG6 SPEC-GAP 批量裁决（Opus＋全队） | — | 参与裁决 | 18:00 `pnpm spec:lint` 通过 |
| 10/17 19:00—20:00 | 人工 diff:oracle；数据刷新与预冻结演练 | — | C4 首次构建 | 20:00 截图、book/data、status.json 定稿推送 |
| 10/17 20:00—23:00 | 只修演练发现的阻断问题，重拍受影响的截图 | — | C5 评委模拟 | 23:00 `git push` |
| 10/18 08:00—12:00 | 缓冲：只修阻断问题，不加功能 | — | C5 修改；C6 | 12:00 最后一次全量运行 |
| 10/18 12:00—14:00 | F1 准备；14:00 F1 代码冻结 | — | H5 | 14:00 F1 |
| 10/18 14:00—21:00 | 协助队友重建项目书、核对截图与数字 | — | 18:00 终版构建 | 20:00 F2；21:00 H6 提交 |

队友写项目书需要的三样东西，交付时间如下（每次都是主窗口 `git push` 后通知队友 `git pull --rebase`）：

- book/data（cases、flows、index.json）：第一版 10/16 12:30；定稿 10/17 20:00；最晚 10/17 22:00，之后只在 F1 前的修复改变了数字时重推。
- 截图（book/figures/screens/ 与 index.md）：第一版 10/17 17:00；定稿 10/17 20:00；最晚 10/17 23:00。
- book/data/status.json：第一版 10/16 22:00（e2e 记"未执行"）；第二版 10/17 17:00（含 e2e）；终版 10/18 14:30（F1 完成后）。第 6 章和附录的计数一律写占位符 `<!-- data: … -->`，由终版构建填入。

### 3.2 提交版范围

必须有：

1. 四页（目标、费用、资金日历、调整）的基本内容；10 个案例可切换；14 个演示流程可逐步执行；页面上的数字全部来自 TS 引擎。
2. 每页都有"模拟数据"标识；状态文案取 rules.md §11；金额只经 formatCents 显示；页面不出现 PATCH，也不出现枚举代码原文。
3. 自然语言的提取、追问、解释（replay 或 off 模式）及 tests/unit/nl.test.ts。
4. export:results、test:report、trace:update 可重跑且结果不变；book/data、book/data/status.json、book/chapters/91_appendix_test_report.md。
5. e2e：每个流程一组测试，test_layers.md 的 UI 层 21 行；项目书截图与 index.md。
6. `pnpm check:all`、`pnpm vec --all`、`pnpm golden:check` 全绿，spec_gaps.md 没有"待团队裁决"。

尽量有（时间不够时从上往下砍）：

1. 视觉评审第二轮（本计划只排一轮）；
2. 月历视图（Q2 选 B 时才有）；
3. 资金曲线的精修、动画与悬停效果（保留基本折线和节点标记）；
4. 节点详情里的依据展开（缺口卡上 D34 的两项依据保留）；
5. 视觉评审第一轮（A5-review、A5-fix）；
6. live 录制与调用量统计（没有密钥时直接砍，项目书不写调用量）；
7. 目标页的实时（live）模式演示（只留 replay 与 off）。

第二段再做（提交后）：两个视觉方向的 HTML 原型与 docs/_work/ui_design.md（源计划 A5-design）；本版没做的月历视图；10/1 历史分析补充案例的界面演示（fixtures/cases 里没有该案例，对照表也没有对应行）；视觉评审第二轮以后的打磨。

### 3.3 保底

- 10/16 09:45 A5-prep 第一部分还没提交：照样建 ui 工作树；工作树里不运行 `pnpm check`，改为逐条运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`（避开 precheck 钩子），e2e 用 `pnpm exec playwright test`。
- 10/16 12:30 export:results 没完成：队友第 4—6 章的数字一律写占位符，不从任何其他文件抄；A7-1 顺延到 13:30，A6-1 相应后移。
- 10/16 20:00 A5-2 没通过：A5-3 只修阻断问题；砍"尽量有"第 1—5 项；调整页的 CHANGE_PAYMENT_DATE、CONFIRM_FORECASTS 表单只保留"当前案例没有可选项"的说明。
- 10/17 10:00 合并 ui 失败（冲突，或 e2e 大面积失败）：不在 main 上硬修，回到 ui 工作树修完再合并，A6-2 顺延；12:00 仍不行，A7-3 只保证 01、04、05、10、11、14 号流程，其余流程如实记"已执行未通过"。
- 10/17 12:00 还没有可用的 Poe 密钥或录制失败：自然语言只演示 off 模式，目标页写"自然语言辅助未接入，请用表单填写"；不伪造回放文件；项目书不写调用量。
- 10/17 18:00 仍有"待团队裁决"：团队负责人在对话中逐条授权按"推荐"裁决；否则 F1 的 check:all 必然失败。
- 10/17 20:00 界面仍不可用：改交静态截图，标"界面原型"。
- 10/17 22:00 e2e 仍有失败：不跳过、不改预期；test:report 和 trace:update 如实记"已执行未通过"，项目书的状态表照写；项目书只用通过的流程截图。
- 10/18 12:00 最后一次全量运行有失败：F1 照常进行，失败项写入 docs/_work/freeze_report.md 的"已知限制"一节。
- 10/18 14:00 代码冻结，这是硬线。

## 四、模型分配与用法

| 步骤 | 模型 | Plan Mode | 为什么 |
| --- | --- | --- | --- |
| H0、A6-prep、各人工检查点 | 不用模型 | — | 人工操作 |
| A5-prep | Grok 4.7 | 否 | 脚本和测试都有单元测试自检；流程分组已在提示词里给定 |
| A5-1 | Grok 4.7 | 是（开头一次） | 定下数据流、状态管理和组件结构，A5-2、A5-3 沿用 |
| A5-2、A5-3、A5-fix | Grok 4.7 | 否 | 沿用 A5-1 的结构 |
| A5-review | Claude Opus 5.5 | 否 | 评审属于裁决类，和写界面的 Grok 不是同一家；只写评审文件 |
| 合并 ui、A5b（应急） | Grok 4.7 | 否 | 合并和接线 |
| A6-1 | Grok 4.7 | 是（开头一次） | 服务端密钥隔离、三种模式、解释句校验要先定结构 |
| A6-2 | Grok 4.7 | 否 | — |
| A7-1、A7-2、A7-3、预冻结演练 | Grok 4.7 | 否 | 写脚本、写测试，都有自检 |
| H-SG6（SPEC-GAP 批量裁决）、H-SG5（选做） | Claude Opus 5.5 | 否 | 写规则条文和裁决记录，与写代码的模型不同家 |
| A5-cal（选做） | Grok 4.7 | 否 | — |
| oracle 窗口 | GPT-5.6 sol | — | 本阶段默认不开：对拍 0 差异，参考实现不用改。只在 H-SG5 之后或人工 diff:oracle 出现差异时开，提示词只能引用它工作区里的文件 |

预计用量：Opus 2—4 个对话（A5-review、H-SG6、可能的升级、H-SG5），GPT 0—1 个，其余约 14 个对话用 Grok。

升级规则：Grok 在同一步里连续两轮"改代码 → 跑该步验收命令"之后失败数都没下降，就让它停下，写 .cache/handoff/<步骤>.md。然后开一个 Opus 新对话，只修还失败的部分。修完回到 Grok 做下一步。

裁决要独立：视觉评审和 SPEC-GAP 裁决用 Opus，写代码用 Grok。

省额度的做法：

- 每一步都开新对话，结束就关。
- 不让代理通读 rules.md（135 KB）、traceability.csv 或整批向量文件；提示词只给条款号和小节号；向量用 `pnpm vec` 看紧凑的失败表。
- MAX 模式只在 Opus 评审、裁决或升级时开。
- Plan Mode 只在 A5-1、A6-1 开头各用一次：新建对话时先切到 Plan 模式再粘贴提示词，确认计划后切回 Agent 执行。
- 不用云端代理。

怎么用代理：

- 每一步在 Agent 面板新建对话：先选模型，再粘贴提示词。
- 同一个文件夹同一时间只跑一个代理。要并行，就用工作树开另一个 Cursor 窗口。
- 代理中途停下时，回复："继续，从第 n 步开始，已完成的不要重做。"
- 每天结束前在主窗口运行 `git pull --rebase` 和 `git push`。你和队友改的路径不重叠，rebase 不会冲突。
- pnpm 会把脚本名后面的参数直接传给脚本，所以本文写作 `pnpm vec --module M3`，中间不加 --。
- PowerShell 5 不支持 `&&`：下面的命令都逐行运行。

并行方式（git 工作树）。A5-prep 第一部分提交后，在主窗口终端运行：

```powershell
cd D:\programs\project\quyoudu
git worktree add ..\quyoudu-ui -b ui
cd ..\quyoudu-ui
pnpm install --frozen-lockfile --offline
```

`--offline` 报缺包时去掉它重跑一次。然后在 Cursor 里"文件 → 新建窗口 → 打开文件夹"，选 D:\programs\project\quyoudu-ui。工作树窗口的终端先设端口，避免和主窗口抢 5173：

```powershell
$env:E2E_PORT='5174'
```

合并 ui 并确认无误后，在主窗口删除工作树：

```powershell
cd D:\programs\project\quyoudu
git worktree remove ..\quyoudu-ui
git branch -d ui
```

已合并的旧工作树（可选清理，有未提交文件时会拒绝删除，先看清再处理）：

```powershell
git worktree remove ..\quyoudu-holt
git worktree remove ..\quyoudu-scen
```

## 五、H0 收尾提交与团队决定【新】

- 要点：你｜不用模型｜约 30 分钟｜前置：无｜产出文件：docs/_work/plan_a5_a7.md（第二十四节"团队决定"行）、.cursor/rules/ui.mdc（Q3 选 A 时）｜验收：`git status --short` 只剩你决定不提交的文件；`pnpm check:all` 退出码 0

提示词：无（人工步骤）。

人工操作：

1. 核对并提交 01:21 对拍后留下的两处改动（diff_report 由 6 条 P1 变为 0 条；oracle_inputs.json 改了 1 行）：

```powershell
cd D:\programs\project\quyoudu
git diff -- docs/_work/diff_report.md
git diff --stat -- oracle/oracle_inputs.json
git add docs/_work/diff_report.md oracle/oracle_inputs.json
git commit -m "H3: 第 5 轮对拍 0 差异（diff_report、oracle 输入指纹）"
```

2. 源计划和本计划入库；两个 handoff 大文件移出 docs/（推荐，免得代理 `git add` 时带上）：

```powershell
git add docs/_inputs/plan_base_a5_a7.md docs/_work/plan_a5_a7.md
git commit -m "plan: A5-prep 至 A7 执行计划"
Move-Item docs/_work/handoff_a4.md .cache/handoff/
Move-Item docs/_work/handoff_a4_bundle.md .cache/handoff/
```

3. 全队在第二十四节逐题填写"团队决定"一行。Q3 选 A 时，把 .cursor/rules/ui.mdc 第 8 行改为：`- 手机框内顶栏常驻：模拟日期 as_of、"模拟数据"徽标、输入版本、配置版本（DEMO-CFG-1，K=3）；案例切换、演示流程与"下一步"放在手机框外的演示控制台。`

```powershell
git add docs/_work/plan_a5_a7.md .cursor/rules/ui.mdc
git commit -m "plan: 团队决定 Q1-Q8"
git push
pnpm check:all
git status --short
```

卡住时怎么办：

- `git diff` 显示 diff_report 不是 0 差异：先不提交，回看 H3 第 5 轮的记录再决定。
- `pnpm check:all` 失败：停下，后续步骤都不开始。引擎已锁定，正常情况下不应失败。

## 六、A5-prep 工具修正与演示流程【改】

- 要点：主窗口｜Grok 4.7｜约 1.5 小时（第一部分约 15 分钟）｜前置：H0｜产出文件：package.json、scripts/precheck-report.ts、playwright.config.ts、fixtures/flow_index.json、fixtures/flows/、scripts/make-flows.ts、tests/unit/flows.test.ts、docs/_work/spec_gaps.md｜新建脚本：vec:precheck、flows｜改写脚本：test:e2e｜新建标识：E2E_PORT｜验收：`pnpm check`；`pnpm flows --check`；`pnpm golden:check`

提示词：

```text
@AGENTS.md @package.json @scripts/precheck-report.ts @playwright.config.ts @scripts/golden-write.ts @tests/unit/cases-golden.test.ts @src/engine/ops/schema.ts @src/engine/schema.ts @docs/policy_card.md（只看第 1137—1172 行"演示点—案例对照表"）@docs/_work/plan_a5_a7.md（只看第二十四节 Q6 的"团队决定"）
目标：先修两处工具问题并单独提交，再把演示点对照表做成可逐步执行、结果可锁定的演示流程。只在主仓库 main 上工作；不改 src/、oracle/、tests/golden/、tests/golden.lock、fixtures/cases/、fixtures/vectors/；不打开 oracle/；不运行 golden:write、golden:freeze、oracle:export、oracle:import。终端是 PowerShell 5，命令逐行运行，不用 &&。

第一部分（完成后立即单独提交）
1. package.json 第 32 行的脚本名 precheck 会被 pnpm 当作 check 的前置钩子自动运行：每次 pnpm check 都会跑 python -m oracle unit 并重写 docs/_work/precheck_report.md，新工作树没有 .cache/precheck.json 时直接失败。把脚本名改为 vec:precheck，命令不变；scripts/precheck-report.ts 第 2 行注释同步改为 pnpm vec:precheck；用 git grep -n "pnpm precheck" 确认没有别处引用。
2. package.json 的 test:e2e 改为 playwright test。playwright.config.ts：端口取环境变量 E2E_PORT，缺省 5173；webServer.command 改为 pnpm dev --port 加该端口加 --strictPort，webServer.url 与 use.baseURL 同步；reuseExistingServer 设为 false；其余设置不变。
3. 运行 pnpm check（输出里不应再出现 tsx scripts/precheck-report.ts）和 git status（docs/_work/precheck_report.md 不应出现）。提交 "chore: precheck 改名 vec:precheck；test:e2e 接 Playwright"，只 git add package.json scripts/precheck-report.ts playwright.config.ts。

第二部分 演示流程
4. 新建 fixtures/flow_index.json，结构为 { "simulated": true, "flows": [ … ] }。对照表数据行按出现顺序编号 1—30。Q6 的团队决定为 B 时改为每行一个流程；未填或为 A 时，按"同一案例、同一操作序列取前缀"合并为下列 14 个流程（flow_id｜case｜ops｜各步覆盖的行，k 为已执行的操作数）：
   01_cB_topk_main｜cB_topk｜SELECT_CANDIDATE（C02）→ CONFIRM（C02，C02@v1，v1）→ DELAY_INCOME（E-INC-1020，2026-11-20）｜k0：1、6、7、12、16、22、23、24、27、28；k1：10；k3：29；nl 为 true
   02_cB_topk_reconfirm｜cB_topk｜SELECT_CANDIDATE（C02）→ CONFIRM（同上）→ EVALUATE（label 第1次确认）→ CONFIRM（同上）→ EVALUATE（label 第2次确认）｜k3、k5：11
   03_cB_topk_living｜cB_topk｜ADD_LIVING_EXPENSE（2026-09-10，20000，NEW_RESERVE）｜k1：25
   04_cA_gap_living｜cA_gap｜SELECT_CANDIDATE（C01）→ ADD_LIVING_EXPENSE（2026-09-10，15000，NEW_RESERVE）｜k1：19、20；k2：21
   05_cA_gap_allocation｜cA_gap｜SELECT_CANDIDATE（C01）→ SET_ALLOCATION（goal_allocation 60000）｜k2：26
   06_cB_v3_select｜cB_v3_lodging_unknown｜SELECT_CANDIDATE（C02）｜k0：4、13；k1：5
   07_cB_v4_free｜cB_v4_lodging_free｜无操作｜k0：3
   08_cB_v1_two｜cB_v1_two_feasible｜无操作｜k0：8
   09_cB_v2_zero｜cB_v2_zero_feasible｜无操作｜k0：9
   10_cB_v5_pause｜cB_v5_cancel｜PAUSE｜k0：2；k1：14
   11_cB_v5_cancel｜cB_v5_cancel｜CANCEL｜k1：15
   12_c00_v1_missing｜c00_v1_living_not_provided｜无操作｜k0：17
   13_c01_reevaluate｜c01_base｜EVALUATE（label 第1次）→ EVALUATE（第2次）→ EVALUATE（第3次）｜k1、k2、k3：18
   14_c00_today_spend｜c00_r019_minimal｜ADD_TODAY_SPEND（4000）｜k0：17（对照）、30；k1：30
   每个流程写 flow_id、case、title（中文，不超过 20 字）、nl（布尔）、ops（按 src/engine/ops/schema.ts 的 opSchema 填全参数，金额为整数分）、steps[]（每项为 k、rows、expect）、screenshots[]（每项为 k、page，page 取 目标、费用、资金日历、调整 之一）。
   对照表没给出的参数统一为：新增生活支出的事件编号 E-LIV-0910、新建预留编号 R-LIV-0910；当日消费的事件编号 E-TODAY-0901；ADD_LIVING_EXPENSE 的 expected_at 写 2026-09-10（只给日期，D71 按 DATE 处理），不填 category；ADD_TODAY_SPEND 的 actual_at 取该案例输入 snapshot.as_of 的原文，coverage 为 []，不填 goal_id、cost_item_id、category。先在对应案例文件里确认这些编号不重名。以上作为一条 SPEC-GAP 登记到 docs/_work/spec_gaps.md（编号取现有最大编号加 1，状态"AI暂定（保守）"）；流程合并方式另登记一条，同样为"AI暂定（保守）"。
5. steps[].expect 只从对照表"应看到的结果"原文翻译，不要先跑引擎再抄结果。原文写了计划状态、优化状态、确认状态的，按 docs/rules.md §11.1—§11.3（只读这三小节）换成 src/engine/enums.ts 中 PLAN_STATES、OPTIMIZATION_STATES、CONFIRMATION_STATES 的取值，写入 planState、optimizationState、confirmationState；写了每日参考文案的，写入 daily（DAILY_DISPLAYS 的取值）或 dailyLabel（LABEL_CODES 的取值）；写了其他 §11.4 固定文案的，写入 labels（LABEL_CODES 的取值）。每日参考已用 display 或 label 表达的句子不写入 labels（§12.7 第（31）条）。原文没写的键不写。
6. screenshots：rows 非空的每一步至少一张，页面取该行"应看到的结果"所在的页（状态、缺口、行动清单、每日参考→资金日历；候选、确认、暂停与取消→调整；费用、价格依据、已付→费用；对话、确认字段→目标），全部合计不超过 40 张。
7. 新建 scripts/make-flows.ts，package.json 增加脚本 flows：tsx scripts/make-flows.ts。它读取 fixtures/flow_index.json 和 fixtures/cases/ 下对应的案例，写出 fixtures/flows/ 下每个流程一个文件，内容严格符合 scripts/golden-write.ts 的 flowFileSchema（只有 flow_id、input、ops 三个键）：input 为案例原样；ops 为在 index 的 ops 开头和每个非 EVALUATE 操作之后各插入一个 EVALUATE（label 为字母 k 加已执行的 index 操作数，如 k0、k1），index 里原有的 EVALUATE 原样保留。2 空格缩进、LF、末尾换行。加 --check 参数时只比较、不写入，不一致时退出码 1。生成逻辑写成导出的纯函数，供测试调用。
8. 新建 tests/unit/flows.test.ts（测试名以 flows 开头）：index 中每个流程的 ops 通过 opsSchema，操作类型只在 UI_OP_TYPES 与 EVALUATE 之内（不得有 PATCH）；fixtures/flows 与 index 一一对应，且与生成函数的结果逐字相同；input 与 fixtures/cases 中对应案例深相等；1—30 每一行至少被一个 steps[].rows 覆盖；screenshots 的 k 不超过该流程 ops 的长度，page 合法；对每个 steps[]，用 src/engine/evaluate.ts 的 evaluate（config 为 src/engine/config.ts 的 DEMO_CFG_1）执行前 k 个操作，最后一个检查点满足 expect：result.states 的三个状态相等，result.dailyReference.display 等于 daily，result.dailyReference.label 等于 dailyLabel，labels 中每一项都在 result.labels 里；并且 result.inputIssues 不含 REFERENCE_INVALID。某条 expect 与引擎结果不符时，既不改 ops 去凑，也不改 expect 去凑：把这一条从 expect 中删去，登记到 docs/_work/spec_gaps.md（状态"待团队裁决"，写明对照表行号、原文、引擎结果，并附 A/B 选项和推荐），在汇报中列出。
9. 运行 pnpm flows、pnpm flows --check、pnpm check、pnpm golden:check。提交 "A5-prep: 演示流程 14 个（policy_card 第八节对照表 1—30 行）"，只 git add fixtures/flow_index.json fixtures/flows scripts/make-flows.ts tests/unit/flows.test.ts package.json docs/_work/spec_gaps.md。
汇报不超过 200 字，只写：做了什么、测试结果、新增的 SPEC-GAP、问题。
```

人工操作（第二部分提交后，锁定 14 个流程的全部检查点；只有你能运行 golden:write 与 golden:freeze）：

```powershell
cd D:\programs\project\quyoudu
pnpm golden:write --cases
git status --short
pnpm golden:freeze
pnpm golden:check
git add tests/golden tests/golden.lock
git commit -m "golden: 演示流程 14 个（全部检查点）"
git tag flows-golden-v1
git push
git push origin flows-golden-v1
```

`git status --short` 应只多出 tests/golden/flows/，tests/golden/cases 不应有改动；有改动就先不 freeze，停下查原因。

卡住时怎么办：

- flows.test.ts 有 expect 对不上：按提示词第 8 条登记，不要让代理改 ops 或案例。登记的"待团队裁决"留到 H-SG6 处理。
- 编号与案例里已有的事件或预留重名：改用同样格式的其他编号（如 E-LIV-0910B），在那条 SPEC-GAP 里写明。
- 人工 golden:write 后 tests/golden/cases 出现改动：说明引擎输出变了，不要 freeze，先用 `git diff --stat` 看是哪个案例，再回看最近的提交。

## 七、A5-1 界面框架、目标页与费用页【改】

- 要点：工作树 ../quyoudu-ui（分支 ui）｜Grok 4.7（开头 Plan Mode）｜约 3 小时｜前置：A5-prep 第一部分已提交、工作树已建｜产出文件：src/App.tsx、src/main.tsx、src/index.css、src/App.css、src/ui/、src/ui/data.ts、src/ui/engine.ts、src/ui/store.ts、src/ui/text.ts、tests/e2e/smoke.spec.ts、.cache/handoff/A5-1.md｜验收：`pnpm check`；`pnpm test:e2e`

提示词：

```text
@AGENTS.md @.cursor/rules/ui.mdc @docs/_work/plan_a5_a7.md（只看第二十四节 Q3、Q4、Q5、Q7 的"团队决定"）@docs/policy_card.md（只看第 171—203 行第四节、第 1047—1057 行第八节页面结构）@src/engine/result.ts @src/engine/enums.ts @src/engine/evaluate.ts @src/engine/config.ts @src/engine/money/format.ts @src/engine/schema.ts @src/engine/ops/schema.ts
目标：在分支 ui 的工作树里搭好四页界面的框架，并完成目标页和费用页。只改 src/ui/**、src/App.tsx、src/main.tsx、src/*.css、tests/e2e/**（AGENTS.md §5）；可以 import src/engine/、scripts/lib/ 和 fixtures/ 下的文件，但不修改；不改 package.json、vite.config.ts、playwright.config.ts、docs/、tests/unit/；不删除 src/assets/（不在允许路径内，只是不再引用）；不打开 oracle/；不读 .env。规则只看 docs/rules.md 的 §9.2、§11，不通读全文。
先给出计划（文件结构、数据流、测试清单），我确认后再写代码。
1. 数据：src/ui/data.ts 用 import.meta.glob（eager）读入 fixtures/cases/*.json，用 caseFileSchema 解析；同样读入 fixtures/flow_index.json，文件不存在时"演示流程"下拉显示"暂无流程"。src/ui/engine.ts 的 run(caseData, ops) 调用 evaluate(caseData, ops, DEMO_CFG_1)，返回全部检查点和最后一个检查点的 result；抛错时界面显示"计算失败："加错误首行。不做预置结果，不做参考实现桥，界面不显示数据模式。
2. 状态：src/ui/store.ts 用 zustand 保存 caseId、ops、flowId、step 和计算结果；每次只追加一个 Op 再重算；载入案例或切换流程时清空 ops。表单只能生成 UI_OP_TYPES 中的操作；流程的"下一步"可以执行流程 ops 里的 EVALUATE，此时按钮文字为"重新计算"。全程不出现 PATCH。页面上取自案例输入的内容（如 goal.budget_cap、cost_items[]、events[]）用"当前输入"：从载入的案例出发，用 src/engine/ops/index.ts 导出的 applyMutation 依次应用已执行的 ops 得到。
3. 外框与顶栏：390×844 手机框在桌面居中（data-testid 为 phone-frame）；底部标签栏四项：目标、费用、资金日历、调整，只有这四页。顶栏的内容与位置按 Q3 的团队决定，未填时按 ui.mdc 原文：案例切换（10 个案例）、演示流程下拉与"下一步"、模拟日期（result.asOf）、"模拟数据"徽标（LABEL_TEXT.SIMULATED_DATA）、输入版本（result.inputVersion）、配置版本（result.configVersion 与 result.topKLabel）。视觉风格按 Q4 的团队决定，未填时用"稳重"：白底、细线卡片、主色点缀；颜色、字号、间距写成 src/index.css 里 Tailwind v4 主题块（theme 规则）中的 CSS 变量，组件只用这些变量；状态不只靠颜色，同时有图标或文字。底部声明按 Q5 的团队决定，未填时不加。URL 带 ?shot=1 时关闭所有动画。
4. 文案：中文名集中放在 src/ui/text.ts。result.states.planState、result.states.optimizationState、result.states.confirmationState 的中文名取 docs/rules.md §11.1—§11.3 的原文；§11.4 的固定文案一律用 src/engine/result.ts 的 LABEL_TEXT；原因代码（result.inputIssues[].code、result.candidates[].excludedReasons[].code、result.candidates[].pendingReasons[].code）的中文名按 Q7 的团队决定，未填时取 rules.md 中该代码所在条款的原词。页面上不得出现 src/engine/enums.ts 中任何枚举代码的原文。拿不准的地方写注释 // SPEC-GAP 待登记：加一句话说明，并在汇报中列出；编号由"合并 ui"一步统一登记（ui 分支不能改 docs/_work/spec_gaps.md）。
5. 目标页：自然语言区先放占位，写"自然语言辅助将在后续接入，当前数据来自案例输入"。显示消费预算上限（当前输入的 goal.budget_cap）、当前现金（result.snapshot.cash）、生活预留与其他保护性预留（result.snapshot.livingReserve、result.snapshot.otherProtectedReserve、result.snapshot.otherGoalHold）、机动预留（result.snapshot.contingencyReserve）、本目标分配（result.snapshot.goalAllocation）、本目标可用金额 G（result.snapshot.goalAvailable）、付款空间 H（result.snapshot.paymentHeadroom）；关键确认记录 result.userConfirmations[]，status 为 NEEDS_RECONFIRM 的显示 LABEL_TEXT.NEED_RECONFIRM；result.inputIssues 非空时列出原因。result.snapshot 为 null 时，这一块显示计划状态的中文名并列出原因。
6. 费用页，按政策卡第四节分开显示：预计消费净支出 result.cost.netSpend（为 null 时写"有待填项目，暂不给出"，并列出 result.cost.pendingCostItemIds）；有 result.cost.netSpendIfReceived 时在它旁边标 LABEL_TEXT.IF_RECEIVED；已支付 result.cost.paidTotal 及明细 result.cost.paidPayments[]；后续尚需付款 result.cost.futurePayable 及明细 result.cost.futurePayments[]（逐笔日期和金额，不用净支出代替）；可计入的返还 result.cost.eligibleReturn；可能退回 result.cost.possibleRefund（金额与条件，注明不入账）；保护性预留 result.cost.protectedReserves；机动预留 result.cost.contingencyReserve 单列，注明不计入预计消费净支出；超出预算 result.cost.budgetOverrun。费用项目清单取当前输入的 cost_items[]，按 amount_status 分色并写字（CONFIRMED 已确认、ESTIMATE 估算、PENDING 待填、CONFIRMED_FREE 确认免费、NOT_APPLICABLE 不适用）；所选或已确认候选的价格项显示 candidates[].items[].price_basis 的类型标签；result.labels 含 PRE_RANGE_PAID、FORECAST_DISCLAIMER、HISTORY_INSUFFICIENT 时显示对应的 LABEL_TEXT。依赖条件 result.dependencies[] 列在结论旁。
7. 金额：页面只显示，不做任何加减乘除和大小比较；每个金额都用 src/engine/money/format.ts 的 formatCents 显示该 Money 的 value，旁边可点开 basis（eventIds、reserveIds、rules）。每个金额元素加 data-money 属性，值为它在 ResultCore 中的路径（如 cost.netSpend、nodes.3.cash），供 A7-3 自动核对。日期只截取原文前 10 位显示。
8. 冒烟测试 tests/e2e/smoke.spec.ts：10 个案例逐个载入，目标页、费用页都能打开；无控制台错误；页面文本不含 NaN、undefined 和 enums.ts 的任何枚举代码；每页都有"模拟数据"；scripts/lib/banned.ts 的 findBannedNames 对页面文本返回空。运行前先执行 $env:E2E_PORT='5174'，再运行 pnpm test:e2e。
9. pnpm check、pnpm test:e2e 都通过后提交到 ui 分支，提交信息 "A5-1: 界面框架、目标页、费用页（D70、§11）"，只 git add 本步允许的路径。不合并到 main。结束前写 .cache/handoff/A5-1.md（不超过 300 字：已完成、失败摘要、下一步）。
汇报不超过 200 字，只写：做了什么、测试结果、SPEC-GAP 待登记项、问题。
```

人工操作：确认 Plan Mode 给出的计划后切回 Agent。13:30 用工作树的 `pnpm dev --port 5174` 打开页面看一眼。

卡住时怎么办：

- import.meta.glob 读不到 fixtures/：确认写的是从项目根开始的路径（以 /fixtures/ 开头），不要把案例复制进 src/ui。
- `pnpm check` 在工作树里报 precheck 相关错误：说明 A5-prep 第一部分还没进来，在工作树运行 `git merge main` 后重试。
- 引擎在浏览器里打包失败或页面卡死：停下，改做第十二节 A5b 的应急方案。

## 八、A5-2 资金日历页与调整页【改】

- 要点：工作树｜Grok 4.7｜约 3 小时｜前置：A5-1 已提交；A5-prep 第二部分已提交｜产出文件：src/ui/、tests/e2e/smoke.spec.ts、.cache/handoff/A5-2.md｜验收：`pnpm check`；`pnpm test:e2e`

提示词：

```text
@AGENTS.md @.cursor/rules/ui.mdc @.cache/handoff/A5-1.md @fixtures/flow_index.json @src/engine/result.ts @src/engine/enums.ts @src/engine/ops/schema.ts @src/engine/schema.ts
目标：补齐资金日历页和调整页，并接上演示流程。路径限制与 A5-1 相同：只改 src/ui/**、src/App.tsx、src/main.tsx、src/*.css、tests/e2e/**；不打开 oracle/；不读 .env；界面不出现 PATCH（D58）。A5-1 已完成的框架、目标页、费用页不要重做。规则只看 docs/rules.md 的 D29、D34、D46、D53、D62、§11、§12.7 第（22）（30）（31）条。
0. 先运行 git merge main，带入 fixtures/flow_index.json、fixtures/flows/ 和 A5-prep 的脚本；不应有冲突，有冲突就停下汇报。
1. 演示流程：顶栏下拉列出 fixtures/flow_index.json 的 flows（显示 title），选中后载入其 case 并清空 ops；"下一步"按 ops 顺序每次追加一个；显示"第 k 步／共 n 步"和该步 steps[].rows 对应的对照表行号。
2. 资金日历页（D53：不做独立的购买日历组件，不新增页面）：
   - 用 echarts-for-react 画时间轴：横轴为 result.nodes[].at，折线为 result.nodes[].cash 与 result.nodes[].protectedTotal；节点按 result.nodes[].nodeVerdict 用不同标记，并配文字；标出购买日（result.actionList[].purchaseDate）和付款日（result.actionList[].paymentAt、result.cost.futurePayments[].at）。?shot=1 时关闭动画。
   - 最早缺口卡片：日期 result.earliestGap.at、类型（nodeVerdict 的中文名）、金额 result.earliestGap.amount（即该节点的 -U，D34）、相关项目 result.earliestGap.related，以及计算依据两项：result.earliestGap.nodeIndex 所指节点的 result.nodes[].protectedOverCash 与 result.nodes[].allocationUnsupported。可展开 result.gapList[]，其中 GAP_CONTINUED、CONFLICT_CONTINUED 显示"缺口延续""冲突延续"。
   - 约束问题单独列出，不叫付款缺口：result.constraintIssues.budgetOverrun、result.constraintIssues.allocationConflicts[]。
   - 行动清单 result.actionList[]：买什么（spec、category）、何时买（purchaseDate）、渠道（channel）、优惠（offerIds）、付款金额与时间（amount、paymentAt）、待核实条件（pendingChecks）、任务状态（taskState）。
   - 每日参考卡片：result.dailyReference.display 为 AMOUNT 时用 formatCents 显示 result.dailyReference.amount.value；为 NEED_CONFIRMED_PLAN、UNAVAILABLE、NOT_RECOMMENDED 时显示同名代码的 LABEL_TEXT；result.dailyReference.label 存在时显示它的 LABEL_TEXT；result.dailyReference.missingReasons 含 LIVING_ARRANGEMENT_MISSING 时显示 LABEL_TEXT.LIVING_ARRANGEMENT_MISSING，不显示金额；卡片下方始终显示 LABEL_TEXT.DAILY_DISCLAIMER。
   - result.labels 同时含 DRAFT_PREVIEW 与 PREVIEW_UNCONFIRMED 时，两句分开同时显示（D62；ui.mdc 第 9 行写成一句，以 rules.md 为准）。含 PROTECTED_SQUEEZE 时显示 LABEL_TEXT.PROTECTED_SQUEEZE，其中 X 取 result.nodes[] 中最早一个 nodeVerdict 为 PROTECTED_SHORTFALL、且 trigger.kind 为 OUTFLOW 或 OUTFLOW_GROUP 的节点的 amount（§12.7 第（30）条），只选取，不运算。
   - 消费情景与预测：result.scenarios[] 逐项显示 kind、available、unavailableReason、completeDays、dailyReference；result.forecasts[] 显示 status、sampleCount、amount，有 amount 时显示 LABEL_TEXT.FORECAST_DISCLAIMER。
   - 页面顶部是结论卡：result.states.planState 的中文名；为 FEASIBLE_UNDER_ASSUMPTIONS 时旁边列出 result.dependencies[]。
3. 调整页：
   - 操作表单只含 UI_OP_TYPES，每次提交只生成一个 Op：DELAY_INCOME（只列当前输入 events[] 中 event_kind 为 INCOME 且 event_status 为 EXPECTED 的事件，填新日期）、ADD_LIVING_EXPENSE、CHANGE_PAYMENT_DATE（只列当前输入中存在的 window_id）、SET_ALLOCATION、ADD_TODAY_SPEND、PAUSE、CANCEL、SELECT_CANDIDATE、CONFIRM（plan_version 取 result.candidates[].planVersion，input_version 取 result.inputVersion）、CONFIRM_FORECASTS（只列 result.forecasts[] 中 status 为 AVAILABLE 的条目，没有时显示"当前没有可确认的预测"）。金额输入框按元填写，用字符串解析成整数分，不用浮点；格式不对时不提交并提示。
   - Top-K：按 result.candidates[].rank 排列有名次的候选（只排序，不计算），显示 rank、netSpend、netSpendIfReceived（旁标 LABEL_TEXT.IF_RECEIVED）；tieGroup 不为 null 时标 LABEL_TEXT.SAME_PRICE；其余候选列出排除原因 excludedReasons 和待确认原因 pendingReasons；计数取 result.optimization 的 evaluatedCount、pendingCount、excludedCount、topK、scope；显示 result.topKLabel。优化状态为 COMPLETED_FEASIBLE 时显示 rules.md §11.2 表中的"在本次已知候选范围内，按所列假设计算的预计消费净支出最低。"
   - 确认面板（result.confirmation 不为 null 时）：result.confirmation.deltaA 的界面名称为"建议分配额（不减少今日可额外支出）"（D46）；另列 w、m、plannedAllocation；result.confirmation.unallocatedNote 不为 null 时显示 LABEL_TEXT.PAID_BY_UNALLOCATED_LATER 和该金额。result.confirmation 为 null 而确认状态为 DRAFT 时，按 §11.3 显示问题和风险，不显示分配差额（§12.7 第（22）条）。
   - 暂停与取消面板：result.states.planState 为 PAUSED 或 CANCELLED 时，显示 result.states.underlyingPlanState、已付 result.cost.paidPayments[]、可能退回 result.cost.possibleRefund（注明不入账）、仍有效的后续付款 result.cost.futurePayments[]；不出现"取消＝0元""取消最省钱"之类的说法（T012-01）。
4. 扩充 tests/e2e/smoke.spec.ts：每个案例的四页都能打开；fixtures/flow_index.json 的每个流程用"下一步"走到底，每一步四页都无控制台错误、无 NaN、无枚举代码原文、都有"模拟数据"；资金日历页没有名为"购买日历"的组件或标题（T017-09 的界面部分）。
5. pnpm check、pnpm test:e2e（先 $env:E2E_PORT='5174'）通过后提交 "A5-2: 资金日历页、调整页、演示流程（D29、D46、D53、D62）"，只 git add 允许的路径。不合并。结束前写 .cache/handoff/A5-2.md。
汇报不超过 200 字，只写：做了什么、测试结果、SPEC-GAP 待登记项、问题。
```

卡住时怎么办：

- ECharts 在 e2e 里报画布尺寸错误：给图表容器固定高度，?shot=1 时关闭动画后再断言。
- CONFIRM 后结果没变：检查 plan_version、input_version 是否取自当前结果，而不是写死的 C02@v1、v1。
- 20:00 还没通过：按第三节保底砍"尽量有"第 1—5 项，A5-3 只修阻断问题。

## 九、A5-3 冒烟测试与自查【改】

- 要点：工作树｜Grok 4.7｜约 2 小时｜前置：A5-2 已提交｜产出文件：tests/e2e/smoke.spec.ts、src/ui/、.cache/ui_review/（自查截图，不提交）、.cache/handoff/A5-3.md｜验收：`pnpm check`；`pnpm test:e2e`

提示词：

```text
@AGENTS.md @.cursor/rules/ui.mdc @.cache/handoff/A5-2.md @fixtures/flow_index.json @docs/_work/test_layers.md（只看 layer 为 UI 的 21 行）
目标：在 ui 工作树里把四页修到可演示、可截图，再交给合并。路径限制同 A5-1；不打开 oracle/；不读 .env。A5-1、A5-2 已完成的功能不要重做，只修问题。
1. 用内置浏览器逐个案例、逐页查看：先运行 pnpm dev --port 5174，再打开 http://localhost:5174/?shot=1。修掉溢出、截断、重叠、空白卡片和英文占位。
2. 对照 test_layers.md 中 UI 层的 21 行，逐行确认页面上有对应显示，例如：T013-01 四页的金额和状态都来自同一输入版本；T017-04、T017-12 的界面名称"建议分配额（不减少今日可额外支出）"；T009-02 报价标"估算"。缺的补上；做不到的写 // SPEC-GAP 待登记：加一句话说明，并在汇报中列出。这一步不写 A7 的正式 e2e，只在 tests/e2e/smoke.spec.ts 补冒烟断言。
3. 每个流程的每个 screenshots[] 在 .cache/ui_review/ 下各拍一张，文件名为 flow_id、k 加步数、页面名用下划线连接（如 01_cB_topk_main_k3_资金日历.png），视口 390×844，只截 phone-frame。这些截图供视觉评审，不提交。
4. 自查：git grep -n "PATCH" -- src/ui 无结果；src/ui 中没有对金额做加减乘除（金额只经 formatCents 显示）；git diff main --stat 只含允许的路径。
5. pnpm check、pnpm test:e2e 通过后提交 "A5-3: 冒烟测试与界面修正（test_layers UI 层）"。写 .cache/handoff/A5-3.md，列出 UI 层 21 行各自的完成情况。
汇报不超过 200 字，只写：做了什么、测试结果、SPEC-GAP 待登记项、问题。
```

卡住时怎么办：

- 端口 5174 也被占用：改用 `$env:E2E_PORT='5175'`，dev 也换到同一端口。
- 某一行 UI 层要求在当前结果里没有数据来源：不要编造，写 SPEC-GAP 待登记，合并时由主窗口登记为"待团队裁决"。

## 十、A5-review 与 A5-fix 视觉评审一轮【改】

- 要点：工作树｜A5-review 用 Claude Opus 5.5，A5-fix 用 Grok 4.7｜约 1.5 小时｜前置：A5-3 已提交；.cache/ui_review/ 有截图｜产出文件：.cache/ui_review/review.md、src/ui/｜验收：`pnpm check`；`pnpm test:e2e`

属于"尽量有"第 5 项，20:00 检查点决定砍掉时整节跳过。

A5-review 提示词（Opus，新对话，把 .cache/ui_review/ 中的截图拖进对话）：

```text
@.cursor/rules/ui.mdc @docs/policy_card.md（只看第 188—203 行"界面必须分开显示的金额"）
目标：评审四页界面截图，找出最影响观感和易用性的问题，供 A5-fix 修改。你是移动金融产品的界面评审。依据 ui.mdc、上面这段政策卡和我附上的截图（来自 .cache/ui_review/）。只写 .cache/ui_review/review.md，不改代码、不提交，不打开 oracle/。
每条写：页面｜看到的问题｜为什么影响用户或评委｜改法（具体到组件、间距、字号、颜色变量或文案）｜优先级（P1 必改、P2 应改、P3 可选）。最多 20 条，按优先级排序。另单列两项：页面上出现的枚举代码、英文或未格式化的金额；可能让评委误以为"已接入银行系统"或"资金已经充足"的画面。改法涉及新增文案的，标"需团队确认"，不要自己定稿。
汇报不超过 200 字：P1、P2 各几条，最严重的三条。
```

A5-fix 提示词（Grok，新对话）：

```text
@AGENTS.md @.cursor/rules/ui.mdc @.cache/ui_review/review.md @.cache/handoff/A5-3.md
目标：在 ui 工作树里修掉 review.md 中的 P1，时间允许再修 P2。路径限制同 A5-1（只改 src/ui/**、src/App.tsx、src/main.tsx、src/*.css、tests/e2e/**）；不打开 oracle/；不读 .env；界面不出现 PATCH（D58）。标"需团队确认"的条目不改，列入汇报。每修一条，在 review.md 该条末尾写"已修"。完成后重拍 .cache/ui_review/ 中受影响的截图；pnpm check、pnpm test:e2e（先 $env:E2E_PORT='5174'）通过后提交 "A5-fix: 视觉评审 P1"，只 git add 允许的路径。
汇报不超过 200 字，只写：修了哪些、测试结果、未修及原因。
```

卡住时怎么办：

- Opus 给的改法要新增文案：一律标"需团队确认"，留到 H-SG6，不在 A5-fix 里定稿。
- 24:00 还没修完 P1：停下，剩下的 P1 带到合并后在 main 上修。

## 十一、合并 ui【改】

- 要点：主窗口｜Grok 4.7｜约 1 小时｜前置：A5-3（或 A5-fix）已提交；主窗口没有未提交改动｜产出文件：docs/_work/spec_gaps.md、tests/unit/ui-text.test.ts、src/ui/｜验收：`pnpm check`；`pnpm test:e2e`；`pnpm golden:check`

提示词：

```text
@AGENTS.md @.cursor/rules/ui.mdc @docs/_work/spec_gaps.md @src/ui
目标：把 ui 分支并入 main，登记界面的 SPEC-GAP，并补上 ui 分支不能写的单元测试。在主仓库 main 上做；不改 src/engine/、tests/golden/、fixtures/；不打开 oracle/；不读 .env。
1. 运行 git merge --no-ff ui，应无冲突；有冲突就停下汇报，不要自行取舍。
2. 合并之后另做一个提交：用 git grep -n "SPEC-GAP 待登记" -- src/ui 找出全部待登记项，在 docs/_work/spec_gaps.md 逐条登记，编号从现有最大编号加 1 起；会改变评委看到的画面或话术的写"待团队裁决"并附 A/B 选项和推荐，其余写"AI暂定（保守）"；再把代码注释改为 // SPEC-GAP SG-加编号。
3. 新建 tests/unit/ui-text.test.ts（测试名以 ui-text 开头）：src/ui/text.ts 中计划状态、优化状态、确认状态的中文名与 docs/rules.md §11.1—§11.3 的原文一致；src/ui 中的 §11.4 固定文案都来自 LABEL_TEXT；src/ui 下没有 PATCH 字样；src/ui 没有调用 Date.now()、无参 new Date() 或 Math.random()。
4. 用内置浏览器逐个案例、逐页检查一遍（pnpm dev 后打开 http://localhost:5173/?shot=1），确认合并后与 ui 工作树表现一致。
5. pnpm check、pnpm test:e2e、pnpm golden:check 通过后提交 "merge ui: 四页界面（SPEC-GAP 登记）"，只 git add docs/_work/spec_gaps.md tests/unit/ui-text.test.ts src/ui，然后 git push。
汇报不超过 200 字，只写：做了什么、测试结果、新增的 SPEC-GAP、问题。
```

人工操作：合并并检查无误后，按第四节删除 ui 工作树。

卡住时怎么办：

- 合并后 `pnpm test:e2e` 失败而工作树里是通过的：多半是端口或残留的 dev 服务，先关掉所有 `pnpm dev` 再跑。
- 合并冲突：说明有人在 main 上改了 src/ui，停下，人工决定保留哪边。

## 十二、A5b oracle 桥【改】

- 要点：主窗口加工作树｜Grok 4.7｜约 1 小时｜前置：只有 A5-1 发现引擎无法在浏览器中运行（打包报错或页面卡死）时才做｜产出文件：vite.config.ts、src/ui/engine.ts｜验收：`pnpm check`；`pnpm test:e2e`

本版不做参考实现桥。理由：TS 引擎已完成并锁定，对拍 0 差异；引擎没有 Node 依赖，可以直接在浏览器运行（第一节第 2、4、12 条）；参考实现桥需要演示时有 Python，还要在画面上标"参考实现"。只有浏览器跑不动引擎时，才改由开发服务器在 Node 端调用同一个 TS 引擎，分两段做。

第一段（主窗口，main）：

```text
@AGENTS.md @vite.config.ts @src/engine/evaluate.ts @src/engine/ops/schema.ts
目标：引擎无法在浏览器里运行，改由开发服务器在 Node 端调用同一个 TS 引擎；本段只加服务端接口。在主仓库 main 上做（vite.config.ts 不在 ui 分支允许的路径内）；只改 vite.config.ts；不调用参考实现，不打开 oracle/；不读 .env；不改 src/engine/、src/ui/。
1. vite.config.ts 增加插件，用 configureServer 和 configurePreviewServer 挂载 POST /api/evaluate：读取请求中的 caseId 与 ops，从 fixtures/cases/ 读对应案例，用 opsSchema 校验 ops（拒绝 PATCH），调用 evaluate(caseData, ops, DEMO_CFG_1)，返回检查点 JSON（ResultCore 原样，不经 toWire）；出错时返回 500 和错误首行。
2. pnpm check 通过后提交 "A5b: 开发服务器端 TS 引擎桥（应急）"，只 git add vite.config.ts。
汇报不超过 200 字，只写：做了什么、测试结果、问题。
```

第二段（工作树，分支 ui，新对话）：

```text
@AGENTS.md @src/ui/engine.ts
目标：让界面改用开发服务器上的 /api/evaluate 计算。在 ui 工作树里做，只改 src/ui/**；不打开 oracle/；不读 .env；界面不出现 PATCH（D58）。
1. 先运行 git merge main，带入第一段的 vite.config.ts。
2. src/ui/engine.ts 的 run 改为请求 POST /api/evaluate（请求体为 caseId 与 ops），接口不可用时显示"计算服务未启动"。界面不加"参考实现"角标（仍是同一个引擎）。
3. pnpm check、pnpm test:e2e（先 $env:E2E_PORT='5174'）通过后提交 "A5b: 界面改用服务端计算"，只 git add src/ui。
汇报不超过 200 字，只写：做了什么、测试结果、问题。
```

卡住时怎么办：

- 浏览器报错只是某个依赖的打包问题：先让 Grok 定位是哪个 import，能在 src/ui 一侧绕开就不做 A5b。

## 十三、A6-prep Poe 密钥与 .env【新】

- 要点：你｜不用模型｜约 15 分钟｜前置：无｜产出文件：.env（不提交）｜新建标识：POE_API_KEY、POE_MODEL｜验收：`Test-Path .env` 输出 True；`git check-ignore -v .env` 有输出

提示词：无（人工步骤，不要把密钥发给代理）。

人工操作：

1. 在 poe.com/api_key 生成密钥，在 Poe 上确认要用的模型名。
2. 在仓库根目录用记事本建 .env，写两行：POE_API_KEY 和 POE_MODEL（等号后填你的值）。

```powershell
cd D:\programs\project\quyoudu
notepad .env
Test-Path .env
git check-ignore -v .env
```

卡住时怎么办：

- 拿不到密钥：A6-1 照做（单元测试用固定样例，不联网），录制那一步会以退出码 2 跳过；10/17 12:00 仍没有，按第三节保底只演示 off 模式。

## 十四、A6-1 自然语言核心与录制【改】

- 要点：主窗口｜Grok 4.7（开头 Plan Mode）｜约 4 小时｜前置：A7-1 已提交（主窗口空出）；录制那一步需要 A6-prep｜产出文件：src/nl/、vite.config.ts、scripts/nl-record.ts、fixtures/llm-replay/cB_topk/、fixtures/llm-replay/usage.json、tests/unit/nl.test.ts、package.json｜新建脚本：nl:record｜验收：`pnpm check`；`pnpm vec --all`

提示词：

```text
@AGENTS.md @src/engine/schema.ts @src/engine/enums.ts @src/engine/money.ts @src/engine/result.ts @fixtures/cases/cB_topk.json @docs/_work/book_notes.md @docs/_work/test_layers.md（只看 layer 为 NL 的 6 行）@docs/_work/plan_a5_a7.md（只看第二十四节 Q1 的"团队决定"）
目标：实现 src/nl（自然语言辅助）的核心：提取、追问、草稿、解释、调用层和三种模式，并录制回放。在主仓库 main 上做；不改 src/engine/、src/ui/（目标页接入留给 A6-2）；不打开 oracle/。人工已在仓库根目录建好 .env（POE_API_KEY、POE_MODEL）；不要读取、打印或提交 .env 的值，也不要新建或修改 .env。规则只看 docs/rules.md 的 R015、D30、D32、D52、D60，不通读全文。
先给出计划（模块划分、服务端与浏览器的边界、测试清单），我确认后再写代码。
1. extract(text)：只输出 D30 的 13 个字段，字段名用 src/engine/enums.ts 中 CONFIRMATION_FIELDS 的前 13 项（ACTIVITY 到 LIVING_COST）；zod 校验；每个字段带 source_span；原文没提到的为 null，不猜；所有值都是"待确认值"，用户确认前不进入 evaluate 的输入。
2. nextQuestions(state)：按 D30 字段顺序，只问影响当前步骤且仍为 null 的字段，每轮最多 2 问，最多 3 轮，之后改为表单补填（D52）；已确认的字段不再问。
3. draft(state)：由已提取的字段生成需求草稿、费用清单草稿和关键待办（T015-08）；费用清单只列 src/engine/enums.ts 中 ITEM_CATEGORIES 的类别和"已提供／待填"，不出现任何金额。
4. explain(result)：模板化中文解释，数字全部从 result 插值。生成后逐句检查：金额解析为整数分后须等于 src/engine/money.ts 的 moneyPaths() 所列路径上某个 Money 的 value；日期统一为 YYYY-MM-DD 后须出现在结果中；百分比和计数不参与匹配；对不上的句子删掉，改用模板句（D32、D52）。
5. 调用层：用 package.json 里已有的 openai SDK，baseURL 为 https://api.poe.com/v1，模型名取 POE_MODEL。密钥只在服务端读取：在 vite.config.ts 增加插件，用 configureServer 和 configurePreviewServer 挂载 /api/nl 中间件，用 vite 的 loadEnv 读 .env，前端拿不到密钥；缺少 POE_API_KEY 时 /api/nl 返回 503"实时模式不可用"，replay 与 off 不受影响；不新增依赖。优先用 JSON Schema 结构化输出，不支持时退回普通对话加 zod 校验。
6. 三种模式：replay（默认，读 fixtures/llm-replay/cB_topk/）、live、off（纯表单，证明去掉 AI 后核心计算仍能完成）。src/nl 导出当前模式，供 A6-2 在顶栏显示。
7. 用户确认后的值怎样进入计算，按 Q1 的团队决定；未填时按 A：对话提取值只作显示与核对，计算始终使用案例输入（含 confirmations[]），不新增 Op，不使用 PATCH（D58）。
8. 新建 scripts/nl-record.ts，package.json 增加脚本 nl:record。它用 cB_topk 的 nl_script.utterances 在 live 模式完整跑 3 次"提取→追问→草稿→解释"，取第一次存为 fixtures/llm-replay/cB_topk/ 下的回放文件；三次的调用次数与输入、输出 token 写入 fixtures/llm-replay/usage.json（每次一条，另加平均值，注明模型名、日期、话术版本，口径见 book_notes.md）。日期取接口返回的 created 字段换算成 UTC+8 的 YYYY-MM-DD，不读本机时钟。.env 不存在或缺少密钥时打印"缺少 .env，跳过录制"并以退出码 2 结束，不要伪造回放。live 只通过这个脚本运行这 3 次。
9. tests/unit/nl.test.ts，测试名以测试编号开头，用 tests/unit/ 下的固定样例模拟大模型返回（不联网）：T015-01、T015-02、T015-08、T015-09 的 NL 部分；T013-04 的 NL 部分（AI 回复中的"住宿大约300元"不进入计算，也不出现在解释中）；T013-06 的 NL 部分（重算时不调用大模型重新生成数据）；off 模式完整走通；未确认的 LLM 值不会进入 evaluate 的输入。fixtures/llm-replay/cB_topk/ 存在时，另加一条测试校验回放文件结构，并用它重跑 T015-01、T015-02。
10. 先不录制：pnpm check、pnpm vec --all 通过后提交 "A6-1: 自然语言提取、追问、解释（R015、D30、D32、D52）"，只 git add src/nl vite.config.ts scripts/nl-record.ts tests/unit package.json。然后运行一次 pnpm nl:record：成功就检查回放文件和 usage.json，再跑 pnpm check，提交 "A6-1: 回放录制（cB_topk，3 次）"，只 git add fixtures/llm-replay；退出码为 2 时在汇报中说明。
汇报不超过 200 字，只写：做了什么、测试结果、新增的 SPEC-GAP、问题。
```

卡住时怎么办：

- Poe 不支持 JSON Schema 结构化输出：按第 5 条退回普通对话加 zod 校验，不换 SDK。
- 录制时某次调用失败：整次重跑，不拼接；3 次都要完整，否则 usage.json 不写平均值。
- 测试里出现真实网络请求：说明调用层没有注入，改成可替换的客户端后再测。

## 十五、A6-2 目标页接入自然语言【改】

- 要点：主窗口｜Grok 4.7｜约 2 小时｜前置：合并 ui、A6-1 已提交｜产出文件：src/ui/、src/nl/、tests/e2e/nl.spec.ts｜验收：`pnpm check`；`pnpm test:e2e`

提示词：

```text
@AGENTS.md @.cursor/rules/ui.mdc @src/nl @src/ui @fixtures/cases/cB_topk.json @docs/_work/plan_a5_a7.md（只看第二十四节 Q1 的"团队决定"）
目标：把 src/nl 接到目标页，完成"自然语言→提取→追问→确认"这段演示。在 main 上做；不改 src/engine/；src/nl 只在需要时补导出，不改已测过的行为；不改 vite.config.ts 读取密钥的方式；不打开 oracle/；不读 .env；界面不使用 PATCH（D58）。
1. 目标页的自然语言区：replay 模式下按 cB_topk 的 nl_script.utterances 逐句回放（"下一句"按钮），显示 extract 的已提取字段（每个字段标"待确认"，并高亮 source_span 原文）、nextQuestions 的追问（每轮最多 2 问），3 轮后转为表单补填，并显示 draft 的需求草稿、费用清单草稿和关键待办。off 模式只显示表单。顶栏显示当前模式（回放、实时、关闭）。
2. 确认按 Q1 的团队决定；未填时按 A：用户点"确认"只改变界面上的确认标记，不进入 evaluate 的输入；目标页注明"计算使用案例输入；对话提取值只用于核对"。提取值与当前输入不一致的字段标"与案例数据不一致"，不自动改任何数字。
3. 解释：资金日历页结论卡下方显示 explain(result) 的句子；被检查删掉的句子不显示。
4. tests/e2e/nl.spec.ts，测试名以 T015-01、T015-02、T015-09、T013-04 开头：replay 模式下已给出的字段不再追问；每轮最多 2 问；解释中不出现"300"；off 模式能走完 01_cB_topk_main 流程。
5. pnpm check、pnpm test:e2e 通过后提交 "A6-2: 目标页接入自然语言（R015、D30、D52）"，只 git add src/ui src/nl tests/e2e。
汇报不超过 200 字，只写：做了什么、测试结果、新增的 SPEC-GAP、问题。
```

卡住时怎么办：

- 没有回放文件（录制被跳过）：目标页默认切到 off 模式，replay 的 e2e 用例先不写，汇报里说明；不要用固定样例冒充回放。
- 目标页布局被挤乱：自然语言区折叠成一张卡片，点开再展开。

## 十六、A7-1 结果导出（export:results）【改】

- 要点：主窗口｜Grok 4.7｜约 1.5 小时｜前置：A5-prep 已提交（流程结果已人工锁定更好）｜产出文件：scripts/export-results.ts、tests/unit/export-results.test.ts、book/data/cases/、book/data/flows/、book/data/index.json、package.json｜改写脚本：export:results｜验收：`pnpm check`；`pnpm export:results`（运行两次，第二次后 `git status` 无变化）

提示词：

```text
@AGENTS.md @scripts/golden-write.ts @src/engine/evaluate.ts @src/engine/modules.ts @src/engine/wire.ts @src/engine/config.ts @fixtures/flow_index.json @fixtures/flows
目标：实现 export:results，把各案例和各演示流程的计算结果导出给项目书（book/data），供队友写第 4—6 章。在 main 上做；不改 src/、tests/golden/、fixtures/；不打开 oracle/；不读 .env。
1. 新建 scripts/export-results.ts，package.json 的 export:results 改为 tsx scripts/export-results.ts。
2. 只用 TS 引擎 evaluate（config 为 DEMO_CFG_1）。doneModules 缺少 M1—M7 中任一项时以退出码 1 结束并说明原因，不改用参考实现。
3. 输出全部用 scripts/golden-write.ts 的 canonicalWire 序列化（toWire、键排序、2 空格、LF）：
   - book/data/cases/ 下每个案例一个文件，内容为 meta 和 checkpoints，案例的 ops 为空；
   - book/data/flows/ 下每个流程一个文件，内容为 meta 和 checkpoints，按 fixtures/flows/ 中该流程的 ops 计算（与 tests/golden/flows 的检查点一致）；
   - book/data/index.json：每个导出文件一条摘要（案例编号或 flow_id、标题、各检查点的 label、input_version、三个状态、labels），不放金额。
   meta 含 engine（固定为 ts）、commit 与 commit_time（取最后一次改动代码和数据的提交：git log -1 --format=%h -- src scripts tests fixtures，时间用同一命令的 %cI；不用 HEAD，否则提交导出结果后重跑就会变；不调用 Date.now() 或无参 new Date()）、config_version（DEMO_CFG_1.configVersion）、done_modules、simulated（true）、notice（"模拟数据"）、generated_by（"pnpm export:results"）。
4. 先清空 book/data/cases 与 book/data/flows 再写，保证重跑结果完全相同；不动 book/data/ 下的其他文件（如 status.json）。
5. tests/unit/export-results.test.ts（测试名以 export-results 开头）：导出的 checkpoints 与对同一输入运行 evaluate 再 canonicalWire 的结果一致；tests/golden/flows 存在时，checkpoints 与其中对应文件逐项相同；meta 字段齐全；脚本源码里没有 Date.now( 和无参 new Date(。
6. 分两次提交：pnpm check 通过后先提交代码 "A7-1: export:results（TS 引擎）"，只 git add scripts/export-results.ts tests/unit/export-results.test.ts package.json；再运行 pnpm export:results 两次，第二次后 git status 无新变化，提交 "A7-1: book/data 第一版"，只 git add book/data/cases book/data/flows book/data/index.json，然后 git push。
汇报不超过 200 字，只写：做了什么、测试结果、新增的 SPEC-GAP、问题。
```

人工操作：推送后通知队友 `git pull --rebase`，告诉他们 book/data/index.json 是目录，数字以各文件为准。

卡住时怎么办：

- 与 tests/golden/flows 对不上：先确认人工锁定是在 A5-prep 第二部分之后做的；不一致时停下，不要改导出去迎合。
- book/data 文件太大（cB_v5_cancel 等）：照样提交，不删字段；项目书只引用需要的路径。

## 十七、A7-2 测试报告与追溯（test:report、trace:update）【改】

- 要点：主窗口｜Grok 4.7｜约 3 小时｜前置：A7-1 已提交｜产出文件：scripts/test-report.ts、scripts/trace-update.ts、tests/unit/test-report.test.ts、tests/unit/trace-update.test.ts、book/chapters/91_appendix_test_report.md、book/data/status.json、docs/traceability.csv、docs/_work/spec_gaps.md、package.json｜改写脚本：test:report、trace:update｜验收：`pnpm check`；`pnpm test:report`；`pnpm trace:update`；`git diff --stat docs/traceability.csv`

提示词：

```text
@AGENTS.md @scripts/vec.ts @scripts/spec-lint.ts @docs/_work/test_layers.md @docs/_work/vector_gaps.md @docs/_work/precheck_report.md @docs/_work/diff_report.md @tests/vector-disputes.json @package.json
目标：实现 test:report 和 trace:update，生成测试报告附录和 book/data/status.json，并按测试结果更新 traceability.csv 的"状态"列。在 main 上做；不改 src/、tests/golden/、fixtures/；不打开 oracle/；不读 .env；不运行 diff:oracle（对拍结果只读 docs/_work/diff_report.md）。docs/traceability.csv 只读表头和"规则编号""拟建测试""状态"三列，不通读。
1. scripts/test-report.ts，package.json 的 test:report 改为 tsx scripts/test-report.ts：
   - 收集：vitest（pnpm exec vitest run --reporter=json --outputFile=.cache/report/vitest.json，含向量测试的通过与跳过数）；pnpm vec --all --json .cache/report/vec.json，以及 M1—M9 各模块 pnpm vec --module 加模块号的汇总行；Playwright 结果 .cache/report/playwright.json（不存在时记"未执行"，不报错）；golden:check 与 spec:lint 的退出码（spec:lint 另记警告条数）；A4-0 预检汇总与单元核对读 docs/_work/precheck_report.md 的"总体""单元核对"两节；对拍汇总读 docs/_work/diff_report.md 的"总体"一节；.cache/report/doc-lint.json 存在时一并汇总。
   - 测试编号：向量取 testId（T001-05#1 计入 T001-05）；vitest 与 Playwright 取测试名开头的编号（如"T001-01 gap …"）。
   - 生成 book/chapters/91_appendix_test_report.md：按规则编号列测试数、通过、失败、未执行、跳过；另附"功能实现状态表"，每条规则分"规则已确认、已实现、测试通过、真实用户验证"四级：规则已确认＝rules.md 中有该条；已实现＝该规则的子行至少有一层已执行且通过；测试通过＝该规则的全部子行状态为"通过"；真实用户验证一律写"未开展"（政策卡第九节：本阶段不做需求调研）。注明 commit 短哈希和提交时间，取最后一次改动代码和数据的提交（git log -1 --format=%h -- src scripts tests fixtures，时间用同一命令的 %cI；不用 HEAD，不调用 Date.now() 或无参 new Date()），并写明"技术测试结果，不代表需求成立或用户效果"。
   - 同时输出 book/data/status.json（上面全部计数，键名为英文 snake_case，供第 6 章引用）。重跑结果完全相同。
2. scripts/trace-update.ts，package.json 的 trace:update 改为 tsx scripts/trace-update.ts。读 .cache/report/ 下的结果（不存在时提示先运行 pnpm test:report 并以退出码 1 结束），按 test_layers.md 的分层更新 docs/traceability.csv 的"状态"列：
   - "通过（commit 短哈希，提交日期）"（哈希与日期取法同 test:report）：该子行的全部 TS 向量通过且没有登记跳过；该行的 vector_gaps 条目全部为"已裁决"，或为"已覆盖"且对应单元测试通过；该行的 UI、NL、DOC 层也已执行且通过；
   - "部分覆盖（commit 短哈希，提交日期；见 vector_gaps）"：已执行的部分全部通过，但还有 gap 未覆盖或某一层未执行；
   - "已执行未通过"：有任何失败；
   - "待执行"：什么都没执行；
   - 父行（"拟建测试"为 T 加三位数字）：子行全部"通过"才写"通过"；有"已执行未通过"就写"已执行未通过"；否则按子行写"部分覆盖"或"待执行"。这条父行规则登记为一条 SPEC-GAP（编号取 docs/_work/spec_gaps.md 现有最大编号加 1，状态"AI暂定（保守）"）。
   参考实现的通过不计入；不得手写"通过"。只改"状态"列，保持 UTF-8 无 BOM、LF 和原有引号风格，git diff 只出现"状态"列的变化。状态文本里只写小写短哈希和 YYYY-MM-DD 日期，不写 SG、D、V 编号（scripts/spec-lint.ts 会核对追溯表中出现的编号）。
3. tests/unit/test-report.test.ts、tests/unit/trace-update.test.ts（测试名以脚本名开头）：用临时目录里的小样例覆盖四种状态和父行规则；"状态"列以外的内容逐字不变。
4. 分两次提交：pnpm check 通过，且 pnpm spec:lint 的输出里没有"引用了不存在的"这类错误（"仍有待团队裁决"那一条留给 H-SG6，不在本步处理）后，先提交代码 "A7-2: test:report、trace:update"，只 git add scripts/test-report.ts scripts/trace-update.ts tests/unit/test-report.test.ts tests/unit/trace-update.test.ts package.json docs/_work/spec_gaps.md；再运行 pnpm test:report、pnpm trace:update，各运行两次，第二次后 git status 无新变化，提交 "A7-2: 测试报告与 traceability 状态（第一版）"，只 git add book/chapters/91_appendix_test_report.md book/data/status.json docs/traceability.csv，然后 git push。
汇报不超过 200 字，只写：做了什么、测试结果（四种状态各多少行）、新增的 SPEC-GAP、问题。
```

人工操作：推送后通知队友 status.json 第一版已就绪（e2e 记"未执行"），第 6 章只写占位符。

卡住时怎么办：

- traceability.csv 的 git diff 出现整文件改动：说明换行或引号被改了，让代理改成逐行替换"状态"字段，不要重新序列化整个 CSV。
- vitest 的 JSON 里找不到测试编号：只统计能解析出编号的测试，其余计入"未归类"，在报告里单列，不要猜编号。

## 十八、A7-3 端到端与截图【改】

- 要点：主窗口｜Grok 4.7｜约 3.5 小时｜前置：合并 ui、A6-2、A7-2 已提交｜产出文件：tests/e2e/、playwright.config.ts、book/figures/screens/、book/figures/screens/index.md、book/data/、book/chapters/91_appendix_test_report.md、docs/traceability.csv｜验收：`pnpm test:e2e`；`pnpm export:results`；`pnpm test:report`；`pnpm trace:update`；`pnpm check`

提示词：

```text
@AGENTS.md @tests/e2e @fixtures/flow_index.json @fixtures/cases @docs/policy_card.md（只看第 1137—1172 行对照表）@docs/_work/test_layers.md（只看 layer 为 UI 的 21 行）@playwright.config.ts @scripts/lib/banned.ts
目标：写正式的端到端测试并拍项目书截图，然后刷新导出、测试报告和追溯状态。在 main 上做；不改 src/engine/、tests/golden/、fixtures/；不打开 oracle/；不读 .env（自然语言用 replay 模式，没有回放文件时用 off 模式）；修 src/ui 时界面不出现 PATCH（D58）。
0. 先运行 pnpm flows --check、pnpm golden:check，确认流程和锁定结果都没变；不通过就停下汇报。
1. tests/e2e/flows.spec.ts：对 fixtures/flow_index.json 的每个流程生成一组测试，用"下一步"逐步操作界面，每一步检查该步 expect（计划状态、优化状态、确认状态的中文名与 §11.4 文案）和对照表"应看到的结果"中能在页面上看到的部分。页面上每个带 data-money 属性的元素，其文本须等于测试内用 src/engine/evaluate.ts 对同一输入计算、按该路径取值再经 formatCents 的结果；测试里不手写任何金额。测试名以流程编号开头，注释写对照表行号和测试编号。
2. tests/e2e/ui-layer.spec.ts：覆盖 test_layers.md 中 layer 为 UI 的 21 行，每行一个 test，测试名以该测试编号开头（如"T017-09 …"）。至少包括：主线（01_cB_topk_main，回放模式：自然语言→追问→费用→比较→确认→行动清单→收入延期→出现缺口，每日参考显示"当前不建议新增非计划支出"，确认状态仍为已确认）；案例 A（04_cA_gap_living、05_cA_gap_allocation：最早缺口、预计收入不提前填补、新增生活支出后重算、改分配额出现分配冲突）；14_c00_today_spend（记当日消费后每日参考按新版本显示）；全部变体。每页文本用 scripts/lib/banned.ts 的 findBannedNames 检查为空，并且都含"模拟数据"。
3. playwright.config.ts 的 reporter 增加 json，输出到 .cache/report/playwright.json，保留 list；其余设置不变。
4. tests/e2e/screens.spec.ts：按每个流程的 screenshots[] 拍图，存到 book/figures/screens/，文件名为 flow_id、k 加步数、页面英文名（goal、cost、calendar、adjust）用下划线连接，如 01_cB_topk_main_k3_calendar.png；视口 390×844、deviceScaleFactor 2，打开 ?shot=1 关闭动画，只截 phone-frame。生成 book/figures/screens/index.md（文件名｜画面说明｜案例｜步骤｜对照表行号），画面说明只写状态和文案，不写金额。
5. 运行 pnpm test:e2e、pnpm check。e2e 失败时先修 src/ui，不得跳过测试或改 expect；确属规格问题的登记到 docs/_work/spec_gaps.md（"待团队裁决"，附 A/B 选项和推荐），这一条断言先不写。
6. 分两次提交：先提交代码 "A7-3: e2e（流程 14 个、UI 层 21 行）"，只 git add tests/e2e playwright.config.ts src/ui docs/_work/spec_gaps.md；再依次运行 pnpm test:e2e、pnpm export:results、pnpm test:report、pnpm trace:update，提交 "A7-3: 截图与报告刷新"，只 git add book/figures/screens book/data book/chapters/91_appendix_test_report.md docs/traceability.csv，然后 git push。
汇报不超过 200 字，只写：做了什么、测试结果（e2e 通过与失败数、四种追溯状态各多少行）、新增的 SPEC-GAP、问题。
```

人工操作：推送后通知队友拉取截图第一版；对照 book/figures/screens/index.md 挑项目书要用的图。

卡住时怎么办：

- Playwright 里 import src/engine 报错：在 globalSetup 里用 tsx 子进程预先算好期望值，写到 .cache/e2e/expected.json，测试只读这个文件。
- 截图有动画残影：确认 ?shot=1 已关闭 ECharts 动画，截图前等网络空闲。
- 17:00 截图还没出来：先只拍主线 01 号流程和案例 A 的图推给队友，其余随后补。

## 十九、H-SG6 SPEC-GAP 批量裁决【新】

- 要点：主窗口｜Claude Opus 5.5｜约 1 小时（含全队讨论）｜前置：A7-3 已提交｜产出文件：.cache/hsg6/decisions.md、docs/_work/spec_gaps.md｜验收：`pnpm spec:lint`；`pnpm check:all`

提示词：

```text
@AGENTS.md @docs/_work/spec_gaps.md @scripts/spec-lint.ts
目标：把 docs/_work/spec_gaps.md 中所有"待团队裁决"的条目按团队决定落定，使 pnpm spec:lint 通过（scripts/spec-lint.ts 第 93—94 行：全文出现"待团队裁决"即失败，而 F1 的 check:all 包含 spec:lint）。只改 docs/_work/spec_gaps.md 和 .cache/hsg6/decisions.md；需要改代码、文案或规则原文的，只记录在 decisions.md 的"后续动作"列，不在本步改；不打开 oracle/。
1. 先列出全部"待团队裁决"条目，写入 .cache/hsg6/decisions.md：编号｜问题一句话｜A｜B｜推荐｜团队决定（留空）｜后续动作。写完就停下，等我回复"已填"。不要自行裁决。
2. 我回复"已填"后，逐条按 decisions.md 的"团队决定"列修改 spec_gaps.md：状态改为"已裁决（团队 H-SG6）"，临时处理列写明采用的方案；全文不再出现"待团队裁决"这几个字（包括说明文字）。"团队决定"为空的条目不改，汇报中列出。
3. pnpm spec:lint、pnpm check:all 通过后提交 "H-SG6: SPEC-GAP 批量裁决"，只 git add docs/_work/spec_gaps.md。
汇报不超过 200 字，只写：裁决了哪些、哪些需要改代码或文案（附后续动作）、测试结果。
```

人工操作：全队一起在 .cache/hsg6/decisions.md 的"团队决定"列逐条填写，然后回复"已填"。有"后续动作"要改界面文案的，交给 Grok 在第二十节演练之前修好并重拍受影响的截图。

卡住时怎么办：

- 条目太多、一小时讨论不完：先裁决会出现在截图和主线演示里的，其余按"推荐"由负责人在对话中逐条授权。
- 某条裁决要改 policy_card 或 rules.md 原文：本步只记录，改规格另开一个 Opus 对话，改完由人工运行 `pnpm oracle:export`、`pnpm oracle:import` 刷新指纹。

## 二十、数据刷新与预冻结演练【新】

- 要点：主窗口｜Grok 4.7｜约 1 小时｜前置：H-SG6 已提交；人工已跑完 diff:oracle｜产出文件：.cache/freeze_dryrun.md（不提交）｜验收：`pnpm check:all`；`pnpm vec --all`；`pnpm test:e2e`；`pnpm export:results`；`pnpm test:report`；`pnpm trace:update`

人工操作（先于提示词，只有你运行 diff:oracle）：

```powershell
cd D:\programs\project\quyoudu
pnpm diff:oracle
git diff --stat -- docs/_work/diff_report.md
```

diff_report 仍应是 0 差异；内容没变时 git 没有差异。

提示词：

```text
@AGENTS.md @package.json @docs/_work/diff_report.md
目标：在 F1 之前按冻结顺序完整演练一遍，提前发现会让 F1 停下的问题。不改任何已跟踪的文件，只写 .cache/freeze_dryrun.md，不提交；不打开 oracle/；不读 .env；不运行 diff:oracle（人工已运行）。
1. 逐条运行（不用 &&），记录每条命令的退出码和关键计数：pnpm check:all、pnpm vec --all、pnpm test:e2e、pnpm export:results、pnpm test:report、pnpm trace:update。
2. 全部运行完后看 git status：export:results、test:report、trace:update 都不应产生新的改动（重跑一致）；有改动就列出文件和原因。
3. 写 .cache/freeze_dryrun.md：命令｜退出码｜关键计数｜问题；末尾按影响大小列出 F1 前必须修的问题和最小修复建议。不要自行修复。
汇报不超过 200 字：哪些命令失败、必须修的问题。
```

人工操作（演练通过后，20:00 定稿推送）：

```powershell
git status --short
git push
```

卡住时怎么办：

- 重跑有改动：多半是时间戳或排序不稳定，回到 A7-1 或 A7-2 修成取提交时间、稳定排序。
- `pnpm check:all` 因 spec:lint 失败：回到 H-SG6，确认 spec_gaps.md 全文没有"待团队裁决"。

## 二十一、月历视图：H-SG5 与 A5-cal（团队选做）【改】

- 要点：主窗口（H-SG5）与工作树 ../quyoudu-cal（A5-cal）｜H-SG5 用 Claude Opus 5.5，A5-cal 用 Grok 4.7｜约 4.5 小时｜前置：Q2 的团队决定为 B；A5-cal 在合并 ui 之后｜产出文件：docs/rules.md、docs/policy_card.md、.cursor/rules/ui.mdc、docs/_work/spec_gaps.md、src/ui/calendar/model.ts、src/ui/、tests/e2e/calendar.spec.ts｜验收：`pnpm check:all`；`pnpm test:e2e`

Q2 未选 B 时整节跳过。H-SG5 安排在 10/16 12:30（主窗口午饭空档），A5-cal 安排在 10/17 10:00—13:30。

H-SG5 提示词（Opus，主窗口）：

```text
@AGENTS.md @docs/_work/plan_a5_a7.md（只看第二十四节 Q2、Q4 的"团队决定"）@docs/_work/spec_gaps.md @.cursor/rules/ui.mdc
目标：按团队裁决（Q2 选 B）把资金日历的月历视图写入规格。只改 docs/rules.md、docs/_work/spec_gaps.md、docs/policy_card.md 第八节"资金日历页"那一句（第 1055 行）、.cursor/rules/ui.mdc；不改代码、向量和 traceability 预期；不打开 oracle/。rules.md 只打开 §8.8、§9.9、§10 引言和 D53。
1. rules.md §8.8 末尾新增"资金日历的月历视图"条目，编号取 §8.8 现有最大 D 编号加 1（下称"新条目"）。§8.8 标题现为"D34—D75"、§9.9 写"D01—D75"，但条目已到 D77：先把这些范围同步为实际最大编号，再计入新条目。条目末尾标"DEMO-CFG-1｜依 SG 裁决"，SG 编号取 spec_gaps.md 现有最大编号加 1。内容：
   - 资金日历页提供"月历"和"曲线"两种视图，展示同一份计算结果的同一条时间轴；默认视图为月历。
   - 月历按自然月、周一开头，覆盖检查期间所在的各月；as_of 当日标"今天"；检查期间之外的日期淡化；演出日单独标记。
   - 日格标出当日的收入（预计与实际区分）、购买日、付款日、生活支出和机动预留释放。当日有节点时，显示当日最后一个节点的未分配资金 U。当日判定取最严重者，次序为：保护性资金缺口＝付款缺口＞分配冲突＞缺口延续＞冲突延续＞通过；颜色之外同时用图标和文字区分。
   - 点开日格显示当日各节点（按 §10.2 的顺序，流出组标"同日先后未知"）、各项余额和计算依据（D34）。
   - 月历是资金日历时间轴的另一种展示，不是 D53 所说的独立购买日历组件，不新增页面；购买日与付款日在两种视图中都要标出。
   - 页面上的金额只取自计算结果或当前已应用操作的输入，不做加减乘除。
2. 在 D53 末尾补一句"（月历视图见"加新条目的实际编号加"）"。spec_gaps.md 新增一行，状态写"已裁决"并在括号里写新条目的实际编号，再写"DEMO-CFG-1 新规则"。
3. policy_card.md 第八节"资金日历页"那一句末尾补"（月历与曲线两种视图，见 rules.md"加新条目的实际编号加"）"。
4. .cursor/rules/ui.mdc 新增三条：资金日历页含月历与曲线两种视图；页面只做选择、分组、排序和格式化，不对金额做加减乘除；状态不只靠颜色，同时有图标和文字。
5. pnpm check:all 通过后提交 "spec: H-SG5 calendar view"，只 git add docs/rules.md docs/policy_card.md docs/_work/spec_gaps.md .cursor/rules/ui.mdc。
汇报不超过 200 字：新条目编号和改动的文件。
```

人工操作一（10/16 H-SG5 提交后，刷新参考实现的输入指纹；参考实现无需改代码；`git status` 里只应出现 oracle/ 下的改动）：

```powershell
cd D:\programs\project\quyoudu
pnpm oracle:export
pnpm oracle:import
git status --short
git add oracle
git commit -m "oracle: H-SG5 后刷新输入指纹"
```

人工操作二（10/17 合并 ui 之后，建月历工作树）：

```powershell
cd D:\programs\project\quyoudu
git worktree add ..\quyoudu-cal -b ui-cal
cd ..\quyoudu-cal
pnpm install --frozen-lockfile --offline
```

A5-cal 提示词（Grok，月历工作树）：

```text
@AGENTS.md @.cursor/rules/ui.mdc @src/engine/result.ts @src/engine/evaluate.ts @src/engine/ops/index.ts @src/ui
目标：在资金日历页实现月历视图。规格只读 docs/rules.md §8.8 中"资金日历的月历视图"条目（H-SG5 新增）和 D34、D53、§10.2。在工作树 ../quyoudu-cal（分支 ui-cal）里做，只改 src/ui/**、src/*.css、tests/e2e/**；不改 src/engine/；不打开 oracle/；不读 .env；界面不出现 PATCH（D58）。
1. src/ui/calendar/model.ts：buildCalendarModel(result, currentInput) 返回月份数组；每月为周一开头的周数组；每天含 date、inCheckPeriod、isToday、isShowDay、marks、verdict（当日最严重者，次序见该条目）、dayEndAmount（原样引用当日最后一个节点的 result.nodes[].unallocated）、nodeIndexes。日期按字符串前 10 位处理，星期用不依赖时区的纯函数计算，不调用无参 new Date()。只做选择、分组、排序，不对任何金额做加减乘除。
2. 数据来源：节点与判定取 result.nodes、result.earliestGap、result.gapList、result.constraintIssues；检查期间取 result.checkPeriod；购买日取 result.actionList[].purchaseDate；付款日与金额取 result.cost.futurePayments、result.cost.paidPayments；事件名称、收入金额、预计或实际取当前输入的 events[]（A5-1 已用 applyMutation 得到当前输入）。
3. 组件：MonthCalendar（默认显示最早缺口所在月，没有缺口时显示 as_of 所在月）、DayCell、DayDetailSheet（当日节点按顺序列出，流出组标"同日先后未知"，余额与依据按 D34 分两项）、CalendarLegend。资金日历页顶部做"月历｜曲线"切换，默认月历；原时间轴曲线保留在"曲线"。日格加 data-testid（cal-day 加日期）、data-verdict、data-marks。
4. tests/e2e/calendar.spec.ts（测试名以 calendar 开头，T017-09 的那条以 T017-09 开头）：04_cA_gap_living 第 1 步后，最早缺口日带对应的 data-verdict；购买日、付款日带 data-marks；点开日格能看到计算依据；日格中每个带 data-money 的金额与 evaluate 结果逐分相同；页面上没有名为"购买日历"的独立组件或页面。纯函数的单元测试由合并时在 main 上补到 tests/unit/calendar-model.test.ts（ui-cal 分支不能写 tests/unit）。
5. pnpm check、pnpm test:e2e（先 $env:E2E_PORT='5175'）通过后提交 "A5-cal: 资金日历月历视图（H-SG5）"，只 git add 允许的路径。
汇报不超过 200 字，只写：做了什么、测试结果、SPEC-GAP 待登记项、问题。
```

人工操作（10/17 13:30 前合并月历分支，并补单元测试）：

```powershell
cd D:\programs\project\quyoudu
git merge --no-ff ui-cal
pnpm check
pnpm test:e2e
git worktree remove ..\quyoudu-cal
git branch -d ui-cal
```

合并后在主窗口开 Grok 新对话补单元测试，再进入 A7-3：

```text
@AGENTS.md @src/ui/calendar/model.ts @fixtures/flow_index.json
目标：为月历的纯函数补单元测试（ui-cal 分支不能写 tests/unit）。在 main 上做，只新建 tests/unit/calendar-model.test.ts；不改 src/；不打开 oracle/；不读 .env。
1. 测试名以 calendar-model 开头。用 src/engine/evaluate.ts（config 为 DEMO_CFG_1）计算 04_cA_gap_living、01_cB_topk_main 各步的结果作输入，断言：月份范围覆盖 result.checkPeriod；每周从周一开始；as_of 当日 isToday 为 true；同日多个节点时 verdict 取最严重者；dayEndAmount 就是当日最后一个节点的 result.nodes[].unallocated（同一对象，只引用不派生）。
2. 另断言 src/ui 下没有 PATCH 字样，也没有调用 Date.now() 或无参 new Date()。
3. pnpm check 通过后提交 "A5-cal: calendar-model 单元测试"，只 git add tests/unit/calendar-model.test.ts。
汇报不超过 200 字，只写：做了什么、测试结果、问题。
```

卡住时怎么办：

- 10/17 13:30 月历还没通过：放弃合并 ui-cal，A7-3 照常做；H-SG5 的规则保留，在 freeze_report 的"已知限制"写明月历未实现。

## 二十二、人工任务汇总

| 时间 | 谁 | 任务 | 用时 |
| --- | --- | --- | --- |
| 10/16 09:00 | 你 | H0：提交 diff_report 与 oracle_inputs.json；计划入库；移走 handoff 大文件 | 10 分钟 |
| 10/16 09:00 | 全队 | 第二十四节逐题填"团队决定"；Q3 选 A 时改 ui.mdc 第 8 行 | 20 分钟 |
| 10/16 09:45 | 你 | 建 ui 工作树、`pnpm install`、新开 Cursor 窗口、设 E2E_PORT | 10 分钟 |
| 10/16 09:45、13:30 | 你 | 确认 A5-1、A6-1 的 Plan Mode 计划 | 各 10 分钟 |
| 10/16 11:00 | 你 | 锁定流程结果：golden:write --cases、核对、golden:freeze、打 tag | 10 分钟 |
| 10/16 12:30 | 你 | 推送 book/data，通知队友 | 5 分钟 |
| 10/16 12:30 | 你 | A6-prep：Poe 密钥、.env | 15 分钟 |
| 10/16 12:30 | 你 | （Q2 选 B）H-SG5 后运行 oracle:export、oracle:import | 10 分钟 |
| 10/16 18:00、20:00 | 你 | 看 A5-2 页面；砍范围检查点 | 各 10 分钟 |
| 10/16 22:00 | 你 | 推送 status.json 第一版；把 .cache/ui_review/ 的截图拖给 Opus | 10 分钟 |
| 10/17 10:00 | 你 | 合并后逐页检查；删除 ui 工作树 | 20 分钟 |
| 10/17 10:00 | 你 | （Q2 选 B）建月历工作树（第二十一节人工操作二） | 10 分钟 |
| 10/17 13:30 | 你 | （Q2 选 B）合并 ui-cal、删除月历工作树 | 10 分钟 |
| 10/17 17:00 | 全队 | H-SG6：在 decisions.md 填"团队决定" | 40 分钟 |
| 10/17 19:00 | 你 | `pnpm diff:oracle` | 5 分钟 |
| 10/17 20:00 | 你 | 推送截图、book/data、status.json 定稿，通知队友 | 10 分钟 |
| 10/18 12:00 | 你 | 最后一次全量运行（第二十节的命令清单） | 30 分钟 |
| 10/18 14:00 | 你 | F1（源计划第十一节）；打 tag submit-freeze；通知队友重建项目书 | 60 分钟 |

## 二十三、常见失控与处理【改】

| 现象 | 处理 |
| --- | --- |
| 终端报 '&&' is not a valid statement separator | PowerShell 5 不支持 &&：命令逐行运行，或改用 pnpm check 这类 npm 脚本 |
| 工作树里 `pnpm check` 在 precheck 处报找不到 .cache/precheck.json | A5-prep 第一部分（改名 vec:precheck）还没进来：在工作树运行 `git merge main`；来不及就逐条运行 pnpm typecheck、pnpm lint、pnpm test |
| 主仓库每次 `pnpm check` 后 docs/_work/precheck_report.md 修改时间变化 | 同上，A5-prep 第一部分修复前的现象；内容无差异就不用管，有差异时 `git checkout -- docs/_work/precheck_report.md` |
| e2e 报 5173 端口已被占用 | 两个窗口在抢端口：工作树设 `$env:E2E_PORT='5174'`；主窗口跑 e2e 前关掉自己开的 `pnpm dev` |
| `pnpm check:all` 因 spec:lint 失败 | spec_gaps.md 出现了"待团队裁决"（包括说明文字里）：做 H-SG6，裁决后全文不能再有这几个字 |
| 代理 `git add -A` 带上了 handoff 大文件、.env 或 .cache | 提示词都要求只 add 指定路径；推送前人工看 `git status --short`，误提交就 `git reset --soft HEAD~1` 后重来 |
| 页面上出现 PAYMENT_GAP、NO_PLAN 之类的枚举代码 | 冒烟测试会报；中文名统一放 src/ui/text.ts，原因代码按 Q7 |
| 页面金额与引擎不一致 | 页面做了运算：搜索 src/ui 中对 .value 的加减，改为只经 formatCents 显示；A7-3 用 data-money 自动核对 |
| ui.mdc 与 rules.md 写法不同（"草案预览，未确认"） | 以 rules.md D62 为准，两句分开同时显示 |
| 代理按 rules.md 去找 src/engine/ops.ts | 该文件不存在，用 src/engine/ops/schema.ts 和 ops/index.ts |
| ui 分支的代理想写 tests/unit 或 docs/_work/spec_gaps.md | §5 不允许：单元测试和 SG 登记在"合并 ui"一步补，ui 分支只写 // SPEC-GAP 待登记 |
| JSON 或 golden 校验出现乱码、哈希对不上 | 检查是否有文件被 PowerShell 写成了 UTF-16：让代理用 Node 重写为 UTF-8 后，由你重新运行 golden:write、golden:freeze |
| 代理改向量的 expect，或整条跳过向量 | golden:check 和 vector-disputes 的计数会暴露。回滚 checkpoint，重申 AGENTS.md §3 |
| traceability.csv 整文件出现在 diff 里 | 换行、BOM 或引号被改了：让 trace:update 逐行替换"状态"字段 |
| 报告或导出每次重跑都有改动 | 时间戳取了系统时钟或 HEAD，或排序不稳定：改为最后一次改动 src、scripts、tests、fixtures 的提交，排序固定；代码与产出分两次提交 |
| 新工作树 `pnpm install` 卡在 puppeteer 下载浏览器 | pnpm-workspace.yaml 允许 puppeteer 运行安装脚本（mermaid-cli 用），工作树用不到：先运行 `$env:PUPPETEER_SKIP_DOWNLOAD='true'` 再重装 |
| live 模式调用次数超出 3 次 | live 只允许通过 `pnpm nl:record` 运行一次（内含 3 次）；测试一律用固定样例 |
| oracle 和 TS 对拍出现差异（H-SG5 之后） | 先看是不是输入指纹没刷新（人工 oracle:export、oracle:import），再开 GPT-5.6 sol 的 oracle 窗口 |
| mermaid 渲染报找不到浏览器 | 用 E0 生成的 puppeteer-config.json 指向 Playwright 下载的 chromium |
| Node 25 下某个依赖报错 | 用 nvm-windows 切到 Node 22 LTS，重新运行 pnpm install |
| 10/18 晚上发现项目书有错 | 只要还没提交就能改。所以提交前三人必须各自通读一遍 PDF |
| 截止当天网站拥堵 | 10/18 22:00 前提交，10/19 只用于重试 |

## 二十四、需要团队确认的问题

每题填一行"团队决定"。提示词会读这一节；某题没填时，按该题"未决时默认"执行。

Q1 对话提取的值，用户确认后怎样进入计算（D58、D60）

- 现状：10 个案例的 confirmations[] 都是空的；没有写入 confirmations[] 的操作；界面不得使用 PATCH。
- A：只显示与核对。提取值标"待确认"，用户点"确认"只改变界面标记，计算始终使用案例输入；目标页注明"计算使用案例输入；对话提取值只用于核对"。不新增操作，不动引擎。
- B：新增一个确认操作，把确认值写入 confirmations[] 后重算。要改 rules.md §12.4、D29、D58、引擎、参考实现和向量，F1 前做不完。
- 推荐：A。未决时默认：A。
- 团队决定：（未填）

Q2 资金日历页是否加月历视图（源计划 H-SG5、A5-cal）

- A：本版不做。资金日历页用时间轴曲线、节点列表和购买日、付款日标记（D53 已满足），月历放到第二段。
- B：做。日格显示当日最后一个节点的未分配资金 U（源计划 9.4 第 1 题的推荐），默认视图为月历；10/16 12:30 做 H-SG5 改规格，10/17 上午在月历工作树做 A5-cal，多用约 4.5 小时，挤占 A7-3 的修正时间。
- 推荐：A（界面和项目书都是零起点，先保证四页和截图）。未决时默认：A。
- 团队决定：（未填）

Q3 顶栏放什么（源计划 9.4 第 2 题）

- A：手机框内只放"模拟数据"徽标、as_of、输入版本、配置版本；案例切换、演示流程和"下一步"放在手机框外的演示控制台（窄屏时收进抽屉）。截图只拍手机框，画面更像真实 App。需要在 H0 改 .cursor/rules/ui.mdc 第 8 行。
- B：维持 ui.mdc 原文，全部放在框内顶栏。
- 推荐：A。未决时默认：B（不改规则文件）。
- 团队决定：（未填）

Q4 视觉方向（代替源计划 A5-design 的两个原型）

- A：稳重：白底、细线卡片、主色点缀。
- B：清新：浅暖底、圆角大卡、柔和主色。
- 推荐：A（金融场景，与"不是资金安全保证"的克制口径一致）。未决时默认：A。
- 团队决定：（未填）

Q5 每页底部是否加声明"比赛原型，使用模拟数据，非银行正式产品"

- A：加，每页底部一行小字。
- B：不加，只保留"模拟数据"徽标。
- 推荐：A（降低评委误以为已接入银行系统的风险）。未决时默认：B（rules.md §11.4 要求不另增文案，这句属于新增文案）。
- 团队决定：（未填）

Q6 演示流程怎样组织

- A：对照表 30 行按"同一案例、同一操作序列取前缀"合并成 14 个流程，每步标出覆盖的行号（survey §7 已验证 30 行都能复现）。
- B：每行一个流程，共 30 个（仅"cB_topk 载入"就有 10 个相同流程，e2e 和截图随之翻倍）。
- 推荐：A。未决时默认：A。
- 团队决定：（未填）

Q7 原因代码在界面上的中文名（EXCLUDED_REASON_CODES、PENDING_REASON_CODES、INPUT_ISSUE_CODES）

- A：取 rules.md 中该代码所在条款的原词（如 PAYMENT_GAP 取"付款缺口"），集中写在 src/ui/text.ts；合并时登记一条 SG（待团队裁决），在 H-SG6 批量复核。
- B：团队先逐条拟定中文名，A5-1 照抄。
- 推荐：A。未决时默认：A。
- 团队决定：（未填）

Q8 对照表第 25 行（cB_topk 新增 9/10 的 200 元生活支出）的演示效果

- 现状：不先选候选、直接新增这笔支出后，按现有引擎优化状态由 COMPLETED_FEASIBLE 变为 NO_KNOWN_FEASIBLE（survey §7 探针 P03）；对照表该行只写"候选比较、排序和状态按新版本重算"。
- A：保留，演示"新增必要支出后原推荐全部失效，不强行推荐"。
- B：改用较小金额或其他日期，让演示停在"仍有可行方案、排序变化"；要改 policy_card 第八节该行，并重新锁定流程结果。
- 推荐：A（不改已锁定的规格和案例）。未决时默认：A。
- 团队决定：（未填）

### 交给 F1 的接口

F1 沿用源计划第十一节的提示词，改两处："export:results 实际用的引擎"固定写 ts；freeze_report.md 设"已知限制"一节，列出未通过的命令或测试、没做的"尽量有"项目、仍为"AI暂定（保守）"的 SG 条数。F1 依赖的脚本和产出，在 A7 结束时（10/17 20:00 定稿）应处于以下状态：

| 接口 | 由哪步实现 | A7 结束时的状态 |
| --- | --- | --- |
| `pnpm test:e2e` | A5-prep 接 playwright test；A7-3 写 flows、ui-layer、screens 三组测试（A6-2 另有 nl） | 退出码 0，生成 .cache/report/playwright.json；有失败时已如实记入报告，不跳过 |
| `pnpm export:results` | A7-1 | 退出码 0；book/data/cases 10 个文件、book/data/flows 14 个文件、book/data/index.json；meta.engine 为 ts；与 tests/golden/flows 一致；重跑无差异 |
| `pnpm test:report` | A7-2 | 退出码 0；book/chapters/91_appendix_test_report.md、book/data/status.json 含 vitest、向量、e2e、预检、对拍的计数；重跑无差异 |
| `pnpm trace:update` | A7-2 | 退出码 0；traceability.csv 只改"状态"列，无 BOM、LF；状态文本不含 SG、D、V 编号；重跑无差异 |
| book/data | A7-1、A7-3 刷新 | 已提交、已推送；队友据此写第 4—6 章 |
| 截图 | A7-3 | book/figures/screens/ 的 png 与 index.md 已提交；张数与 flow_index.json 的 screenshots 合计一致（不超过 40） |
| `pnpm check:all`、`pnpm vec --all`、`pnpm golden:check` | 现有 | 退出码 0；spec_gaps.md 不含"待团队裁决"（H-SG6） |
| `pnpm diff:oracle` | 现有，由你运行 | 差异 0，docs/_work/diff_report.md 已提交 |

## 附：自查结果

由 `python .cache/plan/check_plan.py` 生成，检查本节之前的全文；结论：全部通过。

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 全文不含两个连续的左花括号 | 通过 | 0 处 |
| 提示词中 @ 引用的路径当前存在，或由之前的步骤产出 | 通过 | 共 109 处：当前存在 97，之前步骤产出 12 |
| 提示词与人工命令中的 pnpm 脚本在 package.json 中存在或已声明新建；仍未实现的已声明改写 | 通过 | 共 19 个：check、check:all、dev、diff:oracle、export:results、flows、golden:check、golden:freeze、golden:write、nl:record、oracle:export、oracle:import、precheck、spec:lint、test:e2e、test:report、trace:update、vec、vec:precheck |
| 每一步都写了验收命令 | 通过 | 17 步 |
| 提示词中的 LABEL_CODES、Op 类型与其他大写标识都能在源码中找到（或已声明为新建标识） | 通过 | 共 66 个，其中标签代码 16 个、Op 类型 12 个；新建标识 E2E_PORT、POE_API_KEY、POE_MODEL；按普通缩写放行 BOM、CSS、DOC、HEAD、JSON、LLM、POST、SDK、URL、UTC |
| 提示词中 result. 开头的 ResultCore 键名都在 resultCoreSchema 的字段路径中 | 通过 | 共 93 处，对照 .cache/plan/contract.json 的 211 条路径 |
| 附加：每条提示词在 @ 行之后以"目标："开头 | 通过 | 19 条提示词 |
| 附加：每条提示词写明汇报格式 | 通过 | 19 条提示词 |
| 附加：每条提示词写明不打开 oracle/ | 通过 | 19 条提示词 |
| 附加：涉及 src/ui 的提示词写明 PATCH 约束 | 通过 | 19 条提示词 |
