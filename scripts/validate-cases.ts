/**
 * validate:cases：fixtures/cases/*.json 是演示案例，按 rules.md §8.9（V-01—V-07）、D03、D51、D57 等严格校验；
 * fixtures/vectors/*.json 是测试向量，只校验 schema，允许故意的冲突输入。
 * 每个问题打印一行“文件:路径:问题”，任一文件有问题时退出码为 1。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { EventKind, OfferType } from '../src/engine/enums.ts'
import { opsSchema } from '../src/engine/ops/index.ts'
import { caseFileSchema, dateSchema, type CaseFile } from '../src/engine/schema.ts'
import { findBannedNames } from './lib/banned.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export const CASES_DIR = 'fixtures/cases'
export const VECTORS_DIR = 'fixtures/vectors'

export const PROBLEM_CODES = [
  'JSON',
  'SCHEMA',
  'VECTOR_SHAPE',
  'EVENT_ID_DUPLICATE',
  'RESERVE_ID_DUPLICATE',
  'OFFER_ID_DUPLICATE',
  'CANDIDATE_ID_DUPLICATE',
  'CANDIDATE_ID_SEQUENCE',
  'CURRENCY',
  'AS_OF_FORMAT',
  'V-06',
  'CASH_AS_OF',
  'SNAPSHOT_PHASE',
  'IN_SNAPSHOT',
  'INSTANT_FORMAT',
  'DATE_RANGE',
  'EVENT_AFTER_RANGE',
  'COVERAGE_REF',
  'COVERAGE_OVER_AMOUNT',
  'COVERAGE_OVER_REMAINING',
  'V-05',
  'V-01',
  'V-02',
  'V-03',
  'OFFER_REF',
  'V-04',
  'V-07',
  'PRICE_SOURCE',
  'BANNED_NAME',
] as const
export type ProblemCode = (typeof PROBLEM_CODES)[number]

/** code 供测试断言，打印时不输出 */
export type Problem = {
  file: string
  path: string
  code: ProblemCode
  message: string
}

export type FixturesReport = {
  problems: Problem[]
  caseCount: number
  vectorCount: number
}

export type Output = {
  log: (line: string) => void
  error: (line: string) => void
}

type Segments = readonly PropertyKey[]
type Add = (code: ProblemCode, segments: Segments, message: string) => void
type CaseEvent = CaseFile['events'][number]

// R008，含首尾日期
const RANGE_START = '2026-09-01'
const RANGE_END = '2027-01-01'
// V-06
const DEMO_AS_OF_DATE = '2026-09-01'
// D51：n 只数这四类收付款
const PAYMENT_EVENT_KINDS: readonly EventKind[] = ['GOAL_PAYMENT', 'OTHER_EXPENSE', 'INCOME', 'RETURN']
// V-03：即时类优惠
const INSTANT_OFFER_TYPES: readonly OfferType[] = ['INSTANT_OFF', 'THRESHOLD_OFF', 'PERCENT_OFF']
// SPEC-GAP SG-34：meta.demo_points 中某一条同时写出候选编号和这句话，该候选豁免 V-03
const V03_EXEMPT_PHRASE = '违规叠加用于排除'

// SPEC-GAP SG-34：时刻只接受这两种写法，偏移固定为 +08:00（D03）
const DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\+08:00$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const INSTANT_FORMAT_HINT = 'YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss+08:00'
const AFTER_EVENT_N = /^AFTER_EVENT\(([1-9][0-9]*)\)$/

const zhCN = z.locales.zhCN()

export function formatPath(segments: Segments): string {
  let text = ''
  for (const segment of segments) {
    if (typeof segment === 'number') text += `[${segment}]`
    else text += text === '' ? String(segment) : `.${String(segment)}`
  }
  return text === '' ? '$' : text
}

export function formatProblem(problem: Problem): string {
  return `${problem.file}:${problem.path}:${problem.message}`
}

function collect(file: string): { problems: Problem[]; add: Add } {
  const problems: Problem[] = []
  const add: Add = (code, segments, message) => {
    problems.push({ file, path: formatPath(segments), code, message })
  }
  return { problems, add }
}

