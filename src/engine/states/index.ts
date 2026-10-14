import type { CostItemFact, DatedAmount } from '../cost/index.ts'
import type { LabelCode } from '../enums.ts'
import type { InputIssue } from '../issues/index.ts'
import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { ResultCore } from '../result.ts'
import type { PlanLifecycle } from '../timeline/index.ts'

type CaseEvent = NormalizedCase['events'][number]
type PlanState = ResultCore['states']['planState']
type Underlying = Exclude<PlanState, 'PAUSED' | 'CANCELLED'>

const PAYMENT_GAP = new Set(['PROTECTED_SHORTFALL', 'PAYMENT_SHORTFALL'])
const CONSTRAINT = new Set(['ALLOCATION_CONFLICT', 'CONFLICT_CONTINUED'])

export type StateInput = {
  issues: readonly InputIssue[]
  nodes: readonly { nodeVerdict: ResultCore['nodes'][number]['nodeVerdict'] }[]
  allocationConflicts: readonly unknown[]
  lifecycle: PlanLifecycle
  confirmed: boolean
  selected: boolean
  budgetCap: number | null
  unresolvedNecessary: boolean
  pendingCount: number
  planTarget: ResultCore['states']['planTarget']
  overrun: ResultCore['cost']['budgetOverrun']
}

function isExpectedIncome(event: CaseEvent): event is CaseEvent & { amount: number; expectedAt: string } {
  return (
    event.eventKind === 'INCOME' &&
    event.eventStatus === 'EXPECTED' &&
    !event.inSnapshot &&
    event.amount != null &&
    event.amount >= 0 &&
    event.expectedAt != null &&
    event.triggerCondition == null &&
    event.currency === 'CNY'
  )
}

/** §11.1 优先级。已暂停、已取消不参与比较，底层结果另给。 */
function underlyingOf(input: StateInput): Underlying {
  if (input.issues.length > 0 || input.budgetCap == null || input.unresolvedNecessary || input.pendingCount > 0) {
    return 'INCOMPLETE'
  }
  if (input.nodes.some((node) => PAYMENT_GAP.has(node.nodeVerdict))) return 'PAYMENT_GAP'
  if (input.overrun != null || input.allocationConflicts.length > 0 || input.nodes.some((node) => CONSTRAINT.has(node.nodeVerdict))) {
    return 'CONSTRAINT_ISSUE'
  }
  return 'FEASIBLE_UNDER_ASSUMPTIONS'
}

export function buildStates(input: StateInput): ResultCore['states'] {
  const underlying = underlyingOf(input)
  const confirmationState: ResultCore['states']['confirmationState'] = input.confirmed
    ? 'CONFIRMED'
    : input.selected
      ? 'PENDING_CONFIRMATION'
      : 'NOT_SELECTED'
  const common = {
    optimizationState: 'NOT_COMPARED' as const,
    confirmationState,
    planTarget: input.planTarget,
  }
  if (input.lifecycle === 'PAUSED' || input.lifecycle === 'CANCELLED') {
    return { ...common, planState: input.lifecycle, underlyingPlanState: underlying }
  }
  return { ...common, planState: underlying, underlyingPlanState: null }
}

/** 只在底层状态为按当前假设可行时列出（§12.5、R010）。条件退款不列入。 */
export function buildDependencies(input: {
  feasible: boolean
  data: NormalizedCase
  facts: readonly CostItemFact[]
  futureReturns: readonly DatedAmount[]
}): ResultCore['dependencies'] {
  if (!input.feasible) return []
  const dependencies: ResultCore['dependencies'] = []
  for (const event of input.data.events) {
    if (!isExpectedIncome(event)) continue
    dependencies.push({
      kind: 'EXPECTED_INCOME',
      refs: [event.eventId],
      amount: makeMoney(event.amount, ['R010', 'D64'], [], [event.eventId]),
      at: event.expectedAt,
    })
  }
  for (const item of input.futureReturns) {
    dependencies.push({
      kind: 'EXPECTED_RETURN',
      refs: [item.id],
      amount: makeMoney(item.amount, ['R007', 'D12'], [], [item.id]),
      at: item.at,
    })
  }
  for (const fact of input.facts) {
    if (!fact.forecast || fact.amount == null) continue
    dependencies.push({
      kind: 'CONFIRMED_FORECAST',
      refs: [fact.costItemId],
      amount: makeMoney(fact.amount, ['R010', 'D14'], [], []),
      at: fact.at,
    })
  }
  for (const fact of input.facts) {
    if (!fact.estimate || fact.amount == null) continue
    dependencies.push({
      kind: 'ESTIMATE',
      refs: [fact.costItemId],
      amount: makeMoney(fact.amount, ['R010', 'R009'], [], []),
      at: fact.at,
    })
  }
  return dependencies
}

/** D62：不是已确认方案时两个标签同时出现。D60：需重新确认。 */
export function withStateLabels(
  labels: readonly LabelCode[],
  planTarget: ResultCore['states']['planTarget'],
  confirmations: readonly { status: string }[],
): LabelCode[] {
  const out = [...labels]
  const add = (code: LabelCode) => {
    if (!out.includes(code)) out.push(code)
  }
  if (planTarget !== 'CONFIRMED_PLAN') {
    add('DRAFT_PREVIEW')
    add('PREVIEW_UNCONFIRMED')
  }
  if (confirmations.some((item) => item.status === 'NEEDS_RECONFIRM')) add('NEED_RECONFIRM')
  return out
}
