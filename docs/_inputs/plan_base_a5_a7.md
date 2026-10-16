## 三、日程、范围与保底【改】
时间	主窗口（你，Grok 为主）	oracle 窗口（GPT）	工作树（Grok）	队友	人工检查点
10/14 晚	P1、P2a、P2b	P3 同步	—	接受仓库邀请	P0；确认 P1 的裁决
10/15 上午	A4-0a 预检；M1	A4-0c 修 O 组	M8 Holt（holt）	C0、B3、团队亲历	A4-0b 后的 H-SG4；锁定向量
10/15 下午	M2、M3	—	M8 收尾 → M9 情景（scen）	B3b、H4、C1、第 1–3 章	—
10/15 晚	M3 收尾；A5-prep	—	A5 界面（ui）	第 4–5 章	20:00 看 M3
10/16	M4–M7；合并 M8、M9 并接入	对拍修复	A5	C2；第 7–11 章	20:00 砍范围；晚上 A4d、H3、锁定案例答案
10/17	合并 ui；A6；A7	—	—	第 6、12 章和附录；C4；C5	12:00、20:00 检查
10/18	14:00 F1；之后协助队友	—	—	C5 修改；C6；H5；终版构建	20:00 F2；21:00 H6
10/18 的硬要求： 项目书、截图、测试报告和三段文字。TS 引擎做到哪里，状态表就写到哪里，不夸大。

保底：

10/15 14:00 A4-0 还没收敛：剩下的失败断言登记到 tests/vector-disputes.json（注明裁决组号），先跳过，引擎模块照常推进。
10/16 20:00 M5–M7 还没完成：界面截图改用预置结果或 oracle 桥（A5b），图注写"计算结果来自确定性参考实现"；状态表按测试报告如实写。
10/17 20:00 界面仍不可用：改交静态截图，标"界面原型"。
10/18 14:00 代码冻结，这是硬线。
## 四、模型分配与用法【新】
工作	模型	说明
P1、P2、A4-0a、A4-0c 主仓库部分、A4-0d、A5-prep、A4d 脚本、A7、合并与接线	Grok 4.7	写脚本、写规格，都有测试自检
引擎 M1、M2、M4、M7、M8、M9	Grok 4.7	向量已核对过，失败表直接指出错在哪
引擎 M3、M5、M6	先用 Grok 4.7，按升级规则换 Opus 5.5	规则最密的三块
oracle 窗口的全部工作	GPT-5.6 sol	和写 B2 的是同一个模型，参考实现前后一致
A4-0b 裁决、A4d 差异裁决	Claude Opus 5.5	和 oracle（GPT）、引擎（Grok）都不是同一家
A5 界面、A6 自然语言	Grok 4.7	—
项目书	见第十节	—
预计用量：Opus 4–7 个对话，GPT 3–4 个，其余都用 Grok。

升级规则： Grok 在同一个模块里，连续两轮"改代码 → pnpm vec"之后失败数都没下降，就让它停下，写 .cache/handoff/<模块>.md。然后开一个 Opus 新对话，只修还失败的部分。修完回到 Grok 做下一个模块。

裁决要独立： 如果 A2、A3d 当时就是用 Opus 写的，A4-0b 改用 Grok 4.7（选最高推理档），Opus 只复核其中的 T、S 组。

省额度的做法：

每一步、每个模块都开新对话，结束就关。
不让代理通读 rules.md（135 KB）、traceability.csv 或整批向量文件。给它看规格切片（15–40 KB），跑 pnpm vec 看紧凑的失败表。
MAX 模式只在 Opus 裁决时开。
Plan Mode 只在 M3、M5、M6 开头各用一次。
不用云端代理。
怎么用代理：

