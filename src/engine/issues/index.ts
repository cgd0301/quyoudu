import type { InputIssueCode } from '../enums.ts'
import type { CaseFile } from '../schema.ts'

export type InputIssue = {
  code: InputIssueCode
  rule: string
  refs: string[]
}

export type IssueReport = {
  issues: InputIssue[]
  outOfRange: boolean
  preRangePaid: boolean
}

const RANGE_START = '2026-09-01'
const RANGE_END = '2027-01-01'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const OFFSET_INSTANT = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}\+08:00$/
const PAYMENT_KINDS = new Set(['GOAL_PAYMENT', 'OTHER_EXPENSE', 'INCOME', 'RETURN'])

type Dated = { actual_at?: string | null; expected_at?: string | null }

function dateOf(value: string): string | null {
  if (DATE_ONLY.test(value)) return value
  return OFFSET_INSTANT.exec(value)?.[1] ?? null
}

function eventDay(event: Dated): string | null {
  const instant = event.actual_at ?? event.expected_at
  if (instant == null) return null
  return dateOf(instant)
}

type Compare = 'before_or_equal' | 'after' | 'unknown'

function compareInstants(actual: string, cashAsOf: string): Compare {
  if (OFFSET_INSTANT.test(actual) && OFFSET_INSTANT.test(cashAsOf)) {
    if (actual <= cashAsOf) return 'before_or_equal'
    return 'after'
  }
  const actualDate = dateOf(actual)
  const cashDate = dateOf(cashAsOf)
  if (actualDate == null || cashDate == null) return 'unknown'
  if (actualDate < cashDate) return 'before_or_equal'
  if (actualDate > cashDate) return 'after'
  return 'unknown'
}

function unique(refs: readonly string[]): string[] {
  return [...new Set(refs)]
}

function isPreRangePaid(event: CaseFile['events'][number], goalId: string): boolean {
  return (
    event.in_snapshot &&
    event.event_status === 'ACTUAL' &&
    (event.event_kind === 'GOAL_PAYMENT' || event.event_kind === 'RETURN') &&
    event.goal_id === goalId
  )
}

function phaseIssues(data: CaseFile): InputIssue[] {
  const issues: InputIssue[] = []
  const { as_of: asOf, cash_as_of: cashAsOf, snapshot_phase: phase } = data.snapshot
  const asOfOk = OFFSET_INSTANT.test(asOf)
  const cashOk = OFFSET_INSTANT.test(cashAsOf)
  // §12.7（13）：格式不符时只报 AS_OF_FORMAT，两者都能解析才比较是否对应
  if (!asOfOk || !cashOk) {
    const refs: string[] = []
    if (!asOfOk) refs.push('as_of')
    if (!cashOk) refs.push('cash_as_of')
    issues.push({ code: 'AS_OF_FORMAT', rule: 'D03', refs })
  } else if (asOf !== cashAsOf) issues.push({ code: 'CASH_AS_OF_MISMATCH', rule: 'R001', refs: ['cash_as_of'] })
  if (phase == null) {
    issues.push({ code: 'SNAPSHOT_PHASE_MISSING', rule: 'D03', refs: ['snapshot_phase'] })
    return issues
  }
  if (!asOfOk) return issues

  const day = asOf.slice(0, 10)
  const dayEvents = data.events.filter((event) => PAYMENT_KINDS.has(event.event_kind) && eventDay(event) === day)
  const counted = dayEvents.filter((event) => event.in_snapshot)
  // §12.7（14）：三种情形各报一条，阶段不符的 refs 只写快照阶段
  let phaseMismatch = false
  if (phase === 'DAY_START' && counted.length !== 0) phaseMismatch = true
  if (phase === 'DAY_END' && dayEvents.some((event) => !event.in_snapshot)) phaseMismatch = true
  const after = /^AFTER_EVENT\(([1-9][0-9]*)\)$/.exec(phase)
  if (after != null && Number(after[1]) !== counted.length) phaseMismatch = true
  if (phaseMismatch) issues.push({ code: 'SNAPSHOT_PHASE_MISMATCH', rule: 'D03', refs: ['snapshot.snapshot_phase'] })

  const countedWrong: string[] = []
  const omitted: string[] = []
  for (const event of data.events) {
    if (event.in_snapshot && event.event_status !== 'ACTUAL') countedWrong.push(event.event_id)
    if (event.in_snapshot && event.event_status === 'ACTUAL') {
      if (event.actual_at == null) countedWrong.push(event.event_id)
      else {
        const compared = compareInstants(event.actual_at, cashAsOf)
        if (compared === 'after' || compared === 'unknown') countedWrong.push(event.event_id)
      }
    }
    if (!event.in_snapshot && event.event_status === 'ACTUAL' && event.actual_at != null && cashOk) {
      if (compareInstants(event.actual_at, cashAsOf) === 'before_or_equal') omitted.push(event.event_id)
    }
  }
  const wrongRefs = unique(countedWrong)
  if (wrongRefs.length > 0) issues.push({ code: 'SNAPSHOT_PHASE_MISMATCH', rule: 'D03', refs: wrongRefs })
  const omittedRefs = unique(omitted)
  if (omittedRefs.length > 0) issues.push({ code: 'SNAPSHOT_PHASE_MISMATCH', rule: 'D03', refs: omittedRefs })
  return issues
}

