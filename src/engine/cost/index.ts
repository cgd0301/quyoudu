import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { PricedCandidate } from '../pricing/index.ts'
import type { Money, ResultCore } from '../result.ts'
import { goalPaymentCostItems, planItemId, type PlanLifecycle } from '../timeline/index.ts'

type CaseEvent = NormalizedCase['events'][number]
type Candidate = NormalizedCase['candidates'][number]
type CostItem = NormalizedCase['costItems'][number]

export type CostItemFact = {
  costItemId: string
  /** 已知金额；待填或没有金额来源时为 null。确认免费为 0 */
  amount: number | null
  confirmBasis: string | null
  pending: boolean
  estimate: boolean
  forecast: boolean
  at: string | null
}

export type DatedAmount = {
  id: string
  amount: number
  at: string | null
}

export type CostInput = {
  data: NormalizedCase
  candidateId: string | null
  priced: PricedCandidate | undefined
  lifecycle: PlanLifecycle
  snapshot: ResultCore['snapshot']
}

export type CostReport = {
  cost: ResultCore['cost']
  unresolvedNecessary: boolean
  facts: CostItemFact[]
  /** 尚未到账、已计入 R 的无条件返还 */
  futureReturns: DatedAmount[]
}

type Line = {
  eventId: string
  costItemId: string | null
  at: string | null
  amount: number
  rules: string[]
}

type Track = {
  amount: number
  at: string | null
  estimate: boolean
  forecast: boolean
}

type Refund = DatedAmount & {
  condition: string | null
  received: boolean
}

function uniq(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) if (!out.includes(value)) out.push(value)
  return out
}

