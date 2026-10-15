import type { EngineConfig } from '../config.ts'
import { DEMO_CFG_1 } from '../config.ts'
import type { ExcludedReasonCode, ItemCategory, PendingReasonCode, PriceBasis, Rounding } from '../enums.ts'
import { caseForecasts, type HoltForecast } from '../holt/index.ts'
import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { Money } from '../result.ts'

/** D13 五档，从高到低。 */
export const PRICE_BASIS_ORDER = ['QUOTE', 'FORECAST', 'REFERENCE', 'UNDATED_QUOTE', 'PENDING'] as const satisfies readonly PriceBasis[]

export type PricingReason<Code extends string> = {
  code: Code
  rule: string
  refs: string[]
}

export type PricedItem = {
  costItemId: string
  orderId: string
  index: number
  listPrice: Money | null
  payment: Money | null
  priceBasis: PriceBasis
  estimate: boolean
}

export type PricedCandidate = {
  candidateId: string
  items: PricedItem[]
  pendingReasons: PricingReason<PendingReasonCode>[]
  excludedReasons: PricingReason<ExcludedReasonCode>[]
  appliedUses: { offerId: string; count: number }[]
  futurePayable: Money | null
  eligibleReturn: Money | null
  netSpend: Money | null
  netSpendIfReceived: Money | null
}

type Candidate = NormalizedCase['candidates'][number]
type Item = Candidate['items'][number]
type Offer = NormalizedCase['offers'][number]
type OfferUse = Candidate['offersUsed'][number]
type Pending = PricingReason<PendingReasonCode>
type Excluded = PricingReason<ExcludedReasonCode>

type Line = {
  index: number
  costItemId: string
  orderId: string
  category: ItemCategory | null
  spec: string
  paymentAt: string
  purchaseDate: string
  list: number | null
  payment: number | null
  priceBasis: PriceBasis
  estimate: boolean
  rules: string[]
  arriveAt?: string
  departAt?: string
  lodgingNights?: string[]
  lodgingDistanceM?: number
  refundable?: boolean
}

type ReturnRec = {
  amount: number
  expectedAt: string
  trigger: string
  eventId: string | null
}

const INSTANT_TYPES = new Set<Offer['type']>(['INSTANT_OFF', 'THRESHOLD_OFF', 'PERCENT_OFF'])
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const OFFSET_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/
const PER_MYRIAD = 10000n

function civilDays(year: number, month: number, day: number): number {
  const shift = Math.floor((14 - month) / 12)
  const yearShifted = year + 4800 - shift
  const monthShifted = month + 12 * shift - 3
  return (
    day +
    Math.floor((153 * monthShifted + 2) / 5) +
    365 * yearShifted +
    Math.floor(yearShifted / 4) -
    Math.floor(yearShifted / 100) +
    Math.floor(yearShifted / 400) -
    32045
  )
}

function momentKey(value: string): number | null {
  const instant = OFFSET_INSTANT.exec(value)
  if (instant) {
    const days = civilDays(Number(instant[1]), Number(instant[2]), Number(instant[3]))
    return days * 1440 + Number(instant[4]) * 60 + Number(instant[5])
  }
  const date = DATE_ONLY.exec(value)
  if (date) return civilDays(Number(date[1]), Number(date[2]), Number(date[3])) * 1440
  return null
}

function calendarDate(value: string): string | null {
  const instant = OFFSET_INSTANT.exec(value)
  if (instant) return `${instant[1]}-${instant[2]}-${instant[3]}`
  const date = DATE_ONLY.exec(value)
  if (date) return `${date[1]}-${date[2]}-${date[3]}`
  return null
}

function dateInWindow(day: string, from: string | null, to: string | null): 'inside' | 'outside' | 'unknown' {
  if (from == null || to == null) return 'unknown'
  const start = calendarDate(from)
  const end = calendarDate(to)
  if (start == null || end == null) return 'unknown'
  if (day < start || day > end) return 'outside'
  return 'inside'
}

function pushUnique<T extends { code: string; rule: string; refs: string[] }>(list: T[], reason: T): void {
  const key = `${reason.code}|${reason.rule}|${reason.refs.join('\u001f')}`
  if (list.some((item) => `${item.code}|${item.rule}|${item.refs.join('\u001f')}` === key)) return
  list.push(reason)
}

function uniqueRules(rules: readonly string[]): string[] {
  const out: string[] = []
  for (const rule of rules) if (!out.includes(rule)) out.push(rule)
  return out
}