function parseWithSchema<T extends z.ZodType>(schema: T, data: unknown, prefix: Segments, add: Add): z.output<T> | null {
  const result = schema.safeParse(data, { error: zhCN.localeError })
  if (result.success) return result.data
  for (const issue of result.error.issues) add('SCHEMA', [...prefix, ...issue.path], `schema：${issue.message}`)
  return null
}

type Instant = {
  text: string
  date: string
  hasTime: boolean
}

function parseInstant(text: string): Instant | null {
  const datetime = DATETIME_PATTERN.exec(text)
  const date = datetime?.[1] ?? (DATE_PATTERN.test(text) ? text : null)
  if (date === null || !dateSchema.safeParse(date).success) return null
  return { text, date, hasTime: datetime !== null }
}

function parseDatetime(text: string): Instant | null {
  const instant = parseInstant(text)
  return instant?.hasTime ? instant : null
}

/** 与 cash_as_of 比较：-1 早于、0 同一时刻、1 晚于；只给日期且与 cash_as_of 同日时无法比较 */
function compareToClock(instant: Instant, clock: Instant): -1 | 0 | 1 | null {
  if (instant.date !== clock.date) return instant.date < clock.date ? -1 : 1
  if (!instant.hasTime) return null
  if (instant.text === clock.text) return 0
  return instant.text < clock.text ? -1 : 1
}

/** 实际发生的取 actual_at 所在日，否则取 expected_at 所在日 */
function eventDay(event: CaseEvent): string | null {
  const text = event.event_status === 'ACTUAL' && event.actual_at !== undefined ? event.actual_at : event.expected_at
  return text === null ? null : (parseInstant(text)?.date ?? null)
}

function walk(value: unknown, segments: Segments, visit: (value: unknown, segments: Segments) => void): void {
  visit(value, segments)
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => walk(item, [...segments, index], visit))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) walk(inner, [...segments, key], visit)
  }
}

function checkBannedNames(data: unknown, add: Add): void {
  // SPEC-GAP SG-34：对全部字符串值匹配，含编号和枚举
  walk(data, [], (value, segments) => {
    if (typeof value !== 'string') return
    const names = findBannedNames(value)
    if (names.length > 0) add('BANNED_NAME', segments, `出现真实平台名称：${names.join('、')}（AGENTS.md §3）`)
  })
}

function reportDuplicates(
  entries: readonly [string, Segments][],
  code: ProblemCode,
  label: string,
  rule: string,
  add: Add,
): void {
  const firstPaths = new Map<string, string>()
  for (const [id, segments] of entries) {
    const firstPath = firstPaths.get(id)
    if (firstPath === undefined) firstPaths.set(id, formatPath(segments))
    else add(code, segments, `${label} ${id} 与 ${firstPath} 重复（${rule}）`)
  }
}

function checkIds(data: CaseFile, add: Add): void {
  // SPEC-GAP SG-34：event_id 在事件、候选返还和消费记录之间全局唯一
  const eventIds: [string, Segments][] = []
  data.events.forEach((event, i) => eventIds.push([event.event_id, ['events', i, 'event_id']]))
  data.candidates.forEach((candidate, c) =>
    candidate.returns.forEach((ret, r) => eventIds.push([ret.event_id, ['candidates', c, 'returns', r, 'event_id']])),
  )
  data.consumption_records.forEach((day, d) =>
    day.items.forEach((item, k) => eventIds.push([item.event_id, ['consumption_records', d, 'items', k, 'event_id']])),
  )
  reportDuplicates(eventIds, 'EVENT_ID_DUPLICATE', 'event_id', 'R002', add)
  reportDuplicates(
    data.reserves.map((reserve, i): [string, Segments] => [reserve.reserve_id, ['reserves', i, 'reserve_id']]),
    'RESERVE_ID_DUPLICATE',
    'reserve_id',
    'R003',
    add,
  )
  reportDuplicates(
    data.offers.map((offer, i): [string, Segments] => [offer.offer_id, ['offers', i, 'offer_id']]),
    'OFFER_ID_DUPLICATE',
    'offer_id',
    'D45',
    add,
  )
  reportDuplicates(
    data.candidates.map((candidate, i): [string, Segments] => [candidate.candidate_id, ['candidates', i, 'candidate_id']]),
    'CANDIDATE_ID_DUPLICATE',
    '候选编号',
    'D15',
    add,
  )
  data.candidates.forEach((candidate, i) => {
    // SPEC-GAP SG-34：按数组顺序依次为 C01、C02……
    const expected = `C${String(i + 1).padStart(2, '0')}`
    if (candidate.candidate_id !== expected) {
      add('CANDIDATE_ID_SEQUENCE', ['candidates', i, 'candidate_id'], `候选编号应为 ${expected}：须从 C01 起按顺序连续编号（D15）`)
    }
  })
}

