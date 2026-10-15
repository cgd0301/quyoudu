import type { PendingCheck } from '../enums.ts'
import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { PricedCandidate, PricedItem } from '../pricing/index.ts'
import type { ResultCore } from '../result.ts'
import { goalPaymentCostItems, planItemId, type PlanLifecycle } from '../timeline/index.ts'

export type ActionItem = ResultCore['actionList'][number]
type Difference = ResultCore['pendingDifferences'][number]

/** 正式行动清单中的一项；cancellable 供取消后按 D61 去掉 */
export type FormalTask = {
  item: ActionItem
  cancellable: boolean
}

export type PlanRef = {
  candidateId: string
  planVersion: string
}

function uniq(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) if (!out.includes(value)) out.push(value)
  return out
}

// SPEC-GAP SG-66：不是有效期内的报价或金额未知时须核价；用了优惠或依据预测估算时须复核优惠条件（§12.7）
function pendingChecks(row: PricedItem | undefined, estimated: boolean, offerIds: readonly string[]): PendingCheck[] {
  const checks: PendingCheck[] = []
  if (row === undefined || row.payment === null || row.priceBasis !== 'QUOTE' || row.estimate || estimated) checks.push('RECHECK_PRICE')
  if (offerIds.length > 0 || row?.priceBasis === 'FORECAST') checks.push('RECHECK_OFFER_CONDITIONS')
  return checks
}

/**
 * R017 第7、8条：已确认方案的每个价格项一项待购任务，购买日与付款日分列，任务状态不随日期自动改变。
 * D75：已购项目的另一报价不列入；带 settles_event_id 的尾款照常列入。确认免费或不适用的项目没有待购任务。
 */
export function deriveTasks(
  data: NormalizedCase,
  priced: readonly PricedCandidate[],
  plan: PlanRef,
  lifecycle: PlanLifecycle,
): FormalTask[] {
  const candidate = data.candidates.find((row) => row.candidateId === plan.candidateId)
  if (candidate === undefined) return []
  const costItems = new Map(data.costItems.map((item) => [item.costItemId, item]))
  const offers = new Map(data.offers.map((offer) => [offer.offerId, offer]))
  const purchased = goalPaymentCostItems(data, lifecycle)
  const rows = priced.find((row) => row.candidateId === plan.candidateId)?.items ?? []
  const tasks: FormalTask[] = []
  candidate.items.forEach((item, index) => {
    const costItem = costItems.get(item.costItemId)
    if (costItem === undefined) return
    if (costItem.amountStatus === 'NOT_APPLICABLE' || costItem.amountStatus === 'CONFIRMED_FREE') return
    if (item.settlesEventId === undefined && purchased.has(item.costItemId)) return
    const row = rows.find((entry) => entry.index === index)
    const offerIds = uniq(
      candidate.offersUsed
        .filter((use) => use.orderId === item.orderId && (offers.get(use.offerId)?.scope.includes(costItem.category) ?? true))
        .map((use) => use.offerId),
    )
    const payment = row?.payment ?? null
    tasks.push({
      item: {
        // SPEC-GAP SG-66
        taskId: `TASK:${plan.candidateId}:${index}`,
        costItemId: item.costItemId,
        category: costItem.category,
        spec: item.spec,
        purchaseDate: item.purchaseDate,
        channel: item.channel,
        offerIds,
        amount:
          payment === null
            ? null
            : makeMoney(payment.value, uniq(['R017', ...payment.basis.rules]), [], [planItemId(plan.candidateId, index, item.costItemId)]),
        paymentAt: item.paymentAt,
        pendingChecks: pendingChecks(row, costItem.amountStatus === 'ESTIMATE', offerIds),
        taskState: 'PENDING_PURCHASE',
        planVersion: plan.planVersion,
      },
      cancellable: item.cancellable === true,
    })
  })
  return tasks
}

/** D61：取消后 cancellable 为 true 的价格项不再是待购任务 */
export function visibleTasks(tasks: readonly FormalTask[], lifecycle: PlanLifecycle): FormalTask[] {
  return lifecycle === 'CANCELLED' ? tasks.filter((task) => !task.cancellable) : [...tasks]
}

/** D77、R017 第10条：同一任务按当前输入算出的金额与已确认金额不同时，按费用项目汇总新估算减去已确认金额（§9.4） */
export function pendingDifferences(formal: readonly FormalTask[], current: readonly FormalTask[]): Difference[] {
  const latest = new Map(current.map((task) => [task.item.taskId, task.item.amount]))
  const totals = new Map<string, { delta: number; eventIds: string[] }>()
  for (const { item } of formal) {
    const now = latest.get(item.taskId) ?? null
    if (item.amount === null || now === null || now.value === item.amount.value) continue
    const entry = totals.get(item.costItemId) ?? { delta: 0, eventIds: [] }
    entry.delta += now.value - item.amount.value
    entry.eventIds.push(...now.basis.eventIds)
    totals.set(item.costItemId, entry)
  }
  return [...totals]
    .filter(([, entry]) => entry.delta !== 0)
    .map(([costItemId, entry]) => ({ costItemId, delta: makeMoney(entry.delta, ['R017'], [], uniq(entry.eventIds)) }))
}