function roundShare(base: number, perMyriad: number, rounding: Exclude<Rounding, 'UNKNOWN'>): number | null {
  if (base < 0 || perMyriad < 0 || perMyriad > 10000) return null
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(perMyriad)) return null
  const product = BigInt(base) * BigInt(perMyriad)
  const quotient = product / PER_MYRIAD
  const remainder = product % PER_MYRIAD
  let payable = quotient
  if (rounding === 'CEIL' && remainder !== 0n) payable += 1n
  if (rounding === 'HALF_UP' && remainder * 2n >= PER_MYRIAD) payable += 1n
  const value = Number(payable)
  if (!Number.isSafeInteger(value)) return null
  return value
}

function sumNumbers(values: readonly number[]): number | null {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

type Resolved = {
  amount: number | null
  basis: PriceBasis
  estimate: boolean
  pending: Pending | null
  rules: string[]
}

/** D13：FORECAST 档只用已确认、且当前配置下合格（AVAILABLE）、确认价等于该预测整数分的结果 */
function confirmedForecast(
  data: NormalizedCase,
  item: Item,
  forecasts: readonly HoltForecast[],
  config: EngineConfig,
): number | null {
  const series = new Set<string>()
  for (const row of data.priceSeries) {
    if (row.costItemId === item.costItemId && row.channel === item.channel && row.spec === item.spec) series.add(row.seriesId)
  }
  const matches = data.forecastConfirmations.filter((row) => series.has(row.seriesId) && row.purchaseDate === item.purchaseDate)
  if (matches.length !== 1) return null
  const confirmation = matches[0]
  if (confirmation === undefined || confirmation.configVersion !== config.configVersion) return null
  const forecast = forecasts.find(
    (row) => row.seriesId === confirmation.seriesId && row.purchaseDate === item.purchaseDate && row.status === 'AVAILABLE',
  )
  if (forecast?.amount?.value !== confirmation.price) return null
  return confirmation.price
}

/**
 * §12.7（15）：已确认方案的 FORECAST 价格项按确认价计算，当前序列缺失或不再合格时不改为待填。
 * 只用于计划检查、行动清单和每日参考；candidates[] 的比较仍走 confirmedForecast（D13）。
 */
export function applyConfirmedPlanPrices(
  data: NormalizedCase,
  priced: PricedCandidate,
  config: EngineConfig,
): PricedCandidate {
  const candidate = data.candidates.find((row) => row.candidateId === priced.candidateId)
  if (candidate === undefined) return priced
  const filled = new Set<string>()
  const items = priced.items.map((row) => {
    const item = candidate.items[row.index]
    if (item === undefined || item.priceBasis !== 'FORECAST') return row
    const price = confirmedPlanPrice(data, item, config)
    if (price == null) return row
    filled.add(item.costItemId)
    const money = makeMoney(price, ['R009', 'D14'])
    return { ...row, listPrice: money, payment: money, priceBasis: 'FORECAST' as const, estimate: true }
  })
  if (filled.size === 0) return priced
  return {
    ...priced,
    items,
    pendingReasons: priced.pendingReasons.filter(
      (reason) => reason.code !== 'PRICE_PENDING' || reason.refs.some((ref) => !filled.has(ref)),
    ),
  }
}

/** 序列能对上时还要同 series_id；一条观测都没有时，购买日与配置版本都一致的确认只取唯一一条 */
function confirmedPlanPrice(data: NormalizedCase, item: Item, config: EngineConfig): number | null {
  const series = new Set<string>()
  for (const row of data.priceSeries) {
    if (row.costItemId === item.costItemId && row.channel === item.channel && row.spec === item.spec) series.add(row.seriesId)
  }
  const sameDay = data.forecastConfirmations.filter(
    (row) => row.purchaseDate === item.purchaseDate && row.configVersion === config.configVersion,
  )
  const matched = series.size > 0 ? sameDay.filter((row) => series.has(row.seriesId)) : sameDay
  if (matched.length !== 1) return null
  return matched[0]?.price ?? null
}

function resolvePrice(data: NormalizedCase, item: Item, forecasts: readonly HoltForecast[], config: EngineConfig): Resolved {
  const refs = [item.costItemId]
  if (item.currency !== 'CNY') {
    return { amount: null, basis: item.priceBasis, estimate: false, pending: { code: 'NON_CNY', rule: 'R008', refs }, rules: ['R008'] }
  }
  const window = dateInWindow(item.purchaseDate, item.quote.validFrom, item.quote.validTo)
  if (item.priceBasis === 'QUOTE') {
    if (window === 'outside') {
      return {
        amount: null,
        basis: 'QUOTE',
        estimate: false,
        pending: { code: 'QUOTE_EXPIRED', rule: 'R009', refs },
        rules: ['R009'],
      }
    }
    if (item.price == null) {
      return { amount: null, basis: 'PENDING', estimate: false, pending: { code: 'PRICE_PENDING', rule: 'R009', refs }, rules: ['R009'] }
    }
    if (window === 'unknown') {
      return { amount: item.price, basis: 'UNDATED_QUOTE', estimate: true, pending: null, rules: ['R009', 'D13', 'D43'] }
    }
    return { amount: item.price, basis: 'QUOTE', estimate: false, pending: null, rules: ['R009'] }
  }
  if (item.priceBasis === 'FORECAST') {
    const confirmed = confirmedForecast(data, item, forecasts, config)
    if (confirmed != null) {
      return { amount: confirmed, basis: 'FORECAST', estimate: true, pending: null, rules: ['R009', 'D14'] }
    }
    return {
      amount: null,
      basis: 'PENDING',
      estimate: false,
      pending: { code: 'PRICE_PENDING', rule: 'D13', refs },
      rules: ['D13', 'D14'],
    }
  }
  if (item.priceBasis === 'REFERENCE' || item.priceBasis === 'UNDATED_QUOTE') {
    if (item.price == null) {
      return { amount: null, basis: 'PENDING', estimate: false, pending: { code: 'PRICE_PENDING', rule: 'R009', refs }, rules: ['R009'] }
    }
    const rules = item.priceBasis === 'UNDATED_QUOTE' ? ['R009', 'D13', 'D43'] : ['R009', 'D13']
    return { amount: item.price, basis: item.priceBasis, estimate: true, pending: null, rules }
  }
  return { amount: null, basis: 'PENDING', estimate: false, pending: { code: 'PRICE_PENDING', rule: 'R009', refs }, rules: ['R009', 'D13'] }
}

function offerDays(offer: Offer, lines: readonly Line[], orderId: string): string[] | null {
  const inOrder = lines.filter((line) => line.orderId === orderId)
  if (offer.appliesAt === 'ORDER') return inOrder.map((line) => line.purchaseDate)
  const days: string[] = []
  for (const line of inOrder) {
    if (line.category == null || !offer.scope.includes(line.category)) continue
    const day = calendarDate(line.paymentAt)
    if (day == null) return null
    days.push(day)
  }
  return days
}

function windowOf(offer: Offer, days: readonly string[]): 'inside' | 'outside' | 'unknown' | 'mixed' {
  if (days.length === 0) return 'unknown'
  let inside = 0
  let outside = 0
  for (const day of days) {
    const state = dateInWindow(day, offer.validFrom, offer.validTo)
    if (state === 'unknown') return 'unknown'
    if (state === 'inside') inside += 1
    else outside += 1
  }
  if (inside > 0 && outside > 0) return 'mixed'
  return outside > 0 ? 'outside' : 'inside'
}

function allocate(lines: readonly Line[], reduction: number): void {
  const targets = lines.filter((line) => line.payment != null && line.payment > 0)
  const ordered = [...targets].sort((left, right) => {
    const later = (momentKey(right.paymentAt) ?? 0) - (momentKey(left.paymentAt) ?? 0)
    if (later !== 0) return later
    return right.index - left.index
  })
  let left = reduction
  for (const line of ordered) {
    if (left <= 0) break
    const payment = line.payment ?? 0
    const cut = payment < left ? payment : left
    line.payment = payment - cut
    left -= cut
  }
}

function sameReturn(left: ReturnRec, right: ReturnRec): boolean {
  return left.amount === right.amount && left.expectedAt === right.expectedAt && left.trigger === right.trigger
}

function historicalPaid(data: NormalizedCase): number | null {
  const amounts: number[] = []
  for (const event of data.events) {
    if (event.eventKind !== 'GOAL_PAYMENT' || event.eventStatus !== 'ACTUAL' || !event.inSnapshot) continue
    if (event.goalId !== undefined && event.goalId !== data.goal.goalId) continue
    if (event.currency !== 'CNY' || event.amount == null) continue
    amounts.push(event.amount)
  }
  return sumNumbers(amounts)
}

function sharedReturns(data: NormalizedCase): ReturnRec[] {
  const records: ReturnRec[] = []
  for (const event of data.events) {
    if (event.eventKind !== 'RETURN' || event.currency !== 'CNY') continue
    if (event.goalId !== undefined && event.goalId !== data.goal.goalId) continue
    if (event.amount == null || event.expectedAt == null) continue
    records.push({
      amount: event.amount,
      expectedAt: event.expectedAt,
      trigger: event.triggerCondition ?? '',
      eventId: event.eventId,
    })
  }
  return records
}

function combinationKey(candidate: Candidate): string {
  const items = candidate.items
    .map((item) => [item.costItemId, item.spec, item.purchaseDate, item.channel, String(item.price ?? ''), item.currency, item.orderId, item.paymentAt].join('\u001f'))
    .sort()
  const offers = candidate.offersUsed.map((use) => [use.offerId, use.orderId, String(use.sequence ?? '')].join('\u001f')).sort()
  return `${items.join('\u001e')}\u001d${offers.join('\u001e')}`
}

type Draft = {
  candidateId: string
  lines: Line[]
  pending: Pending[]
  excluded: Excluded[]
  applied: Map<string, number>
  cashbacks: ReturnRec[]
  returns: ReturnRec[]
}

function applyOne(offer: Offer, orderId: string, lines: Line[], pending: Pending[], excluded: Excluded[], cashbacks: ReturnRec[]): boolean {
  const scope = lines.filter((line) => line.orderId === orderId && line.category != null && offer.scope.includes(line.category))
  if (scope.length === 0) {
    pushUnique(excluded, { code: 'OFFER_SCOPE_MISMATCH', rule: 'D17', refs: [offer.offerId] })
    return false
  }
  const days = offerDays(offer, lines, orderId)
  const window = days == null ? 'unknown' : windowOf(offer, days)
  if (window === 'unknown' || window === 'mixed') {
    pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'R009', refs: [offer.offerId] })
    return false
  }
  if (window === 'outside') {
    pushUnique(excluded, { code: 'OFFER_EXPIRED', rule: 'R009', refs: [offer.offerId] })
    return false
  }
  if (offer.rounding === 'UNKNOWN') {
    pushUnique(pending, { code: 'ROUNDING_UNKNOWN', rule: 'D17', refs: [offer.offerId] })
    for (const line of scope) line.payment = null
    return false
  }
  if (scope.some((line) => line.list == null || line.payment == null)) return false
  if (offer.type === 'VOUCHER') return true
  if (offer.type === 'CASHBACK') {
    if (offer.expectedAt == null) {
      pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'D12', refs: [offer.offerId] })
      return false
    }
    cashbacks.push({
      amount: offer.value,
      expectedAt: offer.expectedAt,
      trigger: offer.triggerCondition ?? '',
      eventId: null,
    })
    return true
  }
  const base = sumNumbers(scope.map((line) => line.list ?? 0))
  if (base == null) {
    pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'D45', refs: [offer.offerId] })
    return false
  }
  const needsThreshold = offer.type === 'THRESHOLD_OFF' || offer.threshold != null
  if (needsThreshold) {
    if (offer.threshold == null) {
      pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'D17', refs: [offer.offerId] })
      return false
    }
    if (base < offer.threshold) {
      pushUnique(excluded, { code: 'OFFER_THRESHOLD_NOT_MET', rule: 'R009', refs: [offer.offerId] })
      return false
    }
  }
  let reduction = 0
  if (offer.type === 'INSTANT_OFF' || offer.type === 'THRESHOLD_OFF') reduction = offer.value
  if (offer.type === 'PERCENT_OFF') {
    const payable = roundShare(base, offer.value, offer.rounding)
    if (payable == null) {
      pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'D45', refs: [offer.offerId] })
      return false
    }
    reduction = base - payable
  }
  if (reduction < 0) reduction = 0
  allocate(scope, reduction)
  for (const line of scope) line.rules.push('D45', 'D65')
  return true
}

