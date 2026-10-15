import type { InputIssueCode } from '../enums.ts'
import type { InputIssue } from '../issues/index.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import { dayOf, isInstant, nextDay } from './dates.ts'
import type { PlanContext, PlanLifecycle, TimelineEvent, TimelineInput, TimelineReserve } from './types.ts'

type CaseEvent = NormalizedCase['events'][number]
type Candidate = NormalizedCase['candidates'][number]

// D72：引擎生成的机动预留释放没有 event_id
export const RELEASE_ID = 'AUTO:CONTINGENCY_RELEASE'

const OUTFLOWS: ReadonlySet<CaseEvent['eventKind']> = new Set(['GOAL_PAYMENT', 'OTHER_EXPENSE'])

// D72：价格项没有 event_id，按候选、序号和项目编号标识它形成的本目标付款
export function planItemId(candidateId: string, index: number, costItemId: string): string {
  return `PLAN:${candidateId}:${index}:${costItemId}`
}

type Issues = {
  add: (code: InputIssueCode, rule: string, ref: string) => void
  list: () => InputIssue[]
}

/** 同一代码只记一条，refs 去重 */
function issueList(): Issues {
  const found = new Map<InputIssueCode, InputIssue>()
  return {
    add(code, rule, ref) {
      const issue = found.get(code) ?? { code, rule, refs: [] }
      if (!issue.refs.includes(ref)) issue.refs.push(ref)
      found.set(code, issue)
    },
    list: () => [...found.values()],
  }
}

type When = {
  at: string
  day: string
  past: boolean
}

// §10.1 第7步：有时刻精度的与 cash_as_of 比较，只有日期的与 as_of 所在日比较
function whenOf(raw: string | null | undefined, timed: boolean, asOfDay: string | null, cashAsOf: string): When | null {
  if (raw == null) return null
  const day = dayOf(raw)
  if (day === null) return null
  const past = timed && isInstant(raw) && isInstant(cashAsOf) ? raw < cashAsOf : asOfDay !== null && day < asOfDay
  return { at: raw, day, past }
}

/** D64 */
function isConfirmedIncome(event: CaseEvent): boolean {
  return (
    event.eventKind === 'INCOME' &&
    event.eventStatus === 'EXPECTED' &&
    event.amount != null &&
    event.expectedAt != null &&
    event.triggerCondition === undefined
  )
}

function isGoalReturn(event: CaseEvent, goalId: string): boolean {
  return event.eventKind === 'RETURN' && (event.goalId === undefined || event.goalId === goalId)
}

/** D75：events[] 中已有本目标付款（已付或预计）的费用项目；已取消时 cancellable 为 true 的未付事件不算（D61） */
export function goalPaymentCostItems(data: NormalizedCase, lifecycle: PlanLifecycle): Set<string> {
  const ids = new Set<string>()
  for (const event of data.events) {
    if (event.eventKind !== 'GOAL_PAYMENT' || event.currency !== 'CNY' || event.costItemId === undefined) continue
    if (event.goalId !== undefined && event.goalId !== data.goal.goalId) continue
    const settled = event.inSnapshot && event.eventStatus === 'ACTUAL'
    if (lifecycle === 'CANCELLED' && event.cancellable === true && !settled) continue
    ids.add(event.costItemId)
  }
  return ids
}

function settlesPayment(data: NormalizedCase, item: Candidate['items'][number]): boolean {
  return data.events.some(
    (event) => event.eventId === item.settlesEventId && event.eventKind === 'GOAL_PAYMENT' && event.costItemId === item.costItemId,
  )
}

/** D47：已确认方案，否则当前选中的候选；都没有时原因为尚未形成方案 */
function planCandidate(data: NormalizedCase, plan: PlanContext, issues: Issues): Candidate | null {
  if (plan.candidateId === null) {
    issues.add('NO_PLAN', 'D47', data.goal.goalId)
    return null
  }
  const found = data.candidates.find((candidate) => candidate.candidateId === plan.candidateId)
  if (found === undefined) {
    issues.add('REFERENCE_INVALID', 'D47', plan.candidateId)
    return null
  }
  return found
}

function releaseEvent(id: string, at: string, day: string): TimelineEvent {
  return { id, kind: 'CONTINGENCY_RELEASE', amount: 0, at, day, coverage: [], goalRelated: false, confirmedIncome: false }
}

