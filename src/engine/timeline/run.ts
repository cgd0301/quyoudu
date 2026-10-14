import type { NodeVerdict, ReserveKind, TriggerKind } from '../enums.ts'
import { makeMoney } from '../money.ts'
import type { Money } from '../result.ts'
import { checkPeriod } from './period.ts'
import type { GapRef, NodeRecord, TimelineEvent, TimelineInput, TimelineResult } from './types.ts'

type Slot = {
  reserveId: string
  kind: ReserveKind
  remaining: number
  planned: number
  coverageStart: string
  fundingEventId: string | null
  established: boolean
  /** D40：建立之前、原由该预留覆盖的支出声明覆盖额之和 */
  declared: number
}

type State = {
  cash: number
  otherGoalHold: number
  goalAllocation: number
  slots: Slot[]
}

type Step = { group: false; event: TimelineEvent } | { group: true; events: TimelineEvent[] }

type Trigger = {
  kind: TriggerKind
  eventIds: string[]
  related: string[]
  at: string
}

const ALL_KINDS: readonly ReserveKind[] = ['LIVING', 'OTHER_PROTECTED', 'CONTINGENCY']
const GAPS: ReadonlySet<NodeVerdict> = new Set(['PROTECTED_SHORTFALL', 'PAYMENT_SHORTFALL'])
const GAP_LIST: ReadonlySet<NodeVerdict> = new Set(['PROTECTED_SHORTFALL', 'PAYMENT_SHORTFALL', 'GAP_CONTINUED'])
const CONFLICTS: ReadonlySet<NodeVerdict> = new Set(['ALLOCATION_CONFLICT', 'CONFLICT_CONTINUED'])

function isOutflow(event: TimelineEvent): boolean {
  return event.kind === 'GOAL_PAYMENT' || event.kind === 'OTHER_EXPENSE'
}

function byId(left: TimelineEvent, right: TimelineEvent): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

// §10.2、D10、D38；SPEC-GAP SG-53
function orderSteps(events: readonly TimelineEvent[]): Step[] {
  const steps: Step[] = events.filter((event) => event.leading === true).map((event) => ({ group: false, event }))
  const rest = events.filter((event) => event.leading !== true)
  for (const day of [...new Set(rest.map((event) => event.day))].sort()) {
    const today = rest.filter((event) => event.day === day)
    const releases = today.filter((event) => event.kind === 'CONTINGENCY_RELEASE').sort(byId)
    const flows = today.filter((event) => event.kind !== 'CONTINGENCY_RELEASE')
    const ordered = flows
      .filter((event) => event.knownOrder !== undefined)
      .sort((left, right) => (left.knownOrder ?? 0) - (right.knownOrder ?? 0) || byId(left, right))
    const unordered = flows.filter((event) => event.knownOrder === undefined)
    const outflows = unordered.filter(isOutflow).sort(byId)
    const inflows = unordered.filter((event) => !isOutflow(event)).sort(byId)
    if (outflows.length > 1) steps.push({ group: true, events: outflows })
    else for (const event of outflows) steps.push({ group: false, event })
    for (const event of [...ordered, ...inflows, ...releases]) steps.push({ group: false, event })
  }
  return steps
}

function initialState(input: TimelineInput, start: NonNullable<TimelineInput['start']>): State {
  return {
    cash: start.cash,
    otherGoalHold: start.otherGoalHold,
    goalAllocation: start.goalAllocation,
    slots: input.reserves.map((reserve) => ({
      reserveId: reserve.reserveId,
      kind: reserve.kind,
      remaining: reserve.established ? reserve.amount : 0,
      planned: reserve.amount,
      coverageStart: reserve.coverageStart,
      fundingEventId: reserve.fundingEventId,
      established: reserve.established,
      declared: 0,
    })),
  }
}

function slotOf(state: State, reserveId: string): Slot | undefined {
  return state.slots.find((slot) => slot.reserveId === reserveId)
}

/** 覆盖声明合计。T003-04：超过支出额时不执行核销 */
function declaredCoverage(event: TimelineEvent): number {
  let declared = 0
  for (const cover of event.coverage) declared += Math.max(0, cover.coveredAmount)
  return declared
}

/** R003、§10.3 第2步：返回 q。未建立的预留 q=0（D40）；未超过支出额时 q 不超过剩余额（SPEC-GAP SG-57） */
function writeOff(state: State, event: TimelineEvent): number {
  if (event.coverage.length > 0 && declaredCoverage(event) > event.amount) return 0
  let q = 0
  for (const cover of event.coverage) {
    const slot = slotOf(state, cover.reserveId)
    if (slot === undefined) continue
    const declared = Math.max(0, cover.coveredAmount)
    if (!slot.established) {
      slot.declared += declared
      continue
    }
    const taken = Math.min(declared, Math.max(0, slot.remaining), event.amount - q)
    if (taken <= 0) continue
    slot.remaining -= taken
    q += taken
  }
  return q
}

