import type { InputIssueCode, OptimizationState } from '../enums.ts'
import type { InputIssue } from '../issues/index.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { PricedCandidate } from '../pricing/index.ts'
import type { ResultCore } from '../result.ts'
import type { CaseFile } from '../schema.ts'
import { runBranch, sharedIssues, type Branch } from './branch.ts'
import { rankFeasible } from './rank.ts'

type CandidateResult = ResultCore['candidates'][number]
type Pending = CandidateResult['pendingReasons'][number]
type Excluded = CandidateResult['excludedReasons'][number]

export type CompareInput = {
  /** 分支内只保留单个候选重算输入冲突（M1） */
  raw: CaseFile
  data: NormalizedCase
  /** M2 的结果，与 data.candidates 同序 */
  priced: readonly PricedCandidate[]
  opIssues: readonly InputIssue[]
  snapshot: ResultCore['snapshot']
  topK: number
}

export type Comparison = {
  candidates: ResultCore['candidates']
  counts: Omit<ResultCore['optimization'], 'topK'>
  optimizationState: OptimizationState
  samePrice: boolean
}

type Shared = {
  issues: readonly InputIssue[]
  incomplete: boolean
  refs: string[]
}

function uniq(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) if (!out.includes(value)) out.push(value)
  return out
}

function addReason<T extends { code: string; rule: string; refs: string[] }>(list: T[], reason: T): void {
  const key = `${reason.code}|${reason.rule}|${reason.refs.join('\u001f')}`
  if (list.some((item) => `${item.code}|${item.rule}|${item.refs.join('\u001f')}` === key)) return
  list.push(reason)
}

/** R016 异常：共同资金或共同输入缺失时，依赖它的完整判断对每个候选都停止 */
function sharedOf(input: CompareInput): Shared {
  const issues = sharedIssues(input)
  const goal = input.data.goal
  const refs = issues.flatMap((issue) => issue.refs)
  // §11.1：预算缺失
  if (goal.budgetCap == null) refs.push('budget_cap')
  // §3、R010：本目标付款金额未知时，任何候选的 P + F − R 都不完整
  const unknownPayments = input.data.events.filter(
    (event) =>
      event.eventKind === 'GOAL_PAYMENT' &&
      event.currency === 'CNY' &&
      (event.goalId === undefined || event.goalId === goal.goalId) &&
      (event.amount == null || event.amount < 0),
  )
  for (const event of unknownPayments) refs.push(event.eventId)
  return { issues, incomplete: issues.length > 0 || goal.budgetCap == null || unknownPayments.length > 0, refs: uniq(refs) }
}

function isShared(shared: Shared, code: InputIssueCode, ref: string | null): boolean {
  return shared.issues.some((issue) => issue.code === code && (ref === null || issue.refs.includes(ref)))
}

// SPEC-GAP SG-61：分支中只属于该候选的输入问题按此归入待确认原因
function localReasons(issue: InputIssue, refs: string[], candidateId: string, branch: Branch, explained: boolean): Pending[] {
  switch (issue.code) {
    case 'NON_CNY':
      return [{ code: 'NON_CNY', rule: 'R008', refs }]
    case 'OVERDUE_EVENT':
      return [{ code: 'PAYMENT_TIME_MISSING', rule: 'D54', refs }]
    case 'OUT_OF_RANGE':
      return [{ code: 'PAYMENT_TIME_MISSING', rule: 'R008', refs: [candidateId] }]
    case 'MISSING_KEY_INFO': {
      const dates = refs.filter((ref) => branch.unknown.get(ref) === 'DATE')
      const amounts = refs.filter((ref) => branch.unknown.get(ref) !== 'DATE')
      const out: Pending[] = []
      if (dates.length > 0) out.push({ code: 'PAYMENT_TIME_MISSING', rule: 'R010', refs: dates })
      // 价格项金额未知时 M2 已列明原因
      if (amounts.length > 0 && !explained) out.push({ code: 'PRICE_PENDING', rule: 'R010', refs: amounts })
      return out
    }
    default:
      return [{ code: 'SHARED_INPUT_INCOMPLETE', rule: issue.rule, refs }]
  }
}

/** R016 第1条：必要项目没有金额来源（候选未覆盖或费用清单待填）时不按 0 计 */
function uncoveredItems(data: NormalizedCase, priced: PricedCandidate, branch: Branch): string[] {
  const facts = new Map(branch.cost.facts.map((fact) => [fact.costItemId, fact]))
  return data.costItems
    .filter((item) => item.necessary && item.amountStatus !== 'NOT_APPLICABLE')
    .filter((item) => facts.get(item.costItemId)?.amount == null)
    .filter((item) => !priced.items.some((row) => row.costItemId === item.costItemId && row.payment === null))
    .map((item) => item.costItemId)
}