// D73：没有机动预留、返程到达未知或案例自带释放事件时不生成
function releaseDay(data: NormalizedCase, candidate: Candidate): string | null {
  if (data.events.some((event) => event.eventKind === 'CONTINGENCY_RELEASE')) return null
  if (!data.reserves.some((reserve) => reserve.reserveKind === 'CONTINGENCY')) return null
  const categories = new Map(data.costItems.map((item) => [item.costItemId, item.category]))
  let end = dayOf(data.goal.showEndAt)
  if (end === null) return null
  // D39；D55：取消不改释放时点，按取消前的计划对象取返程
  for (const item of candidate.items) {
    if (categories.get(item.costItemId) !== 'RETURN_TRANSPORT') continue
    const arrive = item.arriveAt === undefined ? null : dayOf(item.arriveAt)
    if (arrive === null) return null
    if (arrive > end) end = arrive
  }
  return nextDay(end)
}

function commonEvents(data: NormalizedCase, cancelled: boolean, asOfDay: string | null, issues: Issues): TimelineEvent[] {
  const cashAsOf = data.snapshot.cashAsOf
  const reserveIds = new Set(data.reserves.map((reserve) => reserve.reserveId))
  const events: TimelineEvent[] = []
  for (const event of data.events) {
    // R002、D03：已计入快照的事件不再改变未来现金
    if (event.inSnapshot) continue
    for (const cover of event.coverage) {
      // D74
      if (!reserveIds.has(cover.reserveId)) issues.add('REFERENCE_INVALID', '§12.1', cover.reserveId)
    }
    // R005、D64：依赖后续条件的只进对应条件模拟；R008：非人民币已由输入冲突报告
    if (event.triggerCondition !== undefined || event.currency !== 'CNY') continue
    const outflow = OUTFLOWS.has(event.eventKind)
    const goalReturn = isGoalReturn(event, data.goal.goalId)
    // D61；SPEC-GAP SG-56：取消后与本目标相关的返还不计入
    if (cancelled && ((outflow && event.cancellable === true) || goalReturn)) continue
    const raw = event.eventStatus === 'ACTUAL' ? (event.actualAt ?? event.expectedAt) : event.expectedAt
    const when = whenOf(raw, event.timePrecision === 'DATETIME', asOfDay, cashAsOf)
    if (event.eventKind === 'CONTINGENCY_RELEASE') {
      // D09：案例另有规定的从其规定
      if (when !== null) events.push(releaseEvent(event.eventId, when.at, when.past && asOfDay !== null ? asOfDay : when.day))
      continue
    }
    const amount = event.amount
    const unknown = when === null ? 'DATE' : amount == null || amount < 0 ? 'AMOUNT' : undefined
    // D74：金额或日期未知的流入不计入，也不报问题；这样的流出报缺失，局部检查在它的位置截断
    if (unknown !== undefined && !outflow) continue
    if (unknown === undefined && amount === 0) continue
    if (unknown !== undefined) issues.add('MISSING_KEY_INFO', 'R010', event.eventId)
    let day = when?.day ?? asOfDay ?? ''
    if (when?.past === true) {
      // D54；SPEC-GAP SG-58：逾期流入不计入，逾期流出在 as_of 当日按先后未知执行
      if (event.eventStatus === 'EXPECTED') issues.add('OVERDUE_EVENT', 'D54', event.eventId)
      if (!outflow || asOfDay === null) continue
      day = asOfDay
    }
    events.push({
      id: event.eventId,
      kind: event.eventKind,
      amount: unknown === undefined ? (amount ?? 0) : 0,
      at: when?.at ?? raw ?? '',
      day,
      ...(when === null || when.past || event.knownOrder === undefined ? {} : { knownOrder: event.knownOrder }),
      coverage: event.coverage.map((cover) => ({ reserveId: cover.reserveId, coveredAmount: cover.coveredAmount })),
      goalRelated: event.eventKind === 'GOAL_PAYMENT' || goalReturn,
      confirmedIncome: isConfirmedIncome(event),
      ...(unknown === undefined ? {} : { unknown }),
    })
  }
  return events
}