/** D08、D40：以该流入为 funding_event_id 的预留紧随它建立；返回所建预留 */
function establish(state: State, event: TimelineEvent): string[] {
  const ids: string[] = []
  for (const slot of state.slots) {
    if (slot.established || slot.fundingEventId !== event.id) continue
    slot.remaining = event.day > slot.coverageStart ? Math.max(0, slot.planned - slot.declared) : slot.planned
    slot.established = true
    ids.push(slot.reserveId)
  }
  return ids
}

// §10.3
function apply(state: State, event: TimelineEvent, planned: TimelineInput['plannedAllocation']): string[] {
  switch (event.kind) {
    case 'GOAL_PAYMENT': {
      state.cash -= event.amount
      const rest = event.amount - writeOff(state, event)
      state.goalAllocation -= Math.min(rest, Math.max(0, state.goalAllocation))
      return []
    }
    case 'OTHER_EXPENSE':
      state.cash -= event.amount
      writeOff(state, event)
      return []
    case 'INCOME':
    case 'RETURN': {
      state.cash += event.amount
      const established = establish(state, event)
      if (planned !== null && planned.fundingEventId === event.id) state.goalAllocation += planned.amount
      return established
    }
    case 'CONTINGENCY_RELEASE':
      for (const slot of state.slots) if (slot.kind === 'CONTINGENCY' && slot.established) slot.remaining = 0
      return []
  }
}

/** §10.2 第4步：组内多笔共同声明的、组开始时已建立的预留，声明合计超过剩余额（SPEC-GAP SG-57） */
function oversubscribed(state: State, events: readonly TimelineEvent[]): boolean {
  const claims = new Map<string, { claimants: Set<string>; total: number }>()
  for (const event of events) {
    for (const cover of event.coverage) {
      const claim = claims.get(cover.reserveId) ?? { claimants: new Set<string>(), total: 0 }
      claim.claimants.add(event.id)
      claim.total += Math.max(0, cover.coveredAmount)
      claims.set(cover.reserveId, claim)
    }
  }
  for (const [reserveId, claim] of claims) {
    const slot = slotOf(state, reserveId)
    if (claim.claimants.size < 2 || slot === undefined || !slot.established) continue
    if (claim.total > slot.remaining) return true
  }
  return false
}

function sumOf(state: State, kind: ReserveKind): number {
  return state.slots.reduce((total, slot) => (slot.established && slot.kind === kind ? total + slot.remaining : total), 0)
}

function reserveIdsOf(state: State, kinds: readonly ReserveKind[]): string[] {
  return state.slots.filter((slot) => slot.established && kinds.includes(slot.kind)).map((slot) => slot.reserveId)
}

// §10.4、§10.6 judge：D05、D35—D37
function verdictOf(unallocated: number, protectedTotal: number, cash: number, kind: TriggerKind, prev: NodeRecord | null): NodeVerdict {
  const before = prev === null ? null : prev.unallocated.value
  const fell = before === null || unallocated < before
  if (prev !== null && before !== null && unallocated < 0 && before < 0 && !fell) {
    return prev.nodeVerdict === 'ALLOCATION_CONFLICT' || prev.nodeVerdict === 'CONFLICT_CONTINUED' ? 'CONFLICT_CONTINUED' : 'GAP_CONTINUED'
  }
  if (protectedTotal > cash) return 'PROTECTED_SHORTFALL'
  if (unallocated < 0) return kind === 'OUTFLOW' || kind === 'OUTFLOW_GROUP' ? 'PAYMENT_SHORTFALL' : 'ALLOCATION_CONFLICT'
  return 'PASS'
}

function amountRules(verdict: NodeVerdict, kind: TriggerKind): string[] {
  if (verdict === 'PROTECTED_SHORTFALL') return ['D05', 'D11', 'D34', 'D36']
  if (verdict === 'PAYMENT_SHORTFALL') return kind === 'OUTFLOW_GROUP' ? ['D05', 'D10', 'D11', 'D36'] : ['D05', 'D11', 'D36']
  if (verdict === 'ALLOCATION_CONFLICT') return kind === 'INCOME' ? ['D05', 'D37'] : ['D05']
  return ['D05', 'D35']
}

