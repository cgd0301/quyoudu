import { buildCost, type CostReport } from '../cost/index.ts'
import type { PlanState } from '../enums.ts'
import { inputIssues, type InputIssue } from '../issues/index.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { PricedCandidate } from '../pricing/index.ts'
import type { ResultCore } from '../result.ts'
import type { CaseFile } from '../schema.ts'
import { buildStates } from '../states/index.ts'
import { runTimeline, timelineInput, type PlanContext, type TimelineResult } from '../timeline/index.ts'

export type BranchInput = {
  raw: CaseFile
  data: NormalizedCase
  opIssues: readonly InputIssue[]
  snapshot: ResultCore['snapshot']
}

export type Branch = {
  /** 只含该候选时的输入冲突与时间轴问题 */
  issues: InputIssue[]
  /** D74：时间轴上金额或日期未知的流出 */
  unknown: ReadonlyMap<string, 'AMOUNT' | 'DATE'>
  timeline: TimelineResult
  cost: CostReport
  planState: PlanState
}

/** 与候选无关的输入问题：不含候选时的输入冲突，加上没有计划对象时共同事件的时间轴问题；D47 的 NO_PLAN 不算 */
export function sharedIssues(input: BranchInput): InputIssue[] {
  const report = inputIssues({ ...input.raw, candidates: [] }, input.opIssues)
  const timeline = runTimeline(timelineInput(input.data, { candidateId: null, priced: undefined, lifecycle: 'ACTIVE' }))
  return [...report.issues, ...timeline.issues.filter((issue) => issue.code !== 'NO_PLAN')]
}

/**
 * R016 第3条：把第 index 个候选当作计划对象，独立跑 M1 输入冲突、M3 时间轴、M4 成本与状态，不写回主记录。
 * §11.1：暂停、取消不参与比较，分支一律按未暂停、未取消计算。
 */
export function runBranch(input: BranchInput, index: number, priced: PricedCandidate): Branch {
  const own = input.raw.candidates[index]
  const report = inputIssues({ ...input.raw, candidates: own === undefined ? [] : [own] }, input.opIssues)
  const plan: PlanContext = { candidateId: priced.candidateId, priced, lifecycle: 'ACTIVE' }
  const prepared = timelineInput(input.data, plan)
  const timeline = runTimeline(prepared)
  const cost = buildCost({ data: input.data, ...plan, snapshot: input.snapshot })
  const issues = [...report.issues, ...timeline.issues]
  const states = buildStates({
    issues,
    nodes: timeline.nodes,
    allocationConflicts: timeline.allocationConflicts,
    lifecycle: plan.lifecycle,
    confirmed: false,
    selected: true,
    budgetCap: input.data.goal.budgetCap,
    unresolvedNecessary: cost.unresolvedNecessary,
    pendingCount: priced.pendingReasons.length,
    planTarget: 'SELECTED_CANDIDATE',
    overrun: cost.cost.budgetOverrun,
  })
  const unknown = new Map<string, 'AMOUNT' | 'DATE'>()
  for (const event of prepared.events) if (event.unknown !== undefined) unknown.set(event.id, event.unknown)
  return { issues, unknown, timeline, cost, planState: states.planState }
}
