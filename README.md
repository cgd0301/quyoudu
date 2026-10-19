# 趣有度（Quyoudu）

**面向青年大额、多笔消费的资金安排与方案比较工具，以跨城观演为切入场景之一。** 用户说清演出、出发城市、预算与收入到账时间，系统把必要费用按付款日排进资金时间轴，逐节点检查"付款当天付得起吗"，比较最多 3 个完整购买组合，确认后生成行动清单。

> 全部案例、报价、历史价格与消费记录均为**模拟数据**，不连接真实账户、不代付、不自动下单、不爬取全网、不做跨币种换算。

主分支 `main`｜交付状态见下方「当前状态」｜规则权威来源 [docs/rules.md](docs/rules.md)

---

## 快速开始

```powershell
pnpm install --frozen-lockfile     # Node 24 / pnpm 12；Python 3.11 仅对拍与参考实现需要
pnpm dev                           # 启动前端，默认 http://localhost:5173
pnpm check                         # 前端与引擎的基础检查链路：tsc + oxlint + vitest
pnpm exec playwright install chromium   # E2E 第一次跑之前装一次浏览器
pnpm test:e2e                      # 端到端：主流程 + UI 层子用例（17 条 spec），控制台无错误
pnpm presubmit                     # 完整门禁：按依赖顺序跑完除 E2E 外的全部检查
```

> `pnpm check` 与 `pnpm presubmit` 都不含 E2E；端到端必须单独跑 `pnpm test:e2e`，未运行就不算通过。

## 交付物导航

| 交付物 | 位置 | 入口 | 状态 |
| --- | --- | --- | --- |
| 前端源码（四页界面） | `src/App.tsx`、`src/App.css`、`src/index.css` | [src/App.tsx](src/App.tsx) | 已合入主线；E2E 17 条通过（UI 21 条中 13 条有对应用例） |
| 界面截图（4 张，真实启动后截取） | `submission/screenshots/`（移动版）与 `submission/screenshots/wide/`（书内引用的宽版） | `pnpm shots`（`SHOT_DIR`/`SHOT_WIDTH`/`SHOT_HEIGHT` 可改）｜[01 概览](submission/screenshots/01-overview.png)·[02 比较](submission/screenshots/02-compare.png)·[03 日历](submission/screenshots/03-calendar.png)·[04 计划管理](submission/screenshots/04-manage.png) | 已生成；项目书引用 wide/ 版本 |
| 项目书源章节（主文 8 章 + 摘要/结论/建议 + 附录 A—E + 附录 F 图表索引） | `book/chapters/` | [book/chapters/](book/chapters/) | 手写源文件（附录 B 为生成章） |
| 项目书成稿（Markdown） | `book/build/趣有度_项目书.md` | `pnpm book:build` | 构建产物，不入库；需本地生成 |
| 项目书成稿（PDF，A4 版面 + 目录页码 + 逐页截图核验） | `submission/趣有度_项目书.pdf` | `pnpm book:pdf` | **58 页 / 6.16 MB**（2026-10-19 最终 QA 后重建） |
| 图表（23 张 SVG） | `book/figures/` | `pnpm figures`｜[index](book/figures/index.md) | 由导出数据与规则/代码结构生成；每个图有独立来源落款 |
| 测试报告（附录 B） | `book/chapters/91_appendix_test_report.md` | `pnpm test:report` | 由真实运行结果生成 |
| 追溯表（181 行） | `docs/traceability.csv` | `pnpm trace:update` | 由真实证据生成 |
| 参考实现对拍报告 | `docs/_work/diff_report.md` | `pnpm diff:oracle` | 每轮实跑，含来源与版本 |
| 问卷方法与字段 | `docs/_work/survey/` | [README](docs/_work/survey/README.md)·[题面](docs/_work/survey/questionnaire.md)·[字段 schema v2](docs/_work/survey/schema.json)·[设计稿 v1](docs/_work/survey/schema_design_v1.json) | 实际投放 10 题版；设计稿保留追溯 |
| 问卷结果（n=30 位受访者） | `docs/_work/survey/` | [统计表](docs/_work/survey/report.md)·[研究发现](docs/_work/survey/findings.md)·[脱敏数据](docs/_work/survey/analysis/responses.csv)·[清洗日志](docs/_work/survey/analysis/cleaning_log.json)·[独立复算](docs/_work/survey/analysis/recompute.md) | **30 位独立受访者（团队口径 n=30）；便利样本；部分支持客户需求；无价格/留存数据** |
| 原始 CSV 阻塞记录 | `docs/_work/survey/discovery.md`、`intake/` | [发现报告](docs/_work/survey/discovery.md)·[检查报告](docs/_work/survey/intake/report.md) | 历史记录：CSV 编码丢失；已由 XLSX 取代 |
| 市场与商业数字：事实锚点、公式与缺口 | `docs/_work/business_model.md` | `pnpm model:economics` | 只有已核验事实与符号公式；无市场规模、无情景数值 |
| 数据溯源台账（逐项） | `docs/_work/data_evidence_register.md` | — | 每个数字的来源、公式、适用边界与放行状态 |
| 外部公开资料核验记录 | `docs/sources.md` 文末 | [E01—E30、GH01—GH11](docs/sources.md) | 行业/统计/竞品/机构采购逐条记录，含未取得清单 |
| 赛事要求核查矩阵 | `docs/_work/competition_requirements.md` | — | 官方来源、适用阶段、提交状态与证据缺口；区分官方/团队标准 |
| 往期作品对标矩阵 | `docs/_work/case_benchmarks.md` | — | 4 个官方展示作品；只学论证方法，不复制内容 |
| 市场与商业模式研究 | `docs/_work/market_research.md`、`market_research_verified.md` | — | 已核验外部事实、TAM/SAM/SOM 符号框架、竞品官方定价与商业优先级 |
| 项目书架构审查 | `docs/_work/book_restructure_plan.md` | — | 旧版 16 章审查记录（2026-10-19 上午）；已按新结构改版，映射见交付报告 |
| 交付前最终 QA（本轮） | `docs/_work/final_qa/` | [QA 报告](docs/_work/final_qa/QuYouDu_Final_QA_Report.md)·[变更记录](docs/_work/final_qa/QuYouDu_Final_QA_Changelog.md)·[提交清单](docs/_work/final_qa/QuYouDu_Final_Submission_Checklist.md)·[主张台账](docs/_work/final_qa/QuYouDu_Claim_Source_Ledger.csv)·[可编辑源包说明](docs/_work/final_qa/README_REPRODUCE.md) | 版本核对、缺陷追踪、测试实跑、逐页检查与未解决事项 |
| 上一轮修改与审计报告 | `docs/_work/final_qa/QuYouDu_Revision_Audit_Report_round1.md` | — | 已被本轮 QA 报告更正（页数 59→58、T020 归属、单测 1181→1194） |
| 规格缺口与裁决记录 | `docs/_work/spec_gaps.md`、`spec_gaps_review.md` | — | AI 暂定项 0 条 |
| PPT | **不存在** | — | 官方提交要求见下方「关于 PPT」 |

