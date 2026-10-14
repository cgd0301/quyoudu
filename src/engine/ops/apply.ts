import type { InputIssue } from '../issues/index.ts'
import { caseFileSchema, type CaseFile } from '../schema.ts'
import type { Op } from './schema.ts'

export type Mutation = {
  data: CaseFile
  issue: InputIssue | null
  createdReserves: Map<string, string>
}

const PAYMENT_KINDS = new Set(['GOAL_PAYMENT', 'OTHER_EXPENSE', 'INCOME', 'RETURN'])

// D71：新建事件的记录时间、币种、精度和预留覆盖期
function timePrecisionOf(instant: string): 'DATE' | 'DATETIME' {
  return instant.includes('T') ? 'DATETIME' : 'DATE'
}

function calendarDateOf(instant: string): string {
  return instant.slice(0, 10)
}

function eventDay(event: CaseFile['events'][number]): string | null {
  const instant = event.actual_at ?? event.expected_at
  if (instant == null) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return instant
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(instant)) return instant.slice(0, 10)
  return null
}

function referenceIssue(refs: string[]): InputIssue {
  // SPEC-GAP SG-45：引用的窗口、预留或预计收付款不存在时不改案例，版本仍加 1
  return { code: 'REFERENCE_INVALID', rule: '§12.4', refs }
}

function decodeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function pointerTokens(path: string): string[] {
  if (!path.startsWith('/')) throw new Error(`PATCH 路径不是 JSON Pointer：${path}`)
  if (path === '/') return []
  return path.slice(1).split('/').map(decodeToken)
}

function arrayIndex(token: string, length: number, path: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Error(`PATCH 路径不存在：${path}`)
  const index = Number(token)
  if (!Number.isSafeInteger(index) || index >= length) throw new Error(`PATCH 路径不存在：${path}`)
  return index
}

function childAt(parent: unknown, token: string, path: string): unknown {
  if (Array.isArray(parent)) return parent[arrayIndex(token, parent.length, path)]
  if (parent !== null && typeof parent === 'object' && Object.hasOwn(parent, token)) {
    return (parent as Record<string, unknown>)[token]
  }
  throw new Error(`PATCH 路径不存在：${path}`)
}

function replaceAt(parent: unknown, token: string, value: unknown, path: string): void {
  if (Array.isArray(parent)) {
    parent[arrayIndex(token, parent.length, path)] = value
    return
  }
  if (parent !== null && typeof parent === 'object' && Object.hasOwn(parent, token)) {
    ;(parent as Record<string, unknown>)[token] = value
    return
  }
  throw new Error(`PATCH 路径不存在：${path}`)
}

function applyPatch(data: CaseFile, path: string, value: unknown): CaseFile {
  const tokens = pointerTokens(path)
  if (tokens.length === 0) {
    const parsed = caseFileSchema.safeParse(value)
    if (!parsed.success) throw new Error(`PATCH 替换后未通过 caseFileSchema：${parsed.error.message}`)
    return parsed.data
  }
  const next = structuredClone(data)
  let parent: unknown = next
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    if (token === undefined) throw new Error(`PATCH 路径不存在：${path}`)
    parent = childAt(parent, token, path)
  }
  const last = tokens[tokens.length - 1]
  if (last === undefined) throw new Error(`PATCH 路径不存在：${path}`)
  replaceAt(parent, last, value, path)
  const parsed = caseFileSchema.safeParse(next)
  if (!parsed.success) throw new Error(`PATCH 替换后未通过 caseFileSchema：${parsed.error.message}`)
  return parsed.data
}

function countedOnAsOfDay(data: CaseFile): number {
  const day = calendarDateOf(data.snapshot.as_of)
  return data.events.filter((event) => PAYMENT_KINDS.has(event.event_kind) && event.in_snapshot && eventDay(event) === day)
    .length
}

function markPhase(data: CaseFile): void {
  const count = countedOnAsOfDay(data)
  if (count >= 1) data.snapshot.snapshot_phase = `AFTER_EVENT(${count})`
}

function settleSpend(data: CaseFile, event: CaseFile['events'][number]): void {
  const amount = event.amount
  if (amount == null) return
  if (data.snapshot.cash != null) data.snapshot.cash -= amount
  let writtenOff = 0
  for (const coverage of event.coverage) {
    const reserve = data.reserves.find((item) => item.reserve_id === coverage.reserve_id)
    if (reserve == null) continue
    const take = Math.min(Math.max(reserve.amount, 0), coverage.covered_amount)
    reserve.amount -= take
    writtenOff += take
  }
  const goalPayment = event.event_kind === 'GOAL_PAYMENT' || event.goal_id !== undefined
  if (!goalPayment) return
  const remainder = amount - writtenOff
  if (remainder <= 0) return
  const reduce = Math.min(remainder, data.snapshot.goal_allocation)
  data.snapshot.goal_allocation -= reduce
}

