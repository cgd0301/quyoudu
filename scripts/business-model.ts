/**
 * pnpm model:economics
 *
 * 由 docs/_work/business_model.params.json 生成两份产物，只做两件事：
 * 1. 把可在 docs/sources.md 核验的原始事实，按透明公式派生出"人均口径"（元/人次）；
 * 2. 把市场漏斗、模型调用成本、单位经济的**符号公式**与**缺口清单**写清楚。
 *
 * 本脚本故意不产出任何情景数值：
 * - 不生成市场漏斗的取值轴或组数（三个筛选比例都没有证据，条件式结果不是市场规模）；
 * - 不生成价格 / 获客成本 / 使用次数的敏感性表或盈亏平衡人数（参数没有依据，示意值不是经营预测）；
 * - 不把 token 假设乘上汇率算成"单次成本"（token 未实测、汇率未核验）。
 *
 * 输出：
 * - book/data/model/business_model.json（供项目书占位符引用，键名 snake_case）
 * - docs/_work/business_model.md（人读版，含公式、来源编号与缺口）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalWire } from './lib/canonical.ts'
import { readText, repoPath, writeFileAtomic } from './lib/repo.ts'

export const PARAMS_PATH = 'docs/_work/business_model.params.json'
export const MODEL_DIR = 'book/data/model'
export const MODEL_JSON = `${MODEL_DIR}/business_model.json`
export const MODEL_MD = 'docs/_work/business_model.md'

/** 允许出现在参数文件里的最高层级键；出现别的键（尤其 assumptions）直接报错 */
const PARAMS_KEYS = ['version', 'as_of', 'title', 'discipline', 'sources', 'known', 'formulas', 'open_items']

/** 无依据参数不得携带的字段：出现就说明又想把示意值当参数（known 允许 value，因为 facts 必须给值） */
const FORBIDDEN_ITEM_KEYS = ['value', 'values', 'axis', 'axes', 'default', 'scenario', 'estimate', 'point_estimate']

const REQUIRED_FORMULAS = [
  'per_attendance_ticket_cny',
  'per_attendance_other_cny',
  'market_funnel',
  'unit_cost_cny',
  'contribution_cny_per_user_year',
  'break_even_users',
]

export type Known = { value: number; display: string; unit: string; source: string; note: string }
export type OpenItem = { label: string; status: string; why: string; to_verify_by: string }