function planEvents(
  data: NormalizedCase,
  candidate: Candidate,
  plan: PlanContext,
  asOfDay: string | null,
  issues: Issues,
): TimelineEvent[] {
  const cashAsOf = data.snapshot.cashAsOf
  const cancelled = plan.lifecycle === 'CANCELLED'
  const paidItems = goalPaymentCostItems(data, plan.lifecycle)
  const events: TimelineEvent[] = []
  candidate.items.forEach((item, index) => {
    // D61：取消后 cancellable 为 true 的价格项不再计入
    if ((cancelled && item.cancellable === true) || item.currency !== 'CNY') return
    if (item.settlesEventId !== undefined && !settlesPayment(data, item)) issues.add('REFERENCE_INVALID', 'D75', item.settlesEventId)
    // D75：不带 settles_event_id 的是已购项目的另一报价，不付款
    if (item.settlesEventId === undefined && paidItems.has(item.costItemId)) return
    const id = planItemId(candidate.candidateId, index, item.costItemId)
    const payment = plan.priced?.items.find((row) => row.index === index)?.payment?.value ?? null
    const when = whenOf(item.paymentAt, isInstant(item.paymentAt), asOfDay, cashAsOf)
    const unknown = when === null ? 'DATE' : payment === null || payment < 0 ? 'AMOUNT' : undefined
    if (unknown === undefined && payment === 0) return
    // D74
    if (unknown !== undefined) issues.add('MISSING_KEY_INFO', 'R010', id)
    let day = when?.day ?? asOfDay ?? ''
    if (when?.past === true) {
      issues.add('OVERDUE_EVENT', 'D54', id)
      if (asOfDay === null) return
      day = asOfDay
    }
    events.push({
      id,
      kind: 'GOAL_PAYMENT',
      amount: unknown === undefined ? (payment ?? 0) : 0,
      at: when?.at ?? item.paymentAt,
      day,
      coverage: [],
      goalRelated: true,
      confirmedIncome: false,
      ...(unknown === undefined ? {} : { unknown }),
    })
  })
  if (!cancelled) {
    for (const item of candidate.returns) {
      if (item.triggerCondition !== undefined || item.currency !== 'CNY') continue
      if (item.amount == null || item.amount <= 0) continue
      if (data.events.some((event) => event.eventId === item.eventId)) continue
      const when = whenOf(item.expectedAt, item.timePrecision === 'DATETIME', asOfDay, cashAsOf)
      if (when === null) continue
      if (when.past) {
        issues.add('OVERDUE_EVENT', 'D54', item.eventId)
        continue
      }
      events.push({
        id: item.eventId,
        kind: 'RETURN',
        amount: item.amount,
        at: when.at,
        day: when.day,
        coverage: [],
        goalRelated: true,
        confirmedIncome: false,
      })
    }
  }
  const release = releaseDay(data, candidate)
  if (release !== null && (asOfDay === null || release >= asOfDay)) events.push(releaseEvent(RELEASE_ID, release, release))
  return events
}

/** D08：没有所挂收入，或所挂收入已到账并计入快照的预留，从起始节点起计入 */
function reservesOf(data: NormalizedCase, issues: Issues): TimelineReserve[] {
  return data.reserves.map((reserve) => {
    const fundingEventId = reserve.fundingEventId ?? null
    const funding = fundingEventId === null ? undefined : data.events.find((event) => event.eventId === fundingEventId)
    if (fundingEventId !== null && funding === undefined) issues.add('REFERENCE_INVALID', '§12.1', fundingEventId)
    return {
      reserveId: reserve.reserveId,
      kind: reserve.reserveKind,
      amount: reserve.amount,
      coverageStart: reserve.coverageStart,
      fundingEventId,
      established: fundingEventId === null || (funding !== undefined && funding.eventStatus === 'ACTUAL' && funding.inSnapshot),
    }
  })
}

/** D18、D64：计划分配只能挂在已确认的预计收入上；SPEC-GAP SG-56：取消后不再转入 */
function plannedAllocationOf(data: NormalizedCase, cancelled: boolean, issues: Issues): TimelineInput['plannedAllocation'] {
  const allocation = data.plannedAllocation
  if (allocation === null || cancelled) return null
  const funding = data.events.find((event) => event.eventId === allocation.fundingEventId)
  if (funding === undefined || funding.eventKind !== 'INCOME' || funding.triggerCondition !== undefined) {
    issues.add('REFERENCE_INVALID', 'D64', allocation.fundingEventId)
    return null
  }
  return { fundingEventId: allocation.fundingEventId, amount: allocation.amount }
}

/** §12.7：计划对象的时间轴＝全部共同事件＋该候选的价格项与返还＋引擎生成的机动预留释放 */
export function timelineInput(data: NormalizedCase, plan: PlanContext): TimelineInput {
  const issues = issueList()
  const snapshot = data.snapshot
  const asOfDay = dayOf(snapshot.asOf)
  const cancelled = plan.lifecycle === 'CANCELLED'
  // D74：现金未知时不逐节点计算
  if (snapshot.cash == null) issues.add('MISSING_KEY_INFO', 'R010', 'snapshot.cash')
  const candidate = planCandidate(data, plan, issues)
  const events = commonEvents(data, cancelled, asOfDay, issues)
  if (candidate !== null) events.push(...planEvents(data, candidate, plan, asOfDay, issues))
  const reserves = reservesOf(data, issues)
  return {
    asOf: snapshot.asOf,
    start:
      snapshot.cash == null
        ? null
        : { cash: snapshot.cash, otherGoalHold: snapshot.otherGoalHold?.amount ?? 0, goalAllocation: snapshot.goalAllocation },
    reserves,
    plannedAllocation: plannedAllocationOf(data, cancelled, issues),
    events,
    issues: issues.list(),
  }
}