每一步在 Agent 面板新建对话：先选模型，再粘贴提示词。
同一个文件夹同一时间只跑一个代理。要并行，就用工作树开另一个 Cursor 窗口。
代理中途停下时，回复："继续，从第 n 步开始，已完成的不要重做。"
每天结束前在主窗口终端运行 git pull --rebase 和 git push。你和队友改的路径不重叠，rebase 不会冲突。
pnpm 会把脚本名后面的参数直接传给脚本，所以本文写作 pnpm vec --module M3，中间不加 --。
## 九、界面、自然语言与端到端（A5–A7）
A5-prep 演示流程和预置结果【新】（主窗口，Grok，10/15 晚上）
text
@docs/policy_card.md（第八节"演示点—案例对照表"）@src/engine/ops.ts @src/engine/schema.ts
1. 把对照表的每一行写成 fixtures/flows/<两位序号>_<案例>_<要点>.json：{flow_id, case, title, demo_point, ops[], screenshots[]}。ops 按 ops.schema 填全参数（金额为分，时刻带 +08:00）；写"载入"的行，ops 为空；"nl_script 回放"那一行标 nl:true，ops 为空。screenshots 列出该流程要截图的步骤号和页面（目标/费用/资金日历/调整）。
2. 新建 scripts/make-mocks.ts（脚本 mocks）：对每个流程的每个前缀 ops[0..k]（k 从 0 到 n），用 runOracleOne 计算结果，写到 fixtures/mock/<flow_id>/<k>.json（toWire 形式，含全部检查点）；写 fixtures/mock/index.json（flow_id → case、步数）。
3. tests/unit/flows.test.ts：每个流程的 ops 通过 opsSchema，引用的 case 文件存在。
4. 运行 pnpm mocks，pnpm check 通过后提交。

A5 四页界面【改】（ui 工作树，Grok）
text
@AGENTS.md @.cursor/rules/ui.mdc @docs/policy_card.md（第四节"界面必须分开显示的金额"、第八节页面结构与对照表）@docs/rules.md（§11、§12.5、§12.7）@src/engine/result.ts @fixtures/mock/index.json
在分支 ui 的工作树里实现四页界面，不新增页面，只改 AGENTS.md §5 允许的路径。
- 数据：src/ui/engineAdapter.ts 提供 async evaluate(caseData, ops)，有三种模式，顶栏可切换，默认 auto：
  - ts：调用 src/engine/evaluate；doneModules 不含 M7 或调用抛错时视为不可用；
  - mock：从 fixtures/mock/<flow_id>/<k>.json 取该流程前 k 步的结果；ops 不是任何流程的前缀时，提示"预设流程之外的操作需引擎完成后可用"；
  - bridge：POST /api/engine（后备，主线另行实现）。
  auto：ts 可用就用 ts，否则用 mock。非 ts 模式在顶栏显示角标"预置结果"或"参考实现"。
- zustand store 保存 caseData、ops[] 和当前模式；每次操作只追加一个 Op，再调用 evaluate。
- 顶栏常驻：案例切换（fixtures/cases 全部案例）、"演示流程"下拉（fixtures/flows，选中后用"下一步"逐条执行其 ops）、模拟日期 as_of、"模拟数据"徽标、input_version、"DEMO-CFG-1｜K=3（演示配置v1）"。
- 目标页：自然语言输入区（接口先留空，A6 接入）、已提取字段及确认状态（user_confirmations，NEEDS_RECONFIRM 显示"需重新确认"）、预算 B、当前现金、各项预留、本目标可用金额 G、付款空间 H。
- 费用页：全成本清单；金额状态分色（已确认/估算/待填/确认免费/不适用）；已付与后续付款分开；"范围前已付，仅计入成本"；价格依据类型标签；机动预留单列，不计入预计消费净支出。
- 资金日历页：ECharts 时间轴，显示各节点现金和受保护部分，标出购买日和付款日（D53，不做独立的购买日历组件）；最早缺口卡片（日期、类型、金额＝该节点 -U、相关项目、计算依据；保护性资金缺口分两项列出，见 D34），可展开缺口列表，含"缺口延续"；约束问题（预算超限、分配冲突、冲突延续）单独列出；行动清单；每日参考卡片（§11.4 文案，以及"按当前输入和假设测算，不是资金安全保证"）。未确认方案时同时显示"草案预览"和"预览，未确认"（D62）。
- 调整页：只提供 D29 白名单操作，每个操作生成一个 Op；Top-K 列表（比较范围，已评估/待确认/排除计数，排除原因，"同价"，"若到账"）；确认面板（"建议分配额（不减少今日可额外支出）"、分配差额、"届时由未分配资金支付"）；暂停/取消面板（已付、可能退款及条件、不可退费用、仍有效义务）。
- 页面不做任何金额计算，金额只用 formatCents（没有就先在 src/ui/format.ts 写一个同名函数）；状态文案严格取自 §11；依赖预计收入或估算的结论旁列出依赖条件；简体中文；390×844 的手机框在桌面上居中。
完成后用 Playwright 做冒烟测试：每个案例、每个流程的每一步、四个页面都能打开，无控制台错误，无 NaN，无英文占位，每页都有"模拟数据"。pnpm check 通过后提交到 ui 分支，不合并。

