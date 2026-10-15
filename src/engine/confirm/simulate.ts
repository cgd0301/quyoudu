import { buildCost } from '../cost/index.ts'
import type { PlanState } from '../enums.ts'
import { inputIssues, type InputIssue } from '../issues/index.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { PricedCandidate } from '../pricing/index.ts'
import type { CaseFile } from '../schema.ts'
import { buildSnapshot } from '../snapshot/index.ts'
import { buildStates } from '../states/index.ts'
import { runTimeline, timelineInput, type PlanLifecycle, type TimelineResult } from '../timeline/index.ts'

export type PlanInput = {
  raw: CaseFile
  data: NormalizedCase
  /** M2 的结果，与 data.candidates 同序 */
  priced: readonly PricedCandidate[]
  candidateId: string
  lifecycle: PlanLifecycle
  opIssues: readonly InputIssue[]
}

/** 本目标分配 A 与挂在预计收入上的计划分配（D18、§10.3） */
export type Arrangement = {
  goalAllocation: number
  plannedAllocation: { fundingEventId: string; amount: number } | null
}

export function currentArrangement(data: NormalizedCase): Arrangement {
  const planned = data.plannedAllocation
  return {
    goalAllocation: data.snapshot.goalAllocation,
    plannedAllocation: planned === null ? null : { fundingEventId: planned.fundingEventId, amount: planned.amount },
  }
}

function arranged(data: NormalizedCase, arrangement: Arrangement): NormalizedCase {
  const planned = arrangement.plannedAllocation
  return {
    ...data,
    snapshot: { ...data.snapshot, goalAllocation: arrangement.goalAllocation },
    plannedAllocation: planned === null ? null : { fundingEventId: planned.fundingEventId, amount: planned.amount },
  }
}

function pricedOf(input: PlanInput): PricedCandidate | undefined {
  return input.priced.find((row) => row.candidateId === input.candidateId)
}

/** 以该候选为计划对象、按给定的分配安排逐节点计算（§10.6），不写回主记录 */
export function simulate(input: PlanInput, arrangement: Arrangement): TimelineResult {
  return runTimeline(
    timelineInput(arranged(input.data, arrangement), {
      candidateId: input.candidateId,
      priced: pricedOf(input),
      lifecycle: input.lifecycle,
    }),
  )
}

/** 与 evaluate 为选中候选给出的计划状态同一算法（§11.1） */
export function planStateOf(input: PlanInput, arrangement: Arrangement, timeline: TimelineResult): PlanState {
  const data = arranged(input.data, arrangement)
  const priced = pricedOf(input)
  const report = inputIssues(input.raw, input.opIssues)
  const cost = buildCost({
    data,
    candidateId: input.candidateId,
    priced,
    lifecycle: input.lifecycle,
    snapshot: buildSnapshot(data),
  })
  return buildStates({
    issues: [...report.issues, ...timeline.issues],
    nodes: timeline.nodes,
    allocationConflicts: timeline.allocationConflicts,
    lifecycle: input.lifecycle,
    confirmed: false,
    selected: true,
    budgetCap: data.goal.budgetCap,
    unresolvedNecessary: cost.unresolvedNecessary,
    pendingCount: priced?.pendingReasons.length ?? 0,
    planTarget: 'SELECTED_CANDIDATE',
    overrun: cost.cost.budgetOverrun,
  }).planState
}
