/**
 * pnpm model:economics
 *
 * 由 docs/_work/business_model.params.json 计算两件事，并把结果写成可被项目书引用的数据：
 * 1. 市场漏斗：从公开的"大型演出观众人次"推导到"可能用到本产品的人次"，全程用**变量表达式 + 取值轴**，
 *    不给出点估计；任何一格都是"在给定参数下的条件式结果"，不是市场规模。
 * 2. 单位经济：单次规划的模型调用成本（价格来自官方定价页）+ 获客与价格的敏感性，
 *    已知数字与假设参数分开标注，不产出收入预测。
 *
 * 输出：
 * - book/data/model/business_model.json（供项目书占位符引用，键名 snake_case）
 * - docs/_work/business_model.md（人读版，含全部口径与来源编号）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalWire } from './lib/canonical.ts'
import { readText, repoPath, writeFileAtomic } from './lib/repo.ts'

export const PARAMS_PATH = 'docs/_work/business_model.params.json'
export const MODEL_DIR = 'book/data/model'
export const MODEL_JSON = `${MODEL_DIR}/business_model.json`
export const MODEL_MD = 'docs/_work/business_model.md'

type Known = { value: number; unit: string; source: string; note: string }
type Assumption = { label: string; axis: number[]; evidence: string }

export type Params = {
  version: string
  as_of: string
  title: string
  discipline: string
  sources: Record<string, string>
  known: Record<string, Known>
  assumptions: Record<string, Assumption>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseParams(text: string): Params {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data)) throw new Error('参数文件不是对象')
  const knownRaw = data.known
  const assumptionsRaw = data.assumptions
  const sourcesRaw = data.sources
  if (!isRecord(knownRaw)) throw new Error('参数文件缺少 known')
  if (!isRecord(assumptionsRaw)) throw new Error('参数文件缺少 assumptions')
  if (!isRecord(sourcesRaw)) throw new Error('参数文件缺少 sources')
  const known: Record<string, Known> = {}
  for (const [key, value] of Object.entries(knownRaw)) {
    if (!isRecord(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) throw new Error(`known.${key} 不是数字`)
    if (typeof value.source !== 'string' || value.source === '') throw new Error(`known.${key} 缺少 source`)
    if (typeof value.unit !== 'string' || typeof value.note !== 'string') throw new Error(`known.${key} 缺少 unit/note`)
    known[key] = { value: value.value, unit: value.unit, source: value.source, note: value.note }
  }
  const assumptions: Record<string, Assumption> = {}
  for (const [key, value] of Object.entries(assumptionsRaw)) {
    if (!isRecord(value) || !Array.isArray(value.axis) || value.axis.length === 0) throw new Error(`assumptions.${key} 缺少 axis`)
    if (!value.axis.every((item) => typeof item === 'number' && Number.isFinite(item) && item > 0)) throw new Error(`assumptions.${key} 的 axis 必须是正数`)
    if (typeof value.label !== 'string' || typeof value.evidence !== 'string') throw new Error(`assumptions.${key} 缺少 label/evidence`)
    assumptions[key] = { label: value.label, axis: value.axis as number[], evidence: value.evidence }
  }
  const sources: Record<string, string> = {}
  for (const [key, value] of Object.entries(sourcesRaw)) {
    if (typeof value !== 'string' || value === '') throw new Error(`sources.${key} 不是字符串`)
    sources[key] = value
  }
  for (const [key, item] of Object.entries(known)) {
    if (sources[item.source] === undefined) throw new Error(`known.${key} 引用了不存在的来源 ${item.source}`)
  }
  if (typeof data.version !== 'string' || typeof data.as_of !== 'string' || typeof data.title !== 'string' || typeof data.discipline !== 'string') {
    throw new Error('参数文件缺少 version/as_of/title/discipline')
  }
  return { version: data.version, as_of: data.as_of, title: data.title, discipline: data.discipline, sources, known, assumptions }
}

export function valueOf(params: Params, key: string): number {
  const item = params.known[key]
  if (item === undefined) throw new Error(`缺少已知参数 ${key}`)
  return item.value
}

function axisOf(params: Params, key: string): number[] {
  const item = params.assumptions[key]
  if (item === undefined) throw new Error(`缺少假设参数 ${key}`)
  return item.axis
}

/** 每"人次"的票房与票房外消费，全部由两个已知数相除/相乘得到 */
export type Anchors = {
  ticket_cny_per_attendance: number
  other_cny_per_attendance: number
  total_cny_per_attendance: number
  attendance_wan: number
  box_office_yi: number
  multiplier: number
}