## 常用命令（全部来自 `package.json`，已在当前环境实跑）

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动前端（vite，默认 5173） |
| `pnpm build` | `tsc --noEmit` + `vite build`，产物在 `dist/`（不入库） |
| `pnpm check` | 类型检查 + 静态检查 + 单元测试 |
| `pnpm check:all` | 上述 + `spec:lint` + `golden:check` |
| `pnpm test:e2e` | Playwright 端到端（需先装 chromium） |
| `pnpm shots` | 启动界面并截四页图到 `submission/screenshots/` |
| `pnpm presubmit` | 完整门禁，逐步核对退出码 |
| `pnpm vec --all` | 运行全部测试向量（152 个、断言 1004 条） |
| `pnpm validate:cases` | 校验案例与向量的结构、禁用词、提交版数据约束 |
| `pnpm diff:oracle` | 与独立参考实现逐检查点对拍 |
| `pnpm golden:check` | 校验 golden 冻结完整性 |
| `pnpm spec:lint` | 规格缺口状态与追溯表编号一致性 |
| `pnpm export:results` | 用正式引擎导出案例与流程结果到 `book/data` |
| `pnpm model:economics` | 由公开事实复算人均口径、写出公式与缺口清单，写 `book/data/model` 与 `docs/_work/business_model.md` |
| `pnpm survey:intake --input <导出件>` | 原始导出件接收检查（编码、字段、去重、时长、PII），写 `docs/_work/survey/intake`；阻塞时不生成统计 |
| `pnpm survey:report` | 从脱敏分析数据 `docs/_work/survey/analysis/responses.csv` 生成逐题统计；无输入时只写“未运行/阻塞” |
| `pnpm test:report` | 汇总真实运行结果，写附录 B 与 `book/data/status.json` |
| `pnpm trace:update` | 按真实证据更新追溯表状态列 |
| `pnpm figures` | 由 `book/data` 生成 23 张 SVG 与 `book/figures/index.md`（图号按正文出现顺序自动编排） |
| `pnpm doc:lint` | 项目书检查（章节、占位符、断链、路径、禁用词、表述与金额可追溯） |
| `pnpm count:chars` | 篇幅统计（作品概述、产品建议各 500 字上限） |
| `pnpm book:build` | 合成 `book/build/趣有度_项目书.md`；`--check` 只比较不写入 |
| `pnpm book:pdf` | 把成稿排成 A4 PDF（`submission/趣有度_项目书.pdf`），并逐页截图到 `.cache/pdf-pages/` |