function checkCurrency(data: CaseFile, add: Add): void {
  walk(data, [], (value, segments) => {
    if (segments.at(-1) === 'currency' && value !== 'CNY') {
      add('CURRENCY', segments, `币种须为 CNY，实际为 ${String(value)}；首版不自动换算（R008）`)
    }
  })
}

type Clock = {
  asOf: Instant | null
  cashAsOf: Instant | null
}

function checkSnapshot(data: CaseFile, add: Add): Clock {
  const snapshot = data.snapshot
  const asOf = parseDatetime(snapshot.as_of)
  if (asOf === null) {
    add(
      'AS_OF_FORMAT',
      ['snapshot', 'as_of'],
      `as_of 须为带 +08:00 偏移的时刻，如 ${DEMO_AS_OF_DATE}T09:00:00+08:00；实际为“${snapshot.as_of}”（D03）`,
    )
  } else if (asOf.date !== DEMO_AS_OF_DATE) {
    add('V-06', ['snapshot', 'as_of'], `V-06：演示案例的 as_of 只能是 ${DEMO_AS_OF_DATE}，实际为 ${asOf.date}`)
  }
  // SPEC-GAP SG-34：须与 as_of 字符串相同
  if (snapshot.cash_as_of !== snapshot.as_of) {
    add(
      'CASH_AS_OF',
      ['snapshot', 'cash_as_of'],
      `cash_as_of 须与 as_of 一致：as_of 为 ${snapshot.as_of}，cash_as_of 为 ${snapshot.cash_as_of}（R001、D03）`,
    )
  }
  checkSnapshotPhase(data, asOf, add)
  return { asOf, cashAsOf: parseDatetime(snapshot.cash_as_of) }
}

function checkSnapshotPhase(data: CaseFile, asOf: Instant | null, add: Add): void {
  const phase = data.snapshot.snapshot_phase
  const segments = ['snapshot', 'snapshot_phase']
  if (phase === null) {
    add('SNAPSHOT_PHASE', segments, '缺少快照阶段（D03）')
    return
  }
  if (asOf === null) return
  // SPEC-GAP SG-34：consumption_records 的 in_snapshot 不计入 n
  const sameDay = data.events.filter(
    (event) => PAYMENT_EVENT_KINDS.includes(event.event_kind) && eventDay(event) === asOf.date,
  )
  const counted = sameDay.filter((event) => event.in_snapshot)
  const ids = (events: CaseEvent[]) => events.map((event) => event.event_id).join('、')
  if (phase === 'DAY_START') {
    if (counted.length > 0) {
      add(
        'SNAPSHOT_PHASE',
        segments,
        `DAY_START 时 as_of 当日不应有已计入快照的收付款，实际有 ${counted.length} 笔：${ids(counted)}（D03、D51）`,
      )
    }
  } else if (phase === 'DAY_END') {
    const pending = sameDay.filter((event) => !event.in_snapshot)
    if (pending.length > 0) {
      add('SNAPSHOT_PHASE', segments, `DAY_END 时 as_of 当日的收付款须全部计入快照，未计入：${ids(pending)}（D03、D51）`)
    }
  } else {
    const n = Number(AFTER_EVENT_N.exec(phase)?.[1])
    if (counted.length !== n) {
      const detail = counted.length > 0 ? `：${ids(counted)}` : ''
      add('SNAPSHOT_PHASE', segments, `${phase} 与 as_of 当日已计入快照的收付款笔数 ${counted.length} 不符${detail}（D03、D51）`)
    }
  }
}