function checkCompatibility(data: NormalizedCase, lines: readonly Line[], pending: Pending[], excluded: Excluded[]): void {
  const goal = data.goal
  const ofKind = (category: ItemCategory) => lines.filter((line) => line.category === category)
  if (goal.arriveBeforeShowMin != null) {
    const outbound = ofKind('OUTBOUND_TRANSPORT')
    if (outbound.length === 0) {
      pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: ['arrive_before_show_min'] })
    }
    for (const line of outbound) {
      const show = momentKey(goal.showStartAt)
      const arrive = line.arriveAt == null ? null : momentKey(line.arriveAt)
      if (show == null || arrive == null) {
        pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: [line.costItemId] })
        continue
      }
      if (show - arrive < goal.arriveBeforeShowMin) {
        pushUnique(excluded, { code: 'ARRIVAL_TOO_LATE', rule: 'D16', refs: [line.costItemId] })
      }
    }
  }
  if (goal.returnAfterShowMin != null) {
    const returning = ofKind('RETURN_TRANSPORT')
    if (returning.length === 0) {
      pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: ['return_after_show_min'] })
    }
    for (const line of returning) {
      const end = momentKey(goal.showEndAt)
      const depart = line.departAt == null ? null : momentKey(line.departAt)
      if (end == null || depart == null) {
        pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: [line.costItemId] })
        continue
      }
      if (depart - end < goal.returnAfterShowMin) {
        pushUnique(excluded, { code: 'RETURN_TOO_EARLY', rule: 'D16', refs: [line.costItemId] })
      }
    }
  }
  if (goal.lodgingNightsRequired != null) {
    const lodgings = ofKind('LODGING')
    if (lodgings.length === 0 || lodgings.some((line) => line.lodgingNights == null)) {
      pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: ['lodging_nights_required'] })
    } else {
      const covered = new Set(lodgings.flatMap((line) => line.lodgingNights ?? []))
      if (goal.lodgingNightsRequired.some((day) => !covered.has(day))) {
        pushUnique(excluded, { code: 'LODGING_NIGHTS_NOT_COVERED', rule: 'D16', refs: ['lodging_nights_required'] })
      }
    }
  }
  if (goal.seatTierAllowed != null) {
    const tickets = ofKind('TICKET')
    if (tickets.length === 0) {
      pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: ['seat_tier_allowed'] })
    } else if (tickets.some((line) => !goal.seatTierAllowed?.includes(line.spec))) {
      pushUnique(excluded, { code: 'SEAT_TIER_NOT_ALLOWED', rule: 'D16', refs: tickets.map((line) => line.costItemId) })
    }
  }
  if (goal.lodgingMaxDistanceM != null) {
    const lodgings = ofKind('LODGING')
    const maxDistance = goal.lodgingMaxDistanceM
    if (lodgings.length === 0 || lodgings.some((line) => line.lodgingDistanceM == null)) {
      pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: ['lodging_max_distance_m'] })
    } else if (lodgings.some((line) => (line.lodgingDistanceM ?? 0) > maxDistance)) {
      pushUnique(excluded, { code: 'LODGING_TOO_FAR', rule: 'D16', refs: ['lodging_max_distance_m'] })
    }
  }
  if (goal.refundableRequired != null) {
    for (const category of goal.refundableRequired) {
      const matched = lines.filter((line) => line.category === category)
      if (matched.length === 0 || matched.some((line) => line.refundable == null)) {
        pushUnique(pending, { code: 'COMPARISON_FIELD_MISSING', rule: 'D16', refs: [category] })
      } else if (matched.some((line) => line.refundable === false)) {
        pushUnique(excluded, { code: 'NOT_REFUNDABLE', rule: 'D16', refs: [category] })
      }
    }
  }
}

