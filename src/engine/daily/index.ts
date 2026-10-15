import type { LabelCode, ScenarioKind } from '../enums.ts'
import { makeMoney } from '../money.ts'
import type { Money, ResultCore } from '../result.ts'
import type { NodeRecord, TimelineEvent } from '../timeline/index.ts'
import { checkDaily, dailyProbe, type DailyCheck, type DailyContext, type DailyProbe } from './check.ts'
import { CONFIRMED_ONLY_SCENARIO, type DailyScenario } from './scenarios.ts'
import { maxPassing } from './search.ts'

export { PROBE_ID, checkDaily, confirmedPricing, dailyProbe } from './check.ts'
export type { DailyCheck, DailyContext, DailyPlan, DailyProbe, ProbeInput } from './check.ts'
export { CONFIRMED_ONLY_SCENARIO, buildScenarios, dailyScenarios } from './scenarios.ts'
export type { DailyScenario, ScenarioSet } from './scenarios.ts'
export { maxPassing } from './search.ts'

type DailyReference = ResultCore['dailyReference']

export type ScenarioAmount = {
  kind: ScenarioKind
  amount: Money
}

export type DailyOutcome = {
  dailyReference: DailyReference
  /** 追加到顶层 labels 的代码（SPEC-GAP SG-68） */
  labels: LabelCode[]
  /** 已搜索出 D 的情景；提前返回时为空，对应 scenarios[].dailyReference 保持 null */
  scenarioAmounts: ScenarioAmount[]
}

