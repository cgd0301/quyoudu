import type { InputIssueCode, OptimizationState, PendingReasonCode } from '../enums.ts'
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
  // 没有待确认原因必须对应分支不是暂无法完整判断，且净支出已知
  if (pending.length === 0 && (branch.planState === 'INCOMPLETE' || branch.cost.cost.netSpend === null)) {
    addReason(pending, { code: 'PRICE_PENDING', rule: 'R010', refs: [priced.candidateId] })
  }
  return sortPending(pending)
}

/** §12.7（36）：价格项原因、相容性比较字段缺失、优惠条件不完整、SHARED_INPUT_INCOMPLETE 四类依次排列 */
const PENDING_ORDER: Record<PendingReasonCode, readonly [group: number, order: number]> = {
  PRICE_PENDING: [0, 0],
  NON_CNY: [0, 1],
  QUOTE_EXPIRED: [0, 2],
  PAYMENT_TIME_MISSING: [0, 3],
  COMPARISON_FIELD_MISSING: [1, 0],
  ROUNDING_UNKNOWN: [2, 0],
  OFFER_ORDER_MISSING: [2, 1],
  OFFER_CONDITION_UNKNOWN: [2, 2],
  SHARED_INPUT_INCOMPLETE: [3, 0],
}

// SPEC-GAP SG-75：refs 逐个元素按 UTF-16 码元比较，较短的前缀在前
function compareRefs(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < left.length && index < right.length; index += 1) {
    const a = left[index] ?? ''
    const b = right[index] ?? ''
    if (a !== b) return a < b ? -1 : 1
  }
  return left.length - right.length
}

/** §12.7（36）：同一类内按 refs 的字典序，refs 相同时按代码次序 */
export function sortPending(reasons: readonly Pending[]): Pending[] {
  return reasons
    .map((reason, index) => ({ reason, index }))
    .sort((left, right) => {
      const [leftGroup, leftOrder] = PENDING_ORDER[left.reason.code]
      const [rightGroup, rightOrder] = PENDING_ORDER[right.reason.code]
      if (leftGroup !== rightGroup) return leftGroup - rightGroup
      const refs = compareRefs(left.reason.refs, right.reason.refs)
      if (refs !== 0) return refs
      return leftOrder !== rightOrder ? leftOrder - rightOrder : left.index - right.index
    })
    .map((item) => item.reason)
}

/** R016 第2、4条：M2 的相容、优惠和重复组合检查之后，信息完整的候选再按分支检查付款节点、分配和预算 */
const COMPATIBILITY = new Set([
  'ARRIVAL_TOO_LATE',
  'RETURN_TOO_EARLY',
  'LODGING_NIGHTS_NOT_COVERED',
  'SEAT_TIER_NOT_ALLOWED',
  'LODGING_TOO_FAR',
  'NOT_REFUNDABLE',
])

/** §12.7（20）：相容性、优惠、预算、付款节点，最后是重复候选 */
function excludedRank(code: string): number {
  if (COMPATIBILITY.has(code)) return 0
  if (code.startsWith('OFFER_')) return 1
  if (code === 'BUDGET_EXCEEDED') return 2
  if (code === 'PAYMENT_GAP') return 3
  if (code === 'ALLOCATION_CONFLICT') return 4
  if (code === 'DUPLICATE_CANDIDATE') return 5
  return 6
}

function sortExcluded(reasons: Excluded[]): Excluded[] {
  return reasons
    .map((reason, index) => ({ reason, index }))
    .sort((left, right) => {
      const rank = excludedRank(left.reason.code) - excludedRank(right.reason.code)
      return rank !== 0 ? rank : left.index - right.index
    })
    .map((item) => item.reason)
}

function excludedOf(priced: PricedCandidate, branch: Branch, complete: boolean): Excluded[] {
  const excluded: Excluded[] = priced.excludedReasons.map((reason) => ({ ...reason, refs: [...reason.refs] }))
  if (complete) {
    const gap = branch.timeline.earliestGap
    if (gap !== null) addReason(excluded, { code: 'PAYMENT_GAP', rule: 'R016', refs: [...gap.related] })
    const conflict = branch.timeline.allocationConflicts[0]
    if (conflict !== undefined) addReason(excluded, { code: 'ALLOCATION_CONFLICT', rule: 'R016', refs: [...conflict.related] })
    const overrun = branch.cost.cost.budgetOverrun
    if (overrun !== null) addReason(excluded, { code: 'BUDGET_EXCEEDED', rule: 'R016', refs: [...overrun.basis.eventIds] })
  }
  return sortExcluded(excluded)
}

function judge(input: CompareInput, shared: Shared, index: number, priced: PricedCandidate): CandidateResult {
  const branch = runBranch(input, index, priced)
  const pending = pendingOf(input, shared, priced, branch)
  const complete = pending.length === 0
  const excludedReasons = excludedOf(priced, branch, complete)
  // SPEC-GAP SG-60、SG-61：有确定排除原因即为不可行，只列排除原因，即使仍有待确认信息
  const excluded = excludedReasons.length > 0
  // SPEC-GAP SG-61：净支出取该候选分支 M4 的 P + F − R，信息不完整时为 null
  const cost = branch.cost.cost
  return {
    candidateId: priced.candidateId,
    planVersion: `${priced.candidateId}@v1`,
    evaluable: complete || excluded,
    pendingReasons: excluded ? [] : pending,
    excludedReasons,
    feasible: excluded ? false : complete ? true : null,
    netSpend: complete ? cost.netSpend : null,
    netSpendIfReceived: complete ? cost.netSpendIfReceived : null,
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