function checkInSnapshot(data: CaseFile, cashAsOf: Instant | null, add: Add): void {
  data.events.forEach((event, i) => {
    if (event.in_snapshot && event.event_status !== 'ACTUAL') {
      add('IN_SNAPSHOT', ['events', i, 'in_snapshot'], '已计入快照的事件须为实际发生（ACTUAL）（D03）')
      return
    }
    if (event.event_status !== 'ACTUAL') return
    // SPEC-GAP SG-34：实际事件须有 actual_at；as_of 当日只给日期时无法与 cash_as_of 比较，按不通过处理
    if (event.actual_at === undefined) {
      add('IN_SNAPSHOT', ['events', i, 'actual_at'], '实际发生的事件缺少 actual_at，无法与 cash_as_of 核对（D03）')
      return
    }
    const actual = parseInstant(event.actual_at)
    if (actual === null || cashAsOf === null) return
    const order = compareToClock(actual, cashAsOf)
    if (order === null) {
      add('IN_SNAPSHOT', ['events', i, 'actual_at'], 'as_of 当日的实际事件须写到时刻，才能与 cash_as_of 比较（D03）')
    } else if (event.in_snapshot && order > 0) {
      add('IN_SNAPSHOT', ['events', i, 'actual_at'], '已计入快照的事件实际时刻晚于 cash_as_of（D03）')
    } else if (!event.in_snapshot && order <= 0) {
      add('IN_SNAPSHOT', ['events', i, 'in_snapshot'], '实际时刻不晚于 cash_as_of 的事件须计入快照（D03、D51）')
    }
  })
}

type TimeField = {
  segments: Segments
  text: string
  /** 收付款时间（必要事件），boundary_test 只放宽这些字段的上界 */
  payment: boolean
  /** 价格依据的模拟记录时间、可获得时间（R013） */
  evidence: string | null
  /** D57 范围前已付，不受下界限制 */
  preRange: boolean
}

type FieldFlags = {
  payment?: boolean
  evidence?: string
  preRange?: boolean
}

// D57
function isPreRangePaid(event: CaseEvent, goalId: string): boolean {
  // SPEC-GAP SG-34：“只用于 P 或 R”取 goal_id 为本目标的 GOAL_PAYMENT 和 RETURN
  return (
    event.in_snapshot &&
    event.event_status === 'ACTUAL' &&
    (event.event_kind === 'GOAL_PAYMENT' || event.event_kind === 'RETURN') &&
    event.goal_id === goalId
  )
}

/** snapshot.as_of、cash_as_of 另行检查；meta.created_at_real 是真实生成时间（R008），不检查 */
function collectTimeFields(data: CaseFile): TimeField[] {
  const fields: TimeField[] = []
  const field = (segments: Segments, text: string | null | undefined, flags: FieldFlags = {}): void => {
    if (text === null || text === undefined) return
    fields.push({
      segments,
      text,
      payment: flags.payment ?? false,
      evidence: flags.evidence ?? null,
      preRange: flags.preRange ?? false,
    })
  }
  // SPEC-GAP SG-34：必要事件取收付款时间字段
  const payment = { payment: true }
  const recorded = { evidence: '模拟记录时间' }
  const available = { evidence: '可获得时间' }

  data.reserves.forEach((reserve, i) => {
    field(['reserves', i, 'coverage_start'], reserve.coverage_start)
    field(['reserves', i, 'coverage_end'], reserve.coverage_end)
  })
  data.events.forEach((event, i) => {
    const preRange = isPreRangePaid(event, data.goal.goal_id)
    field(['events', i, 'expected_at'], event.expected_at, { payment: true, preRange })
    field(['events', i, 'actual_at'], event.actual_at, { payment: true, preRange })
    field(['events', i, 'recorded_at'], event.recorded_at, { preRange })
    field(['events', i, 'available_at'], event.available_at, { preRange })
    event.payment_windows?.forEach((slot, j) =>
      field(['events', i, 'payment_windows', j, 'expected_at'], slot.expected_at, { payment: true, preRange }),
    )
  })
  field(['goal', 'show_start_at'], data.goal.show_start_at)
  field(['goal', 'show_end_at'], data.goal.show_end_at)
  data.goal.lodging_nights_required?.forEach((night, j) => field(['goal', 'lodging_nights_required', j], night))
  data.candidates.forEach((candidate, c) => {
    candidate.items.forEach((item, j) => {
      const base = ['candidates', c, 'items', j]
      field([...base, 'purchase_date'], item.purchase_date)
      field([...base, 'payment_at'], item.payment_at, payment)
      field([...base, 'arrive_at'], item.arrive_at)
      field([...base, 'depart_at'], item.depart_at)
      item.lodging_nights?.forEach((night, k) => field([...base, 'lodging_nights', k], night))
      field([...base, 'quote', 'valid_from'], item.quote.valid_from)
      field([...base, 'quote', 'valid_to'], item.quote.valid_to)
      field([...base, 'quote', 'recorded_at'], item.quote.recorded_at, recorded)
      field([...base, 'quote', 'available_at'], item.quote.available_at, available)
      item.payment_windows?.forEach((slot, k) => field([...base, 'payment_windows', k, 'payment_at'], slot.payment_at, payment))
    })
    candidate.returns.forEach((ret, r) => {
      const base = ['candidates', c, 'returns', r]
      field([...base, 'expected_at'], ret.expected_at, payment)
      field([...base, 'recorded_at'], ret.recorded_at)
      field([...base, 'available_at'], ret.available_at)
    })
  })
  data.offers.forEach((offer, i) => {
    field(['offers', i, 'valid_from'], offer.valid_from)
    field(['offers', i, 'valid_to'], offer.valid_to)
    field(['offers', i, 'expected_at'], offer.expected_at, payment)
  })
  data.price_series.forEach((row, i) => {
    field(['price_series', i, 'service_date'], row.service_date)
    field(['price_series', i, 'observed_on'], row.observed_on)
    field(['price_series', i, 'recorded_at'], row.recorded_at, recorded)
    field(['price_series', i, 'available_at'], row.available_at, available)
  })
  data.consumption_records.forEach((day, d) => {
    field(['consumption_records', d, 'observed_on'], day.observed_on)
    day.items.forEach((item, k) => {
      field(['consumption_records', d, 'items', k, 'recorded_at'], item.recorded_at)
      field(['consumption_records', d, 'items', k, 'available_at'], item.available_at)
    })
  })
  data.forecast_confirmations.forEach((confirmation, i) =>
    field(['forecast_confirmations', i, 'purchase_date'], confirmation.purchase_date),
  )
  return fields
}