function priceOne(data: NormalizedCase, candidate: Candidate, forecasts: readonly HoltForecast[], config: EngineConfig): Draft {
  const pending: Pending[] = []
  const excluded: Excluded[] = []
  const categories = new Map(data.costItems.map((item) => [item.costItemId, item.category]))
  const offers = new Map(data.offers.map((offer) => [offer.offerId, offer]))
  const lines: Line[] = candidate.items.map((item, index) => {
    const resolved = resolvePrice(data, item, forecasts, config)
    if (resolved.pending) pushUnique(pending, resolved.pending)
    const category = categories.get(item.costItemId) ?? null
    if (category == null) pushUnique(pending, { code: 'PRICE_PENDING', rule: 'R009', refs: [item.costItemId] })
    return {
      index,
      costItemId: item.costItemId,
      orderId: item.orderId,
      category,
      spec: item.spec,
      paymentAt: item.paymentAt,
      purchaseDate: item.purchaseDate,
      list: resolved.amount,
      payment: resolved.amount,
      priceBasis: resolved.basis,
      estimate: resolved.estimate,
      rules: [...resolved.rules],
      arriveAt: item.arriveAt,
      departAt: item.departAt,
      lodgingNights: item.lodgingNights,
      lodgingDistanceM: item.lodgingDistanceM,
      refundable: item.refundable,
    }
  })

  const applied = new Map<string, number>()
  const blocked = new Set<string>()
  const counts = new Map<string, number>()
  for (const use of candidate.offersUsed) counts.set(use.offerId, (counts.get(use.offerId) ?? 0) + 1)
  for (const [offerId, count] of counts) {
    const offer = offers.get(offerId)
    applied.set(offerId, 0)
    if (offer == null) {
      pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'D17', refs: [offerId] })
      blocked.add(offerId)
      continue
    }
    if (count > offer.maxUses) {
      pushUnique(excluded, { code: 'OFFER_MAX_USES_EXCEEDED', rule: 'D17', refs: [offerId] })
      blocked.add(offerId)
    }
  }

  const cashbacks: ReturnRec[] = []
  const byOrder = new Map<string, OfferUse[]>()
  for (const use of candidate.offersUsed) {
    const list = byOrder.get(use.orderId) ?? []
    list.push(use)
    byOrder.set(use.orderId, list)
  }
  for (const [orderId, uses] of byOrder) {
    const active = uses.filter((use) => !blocked.has(use.offerId) && offers.has(use.offerId))
    const instants = active.filter((use) => {
      const offer = offers.get(use.offerId)
      return offer != null && INSTANT_TYPES.has(offer.type)
    })
    let rejectInstants = false
    if (instants.length >= 2) {
      let stackOk = true
      for (let left = 0; left < instants.length; left += 1) {
        for (let right = left + 1; right < instants.length; right += 1) {
          const first = offers.get(instants[left]?.offerId ?? '')
          const second = offers.get(instants[right]?.offerId ?? '')
          if (first == null || second == null) continue
          if (!first.stackableWith.includes(second.offerId) || !second.stackableWith.includes(first.offerId)) {
            stackOk = false
            pushUnique(excluded, { code: 'OFFER_NOT_STACKABLE', rule: 'D17', refs: [first.offerId, second.offerId] })
          }
        }
      }
      if (!stackOk) rejectInstants = true
      else if (instants.some((use) => use.sequence === undefined)) {
        pushUnique(pending, { code: 'OFFER_ORDER_MISSING', rule: 'D45', refs: instants.map((use) => use.offerId) })
        rejectInstants = true
      }
    }
    const ordered = [...active].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
    for (const use of ordered) {
      const offer = offers.get(use.offerId)
      if (offer == null) continue
      if (rejectInstants && INSTANT_TYPES.has(offer.type)) continue
      const used = applyOne(offer, orderId, lines, pending, excluded, cashbacks)
      if (used) applied.set(offer.offerId, (applied.get(offer.offerId) ?? 0) + 1)
    }
  }

  const returns = candidate.returns.flatMap((item) => {
    if (item.currency !== 'CNY') {
      pushUnique(pending, { code: 'NON_CNY', rule: 'R008', refs: [item.eventId] })
      return []
    }
    if (item.amount == null || item.expectedAt == null) {
      pushUnique(pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'R005', refs: [item.eventId] })
      return []
    }
    return [
      {
        amount: item.amount,
        expectedAt: item.expectedAt,
        trigger: item.triggerCondition ?? '',
        eventId: item.eventId,
      },
    ]
  })

  checkCompatibility(data, lines, pending, excluded)
  return { candidateId: candidate.candidateId, lines, pending, excluded, applied, cashbacks, returns }
}