type Coverage = CaseFile['events'][number]['coverage']

function coveredBy(coverage: Coverage, reserveId: string): number {
  return coverage.reduce((sum, item) => (item.reserve_id === reserveId ? sum + item.covered_amount : sum), 0)
}

/** D71：已计入快照的事件再次提交时，按金额和各项覆盖额的差额调整现金、预留和 A；都不变时只计一次 */
function resettleSpend(data: CaseFile, before: { amount: number | null; coverage: Coverage }, event: CaseFile['events'][number]): void {
  const delta = (event.amount ?? 0) - (before.amount ?? 0)
  if (data.snapshot.cash != null) data.snapshot.cash -= delta
  let writtenOff = 0
  for (const reserveId of new Set([...before.coverage, ...event.coverage].map((item) => item.reserve_id))) {
    const reserve = data.reserves.find((item) => item.reserve_id === reserveId)
    if (reserve == null) continue
    const change = coveredBy(event.coverage, reserveId) - coveredBy(before.coverage, reserveId)
    const moved = change > 0 ? Math.min(Math.max(reserve.amount, 0), change) : change
    reserve.amount -= moved
    writtenOff += moved
  }
  if (event.event_kind !== 'GOAL_PAYMENT' && event.goal_id === undefined) return
  const uncovered = delta - writtenOff
  data.snapshot.goal_allocation -= uncovered > 0 ? Math.min(uncovered, Math.max(0, data.snapshot.goal_allocation)) : uncovered
}

function applyTodaySpend(data: CaseFile, op: Extract<Op, { type: 'ADD_TODAY_SPEND' }>): void {
  const existing = data.events.find((event) => event.event_id === op.event_id)
  const wasInSnapshot = existing?.in_snapshot ?? false
  const before = existing === undefined ? null : { amount: existing.amount, coverage: existing.coverage.map((item) => ({ ...item })) }
  const coverage = op.coverage.map((item) => ({ reserve_id: item.reserve_id, covered_amount: item.covered_amount }))
  let event = existing
  if (event == null) {
    event = {
      event_id: op.event_id,
      event_kind: op.goal_id === undefined ? 'OTHER_EXPENSE' : 'GOAL_PAYMENT',
      event_status: 'ACTUAL',
      amount: op.amount,
      expected_at: op.actual_at,
      actual_at: op.actual_at,
      time_precision: timePrecisionOf(op.actual_at),
      in_snapshot: true,
      coverage,
      recorded_at: data.snapshot.as_of,
      available_at: data.snapshot.as_of,
      currency: 'CNY',
    }
    if (op.goal_id !== undefined) event.goal_id = op.goal_id
    if (op.cost_item_id !== undefined) event.cost_item_id = op.cost_item_id
    if (op.category !== undefined) event.category = op.category
    data.events.push(event)
  } else {
    event.event_status = 'ACTUAL'
    event.amount = op.amount
    event.actual_at = op.actual_at
    event.in_snapshot = true
    event.time_precision = timePrecisionOf(op.actual_at)
    event.coverage = coverage
    if (op.goal_id !== undefined) event.goal_id = op.goal_id
    if (op.cost_item_id !== undefined) event.cost_item_id = op.cost_item_id
    if (op.category !== undefined) event.category = op.category
  }
  if (!wasInSnapshot) settleSpend(data, event)
  else if (before !== null) resettleSpend(data, before, event)
  markPhase(data)
}

