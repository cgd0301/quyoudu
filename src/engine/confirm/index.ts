import type { EngineConfig } from '../config.ts'
import { DEMO_CFG_1 } from '../config.ts'
import type { InputIssue } from '../issues/index.ts'
import { normalize, type NormalizedCase } from '../normalize/index.ts'
import type { Op } from '../ops/index.ts'
import { priceCandidates, type PricedCandidate } from '../pricing/index.ts'
import type { ResultCore } from '../result.ts'
import type { CaseFile } from '../schema.ts'
import type { PlanLifecycle } from '../timeline/index.ts'
import { propose, type Proposal } from './allocation.ts'
import { deriveTasks, pendingDifferences, visibleTasks, type FormalTask } from './tasks.ts'

export type ConfirmationRecord = NonNullable<ResultCore['confirmation']>
type ConfirmOp = Extract<Op, { type: 'CONFIRM' }>

/** 正式方案及确认时冻结的行动清单（R017 第9、10条） */
export type FormalPlan = {
  candidateId: string
  planVersion: string
  inputVersion: string
  tasks: FormalTask[]
}

/** evaluate 在各操作之间传递的确认状态 */
export type ConfirmSession = {
  /** R017 第5条：已写入的确认，键为候选、方案版本和输入版本 */
  applied: readonly string[]
  /** 本次运行中写入的确认记录 */
  record: ConfirmationRecord | null
  /** 最近一次确认只能存为草案的候选 */
  draft: string | null
  formal: FormalPlan | null
}

export type ConfirmInput = {
  raw: CaseFile
  op: ConfirmOp
  opIssues: readonly InputIssue[]
  lifecycle: PlanLifecycle
  /** 当前输入版本 vN */
  version: string
  config: EngineConfig
  session: ConfirmSession
}

export type ConfirmResult = {
  session: ConfirmSession
  /** 写入正式安排后的案例；只存草案或重复提交时为 null */
  written: CaseFile | null
  issue: InputIssue | null
}

export type ViewInput = {
  raw: CaseFile
  data: NormalizedCase
  priced: readonly PricedCandidate[]
  lifecycle: PlanLifecycle
  opIssues: readonly InputIssue[]
  selectedCandidateId: string | null
  version: string
  session: ConfirmSession
}

export type ConfirmView = {
  confirmation: ResultCore['confirmation']
  actionList: ResultCore['actionList']
  pendingDifferences: ResultCore['pendingDifferences']
  /** 选中的候选上次确认只能存为草案 */
  draft: boolean
}

function uniq(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) if (!out.includes(value)) out.push(value)
  return out
}

// SPEC-GAP SG-64：与 compare 给出的 candidates[].plan_version 同一写法
export function planVersionOf(candidateId: string): string {
  return `${candidateId}@v1`
}

function keyOf(candidateId: string, planVersion: string, inputVersion: string): string {
  return [candidateId, planVersion, inputVersion].join('\u001f')
}

function freeze(raw: CaseFile, lifecycle: PlanLifecycle, config: EngineConfig): FormalPlan | null {
  const plan = raw.confirmed_plan
  if (plan === undefined) return null
  const data = normalize(raw)
  const ref = { candidateId: plan.candidate_id, planVersion: plan.plan_version }
  return { ...ref, inputVersion: plan.input_version, tasks: deriveTasks(data, priceCandidates(data, config), ref, lifecycle) }
}

function matches(formal: FormalPlan, raw: CaseFile): boolean {
  const plan = raw.confirmed_plan
  return (
    plan !== undefined &&
    formal.candidateId === plan.candidate_id &&
    formal.planVersion === plan.plan_version &&
    formal.inputVersion === plan.input_version
  )
}

/** 案例自带的已确认方案视为已写入的确认，按载入时的数据冻结行动清单 */
export function initialSession(raw: CaseFile, config: EngineConfig = DEMO_CFG_1): ConfirmSession {
  const plan = raw.confirmed_plan
  return {
    applied: plan === undefined ? [] : [keyOf(plan.candidate_id, plan.plan_version, plan.input_version)],
    record: null,
    draft: null,
    formal: freeze(raw, 'ACTIVE', config),
  }
}

/** 改变输入的操作之后调用：PATCH 换了 confirmed_plan 时按当前数据重新冻结 */
export function syncSession(
  session: ConfirmSession,
  raw: CaseFile,
  lifecycle: PlanLifecycle,
  config: EngineConfig = DEMO_CFG_1,
): ConfirmSession {
  const plan = raw.confirmed_plan
  if (plan === undefined) return session.formal === null ? session : { ...session, formal: null }
  if (session.formal !== null && matches(session.formal, raw)) return session
  return {
    ...session,
    applied: uniq([...session.applied, keyOf(plan.candidate_id, plan.plan_version, plan.input_version)]),
    formal: freeze(raw, lifecycle, config),
  }
}