function checkTimeFields(data: CaseFile, add: Add): void {
  const boundaryTest = data.meta.boundary_test === true
  for (const field of collectTimeFields(data)) {
    const instant = parseInstant(field.text)
    if (instant === null) {
      reportBadInstant(field, add)
    } else if (instant.date < RANGE_START) {
      if (!field.preRange) {
        add('DATE_RANGE', field.segments, `日期 ${instant.date} 早于演示起始日 ${RANGE_START}（R008；范围前已付只限 D57 所列记录）`)
      }
    } else if (instant.date > RANGE_END) {
      if (!field.payment) {
        add('DATE_RANGE', field.segments, `日期 ${instant.date} 晚于演示结束日 ${RANGE_END}（R008）`)
      } else if (!boundaryTest) {
        add(
          'EVENT_AFTER_RANGE',
          field.segments,
          `收付款日期 ${instant.date} 晚于 ${RANGE_END}：必要事件超界只用于边界演示，须在 meta.boundary_test 标 true（R008、D04）`,
        )
      }
    }
  }
}

function reportBadInstant(field: TimeField, add: Add): void {
  if (field.evidence === null) {
    add('INSTANT_FORMAT', field.segments, `时刻须为 ${INSTANT_FORMAT_HINT}，实际为“${field.text}”（D03、§12.1）`)
  } else if (field.text.trim() === '') {
    add('PRICE_SOURCE', field.segments, `价格依据缺少${field.evidence}（R013）`)
  } else {
    add('PRICE_SOURCE', field.segments, `价格依据的${field.evidence}须为 ${INSTANT_FORMAT_HINT}，实际为“${field.text}”（R013、D03）`)
  }
}

type Claim = {
  segments: Segments
  eventId: string
  day: string
  amount: number
}