function applyLivingExpense(
  data: CaseFile,
  created: Map<string, string>,
  op: Extract<Op, { type: 'ADD_LIVING_EXPENSE' }>,
): InputIssue | null {
  const previous = created.get(op.event_id)
  if (previous !== undefined) {
    data.reserves = data.reserves.filter((reserve) => reserve.reserve_id !== previous)
    created.delete(op.event_id)
  }
  let issue: InputIssue | null = null
  if (op.cover_mode === 'NEW_RESERVE') {
    const day = calendarDateOf(op.expected_at)
    data.reserves = data.reserves.filter((reserve) => reserve.reserve_id !== op.reserve_id)
    data.reserves.push({
      reserve_id: op.reserve_id,
      reserve_kind: 'LIVING',
      amount: op.amount,
      coverage_start: day,
      coverage_end: day,
      release_at_end: false,
    })
    created.set(op.event_id, op.reserve_id)
  } else if (!data.reserves.some((reserve) => reserve.reserve_id === op.reserve_id)) {
    issue = referenceIssue([op.reserve_id])
  }
  const coverage = [{ reserve_id: op.reserve_id, covered_amount: op.amount }]
  const existing = data.events.find((event) => event.event_id === op.event_id)
  if (existing == null) {
    const event: CaseFile['events'][number] = {
      event_id: op.event_id,
      event_kind: 'OTHER_EXPENSE',
      event_status: 'EXPECTED',
      amount: op.amount,
      expected_at: op.expected_at,
      time_precision: timePrecisionOf(op.expected_at),
      in_snapshot: false,
      coverage,
      recorded_at: data.snapshot.as_of,
      available_at: data.snapshot.as_of,
      currency: 'CNY',
    }
    if (op.category !== undefined) event.category = op.category
    data.events.push(event)
  } else {
    existing.event_kind = 'OTHER_EXPENSE'
    existing.event_status = 'EXPECTED'
    existing.amount = op.amount
    existing.expected_at = op.expected_at
    existing.time_precision = timePrecisionOf(op.expected_at)
    existing.in_snapshot = false
    existing.coverage = coverage
    if (op.category !== undefined) existing.category = op.category
  }
  return issue
}

function applyDelay(data: CaseFile, op: Extract<Op, { type: 'DELAY_INCOME' }>): InputIssue | null {
  const event = data.events.find((item) => item.event_id === op.event_id)
  const applicable =
    event != null && (event.event_kind === 'INCOME' || event.event_kind === 'RETURN') && event.event_status === 'EXPECTED'
  if (!applicable || event == null) return referenceIssue([op.event_id])
  event.expected_at = op.expected_at
  event.time_precision = timePrecisionOf(op.expected_at)
  return null
}

function applyPaymentDate(data: CaseFile, op: Extract<Op, { type: 'CHANGE_PAYMENT_DATE' }>): InputIssue | null {
  let found = false
  for (const event of data.events) {
    const window = event.payment_windows?.find((item) => item.window_id === op.window_id)
    if (window == null) continue
    event.expected_at = window.expected_at
    event.time_precision = timePrecisionOf(window.expected_at)
    found = true
  }
  for (const candidate of data.candidates) {
    for (const item of candidate.items) {
      const window = item.payment_windows?.find((entry) => entry.window_id === op.window_id)
      if (window == null) continue
      item.payment_at = window.payment_at
      found = true
    }
  }
  if (!found) return referenceIssue([op.window_id])
  return null
}

/** 纯函数：不修改入参。CONFIRM、CONFIRM_FORECASTS、SELECT_CANDIDATE、EVALUATE 不改案例 */
export function applyMutation(data: CaseFile, op: Op, createdReserves: ReadonlyMap<string, string>): Mutation {
  const created = new Map(createdReserves)
  if (op.type === 'EVALUATE' || op.type === 'SELECT_CANDIDATE' || op.type === 'CONFIRM' || op.type === 'CONFIRM_FORECASTS') {
    return { data: structuredClone(data), issue: null, createdReserves: created }
  }
  if (op.type === 'PATCH') {
    return { data: applyPatch(data, op.path, op.value), issue: null, createdReserves: created }
  }
  const next = structuredClone(data)
  if (op.type === 'SET_ALLOCATION') {
    next.snapshot.goal_allocation = op.goal_allocation
    return { data: next, issue: null, createdReserves: created }
  }
  if (op.type === 'PAUSE') return { data: next, issue: null, createdReserves: created }
  if (op.type === 'CANCEL') {
    next.snapshot.goal_allocation = 0
    return { data: next, issue: null, createdReserves: created }
  }
  if (op.type === 'DELAY_INCOME') return { data: next, issue: applyDelay(next, op), createdReserves: created }
  if (op.type === 'CHANGE_PAYMENT_DATE') return { data: next, issue: applyPaymentDate(next, op), createdReserves: created }
  if (op.type === 'ADD_LIVING_EXPENSE') return { data: next, issue: applyLivingExpense(next, created, op), createdReserves: created }
  applyTodaySpend(next, op)
  return { data: next, issue: null, createdReserves: created }
}
