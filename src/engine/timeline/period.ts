import { laterDay } from './dates.ts'
import type { CheckPeriod, TimelineEvent } from './types.ts'

/** 提交版的日期上界（R008、D04） */
export const RANGE_END = '2027-01-01'

/**
 * §10.1 第1—6步（D04、D41、D56）。events 不含已计入快照的事件和条件事件，逾期流出已改到 as_of 所在日。
 * 应取的日期晚于 2027-01-01 时不截断，只标 outOfRange。
 */
export function checkPeriod(asOf: string, events: readonly TimelineEvent[]): CheckPeriod {
  const dated = events.filter((event) => event.unknown !== 'DATE')
  const incomes = dated
    .filter((event) => event.confirmedIncome)
    .map((event) => event.day)
    .sort()
  const goalDays = dated.filter((event) => event.goalRelated).map((event) => event.day)
  let end: string
  if (goalDays.length > 0) {
    const lastGoal = goalDays.reduce(laterDay)
    // D41②：与 lastGoalDate 同日的已确认收入算"其后"
    const nextIncome = incomes.find((day) => day >= lastGoal)
    end = laterDay(lastGoal, nextIncome ?? RANGE_END)
  } else {
    end = incomes.at(0) ?? RANGE_END
  }
  for (const event of dated) {
    if (event.kind === 'OTHER_EXPENSE' && event.scenario !== true && event.leading !== true) end = laterDay(end, event.day)
  }
  return { start: asOf, end, outOfRange: end > RANGE_END }
}
