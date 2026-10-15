import type { EngineConfig } from '../config.ts'
import type { ScenarioKind, ScenarioUnavailableReason } from '../enums.ts'
import type { NormalizedCase } from '../normalize/index.ts'
import { dayOf, nextDay } from '../timeline/dates.ts'
import type { TimelineEvent } from '../timeline/index.ts'

/** R008 支持日期范围的下界 */
const RANGE_START = '2026-09-01'

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

/** §7.1：as_of 之前最近 windowDays 个历日，须全部不早于支持范围的下界；做不到时为 null */
function observationWindow(asOfDay: string, windowDays: number): string[] | null {
  const days: string[] = []
  for (let day = RANGE_START; day < asOfDay; day = nextDay(day)) days.push(day)
  return days.length < windowDays ? null : days.slice(days.length - windowDays)
}

function recentMonth(data: NormalizedCase, windowDays: number): DailyScenario {
  const asOfDay = dayOf(data.snapshot.asOf)
  const window = asOfDay === null ? null : observationWindow(asOfDay, windowDays)
  const recorded = new Set(data.consumptionRecords.map((day) => day.observedOn))
  const missing = new Set(data.consumptionRecords.filter((day) => day.dayCoverage === 'MISSING').map((day) => day.observedOn))
  // §12.7：观察窗口内完整历日（COMPLETE 或 NO_SPEND）不足 windowDays 个时历史不足
  if (window === null || window.some((day) => !recorded.has(day) || missing.has(day))) {
    return { kind: 'RECENT_MONTH', unavailableReason: 'HISTORY_INSUFFICIENT', events: [] }
  }
  // SPEC-GAP SG-69：近月情景支出由 M9 生成，接入前无法完整评估
  return { kind: 'RECENT_MONTH', unavailableReason: null, events: null }
}

/** D26 的情景集合，顺序为 CONFIRMED_ONLY、RECENT_MONTH（§12.7）。M9 接入前近月情景只判断历史是否足够 */
export function dailyScenarios(data: NormalizedCase, config: EngineConfig): DailyScenario[] {
  return [CONFIRMED_ONLY_SCENARIO, recentMonth(data, config.scenario.windowDays)]
}
