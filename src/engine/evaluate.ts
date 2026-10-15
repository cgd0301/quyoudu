import { compareCandidates } from './compare/index.ts'
import type { EngineConfig } from './config.ts'
import { applyConfirm, confirmView, initialSession, syncSession, type ConfirmSession } from './confirm/index.ts'
import { buildCost } from './cost/index.ts'
import { buildScenarios, confirmedPricing, dailyReference } from './daily/index.ts'
import type { LabelCode } from './enums.ts'
import { caseForecasts, type HoltForecast } from './holt/index.ts'
import { inputIssues, type InputIssue } from './issues/index.ts'
import { normalize, type NormalizedCase } from './normalize/index.ts'
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

const FORECAST_FAILURES: ReadonlySet<HoltForecast['status']> = new Set([
  'NOT_COMPARABLE',
  'BACKTEST_INSUFFICIENT',
  'FIT_FAILED',
  'INVALID_RESULT',
])

function addLabel(labels: LabelCode[], code: LabelCode): void {
  if (!labels.includes(code)) labels.push(code)
}

function attachConfirmed(rows: readonly HoltForecast[], data: NormalizedCase): NonNullable<ResultCore['forecasts']> {
  return rows.map((row) => ({
    ...row,
    confirmed: data.forecastConfirmations.some((item) => item.seriesId === row.seriesId && item.purchaseDate === row.purchaseDate),
  }))
}

function forecastLabels(forecasts: readonly HoltForecast[], scenarios: ResultCore['scenarios']): LabelCode[] {
  const labels: LabelCode[] = []
  if (forecasts.some((row) => row.status === 'CONFIG_NOT_FROZEN')) labels.push('FORECAST_CONFIG_NOT_FROZEN')
  if (
    forecasts.some((row) => row.status === 'HISTORY_INSUFFICIENT') ||
    (scenarios ?? []).some((row) => row.unavailableReason === 'HISTORY_INSUFFICIENT')
  ) {
    labels.push('HISTORY_INSUFFICIENT')
  }
  if (forecasts.some((row) => row.status === 'AVAILABLE')) labels.push('FORECAST_DISCLAIMER')
  if (forecasts.some((row) => FORECAST_FAILURES.has(row.status))) labels.push('FORECAST_UNAVAILABLE')
  return labels
}

/** D14：只把合格预测写入确认；已经确认过的不重复写。没有任何新确认时返回 null */
function confirmForecasts(data: CaseFile, op: Extract<Op, { type: 'CONFIRM_FORECASTS' }>, config: EngineConfig): CaseFile | null {
  if (config.configVersion === null) return null
  const configVersion = config.configVersion
  const forecasts = caseForecasts(normalize(data), config)
  const added: CaseFile['forecast_confirmations'] = []
  for (const request of op.forecasts) {
    const already = data.forecast_confirmations.some(
      (row) => row.series_id === request.series_id && row.purchase_date === request.purchase_date,
    )
    if (already) continue
    const row = forecasts.find(
      (item) => item.seriesId === request.series_id && item.purchaseDate === request.purchase_date && item.status === 'AVAILABLE',
    )
    if (row?.amount == null) continue
    added.push({
      series_id: request.series_id,
      purchase_date: request.purchase_date,
      price: row.amount.value,
      config_version: configVersion,
    })
  }
  if (added.length === 0) return null
  return { ...data, forecast_confirmations: [...data.forecast_confirmations, ...added] }
}

