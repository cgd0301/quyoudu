import type { ConsumptionCategory } from '../enums.ts'
import type { Money } from '../result.ts'
import { CATEGORY_FLAGS, DAILY_CATEGORIES, isDailyCategory } from './categories.ts'
import { eachDay, isAvailableBy, parseInstant, type Instant } from './dates.ts'
import type { ConsumptionDayInput, EventInput, ReserveInput, ScenarioGroupResult } from './types.ts'

export function money(value: number, eventIds: readonly string[], reserveIds: readonly string[], rules: readonly string[]): Money {
  return { value, basis: { eventIds: [...eventIds], reserveIds: [...reserveIds], rules: [...rules] } }
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 非负整数 ÷ 正整数，按 ROUND_HALF_UP 取整（D23、D67） */
export function roundHalfUpDiv(numerator: number, divisor: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new Error(`roundHalfUpDiv 的参数须为非负安全整数与正整数：${numerator}、${divisor}`)
  }
  const remainder = numerator % divisor
  const quotient = (numerator - remainder) / divisor
  return remainder * 2 >= divisor ? quotient + 1 : quotient
}

/** D23、D49：total 分平均分到按日期排列的 count 日，分币余数从早到晚各加 1 分 */
export function splitEvenly(total: number, count: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`splitEvenly 的参数须为非负安全整数：${total}、${count}`)
  }
  if (count === 0) return []
  const remainder = total % count
  const base = (total - remainder) / count
  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base))
}

type Segment = {
  reserve: ReserveInput | null
  days: string[]
}

export type BuiltGroup = {
  result: ScenarioGroupResult
  reserveId: string | null
}

export type GroupParams = {
  asOf: Instant
  checkPeriodEnd: string
  /** 观察窗口内的完整历日 */
  history: readonly ConsumptionDayInput[]
  windowDays: number
  reserves: readonly ReserveInput[]
  events: readonly EventInput[]
}

/** §5 的已列安排：未计入快照、带日常消费类别的预计生活支出（SG-31 的 events[].category） */
function isArrangement(event: EventInput, asOf: Instant): boolean {
  return (
    event.eventKind === 'OTHER_EXPENSE' &&
    event.eventStatus === 'EXPECTED' &&
    !event.inSnapshot &&
    event.category !== undefined &&
    isDailyCategory(event.category) &&
    isAvailableBy(event.availableAt, asOf)
  )
}

function arrangementDate(event: EventInput): string | null {
  return event.expectedAt === null ? null : (parseInstant(event.expectedAt)?.date ?? null)
}

// SPEC-GAP SG-72：检查期间内同类别安排的金额或日期未知时 Pg、Eg 不可比（§5），不机械相减
function comparable(events: readonly EventInput[], asOf: Instant, first: string, last: string): boolean {
  return events
    .filter((event) => isArrangement(event, asOf))
    .every((event) => {
      const date = arrangementDate(event)
      return date !== null && (event.amount !== null || date < first || date > last)
    })
}

function segmentsByReserve(days: readonly string[], cover: ReadonlyMap<string, ReserveInput | null>): Segment[] {
  const segments: Segment[] = []
  for (const date of days) {
    const reserve = cover.get(date) ?? null
    const last = segments.at(-1)
    if (last !== undefined && last.reserve === reserve) last.days.push(date)
    else segments.push({ reserve, days: [date] })
  }
  return segments
}

function buildGroup(category: ConsumptionCategory, segment: Segment, params: GroupParams): BuiltGroup {
  const records = params.history.flatMap((record) => record.items.filter((item) => item.category === category))
  const recordIds = records.map((item) => item.eventId)
  // D67：窗口合计 × 组内天数 ÷ 30，一次取整，不先把日均取整
  const scenarioTotal = roundHalfUpDiv(sum(records.map((item) => item.amount)) * segment.days.length, params.windowDays)
  const inSegment = new Set(segment.days)
  // SPEC-GAP SG-72：Eg 只取同类别、人民币、日期在组内的已列安排；预留余额不是已列安排
  const scheduled = params.events.filter((event) => {
    const date = arrangementDate(event)
    return isArrangement(event, params.asOf) && event.category === category && event.currency === 'CNY' && date !== null && inSegment.has(date)
  })
  const scheduledIds = scheduled.map((event) => event.eventId)
  const scheduledTotal = sum(scheduled.map((event) => event.amount ?? 0))
  // §5：Pg 低于 Eg 时不压缩 Eg
  const increment = Math.max(0, scenarioTotal - scheduledTotal)
  // CaseFile 没有情景增量的已知付款日，Δg 一律在组内各日平均分摊（D49）
  const shares = splitEvenly(increment, segment.days.length)
  const reserveIds = segment.reserve === null ? [] : [segment.reserve.reserveId]
  return {
    reserveId: segment.reserve?.reserveId ?? null,
    result: {
      category,
      // D67：由生活预留覆盖的组取该预留的覆盖期间；SPEC-GAP SG-72：没有对应生活预留的日段取该日段
      coverageStart: segment.reserve?.coverageStart ?? segment.days[0],
      coverageEnd: segment.reserve?.coverageEnd ?? segment.days[segment.days.length - 1],
      scenarioGroupTotal: money(scenarioTotal, recordIds, reserveIds, ['§5', '§7.1', 'D23', 'D67']),
      scheduledGroupTotal: money(scheduledTotal, scheduledIds, reserveIds, ['§5']),
      scenarioIncrement: money(increment, [...recordIds, ...scheduledIds], reserveIds, ['§5', 'D23', 'D49']),
      dailyAmounts: segment.days.map((date, index) => ({ date, amount: money(shares[index], [], reserveIds, ['D23', 'D49']) })),
    },
  }
}

/**
 * D67：同一类别、同一覆盖期间为一组。由生活预留覆盖的类别按对应生活预留的覆盖期间切分，
 * 不由预留覆盖的类别整个检查期间为一组；组内天数含 as_of 当日。覆盖关系不清时返回 null。
 */
export function buildGroups(params: GroupParams): BuiltGroup[] | null {
  const days = eachDay(params.asOf.date, params.checkPeriodEnd)
  if (days.length === 0) return null
  const living = params.reserves.filter((reserve) => reserve.reserveKind === 'LIVING')
  const cover = new Map<string, ReserveInput | null>()
  for (const date of days) {
    const covering = living.filter((reserve) => reserve.coverageStart <= date && date <= reserve.coverageEnd)
    // D21：可对应的生活预留不止一项
    if (covering.length > 1) return null
    cover.set(date, covering.at(0) ?? null)
  }
  if (!comparable(params.events, params.asOf, days[0], params.checkPeriodEnd)) return null
  return DAILY_CATEGORIES.flatMap((category) => {
    // SPEC-GAP SG-72：没有对应生活预留的日子按连续日段成组，情景支出不带覆盖
    const segments: Segment[] =
      CATEGORY_FLAGS[category]?.coveredByLivingReserve === true ? segmentsByReserve(days, cover) : [{ reserve: null, days }]
    return segments.map((segment) => buildGroup(category, segment, params))
  })
}