function checkCoverage(data: CaseFile, add: Add): void {
  const reserveIds = new Set(data.reserves.map((reserve) => reserve.reserve_id))
  const claims = new Map<string, Claim[]>()
  data.events.forEach((event, i) => {
    if (event.coverage.length === 0) return
    const total = event.coverage.reduce((sum, entry) => sum + entry.covered_amount, 0)
    // SPEC-GAP SG-34：金额为 null 时无法核对覆盖额，按不通过处理
    if (event.amount === null) {
      add('COVERAGE_OVER_AMOUNT', ['events', i, 'coverage'], '支出金额未知（null）却声明了覆盖，无法核对覆盖额（R003）')
    } else if (total > event.amount) {
      add('COVERAGE_OVER_AMOUNT', ['events', i, 'coverage'], `覆盖合计 ${total} 分超过支出额 ${event.amount} 分（R003）`)
    }
    // 日期未知的声明各自成组，排在全部日期之后
    const day = eventDay(event) ?? `~${i}`
    event.coverage.forEach((entry, j) => {
      if (!reserveIds.has(entry.reserve_id)) {
        add('COVERAGE_REF', ['events', i, 'coverage', j, 'reserve_id'], `覆盖引用的预留 ${entry.reserve_id} 不存在（R003）`)
        return
      }
      // 已计入快照的核销已体现在预留的快照金额中（R002）
      if (event.in_snapshot) return
      const list = claims.get(entry.reserve_id) ?? []
      list.push({
        segments: ['events', i, 'coverage', j, 'covered_amount'],
        eventId: event.event_id,
        day,
        amount: entry.covered_amount,
      })
      claims.set(entry.reserve_id, list)
    })
  })

  const checked = new Set<string>()
  data.reserves.forEach((reserve, r) => {
    if (checked.has(reserve.reserve_id)) return
    checked.add(reserve.reserve_id)
    // SPEC-GAP SG-34：剩余额 = 预留金额 − 日期在前的覆盖声明，不考虑预留迟建（D40）和覆盖期间
    let remaining = reserve.amount
    for (const group of groupByDay(claims.get(reserve.reserve_id) ?? [])) {
      const total = group.reduce((sum, claim) => sum + claim.amount, 0)
      if (total > remaining) {
        const eventIds = [...new Set(group.map((claim) => claim.eventId))]
        if (eventIds.length > 1) {
          add(
            'V-05',
            ['reserves', r],
            `V-05：${group[0].day} 同日 ${eventIds.join('、')} 共用预留 ${reserve.reserve_id}，覆盖声明合计 ${total} 分超过当日开始时的剩余额 ${remaining} 分（D38）`,
          )
        } else {
          add(
            'COVERAGE_OVER_REMAINING',
            group[0].segments,
            `覆盖声明 ${total} 分超过预留 ${reserve.reserve_id} 的剩余额 ${remaining} 分（R003）`,
          )
        }
      }
      remaining = Math.max(0, remaining - total)
    }
  })
}

function groupByDay(claims: readonly Claim[]): Claim[][] {
  const groups = new Map<string, Claim[]>()
  const sorted = [...claims].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  for (const claim of sorted) {
    const group = groups.get(claim.day) ?? []
    group.push(claim)
    groups.set(claim.day, group)
  }
  return [...groups.values()]
}

function checkReserves(data: CaseFile, add: Add): void {
  data.reserves.forEach((reserve, i) => {
    if (reserve.release_at_end) add('V-01', ['reserves', i, 'release_at_end'], 'V-01：release_at_end 只允许 false')
    if (reserve.reserve_kind !== 'OTHER_PROTECTED') return
    // SPEC-GAP SG-34：N 的建立事件即 funding_event_id；覆盖期早于 2027-01-01 结束即有到期
    if (reserve.funding_event_id !== undefined) {
      add('V-02', ['reserves', i, 'funding_event_id'], 'V-02：其他必要保护性预留只能在快照中给出，不得挂在收入上建立')
    }
    if (reserve.coverage_end !== RANGE_END) {
      add('V-02', ['reserves', i, 'coverage_end'], `V-02：其他必要保护性预留须覆盖至 ${RANGE_END}，实际到 ${reserve.coverage_end}`)
    }
  })
}

function isV03Exempt(demoPoints: readonly string[], candidateId: string): boolean {
  return demoPoints.some(
    (point) => point.includes(V03_EXEMPT_PHRASE) && point.split(/[^0-9A-Za-z_]+/).includes(candidateId),
  )
}