10/17 上午在主窗口合并：

text
把 ui 分支合并到 main。engineAdapter 的 auto 模式在 doneModules 含 M7 时使用 ts。修好类型错误，用内置浏览器逐个案例、逐页检查，运行 pnpm check。

A5b oracle 桥【新】（只在 10/17 12:00 引擎仍未就绪时做，Grok）
text
在 vite.config.ts 增加开发服务器和预览服务器的中间件 POST /api/engine：读取 {case, ops}，调用 scripts/lib/oracle-run.ts 的 runOracleOne，返回结果 JSON；出错时返回 500 和错误首行。界面在 bridge 模式显示"参考实现计算"角标。pnpm check 通过后提交。

A6 自然语言模块（Grok，10/17）
沿用上一版 A6 提示词，改三处：

第 3 条"金额解析为整数分后须等于……"改为"须等于 moneyPaths() 所列路径上某个 Money 的 value"。
第 7 条的测试写在 tests/unit/nl.test.ts，测试名以测试编号开头（T015-01/02/08/09、T013-04 的自然语言部分），不用 doneModules。
开始前你先到 poe.com/api_key 生成密钥，在仓库根目录建 .env，写入 POE_API_KEY 和 POE_MODEL。live 模式只跑 3 次，用于录制回放和统计调用量。
A7 端到端、截图、测试报告（Grok，10/17）
沿用上一版 A7 提示词，改以下各条：

e2e 改为按 fixtures/flows 生成：每个流程一个 spec，另外覆盖 test_layers.md 中所有 UI 层的行。
截图按各流程 screenshots 字段指定的步骤和页面拍。
export:results：doneModules 含 M1–M7 时用 TS 引擎，否则用 runOracleOne。每个 book/data/<case>.json 写 meta.engine（ts 或 oracle-reference）。项目书构建时，meta.engine 为 oracle-reference 的图表，图注自动加"计算结果来自确定性参考实现"。
test:report 增加：各模块 pnpm vec 的通过数、A4-0 预检汇总、oracle 单元核对结果、diff:oracle 汇总。
trace:update 的状态规则：
"通过（commit xxxxxxx，日期）"：该行的全部 TS 向量通过且没有登记跳过；该行的 vector_gaps 条目全部是"已裁决"，或"已覆盖"且对应单元测试通过；该行的 UI、NL、DOC 层也通过。
"部分覆盖（commit，日期；见 vector_gaps）"：已执行的部分全部通过，但还有 gap 没覆盖。
"已执行未通过"：有任何失败。
"待执行"：什么都没执行。
参考实现的通过不计入。
十、外部资料与项目书（队友）【改】
现状： 队友进度为 0。项目书要在 4 天里从零写到 40 页左右，是整个计划里最大的进度风险。

队友明早上手（9:00 前，约 1 小时）：

接受 GitHub 邀请，git clone，用 Cursor 打开，运行 pnpm install。
安装 Python 3.11+，运行 python -m pip install matplotlib python-docx pypdf trafilatura rapidfuzz pdfminer.six；安装 LibreOffice 和 Noto Sans SC、Noto Serif SC 字体。
读 .cursor/rules/book.mdc 和 AGENTS.md §5（项目书能改哪些路径）。
每次提交前先 git pull --rebase。
日期	队友	第三人（如有）
10/15	C0；B3 第一问；团队亲历；C1；第 1–3 章	B3 第二问、B3b、H4；决定做问卷的话，B4 当天发出
10/16	C2 流程图和架构图；第 4–5、7–11 章	回收问卷；核对资料
10/17	第 6、12 章和附录；C4 首次构建；C5 评委模拟	通读初稿，标出 AI 腔
10/18	C5 修改；C6；H5；18:00 终版构建	做 F2 检查，陪队长一起 H6
提示词： B3、B3b、B4、C1–C6 沿用上一版，改两处。

