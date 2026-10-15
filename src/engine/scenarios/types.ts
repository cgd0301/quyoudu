import type { ConsumptionCategory, DayCoverage, EventKind, EventStatus, ReserveKind } from '../enums.ts'
import type { ResultCore } from '../result.ts'

// 字段名为 CaseFile 字段按 §9.1 转成的 camelCase，只列本模块用到的字段

export type ConsumptionItemInput = {
  eventId: string
  category: ConsumptionCategory
  amount: number
  currency: string
  inSnapshot: boolean
  availableAt: string
  coveredByLivingReserve?: boolean
  sameScopeAsDiscretionary?: boolean
}

export type ConsumptionDayInput = {
  observedOn: string
  dayCoverage: DayCoverage
  items: readonly ConsumptionItemInput[]
}

export type ReserveInput = {
  reserveId: string
  reserveKind: ReserveKind
  coverageStart: string
  coverageEnd: string
}

export type EventInput = {
  eventId: string
  eventKind: EventKind
  eventStatus: EventStatus
  amount: number | null
  expectedAt: string | null
  actualAt?: string
  inSnapshot: boolean
  availableAt: string
  currency: string
  category?: ConsumptionCategory
}

export type ScenarioInput = {
  /** snapshot.as_of 原文 */
  asOf: string
  /** check_period.end（§10.1）；未定时为 null */
  checkPeriodEnd: string | null
  consumptionRecords: readonly ConsumptionDayInput[]
  reserves: readonly ReserveInput[]
  events: readonly EventInput[]
}

export type ScenarioResult = NonNullable<ResultCore['scenarios']>[number]
export type ScenarioGroupResult = ScenarioResult['groups'][number]

/** 供每日参考加入时间轴的情景支出（R018 第6条、D21） */
export type ScenarioExpense = {
  eventId: string
  eventKind: 'OTHER_EXPENSE'
  amount: number
  expectedAt: string
  timePrecision: 'DATE'
  category: ConsumptionCategory
  coverage: { reserveId: string; coveredAmount: number }[]
}

export type RecentMonthScenario = {
  /** scenarios[] 中 kind 为 RECENT_MONTH 的一项；dailyReference 由每日参考填写 */
  scenario: ScenarioResult
  expenses: ScenarioExpense[]
}