function checkOffers(data: CaseFile, add: Add): void {
  const offerTypes = new Map<string, OfferType>()
  for (const offer of data.offers) {
    if (!offerTypes.has(offer.offer_id)) offerTypes.set(offer.offer_id, offer.type)
  }
  data.candidates.forEach((candidate, c) => {
    const orders = new Map<string, { instant: string[]; cashback: string[] }>()
    candidate.offers_used.forEach((use, u) => {
      const type = offerTypes.get(use.offer_id)
      if (type === undefined) {
        add('OFFER_REF', ['candidates', c, 'offers_used', u, 'offer_id'], `引用的优惠 ${use.offer_id} 不在 offers 中（D45）`)
        return
      }
      const order = orders.get(use.order_id) ?? { instant: [], cashback: [] }
      if (INSTANT_OFFER_TYPES.includes(type)) order.instant.push(use.offer_id)
      if (type === 'CASHBACK') order.cashback.push(use.offer_id)
      orders.set(use.order_id, order)
    })
    if (isV03Exempt(data.meta.demo_points, candidate.candidate_id)) return
    const hint = `；违规叠加只用于演示被排除时，在 meta.demo_points 写明“${candidate.candidate_id} ${V03_EXEMPT_PHRASE}”`
    for (const [orderId, order] of orders) {
      if (order.instant.length > 1) {
        add(
          'V-03',
          ['candidates', c, 'offers_used'],
          `V-03：订单 ${orderId} 有 ${order.instant.length} 张即时类优惠（${order.instant.join('、')}），每个订单最多一张${hint}`,
        )
      }
      if (order.cashback.length > 1) {
        add(
          'V-03',
          ['candidates', c, 'offers_used'],
          `V-03：订单 ${orderId} 有 ${order.cashback.length} 张返现（${order.cashback.join('、')}），每个订单最多一张${hint}`,
        )
      }
    }
  })
}

function checkOverdue(data: CaseFile, clock: Clock, add: Add): void {
  const { asOf, cashAsOf } = clock
  if (asOf === null) return
  // §10.1 第7步：预计日期早于 as_of 当日；有时刻精度的，预计时刻早于 cash_as_of
  const report = (segments: Segments, text: string | null, timed: boolean): void => {
    const instant = text === null ? null : parseInstant(text)
    if (instant === null) return
    const overdue =
      instant.date < asOf.date || (timed && instant.hasTime && cashAsOf !== null && instant.text < cashAsOf.text)
    if (overdue) add('V-04', segments, `V-04：预计 ${instant.text} 早于 as_of 仍未履行（逾期），演示案例不得出现`)
  }
  data.events.forEach((event, i) => {
    if (event.event_status !== 'EXPECTED' || event.in_snapshot) return
    report(['events', i, 'expected_at'], event.expected_at, event.time_precision === 'DATETIME')
  })
  // SPEC-GAP SG-34：候选价格项的付款和候选返还同样不得逾期
  data.candidates.forEach((candidate, c) => {
    candidate.items.forEach((item, j) => report(['candidates', c, 'items', j, 'payment_at'], item.payment_at, true))
    candidate.returns.forEach((ret, r) =>
      report(['candidates', c, 'returns', r, 'expected_at'], ret.expected_at, ret.time_precision === 'DATETIME'),
    )
  })
}

// V-07：cost.possible_refund 只列一笔，共同事件与任一候选合计，带触发条件的本目标返还最多一笔
function checkConditionalRefunds(data: CaseFile, add: Add): void {
  const conditional = (trigger: string | undefined) => trigger !== undefined && trigger.trim() !== ''
  const shared = data.events.flatMap((event, i) =>
    event.event_kind === 'RETURN' &&
    (event.goal_id === undefined || event.goal_id === data.goal.goal_id) &&
    conditional(event.trigger_condition)
      ? [i]
      : [],
  )
  const second = shared[1]
  if (second !== undefined) {
    add('V-07', ['events', second, 'trigger_condition'], `V-07：带触发条件的本目标返还有 ${shared.length} 笔，演示案例最多一笔`)
    return
  }
  data.candidates.forEach((candidate, c) => {
    const own = candidate.returns.flatMap((ret, r) => (conditional(ret.trigger_condition) ? [r] : []))
    const first = own[0]
    if (first === undefined || shared.length + own.length <= 1) return
    add(
      'V-07',
      ['candidates', c, 'returns', first, 'trigger_condition'],
      `V-07：共同事件与候选 ${candidate.candidate_id} 带触发条件的本目标返还合计 ${shared.length + own.length} 笔，演示案例最多一笔`,
    )
  })
}