function skeleton(
  data: CaseFile,
  version: number,
  selectedCandidateId: string | null,
  lifecycle: PlanLifecycle,
  opIssues: readonly InputIssue[],
  config: EngineConfig,
  session: ConfirmSession,
): ResultCore {
  const normalized = normalize(data)
  const forecastRows = caseForecasts(normalized, config)
  const pricedRows = priceCandidates(normalized, config, forecastRows)
  const priced = new Map(pricedRows.map((row) => [row.candidateId, row]))
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
  const comparison = compareCandidates({ raw: data, data: normalized, priced: pricedRows, opIssues, snapshot, topK: config.topK })
  if (comparison.samePrice) labels.push('SAME_PRICE')
  const costReport = buildCost({
    data: normalized,
    candidateId: planCandidateId,
    priced: planPriced,
    lifecycle,
    snapshot,
  })
  const issues = [...report.issues, ...timeline.issues]
  const states = {
    ...buildStates({
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
    }),
    optimizationState: comparison.optimizationState,
  }
  const confirm = confirmView({
    raw: data,
    data: normalized,
    priced: pricedRows,
    lifecycle,
    opIssues,
    selectedCandidateId,
    version: versionLabel(version),
    session,
  })
  if (confirm.draft) states.confirmationState = 'DRAFT'
  if (confirm.confirmation?.unallocatedNote != null) labels.push('PAID_BY_UNALLOCATED_LATER')
  const dependencies = buildDependencies({
    feasible: (states.underlyingPlanState ?? states.planState) === 'FEASIBLE_UNDER_ASSUMPTIONS',
    data: normalized,
    facts: costReport.facts,
    futureReturns: costReport.futureReturns,
  })
  const confirmedPlan = data.confirmed_plan
  const scenarioSet = buildScenarios(normalized, config, timeline.checkPeriod.end)
  const daily = dailyReference({
    data: normalized,
    plan:
      confirmedPlan === undefined
        ? null
        : { candidateId: confirmedPlan.candidate_id, priced: confirmedPricing(planPriced, confirm.actionList), lifecycle },
    issues: report.issues,
    nodes: timeline.nodes,
    scenarios: scenarioSet.daily,
  })
  const scenarios = scenarioSet.records.map((record) => {
    const amount = daily.scenarioAmounts.find((item) => item.kind === record.kind)?.amount
    return amount === undefined ? record : { ...record, dailyReference: amount }
  })
  for (const code of daily.labels) addLabel(labels, code)
  for (const code of forecastLabels(forecastRows, scenarios)) addLabel(labels, code)
  const forecasts = attachConfirmed(forecastRows, normalized)
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
    candidates: comparison.candidates,
    optimization: { ...comparison.counts, topK: config.topK },
    confirmation: confirm.confirmation,
    actionList: confirm.actionList,
    dailyReference: daily.dailyReference,
    pendingDifferences: confirm.pendingDifferences,
    userConfirmations: confirmations,
    states,
    ...(forecasts.length > 0 ? { forecasts } : {}),
    scenarios,
    labels,
  }
}

/**
 * 纯函数：每个 EVALUATE 产生一个检查点；ops 中没有 EVALUATE 时在末尾补一个（ensureCheckpoint）。
 * 改变输入的操作使 input_version 加 1（rules.md §12.4），包括写入正式安排的 CONFIRM（R017、D46、D63）。
 * CONFIRM_FORECASTS 只确认合格预测；写入时输入版本加 1，空操作和重复确认不加（D14、§12.4）。
 */
export function evaluate(caseData: CaseFile, ops: readonly Op[], config: EngineConfig): EvaluateOutput {
  let data = structuredClone(caseData)
  let createdReserves = new Map<string, string>()
  let opIssues: InputIssue[] = []
  let version = 1
  let selectedCandidateId: string | null = null
  let lifecycle: PlanLifecycle = 'ACTIVE'
  let session = initialSession(data, config)
  const checkpoints: Checkpoint[] = []
  for (const op of ensureCheckpoint(ops)) {
    if (op.type === 'EVALUATE') {
      checkpoints.push({
        label: op.label,
        result: skeleton(data, version, selectedCandidateId, lifecycle, opIssues, config, session),
      })
      continue
    }
    if (op.type === 'SELECT_CANDIDATE') {
      selectedCandidateId = op.candidate_id
      continue
    }
    if (op.type === 'CONFIRM') {
      const confirmed = applyConfirm({ raw: data, op, opIssues, lifecycle, version: versionLabel(version), config, session })
      selectedCandidateId = op.candidate_id
      session = confirmed.session
      if (confirmed.issue !== null) opIssues = [...opIssues, confirmed.issue]
      if (confirmed.written !== null) {
        data = confirmed.written
        version += 1
      }
      continue
    }
    if (op.type === 'CONFIRM_FORECASTS') {
      const written = confirmForecasts(data, op, config)
      if (written !== null) {
        data = written
        version += 1
        session = syncSession(session, data, lifecycle, config)
      }
      continue
    }
    if (op.type === 'PAUSE' && lifecycle === 'ACTIVE') lifecycle = 'PAUSED'
    if (op.type === 'CANCEL') lifecycle = 'CANCELLED'
    const next = applyMutation(data, op, createdReserves)
    data = next.data
    createdReserves = next.createdReserves
    if (next.issue != null) opIssues = [...opIssues, next.issue]
    version += 1
    session = syncSession(session, data, lifecycle, config)
  }
  return { checkpoints }
}
