import { buildCost } from '../cost/index.ts'
import type { InputIssue } from '../issues/index.ts'
import { makeMoney } from '../money.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import type { PricedCandidate } from '../pricing/index.ts'
import type { Money, ResultCore } from '../result.ts'
import { dayOf } from '../timeline/dates.ts'
import {
  planItemId,
  runTimeline,
  timelineInput,
  type NodeRecord,
  type PlanLifecycle,
  type TimelineEvent,
  type TimelineInput,
  type TimelineResult,
} from '../timeline/index.ts'
import type { DailyScenario } from './scenarios.ts'

// SPEC-GAP SG-68：待测额 x 只出现在探测时间轴上
export const PROBE_ID = 'DAILY:X'

/** 已确认方案；priced 为已确认方案版本的金额（§10.5 第3步） */
export type DailyPlan = {
  candidateId: string
  priced: PricedCandidate | undefined
  lifecycle: PlanLifecycle
}

export type DailyContext = {
  data: NormalizedCase
  /** 没有已确认方案时为 null（D27） */
  plan: DailyPlan | null
  /** M1 的输入冲突，含操作问题 */
  issues: readonly InputIssue[]
  /** ResultCore 的 nodes[]，limitedBy.nodeIndex 指向这里 */
  nodes: readonly NodeRecord[]
  /** D26 所选情景；“仅已确认安排”始终在内 */
  scenarios: readonly DailyScenario[]
}

export type ProbeInput = {
  data: NormalizedCase
  plan: DailyPlan
  issues: readonly InputIssue[]
  /** 情景支出，已去掉今日由 x 替换的同口径部分（D22） */
  events: readonly TimelineEvent[]
}

/** 与 x 无关的部分：不含 x 的时间轴输入和预算检查 */
export type DailyProbe = {
  asOf: string
  input: TimelineInput
  issues: readonly InputIssue[]
  /** 预算、P + F − R 和必要费用都已知，且价格没有待确认原因（§11.1） */
  costKnown: boolean
  /** P + F − R 超过 B 的部分；未超限时为 null（§3） */
  overrun: Money | null
}

export type DailyCheck = {
  x: number
  /** 探测时间轴：x > 0 时起始节点之后紧接 x 的节点 */
  timeline: TimelineResult
  /** §10.5 第2步：没有输入冲突和时间轴问题、检查期间未超界、现金与费用和预算都已知 */
  complete: boolean
  nodesPass: boolean
  /** P + F − R ≤ B（§3、§4 第6步） */
  budgetPass: boolean
  overrun: Money | null
  /** 第一个未通过的节点在 timeline.nodes 中的下标 */
  failingNode: number | null
  pass: boolean
}

/**
 * §10.5 第3步：方案金额取已确认方案版本，即确认时冻结的行动清单金额；
 * 按价格项编号（D72）对应，对不上任务的价格项沿用当前计算（SPEC-GAP SG-68）。
 */
export function confirmedPricing(priced: PricedCandidate | undefined, actionList: ResultCore['actionList']): PricedCandidate | undefined {
  if (priced === undefined) return undefined
  const items = priced.items.map((row) => {
    const id = planItemId(priced.candidateId, row.index, row.costItemId)
    const frozen = actionList.find((task) => task.amount?.basis.eventIds.includes(id) === true)?.amount
    if (frozen == null || frozen.value === row.payment?.value) return row
    return { ...row, payment: makeMoney(frozen.value, ['R017', '§10.5'], [], [id]) }
  })
  return { ...priced, items }
}

/** 预先算好与 x 无关的时间轴输入和预算检查（§4 第5步：方案、收入条件、生活安排和情景不随 x 改变） */
export function dailyProbe(input: ProbeInput): DailyProbe {
  const base = timelineInput(input.data, input.plan)
  const report = buildCost({ data: input.data, ...input.plan, snapshot: null })
  const pending = input.plan.priced?.pendingReasons.length ?? 0
  return {
    asOf: input.data.snapshot.asOf,
    input: { ...base, events: [...input.events, ...base.events] },
    issues: [...input.issues],
    costKnown: input.data.goal.budgetCap != null && report.cost.netSpend !== null && !report.unresolvedNecessary && pending === 0,
    overrun: report.cost.budgetOverrun,
  }
}

/** §4 第2—4步：x 是 as_of 时刻不属于本目标、无预留覆盖的流出，排在时间轴最前（D10、SG-53） */
function probeEvent(asOf: string, x: number): TimelineEvent {
  return {
    id: PROBE_ID,
    kind: 'OTHER_EXPENSE',
    amount: x,
    at: asOf,
    day: dayOf(asOf) ?? '',
    coverage: [],
    goalRelated: false,
    confirmedIncome: false,
    leading: true,
  }
}

/** §4、§10.6 passesAll：把 x 插在时间轴最前逐节点检查，并检查预算；x=0 时不成节点（D74） */
export function checkDaily(probe: DailyProbe, x: number): DailyCheck {
  if (!Number.isSafeInteger(x) || x < 0) throw new RangeError(`待测额应为非负整数分：${String(x)}`)
  const events = x === 0 ? probe.input.events : [probeEvent(probe.asOf, x), ...probe.input.events]
  const timeline = runTimeline({ ...probe.input, events })
  const failing = timeline.nodes.findIndex((node) => node.nodeVerdict !== 'PASS')
  const counted = timeline.nodes.length > 0
  const complete =
    counted && probe.issues.length === 0 && timeline.issues.length === 0 && !timeline.checkPeriod.outOfRange && probe.costKnown
  const nodesPass = counted && failing < 0
  const budgetPass = probe.costKnown && probe.overrun === null
  return {
    x,
    timeline,
    complete,
    nodesPass,
    budgetPass,
    overrun: probe.overrun,
    failingNode: failing < 0 ? null : failing,
    pass: complete && nodesPass && budgetPass,
  }
}