function checkProvenance(data: CaseFile, add: Add): void {
  // SPEC-GAP SG-34：schema 没有逐条的来源类型和批次，价格依据统一取 meta.source_type（由 schema 枚举保证）和 meta.batch
  if (data.meta.batch.trim() === '') {
    add('PRICE_SOURCE', ['meta', 'batch'], '缺少生成批次：价格依据的批次取 meta.batch（R013）')
  }
}

/** 严格模式：演示案例。schema 不通过时只报 schema 和禁用词 */
export function validateDemoCase(data: unknown, file: string): Problem[] {
  const { problems, add } = collect(file)
  const parsed = parseWithSchema(caseFileSchema, data, [], add)
  if (parsed !== null) {
    checkIds(parsed, add)
    checkCurrency(parsed, add)
    const clock = checkSnapshot(parsed, add)
    checkInSnapshot(parsed, clock.cashAsOf, add)
    checkTimeFields(parsed, add)
    checkCoverage(parsed, add)
    checkReserves(parsed, add)
    checkOffers(parsed, add)
    checkOverdue(parsed, clock, add)
    checkConditionalRefunds(parsed, add)
    checkProvenance(parsed, add)
  }
  checkBannedNames(data, add)
  return problems
}

/** 宽松模式：测试向量只校验 input 与 ops 的 schema，允许故意的冲突输入 */
export function validateVector(data: unknown, file: string): Problem[] {
  const { problems, add } = collect(file)
  // SPEC-GAP SG-35：向量为 {input, ops?, ...}，expect、source_text 等其余字段由 tests/unit/vectors.test.ts 校验
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    add('VECTOR_SHAPE', [], '测试向量须为 JSON 对象，含 input 字段')
    return problems
  }
  if ('input' in data) parseWithSchema(caseFileSchema, data.input, ['input'], add)
  else add('VECTOR_SHAPE', ['input'], '测试向量缺少 input（CaseFile）')
  if ('ops' in data) parseWithSchema(opsSchema, data.ops, ['ops'], add)
  return problems
}

function parseJson(text: string, add: Add): { data: unknown } | null {
  let body = text
  if (body.startsWith('\uFEFF')) {
    add('JSON', [], '文件带 BOM，须为无 BOM 的 UTF-8（AGENTS.md §3）')
    body = body.slice(1)
  }
  try {
    return { data: JSON.parse(body) as unknown }
  } catch (error) {
    add('JSON', [], `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function listJsonFiles(rootDir: string, relativeDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => `${relativeDir}/${name}`)
}

async function validateFile(
  rootDir: string,
  file: string,
  validate: (data: unknown, file: string) => Problem[],
): Promise<Problem[]> {
  const { problems, add } = collect(file)
  const parsed = parseJson(await readFile(path.join(rootDir, file), 'utf8'), add)
  if (parsed !== null) problems.push(...validate(parsed.data, file))
  return problems
}

export async function validateFixtures(rootDir: string): Promise<FixturesReport> {
  const caseFiles = await listJsonFiles(rootDir, CASES_DIR)
  const vectorFiles = await listJsonFiles(rootDir, VECTORS_DIR)
  const problems: Problem[] = []
  for (const file of caseFiles) problems.push(...(await validateFile(rootDir, file, validateDemoCase)))
  for (const file of vectorFiles) problems.push(...(await validateFile(rootDir, file, validateVector)))
  return { problems, caseCount: caseFiles.length, vectorCount: vectorFiles.length }
}

/** 打印全部问题，返回退出码 */
export async function runValidateCases(rootDir: string, output: Output = console): Promise<number> {
  const { problems, caseCount, vectorCount } = await validateFixtures(rootDir)
  for (const problem of problems) output.error(formatProblem(problem))
  const counts = `演示案例 ${caseCount} 个，测试向量 ${vectorCount} 个`
  if (problems.length > 0) {
    output.error(`validate:cases 未通过：${problems.length} 个问题（${counts}）`)
    return 1
  }
  if (caseCount === 0) output.log(`提示：${CASES_DIR} 下还没有演示案例`)
  output.log(`validate:cases 通过：${counts}`)
  return 0
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  runValidateCases(repoRoot)
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