type Probed = {
  scenario: DailyScenario
  probe: DailyProbe
  zero: DailyCheck
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** 探测节点在 ResultCore nodes[] 中的下标，按触发类型和事件编号对应；对不上时为 null（SPEC-GAP SG-68） */
function nodeIndexOf(nodes: readonly NodeRecord[], node: NodeRecord): number | null {
  const index = nodes.findIndex((item) => item.trigger.kind === node.trigger.kind && sameIds(item.trigger.eventIds, node.trigger.eventIds))
  return index < 0 ? null : index
}

// SPEC-GAP SG-68：display 与 label 的代码不重复写入顶层 labels
function labelsOf(reference: DailyReference): LabelCode[] {
  const labels: LabelCode[] = []
  if (reference.missingReasons.includes('LIVING_ARRANGEMENT_MISSING')) labels.push('LIVING_ARRANGEMENT_MISSING')
  // §12.7：出现“历史不足”时顶层 labels 含 HISTORY_INSUFFICIENT
  if (reference.unavailable.some((item) => item.reason === 'HISTORY_INSUFFICIENT')) labels.push('HISTORY_INSUFFICIENT')
  // R019 输出：给出金额时附“按当前输入和假设测算，不是资金安全保证”
  if (reference.display === 'AMOUNT') labels.push('DAILY_DISCLAIMER')
  return labels
}

function outcome(reference: DailyReference, scenarioAmounts: ScenarioAmount[] = []): DailyOutcome {
  return { dailyReference: reference, labels: labelsOf(reference), scenarioAmounts }
}

/** §10.5 第5步的 0 元：依据为 x=0 时第一个未通过的节点，或预算超限额 */
function blockedAmount(check: DailyCheck): Money {
  const node = check.failingNode === null ? undefined : check.timeline.nodes[check.failingNode]
  if (node !== undefined) return makeMoney(0, ['R019', '§10.5', 'D05'], node.unallocated.basis.reserveIds, node.trigger.eventIds)
  return makeMoney(0, ['R019', '§10.5', '§3'], [], check.overrun?.basis.eventIds ?? [])
}

/**
 * R019、§4、§10.5、D26、D27、D59：按 §10.6 的顺序判断前提，再对每个可用情景二分搜索最大的 x，主展示取较低者。
 * 情景支出由调用方给出（M9），这里不生成情景。
 */
export function dailyReference(ctx: DailyContext): DailyOutcome {
  if (ctx.plan === null) return outcome({ display: 'NEED_CONFIRMED_PLAN', unavailable: [], missingReasons: [] })
  if (ctx.data.snapshot.livingArrangement === 'NOT_PROVIDED') {
    return outcome({ display: 'UNAVAILABLE', unavailable: [], missingReasons: ['LIVING_ARRANGEMENT_MISSING'] })
  }
  const plan = ctx.plan
  const probeOf = (events: readonly TimelineEvent[]): DailyProbe => dailyProbe({ data: ctx.data, plan, issues: ctx.issues, events })
  const base = probeOf([])
  const baseZero = checkDaily(base, 0)
  // §10.5 第2步；第4步末句：“仅已确认安排”本身无法评估的按第2步处理
  if (!baseZero.complete) return outcome({ display: 'UNAVAILABLE', unavailable: [], missingReasons: [] })
  const others = ctx.scenarios.filter((scenario) => scenario.kind !== CONFIRMED_ONLY_SCENARIO.kind)
  const unavailable: DailyReference['unavailable'] = others.flatMap((scenario) =>
    scenario.unavailableReason === null ? [] : [{ scenario: scenario.kind, reason: scenario.unavailableReason }],
  )
  const probed: Probed[] = [{ scenario: CONFIRMED_ONLY_SCENARIO, probe: base, zero: baseZero }]
  for (const scenario of others) {
    if (scenario.unavailableReason !== null) continue
    // R019：所选情景无法完整评估时，不以忽略它的方式计算 D
    if (scenario.events === null) return outcome({ display: 'UNAVAILABLE', unavailable, missingReasons: [] })
    const probe = probeOf(scenario.events)
    probed.push({ scenario, probe, zero: checkDaily(probe, 0) })
  }
  if (probed.some((item) => !item.zero.complete)) return outcome({ display: 'UNAVAILABLE', unavailable, missingReasons: [] })
  // §10.5 第5步：x=0 即不通过时不计算 D，不能用 D 掩盖缺口、冲突或预算超限
  const blocked = probed.find((item) => !item.zero.pass)
  if (blocked !== undefined) {
    return outcome({ display: 'NOT_RECOMMENDED', amount: blockedAmount(blocked.zero), unavailable, missingReasons: [] })
  }
  // §10.5 第6步：x ≤ U0（R019 第3条），D 为检查通过的最大整数分；R019 第7条：主展示取各情景中的较低者
  const results = probed.map((item) => {
    const upper = item.zero.timeline.nodes[0]?.unallocated.value ?? 0
    return { ...item, upper, amount: maxPassing(upper, (x) => checkDaily(item.probe, x).pass) }
  })
  const scenarioAmounts = results.map((item) => ({ kind: item.scenario.kind, amount: scenarioMoney(item) }))
  const lowest = results.reduce((best, item) => (item.amount < best.amount ? item : best))
  const shown = scenarioAmounts.find((item) => item.kind === lowest.scenario.kind)
  return outcome(
    {
      display: 'AMOUNT',
      amount: shown?.amount ?? scenarioMoney(lowest),
      limitedBy: {
        scenario: lowest.scenario.kind,
        nodeIndex: nodeIndexOfAmount(lowest, ctx.nodes),
      },
      // R019 异常、D26：只用已确认安排时标“仅依据已确认安排”
      ...(probed.length === 1 ? { label: 'CONFIRMED_ONLY' as const } : {}),
      unavailable,
      missingReasons: [],
    },
    scenarioAmounts,
  )
}

type Searched = Probed & { upper: number; amount: number }

/** SPEC-GAP SG-68：限制节点为 x=D+1 时第一个未通过的节点；D 已到 U0 时没有 */
function limitingNode(item: Searched): NodeRecord | undefined {
  if (item.amount >= item.upper) return undefined
  const limiting = checkDaily(item.probe, item.amount + 1)
  return limiting.failingNode == null ? undefined : limiting.timeline.nodes[limiting.failingNode]
}

function scenarioMoney(item: Searched): Money {
  const failing = limitingNode(item)
  const anchor = failing ?? item.zero.timeline.nodes[0]
  return makeMoney(item.amount, ['R019', '§4', '§10.5'], anchor?.unallocated.basis.reserveIds ?? [], failing?.trigger.eventIds ?? [])
}

function nodeIndexOfAmount(item: Searched, nodes: readonly NodeRecord[]): number | null {
  const failing = limitingNode(item)
  return failing === undefined ? null : nodeIndexOf(nodes, failing)
}