export function deriveAnchors(params: Params): Anchors {
  const attendance = valueOf(params, 'large_event_attendance_2025_wan')
  const boxOffice = valueOf(params, 'large_event_box_office_2025_yi')
  const multiplier = valueOf(params, 'large_event_consumption_multiplier')
  if (attendance <= 0) throw new Error('观众人次必须为正')
  // 亿元 / 万人次 = 元/人次：1 亿元 = 1e8 元，1 万人次 = 1e4 人次
  const perAttendance = (boxOffice * 1e8) / (attendance * 1e4)
  const ticket = Math.round(perAttendance)
  const other = Math.round(perAttendance * multiplier)
  return {
    ticket_cny_per_attendance: ticket,
    other_cny_per_attendance: other,
    total_cny_per_attendance: ticket + other,
    attendance_wan: attendance,
    box_office_yi: boxOffice,
    multiplier,
  }
}

export type SweepRow = {
  age_share: number
  cross_city_share: number
  multi_payment_share: number
  /** 条件式人次（万），不是市场规模估计 */
  conditional_wan: number
}

/** 三层筛选的条件式结果：全部参数都是取值轴上的示例值，不是估计 */
export function marketSweep(params: Params): SweepRow[] {
  const attendance = valueOf(params, 'large_event_attendance_2025_wan')
  const rows: SweepRow[] = []
  for (const age of axisOf(params, 'age_share')) {
    for (const cross of axisOf(params, 'cross_city_share')) {
      for (const multi of axisOf(params, 'multi_payment_share')) {
        rows.push({
          age_share: age,
          cross_city_share: cross,
          multi_payment_share: multi,
          conditional_wan: Math.round(attendance * age * cross * multi * 100) / 100,
        })
      }
    }
  }
  return rows
}

export type UnitCost = {
  input_tokens: number
  output_tokens: number
  usd: number
  cny: number
}

export function unitCost(params: Params, inputTokens: number, outputTokens: number, peak: boolean): UnitCost {
  const inPrice = valueOf(params, 'llm_input_usd_per_mtok_peak') * (peak ? 1 : 0.5)
  const outPrice = valueOf(params, 'llm_output_usd_per_mtok_peak') * (peak ? 1 : 0.5)
  const usd = (inputTokens / 1e6) * inPrice + (outputTokens / 1e6) * outPrice
  const fx = axisOf(params, 'usd_cny')[0] ?? 1
  return { input_tokens: inputTokens, output_tokens: outputTokens, usd, cny: usd * fx }
}

export type UnitRow = {
  input_tokens: number
  output_tokens: number
  cost_peak_cny: number
  cost_offpeak_cny: number
}

export function unitTable(params: Params): UnitRow[] {
  const rows: UnitRow[] = []
  const inputs = axisOf(params, 'llm_input_tokens_per_session')
  const outputs = axisOf(params, 'llm_output_tokens_per_session')
  for (const input of inputs) {
    for (const output of outputs) {
      rows.push({
        input_tokens: input,
        output_tokens: output,
        cost_peak_cny: unitCost(params, input, output, true).cny,
        cost_offpeak_cny: unitCost(params, input, output, false).cny,
      })
    }
  }
  return rows
}

export type BreakEvenRow = {
  price_cny_per_plan: number
  acquisition_cny_per_user: number
  annual_plans_per_user: number
  /** 每年每用户收入 */
  revenue_cny_per_user_year: number
  /** 每年每用户模型成本（按基准档 token 数、高峰价） */
  model_cost_cny_per_user_year: number
  /** 每年每用户毛利（不含开发与运营固定成本） */
  margin_cny_per_user_year: number
  /** 需要多少付费用户才能摊平一个单位的固定成本；固定成本未给出时为 null */
  break_even_users_per_10k_fixed: number | null
}