`golden:write`、`golden:freeze`、`oracle:export`、`oracle:import` 标"仅限人工运行"，代理不得执行。

## 前端说明

- 入口 `src/App.tsx`，样式 `src/App.css`、`src/index.css`；页面状态在组件内，不引路由库。
- 界面只消费 `ResultCore`：金额一律经引擎的 `formatCents` 显示，页面内的元→分转换只用于用户输入，不做任何金额、状态或排序计算。
- 启动端口默认 5173；E2E 可用 `E2E_PORT` 覆盖（`playwright.config.ts`）。
- 截图脚本用同一份源码在 5199 端口起服务（`SHOT_PORT` 可改），截图前会走一遍"选方案→确认"，并要求页面上存在"模拟数据"标识。

## 数据与生成链路

改动规则或案例后，按此顺序重建，否则文档会与数据不一致：

```powershell
pnpm diff:oracle        # 1 先对拍（写 docs/_work/diff_report.md）
pnpm export:results     # 2 导出案例与流程到 book/data
pnpm model:economics    # 3 市场与商业数字：事实锚点、公式与缺口
python docs/_work/survey/analysis/import_xlsx.py --input <原始XLSX>  # 4 生成脱敏分析数据
pnpm survey:report      # 5 从 analysis/responses.csv 生成统计；输入不可用时只写“未运行/阻塞”
pnpm doc:lint           # 6 文档检查（读 book/data）
pnpm test:report        # 7 附录 B + book/data/status.json
pnpm trace:update       # 8 追溯表状态
pnpm figures            # 9 图表
pnpm book:build         # 10 成稿（Markdown）
pnpm book:pdf           # 11 排版为 A4 PDF 并逐页截图核验
```

## 当前状态（2026-10-19 21:20 最终 QA 后）

> 下列数字均来自本轮实跑或对 PDF 的独立解析，不是沿用旧记录；详细核对见 [docs/_work/final_qa/QuYouDu_Final_QA_Report.md](docs/_work/final_qa/QuYouDu_Final_QA_Report.md)。

**已验收**

- 计算引擎 M1—M9（11 个代码模块）+ 规则 R001—R020 / D01—D88：单元测试 **1,195 注册、1,194 通过、1 跳过**（32 个测试文件、158 个 suite）；向量 **152/152**、断言 **1004/1004**；`golden:check`、`validate:cases` 通过；`spec:lint` 警告 0。
- 文档链路：`doc:lint` **16 项**检查通过；成稿 **16 节 + 附录 F 图表索引**（目录 17 条）、数据占位 **44 处**全部由导出结果填入、图表 **23 张**；`pnpm book:pdf` 生成 **58 页** A4 PDF（27 张图、分页溢出 0）并逐页截图核验。
- 前端：`pnpm test:e2e` **17 条 spec** 通过（主流程 1 + UI 层子用例 13 + 补充断言 3），控制台 0 错误。
- UI 层 21 条子用例：**13 条覆盖、3 条部分覆盖、5 条未覆盖**；界面**不计为整体通过**，逐条矩阵见 `docs/_work/test_layers.md`。
- 客户问卷：30 位独立受访者（便利/非概率样本，10 题全答）。资金问题 22/30、焦虑 17/30、计划变化需重算 13/30、多方案比较 13/30、隐私 16/30；跨城观演 9/30、任何付费形式 8/30。**18—30 岁子样本 n=25**：对应为 17/25、14/25、10/25、12/25、3/25、15/25、19/25，任何付费形式 **5/25（20%）**——低于全样本的 26.7%。
- 赛事符合性：官方要求矩阵、4 个官方往期作品对标、市场/商业框架与改版映射已入档；主申报方向「青年群体服务」、辅助「数字金融」。

**本轮查到并修复的真实缺陷**

- **每日参考的「不建议新增」曾被渲染成 0.00 元**：引擎在 `NOT_RECOMMENDED` 时返回 `amount=0`（仅用于携带判定依据），界面原按 `amount == null` 判断，于是把「当前不建议新增非计划支出」显示成「0.00 元」，结论方向被反转。现改为按 `display === 'AMOUNT'` 判断，文案逻辑抽到 [`src/ui/dailyText.ts`](src/ui/dailyText.ts)，由 13 条单元测试与 `T018-09` 的端到端断言锁定；**真实的 0 元仍显示为金额**。该修复不改变 UI 覆盖计数（该分支原本无子用例）。
- 图表修正：图 3／图 8 纵轴单位由「分」改为「元」；图 10／11／12／23 落款由「模拟数据」改为「结构图：按规则与代码人工整理，非引擎导出」；图 22 画布加宽，修掉右侧两列被裁切。