function sum(values: readonly number[]): number | null {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

function copyMoney(money: Money): Money {
  return makeMoney(money.value, money.basis.rules, money.basis.reserveIds, money.basis.eventIds)
}

function atOf(event: CaseEvent): string | null {
  if (event.eventStatus === 'ACTUAL') return event.actualAt ?? event.expectedAt ?? null
  return event.expectedAt ?? null
}

function goalScoped(event: { goalId?: string }, goalId: string): boolean {
  return event.goalId === undefined || event.goalId === goalId
}

function isGoalPayment(event: CaseEvent, goalId: string): boolean {
  return event.eventKind === 'GOAL_PAYMENT' && event.currency === 'CNY' && goalScoped(event, goalId)
}

/** D61：取消后仍有效的付款。未购买、也没有未取消价格项的必要费用不是仍有效义务 */
function obligedCostItems(
  data: NormalizedCase,
  candidate: Candidate | undefined,
  lifecycle: PlanLifecycle,
  goalId: string,
): Set<string> {
  const ids = new Set<string>()
  for (const event of data.events) {
    if (!isGoalPayment(event, goalId) || event.costItemId === undefined) continue
    const settled = event.inSnapshot && event.eventStatus === 'ACTUAL'
    if (lifecycle === 'CANCELLED' && event.cancellable === true && !settled) continue
    ids.add(event.costItemId)
  }
  for (const item of candidate?.items ?? []) {
    if (lifecycle === 'CANCELLED' && item.cancellable === true) continue
    ids.add(item.costItemId)
  }
  return ids
}

function fact(
  item: CostItem,
  amount: number | null,
  pending: boolean,
  estimate: boolean,
  forecast: boolean,
  at: string | null,
): CostItemFact {
  return {
    costItemId: item.costItemId,
    amount,
    confirmBasis: item.confirmBasis ?? null,
    pending,
    estimate,
    forecast,
    at,
  }
}

function addTrack(track: Map<string, Track>, id: string, amount: number, at: string | null, estimate: boolean, forecast: boolean): void {
  const prev = track.get(id)
  if (prev === undefined) {
    track.set(id, { amount, at, estimate, forecast })
    return
  }
  prev.amount += amount
  prev.estimate = prev.estimate || estimate
  prev.forecast = prev.forecast || forecast
  if (prev.at == null) prev.at = at
}

/** 无条件计入 R；有触发条件的是可能退回，不入账（D12、§3） */
function collectRefunds(data: NormalizedCase, candidate: Candidate | undefined): Refund[] {
  const goalId = data.goal.goalId
  const seen = new Set<string>()
  const refunds: Refund[] = []
  const push = (id: string, amount: number | null, at: string | null, condition: string | null, received: boolean) => {
    if (seen.has(id) || amount == null || amount < 0 || at == null) return
    seen.add(id)
    refunds.push({ id, amount, at, condition, received })
  }
  for (const event of data.events) {
    if (event.eventKind !== 'RETURN' || event.currency !== 'CNY' || !goalScoped(event, goalId)) continue
    const condition = event.triggerCondition == null || event.triggerCondition === '' ? null : event.triggerCondition
    push(event.eventId, event.amount, atOf(event), condition, event.inSnapshot && event.eventStatus === 'ACTUAL')
  }
  for (const item of candidate?.returns ?? []) {
    if (item.currency !== 'CNY') continue
    const condition = item.triggerCondition == null || item.triggerCondition === '' ? null : item.triggerCondition
    push(item.eventId, item.amount, item.expectedAt, condition, false)
  }
  return refunds
}

function toPayment(line: Line): ResultCore['cost']['paidPayments'][number] {
  return {
    eventId: line.eventId,
    costItemId: line.costItemId,
    at: line.at,
    amount: makeMoney(line.amount, line.rules, [], [line.eventId]),
  }
}

function byPayment(left: Line, right: Line): number {
  const at = (left.at ?? '\uffff').localeCompare(right.at ?? '\uffff')
  if (at !== 0) return at
  return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0
}

/**
 * §3：P + F − R。历史实付不随候选报价改写（R007、T002-05）。
 * 必要金额待填时净额和后续应付为 null，不按 0。
 * 多笔可能退回见 SPEC-GAP SG-59。
 */
export function buildCost(input: CostInput): CostReport {
  const { data, lifecycle } = input
  const goalId = data.goal.goalId
  const costById = new Map(data.costItems.map((item) => [item.costItemId, item]))
  const candidate =
    input.candidateId == null ? undefined : data.candidates.find((item) => item.candidateId === input.candidateId)
  const track = new Map<string, Track>()
  const goalPaymentIds = goalPaymentCostItems(data, lifecycle)
  const paidLines: Line[] = []
  const futureLines: Line[] = []
  let unresolved = false

  for (const event of data.events) {
    if (!isGoalPayment(event, goalId)) continue
    const settled = event.inSnapshot && event.eventStatus === 'ACTUAL'
    if (lifecycle === 'CANCELLED' && event.cancellable === true && !settled) continue
    if (event.amount == null || event.amount < 0) {
      unresolved = true
      continue
    }
    const at = atOf(event)
    if (event.costItemId !== undefined) addTrack(track, event.costItemId, event.amount, at, false, false)
    if (event.amount === 0) continue
    const line: Line = { eventId: event.eventId, costItemId: event.costItemId ?? null, at, amount: event.amount, rules: ['R007'] }
    if (settled) paidLines.push(line)
    else futureLines.push(line)
  }

  candidate?.items.forEach((item, index) => {
    const status = costById.get(item.costItemId)?.amountStatus
    if (status === 'PENDING' || status === 'NOT_APPLICABLE' || status === 'CONFIRMED_FREE') return
    if (lifecycle === 'CANCELLED' && item.cancellable === true) return
    // D75：同一项目已有本目标付款事件时，不带 settles_event_id 的价格项是已购项目的另一报价，不加进 F
    if (item.settlesEventId === undefined && goalPaymentIds.has(item.costItemId)) return
    const row = input.priced?.items.find((priced) => priced.index === index)
    const payment = row?.payment ?? null
    if (payment == null || row === undefined) {
      unresolved = true
      return
    }
    const forecast = row.priceBasis === 'FORECAST'
    const estimate = !forecast && (row.estimate || status === 'ESTIMATE')
    addTrack(track, item.costItemId, payment.value, item.paymentAt, estimate, forecast)
    if (payment.value === 0) return
    futureLines.push({
      eventId: planItemId(candidate.candidateId, index, item.costItemId),
      costItemId: item.costItemId,
      at: item.paymentAt,
      amount: payment.value,
      rules: uniq(['R007', ...payment.basis.rules]),
    })
  })

  const facts: CostItemFact[] = []
  const pendingIds: string[] = []
  const obliged = obligedCostItems(data, candidate, lifecycle, goalId)
  const waived = (id: string) => lifecycle === 'CANCELLED' && !obliged.has(id)
  for (const item of data.costItems) {
    if (item.amountStatus === 'NOT_APPLICABLE') {
      facts.push(fact(item, null, false, false, false, null))
      continue
    }
    if (item.amountStatus === 'PENDING') {
      if (waived(item.costItemId)) {
        facts.push(fact(item, null, false, false, false, null))
        continue
      }
      if (item.necessary) unresolved = true
      pendingIds.push(item.costItemId)
      facts.push(fact(item, null, true, false, false, null))
      continue
    }
    if (item.amountStatus === 'CONFIRMED_FREE') {
      facts.push(fact(item, 0, false, false, false, null))
      continue
    }
    const known = track.get(item.costItemId)
    if (known === undefined) {
      if (waived(item.costItemId)) {
        facts.push(fact(item, null, false, item.amountStatus === 'ESTIMATE', false, null))
        continue
      }
      // R016：有计划对象时，缺金额的必要项目列入待填；没有计划对象时只列 amount_status 为 PENDING 的（§12.7（12））
      if (item.necessary) {
        unresolved = true
        if (input.candidateId != null) pendingIds.push(item.costItemId)
      }
      facts.push(fact(item, null, false, item.amountStatus === 'ESTIMATE', false, null))
      continue
    }
    const forecast = known.forecast
    const estimate = !forecast && (known.estimate || item.amountStatus === 'ESTIMATE')
    facts.push(fact(item, known.amount, false, estimate, forecast, known.at))
  }

  const refunds = collectRefunds(data, candidate)
  const eligible = refunds.filter((item) => item.condition == null)
  const conditional = refunds.filter((item) => item.condition != null)
  const paidTotal = sum(paidLines.map((line) => line.amount)) ?? 0
  const futureTotal = sum(futureLines.map((line) => line.amount))
  const eligibleTotal = sum(eligible.map((item) => item.amount))
  const conditionalTotal = sum(conditional.map((item) => item.amount))
  const complete = !unresolved && futureTotal != null && eligibleTotal != null && conditionalTotal != null
  const net = complete ? paidTotal + (futureTotal ?? 0) - (eligibleTotal ?? 0) : null
  const netValue = net != null && Number.isSafeInteger(net) ? net : null
  const budget = data.goal.budgetCap
  const overrun = netValue != null && budget != null && netValue > budget ? netValue - budget : null
  const paidIds = paidLines.map((line) => line.eventId)
  const futureIds = futureLines.map((line) => line.eventId)
  const eligibleIds = eligible.map((item) => item.id)
  const netIds = uniq([...paidIds, ...futureIds, ...eligibleIds])
  const returnRules = (eligibleTotal ?? 0) > 0 ? ['R007', 'D12', 'D42'] : ['R007']
  const netRules = (eligibleTotal ?? 0) > 0 ? ['R007', 'D12'] : ['R007']
  // SPEC-GAP SG-59：多于一笔时不合并
  const onlyConditional = conditional.length === 1 ? conditional[0] : undefined
  const refundCondition = onlyConditional?.condition
  const possibleRefund =
    onlyConditional === undefined || refundCondition == null
      ? null
      : {
          amount: makeMoney(onlyConditional.amount, ['R012'], [], [onlyConditional.id]),
          condition: refundCondition,
        }
  const snapshot = input.snapshot
  const protectedReserves =
    snapshot == null
      ? {
          livingReserve: makeMoney(0, ['§1']),
          otherProtectedReserve: makeMoney(0, ['§1']),
          otherGoalHold: makeMoney(0, ['D09']),
        }
      : {
          livingReserve: copyMoney(snapshot.livingReserve),
          otherProtectedReserve: copyMoney(snapshot.otherProtectedReserve),
          otherGoalHold: copyMoney(snapshot.otherGoalHold),
        }
  const netIf =
    netValue != null && conditionalTotal != null && conditionalTotal > 0 ? netValue - conditionalTotal : null
  paidLines.sort(byPayment)
  futureLines.sort(byPayment)
  return {
    unresolvedNecessary: unresolved,
    facts,
    futureReturns: eligible.filter((item) => !item.received).map((item) => ({ id: item.id, amount: item.amount, at: item.at })),
    cost: {
      paidTotal: makeMoney(paidTotal, ['R007'], [], paidIds),
      futurePayable: complete && futureTotal != null ? makeMoney(futureTotal, ['R007'], [], futureIds) : null,
      eligibleReturn: makeMoney(eligibleTotal ?? 0, returnRules, [], eligibleIds),
      netSpend: netValue == null ? null : makeMoney(netValue, netRules, [], netIds),
      netSpendIfReceived: netIf == null || !Number.isSafeInteger(netIf) ? null : makeMoney(netIf, ['D12', 'R007'], [], netIds),
      budgetOverrun: overrun == null ? null : makeMoney(overrun, ['§3', 'R007'], [], netIds),
      paidPayments: paidLines.map(toPayment),
      futurePayments: futureLines.map(toPayment),
      protectedReserves,
      contingencyReserve: snapshot == null ? makeMoney(0, ['D09']) : copyMoney(snapshot.contingencyReserve),
      pendingCostItemIds: pendingIds,
      possibleRefund,
    },
  }
}