C1 在上一版追加段之后再加一句："第 6 章增加'两套独立实现交叉核对'一节：测试向量由规格翻译而来，Python 参考实现独立计算，两者先预检、再对拍，数字取自 book/data/status.json。"
C3 中第 4–6 章需要的数字一律写成占位符 <!-- data: … -->，10/17 构建时由 export:results 的结果填入，不要从 fixtures/mock 里抄。
队友的模型安排（用自己的账号也照此办）：

B3 联网研究、C5 评委模拟、C6 提交文字：用 Poe。评委模拟用两个和正文写作不同的模型。
其余：Cursor 里的 Grok 4.7。
摘要、第 4 章、第 5 章写完后，各用 Opus 精修一次，只此三次。
十一、冻结与提交
F1 代码冻结（你，10/18 14:00）【改】
text
代码冻结，不改 src/ 下的任何逻辑。依次运行：pnpm check:all、pnpm vec --all、pnpm diff:oracle、pnpm test:e2e、pnpm export:results、pnpm test:report、pnpm trace:update。把每条命令的退出码和关键计数写入 docs/_work/freeze_report.md，附上 commit 哈希、doneModules，以及 export:results 实际用的引擎（ts 或参考实现）。任何一条失败就停下，汇报失败原因和最小修复建议，不要自行修复。全部通过后，用 pandoc 把 docs/policy_card.md 转成 docs/policy_card_v2.1.docx，提交 "chore: submit freeze"。

完成后你打 tag submit-freeze，并通知队友拉取、重建项目书。F2、H5、H6 照上一版执行。提交后不能替换附件，所以三个人必须各自通读一遍 PDF 再交。



## 十一、常见失控与处理【改】
现象	处理
终端报 '&&' is not a valid statement separator	改用 pnpm check 这类 npm 脚本，或切到 PowerShell 7
JSON 或 golden 校验出现乱码、哈希对不上	检查是否有文件被 PowerShell 写成了 UTF-16：让代理用 Node 重写为 UTF-8 后重新冻结
代理改向量的 expect，或整条跳过向量	golden:check 和 vector-disputes 的计数会暴露。回滚 checkpoint，重申 AGENTS.md §3
spec:lint 报"待团队裁决"	正常现象，不阻塞 check，留到当天 H-SG 处理
云端代理找不到 python	scripts/lib/py.ts 在 Linux 上会改用 python3；仍不行就设环境变量 PYTHON
oracle 和 TS 在 §10.4 节点判定上大面积不一致	先对 T006-04 和 §10.7 例 1 单独对拍，裁决这一处后再重跑
mermaid 渲染报找不到浏览器	用 E0 生成的 puppeteer-config.json 指向 Playwright 下载的 chromium
Node 25 下某个依赖报错	用 nvm-windows 切到 Node 22 LTS，重新运行 pnpm install
10/18 晚上发现项目书有错	只要还没提交就能改。所以提交前三人必须各自通读一遍 PDF
截止当天网站拥堵	10/18 22:00 前提交，10/19 只用于重试

