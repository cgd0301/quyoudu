import type { EngineConfig } from './config.ts'
import { buildCost } from './cost/index.ts'
import { inputIssues, type InputIssue } from './issues/index.ts'
import { normalize } from './normalize/index.ts'
import { applyMutation, ensureCheckpoint, type Op } from './ops/index.ts'
import { priceCandidates } from './pricing/index.ts'
import type { ResultCore } from './result.ts'
import type { CaseFile } from './schema.ts'
import { buildSnapshot } from './snapshot/index.ts'
import { buildDependencies, buildStates, withStateLabels } from './states/index.ts'
import { runTimeline, timelineInput, type PlanLifecycle } from './timeline/index.ts'

export type Checkpoint = {
  label: string
  result: ResultCore
}

export type EvaluateOutput = {
  checkpoints: Checkpoint[]
}

function versionLabel(version: number): string {
  return `v${version}`
}

function versionNumber(version: string): number | null {
  const match = /^v([1-9][0-9]*)$/.exec(version)
  const digits = match?.[1]
  if (digits === undefined) return null
  return Number(digits)
}

function userConfirmations(data: CaseFile, version: number): ResultCore['userConfirmations'] {
  return (data.confirmations ?? []).map((item) => {
    const recorded = versionNumber(item.input_version)
    // SPEC-GAP SG-45：晚于当前版本未写，不用于判断
    const status = recorded === version ? 'CURRENT' : 'NEEDS_RECONFIRM'
    return {
      field: item.field,
      value: item.value,
      inputVersion: item.input_version,
      status,
    }
  })
}

function skeleton(
  data: CaseFile,
  version: number,
  selectedCandidateId: string | null,
  lifecycle: PlanLifecycle,
  opIssues: readonly InputIssue[],
  config: EngineConfig,
): ResultCore {
  const normalized = normalize(data)
  const priced = new Map(priceCandidates(normalized).map((row) => [row.candidateId, row]))
  const report = inputIssues(data, opIssues)
  // D47：已确认方案，否则当前选中的候选
  const planCandidateId = data.confirmed_plan?.candidate_id ?? selectedCandidateId
  const planPriced = planCandidateId == null ? undefined : priced.get(planCandidateId)
  const timeline = runTimeline(
    timelineInput(normalized, {
      candidateId: planCandidateId,
      priced: planPriced,
      lifecycle,
    }),
  )
  const confirmed = data.confirmed_plan != null
  const planTarget = confirmed ? 'CONFIRMED_PLAN' : selectedCandidateId != null ? 'SELECTED_CANDIDATE' : 'NONE'
  const confirmations = userConfirmations(data, version)
  const labels = withStateLabels(['SIMULATED_DATA', 'TOP_K_DEMO'], planTarget, confirmations)
  if (report.preRangePaid) labels.push('PRE_RANGE_PAID')
  const snapshot = buildSnapshot(normalized)
  const costReport = buildCost({
    data: normalized,
    candidateId: planCandidateId,
    priced: planPriced,
    lifecycle,
    snapshot,
  })
  const issues = [...report.issues, ...timeline.issues]
  const states = buildStates({
    issues,
    nodes: timeline.nodes,
    allocationConflicts: timeline.allocationConflicts,
    lifecycle,
    confirmed,
    selected: selectedCandidateId != null,
    budgetCap: normalized.goal.budgetCap,
    unresolvedNecessary: costReport.unresolvedNecessary,
    pendingCount: planPriced?.pendingReasons.length ?? 0,
    planTarget,
    overrun: costReport.cost.budgetOverrun,
  })
  const dependencies = buildDependencies({
    feasible: (states.underlyingPlanState ?? states.planState) === 'FEASIBLE_UNDER_ASSUMPTIONS',
    data: normalized,
    facts: costReport.facts,
    futureReturns: costReport.futureReturns,
  })
  const living = normalized.snapshot.livingArrangement
  let dailyReference: ResultCore['dailyReference']
  if (living === 'NOT_PROVIDED') {
    dailyReference = { display: 'UNAVAILABLE', unavailable: [], missingReasons: ['LIVING_ARRANGEMENT_MISSING'] }
  } else if (confirmed) {
    dailyReference = { display: 'UNAVAILABLE', unavailable: [], missingReasons: [] }
  } else {
    dailyReference = { display: 'NEED_CONFIRMED_PLAN', unavailable: [], missingReasons: [] }
  }
  return {
    asOf: data.snapshot.as_of,
    inputVersion: versionLabel(version),
    configVersion: config.configVersion,
    topKLabel: config.topKLabel,
    checkPeriod: { ...timeline.checkPeriod, outOfRange: report.outOfRange || timeline.checkPeriod.outOfRange },
    inputIssues: issues,
    snapshot,
    nodes: timeline.nodes,
    earliestGap: timeline.earliestGap,
    gapList: timeline.gapList,
    constraintIssues: { budgetOverrun: costReport.cost.budgetOverrun, allocationConflicts: timeline.allocationConflicts },
    cost: costReport.cost,
    dependencies,
    candidates: data.candidates.map((candidate) => ({
      candidateId: candidate.candidate_id,
      planVersion: `${candidate.candidate_id}@v1`,
      evaluable: false,
      pendingReasons: priced.get(candidate.candidate_id)?.pendingReasons ?? [],
      excludedReasons: priced.get(candidate.candidate_id)?.excludedReasons ?? [],
      feasible: null,
      netSpend: null,
      netSpendIfReceived: null,
      tieGroup: null,
      rank: null,
    })),
    optimization: {
      scope: data.candidates.map((candidate) => candidate.candidate_id),
      evaluatedCount: 0,
      pendingCount: 0,
      excludedCount: 0,
      topK: config.topK,
    },
    confirmation: null,
    actionList: [],
    dailyReference,
    pendingDifferences: [],
    userConfirmations: confirmations,
    states,
    labels,
  }
}

/**
 * 纯函数：每个 EVALUATE 产生一个检查点；ops 中没有 EVALUATE 时在末尾补一个（ensureCheckpoint）。
 * 改变输入的操作使 input_version 加 1（rules.md §12.4）。
 * CONFIRM、CONFIRM_FORECASTS 在本模块先为空操作。
 */
export function evaluate(caseData: CaseFile, ops: readonly Op[], config: EngineConfig): EvaluateOutput {
  let data = structuredClone(caseData)
  let createdReserves = new Map<string, string>()
  let opIssues: InputIssue[] = []
  let version = 1
  let selectedCandidateId: string | null = null
  let lifecycle: PlanLifecycle = 'ACTIVE'
  const checkpoints: Checkpoint[] = []
  for (const op of ensureCheckpoint(ops)) {
    if (op.type === 'EVALUATE') {
      checkpoints.push({
        label: op.label,
        result: skeleton(data, version, selectedCandidateId, lifecycle, opIssues, config),
      })
      continue
    }
    if (op.type === 'SELECT_CANDIDATE') {
      selectedCandidateId = op.candidate_id
      continue
    }
    if (op.type === 'CONFIRM' || op.type === 'CONFIRM_FORECASTS') continue
    if (op.type === 'PAUSE' && lifecycle === 'ACTIVE') lifecycle = 'PAUSED'
    if (op.type === 'CANCEL') lifecycle = 'CANCELLED'
    const next = applyMutation(data, op, createdReserves)
    data = next.data
    createdReserves = next.createdReserves
    if (next.issue != null) opIssues = [...opIssues, next.issue]
    version += 1
  }
  return { checkpoints }
}