export function breakEven(params: Params): BreakEvenRow[] {
  const inputs = axisOf(params, 'llm_input_tokens_per_session')
  const outputs = axisOf(params, 'llm_output_tokens_per_session')
  const midInput = inputs[Math.floor(inputs.length / 2)] ?? 0
  const midOutput = outputs[Math.floor(outputs.length / 2)] ?? 0
  const perPlanCost = unitCost(params, midInput, midOutput, true).cny
  const rows: BreakEvenRow[] = []
  for (const price of axisOf(params, 'price_cny_per_plan')) {
    for (const acquisition of axisOf(params, 'acquisition_cny_per_user')) {
      for (const plans of axisOf(params, 'annual_plans_per_user')) {
        const revenue = price * plans
        const modelCost = perPlanCost * plans
        // 先按两位小数取整，再用同一个数算摊平人数，保证表内数字自洽
        const margin = Math.round((revenue - modelCost - acquisition) * 100) / 100
        rows.push({
          price_cny_per_plan: price,
          acquisition_cny_per_user: acquisition,
          annual_plans_per_user: plans,
          revenue_cny_per_user_year: Math.round(revenue * 100) / 100,
          model_cost_cny_per_user_year: Math.round(modelCost * 100) / 100,
          margin_cny_per_user_year: margin,
          break_even_users_per_10k_fixed: margin > 0 ? Math.ceil(10000 / margin) : null,
        })
      }
    }
  }
  return rows
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export type ModelResult = {
  anchors: Anchors
  sweep: SweepRow[]
  units: UnitRow[]
  breakEven: BreakEvenRow[]
  /** 供项目书占位符直接引用的展示串 */
  display: {
    attendance_wan: string
    ticket_per_attendance_cny: string
    other_per_attendance_cny: string
    total_per_attendance_cny: string
    unit_cost_peak_cny_low: string
    unit_cost_peak_cny_high: string
    unit_cost_offpeak_cny_low: string
  }
}

export function buildModel(params: Params): ModelResult {
  const anchors = deriveAnchors(params)
  const units = unitTable(params)
  const peak = units.map((row) => row.cost_peak_cny)
  const off = units.map((row) => row.cost_offpeak_cny)
  return {
    anchors,
    sweep: marketSweep(params),
    units,
    breakEven: breakEven(params),
    display: {
      attendance_wan: String(anchors.attendance_wan),
      ticket_per_attendance_cny: String(anchors.ticket_cny_per_attendance),
      other_per_attendance_cny: String(anchors.other_cny_per_attendance),
      total_per_attendance_cny: String(anchors.total_cny_per_attendance),
      unit_cost_peak_cny_low: String(round(Math.min(...peak), 4)),
      unit_cost_peak_cny_high: String(round(Math.max(...peak), 4)),
      unit_cost_offpeak_cny_low: String(round(Math.min(...off), 4)),
    },
  }
}

function percent(value: number): string {
  return `${round(value * 100, 1)}%`
}

export function renderMarkdown(params: Params, model: ModelResult): string {
  const lines: string[] = []
  lines.push('# 市场漏斗与单位经济模型（条件式，不是预测）', '')
  lines.push(`- 参数文件：\`${PARAMS_PATH}\`（version ${params.version}，as_of ${params.as_of}）`)
  lines.push(`- 口径：${params.discipline}`)
  lines.push('')
  lines.push('## 一、已知数字（可在 docs/sources.md 文末核验记录中逐条查到）', '')
  lines.push('| 键 | 值 | 单位 | 来源 | 说明 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const [key, item] of Object.entries(params.known)) {
    lines.push(`| ${key} | ${item.value} | ${item.unit} | ${item.source} | ${item.note} |`)
  }
  lines.push('')
  lines.push('## 二、按已知数字派生的人次口径', '')
  lines.push('亿元 ÷ 万人次 = 元/人次；票房外消费按简报的带动系数 1:6.85 推算。')
  lines.push('')
  lines.push('| 指标 | 值 | 算法 |')
  lines.push('| --- | --- | --- |')
  lines.push(`| 大型演出观众（2025） | ${model.anchors.attendance_wan} 万人次 | 直接引用 |`)
  lines.push(`| 每人均摊票房 | ${model.display.ticket_per_attendance_cny} 元 | ${model.anchors.box_office_yi} 亿元 ÷ ${model.anchors.attendance_wan} 万人次 |`)
  lines.push(`| 每人均摊票房外消费 | ${model.display.other_per_attendance_cny} 元 | 票房 × ${model.anchors.multiplier} |`)
  lines.push(`| 每人均摊总花费 | ${model.display.total_per_attendance_cny} 元 | 票房 + 票房外消费 |`)
  lines.push('')
  lines.push('该值是**全市场平均**，包含大量非跨城、非本目标人群的观演；不能当作本产品的客单价。')
  lines.push('')
  lines.push('## 三、市场漏斗（变量表达式 + 取值轴，不是市场规模估计）', '')
  lines.push('条件式人次 = 大型演出观众人次 × 18—30 岁占比 × 跨城比例 × 付款分散比例。三个比例**都没有证据**，下表只是把公式算一遍：')
  lines.push('')
  lines.push('| 18—30 岁占比 | 跨城比例 | 付款分散比例 | 条件式人次（万） |')
  lines.push('| --- | --- | --- | --- |')
  for (const row of model.sweep) {
    lines.push(`| ${percent(row.age_share)} | ${percent(row.cross_city_share)} | ${percent(row.multi_payment_share)} | ${row.conditional_wan} |`)
  }
  lines.push('')
  lines.push('**这些行不代表任何估计**：参数取什么值，结果就跟着变，说明的是"结果对参数高度敏感"，而不是"市场有多大"。')
  lines.push('')
  lines.push('## 四、单次规划的模型调用成本', '')
  lines.push('价格取 deepseek-flash 高峰价：输入 0.30 美元/百万 token、输出 1.20 美元/百万 token；非高峰为半价。')
  lines.push('人民币金额按参数文件中的汇率假设折算（汇率未核验）。')
  lines.push('')
  lines.push('| 输入 token | 输出 token | 高峰成本（元） | 非高峰成本（元） |')
  lines.push('| --- | --- | --- | --- |')
  for (const row of model.units) {
    lines.push(`| ${row.input_tokens} | ${row.output_tokens} | ${round(row.cost_peak_cny, 4)} | ${round(row.cost_offpeak_cny, 4)} |`)
  }
  lines.push('')
  lines.push('token 数是**假设**（未实测）。本项目实现了离线回放，演示与对拍模式下不调用模型，成本为 0；实时模式下的实际 token 消耗需要用真实会话测。')
  lines.push('')
  lines.push('## 五、单位经济敏感性（每年每付费用户）')
  lines.push('')
  lines.push('| 单次价格（元） | 获客成本（元） | 年使用次数 | 年收入（元） | 年模型成本（元） | 年毛利（元） | 摊平 1 万元固定成本所需付费用户 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const row of model.breakEven) {
    const need = row.break_even_users_per_10k_fixed === null ? '无法摊平' : String(row.break_even_users_per_10k_fixed)
    lines.push(
      `| ${row.price_cny_per_plan} | ${row.acquisition_cny_per_user} | ${row.annual_plans_per_user} | ${row.revenue_cny_per_user_year} | ${row.model_cost_cny_per_user_year} | ${row.margin_cny_per_user_year} | ${need} |`,
    )
  }
  lines.push('')
  lines.push('只看结构，不看得数：模型调用成本比获客成本低两个数量级以上，因此单位经济由**获客成本与使用次数**决定，而不是由 token 价格决定；价格档位来自问卷 Q12 之前的任何取值都只是示例。')
  lines.push('')
  lines.push('## 六、这个模型不能回答什么', '')
  lines.push('')
  lines.push('- 不能给出市场规模：三个筛选比例全部未证实。')
  lines.push('- 不能给出收入预测：价格与使用频次只能来自问卷，且自报意愿不等于购买。')
  lines.push('- 不能给出投资回报：开发与运营固定成本没有实测数据，本文件只用"每 1 万元固定成本"做换算。')
  lines.push('- 不能代表竞品价格：竞品收费水平未核实。')
  lines.push('')
  return lines.join('\n')
}

export function buildOutputs(params: Params): { json: string; text: string; model: ModelResult } {
  const model = buildModel(params)
  const json = canonicalWire({
    meta: {
      generated_by: 'pnpm model:economics',
      params: PARAMS_PATH,
      params_version: params.version,
      as_of: params.as_of,
      notice: '条件式模型，不是市场规模或收入预测',
      kind: 'assumption_model',
    },
    sources: params.sources,
    anchors: model.anchors,
    display: model.display,
    sweep: model.sweep,
    units: model.units,
    break_even: model.breakEven,
  })
  return { json, text: renderMarkdown(params, model), model }
}

export async function main(): Promise<number> {
  const params = parseParams(readText(repoPath(PARAMS_PATH)))
  const { json, text, model } = buildOutputs(params)
  writeFileAtomic(repoPath(MODEL_JSON), json)
  writeFileAtomic(repoPath(MODEL_MD), text)
  console.log(
    `已写入 ${MODEL_JSON} 与 ${MODEL_MD}：每人均摊票房 ${model.display.ticket_per_attendance_cny} 元、` +
      `含票房外 ${model.display.total_per_attendance_cny} 元；单次模型成本 ${model.display.unit_cost_peak_cny_low}—${model.display.unit_cost_peak_cny_high} 元（高峰）；` +
      `漏斗 ${model.sweep.length} 组条件式取值（非估计）`,
  )
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