function judge(state: State, trigger: Trigger, prev: NodeRecord | null): NodeRecord {
  const cash = state.cash
  const living = sumOf(state, 'LIVING')
  const otherProtected = sumOf(state, 'OTHER_PROTECTED')
  const contingency = sumOf(state, 'CONTINGENCY')
  const otherGoal = state.otherGoalHold
  const allocation = state.goalAllocation
  const goalAvailable = cash - living - otherProtected - otherGoal
  const paymentHeadroom = goalAvailable - contingency
  const unallocated = paymentHeadroom - allocation
  const protectedTotal = living + otherProtected + otherGoal + contingency
  const verdict = verdictOf(unallocated, protectedTotal, cash, trigger.kind, prev)
  const allIds = reserveIdsOf(state, ALL_KINDS)
  const money = (value: number, rules: readonly string[], reserveIds: readonly string[] = []): Money =>
    makeMoney(value, rules, reserveIds, trigger.eventIds)
  const shortfall = verdict === 'PROTECTED_SHORTFALL'
  return {
    at: trigger.at,
    trigger: { kind: trigger.kind, eventIds: [...trigger.eventIds] },
    cash: money(cash, ['R001', '§10.3']),
    livingReserve: money(living, ['R003', 'D08', '§10.3'], reserveIdsOf(state, ['LIVING'])),
    otherProtectedReserve: money(otherProtected, ['R003', '§10.3'], reserveIdsOf(state, ['OTHER_PROTECTED'])),
    otherGoalHold: money(otherGoal, ['D09']),
    contingencyReserve: money(contingency, ['R003', 'D09'], reserveIdsOf(state, ['CONTINGENCY'])),
    goalAllocation: money(allocation, ['R004', 'D06', 'D18']),
    goalAvailable: money(goalAvailable, ['§1', 'D05'], reserveIdsOf(state, ['LIVING', 'OTHER_PROTECTED'])),
    paymentHeadroom: money(paymentHeadroom, ['§1', 'D05'], allIds),
    unallocated: money(unallocated, ['§1', 'R004', 'D05'], allIds),
    protectedTotal: money(protectedTotal, ['§1', 'D05'], allIds),
    nodeVerdict: verdict,
    amount: verdict === 'PASS' ? null : money(-unallocated, amountRules(verdict, trigger.kind), allIds),
    protectedOverCash: shortfall ? money(protectedTotal - cash, ['D34'], allIds) : null,
    allocationUnsupported: shortfall ? money(allocation, ['D34']) : null,
    related: [...trigger.related],
  }
}

function triggerOf(event: TimelineEvent, established: readonly string[]): Trigger {
  const kind: TriggerKind = isOutflow(event) ? 'OUTFLOW' : event.kind === 'INCOME' ? 'INCOME' : 'OTHER'
  return { kind, eventIds: [event.id], related: [event.id, ...established], at: event.at }
}

function gapRef(node: NodeRecord, nodeIndex: number): GapRef {
  const amount = node.amount ?? makeMoney(0)
  return {
    nodeIndex,
    at: node.at,
    nodeVerdict: node.nodeVerdict,
    amount: makeMoney(amount.value, amount.basis.rules, amount.basis.reserveIds, amount.basis.eventIds),
    related: [...node.related],
  }
}

function refsWhere(nodes: readonly NodeRecord[], verdicts: ReadonlySet<NodeVerdict>): GapRef[] {
  return nodes.flatMap((node, index) => (verdicts.has(node.nodeVerdict) ? [gapRef(node, index)] : []))
}

/** §10.6 runTimeline：起始节点、每个单独事件节点和每个流出组末逐一判定，汇总最早缺口、缺口列表和分配冲突（D11、D35） */
export function runTimeline(input: TimelineInput): TimelineResult {
  const period = checkPeriod(input.asOf, input.events)
  const end = period.end
  const steps = orderSteps(end === null ? input.events : input.events.filter((event) => event.day <= end))
  const events = steps.flatMap((step) => (step.group ? step.events : [step.event]))
  const issues = input.issues.map((issue) => ({ ...issue, refs: [...issue.refs] }))
  if (input.start === null) {
    return { checkPeriod: period, issues, events, nodes: [], earliestGap: null, gapList: [], allocationConflicts: [] }
  }
  const state = initialState(input, input.start)
  const nodes: NodeRecord[] = [judge(state, { kind: 'START', eventIds: [], related: [], at: input.asOf }, null)]
  const conflicted: string[] = []
  // D74：局部检查在第一笔金额或日期未知的流出处截断，同组的流出一并不执行；日期未知的无法定位，在起始节点之后截断
  const undated = events.some((event) => event.unknown === 'DATE')
  for (const step of undated ? [] : steps) {
    if ((step.group ? step.events : [step.event]).some((event) => event.unknown !== undefined)) break
    const prev = nodes.at(-1) ?? null
    if (!step.group) {
      const established = apply(state, step.event, input.plannedAllocation)
      nodes.push(judge(state, triggerOf(step.event, established), prev))
      continue
    }
    const ids = step.events.map((event) => event.id)
    // D38：声明超额时为输入冲突，不报告该日的日级累计缺口
    if (oversubscribed(state, step.events)) {
      conflicted.push(...ids)
      continue
    }
    for (const event of step.events) apply(state, event, input.plannedAllocation)
    nodes.push(judge(state, { kind: 'OUTFLOW_GROUP', eventIds: ids, related: ids, at: step.events[0]?.day ?? input.asOf }, prev))
  }
  if (conflicted.length > 0) issues.push({ code: 'GROUP_COVERAGE_OVERSUBSCRIBED', rule: 'D38', refs: conflicted })
  const first = nodes.findIndex((node) => GAPS.has(node.nodeVerdict))
  const earliest = nodes[first]
  return {
    checkPeriod: period,
    issues,
    events,
    nodes,
    earliestGap: earliest === undefined ? null : gapRef(earliest, first),
    gapList: refsWhere(nodes, GAP_LIST),
    allocationConflicts: refsWhere(nodes, CONFLICTS),
  }
}
