import type { EngineConfig } from '../config.ts'
import type { ScenarioUnavailableReason } from '../enums.ts'
import { flagsConflict, isSameScope } from './categories.ts'
import { isAvailableBy, isDate, parseInstant, type Instant } from './dates.ts'
import { buildGroups, money, sum, type BuiltGroup } from './groups.ts'
import type { EventInput, RecentMonthScenario, ScenarioExpense, ScenarioInput } from './types.ts'
import { noWindow, observationWindow, type ObservationWindow } from './window.ts'

/** D22：今日情景替换额，即 R019 第5条、§4 第3步中由 x 替换的部分 */
export function todayReplacement(todayScenario: number, todaySpent: number): number {
  return Math.max(0, todayScenario - todaySpent)
}

function unavailable(reason: ScenarioUnavailableReason, configVersion: string | null, window: ObservationWindow): RecentMonthScenario {
  return {
    scenario: {
      kind: 'RECENT_MONTH',
      available: false,
      unavailableReason: reason,
      configVersion,
      observationStart: window.start,
      observationEnd: window.end,
      completeDays: window.days.length,
      groups: [],
      todayReplacement: null,
      dailyReference: null,
    },
    expenses: [],
  }
}

// SPEC-GAP SG-54：今日已发生同口径支出取 as_of 当日、已可获得的 ACTUAL 同口径 OTHER_EXPENSE
function spentToday(event: EventInput, asOf: Instant): boolean {
  const at = event.actualAt ?? event.expectedAt
  return (
    event.eventKind === 'OTHER_EXPENSE' &&
    event.eventStatus === 'ACTUAL' &&
    event.category !== undefined &&
    isSameScope(event.category) &&
    event.amount !== null &&
    event.currency === 'CNY' &&
    at !== null &&
    parseInstant(at)?.date === asOf.date &&
    isAvailableBy(event.availableAt, asOf)
  )
}

// SPEC-GAP SG-54：as_of 当日的同口径情景支出不进每日参考的时间轴：已发生的部分在快照中，其余由 x 替换（D22）
function expensesOf(groups: readonly BuiltGroup[], today: string): ScenarioExpense[] {
  const expenses = groups.flatMap(({ result, reserveId }) =>
    result.dailyAmounts
      .filter(({ date, amount }) => amount.value > 0 && !(date === today && isSameScope(result.category)))
      .map(
        ({ date, amount }): ScenarioExpense => ({
          eventId: `RECENT_MONTH:${result.category}:${date}`,
          eventKind: 'OTHER_EXPENSE',
          amount: amount.value,
          expectedAt: date,
          timePrecision: 'DATE',
          category: result.category,
          // D21：核销覆盖期间包含该日的生活预留，不足部分由时间轴按未覆盖支出处理（§10.3）
          coverage: reserveId === null ? [] : [{ reserveId, coveredAmount: amount.value }],
        }),
      ),
  )
  return expenses.sort((left, right) => (left.expectedAt === right.expectedAt ? 0 : left.expectedAt < right.expectedAt ? -1 : 1))
}

/**
 * R018 近月情景（§5、§7.1、D21—D23、D48、D49、D67）。
 * 每日参考用 expenses 构造情景时间轴，并填写 scenario.dailyReference。
 */
export function recentMonthScenario(input: ScenarioInput, config: EngineConfig): RecentMonthScenario {
  // SPEC-GAP SG-55：只报一个原因，先后为配置版本、历史、类别标注、覆盖关系
  // §7.3：缺少配置版本时不启用该统计口径；SPEC-GAP SG-51：也不给观察窗口
  if (config.configVersion === null) return unavailable('CONFIG_VERSION_MISSING', null, noWindow())
  const configVersion = config.configVersion
  const asOf = parseInstant(input.asOf)
  // SPEC-GAP SG-51：as_of 无法解析时没有可用历史
  if (asOf === null) return unavailable('HISTORY_INSUFFICIENT', configVersion, noWindow())
  const window = observationWindow(input.consumptionRecords, asOf, config.scenario.windowDays)
  if (!window.sufficient) return unavailable('HISTORY_INSUFFICIENT', configVersion, window)
  if (window.days.some((record) => record.items.some(flagsConflict))) return unavailable('CATEGORY_FLAGS_MISSING', configVersion, window)
  const end = input.checkPeriodEnd
  // SPEC-GAP SG-55：检查期间终点未定时定不出组的覆盖期间
  if (end === null || !isDate(end) || end < asOf.date) return unavailable('COVERAGE_UNCLEAR', configVersion, window)
  const groups = buildGroups({
    asOf,
    checkPeriodEnd: end,
    history: window.days,
    windowDays: config.scenario.windowDays,
    reserves: input.reserves,
    events: input.events,
  })
  if (groups === null) return unavailable('COVERAGE_UNCLEAR', configVersion, window)
  const spent = input.events.filter((event) => spentToday(event, asOf))
  const todayScenario = sum(
    groups
      .filter(({ result }) => isSameScope(result.category))
      .flatMap(({ result }) => result.dailyAmounts.filter(({ date }) => date === asOf.date).map(({ amount }) => amount.value)),
  )
  const replacement = todayReplacement(todayScenario, sum(spent.map((event) => event.amount ?? 0)))
  return {
    scenario: {
      kind: 'RECENT_MONTH',
      available: true,
      unavailableReason: null,
      configVersion,
      observationStart: window.start,
      observationEnd: window.end,
      completeDays: window.days.length,
      groups: groups.map(({ result }) => result),
      todayReplacement: money(
        replacement,
        spent.map((event) => event.eventId),
        [],
        ['D22'],
      ),
      dailyReference: null,
    },
    expenses: expensesOf(groups, asOf.date),
  }
}