function recordOf(proposal: Proposal, candidateId: string, planVersion: string, inputVersion: string): ConfirmationRecord {
  return {
    candidateId,
    planVersion,
    inputVersion,
    w: proposal.w,
    m: proposal.m,
    deltaA: proposal.deltaA,
    plannedAllocation: proposal.plannedAllocation,
    unallocatedNote: proposal.unallocatedNote,
  }
}

/**
 * R017、D46、D63：CONFIRM 一律按当前输入版本复查，不沿用旧版本的结论；能写入正式安排时直接写入，
 * 确认记录的输入版本取当前版本；不能写入时只存草案，不写入正式分配。重复提交已写入的确认不改记录。
 * SPEC-GAP SG-64：CONFIRM 同时选中该候选；方案版本不是该候选当前版本时报引用无效。
 */
export function applyConfirm(input: ConfirmInput): ConfirmResult {
  const { op, raw, session } = input
  const plan = raw.confirmed_plan
  const key = keyOf(op.candidate_id, op.plan_version, op.input_version)
  if (session.applied.includes(key) && plan?.candidate_id === op.candidate_id && plan.plan_version === op.plan_version) {
    return { session, written: null, issue: null }
  }
  const drafted: ConfirmSession = { ...session, draft: op.candidate_id }
  if (op.plan_version !== planVersionOf(op.candidate_id)) {
    return { session: drafted, written: null, issue: { code: 'REFERENCE_INVALID', rule: 'R017', refs: [op.plan_version] } }
  }
  const data = normalize(raw)
  const proposal = propose({
    raw,
    data,
    priced: priceCandidates(data, input.config),
    candidateId: op.candidate_id,
    lifecycle: input.lifecycle,
    opIssues: input.opIssues,
  })
  if (proposal === null) return { session: drafted, written: null, issue: null }
  const written = structuredClone(raw)
  written.snapshot.goal_allocation = proposal.goalAllocation
  written.planned_allocation =
    proposal.planned === null ? null : { funding_event_id: proposal.planned.fundingEventId, amount: proposal.planned.amount }
  written.confirmed_plan = { candidate_id: op.candidate_id, plan_version: op.plan_version, input_version: input.version }
  return {
    session: {
      applied: uniq([...session.applied, key, keyOf(op.candidate_id, op.plan_version, input.version)]),
      record: recordOf(proposal, op.candidate_id, op.plan_version, input.version),
      draft: null,
      formal: freeze(written, input.lifecycle, input.config),
    },
    written,
    issue: null,
  }
}

/**
 * 检查点的确认记录、正式行动清单与待确认差异。
 * SPEC-GAP SG-65：未确认时，选中的候选现在就能写入正式安排的，confirmation 给出 D46 预览，否则为 null；
 * 案例自带的已确认方案没有 W、m、ΔA 的记录，为 null。
 */
export function confirmView(input: ViewInput): ConfirmView {
  const plan = input.raw.confirmed_plan
  if (plan !== undefined) {
    const record = input.session.record
    const recorded =
      record !== null &&
      record.candidateId === plan.candidate_id &&
      record.planVersion === plan.plan_version &&
      record.inputVersion === plan.input_version
    const ref = { candidateId: plan.candidate_id, planVersion: plan.plan_version }
    const current = visibleTasks(deriveTasks(input.data, input.priced, ref, input.lifecycle), input.lifecycle)
    const frozen = input.session.formal
    // SPEC-GAP SG-66：正式行动清单在确认时冻结，之后只在再次确认时更新
    const formal = frozen !== null && matches(frozen, input.raw) ? visibleTasks(frozen.tasks, input.lifecycle) : current
    return {
      confirmation: recorded ? structuredClone(record) : null,
      actionList: formal.map((task) => structuredClone(task.item)),
      // SPEC-GAP SG-67：新估算只取已确认价格项按当前输入算出的金额
      pendingDifferences: pendingDifferences(formal, current),
      draft: false,
    }
  }
  const selected = input.selectedCandidateId
  if (selected === null) return { confirmation: null, actionList: [], pendingDifferences: [], draft: false }
  const proposal = propose({
    raw: input.raw,
    data: input.data,
    priced: input.priced,
    candidateId: selected,
    lifecycle: input.lifecycle,
    opIssues: input.opIssues,
  })
  return {
    confirmation: proposal === null ? null : recordOf(proposal, selected, planVersionOf(selected), input.version),
    actionList: [],
    pendingDifferences: [],
    draft: input.session.draft === selected,
  }
}
