# 趣有度（Quyoudu）

**跨城观演的资金可行性规划助手。** 用户说清演出、出发城市、预算与收入到账时间，系统把必要费用按付款日排进资金时间轴，逐节点检查"付款当天付得起吗"，比较最多 3 个完整购买组合，确认后生成行动清单。

> 全部案例、报价、历史价格与消费记录均为**模拟数据**，不连接真实账户、不代付、不自动下单、不爬取全网、不做跨币种换算。

主分支 `main`｜交付状态见下方「当前状态」｜规则权威来源 [docs/rules.md](docs/rules.md)

---

## 快速开始

```powershell
pnpm install --frozen-lockfile     # Node 24 / pnpm 12；Python 3.11 仅对拍与参考实现需要
pnpm dev                           # 启动前端，默认 http://localhost:5173
pnpm check                         # 前端与引擎的基础检查链路：tsc + oxlint + vitest
pnpm exec playwright install chromium   # E2E 第一次跑之前装一次浏览器
pnpm test:e2e                      # 端到端：四页主流程 + 控制台无错误
pnpm presubmit                     # 完整门禁：按依赖顺序跑完除 E2E 外的全部检查
```

> `pnpm check` 与 `pnpm presubmit` 都不含 E2E；端到端必须单独跑 `pnpm test:e2e`，未运行就不算通过。

## 交付物导航

| 交付物 | 位置 | 入口 | 状态 |
| --- | --- | --- | --- |
| 前端源码（四页界面） | `src/App.tsx`、`src/App.css`、`src/index.css` | [src/App.tsx](src/App.tsx) | 已合入主线；主流程 E2E 通过 |
| 界面截图（4 张，真实启动后截取） | `submission/screenshots/` | `pnpm shots`｜[01 概览](submission/screenshots/01-overview.png)·[02 比较](submission/screenshots/02-compare.png)·[03 日历](submission/screenshots/03-calendar.png)·[04 计划管理](submission/screenshots/04-manage.png) | 已生成（2026-10-18） |
| 项目书源章节（16 章） | `book/chapters/` | [book/chapters/](book/chapters/) | 手写源文件 |
| 项目书成稿 | `book/build/趣有度_项目书.md` | `pnpm book:build` | 构建产物，不入库；需本地生成 |
| 图表（16 张 SVG） | `book/figures/` | `pnpm figures`｜[index](book/figures/index.md) | 由导出数据生成 |
| 测试报告（附录A） | `book/chapters/91_appendix_test_report.md` | `pnpm test:report` | 由真实运行结果生成 |
| 追溯表（181 行） | `docs/traceability.csv` | `pnpm trace:update` | 由真实证据生成 |
| 参考实现对拍报告 | `docs/_work/diff_report.md` | `pnpm diff:oracle` | 每轮实跑，含来源与版本 |
| 问卷（题面／字段／分析） | `docs/_work/survey/` | [README](docs/_work/survey/README.md)·[题面](docs/_work/survey/questionnaire.md)·[字段](docs/_work/survey/schema.json)·[分析状态](docs/_work/survey/report.md) | **问卷未发放，无任何统计结果** |
| 市场漏斗与单位经济模型 | `docs/_work/business_model.md` | `pnpm model:economics` | 条件式模型（非预测） |
| 外部公开资料核验记录 | `docs/sources.md` 文末 | [E01—E06](docs/sources.md) | 已核验 6 条 + 4 条待核验 |
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
| `pnpm model:economics` | 复算市场漏斗与单位经济，写 `book/data/model` 与 `docs/_work/business_model.md` |
| `pnpm survey:report` | 问卷统计；无原始答卷时只写"未运行（缺少输入）" |
| `pnpm test:report` | 汇总真实运行结果，写附录A 与 `book/data/status.json` |
| `pnpm trace:update` | 按真实证据更新追溯表状态列 |
| `pnpm figures` | 由 `book/data` 生成 16 张 SVG |
| `pnpm doc:lint` | 项目书检查（章节、占位符、断链、路径、禁用词、表述与金额可追溯） |
| `pnpm count:chars` | 篇幅统计（作品概述、产品建议各 500 字上限） |
| `pnpm book:build` | 合成 `book/build/趣有度_项目书.md`；`--check` 只比较不写入 |

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
pnpm model:economics    # 3 市场与单位经济模型到 book/data/model
pnpm doc:lint           # 4 文档检查（读 book/data）
pnpm test:report        # 5 附录A + book/data/status.json
pnpm trace:update       # 6 追溯表状态
pnpm figures            # 7 图表
pnpm book:build         # 8 成稿
```

## 当前状态（2026-10-18）

**已验收**

- 计算引擎 M1—M9 + 规则 R001—R020 / D01—D88：单元测试 1151 注册、1150 通过、1 跳过；向量 152/152、断言 1004/1004；对拍差异 0（检查点 180/180）；golden 冻结完整。
- 文档链路：`doc:lint` 16 项自动检查通过；成稿 16 章、占位符残留 0、图表 16 张。
- 前端主流程：`pnpm test:e2e` 1 条 spec 通过（概览→比较→确认→资金日历→计划管理），控制台 0 错误；四页截图已生成。
- 研究纪律：客户证据只来自问卷；问卷未发放，仓库内无任何统计结果，正文所有客户侧结论均标"待验证"。

**未完成（不计为通过）**

- UI 层 21 条子用例尚未逐条覆盖，现有 1 条 E2E spec 只覆盖主流程。
- 问卷未发放：目标 100 份有效、最低 30 份，回收后才可替换正文的"待验证假设"。
- 参考实现的输入指纹在 `docs/rules.md` 变更后未重录（只允许人工运行 `oracle:import`），`diff:oracle` 首行会告警，但用例与向量指纹未变、对拍结果仍有效。
- 类别 B（结果契约未覆盖）与类别 C（规则未定义/样本门槛）的向量缺口仍保留，见 `docs/_work/vector_gaps.md`。

## 关于 PPT

仓库内**没有** `*.pptx` / `*.pdf` 演示稿，因此本 README 不提供 PPT 链接。官方交付要求（原文见 [docs/sources.md](docs/sources.md) 第 141—149 行）是：

- 提交项为「作品名称 + 作品概述（≤500 字）+ 上传附件 + 产品建议（≤500 字）」；
- 附件大小 20M 内，接受 **doc / docx / ppt / pptx / pdf**；
- 原文补充：「上传附件即比赛内容中描述的项目书」。

即 PPT 是可接受的**附件格式**之一，不是独立交付物。本轮据此不生成 PPT；需要路演稿时，应以 `pnpm book:build` 的成稿为唯一内容来源，并去掉其中的"待验证"标注后再另行制作，不得虚构问卷数据填入。

## 目录

- `src/engine/`：确定性引擎（M1—M9）与结果契约 `ResultCore`。
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