// SPEC-GAP SG-51：优惠返现与返还记录金额、到账日、触发条件都相同则只计一次；对不上则两笔都不计入
function countReturns(cashbacks: readonly ReturnRec[], returns: readonly ReturnRec[]): { eligible: number; conditional: number; eventIds: string[]; conflict: boolean } | null {
  const pool = [...returns]
  const paired: ReturnRec[] = []
  const unmatchedOffers: ReturnRec[] = []
  for (const cashback of cashbacks) {
    const index = pool.findIndex((item) => sameReturn(item, cashback))
    if (index >= 0) {
      const found = pool[index]
      if (found) paired.push(found)
      pool.splice(index, 1)
    } else unmatchedOffers.push(cashback)
  }
  if (unmatchedOffers.length > 0 && pool.length > 0) return null
  const counted = [...paired, ...unmatchedOffers, ...pool]
  let eligible = 0
  let conditional = 0
  const eventIds: string[] = []
  for (const item of counted) {
    if (item.trigger === '') eligible += item.amount
    else conditional += item.amount
    if (item.eventId != null && !eventIds.includes(item.eventId)) eventIds.push(item.eventId)
    if (!Number.isSafeInteger(eligible) || !Number.isSafeInteger(conditional)) return null
  }
  return { eligible, conditional, eventIds, conflict: false }
}

