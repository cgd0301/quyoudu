# 趣有度（Quyoudu）

跨城观演的资金可行性规划助手。用户说清演出、出发城市、预算与收入到账时间，系统把必要费用按付款日排进资金时间轴，逐节点检查"付款当天是否付得起"，给出最多 3 个可行方案的完整购买组合与行动清单。

- 计算全部由 `src/engine/` 的确定性代码完成（金额整数分、只用模拟时钟 `as_of`、无网络、无随机数）。
- 自然语言辅助在 `src/nl/`：模型只做解析与提问，输出只是"待确认值"，不参与任何金额、状态或排序。
- 规则与数据契约见 `docs/rules.md`（权威）、`docs/policy_card.md`、`docs/scope.md`；测试与规则的对应见 `docs/traceability.csv`。
- 项目书在 `book/chapters/`，数据与图表由脚本从正式计算结果生成；成稿构建到 `book/build/`（不入库）。

## 环境与依赖

Node.js 24 与 pnpm 12；Python 3.11 仅参考实现与对拍需要。恢复依赖用锁文件，不要升级：

```powershell
pnpm install --frozen-lockfile
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm check` | 类型检查 + 静态检查 + 单元测试 |
| `pnpm check:all` | 上述三项 + `spec:lint` + `golden:check` |
| `pnpm vec --all` | 运行全部测试向量（152 个，断言 1004 条） |
| `pnpm validate:cases` | 校验案例与向量的结构、禁用词与提交版数据约束 |
| `pnpm spec:lint` | 统计规格缺口状态并核对追溯表引用的编号 |
| `pnpm golden:check` | 校验 golden 冻结完整性 |
| `pnpm diff:oracle` | 与独立参考实现逐检查点对拍，写 `docs/_work/diff_report.md` |
| `pnpm flows` / `pnpm flows --check` | 由 `fixtures/flow_index.json` 生成 / 校验 14 个演示流程 |
| `pnpm export:results` | 用正式引擎导出演示案例与流程结果到 `book/data` |
| `pnpm test:report` | 汇总真实运行结果，写附录A 与 `book/data/status.json` |
| `pnpm trace:update` | 按真实证据更新 `docs/traceability.csv` 的状态列 |
| `pnpm figures` | 由 `book/data` 生成 16 张 SVG 图表 |
| `pnpm doc:lint` | 项目书检查（章节、占位符、断链、路径、禁用词、表述与金额可追溯性） |
| `pnpm count:chars` | 篇幅统计（作品概述与产品建议各 500 字上限） |
| `pnpm book:build` | 合成 `book/build/趣有度_项目书.md` |
| `pnpm presubmit` | 按依赖顺序跑完上述门禁并逐步核对退出码 |

`golden:write`、`golden:freeze`、`oracle:export`、`oracle:import` 标"仅限人工运行"，代理不得执行。

## 目录

- `src/engine/`：确定性引擎（M1—M9）与结果契约。
- `src/nl/`：自然语言契约、会话状态机、传输适配与解释句校验。
- `fixtures/`：案例、向量、演示流程、自然语言回放。
- `tests/unit/`：单元测试；`tests/golden/`：冻结结果；`tests/e2e/`：端到端（1 条 Playwright spec 覆盖主流程，需要先 `pnpm exec playwright install chromium`）。
- `src/App.tsx`、`src/App.css`、`src/index.css`：四页界面，只消费 `ResultCore`，不参与金额计算。
- `scripts/`：数据导出、测试报告、追溯、图表、文档与门禁脚本。
- `book/`：项目书章节、导出数据、图表与构建产物。

## 当前状态

规则与技术验证已完成：单元测试、向量、golden、案例校验、规格自洽、对拍与文档链路由 `pnpm presubmit` 一次跑通。四页界面已与主线合并，端到端由 `pnpm test:e2e` 单独运行（现有 1 条 spec 通过，按 spec 计数）；**UI 层 21 条子用例尚未逐条覆盖，项目书截图尚未生成，这两项不算通过**。项目书中未使用任何界面截图，也未开展真实用户研究。已知缺口与未决事项见 `docs/_work/spec_gaps.md`、`docs/_work/vector_gaps.md` 与 `docs/_work/spec_gaps_review.md`。
