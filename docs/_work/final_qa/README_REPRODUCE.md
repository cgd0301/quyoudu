# 趣有度项目书 · 可编辑源文件包（2026-10-19 最终 QA 版）

本目录与 `../QuYouDu_ICBC_Cup_Final.pdf`（**58 页，6,458,685 字节，SHA-256 `80858269AB58B9C2A24F69FB505F3EF0E738D20039B99139195D96C7167FD1D8`**）一一对应。

## 目录

| 路径 | 内容 |
| --- | --- |
| `book/meta.yml` | 封面元信息（标题、副标题、队名 NaiLung、院校、成员、日期） |
| `book/chapters/*.md` | 章节源文件：摘要、八章、结论、产品建议、附录 A—E（附录 B 为生成章） |
| `book/figures/*.svg` | 23 张图的矢量源文件（含图号、标题、数据来源落款） |
| `book/figures/index.md` | 附录 F 图表索引（图号、文件名、数据来源、口径说明） |
| `book/data/**` | 引擎导出：案例/流程结果 JSON、`status.json`（测试计数）、`index.json`、`business_model.json` |
| `scripts/` | 成稿、PDF、图表与测试报告的生成脚本 |
| `screenshots/` | 4 张原型宽版截图（界面实拍，模拟数据） |
| `code/src_ui/dailyText.ts` | 每日参考文案逻辑（PDF §5.4 引用的修复点，见下） |
| `code/tests/ui-daily-text.test.ts` | 该逻辑的 13 条单元测试 |

## 生成脚本

| 文件 | 作用 |
| --- | --- |
| `scripts/book-build.ts` | 按固定章节顺序合成 Markdown；解析数据占位注释并填入 `book/data` 的真实值；生成目录；校验章节/图表 |
| `scripts/book-pdf.ts` | 把成稿排成 A4：自带 Markdown 解析、浏览器内手工分页、目录页码取自真实版面、逐页截图 |
| `scripts/figures.ts` | 由 `book/data` 生成 23 张 SVG 与 `index.md`；图号按正文出现顺序自动编排；结构图与数值图使用不同落款 |
| `scripts/test-report.ts` | 生成附录 B 与 `book/data/status.json`（B.3 汇总结论、B.4 未完成项均由模板生成） |
| `scripts/lib/book.ts` | 章节清单与顺序（唯一排序来源） |
| `scripts/lib/pdf-paginate.ts` | 浏览器内固定页框分页算法（含表格/脚注跨页拆分） |

## 最小复现说明

前提：Node.js 24、pnpm 12、Playwright Chromium、系统中文字体（思源宋体/黑体，缺失时回退宋体/雅黑）。

```powershell
# 在完整仓库（含 package.json / src / tests / fixtures）中运行
pnpm test                    # 单元测试：1194 通过、1 跳过
pnpm test:e2e                # 端到端：17 条 spec 通过
pnpm doc:lint                # 文档检查：16 项通过
pnpm test:report             # 生成附录 B 与 status.json（会重跑单元测试与向量）
pnpm figures                 # 生成 23 张 SVG 与 index.md
pnpm book:build              # 成稿：16 节、44 处占位符、23 张图
pnpm book:pdf                # PDF 与逐页截图 .cache/pdf-pages/
pnpm book:build --check      # 校验成稿与章节一致
pnpm count:chars             # 篇幅：摘要 489 字、产品建议 369 字
```

`book:build` 会拒绝缺章、缺图、占位符解析失败、图表少于 15 张；`book:pdf` 会拒绝缺图、脚注缺定义、分页溢出、PDF 页数与版面页数不一致。

## 重要的可编辑性说明

1. **数字分两类**：引擎产生的数字以数据占位注释（`data: 文件#路径`）写在章节里，构建时填入，**不要手改 `book/build` 下的成稿**；问卷计数（×/30）、外部统计与官方日期是人工录入的，直接改章节并同步附录 D。
2. **图号**：SVG 内部写的是占位符，由 `figures.ts` 按正文首次出现顺序赋号。增删图后重跑 `pnpm figures` 即可，但正文里手写的"图 N"引用需同步核对。
3. **附录 B 是生成章**：由 `pnpm test:report` 从实跑结果生成；B.3/B.4 的措辞已进入模板，重跑不会丢。
4. **排版参数**集中在 `scripts/book-pdf.ts` 的 `CSS` 与 `#flow`/`#measure` 的 174mm 宽度；两者必须一致，否则分页会错。
5. **图表落款分四类**：数值图为"模拟数据"；架构/执行流程/数据流/状态树四张结构图为"结构图：按 docs/rules.md 与仓库现有目录/代码人工整理，非引擎导出"；图 1 为"受访者自报数据（非模拟）"；图 15/16 为外部公开资料。