function nonCnyIssue(data: CaseFile): InputIssue | null {
  const refs: string[] = []
  for (const event of data.events) if (event.currency !== 'CNY') refs.push(event.event_id)
  for (const candidate of data.candidates) {
    for (const item of candidate.items) if (item.currency !== 'CNY') refs.push(item.cost_item_id)
    for (const item of candidate.returns) if (item.currency !== 'CNY') refs.push(item.event_id)
  }
  for (const row of data.price_series) if (row.currency !== 'CNY') refs.push(row.series_id)
  for (const day of data.consumption_records) {
    for (const item of day.items) if (item.currency !== 'CNY') refs.push(item.event_id)
  }
  if (refs.length === 0) return null
  return { code: 'NON_CNY', rule: 'R008', refs: unique(refs) }
}

function visitDates(
  value: unknown,
  exemptLower: boolean,
  ref: string,
  refs: string[],
  markEarly: () => void,
  ignoreEarly = false,
): void {
  if (typeof value === 'string') {
    const date = dateOf(value)
    if (date == null) return
    if (date < RANGE_START) {
      // R008：价格与消费的早于窗口记录不进入观察窗口，也不构成超界
      if (ignoreEarly) return
      if (exemptLower) markEarly()
      else refs.push(ref)
    } else if (date > RANGE_END) refs.push(ref)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) visitDates(item, exemptLower, ref, refs, markEarly, ignoreEarly)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'created_at_real') continue
      visitDates(inner, exemptLower, ref, refs, markEarly, ignoreEarly)
    }
  }
}

function rangeIssue(data: CaseFile): { issue: InputIssue | null; preRangePaid: boolean } {
  const refs: string[] = []
  let preRangePaid = false
  const markEarly = () => {
    preRangePaid = true
  }
  visitDates(data.meta, false, 'meta', refs, markEarly)
  visitDates(data.snapshot, false, 'snapshot', refs, markEarly)
  for (const reserve of data.reserves) visitDates(reserve, false, reserve.reserve_id, refs, markEarly)
  for (const event of data.events) {
    visitDates(event, isPreRangePaid(event, data.goal.goal_id), event.event_id, refs, markEarly)
  }
  visitDates(data.goal, false, data.goal.goal_id, refs, markEarly)
  visitDates(data.cost_items, false, 'cost_items', refs, markEarly)
  visitDates(data.candidates, false, 'candidates', refs, markEarly)
  visitDates(data.offers, false, 'offers', refs, markEarly)
  visitDates(data.price_series, false, 'price_series', refs, markEarly, true)
  visitDates(data.consumption_records, false, 'consumption_records', refs, markEarly, true)
  visitDates(data.planned_allocation, false, 'planned_allocation', refs, markEarly)
  visitDates(data.confirmed_plan, false, 'confirmed_plan', refs, markEarly)
  visitDates(data.forecast_confirmations, false, 'forecast_confirmations', refs, markEarly)
  visitDates(data.confirmations, false, 'confirmations', refs, markEarly)
  visitDates(data.nl_script, false, 'nl_script', refs, markEarly)
  const uniqueRefs = unique(refs)
  if (uniqueRefs.length === 0) return { issue: null, preRangePaid }
  return { issue: { code: 'OUT_OF_RANGE', rule: 'R008', refs: uniqueRefs }, preRangePaid }
}

function coverageIssue(data: CaseFile): InputIssue | null {
  const refs: string[] = []
  for (const event of data.events) {
    if (event.coverage.length === 0) continue
    const covered = event.coverage.reduce((sum, item) => sum + item.covered_amount, 0)
    if (event.amount == null || covered > event.amount) refs.push(event.event_id)
  }
  if (refs.length === 0) return null
  return { code: 'COVERAGE_EXCEEDS_AMOUNT', rule: 'R003', refs }
}

/** 不依赖时间轴和报价的输入冲突 */
export function inputIssues(data: CaseFile, opIssues: readonly InputIssue[]): IssueReport {
  const issues = phaseIssues(data)
  // §11.1、R010：预算未填写单独列明，不并进其他缺失
  if (data.goal.budget_cap == null) issues.push({ code: 'MISSING_KEY_INFO', rule: 'R010', refs: ['goal.budget_cap'] })
  const currency = nonCnyIssue(data)
  if (currency != null) issues.push(currency)
  const range = rangeIssue(data)
  if (range.issue != null) issues.push(range.issue)
  const coverage = coverageIssue(data)
  if (coverage != null) issues.push(coverage)
  issues.push(...opIssues)
  return {
    issues,
    outOfRange: range.issue != null,
    preRangePaid: range.preRangePaid,
  }
}
