import type { EventKind, ReserveKind } from '../enums.ts'
import type { InputIssue } from '../issues/index.ts'
import type { PricedCandidate } from '../pricing/index.ts'
import type { ResultCore } from '../result.ts'

/** R012、D47：暂停不改时间轴；取消后只计仍有效义务和生活安排 */
export type PlanLifecycle = 'ACTIVE' | 'PAUSED' | 'CANCELLED'

/** D47 的计划对象：已确认方案，否则当前选中的候选；priced 为 M2 对该候选的计算结果 */
export type PlanContext = {
  candidateId: string | null
  priced: PricedCandidate | undefined
  lifecycle: PlanLifecycle
}

export type Coverage = {
  reserveId: string
  coveredAmount: number
}

/** 时间轴上的一笔收付款或机动预留释放（§10.2） */
export type TimelineEvent = {
  id: string
  kind: EventKind
  /** 整数分；CONTINGENCY_RELEASE 不用 */
  amount: number
  /** 节点 at 原文（§12.7） */
  at: string
  /** 参与排序的北京时间自然日；逾期流出为 as_of 所在日（§10.1 第7步） */
  day: string
  knownOrder?: number
  coverage: Coverage[]
  /** 计入 lastGoalDate（D04、D41） */
  goalRelated: boolean
  /** D64 的已确认预计收入 */
  confirmedIncome: boolean
  /** 情景支出：不参与 D56 */
  scenario?: boolean
  /** §10.6 的待测流出 x：插在时间轴最前 */
  leading?: boolean
}

export type TimelineReserve = {
  reserveId: string
  kind: ReserveKind
  /** 已建立的为剩余额，未建立的为原定金额 */
  amount: number
  coverageStart: string
  fundingEventId: string | null
  /** 未建立的在所挂流入的节点建立（D08、D40） */
  established: boolean
}

export type TimelineInput = {
  asOf: string
  /** 现金未知时为 null，不逐节点计算 */
  start: {
    cash: number
    otherGoalHold: number
    goalAllocation: number
  } | null
  reserves: TimelineReserve[]
  /** D18：紧随所挂收入转入 A */
  plannedAllocation: {
    fundingEventId: string
    amount: number
  } | null
  events: TimelineEvent[]
  issues: InputIssue[]
}

export type CheckPeriod = ResultCore['checkPeriod']
export type NodeRecord = ResultCore['nodes'][number]
export type GapRef = ResultCore['gapList'][number]

export type TimelineResult = {
  checkPeriod: CheckPeriod
  issues: InputIssue[]
  /** 检查期间内按 §10.2 排好的事件 */
  events: TimelineEvent[]
  nodes: NodeRecord[]
  earliestGap: GapRef | null
  gapList: GapRef[]
  allocationConflicts: GapRef[]
}
