import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { Money } from '../result.ts'
import type { NodeRecord, TimelineEvent } from '../timeline/index.ts'
import { currentArrangement, planStateOf, simulate, type Arrangement, type PlanInput } from './simulate.ts'

/** D46 的结果。goalAllocation、planned 为写入主记录的整数分 */
export type Proposal = {
  w: Money
  m: Money
  deltaA: Money
  plannedAllocation: { fundingEventId: string; amount: Money } | null
  unallocatedNote: Money | null
  goalAllocation: number
  planned: { fundingEventId: string; amount: number } | null
}

function lowestNode(nodes: readonly NodeRecord[]): NodeRecord | undefined {
  let found: NodeRecord | undefined
  for (const node of nodes) if (found === undefined || node.unallocated.value < found.unallocated.value) found = node
  return found
}

/** 条件随取值单调、0 满足时，[0, upper] 内满足条件的最大整数分；按二进制位从高到低逐位逼近，只做整数加法 */
function maxSatisfying(upper: number, holds: (value: number) => boolean): number {
  const steps: number[] = []
  for (let step = 1; step <= upper; step += step) steps.push(step)
  let best = 0
  for (const step of steps.reverse()) {
    const next = best + step
    if (next <= upper && holds(next)) best = next
  }
  return best
}

/** W：剩余计划目标付款中未被预留覆盖的部分 */
function remainingGoalPayments(data: NormalizedCase, events: readonly TimelineEvent[]): { total: number; ids: string[] } | null {
  const owners = new Map(data.events.map((event) => [event.eventId, event.goalId]))
  const ids: string[] = []
  let total = 0
  for (const event of events) {
    if (event.kind !== 'GOAL_PAYMENT') continue
    const owner = owners.get(event.id)
    if (owner !== undefined && owner !== data.goal.goalId) continue
    let covered = 0
    for (const cover of event.coverage) covered += Math.max(0, cover.coveredAmount)
    total += Math.max(0, event.amount - covered)
    if (!Number.isSafeInteger(total)) return null
    ids.push(event.id)
  }
  return { total, ids }
}

// SPEC-GAP SG-64：已指定的收入取案例 planned_allocation 所挂收入；“最后一笔目标付款之前”按 §10.2 排好的时间轴顺序判断
function fundingIncome(data: NormalizedCase, events: readonly TimelineEvent[]): string | null {
  if (data.plannedAllocation !== null) return data.plannedAllocation.fundingEventId
  const last = events.findLastIndex((event) => event.kind === 'GOAL_PAYMENT')
  return events.slice(0, Math.max(0, last)).find((event) => event.kind === 'INCOME' && event.confirmedIncome)?.id ?? null
}

/**
 * D18、D46：确认前模拟含该候选的付款、沿用现有分配，计划状态须为按当前假设可行；
 * ΔA 与计划分配依次取使确认后全部节点 U 的最小值不低于 m 的最大整数分，确认后重跑仍须可行。
 * 不能写入正式安排时返回 null，只能存草案。
 */
export function propose(input: PlanInput): Proposal | null {
  const current = currentArrangement(input.data)
  const before = simulate(input, current)
  if (planStateOf(input, current, before) !== 'FEASIBLE_UNDER_ASSUMPTIONS') return null
  const lowest = lowestNode(before.nodes)
  const payments = remainingGoalPayments(input.data, before.events)
  if (lowest === undefined || payments === null) return null
  const m = lowest.unallocated.value
  const holds = (arrangement: Arrangement): boolean => {
    const node = lowestNode(simulate(input, arrangement).nodes)
    return node !== undefined && node.unallocated.value >= m
  }
  const a0 = current.goalAllocation
  const w = payments.total
  // SPEC-GAP SG-64：计划分配只建一笔，确认后以本次新建的一笔替换原有的一笔
  const deltaA = maxSatisfying(Math.max(0, w - a0), (value) => holds({ goalAllocation: a0 + value, plannedAllocation: null }))
  const goalAllocation = a0 + deltaA
  const funding = fundingIncome(input.data, before.events)
  const amount =
    funding === null
      ? 0
      : maxSatisfying(Math.max(0, w - a0 - deltaA), (value) =>
          holds({ goalAllocation, plannedAllocation: { fundingEventId: funding, amount: value } }),
        )
  const planned = funding !== null && amount > 0 ? { fundingEventId: funding, amount } : null
  const after: Arrangement = { goalAllocation, plannedAllocation: planned }
  if (planStateOf(input, after, simulate(input, after)) !== 'FEASIBLE_UNDER_ASSUMPTIONS') return null
  const rest = w - a0 - deltaA - amount
  return {
    w: makeMoney(w, ['R017', 'D18', 'D46'], [], payments.ids),
    m: makeMoney(m, ['D18', 'D46'], lowest.unallocated.basis.reserveIds, lowest.trigger.eventIds),
    deltaA: makeMoney(deltaA, ['R004', 'R017', 'D46'], [], payments.ids),
    plannedAllocation:
      planned === null
        ? null
        : {
            fundingEventId: planned.fundingEventId,
            amount: makeMoney(planned.amount, ['D18', 'D46', '§10.3'], [], [planned.fundingEventId]),
          },
    unallocatedNote: rest > 0 ? makeMoney(rest, ['D06', 'D46'], [], payments.ids) : null,
    goalAllocation,
    planned,
  }
}