function mergeReturns(shared: readonly ReturnRec[], own: readonly ReturnRec[]): ReturnRec[] {
  const seen = new Set<string>()
  const out: ReturnRec[] = []
  for (const item of [...own, ...shared]) {
    if (item.eventId != null) {
      if (seen.has(item.eventId)) continue
      seen.add(item.eventId)
    }
    out.push(item)
  }
  return out
}

function finish(data: NormalizedCase, draft: Draft, paid: number): PricedCandidate {
  const settled = countReturns(draft.cashbacks, mergeReturns(sharedReturns(data), draft.returns))
  if (settled == null) {
    pushUnique(draft.pending, { code: 'OFFER_CONDITION_UNKNOWN', rule: 'D12', refs: draft.cashbacks.length > 0 ? ['CASHBACK'] : [] })
  }
  const pending = draft.pending.length > 0
  const payments = draft.lines.map((line) => line.payment)
  const payable = !pending && payments.every((value) => value != null) ? sumNumbers(payments.filter((value): value is number => value != null)) : null
  const returned = !pending && settled != null ? settled : null
  const net = payable != null && returned != null ? sumNumbers([paid, payable, -returned.eligible]) : null
  const netIf =
    payable != null && returned != null && returned.conditional > 0 ? sumNumbers([paid, payable, -returned.eligible, -returned.conditional]) : null
  const items: PricedItem[] = draft.lines.map((line) => ({
    costItemId: line.costItemId,
    orderId: line.orderId,
    index: line.index,
    listPrice: line.list == null ? null : makeMoney(line.list, uniqueRules(line.rules.filter((rule) => rule === 'R009' || rule === 'D13' || rule === 'D43' || rule === 'D14' || rule === 'R008'))),
    payment: line.payment == null ? null : makeMoney(line.payment, uniqueRules(line.rules)),
    priceBasis: line.priceBasis,
    estimate: line.estimate,
  }))
  return {
    candidateId: draft.candidateId,
    items,
    pendingReasons: draft.pending,
    excludedReasons: draft.excluded,
    appliedUses: [...draft.applied.entries()]
      .map(([offerId, count]) => ({ offerId, count }))
      .sort((left, right) => (left.offerId < right.offerId ? -1 : left.offerId > right.offerId ? 1 : 0)),
    futurePayable: payable == null ? null : makeMoney(payable, uniqueRules(draft.lines.flatMap((line) => line.rules))),
    eligibleReturn: returned == null ? null : makeMoney(returned.eligible, ['D12', 'D42'], [], returned.eventIds),
    netSpend: net == null ? null : makeMoney(net, returned != null && returned.eligible > 0 ? ['R007', 'D12'] : ['R007']),
    netSpendIfReceived: netIf == null ? null : makeMoney(netIf, ['D12', 'R007']),
  }
}

/** 逐个候选计算价格项、优惠、返还和相容性。不生成新组合，不排序。 */
export function priceCandidates(
  data: NormalizedCase,
  config: EngineConfig = DEMO_CFG_1,
  forecasts: readonly HoltForecast[] = caseForecasts(data, config),
): PricedCandidate[] {
  const paid = historicalPaid(data) ?? 0
  const drafts = data.candidates.map((candidate) => priceOne(data, candidate, forecasts, config))
  const seen = new Map<string, string>()
  for (const draft of drafts) {
    const candidate = data.candidates.find((item) => item.candidateId === draft.candidateId)
    if (candidate == null) continue
    const key = combinationKey(candidate)
    const first = seen.get(key)
    if (first === undefined) seen.set(key, draft.candidateId)
    else pushUnique(draft.excluded, { code: 'DUPLICATE_CANDIDATE', rule: 'R016', refs: [first] })
  }
  return drafts.map((draft) => finish(data, draft, paid))
}
