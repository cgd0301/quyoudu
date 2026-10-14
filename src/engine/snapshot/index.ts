import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { Money, ResultCore } from '../result.ts'

type Reserve = NormalizedCase['reserves'][number]
type Snapshot = NonNullable<ResultCore['snapshot']>

function established(reserve: Reserve, events: NormalizedCase['events']): boolean {
  if (reserve.fundingEventId == null) return true
  const funding = events.find((event) => event.eventId === reserve.fundingEventId)
  return funding != null && funding.eventStatus === 'ACTUAL' && funding.inSnapshot
}

function sumKind(reserves: readonly Reserve[], kind: Reserve['reserveKind'], events: NormalizedCase['events']): {
  value: number
  ids: string[]
} {
  const ids: string[] = []
  let value = 0
  for (const reserve of reserves) {
    if (reserve.reserveKind !== kind || !established(reserve, events)) continue
    ids.push(reserve.reserveId)
    value += reserve.amount
  }
  return { value, ids }
}

function issueAmount(value: number, reserveIds: readonly string[]): Money {
  return makeMoney(value, ['§1'], reserveIds)
}

/** §1：当前快照的 C、L、N、O、M、A、G、H、U。现金未知时为 null */
export function buildSnapshot(data: NormalizedCase): ResultCore['snapshot'] {
  const cash = data.snapshot.cash
  if (cash == null) return null
  const living = sumKind(data.reserves, 'LIVING', data.events)
  const otherProtected = sumKind(data.reserves, 'OTHER_PROTECTED', data.events)
  const contingency = sumKind(data.reserves, 'CONTINGENCY', data.events)
  const otherGoal = data.snapshot.otherGoalHold?.amount ?? 0
  const allocation = data.snapshot.goalAllocation
  const l = living.value
  const n = otherProtected.value
  const o = otherGoal
  const m = contingency.value
  const a = allocation
  const goalAvailable = cash - l - n - o
  const paymentHeadroom = goalAvailable - m
  const unallocated = cash - l - n - o - m - a
  const protectedTotal = l + n + o + m
  const balanceIds = [...living.ids, ...otherProtected.ids, ...contingency.ids]
  const issues: Snapshot['issues'] = []
  if (protectedTotal > cash) {
    issues.push({
      nodeVerdict: 'PROTECTED_SHORTFALL',
      amount: issueAmount(-unallocated, balanceIds),
    })
  } else if (unallocated < 0) {
    issues.push({
      nodeVerdict: 'ALLOCATION_CONFLICT',
      amount: issueAmount(-unallocated, balanceIds),
    })
  }
  return {
    cash: makeMoney(cash, ['R001']),
    livingReserve: makeMoney(l, ['§1'], living.ids),
    otherProtectedReserve: makeMoney(n, ['§1'], otherProtected.ids),
    otherGoalHold: makeMoney(o, ['D09']),
    contingencyReserve: makeMoney(m, ['D09'], contingency.ids),
    goalAllocation: makeMoney(a, ['R004']),
    goalAvailable: makeMoney(goalAvailable, ['§1'], [...living.ids, ...otherProtected.ids]),
    paymentHeadroom: makeMoney(paymentHeadroom, ['§1'], balanceIds),
    unallocated: makeMoney(unallocated, ['§1', 'R004'], balanceIds),
    protectedTotal: makeMoney(protectedTotal, ['§1', 'D09'], balanceIds),
    issues,
  }
}