export type Params = {
  version: string
  as_of: string
  title: string
  discipline: string
  sources: Record<string, string>
  known: Record<string, Known>
  formulas: Record<string, string>
  openItems: Record<string, OpenItem>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where}.${key} 必须是非空字符串`)
  return value
}

function assertNoForbiddenKeys(record: Record<string, unknown>, where: string, allowValue = false): void {
  for (const key of FORBIDDEN_ITEM_KEYS) {
    if (allowValue && key === 'value') continue
    if (key in record) throw new Error(`${where} 不得包含 ${key}：没有依据的参数只能登记为缺口，不能预设数值`)
  }
}

export function parseParams(text: string): Params {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data)) throw new Error('参数文件不是对象')
  if ('assumptions' in data) throw new Error('参数文件不得包含 assumptions：没有依据的取值轴不是参数，请登记为 open_items')
  for (const key of Object.keys(data)) {
    if (!PARAMS_KEYS.includes(key)) throw new Error(`参数文件出现未登记的最高层级键 ${key}；无依据的取值轴请登记为 open_items`)
  }
  const knownRaw = data.known
  const openRaw = data.open_items
  const sourcesRaw = data.sources
  const formulasRaw = data.formulas
  if (!isRecord(knownRaw)) throw new Error('参数文件缺少 known')
  if (!isRecord(openRaw)) throw new Error('参数文件缺少 open_items')
  if (!isRecord(sourcesRaw)) throw new Error('参数文件缺少 sources')
  if (!isRecord(formulasRaw)) throw new Error('参数文件缺少 formulas')

  const sources: Record<string, string> = {}
  for (const [key, value] of Object.entries(sourcesRaw)) {
    if (typeof value !== 'string' || value === '') throw new Error(`sources.${key} 不是字符串`)
    sources[key] = value
  }

  const known: Record<string, Known> = {}
  for (const [key, value] of Object.entries(knownRaw)) {
    if (!isRecord(value)) throw new Error(`known.${key} 不是对象`)
    assertNoForbiddenKeys(value, `known.${key}`, true)
    if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value <= 0) throw new Error(`known.${key}.value 必须是正数`)
    if (typeof value.display !== 'string' || value.display === '') throw new Error(`known.${key}.display 必须是非空字符串`)
    if (Number(value.display) !== value.value) throw new Error(`known.${key}.display 与 value 不一致：${value.display} ≠ ${value.value}`)
    const unit = requireString(value, 'unit', `known.${key}`)
    const source = requireString(value, 'source', `known.${key}`)
    const note = requireString(value, 'note', `known.${key}`)
    if (sources[source] === undefined) throw new Error(`known.${key} 引用了不存在的来源 ${source}`)
    known[key] = { value: value.value, display: value.display, unit, source, note }
  }

  const openItems: Record<string, OpenItem> = {}
  for (const [key, value] of Object.entries(openRaw)) {
    if (!isRecord(value)) throw new Error(`open_items.${key} 不是对象`)
    assertNoForbiddenKeys(value, `open_items.${key}`)
    openItems[key] = {
      label: requireString(value, 'label', `open_items.${key}`),
      status: requireString(value, 'status', `open_items.${key}`),
      why: requireString(value, 'why', `open_items.${key}`),
      to_verify_by: requireString(value, 'to_verify_by', `open_items.${key}`),
    }
  }

  const formulas: Record<string, string> = {}
  for (const [key, value] of Object.entries(formulasRaw)) {
    if (typeof value !== 'string' || value === '') throw new Error(`formulas.${key} 不是字符串`)
    formulas[key] = value
  }
  for (const key of REQUIRED_FORMULAS) {
    if (formulas[key] === undefined) throw new Error(`formulas 缺少 ${key}`)
  }

  return {
    version: requireString(data, 'version', 'params'),
    as_of: requireString(data, 'as_of', 'params'),
    title: requireString(data, 'title', 'params'),
    discipline: requireString(data, 'discipline', 'params'),
    sources,
    known,
    formulas,
    openItems,
  }
}

export function valueOf(params: Params, key: string): number {
  const item = params.known[key]
  if (item === undefined) throw new Error(`缺少已知事实 ${key}`)
  return item.value
}

/** 每"人次"的票房与票房外消费，全部由两个已知事实相除/相乘得到 */
export type Anchors = {
  /** 未取整的人均票房，用于复算票房外消费 */
  ticket_exact: number
  ticket_cny_per_attendance: number
  other_cny_per_attendance: number
  total_cny_per_attendance: number
  attendance_wan: number
  box_office_yi: number
  event_count: number
  multiplier: number
}

export function deriveAnchors(params: Params): Anchors {
  const attendance = valueOf(params, 'large_event_attendance_2025_wan')
  const boxOffice = valueOf(params, 'large_event_box_office_2025_yi')
  const multiplier = valueOf(params, 'large_event_consumption_multiplier')
  const eventCount = valueOf(params, 'large_event_event_count_2025')
  if (attendance <= 0) throw new Error('观众人次必须为正')
  // 亿元 / 万人次 = 元/人次：1 亿元 = 1e8 元，1 万人次 = 1e4 人次
  const perAttendance = (boxOffice * 1e8) / (attendance * 1e4)
  const ticket = Math.round(perAttendance)
  const other = Math.round(perAttendance * multiplier)
  return {
    ticket_exact: Math.round(perAttendance * 100) / 100,
    ticket_cny_per_attendance: ticket,
    other_cny_per_attendance: other,
    total_cny_per_attendance: ticket + other,
    attendance_wan: attendance,
    box_office_yi: boxOffice,
    event_count: eventCount,
    multiplier,
  }
}

export type ModelResult = {
  anchors: Anchors
  /** 供项目书占位符直接引用的展示串：事实用原文精度，派生值用取整后的整数 */
  display: Record<string, string>
}

export function buildModel(params: Params): ModelResult {
  const anchors = deriveAnchors(params)
  const display: Record<string, string> = {}
  for (const [key, item] of Object.entries(params.known)) display[key] = item.display
  display.ticket_per_attendance_cny = String(anchors.ticket_cny_per_attendance)
  display.other_per_attendance_cny = String(anchors.other_cny_per_attendance)
  display.total_per_attendance_cny = String(anchors.total_cny_per_attendance)
  return { anchors, display }
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

/** 只渲染事实与公式：本函数内不得出现任何取值轴、情景表或摊平人数 */
export function renderMarkdown(params: Params, model: ModelResult): string {
  const lines: string[] = []
  lines.push('# 市场与商业数字：事实锚点、公式与缺口（不是市场规模或收入预测）', '')
  lines.push(`- 参数文件：\`${PARAMS_PATH}\`（version ${params.version}，as_of ${params.as_of}）`)
  lines.push(`- 口径：${params.discipline}`)
  lines.push('- 配套台账：`docs/_work/data_evidence_register.md`，每个数字一个编号，可逐项追溯来源与公式。')
  lines.push('- 独立复算：`docs/_work/evidence/recompute_business_numbers.md`（不复用本脚本代码）。', '')

  lines.push('## 一、已核验的原始事实（逐条可在 docs/sources.md 查到原文）', '')
  lines.push(tableRow(['键', '值', '单位', '来源', '说明']))
  lines.push(tableRow(['---', '---', '---', '---', '---']))
  for (const [key, item] of Object.entries(params.known)) {
    lines.push(tableRow([key, item.display, item.unit, item.source, item.note]))
  }
  lines.push('')

  lines.push('## 二、由事实派生的人均口径（可复算，但只是全市场平均）', '')
  lines.push(`公式：${params.formulas.per_attendance_ticket_cny}`)
  lines.push(`　　　${params.formulas.per_attendance_other_cny}`, '')
  lines.push(tableRow(['指标', '值', '算法']))
  lines.push(tableRow(['---', '---', '---']))
  lines.push(tableRow(['大型演出观众（2025）', `${model.anchors.attendance_wan} 万人次`, '直接引用 E01（人次口径）']))
  lines.push(
    tableRow([
      '每人均摊票房',
      `${model.display.ticket_per_attendance_cny} 元/人次`,
      `${model.anchors.box_office_yi} 亿元 ÷ ${model.anchors.attendance_wan} 万人次（未取整 ${model.anchors.ticket_exact} 元）`,
    ]),
  )
  lines.push(
    tableRow([
      '每人均摊票房外消费',
      `${model.display.other_per_attendance_cny} 元/人次`,
      `未取整的人均票房 ${model.anchors.ticket_exact} 元 × ${model.anchors.multiplier}`,
    ]),
  )
  lines.push(tableRow(['每人均摊总花费', `${model.display.total_per_attendance_cny} 元/人次`, '票房 + 票房外消费（两项均已取整）']))
  lines.push('')
  lines.push('上述派生值有三个边界，项目书正文必须同时写出：')
  lines.push('')
  lines.push('1. 它是**全市场平均**，包含大量非跨城、非本目标人群的观演，不能当作本产品的客单价。')
  lines.push('2. 分母是**人次**，一人一年可能看多场，所以它不能当作人均年度支出，更不能换算成独立用户数。')
  lines.push('3. 带动系数 1:6.85 是协会的调研测算口径，不是因果关系，也不是本产品能获取的收入。')
  lines.push('')

  lines.push('## 三、市场漏斗：只有公式，没有数值', '')
  lines.push(`公式：${params.formulas.market_funnel}`, '')
  lines.push(tableRow(['参数', '状态', '为什么没有数值', '怎么补']))
  lines.push(tableRow(['---', '---', '---', '---']))
  for (const key of ['age_share', 'cross_city_share', 'multi_payment_share', 'unique_attendee_ratio']) {
    const item = params.openItems[key]
    if (item === undefined) continue
    lines.push(tableRow([item.label, item.status, item.why, item.to_verify_by]))
  }
  lines.push('')
  lines.push('**结论：目前无法给出可验证的市场规模。** 三个筛选比例都没有证据，取值一旦自设，结果就只是“在给定参数下的条件式人次”，')
  lines.push('不是 TAM、SAM、SOM，也不是目标用户数；本文件因此不设取值区间、不列组数、不给任何具体结果。')
  lines.push('')
  lines.push('**人次不是人数**：即使将来三个比例都有数据，公式输出仍是人次/年；要谈独立用户规模，必须另行定义统计总体、去重逻辑与来源，')
  lines.push('并披露估计误差。在此之前不得把观众人次换算成独立用户数，更不得换算成付费用户数。')
  lines.push('')

  lines.push('## 四、单次模型调用成本：只有公式与官方价格', '')
  lines.push(
    `已知事实：deepseek-flash 输入（缓存未命中）高峰价 ${params.known.llm_input_usd_per_mtok_peak?.display ?? ''} 美元/百万 token、` +
      `输出高峰价 ${params.known.llm_output_usd_per_mtok_peak?.display ?? ''} 美元/百万 token，非高峰为半价（E04）。`,
  )
  lines.push('')
  lines.push(`公式：${params.formulas.unit_cost_cny}`)
  lines.push('')
  lines.push('缺口：一次规划会话的输入与输出 token 数**未实测**（离线回放不调用模型，仓库内没有任何真实会话的计量）；汇率也**未核验**。')
  lines.push('因此本稿不给单次成本数值，也不把它与任何价格或获客成本作量级比较——缺少 token 实测时，比较的双方都没有依据。')
  lines.push('')
  lines.push('可以核实的一点是：演示与对拍使用离线回放，不调用模型，这部分调用费用为 0；这是代码路径与测试保证的系统性质，不是估算。')
  lines.push('')

  lines.push('## 五、单位经济：只有符号定义，没有情景表', '')
  lines.push(`定义：${params.formulas.contribution_cny_per_user_year}`)
  lines.push('')
  lines.push(`盈亏平衡：${params.formulas.break_even_users}`)
  lines.push('')
  lines.push(tableRow(['参数', '状态', '为什么没有数值', '怎么补']))
  lines.push(tableRow(['---', '---', '---', '---']))
  for (const key of ['price_cny_per_plan', 'acquisition_cny_per_user', 'annual_plans_per_user', 'annual_fixed_cost', 'usd_cny']) {
    const item = params.openItems[key]
    if (item === undefined) continue
    lines.push(tableRow([item.label, item.status, item.why, item.to_verify_by]))
  }
  lines.push('')
  lines.push('价格、获客成本、使用次数、固定成本都没有依据，所以本文件不生成敏感性表，也不给“摊平固定成本所需人数”。')
  lines.push('即使把任意数值代进正确公式，算出来的也只是公式演示，不能证明盈利能力，也不能当成基准预测。')
  lines.push('')

  lines.push('## 六、本文件不能回答什么', '')
  lines.push('- 不能给出市场规模、TAM/SAM/SOM 或目标用户数：三个筛选比例全部未验证，且公式输出是人次。')
  lines.push('- 不能给出单次模型成本：token 用量未实测，汇率未核验。')
  lines.push('- 不能给出收入、贡献额、盈亏平衡点或投资回报：价格、使用次数、获客成本、固定成本均无数据。')
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
      notice: '事实锚点与符号公式：不含市场规模、情景数值或收入预测',
      kind: 'fact_anchors_and_formulas',
    },
    sources: params.sources,
    known: params.known,
    anchors: model.anchors,
    display: model.display,
    formulas: params.formulas,
    openItems: params.openItems,
  })
  return { json, text: renderMarkdown(params, model), model }
}

export async function main(): Promise<number> {
  const params = parseParams(readText(repoPath(PARAMS_PATH)))
  const { json, text, model } = buildOutputs(params)
  writeFileAtomic(repoPath(MODEL_JSON), json)
  writeFileAtomic(repoPath(MODEL_MD), text)
  console.log(
    `已写入 ${MODEL_JSON} 与 ${MODEL_MD}：事实 ${Object.keys(params.known).length} 条、人均口径 3 项（` +
      `${model.display.ticket_per_attendance_cny}/${model.display.other_per_attendance_cny}/${model.display.total_per_attendance_cny} 元/人次）、` +
      `缺口 ${Object.keys(params.openItems).length} 项；不生成任何情景数值`,
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