## 四、以后怎么避免
oracle 窗口只能看到它自己工作区里的文件。发给它的提示词只能引用那些文件，需要传过去的内容先写成文件，再随 pnpm oracle:export 带过去。
发任何提示词之前，先按 Ctrl+F 搜一下 {{。这次给的提示词都没有占位符，轮次之间也不用改。以后如果还有要按情况填写的内容，我会改成让主窗口代理生成完整的提示词文件，你直接整份复制。

## A6 基准提示词
text
@AGENTS.md @docs/rules.md（R015、D30、D32、D52、D60）@src/engine/schema.ts @src/engine/money.ts @src/engine/result.ts @src/ui @fixtures/cases/cB_topk.json @docs/_work/book_notes.md @docs/_work/test_layers.md
实现 src/nl（自然语言辅助）。开始前人工已在仓库根目录建好 .env（POE_API_KEY、POE_MODEL）；不要读取或打印 .env 的值。
1. extract(text)：只输出 D30 的 13 个字段，zod 校验；每个字段带 source_span；原文未提及的为 null，不得猜测；所有值都是"待确认值"，用户确认前不进入 evaluate 的输入。
2. nextQuestions(state)：按 D30 字段顺序，只问影响当前步骤且仍为 null 的字段，每轮最多 2 问，最多 3 轮，之后改为表单补填（D52）；已确认的字段不再问。
3. explain(result)：模板化中文解释，数字全部从 result 插值。生成后逐句检查：金额解析为整数分后须等于 moneyPaths() 所列路径上某个 Money 的 value，日期统一为 YYYY-MM-DD 后须出现在结果中，百分比和计数不参与匹配；对不上的句子删掉，改用模板句（D32、D52）。
4. 调用层：openai SDK，baseURL https://api.poe.com/v1，模型名取 POE_MODEL。密钥只在服务端读取：在 vite.config.ts 加插件，用 configureServer 和 configurePreviewServer 挂载 /api/nl 中间件，前端拿不到密钥。优先用 JSON Schema 结构化输出，不支持时退回普通对话＋zod 校验。
5. 三种模式：replay（默认，读 fixtures/llm-replay/cB_topk/）、live、off（纯表单，证明去掉 AI 后核心计算仍能完成）。界面顶栏显示当前模式。
6. 用 cB_topk.nl_script 在 live 模式跑 3 次完整主线，取第一次存为回放文件；三次的调用次数和 token 写入 fixtures/llm-replay/usage.json（每次一条，另加平均值，注明模型名、日期、话术版本，口径见 book_notes.md）。live 只跑这 3 次。
7. 测试写在 tests/unit/nl.test.ts，测试名以测试编号开头：replay 模式下 T015-01、T015-02、T015-08、T015-09 的 NL 部分；T013-04 的 NL 部分（AI 回复中的"住宿大约300元"不进入计算，也不出现在解释中）；T013-06 的 NL 部分（重算时不调用大模型重新生成数据）；off 模式完整走通；断言未确认的 LLM 值不会进入 evaluate 的输入。
pnpm check 通过后提交。
待对照现状确认：用户确认后的值怎样进入输入，按现有 schema（confirmations[]、D60）和 D29 白名单决定；界面不得使用 PATCH（D58）。

## A7 基准提示词
text
@AGENTS.md @tests/e2e @fixtures/cases @fixtures/flows @docs/policy_card.md（第八节对照表）@docs/_work/test_layers.md @docs/traceability.csv
1. 用 Playwright 写 tests/e2e/：每个 fixtures/flows 流程一个 spec，按流程的 ops 逐步操作界面，并检查对照表"应看到的结果"；另外覆盖 test_layers.md 中所有 UI 层的行（注释写测试编号）。至少包括：主线（cB_topk，回放模式：自然语言→澄清→费用→比较→确认→行动清单→收入延期→缺口出现、每日参考显示"当前不建议新增非计划支出"、已确认策略未被自动修改）；案例 A（最早缺口、预计收入不能提前填补、新增生活支出后重算、改分配额出现分配冲突）；c00（每日参考 100 元，记 40 元后为 60 元）；全部变体。package.json 的 test:e2e 指向 playwright test。
2. 按各流程 screenshots 字段指定的步骤和页面截图，存到 book/figures/screens/（视口 390×844，deviceScaleFactor 2，文件名含流程编号和步骤号），并生成 book/figures/screens/index.md（文件名｜画面说明｜案例｜步骤）。
3. scripts/export-results.ts（脚本 export:results）：doneModules 含 M1—M7 时用 TS 引擎，否则用 runOracleOne；每个案例写 book/data/<case>.json，结构为 {meta, result}，result 为 toWire 形式，meta.engine 为 ts 或 oracle-reference。meta.engine 为 oracle-reference 的数据，项目书构建时图注自动加"计算结果来自确定性参考实现"。
4. scripts/test-report.ts（脚本 test:report）：汇总 vitest（含向量通过和跳过数）、playwright、各模块 pnpm vec 的通过数、A4-0 预检汇总、oracle 单元核对结果、diff:oracle 汇总，以及 doc:lint（有结果文件时）。生成 book/chapters/91_appendix_test_report.md：按规则编号列测试数、通过、失败、未执行、跳过；另附"功能实现状态表"（规则已确认／已实现／测试通过／真实用户验证四级），同时输出 book/data/status.json 供第 6 章引用。注明 commit 哈希和运行时间，并写明"技术测试结果，不代表需求成立或用户效果"。
5. scripts/trace-update.ts（脚本 trace:update）更新 traceability.csv 的"状态"列：
   - "通过（commit xxxxxxx，日期）"：该行全部 TS 向量通过且没有登记跳过；该行的 vector_gaps 条目全部为"已裁决"，或为"已覆盖"且对应单元测试通过；该行的 UI、NL、DOC 层也通过；
   - "部分覆盖（commit，日期；见 vector_gaps）"：已执行的部分全部通过，但还有 gap 没覆盖；
   - "已执行未通过"：有任何失败；
   - "待执行"：什么都没执行。
   参考实现的通过不计入；不得手写"通过"。
6. 运行全部测试和脚本，提交。



## 第九部分 前端补充（美观、易用与月历视图）

### 9.1 不变的约束
- 只有四页（目标、费用、资金日历、调整），不新增页面。
- 页面只展示 evaluate() 的结果，不对金额做加减乘除；金额统一用 formatCents。
- 状态标题只用 rules.md §11 原文；"模拟数据"标识始终可见。
- 界面只提供 D29 白名单操作和流程操作，不出现 PATCH（D58）。
- 行动清单不另做购买日历组件（D53）；月历是资金日历页的另一种视图，由 H-SG5 写进规格。
- ui 分支只能改 AGENTS.md §5 列出的路径；新增依赖要在 main 上由人工安装，再合并进 ui。

### 9.2 方法
1. 规格先行：Opus 写 docs/_work/ui_design.md，并做两个视觉方向的单文件 HTML 原型，团队二选一。
2. 组件先行：先做令牌、布局和通用组件，再做页面和月历。
3. 截图自查后，由另一家的模型评审：Grok 截图，Opus 写 ui_review.md，Grok 修 P1、P2，最多两轮。
4. 测试锚点：data-testid、data-verdict、data-marks；截图时关闭动画。

### 9.3 砍范围顺序（时间不够时从上往下砍）
1. 第二轮视觉评审；
2. 曲线视图的精修（保留基本折线）；
3. 月份切换动画、日格悬停效果；
4. 日详情面板中的依据展开（保留节点列表和余额）。
不砍：月历日格的判定样式和标记、四页基本内容、模拟数据标识、项目书需要的截图。

### 9.4 需要团队确认的前端问题
1. 月历日格显示哪项金额：A 当天最后一个节点的未分配 U；B 付款空间 H。推荐 A。
2. 顶栏：A 手机框内只放"模拟数据"徽标、as_of、版本角标，案例切换、演示流程、数据模式、"下一步"放在手机框外的演示控制台（窄屏时收进抽屉）；B 维持 ui.mdc 原文，全部放在框内顶栏。推荐 A。
3. 图标：A 在 main 上引入 lucide-react；B 手写内联 SVG。推荐 A。
4. 资金日历页的默认视图：A 月历；B 曲线。推荐 A。
5. 底部声明"比赛原型，使用模拟数据，非银行正式产品"：A 加；B 不加。推荐 A。
6. 视觉方向：看过两个原型后选定。

### 9.5 基准提示词

#### H-SG5 规格裁决
```text
团队裁决 H-SG5（前端）：按 docs/_work/plan_a5_a7.md"团队决定"一节执行。只改 docs/rules.md、docs/_work/spec_gaps.md、docs/policy_card.md 第八节"资金日历页"那一句、.cursor/rules/ui.mdc；不改代码、向量和 traceability 预期。
1. rules.md §8.8 末尾新增"资金日历的月历视图"条目。编号取 §8.8 现有最大 D 编号加 1（下称"新条目"）；同步更新 §8.8 标题、§9.9、§10 引言中的编号范围；条目末尾标"DEMO-CFG-1｜依 SG 裁决"，SG 编号取 spec_gaps.md 现有最大编号加 1。内容：
   - 资金日历页提供"月历"和"曲线"两种视图，展示同一份计算结果的同一条时间轴；默认视图按团队决定。
   - 月历按自然月、周一开头，覆盖检查期间所在的各月；as_of 当日标"今天"；检查期间之外的日期淡化；演出日单独标记。
   - 日格标出当日的收入（预计与实际区分）、购买日、付款日、生活支出和机动预留释放。当日有节点时，按团队决定显示当日最后一个节点的那项金额。当日判定取最严重者，次序为保护性资金缺口＝付款缺口＞分配冲突＞缺口延续＞冲突延续＞通过；颜色之外同时用图标和文字区分。
   - 点开日格显示当日各节点（按 §10.2 的顺序，流出组标"同日先后未知"）、各项余额和计算依据（D34）。
   - 月历是资金日历时间轴的另一种展示，不是 D53 所说的独立购买日历组件，不新增页面；购买日与付款日在两种视图中都要标出。
   - 页面上的金额只取自计算结果或当前已应用操作的输入，不做加减乘除。
2. 在 D53 末尾补一句"（月历视图见 D 编号）"，其中 D 编号写新条目的实际编号。spec_gaps.md 新增一行，状态写"已裁决（新条目的实际编号）。DEMO-CFG-1 新规则"。
3. policy_card.md 第八节"资金日历页"那一句末尾补"（月历与曲线两种视图，见 rules.md 新条目）"，括号里的"新条目"写成实际编号。
4. .cursor/rules/ui.mdc：顶栏一条按团队决定改写；新增四条：资金日历页含月历与曲线两种视图；页面只做选择、分组、排序和格式化，不对金额做加减乘除；状态不只靠颜色，同时有图标和文字；颜色、字号、间距只用 docs/_work/ui_design.md 中的令牌。
5. pnpm check:all 通过后提交 "spec: H-SG5 calendar view"。汇报新条目编号和改动的文件。提交后由人工运行 pnpm oracle:export 和 pnpm oracle:import 刷新指纹（参考实现无需改代码）。
```

#### A5-design 设计规格与视觉方向（Opus）
```text
@AGENTS.md @.cursor/rules/ui.mdc @docs/policy_card.md（第四节"界面必须分开显示的金额"、第八节页面结构与对照表）@src/engine/result.ts @src/engine/enums.ts @src/engine/ops.ts
目标：为四页 Demo 写前端设计规格，并做两个视觉方向的静态原型供团队二选一。只新建 docs/_work/ui_design.md 和 docs/_work/ui_mock/ 下的文件，不改其他文件。规则只打开 docs/rules.md 的 §9.2、§11、§12.5、§12.7 和 §8.8 中的月历视图条目，不通读全文。
一、ui_design.md 包括：
1. 设计原则（不超过 6 条）：结论先行（每页顶部是状态卡）；保护性预留始终可见；每个金额都能点开看计算依据；状态不只靠颜色；数字清楚（等宽数字、formatCents）；模拟数据标识始终可见。
2. 设计令牌：中性色阶、主色、语义色（通过、缺口、约束问题、缺口延续、预计与估算、模拟数据）、字号阶梯、4/8 间距、圆角、阴影，写成 Tailwind v4 的 @theme 变量清单；语义色必须与主色能区分。
3. 布局：390×844 手机框、底部标签栏（目标／费用／日历／调整）、顶栏与演示控制台（按 docs/_work/plan_a5_a7.md"团队决定"）、窄屏时的收纳方式。
4. 组件清单：每个写用途、属性、加载／空／错误状态、对应的 ResultCore 字段。至少包括状态卡、金额行（带"依据"入口）、依据抽屉（余额用 §9.2 中文名，符号小字；D34 两项依据）、缺口卡、候选卡（排名、同价、若到账、排除原因）、行动清单项、每日参考卡、依赖条件列表、操作表单（只含 ops.ts 的 UI_OP_TYPES）、月历、日详情面板、资金曲线。
5. 四页 ASCII 线框图，标出组件和数据来源字段。
6. 月历规格：按月历视图条目写清月份范围和默认月份、日格内容及其优先级、日详情面板、图例；每项数据写到字段路径；金额只取自结果或已应用操作的输入。
7. 文案：状态标题只用 §11 原文，说明句可用 §11.5；术语对照；禁用词与 .cursor/rules/book.mdc 一致；底部声明按团队决定。
8. 可访问性与截图：对比度、正文 14px、最小 12px、触控目标 44px；截图时关闭动画；data-testid 命名规则（如 cal-day-YYYY-MM-DD，带 data-verdict、data-marks）。
9. 依赖：按团队决定写明图标方案。
二、docs/_work/ui_mock/direction-a.html、direction-b.html：单文件 HTML，内联 CSS，不联网，只用系统字体栈（PingFang SC、Microsoft YaHei、Noto Sans SC）。内容都是资金日历页，月历显示 2026 年 9 月，数据为 cA_gap 选中 C01 后的计算结果：doneModules 含 M7 时，在 .cache/ 下写临时 tsx 脚本用 TS evaluate 计算；否则取 fixtures/mock 中对应流程的结果；两者都没有时用示意数据，并在页面角标"示意"。方向 A 稳重（白底、细线卡片、主色点缀），方向 B 清新（浅暖底、圆角大卡、柔和主色）；两份的语义色相同。
三、汇报（不超过 200 字）：两个方向各一句话的差别；仍需团队决定的事项。
```

#### A5-cal 月历视图（Grok，ui 工作树）
```text
@AGENTS.md @.cursor/rules/ui.mdc @docs/_work/ui_design.md @src/engine/result.ts @src/engine/evaluate.ts
目标：在资金日历页实现月历视图（rules.md §8.8 月历视图条目、ui_design.md 月历规格）。只改 AGENTS.md §5 允许 ui 分支改的路径；不改 src/engine/，不打开 oracle/。
1. src/ui/calendar/model.ts：buildCalendarModel(result, appliedCase) 返回月份数组；每月为周一开头的周数组；每天含 date、inCheckPeriod、isToday、isShowDay、marks、verdict（当日最严重者，次序见规格）、dayEndAmount（原样引用当日最后一个节点的 Money，字段按团队决定）、nodeIndexes。日期按字符串前 10 位处理，星期用不依赖时区的纯函数计算，不调用无参 new Date()。只做选择、分组、排序，不对任何金额做加减乘除。
2. 数据来源：节点与判定取 result.nodes、earliest_gap、gap_list、constraint_issues；检查期间取 check_period；购买日取 action_list[].purchase_date；付款日与付款金额取 cost.future_payments、cost.paid_payments；事件名称、收入金额、预计或实际取已应用操作的输入（引擎导出函数的名称见 docs/_work/plan_a5_a7.md 现状核对一节）。数据模式不是 ts 时，收入金额不显示，只显示标记。
3. 组件：MonthCalendar（默认显示最早缺口所在月，没有缺口时显示 as_of 所在月）、DayCell、DayDetailSheet（当日节点按顺序列出，流出组标"同日先后未知"，余额与依据按 D34 分两项）、CalendarLegend。资金日历页顶部做"月历｜曲线"切换，默认视图按团队决定；原时间轴曲线保留在"曲线"。
4. 测试：tests/unit/calendar-model.test.ts 用 TS evaluate 对 fixtures/flows 中 cA_gap、cB_topk 的流程计算结果作输入，断言每个显示的金额都与结果或输入中某个金额逐分相同（不得出现派生数字）、缺口日与 gap_list 一致、月份范围和周一开头正确、as_of 高亮正确、同日多节点取最严重判定。tests/e2e/calendar.spec.ts 断言：cA_gap 选 C01 后，最早缺口日带对应的 data-verdict；购买日、付款日带 data-marks；点开日格能看到计算依据；页面上没有名为"购买日历"的独立组件或页面（T017-09 的 UI 部分）。
5. 用内置浏览器打开资金日历页，按 ui_design.md 的截图要求自查，修到没有溢出和截断。
pnpm check 和 pnpm test:e2e 通过后提交到 ui 分支。汇报不超过 200 字。
```

#### A5-review 视觉评审（Opus，对话里附截图）
```text
@docs/_work/ui_design.md
你是移动金融产品的界面评审。依据 ui_design.md 和我附上的截图（来自 .cache/ui_review/），找出最影响观感和易用性的问题。只写 docs/_work/ui_review.md，不改代码。每条写：页面｜看到的问题｜为什么影响用户或评委｜改法（具体到组件、间距、字号、颜色令牌或文案）｜优先级（P1 必改／P2 应改／P3 可选），最多 20 条，按优先级排序。另单列两项：与 ui_design.md 不一致之处；可能让评委误以为"已接入银行系统"或"资金已经充足"的画面。
```
