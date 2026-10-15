import { isDailyCategory } from './categories.ts'
import { addDays, isAvailableBy, type Instant } from './dates.ts'
import type { ConsumptionDayInput } from './types.ts'

/** R008：历史分析不把 2026-09-01 之前的记录当作观察窗口 */
export const RANGE_START = '2026-09-01'

export type ObservationWindow = {
  start: string | null
  end: string | null
  /** 入选的完整历日，按日期升序 */
  days: ConsumptionDayInput[]
  sufficient: boolean
}

export function noWindow(): ObservationWindow {
  return { start: null, end: null, days: [], sufficient: false }
}

// SPEC-GAP SG-70：同一日多条记录、NO_SPEND 却带记录、有记录晚于 as_of 才可获得、日常类别记录非人民币或为负的日子不算完整历日
function completeRecord(records: readonly ConsumptionDayInput[], asOf: Instant): ConsumptionDayInput | null {
  if (records.length !== 1) return null
  const record = records[0]
  if (record.dayCoverage === 'MISSING') return null
  if (record.dayCoverage === 'NO_SPEND' && record.items.length > 0) return null
  const usable = record.items.every(
    (item) =>
      isAvailableBy(item.availableAt, asOf) && (!isDailyCategory(item.category) || (item.currency === 'CNY' && item.amount >= 0)),
  )
  return usable ? record : null
}

/**
 * §7.1、§12.7：as_of 之前最近的 windowDays 个完整历日（COMPLETE 或 NO_SPEND），缺记录的日子跳过、不当 0
 * （读法 A，precheck_rulings.md 第6组）；不早于 RANGE_START。
 */
export function observationWindow(records: readonly ConsumptionDayInput[], asOf: Instant, windowDays: number): ObservationWindow {
  const end = addDays(asOf.date, -1)
  if (end < RANGE_START) return noWindow()
  const byDate = new Map<string, ConsumptionDayInput[]>()
  for (const record of records) byDate.set(record.observedOn, [...(byDate.get(record.observedOn) ?? []), record])
  const days: ConsumptionDayInput[] = []
  for (let date = end; date >= RANGE_START && days.length < windowDays; date = addDays(date, -1)) {
    const record = completeRecord(byDate.get(date) ?? [], asOf)
    if (record !== null) days.push(record)
  }
  days.reverse()
  const first = days.at(0)
  const sufficient = days.length === windowDays
  // SPEC-GAP SG-70：凑满时窗口从第 windowDays 个完整历日起，不足时从 RANGE_START 起
  return { start: sufficient && first !== undefined ? first.observedOn : RANGE_START, end, days, sufficient }
}