**未完成（不计为通过）**

- **赛事提交**：截至 2026-10-19 21:20（+08:00）**未登录、未上传**。港澳台通道当日 24:00 关闭（本轮已打开官方通知页核实），关闭后不受理提交或修改。
- 官方未公开评分标准、章节模板、页数/字数与文件格式；本仓库的项目书结构为团队自定优化标准，不得写成官方要求。
- **附件格式与大小**：官方通知页与赛事指引页**均未公布**格式/大小（本轮实际打开核对）；仓库原摘录的「附件≤20M、接受 doc/docx/ppt/pptx/pdf」在本仓库按**团队自设文件控制标准**处理，不是已核实的官方规定。当前 PDF 为 6.16 MB。
- 市场与商业：只有人均支出口径等可由公开事实复算；市场规模、价格、收入、单位经济与盈亏平衡因缺证据不给出定量结论。
- 参考实现的输入指纹在 `docs/rules.md` 变更后未重录（只允许人工运行 `oracle:import`）；本轮未重跑 `diff:oracle`，差异 0 / 检查点 180 为历史记录。
- 类别 B（结果契约未覆盖）与类别 C（规则未定义/样本门槛）的向量缺口仍保留，见 `docs/_work/vector_gaps.md`。
- 港币单币种、真实账户、实时价格、机构合作均未实现；工作区无真实用户使用数据。

## 关于 PPT

仓库内**没有** `*.pptx` 路演稿；项目书以 A4 PDF 交付（`submission/趣有度_项目书.pdf`，58 页），不是 PPT。

- **已核实（本轮打开官方通知页 `news/view/131.html`，HTTP 200，发布 2026-09-20）**：港澳台地区 2026-10-19 24:00 截止；由团队队长登录系统完成成员维护与作品上传；通道关闭后不再接受提交或修改。该页**未提附件格式与大小**。
- **未核实（仓库摘录，[docs/sources.md](docs/sources.md) 第 141—149 行，原文未标链接与日期）**：提交项为「作品名称 + 作品概述（≤500 字）+ 上传附件 + 产品建议（≤500 字）」；附件大小 20M 内，接受 **doc / docx / ppt / pptx / pdf**；「上传附件即比赛内容中描述的项目书」。

因此：**「≤20MB、可用 PDF」在本仓库按团队自设的文件控制标准执行，不是官方规定**；官方赛事介绍、赛事指引与截止通知三页均未公布格式、大小、页数或评分标准。PPT 只是可能被接受的附件格式之一，不是独立交付物。需要路演稿时，应以 `pnpm book:build` 的成稿为唯一内容来源，并去掉其中"待验证"之外的营销化改写，不得虚构问卷数据填入。

## 目录

- `src/engine/`：确定性引擎（11 个代码模块，对应测试向量的 M1—M9 九组）与结果契约 `ResultCore`。
- `src/ui/`：界面展示层的纯函数（如 `dailyText.ts`：每日参考在「有金额／不建议新增／无法给出」之间的取值规则，由单元测试覆盖）。
- `src/nl/`：自然语言契约、会话状态机、传输适配与解释句校验（离线可回放）。
- `src/App.tsx`、`src/App.css`、`src/index.css`：四页界面。
- `fixtures/`：案例、向量、演示流程、自然语言回放（受保护基线）。
- `tests/unit/`：单元测试；`tests/golden/`：冻结结果（受保护）；`tests/e2e/`：端到端。
- `scripts/`：导出、报告、追溯、图表、文档、模型、问卷、截图与门禁脚本。
- `book/`：项目书源章节、导出数据、图表与构建产物。
- `docs/`：规则、政策卡、范围、追溯表与工作记录；`submission/`：截图等交付素材。
- `oracle/`：参考实现（**禁止阅读源码，只能经 `python -m oracle` 运行**）。

## 不可违反的项目约束

- 金额一律整数分，只用模拟时钟 `as_of`，禁止 `Date.now()`、无参 `new Date()`、`Math.random()`。
- 金额、日期、约束、排序、预测只在 `src/engine/` 由确定性代码计算；自然语言输出只能是"待确认值"。
- 受保护基线不得修改：`src/engine/**`、`fixtures/cases/**`、`fixtures/vectors/**` 的 `expect` 与 `source_text`、`tests/golden/**`、`tests/golden.lock`、`oracle/**`、`docs/sources.md` 原有内容。
- 客户证据只能来自问卷；不得用访谈、评论、日志或生成内容代替，缺失就写缺失。
- 规则缺口先登记再处理，不得自行把"AI暂定""待裁决"改为"已裁决"。

更多细节见 [AGENTS.md](AGENTS.md)。
