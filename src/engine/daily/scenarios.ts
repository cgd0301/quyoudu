import type { EngineConfig } from '../config.ts'
import type { ScenarioKind, ScenarioUnavailableReason } from '../enums.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import { recentMonthScenario } from '../scenarios/recent-month.ts'
import type { ScenarioExpense, ScenarioResult } from '../scenarios/types.ts'
import { dayOf } from '../timeline/dates.ts'
import type { TimelineEvent } from '../timeline/index.ts'

/** §10.5 第4步、D26：每日参考检查的一个情景 */
export type DailyScenario = {
  kind: ScenarioKind
  /** R018 异常：不可用时为原因，从情景集合中移出 */
  unavailableReason: ScenarioUnavailableReason | null
  /**
   * 情景支出（标 scenario 的流出），不含今日由 x 替换的同口径部分（D22）。
   * null 表示该情景无法完整评估，不以忽略它的方式计算 D（R019）。
   */
  events: readonly TimelineEvent[] | null
}

export const CONFIRMED_ONLY_SCENARIO: DailyScenario = { kind: 'CONFIRMED_ONLY', unavailableReason: null, events: [] }

export type ScenarioSet = {
  /** 交给每日参考的情景集合，顺序为 CONFIRMED_ONLY、RECENT_MONTH */
  daily: DailyScenario[]
  /** scenarios[]，dailyReference 先为空，由每日参考填入各情景自己的 D */
  records: ScenarioResult[]
}

function confirmedOnlyRecord(config: EngineConfig): ScenarioResult {
  return {
    kind: 'CONFIRMED_ONLY',
    available: true,
    unavailableReason: null,
    configVersion: config.configVersion,
    observationStart: null,
    observationEnd: null,
    completeDays: 0,
    groups: [],
    todayReplacement: null,
    dailyReference: null,
  }
}

function scenarioEvent(expense: ScenarioExpense): TimelineEvent {
  return {
    id: expense.eventId,
    kind: 'OTHER_EXPENSE',
    amount: expense.amount,
    at: expense.expectedAt,
    day: dayOf(expense.expectedAt) ?? expense.expectedAt,
    coverage: expense.coverage,
    goalRelated: false,
    confirmedIncome: false,
    scenario: true,
  }
}

/**
 * D26、§12.7：始终列出仅已确认安排与近月情景。
 * 近月支出只给每日参考的探测时间轴，不进入主时间轴。
 */
export function buildScenarios(data: NormalizedCase, config: EngineConfig, checkPeriodEnd: string | null): ScenarioSet {
  const recent = recentMonthScenario(
    {
      asOf: data.snapshot.asOf,
      checkPeriodEnd,
      consumptionRecords: data.consumptionRecords,
      reserves: data.reserves.map((reserve) => ({
        reserveId: reserve.reserveId,
        reserveKind: reserve.reserveKind,
        coverageStart: reserve.coverageStart,
        coverageEnd: reserve.coverageEnd,
      })),
      events: data.events.map((event) => ({
        eventId: event.eventId,
        eventKind: event.eventKind,
        eventStatus: event.eventStatus,
        amount: event.amount,
        expectedAt: event.expectedAt,
        ...(event.actualAt === undefined ? {} : { actualAt: event.actualAt }),
        inSnapshot: event.inSnapshot,
        availableAt: event.availableAt,
        currency: event.currency,
        ...(event.category === undefined ? {} : { category: event.category }),
      })),
    },
    config,
  )
  const available = recent.scenario.available
  return {
    daily: [
      CONFIRMED_ONLY_SCENARIO,
      {
        kind: 'RECENT_MONTH',
        unavailableReason: available ? null : recent.scenario.unavailableReason,
        events: available ? recent.expenses.map(scenarioEvent) : [],
      },
    ],
    records: [confirmedOnlyRecord(config), recent.scenario],
  }
}

/** D26 的情景集合。检查期间终点与主时间轴相同。 */
export function dailyScenarios(data: NormalizedCase, config: EngineConfig, checkPeriodEnd: string | null): DailyScenario[] {
  return buildScenarios(data, config, checkPeriodEnd).daily
}