function pendingOf(input: CompareInput, shared: Shared, priced: PricedCandidate, branch: Branch): Pending[] {
  const pending: Pending[] = priced.pendingReasons.map((reason) => ({ ...reason, refs: [...reason.refs] }))
  const explained = pending.length > 0
  if (shared.incomplete) addReason(pending, { code: 'SHARED_INPUT_INCOMPLETE', rule: 'R016', refs: [...shared.refs] })
  for (const issue of branch.issues) {
    if (issue.refs.length === 0) {
      if (!isShared(shared, issue.code, null)) {
        for (const reason of localReasons(issue, [], priced.candidateId, branch, explained)) addReason(pending, reason)
      }
      continue
    }
    const refs = issue.refs.filter((ref) => !isShared(shared, issue.code, ref))
    if (refs.length === 0) continue
    for (const reason of localReasons(issue, refs, priced.candidateId, branch, explained)) addReason(pending, reason)
  }
  for (const costItemId of uncoveredItems(input.data, priced, branch)) {
    if (pending.some((reason) => reason.refs.includes(costItemId))) continue
    addReason(pending, { code: 'PRICE_PENDING', rule: 'R016', refs: [costItemId] })
  }
  // 可评估必须对应分支不是暂无法完整判断，且净支出已知
  if (pending.length === 0 && (branch.planState === 'INCOMPLETE' || branch.cost.cost.netSpend === null)) {
    addReason(pending, { code: 'PRICE_PENDING', rule: 'R010', refs: [priced.candidateId] })
  }
  return pending
}

/** R016 第2、4条：M2 的相容、优惠和重复组合检查之后，可评估的候选再按分支检查付款节点、分配和预算 */
function excludedOf(priced: PricedCandidate, branch: Branch, evaluable: boolean): Excluded[] {
  const excluded: Excluded[] = priced.excludedReasons.map((reason) => ({ ...reason, refs: [...reason.refs] }))
  if (!evaluable) return excluded
  const gap = branch.timeline.earliestGap
  if (gap !== null) addReason(excluded, { code: 'PAYMENT_GAP', rule: 'R016', refs: [...gap.related] })
  const conflict = branch.timeline.allocationConflicts[0]
  if (conflict !== undefined) addReason(excluded, { code: 'ALLOCATION_CONFLICT', rule: 'R016', refs: [...conflict.related] })
  const overrun = branch.cost.cost.budgetOverrun
  if (overrun !== null) addReason(excluded, { code: 'BUDGET_EXCEEDED', rule: 'R016', refs: [...overrun.basis.eventIds] })
  return excluded
}

function judge(input: CompareInput, shared: Shared, index: number, priced: PricedCandidate): CandidateResult {
  const branch = runBranch(input, index, priced)
  const pendingReasons = pendingOf(input, shared, priced, branch)
  const evaluable = pendingReasons.length === 0
  const excludedReasons = excludedOf(priced, branch, evaluable)
  // SPEC-GAP SG-60：有确定排除原因即为不可行，即使仍有待确认信息
  const feasible = excludedReasons.length > 0 ? false : evaluable ? true : null
  // SPEC-GAP SG-61、SG-63：净支出取该候选分支 M4 的 P + F − R
  const cost = branch.cost.cost
  return {
    candidateId: priced.candidateId,
    planVersion: `${priced.candidateId}@v1`,
    evaluable,
    pendingReasons,
    excludedReasons,
    feasible,
    netSpend: evaluable ? cost.netSpend : null,
    netSpendIfReceived: evaluable ? cost.netSpendIfReceived : null,
    tieGroup: null,
    rank: null,
  }
}

/**
 * R011、R016：逐个候选在独立分支里判定可评估、待确认或排除，再对可行候选取 Top-K。
 * D15：只处理案例列出的候选，顺序与输入相同，不生成新组合（§12.7）。
 */
export function compareCandidates(input: CompareInput): Comparison {
  const scope = input.data.candidates.map((candidate) => candidate.candidateId)
  if (input.priced.length === 0) {
    return {
      candidates: [],
      counts: { scope, evaluatedCount: 0, pendingCount: 0, excludedCount: 0 },
      optimizationState: 'NOT_COMPARED',
      samePrice: false,
    }
  }
  const shared = sharedOf(input)
  const judged = input.priced.map((priced, index) => judge(input, shared, index, priced))
  const ranking = rankFeasible(
    judged.map((row) => ({ candidateId: row.candidateId, feasible: row.feasible, netSpend: row.netSpend?.value ?? null })),
    input.topK,
  )
  const candidates = judged.map((row, index) => ({ ...row, ...(ranking.placements[index] ?? { tieGroup: null, rank: null }) }))
  // SPEC-GAP SG-60：三类按比较结论互斥，合计等于比较范围
  const evaluatedCount = candidates.filter((row) => row.feasible === true).length
  const pendingCount = candidates.filter((row) => row.feasible === null).length
  const excludedCount = candidates.filter((row) => row.feasible === false).length
  // §11.2
  let optimizationState: OptimizationState = 'NO_KNOWN_FEASIBLE'
  if (pendingCount > 0) optimizationState = 'PARTIALLY_EVALUABLE'
  else if (evaluatedCount > 0) optimizationState = 'COMPLETED_FEASIBLE'
  return {
    candidates,
    counts: { scope, evaluatedCount, pendingCount, excludedCount },
    optimizationState,
    samePrice: ranking.samePrice,
  }
}
