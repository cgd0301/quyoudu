/**
 * pnpm figures
 *
 * 由 book/data 下的正式导出结果生成项目书图表（SVG，无新增依赖）。
 * 输出：book/figures/<名字>.svg 与 book/figures/index.md（图名、数据来源、口径）。
 *
 * 约定：数值图的每个数字都来自 book/data 的引擎导出；架构与流程图的框线只画当前仓库真实存在的模块。
 * 同一输入重复运行结果逐字节相同（不读系统时钟、不排序随机、不用浮点格式化差异）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { FIGURES_DIR } from './lib/book.ts'
import { formatCents } from '../src/engine/money/format.ts'
import { readJson, repoPath, writeFileAtomic } from './lib/repo.ts'

const W = 1000
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#cbd5e1'
const ACCENT = '#1d4ed8'
const WARN = '#b45309'
const BAD = '#b91c1c'
const OK = '#047857'
const FILL = '#f8fafc'

type Money = { value: number; basis?: { rules?: string[]; event_ids?: unknown; reserve_ids?: unknown } }
type Node = {
  at: string
  cash: Money
  living_reserve: Money
  contingency_reserve: Money
  other_protected_reserve: Money
  other_goal_hold: Money
  goal_available: Money
  goal_allocation: Money
  unallocated: Money
  node_verdict: string
  trigger: { kind: string; event_ids: string[] }
  related: string[]
  protected_over_cash: Money | null
  allocation_unsupported: Money | null
}
type Result = Record<string, unknown> & {
  nodes: Node[]
  snapshot: Record<string, Money>
  cost: {
    paid_total: Money
    future_payable: Money
    eligible_return: Money
    net_spend: Money
    future_payments: { amount: Money; cost_item_id: string; at: string; event_id: string }[]
    paid_payments: { amount: Money; cost_item_id?: string }[]
    protected_reserves: Record<string, Money>
    budget_overrun: Money | null
    possible_refund: { amount: Money; condition?: string } | null
  }
  candidates: {
    candidate_id: string
    feasible: boolean
    evaluable: boolean
    net_spend: Money | null
    rank: number | null
    tie_group: number | null
    excluded_reasons: { code: string; refs: string[]; rule: string }[]
    pending_reasons: { code: string }[]
  }[]
  optimization: { evaluated_count: number; excluded_count: number; pending_count: number; scope: string[]; top_k: number }
  earliest_gap: { at: string; node_index: number; node_verdict: string; amount: Money; related: string[] } | null
  gap_list: { node_index: number; node_verdict: string; at: string; amount: Money }[]
  forecasts: {
    series_id: string
    cost_item_id: string
    purchase_date: string
    status: string
    sample_count: number
    history_end: string
    horizon: number
    predicted: string | null
    amount: Money | null
    backtest_count: number
    backtest_mae: string | null
    baseline_mae: string | null
    train_sse: string | null
    alpha: string | null
    beta: string | null
    phi: string | null
    confirmed: boolean
  }[]
  scenarios: {
    kind: string
    unavailable_reason: string | null
    groups: { category: string; group_total: Money; listed_total: Money; increment_total: Money }[]
    daily_reference: Money | null
  }[]
  action_list: { task_id: string; amount: Money | null; purchase_date: string; payment_at: string; cost_item_id: string }[]
  daily_reference: { display: string; amount?: Money | null; label?: string | null; limited_by?: { scenario: string | null } | null }
  states: { plan_state: string; optimization_state: string; confirmation_state: string }
  check_period: { start: string; end: string | null }
  labels: string[]
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function rect(x: number, y: number, w: number, h: number, fill = FILL, stroke = LINE, rx = 6): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`
}

function label(x: number, y: number, content: string, size = 13, anchor: 'start' | 'middle' | 'end' = 'start', weight = 'normal', color = INK): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif" text-anchor="${anchor}" font-weight="${weight}" fill="${color}">${esc(content)}</text>`
}

function line(x1: number, y1: number, x2: number, y2: number, color = LINE, width = 1.2): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`
}

function arrow(x1: number, y1: number, x2: number, y2: number, color = MUTED): string {
  return `${line(x1, y1, x2, y2, color, 1.4)}<polygon points="${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}" fill="${color}"/>`
}

function frame(title: string, subtitle: string, body: string, height = 560): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}">`,
    rect(0, 0, W, height, '#ffffff', '#ffffff', 0),
    label(40, 46, title, 22, 'start', 'bold'),
    label(40, 72, subtitle, 13, 'start', 'normal', MUTED),
    body,
    label(40, height - 16, '模拟数据｜数据来源见 book/figures/index.md', 11, 'start', 'normal', MUTED),
    '</svg>',
    '',
  ].join('\n')
}

function money(value: number): string {
  return `${formatCents(value)} 元`
}

function loadResult(relative: string, checkpoint = -1): Result {
  const data = readJson<{ checkpoints: { label: string; result: Result }[] }>(repoPath('book/data', relative))
  const index = checkpoint < 0 ? data.checkpoints.length + checkpoint : checkpoint
  const chosen = data.checkpoints[index]
  if (chosen === undefined) throw new Error(`${relative} 没有第 ${index + 1} 个检查点`)
  return chosen.result
}

function barChart(input: {
  x: number
  y: number
  width: number
  height: number
  values: { label: string; value: number; color?: string; note?: string }[]
  unit?: string
}): string {
  const max = Math.max(1, ...input.values.map((item) => item.value))
  const slot = input.width / input.values.length
  const barW = Math.min(64, slot * 0.6)
  const parts: string[] = []
  parts.push(line(input.x, input.y + input.height, input.x + input.width, input.y + input.height, LINE, 1.4))
  parts.push(line(input.x, input.y, input.x, input.y + input.height, LINE, 1.4))
  input.values.forEach((item, index) => {
    const h = Math.round((item.value / max) * (input.height - 26))
    const cx = input.x + slot * index + slot / 2
    const top = input.y + input.height - h
    parts.push(rect(cx - barW / 2, top, barW, h, item.color ?? ACCENT, item.color ?? ACCENT, 3))
    parts.push(label(cx, top - 6, formatCents(item.value), 11, 'middle', 'bold'))
    parts.push(label(cx, input.y + input.height + 18, item.label, 11, 'middle'))
    if (item.note !== undefined) parts.push(label(cx, input.y + input.height + 34, item.note, 10, 'middle', 'normal', MUTED))
  })
  parts.push(label(input.x - 8, input.y + 10, input.unit ?? '分', 10, 'end', 'normal', MUTED))
  return parts.join('\n')
}

function table(input: { x: number; y: number; columns: { title: string; width: number }[]; rows: string[][]; rowHeight?: number }): string {
  const rowHeight = input.rowHeight ?? 26
  const parts: string[] = []
  let cursor = input.x
  for (const column of input.columns) {
    parts.push(rect(cursor, input.y, column.width, rowHeight, '#e2e8f0', LINE, 3))
    parts.push(label(cursor + 8, input.y + 18, column.title, 12, 'start', 'bold'))
    cursor += column.width
  }
  input.rows.forEach((row, rowIndex) => {
    cursor = input.x
    const top = input.y + rowHeight * (rowIndex + 1)
    row.forEach((cell, cellIndex) => {
      const column = input.columns[cellIndex]
      if (column === undefined) return
      parts.push(rect(cursor, top, column.width, rowHeight, rowIndex % 2 === 0 ? '#ffffff' : FILL, LINE, 0))
      parts.push(label(cursor + 8, top + 17, cell, 11))
      cursor += column.width
    })
  })
  return parts.join('\n')
}

type Figure = { name: string; title: string; sources: string[]; note: string; text: string }

function architecture(): Figure {
  const layers = [
    { title: '输入层', items: ['CaseFile（rules.md §12.2）', 'Op 白名单（D29）', '演示流程 fixtures/flows'] },
    { title: '确定性引擎 src/engine', items: ['normalize / snapshot / states', 'timeline / cost / pricing', 'compare / confirm / daily', 'scenarios / holt'] },
    { title: '结果契约 ResultCore', items: ['24 个一级字段', '金额一律整数分', 'toWire → snake_case'] },
    { title: '交付层', items: ['四页界面（已合入主线）', 'book/data 导出', '图表与项目书'] },
  ]
  const parts: string[] = []
  layers.forEach((layer, index) => {
    const x = 40 + index * 235
    parts.push(rect(x, 120, 215, 250, index === 1 ? '#eff6ff' : FILL, index === 1 ? ACCENT : LINE))
    parts.push(label(x + 108, 148, layer.title, 14, 'middle', 'bold', index === 1 ? ACCENT : INK))
    layer.items.forEach((item, itemIndex) => parts.push(label(x + 16, 180 + itemIndex * 26, item, 11)))
    if (index < layers.length - 1) parts.push(arrow(x + 215, 245, x + 235, 245))
  })
  parts.push(label(40, 415, '引擎只用确定性代码：无 Date.now、无随机数、无网络；模型输出（src/nl）只能成为待确认值，不进入计算（AGENTS.md §3）。', 12, 'start', 'normal', MUTED))
  parts.push(label(40, 440, '界面已合入主线：端到端 17 条 spec 通过；UI 层 21 条子用例中 13 条覆盖、3 条部分覆盖、5 条未覆盖。', 12, 'start', 'normal', WARN))
  parts.push(label(40, 462, '界面因此不计为整体通过，逐条分布见附录 B。', 12, 'start', 'normal', WARN))
  return { name: 'fig_architecture', title: '系统总体架构', sources: ['src/engine/'], note: '按仓库现有目录与 rules.md §12 绘制', text: frame('图 1 系统总体架构', '输入 → 确定性引擎 → 结果契约 → 交付层', parts.join('\n')) }
}

function pipeline(): Figure {
  const steps = ['normalize', 'snapshot', 'states', 'timeline', 'cost', 'pricing', 'compare', 'confirm', 'daily', 'scenarios', 'holt']
  const parts: string[] = []
  steps.forEach((step, index) => {
    const col = index % 6
    const row = Math.floor(index / 6)
    const x = 40 + col * 158
    const y = 130 + row * 150
    parts.push(rect(x, y, 140, 92, '#eff6ff', ACCENT))
    parts.push(label(x + 70, y + 40, step, 13, 'middle', 'bold', ACCENT))
    parts.push(label(x + 70, y + 64, `M${Math.min(index + 1, 9)}`, 11, 'middle', 'normal', MUTED))
    if (col < 5 && index < steps.length - 1) parts.push(arrow(x + 140, y + 46, x + 158, y + 46))
  })
  parts.push(label(40, 430, '每个 EVALUATE 生成一个检查点；工程规则：金额整数分、只用 as_of 模拟时钟、排序与状态优先级集中在此（AGENTS.md §3、R013）。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_engine_pipeline', title: '确定性引擎执行流程', sources: ['src/engine/evaluate.ts'], note: '按 evaluate() 的实际调用顺序', text: frame('图 2 确定性引擎执行流程', '一次 evaluate 的模块顺序与检查点', parts.join('\n')) }
}

function dataFlow(): Figure {
  const rows = [
    { title: '受控输入', items: ['fixtures/cases（10 个）', 'fixtures/vectors（152 个）', 'fixtures/flows（14 个）', 'fixtures/llm-replay'] },
    { title: '验证', items: ['evaluate + 向量断言', 'golden:check', 'validate:cases', 'diff:oracle（参考实现）'] },
    { title: '产物', items: ['book/data/cases', 'book/data/flows', 'book/data/status.json', 'docs/traceability.csv'] },
    { title: '文档', items: ['book/figures/*.svg', 'book/chapters/*.md', 'book/build 成稿', 'doc:lint / count:chars'] },
  ]
  const parts: string[] = []
  rows.forEach((row, index) => {
    const y = 116 + index * 108
    parts.push(rect(40, y, 150, 86, '#f1f5f9', LINE))
    parts.push(label(115, y + 48, row.title, 14, 'middle', 'bold'))
    row.items.forEach((item, itemIndex) => {
      const x = 220 + itemIndex * 190
      parts.push(rect(x, y, 176, 86, FILL, LINE))
      parts.push(label(x + 88, y + 48, item, 11, 'middle'))
    })
    if (index < rows.length - 1) parts.push(arrow(490, y + 86, 490, y + 108))
  })
  return { name: 'fig_data_flow', title: '数据流与依赖', sources: ['package.json', 'book/data'], note: '由脚本串联，可整体重跑', text: frame('图 3 数据流与依赖', '受控输入 → 验证 → 数据产物 → 文档', parts.join('\n')) }
}

const COST_ITEM_LABELS: Record<string, string> = {
  TICKET: '门票',
  LODGING: '住宿',
  'TRAIN-OUT': '去程交通',
  'TRAIN-BACK': '返程交通',
  MEALS: '餐饮',
  LOCAL: '本地交通',
  SERVICE_FEE: '服务费',
  OPTIONAL: '自选消费',
}

function costLabel(costItemId: string): string {
  return COST_ITEM_LABELS[costItemId] ?? costItemId
}

function costComposition(): Figure {
  const result = loadResult('flows/01_cB_topk_main.json')
  const byItem = new Map<string, number>()
  for (const payment of result.cost.future_payments) {
    const key = payment.cost_item_id
    byItem.set(key, (byItem.get(key) ?? 0) + payment.amount.value)
  }
  if (byItem.size === 0) byItem.set('NET', result.cost.net_spend.value)
  const values = [...byItem.entries()].map(([key, value]) => ({ label: costLabel(key), value }))
  const parts = [
    barChart({ x: 70, y: 130, width: 860, height: 240, values }),
    label(80, 420, `后续应付 ${money(result.cost.future_payable.value)}；净支出 ${money(result.cost.net_spend.value)}；已付 ${money(result.cost.paid_total.value)}；行动清单 ${result.action_list.length} 项。`, 12),
    label(80, 446, '口径：已确认方案分支中，按费用项目汇总的后续应付（R007、D75）；不含保护性预留与机动预留。', 12, 'start', 'normal', MUTED),
  ]
  return { name: 'fig_cost_composition', title: '费用组成（主线流程）', sources: ['book/data/flows/01_cB_topk_main.json'], note: '按费用项目汇总后续应付', text: frame('图 4 费用组成（主线流程 C02）', '金额为整数分换算的元；模拟报价', parts.join('\n')) }
}

function fundingPartition(): Figure {
  const result = loadResult('cases/c01_base.json')
  const snapshot = result.snapshot
  const items: { label: string; value: number; color: string }[] = [
    { label: '生活预留 L', value: snapshot.living_reserve?.value ?? 0, color: WARN },
    { label: '机动预留 M', value: snapshot.contingency_reserve?.value ?? 0, color: ACCENT },
    { label: '其他保护 O/N', value: (snapshot.other_protected_reserve?.value ?? 0) + (snapshot.other_goal_hold?.value ?? 0), color: '#7c3aed' },
    { label: '本目标分配 A', value: snapshot.goal_allocation?.value ?? 0, color: OK },
    { label: '未分配资金', value: snapshot.unallocated?.value ?? 0, color: MUTED },
  ]
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const parts: string[] = []
  let x = 90
  const width = 820
  for (const item of items) {
    const w = total === 0 ? 0 : Math.round((item.value / total) * width)
    parts.push(rect(x, 150, Math.max(w, 1), 78, item.color, item.color, 2))
    if (w > 70) parts.push(label(x + w / 2, 195, money(item.value), 12, 'middle', 'bold', '#ffffff'))
    x += w
  }
  parts.push(table({
    x: 90,
    y: 270,
    columns: [
      { title: '分区', width: 200 },
      { title: '金额', width: 160 },
      { title: '含义', width: 460 },
    ],
    rows: [
      ['生活预留 L', money(items[0]?.value ?? 0), '挂在预计收入上，覆盖生活支出'],
      ['机动预留 M', money(items[1]?.value ?? 0), '活动结束次日日终释放（D09、D55）'],
      ['其他保护 O/N', money(items[2]?.value ?? 0), '第二目标固定占用与必要保护性预留'],
      ['本目标分配 A', money(items[3]?.value ?? 0), '确认方案后写入的正式分配'],
      ['未分配资金', money(items[4]?.value ?? 0), '只能用未分配资金支付未覆盖支出（D07）'],
    ],
  }))
  return { name: 'fig_funding_partition', title: '资金分区（快照）', sources: ['book/data/cases/c01_base.json'], note: 'C = L + M + O/N + A + 未分配', text: frame('图 5 资金分区（c01 快照）', '现金按规则分成受保护与可用部分', parts.join('\n')) }
}

function cashCurve(): Figure {
  const result = loadResult('flows/01_cB_topk_main.json')
  const nodes = result.nodes
  const points = nodes.map((node) => {
    const g = node.cash.value - node.living_reserve.value - node.other_protected_reserve.value - node.other_goal_hold.value
    const h = g - node.contingency_reserve.value
    const u = h - node.goal_allocation.value
    return { at: node.at.slice(0, 10), u, verdict: node.node_verdict }
  })
  const min = Math.min(0, ...points.map((point) => point.u))
  const max = Math.max(1, ...points.map((point) => point.u))
  const span = max - min
  const left = 90
  const right = 910
  const top = 130
  const bottom = 380
  const xOf = (index: number): number => left + (points.length === 1 ? 0 : (index / (points.length - 1)) * (right - left))
  const yOf = (value: number): number => bottom - ((value - min) / span) * (bottom - top)
  const parts: string[] = []
  parts.push(line(left, yOf(0), right, yOf(0), MUTED, 1.2))
  parts.push(label(left - 8, yOf(0) + 4, 'U=0', 10, 'end', 'normal', MUTED))
  for (const tick of [min, max]) {
    parts.push(line(left, yOf(tick), right, yOf(tick), '#e2e8f0', 1))
    parts.push(label(left - 8, yOf(tick) + 4, formatCents(tick), 10, 'end', 'normal', MUTED))
  }
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(1)},${yOf(point.u).toFixed(1)}`).join(' ')
  parts.push(`<path d="${path}" fill="none" stroke="${ACCENT}" stroke-width="2.2"/>`)
  points.forEach((point, index) => {
    const color = point.verdict === 'PASS' ? OK : point.verdict === 'PROTECTED_SHORTFALL' ? BAD : WARN
    parts.push(`<circle cx="${xOf(index).toFixed(1)}" cy="${yOf(point.u).toFixed(1)}" r="4" fill="${color}"/>`)
    if (index % 2 === 0 || index === points.length - 1) parts.push(label(xOf(index), bottom + 20, point.at.slice(5), 10, 'middle', 'normal', MUTED))
  })
  parts.push(label(left, 430, `U = C − L − N − O − M − A；共 ${points.length} 个节点，最低 U = ${formatCents(min)} 元。红点为保护性资金缺口，黄点为分配冲突。`, 12))
  parts.push(label(left, 456, '口径：由正式引擎的节点金额按 D05 重算；金额单位为元（formatCents），原值为整数分。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_cash_curve', title: '资金节点与 U 曲线', sources: ['book/data/flows/01_cB_topk_main.json'], note: '按 D05、D36 由节点金额重算', text: frame('图 6 资金节点与 U 曲线（主线流程）', '每个事件节点后的可用余额 U', parts.join('\n')) }
}

function earliestGap(): Figure {
  const result = loadResult('flows/04_cA_gap_living.json')
  const gap = result.earliest_gap
  if (gap === null) throw new Error('04_cA_gap_living 没有最早缺口，无法出图')
  const node = result.nodes[gap.node_index]
  if (node === undefined) throw new Error(`最早缺口指向的节点 ${gap.node_index} 不存在`)
  const overCash = node.protected_over_cash?.value ?? 0
  const unsupported = node.allocation_unsupported?.value ?? 0
  const parts = [
    rect(90, 120, 820, 96, '#fef2f2', '#fecaca'),
    label(110, 152, `最早缺口 ${gap.at}｜${gap.node_verdict}`, 16, 'start', 'bold', BAD),
    label(110, 180, `界面金额 ${money(gap.amount.value)}；相关项目 ${gap.related.join('、') || '—'}`, 12),
    rect(90, 250, 390, 120, FILL, LINE),
    label(110, 280, '依据一：保护性预留超出现金', 13, 'start', 'bold'),
    label(110, 308, `L+N+O+M−C = ${money(overCash)}`, 12),
    label(110, 334, `规则 ${(node.protected_over_cash?.basis?.rules ?? []).join('、') || 'D34'}`, 11, 'start', 'normal', MUTED),
    rect(520, 250, 390, 120, FILL, LINE),
    label(540, 280, '依据二：本目标分配无现金支撑', 13, 'start', 'bold'),
    label(540, 308, `A = ${money(unsupported)}`, 12),
    label(540, 334, `两项之和 = ${money(overCash + unsupported)}（D34）`, 11, 'start', 'normal', MUTED),
    label(90, 410, `同组缺口列表共 ${result.gap_list.length} 个节点；缺口列表金额一律取该节点 −U（D35）。`, 12),
    label(90, 436, '口径：由正式引擎对 04_cA_gap_living 流程计算得到，未手工填数。', 12, 'start', 'normal', MUTED),
  ]
  return { name: 'fig_earliest_gap', title: '最早资金缺口与两项依据', sources: ['book/data/flows/04_cA_gap_living.json'], note: 'D34 两项依据', text: frame('图 7 最早资金缺口（案例 A 新增生活支出）', '缺口类型、金额与 D34 两项计算依据', parts.join('\n')) }
}

function candidateCompare(): Figure {
  const result = loadResult('cases/cB_topk.json')
  const values = result.candidates.map((candidate) => ({
    label: candidate.candidate_id,
    value: candidate.net_spend?.value ?? 0,
    color: !candidate.feasible ? BAD : candidate.rank !== null ? OK : '#60a5fa',
    note: candidate.rank !== null ? `Top${candidate.rank}` : candidate.feasible ? '' : '排除',
  }))
  const parts = [
    barChart({ x: 90, y: 130, width: 820, height: 250, values }),
    label(90, 420, `评估 ${result.optimization.evaluated_count} 个、确定排除 ${result.optimization.excluded_count} 个、待确认 ${result.optimization.pending_count} 个；K = ${result.optimization.top_k}。`, 12),
    label(90, 446, '口径：净支出取候选分支 M4 的 P+F−R；同价按编号升序，末位同价不突破 K（R016、D15）。', 12, 'start', 'normal', MUTED),
  ]
  return { name: 'fig_candidate_compare', title: '候选方案净支出与 Top-K', sources: ['book/data/cases/cB_topk.json'], note: 'R016、D15、D62', text: frame('图 8 候选方案净支出比较（cB_topk）', '可行性、排除状态与 Top-3 显示位置', parts.join('\n')) }
}

function offerScope(): Figure {
  const caseData = readJson<{ offers: { offer_id: string; type: string; value: number; scope: string[]; threshold: number | null; valid_to: string | null; applies_at: string }[] }>(
    repoPath('fixtures/cases/cB_topk.json'),
  )
  const rows = caseData.offers.slice(0, 8).map((offer) => [
    offer.offer_id,
    offer.type,
    offer.type === 'PERCENT_OFF' ? `${offer.value} 万分比` : money(offer.value),
    offer.scope.join('/'),
    offer.threshold === null ? '无门槛' : money(offer.threshold),
    offer.valid_to ?? '有效期未知',
  ])
  const parts = [
    table({
      x: 40,
      y: 120,
      columns: [
        { title: '优惠', width: 120 },
        { title: '类型', width: 130 },
        { title: '面额', width: 150 },
        { title: '适用范围', width: 190 },
        { title: '门槛', width: 150 },
        { title: '有效期至', width: 180 },
      ],
      rows,
    }),
    label(40, 400, '约束：每个订单最多一张参与计算的即时类优惠和一张返现（V-03）；叠加顺序未给出的候选计入待确认（D45）。', 12),
    label(40, 426, '返现只有“付款即返、金额与日期明确、不依赖后续行为”才计入 R（D12、D42）；返券不冲减当前目标成本。', 12, 'start', 'normal', MUTED),
  ]
  return { name: 'fig_offer_scope', title: '优惠类型与约束', sources: ['fixtures/cases/cB_topk.json'], note: 'D17、D45、V-03', text: frame('图 9 优惠类型与约束（cB_topk 案例）', '类型、面额、适用范围与门槛', parts.join('\n')) }
}

function planStateTree(): Figure {
  const parts: string[] = []
  const boxes = [
    { x: 60, y: 140, w: 250, h: 80, title: '计划状态', lines: ['按已确认方案 > 选中候选 > 草案', 'D47、D20'] },
    { x: 380, y: 140, w: 250, h: 80, title: '优化状态', lines: ['K=3 范围内的比较结论', 'R011、R016'] },
    { x: 700, y: 140, w: 250, h: 80, title: '确认状态', lines: ['待确认 / 已确认 / 草案', 'R017、D18'] },
  ]
  for (const box of boxes) {
    parts.push(rect(box.x, box.y, box.w, box.h, '#eff6ff', ACCENT))
    parts.push(label(box.x + box.w / 2, box.y + 30, box.title, 15, 'middle', 'bold', ACCENT))
    box.lines.forEach((text, index) => parts.push(label(box.x + box.w / 2, box.y + 54 + index * 18, text, 11, 'middle', 'normal', MUTED)))
  }
  const states = [
    'FEASIBLE_UNDER_ASSUMPTIONS 按当前假设可行',
    'INCOMPLETE 暂无法完整判断',
    'PAYMENT_GAP 发现付款缺口',
    'CONSTRAINT_ISSUE 存在约束问题',
    'CANCELLED 已取消',
  ]
  parts.push(rect(60, 270, 880, 170, FILL, LINE))
  parts.push(label(80, 300, '计划状态取值（rules.md §11.1；优先级由高到低）', 13, 'start', 'bold'))
  states.forEach((state, index) => parts.push(label(100, 330 + index * 24, `· ${state}`, 12)))
  parts.push(label(60, 480, '三类状态分别保存，不互相覆盖；取消与暂停不改底层检查口径（D19、D47）。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_plan_state_tree', title: '三类状态与计划状态取值', sources: ['docs/rules.md §11'], note: '§11.1—§11.3', text: frame('图 10 三类状态与计划状态取值', '计划、优化、确认状态分开保存', parts.join('\n')) }
}

function confirmFlow(): Figure {
  const steps = [
    '选择候选（SELECT_CANDIDATE）',
    '按 D46 算建议分配额 ΔA 与计划分配',
    '确认前模拟的计划状态须为“按当前假设可行”',
    'CONFIRM 写入正式安排，输入版本 +1',
    '冻结行动清单（R017 第8—10条）',
    '输入变化后风险重算，清单不变',
  ]
  const parts: string[] = []
  steps.forEach((step, index) => {
    const y = 120 + index * 58
    parts.push(rect(80, y, 620, 44, index === 3 ? '#ecfdf5' : FILL, index === 3 ? OK : LINE))
    parts.push(label(100, y + 28, `${index + 1}. ${step}`, 12))
    if (index < steps.length - 1) parts.push(arrow(390, y + 44, 390, y + 58))
  })
  parts.push(rect(740, 120, 200, 300, '#fef2f2', '#fecaca'))
  parts.push(label(840, 150, '不能写入的情形', 13, 'middle', 'bold', BAD))
  const blocked = ['确认前模拟不可行', '确认后出现付款缺口', '计划状态为暂无法完整判断', '存在约束问题', 'plan_version 与候选不符']
  blocked.forEach((item, index) => parts.push(label(756, 182 + index * 26, `· ${item}`, 11)))
  parts.push(label(840, 400, '只能保存为“草案”', 12, 'middle', 'bold', BAD))
  parts.push(label(80, 500, '未确认的模型推断不写入确认记录；确认记录的输入版本早于当前版本时标“需重新确认”（D60、D63）。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_confirm_flow', title: '确认与行动清单流程', sources: ['docs/rules.md R017、D18、D46、D63'], note: '确认写入与拒绝路径', text: frame('图 11 确认与行动清单流程', '成功写入与只能存草案两条路径', parts.join('\n')) }
}

function holtGrid(): Figure {
  const parts = [
    rect(80, 120, 300, 110, FILL, LINE),
    label(100, 150, '参数网格', 13, 'start', 'bold'),
    label(100, 176, 'α、β ∈ {0.2, 0.4, 0.6, 0.8}', 12),
    label(100, 198, 'φ ∈ {0.80, 0.90, 0.95, 0.98}', 12),
    label(100, 220, '共 4 × 4 × 4 = 64 组', 12, 'start', 'normal', MUTED),
    rect(410, 120, 250, 110, FILL, LINE),
    label(430, 150, '样本门槛', 13, 'start', 'bold'),
    label(430, 176, '最近 14 个连续可比日级样本', 12),
    label(430, 198, '同一序列须同项目、渠道、规格', 12),
    label(430, 220, '不可比即整条序列不拟合', 12, 'start', 'normal', MUTED),
    rect(690, 120, 250, 110, FILL, LINE),
    label(710, 150, '回测门槛', 13, 'start', 'bold'),
    label(710, 176, '至少 5 个回测误差', 12),
    label(710, 198, '与基线 MAE 比较', 12),
    label(710, 220, '不足则 BACKTEST_INSUFFICIENT', 12, 'start', 'normal', MUTED),
  ]
  const states = ['CONFIG_NOT_FROZEN', 'NOT_COMPARABLE', 'HISTORY_INSUFFICIENT', 'INVALID_RESULT', 'BACKTEST_INSUFFICIENT', 'AVAILABLE']
  parts.push(rect(80, 270, 860, 150, '#eff6ff', ACCENT))
  parts.push(label(100, 300, '预测状态判定顺序（SG-49 的保守读法）', 13, 'start', 'bold', ACCENT))
  states.forEach((state, index) => parts.push(label(110 + index * 140, 330, state, 10, 'middle')))
  states.forEach((_, index) => {
    if (index < states.length - 1) parts.push(arrow(110 + index * 140 + 58, 336, 110 + index * 140 + 78, 336, ACCENT))
  })
  parts.push(label(100, 366, '中间量保留 12 位小数，两端 34 位有效数字、ROUND_HALF_UP（D25、D50）；整数分只在进入金额计算时使用。', 12))
  parts.push(label(80, 460, '口径：方法定义见 rules.md §6、§7.2；实现见 src/engine/holt/，与独立参考实现对拍。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_holt_grid', title: 'Holt 预测参数与判定', sources: ['docs/rules.md §6、§7.2', 'src/engine/holt/'], note: 'D24、D25、D50、SG-49', text: frame('图 12 Holt 阻尼趋势预测的参数与状态判定', '网格选择、样本与回测门槛', parts.join('\n')) }
}

function forecastStatus(): Figure {
  const result = loadResult('cases/cB_topk.json')
  const rows = result.forecasts.map((forecast) => [
    forecast.series_id,
    forecast.cost_item_id,
    forecast.purchase_date,
    forecast.status,
    String(forecast.sample_count),
    forecast.history_end,
    String(forecast.horizon),
    forecast.predicted === null ? '—' : forecast.predicted,
    forecast.amount === null ? '—' : money(forecast.amount.value),
    forecast.confirmed ? '已确认' : '未确认',
  ])
  const parts = [
    table({
      x: 40,
      y: 120,
      columns: [
        { title: '序列', width: 130 },
        { title: '费用项目', width: 110 },
        { title: '购买日', width: 110 },
        { title: '状态', width: 190 },
        { title: '样本数', width: 80 },
        { title: '历史末日', width: 110 },
        { title: '步长 h', width: 80 },
        { title: '预测中间值', width: 130 },
        { title: '取整金额', width: 120 },
        { title: '确认', width: 80 },
      ],
      rows,
    }),
    label(40, 320, '未确认的预测不进入候选比较（D14、R020 第9条）；历史不足时如实显示“历史不足”，不补造参考价。', 12),
    label(40, 346, '口径：样本门槛 14、回测门槛 5，均取 DEMO-CFG-1；导出结果来自 book/data/cases/cB_topk.json。', 12, 'start', 'normal', MUTED),
  ]
  return { name: 'fig_forecast_status', title: '预测条目状态', sources: ['book/data/cases/cB_topk.json'], note: 'D24、D76', text: frame('图 13 预测条目的状态与门槛', '每条预测的样本、步长与可用性', parts.join('\n')) }
}

function scenarioFigure(): Figure {
  const flows = ['flows/01_cB_topk_main.json', 'flows/04_cA_gap_living.json', 'flows/14_c00_today_spend.json', 'cases/c00_v1_living_not_provided.json']
  const rows = flows.map((file) => {
    const result = loadResult(file)
    const daily = result.daily_reference
    const amount = daily.amount?.value ?? null
    const reasons = result.scenarios.map((scenario) => (scenario.unavailable_reason === null ? `${scenario.kind} 可用` : `${scenario.kind} ${scenario.unavailable_reason}`))
    return [
      file.replace(/^(flows|cases)\//, '').replace(/\.json$/, ''),
      daily.display,
      amount === null ? '—' : money(amount),
      daily.limited_by?.scenario ?? '—',
      reasons.join('；'),
    ]
  })
  const parts = [
    table({
      x: 40,
      y: 120,
      columns: [
        { title: '案例／流程', width: 220 },
        { title: '每日参考显示', width: 210 },
        { title: '金额', width: 140 },
        { title: '限制来源', width: 130 },
        { title: '情景状态', width: 260 },
      ],
      rows,
    }),
    label(40, 360, '每日参考只在存在已确认方案时计算（D27）；信息不足时显示“暂无法给出建议金额”，不以 0 元代替（D59、R019）。', 12),
    label(40, 386, '近月情景需要 30 个完整历日（§7.1）；9 月 1 日案例观察窗口不足，原因记为 HISTORY_INSUFFICIENT，不补造消费记录。', 12, 'start', 'normal', MUTED),
    label(40, 412, '已确认方案下已有缺口时，0 元表示“当前不建议新增非计划支出”，不等于原计划可行（R019 第6条、§11.4）。', 12, 'start', 'normal', MUTED),
  ]
  return { name: 'fig_daily_reference', title: '每日参考与情景可用性', sources: ['book/data/flows/01_cB_topk_main.json', 'book/data/flows/04_cA_gap_living.json', 'book/data/cases/c00_v1_living_not_provided.json'], note: 'R018、R019、D26、D27、D59', text: frame('图 14 每日参考与情景可用性', '各演示数据的每日参考显示、金额与情景不可用原因', parts.join('\n')) }
}

function testMatrix(): Figure {
  const status = readJson<{ rules: { rule: string; children: number; pass: number; partial: number; failed: number; pending: number }[] }>(repoPath('book/data/status.json'))
  const rows = status.rules.slice(0, 20)
  const parts: string[] = []
  parts.push(label(60, 110, '每条规则下子用例的追溯状态（pass / partial / failed / pending）', 12, 'start', 'normal', MUTED))
  rows.forEach((row, index) => {
    const y = 128 + index * 24
    const total = Math.max(1, row.children)
    const widths = [row.pass, row.partial, row.failed, row.pending].map((value) => (value / total) * 480)
    let x = 200
    const colors = [OK, WARN, BAD, '#94a3b8']
    widths.forEach((width, colorIndex) => {
      if (width <= 0) return
      parts.push(rect(x, y, Math.max(width, 1), 14, colors[colorIndex] ?? LINE, colors[colorIndex] ?? LINE, 2))
      x += width
    })
    parts.push(label(60, y + 12, row.rule, 11))
    parts.push(label(700, y + 12, `${row.children} 条：通过 ${row.pass}／部分 ${row.partial}／未通过 ${row.failed}／待执行 ${row.pending}`, 10, 'start', 'normal', MUTED))
  })
  parts.push(label(60, 128 + rows.length * 24 + 30, '口径：book/data/status.json（pnpm test:report 生成）；未执行的层计为 partial，不计为通过。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_test_matrix', title: '测试覆盖矩阵', sources: ['book/data/status.json'], note: '按规则汇总子用例状态', text: frame('图 15 测试覆盖矩阵（按规则）', '追溯状态分布；未执行不计为通过', parts.join('\n'), 720) }
}

function traceState(): Figure {
  const status = readJson<{ traceability: { rows: number; pass: number; partial: number; failed: number; pending: number } }>(repoPath('book/data/status.json'))
  const trace = status.traceability
  const items = [
    { label: '通过', value: trace.pass, color: OK },
    { label: '部分覆盖', value: trace.partial, color: WARN },
    { label: '已执行未通过', value: trace.failed, color: BAD },
    { label: '待执行', value: trace.pending, color: '#94a3b8' },
  ]
  const parts: string[] = [barChart({ x: 110, y: 140, width: 780, height: 220, values: items, unit: '行' })]
  parts.push(label(110, 420, `追溯表共 ${trace.rows} 条数据行（含父行）；每行状态只由真实运行证据与缺口处置生成。`, 12))
  parts.push(label(110, 446, '未执行的层写成“部分覆盖”或“待执行”，不写成通过（docs/_work/test_layers.md 分层）。', 12, 'start', 'normal', MUTED))
  return { name: 'fig_trace_state', title: '追溯表状态分布', sources: ['book/data/status.json', 'docs/traceability.csv'], note: 'trace:update 结果', text: frame('图 16 追溯表状态分布', '通过 / 部分覆盖 / 未通过 / 待执行', parts.join('\n')) }
}

export function buildFigures(): Figure[] {
  return [
    architecture(),
    pipeline(),
    dataFlow(),
    costComposition(),
    fundingPartition(),
    cashCurve(),
    earliestGap(),
    candidateCompare(),
    offerScope(),
    planStateTree(),
    confirmFlow(),
    holtGrid(),
    forecastStatus(),
    scenarioFigure(),
    testMatrix(),
    traceState(),
  ]
}

function indexMarkdown(figures: readonly Figure[]): string {
  const lines = ['# 图表索引', '', '全部图由 `pnpm figures` 从 `book/data` 的正式导出结果生成；数值图不含手工填写的数字。', '', '| 编号 | 图名 | 文件名 | 数据来源 | 口径说明 |', '| --- | --- | --- | --- | --- |']
  figures.forEach((figure, index) => {
    lines.push(`| 图 ${index + 1} | ${figure.title} | ${figure.name}.svg | ${figure.sources.join('<br>')} | ${figure.note} |`)
  })
  lines.push('')
  return lines.join('\n')
}

export async function main(): Promise<number> {
  const figures = buildFigures()
  const dir = repoPath(FIGURES_DIR)
  mkdirSync(dir, { recursive: true })
  for (const figure of figures) writeFileAtomic(path.join(dir, `${figure.name}.svg`), figure.text)
  writeFileAtomic(path.join(dir, 'index.md'), indexMarkdown(figures))
  console.log(`已生成 ${figures.length} 张图到 ${FIGURES_DIR}`)
  if (figures.length < 15) {
    console.error(`图表只有 ${figures.length} 张，比赛建议不少于 15 张（docs/sources.md）`)
    return 1
  }
  return 0
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
