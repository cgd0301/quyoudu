import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1, type EngineConfig } from '../../src/engine/config.ts'
import { CONSUMPTION_CATEGORIES, type ConsumptionCategory, type DayCoverage } from '../../src/engine/enums.ts'
import { resultCoreSchema } from '../../src/engine/result.ts'
import { CATEGORY_FLAGS, DAILY_CATEGORIES } from '../../src/engine/scenarios/categories.ts'
import { roundHalfUpDiv, splitEvenly } from '../../src/engine/scenarios/groups.ts'
import { recentMonthScenario, todayReplacement } from '../../src/engine/scenarios/recent-month.ts'
import type {
  ConsumptionDayInput,
  ConsumptionItemInput,
  EventInput,
  RecentMonthScenario,
  ReserveInput,
  ScenarioGroupResult,
  ScenarioInput,
} from '../../src/engine/scenarios/types.ts'

const AS_OF = '2026-10-01T09:00:00+08:00'
const KNOWN_BEFORE = '2026-09-01T08:00:00+08:00'
const FC_PARAMS = { seed: 20261001, numRuns: 200 }

function shift(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function dates(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shift(start, index))
}

const SEPTEMBER = dates('2026-09-01', 30)
const OCT_1_TO_10 = dates('2026-10-01', 10)

type ItemSpec = Pick<ConsumptionItemInput, 'category' | 'amount'> & Partial<ConsumptionItemInput>

function day(observedOn: string, dayCoverage: DayCoverage, items: readonly ItemSpec[] = []): ConsumptionDayInput {
  return {
    observedOn,
    dayCoverage,
    items: items.map((spec, index) => ({
      eventId: `C-${observedOn}-${index + 1}`,
      currency: 'CNY',
      inSnapshot: true,
      availableAt: `${observedOn}T21:00:00+08:00`,
      ...spec,
    })),
  }
}

/** 各类别合计平均放进 COMPLETE 的日子，分币余数放在前几日；NO_SPEND、MISSING 的日子没有记录 */
function history(
  days: readonly string[],
  totals: readonly (readonly [ConsumptionCategory, number])[],
  coverage: Readonly<Record<string, DayCoverage>> = {},
): ConsumptionDayInput[] {
  const spending = days.filter((date) => (coverage[date] ?? 'COMPLETE') === 'COMPLETE')
  return days.map((date) => {
    const dayCoverage = coverage[date] ?? 'COMPLETE'
    if (dayCoverage !== 'COMPLETE') return day(date, dayCoverage)
    const index = spending.indexOf(date)
    return day(
      date,
      dayCoverage,
      totals.map(([category, total]) => {
        const remainder = total % spending.length
        return { category, amount: (total - remainder) / spending.length + (index < remainder ? 1 : 0) }
      }),
    )
  })
}

function editDay(
  records: readonly ConsumptionDayInput[],
  date: string,
  edit: (record: ConsumptionDayInput) => ConsumptionDayInput | ConsumptionDayInput[],
): ConsumptionDayInput[] {
  return records.flatMap((record) => (record.observedOn === date ? edit(record) : [record]))
}

function editItems(record: ConsumptionDayInput, edit: (item: ConsumptionItemInput) => ConsumptionItemInput): ConsumptionDayInput {
  return { ...record, items: record.items.map(edit) }
}

/** 按 D48 原文在日常类别记录上写明两个标记，同 T018-11 向量的数据 */
function withFlags(records: readonly ConsumptionDayInput[]): ConsumptionDayInput[] {
  const covered = { coveredByLivingReserve: true, sameScopeAsDiscretionary: false }
  const flags: Partial<Record<ConsumptionCategory, Partial<ConsumptionItemInput>>> = {
    MEALS: covered,
    LOCAL_TRANSPORT: covered,
    DAILY_GOODS: covered,
    ENTERTAINMENT: { coveredByLivingReserve: false, sameScopeAsDiscretionary: true },
  }
  return records.map((record) => editItems(record, (item) => ({ ...item, ...flags[item.category] })))
}

function living(reserveId: string, coverageStart: string, coverageEnd: string): ReserveInput {
  return { reserveId, reserveKind: 'LIVING', coverageStart, coverageEnd }
}

/** 已确认生活安排：未计入快照的预计生活支出（SG-31 的 events[].category） */
function arrangement(
  eventId: string,
  date: string | null,
  category: ConsumptionCategory,
  amount: number | null,
  overrides: Partial<EventInput> = {},
): EventInput {
  return {
    eventId,
    eventKind: 'OTHER_EXPENSE',
    eventStatus: 'EXPECTED',
    amount,
    expectedAt: date,
    inSnapshot: false,
    availableAt: KNOWN_BEFORE,
    currency: 'CNY',
    category,
    ...overrides,
  }
}

/** 已实际发生并计入快照的支出 */
function spent(eventId: string, at: string, category: ConsumptionCategory, amount: number, overrides: Partial<EventInput> = {}): EventInput {
  return {
    eventId,
    eventKind: 'OTHER_EXPENSE',
    eventStatus: 'ACTUAL',
    amount,
    expectedAt: at,
    actualAt: at,
    inSnapshot: true,
    availableAt: at,
    currency: 'CNY',
    category,
    ...overrides,
  }
}

function run(overrides: Partial<ScenarioInput>, config: EngineConfig = DEMO_CFG_1): RecentMonthScenario {
  return recentMonthScenario(
    { asOf: AS_OF, checkPeriodEnd: '2026-10-10', consumptionRecords: [], reserves: [], events: [], ...overrides },
    config,
  )
}

function group(result: RecentMonthScenario, category: ConsumptionCategory): ScenarioGroupResult {
  const found = result.scenario.groups.filter((item) => item.category === category)
  expect(found, category).toHaveLength(1)
  return found[0]
}

function daily(item: ScenarioGroupResult): [string, number][] {
  return item.dailyAmounts.map(({ date, amount }) => [date, amount.value])
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** T018-04：9 月餐饮合计 mealsTotal，10/1—10/10 已确认餐饮每日 30.00，10 月生活预留 R-LIV-10 */
function mealsCase(mealsTotal: number): Partial<ScenarioInput> {
  return {
    consumptionRecords: history(SEPTEMBER, [['MEALS', mealsTotal]]),
    reserves: [living('R-LIV-10', '2026-10-01', '2026-10-31')],
    events: OCT_1_TO_10.map((date) => arrangement(`E-M${date.slice(5, 7)}${date.slice(8)}`, date, 'MEALS', 3000)),
  }
}

const AS_OF_1015 = '2026-10-01T15:00:00+08:00'

/** T018-10：9 月娱乐合计 1000.00，as_of 当日已发生娱乐支出 amount */
function entertainmentCase(amount: number): Partial<ScenarioInput> {
  return {
    asOf: AS_OF_1015,
    consumptionRecords: history(SEPTEMBER, [['ENTERTAINMENT', 100000]]),
    events: [spent('E-ENT', '2026-10-01T12:00:00+08:00', 'ENTERTAINMENT', amount)],
  }
}

describe('观察窗口（§7.1、§12.7、R008）', () => {
  test('T018-02 9/15 为 MISSING、其余 29 天为 COMPLETE：完整历日只有 29 个，不生成近月情景', () => {
    const result = run({ consumptionRecords: history(SEPTEMBER, [['MEALS', 87000]], { '2026-09-15': 'MISSING' }) })
    expect(result.scenario).toMatchObject({
      kind: 'RECENT_MONTH',
      available: false,
      unavailableReason: 'HISTORY_INSUFFICIENT',
      completeDays: 29,
      groups: [],
      todayReplacement: null,
      dailyReference: null,
    })
    expect(result.expenses).toEqual([])
  })

  test('T018-02 9/15 不按 0 计入：只有改为 NO_SPEND（确认无支出）才凑满 30 个完整历日', () => {
    const result = run({ consumptionRecords: history(SEPTEMBER, [['MEALS', 87000]], { '2026-09-15': 'NO_SPEND' }) })
    expect(result.scenario).toMatchObject({ available: true, completeDays: 30 })
  })

  test('读法 A（precheck 第6组）：更晚的 as_of 跳过缺记录日，凑满 30 个完整历日', () => {
    const records = history(dates('2026-09-01', 31), [['MEALS', 90000]], { '2026-09-15': 'MISSING' })
    const result = run({ asOf: '2026-10-02T09:00:00+08:00', consumptionRecords: records })
    expect(result.scenario).toMatchObject({
      available: true,
      completeDays: 30,
      observationStart: '2026-09-01',
      observationEnd: '2026-10-01',
    })
  })

  test('T008-06 9/1—9/30 均为 COMPLETE 或 NO_SPEND：观察窗口为 9/1—9/30，满足 30 个完整历日门槛', () => {
    const noSpend: Record<string, DayCoverage> = {
      '2026-09-06': 'NO_SPEND',
      '2026-09-13': 'NO_SPEND',
      '2026-09-20': 'NO_SPEND',
      '2026-09-27': 'NO_SPEND',
    }
    const result = run({
      consumptionRecords: history(SEPTEMBER, [['MEALS', 78000]], noSpend),
      reserves: [living('R-LIV-09', '2026-09-01', '2026-09-30')],
      checkPeriodEnd: '2027-01-01',
    })
    expect(result.scenario).toMatchObject({
      available: true,
      observationStart: '2026-09-01',
      observationEnd: '2026-09-30',
      completeDays: 30,
    })
  })

  test('T008-05 8 月记录超出范围，不进入统计：可用历史为 0，历史不足', () => {
    const result = run({
      asOf: '2026-09-01T09:00:00+08:00',
      checkPeriodEnd: '2026-09-30',
      consumptionRecords: [day('2026-08-25', 'COMPLETE', [{ category: 'MEALS', amount: 3000, availableAt: '2026-08-25T21:00:00+08:00' }])],
    })
    expect(result.scenario).toMatchObject({ available: false, unavailableReason: 'HISTORY_INSUFFICIENT', completeDays: 0 })
  })

  test('T001-04 不读取可获得时间晚于 as_of 的 9/2—9/30 记录：可用样本为 0，历史不足', () => {
    const late = history(dates('2026-09-02', 29), [['MEALS', 87000]]).map((record) =>
      editItems(record, (item) => ({ ...item, availableAt: '2026-10-01T08:00:00+08:00' })),
    )
    const result = run({ asOf: '2026-09-01T09:00:00+08:00', checkPeriodEnd: '2026-09-27', consumptionRecords: late })
    expect(result.scenario).toMatchObject({ available: false, unavailableReason: 'HISTORY_INSUFFICIENT', completeDays: 0 })
  })
})

describe('消费类别（D21、D48）', () => {
  test('T018-11 gap 各类别的两个标记', () => {
    expect(CATEGORY_FLAGS).toEqual({
      MEALS: { coveredByLivingReserve: true, sameScopeAsDiscretionary: false },
      LOCAL_TRANSPORT: { coveredByLivingReserve: true, sameScopeAsDiscretionary: false },
      DAILY_GOODS: { coveredByLivingReserve: true, sameScopeAsDiscretionary: false },
      ENTERTAINMENT: { coveredByLivingReserve: false, sameScopeAsDiscretionary: true },
      GOAL_RELATED: null,
      INCOME: null,
      REFUND: null,
      TRANSFER: null,
    })
    expect(DAILY_CATEGORIES).toEqual(['MEALS', 'LOCAL_TRANSPORT', 'DAILY_GOODS', 'ENTERTAINMENT'])
    for (const category of CONSUMPTION_CATEGORIES) {
      const flags = CATEGORY_FLAGS[category]
      if (flags !== null) expect(flags.coveredByLivingReserve && flags.sameScopeAsDiscretionary, category).toBe(false)
    }
  })

  test('T018-11 收入、退款、转账、目标相关不进入日常情景；餐饮、本地交通、日用核销生活预留，娱乐不核销且今日部分由 x 替换', () => {
    const totals: [ConsumptionCategory, number][] = [
      ['MEALS', 60000],
      ['LOCAL_TRANSPORT', 15000],
      ['DAILY_GOODS', 9000],
      ['ENTERTAINMENT', 30000],
      ['INCOME', 150000],
      ['REFUND', 5000],
      ['TRANSFER', 10000],
      ['GOAL_RELATED', 58000],
    ]
    const reserves = [living('R-LIV-10', '2026-10-01', '2026-10-31')]
    const all = run({ consumptionRecords: withFlags(history(SEPTEMBER, totals)), reserves })
    expect(all.scenario.groups.map((item) => item.category)).toEqual(['MEALS', 'LOCAL_TRANSPORT', 'DAILY_GOODS', 'ENTERTAINMENT'])
    const dailyOnly = run({ consumptionRecords: history(SEPTEMBER, totals.slice(0, 4)), reserves })
    expect(all.scenario.groups).toEqual(dailyOnly.scenario.groups)
    for (const item of all.scenario.groups) {
      expect(item.scenarioGroupTotal.basis.reserveIds, item.category).toEqual(item.category === 'ENTERTAINMENT' ? [] : ['R-LIV-10'])
    }
    const today = all.expenses.filter((expense) => expense.expectedAt === '2026-10-01')
    expect(today.map((expense) => [expense.category, expense.coverage])).toEqual([
      ['MEALS', [{ reserveId: 'R-LIV-10', coveredAmount: 2000 }]],
      ['LOCAL_TRANSPORT', [{ reserveId: 'R-LIV-10', coveredAmount: 500 }]],
      ['DAILY_GOODS', [{ reserveId: 'R-LIV-10', coveredAmount: 300 }]],
    ])
    expect(all.expenses.filter((expense) => expense.category === 'ENTERTAINMENT').every((expense) => expense.coverage.length === 0)).toBe(
      true,
    )
  })

  test('T018-03 目标相关的一次性门票 580 不进入日常支出均值，也不在 10 月重复生成', () => {
    const meals = history(SEPTEMBER, [['MEALS', 90000]])
    const withTicket = editDay(meals, '2026-09-10', (record) => ({
      ...record,
      items: [...record.items, { ...record.items[0], eventId: 'E-TICKET', category: 'GOAL_RELATED', amount: 58000 }],
    }))
    const result = run({ consumptionRecords: withTicket })
    expect(result.scenario.groups.some((item) => item.category === 'GOAL_RELATED')).toBe(false)
    expect(result.expenses.some((expense) => expense.category === 'GOAL_RELATED')).toBe(false)
    expect(group(result, 'MEALS').scenarioGroupTotal).toEqual(group(run({ consumptionRecords: meals }), 'MEALS').scenarioGroupTotal)
  })
})

describe('情景组（D67、§5、D23、D49）', () => {
  test('T018-04 Pg=1000.00×10÷30=333.333… 取 333.33，Eg=300.00，Δg=33.33；10/1—10/3 每日 3.34、10/4—10/10 每日 3.33', () => {
    const result = run(mealsCase(100000))
    expect(result.scenario.available).toBe(true)
    const meals = group(result, 'MEALS')
    expect(meals.scenarioGroupTotal.value).toBe(33333)
    expect(meals.scheduledGroupTotal.value).toBe(30000)
    expect(meals.scenarioIncrement.value).toBe(3333)
    expect(daily(meals)).toEqual([
      ['2026-10-01', 334],
      ['2026-10-02', 334],
      ['2026-10-03', 334],
      ['2026-10-04', 333],
      ['2026-10-05', 333],
      ['2026-10-06', 333],
      ['2026-10-07', 333],
      ['2026-10-08', 333],
      ['2026-10-09', 333],
      ['2026-10-10', 333],
    ])
    expect(sum(meals.dailyAmounts.map(({ amount }) => amount.value))).toBe(3333)
  })

  test('T018-04 Eg 只计已列入安排的支出，不含生活预留余额；Δg 另行加入并核销 R-LIV-10', () => {
    const withoutArrangements = group(run({ ...mealsCase(100000), events: [] }), 'MEALS')
    expect(withoutArrangements.scheduledGroupTotal.value).toBe(0)
    expect(withoutArrangements.scenarioIncrement.value).toBe(33333)
    const result = run(mealsCase(100000))
    const meals = result.expenses.filter((expense) => expense.category === 'MEALS')
    expect(meals.map((expense) => [expense.expectedAt, expense.amount])).toEqual(daily(group(result, 'MEALS')))
    for (const expense of meals) expect(expense.coverage).toEqual([{ reserveId: 'R-LIV-10', coveredAmount: expense.amount }])
  })

  test('T018-06 Pg=750.00×10÷30=250.00 低于 Eg=300.00：Δg=max(0, 250.00-300.00)=0，Eg 仍为 300.00', () => {
    const result = run(mealsCase(75000))
    const meals = group(result, 'MEALS')
    expect(meals.scenarioGroupTotal.value).toBe(25000)
    expect(meals.scheduledGroupTotal.value).toBe(30000)
    expect(meals.scenarioIncrement.value).toBe(0)
    expect(meals.dailyAmounts.every(({ amount }) => amount.value === 0)).toBe(true)
    expect(result.expenses.filter((expense) => expense.category === 'MEALS')).toEqual([])
  })

  test('T018-12 Pg=10.00、Eg=5.00、Δg=5.00，按 D23 分摊为 1.67、1.67、1.66，不先分摊 Pg 再逐日去重', () => {
    const result = run({
      consumptionRecords: history(SEPTEMBER, [['MEALS', 10000]]),
      reserves: [living('R-LIV-10', '2026-10-01', '2026-10-31')],
      events: [
        arrangement('E-M1001', '2026-10-01', 'MEALS', 167),
        arrangement('E-M1002', '2026-10-02', 'MEALS', 167),
        arrangement('E-M1003', '2026-10-03', 'MEALS', 166),
      ],
      checkPeriodEnd: '2026-10-03',
    })
    const meals = group(result, 'MEALS')
    expect(meals.scenarioGroupTotal.value).toBe(1000)
    expect(meals.scheduledGroupTotal.value).toBe(500)
    expect(meals.scenarioIncrement.value).toBe(500)
    expect(daily(meals)).toEqual([
      ['2026-10-01', 167],
      ['2026-10-02', 167],
      ['2026-10-03', 166],
    ])
    expect(meals.dailyAmounts[1].amount.value).not.toBe(166)
    expect(meals.dailyAmounts[2].amount.value).not.toBe(167)
  })

  test('D67 例 100000×10÷30=33333.33… 一次取整为 33333 分；D23 ROUND_HALF_UP 恰为一半时进位', () => {
    expect(roundHalfUpDiv(100000 * 10, 30)).toBe(33333)
    expect(roundHalfUpDiv(45, 30)).toBe(2)
    expect(roundHalfUpDiv(44, 30)).toBe(1)
    expect(roundHalfUpDiv(0, 30)).toBe(0)
  })

  test('D23、D49 整数分平均分摊，分币余数按日期从早到晚分配', () => {
    expect(splitEvenly(3333, 10)).toEqual([334, 334, 334, 333, 333, 333, 333, 333, 333, 333])
    expect(splitEvenly(500, 3)).toEqual([167, 167, 166])
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0])
  })

  test('D67 由生活预留覆盖的类别按对应生活预留的覆盖期间切分、各组分别取整；娱乐整个检查期间为一组', () => {
    const result = run({
      consumptionRecords: history(SEPTEMBER, [
        ['MEALS', 100000],
        ['ENTERTAINMENT', 30000],
      ]),
      reserves: [living('R-LIV-A', '2026-09-20', '2026-10-04'), living('R-LIV-B', '2026-10-05', '2026-10-31')],
    })
    const meals = result.scenario.groups.filter((item) => item.category === 'MEALS')
    // 100000×4÷30=13333.33… 取 13333；100000×6÷30=20000
    expect(
      meals.map((item) => [item.coverageStart, item.coverageEnd, item.dailyAmounts.length, item.scenarioGroupTotal.value, item.scenarioGroupTotal.basis.reserveIds]),
    ).toEqual([
      ['2026-09-20', '2026-10-04', 4, 13333, ['R-LIV-A']],
      ['2026-10-05', '2026-10-31', 6, 20000, ['R-LIV-B']],
    ])
    const entertainment = group(result, 'ENTERTAINMENT')
    expect([entertainment.coverageStart, entertainment.coverageEnd, entertainment.dailyAmounts.length]).toEqual(['2026-10-01', '2026-10-10', 10])
  })

  test('D21 可对应的生活预留不止一项时覆盖关系不清，近月情景不可用；重叠不在检查期间内或不是生活预留时不影响', () => {
    const records = history(SEPTEMBER, [['MEALS', 100000]])
    const overlapping = run({
      consumptionRecords: records,
      reserves: [living('R-LIV-A', '2026-10-01', '2026-10-05'), living('R-LIV-B', '2026-10-05', '2026-10-31')],
    })
    expect(overlapping.scenario).toMatchObject({ available: false, unavailableReason: 'COVERAGE_UNCLEAR', groups: [], todayReplacement: null })
    expect(overlapping.expenses).toEqual([])
    const outside = run({
      consumptionRecords: records,
      reserves: [living('R-LIV-09', '2026-09-01', '2026-09-30'), living('R-LIV-X', '2026-09-15', '2026-10-31')],
    })
    expect(outside.scenario.available).toBe(true)
    const contingency = run({
      consumptionRecords: records,
      reserves: [
        living('R-LIV-10', '2026-10-01', '2026-10-31'),
        { reserveId: 'R-CON', reserveKind: 'CONTINGENCY', coverageStart: '2026-09-01', coverageEnd: '2026-10-28' },
      ],
    })
    expect(contingency.scenario.available).toBe(true)
  })

  test('输出通过 ResultCore scenarios[] 的结构（strictObject、金额为整数分）', () => {
    const schema = resultCoreSchema.shape.scenarios.unwrap().element
    const results = [
      run(mealsCase(100000)),
      run(entertainmentCase(2000)),
      run({ consumptionRecords: history(SEPTEMBER, [['MEALS', 87000]], { '2026-09-15': 'MISSING' }) }),
      run(mealsCase(100000), { ...DEMO_CFG_1, configVersion: null }),
    ]
    for (const result of results) expect(schema.safeParse(result.scenario).error).toBeUndefined()
  })
})

describe('今日情景替换额（D22）与配置版本（§7.3）', () => {
  test('T018-10 ①今日同口径情景额 33.34、已发生 20.00：max(0, 33.34-20.00)=13.34；②已发生 40.00：max(0, 33.34-40.00)=0', () => {
    expect(todayReplacement(3334, 2000)).toBe(1334)
    expect(todayReplacement(3334, 4000)).toBe(0)
    const first = run(entertainmentCase(2000))
    expect(daily(group(first, 'ENTERTAINMENT'))[0]).toEqual(['2026-10-01', 3334])
    expect(first.scenario.todayReplacement?.value).toBe(1334)
    const second = run(entertainmentCase(4000))
    expect(daily(group(second, 'ENTERTAINMENT'))[0]).toEqual(['2026-10-01', 3334])
    expect(second.scenario.todayReplacement?.value).toBe(0)
  })

  test('T019-03 今日已发生同口径支出为 0 时，今日替换额=max(0, 10.00-0)=10.00', () => {
    expect(todayReplacement(1000, 0)).toBe(1000)
  })

  test('T018-08#2 gap 缺少配置版本时近月情景不可用', () => {
    const result = run(mealsCase(100000), { ...DEMO_CFG_1, configVersion: null })
    expect(result.scenario).toMatchObject({
      available: false,
      unavailableReason: 'CONFIG_VERSION_MISSING',
      configVersion: null,
      groups: [],
      todayReplacement: null,
    })
    expect(result.expenses).toEqual([])
  })
})

describe('SPEC-GAP 暂定处理', () => {
  test('SG-70 当日有记录晚于 as_of 才可获得时该日不算完整历日，该记录不进入统计（T018-07）', () => {
    const records = history(SEPTEMBER, [['MEALS', 90000]])
    const availableAt = (text: string) => editDay(records, '2026-09-30', (record) => editItems(record, (item) => ({ ...item, availableAt: text })))
    const late = availableAt('2026-10-03T08:00:00+08:00')
    expect(run({ consumptionRecords: late }).scenario).toMatchObject({ available: false, unavailableReason: 'HISTORY_INSUFFICIENT', completeDays: 29 })
    expect(run({ consumptionRecords: availableAt('2026-10-01') }).scenario.completeDays).toBe(29)
    expect(run({ consumptionRecords: availableAt('2026-09-30') }).scenario.completeDays).toBe(30)
    const october1 = day('2026-10-01', 'COMPLETE', [{ category: 'MEALS', amount: 3000 }])
    const asOf = '2026-10-02T09:00:00+08:00'
    const skipped = run({ asOf, consumptionRecords: [...late, october1] })
    const without = run({ asOf, consumptionRecords: [...records.filter((record) => record.observedOn !== '2026-09-30'), october1] })
    expect(skipped.scenario).toMatchObject({ available: true, completeDays: 30, observationStart: '2026-09-01', observationEnd: '2026-10-01' })
    expect(group(skipped, 'MEALS').scenarioGroupTotal).toEqual(group(without, 'MEALS').scenarioGroupTotal)
  })

  test.each<[string, (record: ConsumptionDayInput) => ConsumptionDayInput | ConsumptionDayInput[]]>([
    ['NO_SPEND 却带记录', (record) => ({ ...record, dayCoverage: 'NO_SPEND' })],
    ['同一日有两条日记录', (record) => [record, editItems(record, (item) => ({ ...item, eventId: `${item.eventId}-2` }))]],
    ['日常类别记录不是人民币', (record) => editItems(record, (item) => ({ ...item, currency: 'USD' }))],
    ['日常类别记录为负数', (record) => editItems(record, (item) => ({ ...item, amount: -100 }))],
  ])('SG-70 %s的日子不算完整历日', (_name, edit) => {
    const records = editDay(history(SEPTEMBER, [['MEALS', 90000]]), '2026-09-15', edit)
    expect(run({ consumptionRecords: records }).scenario).toMatchObject({ available: false, completeDays: 29 })
  })

  test('SG-70 非日常类别记录的币种和正负不影响该日是否完整', () => {
    const records = editDay(history(SEPTEMBER, [['MEALS', 90000]]), '2026-09-15', (record) => ({
      ...record,
      items: [
        ...record.items,
        { ...record.items[0], eventId: 'E-INCOME-USD', category: 'INCOME', currency: 'USD' },
        { ...record.items[0], eventId: 'E-REFUND', category: 'REFUND', amount: -500 },
      ],
    }))
    expect(run({ consumptionRecords: records }).scenario).toMatchObject({ available: true, completeDays: 30 })
  })

  test('SG-70 不足 30 个完整历日时观察窗口为 9/1 至 as_of 前一日；as_of 之前没有范围内的日子时为 null', () => {
    const short = run({ consumptionRecords: history(SEPTEMBER, [['MEALS', 87000]], { '2026-09-15': 'MISSING' }) })
    expect(short.scenario).toMatchObject({ observationStart: '2026-09-01', observationEnd: '2026-09-30' })
    const first = run({ asOf: '2026-09-01T09:00:00+08:00', checkPeriodEnd: '2026-09-30' })
    expect(first.scenario).toMatchObject({ observationStart: null, observationEnd: null, completeDays: 0 })
  })

  test('SG-70 as_of 无法解析或配置版本缺失时不给观察窗口', () => {
    const records = history(SEPTEMBER, [['MEALS', 90000]])
    expect(run({ asOf: '2026-10-01 09:00', consumptionRecords: records }).scenario).toMatchObject({
      available: false,
      unavailableReason: 'HISTORY_INSUFFICIENT',
      observationStart: null,
      observationEnd: null,
      completeDays: 0,
    })
    expect(run({ consumptionRecords: records }, { ...DEMO_CFG_1, configVersion: null }).scenario).toMatchObject({
      observationStart: null,
      observationEnd: null,
      completeDays: 0,
    })
  })

  test('SG-71 窗口内记录的两个标记与 D48 不一致时近月情景不可用（类别标注）', () => {
    const records = history(SEPTEMBER, [
      ['MEALS', 60000],
      ['ENTERTAINMENT', 30000],
    ])
    const conflicting = editDay(records, '2026-09-20', (record) =>
      editItems(record, (item) => (item.category === 'ENTERTAINMENT' ? { ...item, coveredByLivingReserve: true } : item)),
    )
    expect(run({ consumptionRecords: conflicting }).scenario).toMatchObject({
      available: false,
      unavailableReason: 'CATEGORY_FLAGS_MISSING',
      completeDays: 30,
      groups: [],
    })
    expect(run({ consumptionRecords: withFlags(records) }).scenario.available).toBe(true)
  })

  test('SG-72 日常四类都出组，组内每日都列出（含 0）', () => {
    const result = run({ consumptionRecords: history(SEPTEMBER, [['MEALS', 90000]]) })
    expect(result.scenario.groups.map((item) => item.category)).toEqual(['MEALS', 'LOCAL_TRANSPORT', 'DAILY_GOODS', 'ENTERTAINMENT'])
    expect(daily(group(result, 'LOCAL_TRANSPORT'))).toEqual(OCT_1_TO_10.map((date) => [date, 0]))
    expect(result.expenses.every((expense) => expense.category === 'MEALS')).toBe(true)
  })

  test('SG-72 由生活预留覆盖的类别在没有对应生活预留的日子按连续日段成组，情景支出不带覆盖（T008-06 十月无生活预留仍可用）', () => {
    const noReserve = run({
      consumptionRecords: history(SEPTEMBER, [['MEALS', 78000]]),
      reserves: [living('R-LIV-09', '2026-09-01', '2026-09-30')],
      checkPeriodEnd: '2027-01-01',
    })
    expect(noReserve.scenario.available).toBe(true)
    const meals = group(noReserve, 'MEALS')
    expect([meals.coverageStart, meals.coverageEnd, meals.dailyAmounts.length, meals.scenarioGroupTotal.basis.reserveIds]).toEqual([
      '2026-10-01',
      '2027-01-01',
      93,
      [],
    ])
    expect(noReserve.expenses.every((expense) => expense.coverage.length === 0)).toBe(true)
    const between = run({
      consumptionRecords: history(SEPTEMBER, [['MEALS', 90000]]),
      reserves: [living('R-LIV-A', '2026-09-20', '2026-10-03'), living('R-LIV-B', '2026-10-08', '2026-10-31')],
    })
    expect(
      between.scenario.groups
        .filter((item) => item.category === 'MEALS')
        .map((item) => [item.coverageStart, item.coverageEnd, item.dailyAmounts.length, item.scenarioGroupTotal.basis.reserveIds]),
    ).toEqual([
      ['2026-09-20', '2026-10-03', 3, ['R-LIV-A']],
      ['2026-10-04', '2026-10-07', 4, []],
      ['2026-10-08', '2026-10-31', 3, ['R-LIV-B']],
    ])
  })

  test('SG-72 Eg 只取同类别、未计入快照、EXPECTED、人民币、可获得时间不晚于 as_of、日期在组内的 OTHER_EXPENSE', () => {
    const result = run({
      consumptionRecords: history(SEPTEMBER, [
        ['MEALS', 90000],
        ['LOCAL_TRANSPORT', 30000],
      ]),
      events: [
        arrangement('E-IN', '2026-10-02', 'MEALS', 3000),
        arrangement('E-TRANSPORT', '2026-10-02T08:00:00+08:00', 'LOCAL_TRANSPORT', 800),
        arrangement('E-AFTER-PERIOD', '2026-10-15', 'MEALS', 3000),
        arrangement('E-KNOWN-LATER', '2026-10-03', 'MEALS', 3000, { availableAt: '2026-10-02T08:00:00+08:00' }),
        arrangement('E-USD', '2026-10-04', 'MEALS', 3000, { currency: 'USD' }),
        arrangement('E-GOAL', '2026-10-05', 'MEALS', 3000, { eventKind: 'GOAL_PAYMENT' }),
        arrangement('E-NO-CATEGORY', '2026-10-06', 'MEALS', 3000, { category: undefined }),
        spent('E-PAID', '2026-10-01T08:00:00+08:00', 'MEALS', 3000),
      ],
    })
    expect(group(result, 'MEALS').scheduledGroupTotal).toMatchObject({ value: 3000, basis: { eventIds: ['E-IN'] } })
    expect(group(result, 'LOCAL_TRANSPORT').scheduledGroupTotal).toMatchObject({ value: 800, basis: { eventIds: ['E-TRANSPORT'] } })
  })

  test('SG-72 检查期间内同类别安排的金额或日期未知时 Pg、Eg 不可比，近月情景不可用', () => {
    const records = history(SEPTEMBER, [['MEALS', 90000]])
    const unknownAmount = run({ consumptionRecords: records, events: [arrangement('E-UNKNOWN', '2026-10-05', 'MEALS', null)] })
    expect(unknownAmount.scenario.unavailableReason).toBe('COVERAGE_UNCLEAR')
    const unknownDate = run({ consumptionRecords: records, events: [arrangement('E-UNDATED', null, 'MEALS', 3000)] })
    expect(unknownDate.scenario.unavailableReason).toBe('COVERAGE_UNCLEAR')
    const outside = run({ consumptionRecords: records, events: [arrangement('E-LATER', '2026-10-20', 'MEALS', null)] })
    expect(outside.scenario.available).toBe(true)
  })

  test('SG-73 今日已发生同口径支出只取 as_of 当日、已可获得的 ACTUAL 同口径 OTHER_EXPENSE', () => {
    const base = entertainmentCase(2000)
    const result = run({
      ...base,
      events: [
        ...(base.events ?? []),
        spent('E-MEAL', '2026-10-01T12:30:00+08:00', 'MEALS', 1500),
        spent('E-ENT-0930', '2026-09-30T20:00:00+08:00', 'ENTERTAINMENT', 1000),
        spent('E-ENT-LATE', '2026-10-01T14:00:00+08:00', 'ENTERTAINMENT', 1000, { availableAt: '2026-10-01T16:00:00+08:00' }),
      ],
    })
    expect(result.scenario.todayReplacement).toEqual({ value: 1334, basis: { eventIds: ['E-ENT'], reserveIds: [], rules: ['D22'] } })
  })

  test('SG-73 供每日参考的情景支出不含 as_of 当日的同口径部分（T019-03 不重复计入今日情景额）', () => {
    const result = run(entertainmentCase(2000))
    const entertainment = result.expenses.filter((expense) => expense.category === 'ENTERTAINMENT')
    expect(entertainment.map((expense) => expense.expectedAt)).toEqual(dates('2026-10-02', 9))
    expect(sum(entertainment.map((expense) => expense.amount))).toBe(33333 - 3334)
    expect(entertainment[0]).toEqual({
      eventId: 'RECENT_MONTH:ENTERTAINMENT:2026-10-02',
      eventKind: 'OTHER_EXPENSE',
      amount: 3334,
      expectedAt: '2026-10-02',
      timePrecision: 'DATE',
      category: 'ENTERTAINMENT',
      coverage: [],
    })
  })

  test('SG-74 不可用原因的先后：配置版本缺失、历史不足、类别标注、覆盖关系不清', () => {
    const noConfig = { ...DEMO_CFG_1, configVersion: null }
    const overlap = [living('R-LIV-A', '2026-10-01', '2026-10-05'), living('R-LIV-B', '2026-10-05', '2026-10-31')]
    const short = history(SEPTEMBER, [['MEALS', 87000]], { '2026-09-15': 'MISSING' })
    const conflicting = editDay(history(SEPTEMBER, [['ENTERTAINMENT', 30000]]), '2026-09-20', (record) =>
      editItems(record, (item) => ({ ...item, coveredByLivingReserve: true })),
    )
    expect(run({ consumptionRecords: short, reserves: overlap }, noConfig).scenario.unavailableReason).toBe('CONFIG_VERSION_MISSING')
    expect(run({ consumptionRecords: short, reserves: overlap }).scenario.unavailableReason).toBe('HISTORY_INSUFFICIENT')
    expect(run({ consumptionRecords: conflicting, reserves: overlap }).scenario.unavailableReason).toBe('CATEGORY_FLAGS_MISSING')
  })

  test('SG-74 检查期间终点未定或早于 as_of 当日时覆盖关系不清，仍报观察窗口', () => {
    const records = history(SEPTEMBER, [['MEALS', 90000]])
    for (const checkPeriodEnd of [null, '2026-09-30']) {
      expect(run({ consumptionRecords: records, checkPeriodEnd }).scenario).toMatchObject({
        available: false,
        unavailableReason: 'COVERAGE_UNCLEAR',
        observationStart: '2026-09-01',
        observationEnd: '2026-09-30',
        completeDays: 30,
        groups: [],
      })
    }
  })
})

const BASE = '2026-09-01'
const SPAN = 80

const itemArb = fc.record({
  category: fc.constantFrom(...CONSUMPTION_CATEGORIES),
  amount: fc.integer({ min: 0, max: 5000 }),
  inSnapshot: fc.boolean(),
  late: fc.oneof({ weight: 19, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
})

type ItemDraft = { category: ConsumptionCategory; amount: number; inSnapshot: boolean; late: boolean }

function itemsOf(date: string, drafts: readonly ItemDraft[]): ItemSpec[] {
  return drafts.map(({ category, amount, inSnapshot, late }) => ({
    category,
    amount,
    inSnapshot,
    availableAt: late ? `${shift(date, 2)}T08:00:00+08:00` : `${date}T21:00:00+08:00`,
  }))
}

const coverageArb = fc.oneof(
  { weight: 6, arbitrary: fc.constant<DayCoverage>('COMPLETE') },
  { weight: 1, arbitrary: fc.constant<DayCoverage>('NO_SPEND') },
  { weight: 1, arbitrary: fc.constant<DayCoverage>('MISSING') },
)

const inputArb = fc
  .record({
    asOfOffset: fc.integer({ min: 19, max: 75 }),
    days: fc.array(fc.option(fc.record({ dayCoverage: coverageArb, items: fc.array(itemArb, { maxLength: 3 }) }), { freq: 10 }), {
      minLength: SPAN,
      maxLength: SPAN,
    }),
    reserves: fc.array(fc.record({ start: fc.integer({ min: 19, max: 90 }), length: fc.integer({ min: 1, max: 40 }) }), { maxLength: 2 }),
    periodLength: fc.integer({ min: 0, max: 40 }),
    arrangements: fc.array(
      fc.record({
        category: fc.oneof(
          { weight: 3, arbitrary: fc.constantFrom(...DAILY_CATEGORIES) },
          { weight: 1, arbitrary: fc.constantFrom(...CONSUMPTION_CATEGORIES) },
        ),
        offset: fc.integer({ min: -3, max: 30 }),
        amount: fc.integer({ min: 0, max: 5000 }),
      }),
      { maxLength: 8 },
    ),
    spentToday: fc.array(fc.record({ category: fc.constantFrom(...CONSUMPTION_CATEGORIES), amount: fc.integer({ min: 1, max: 5000 }) }), {
      maxLength: 2,
    }),
  })
  .map((spec): ScenarioInput => {
    const asOfDate = shift(BASE, spec.asOfOffset)
    return {
      asOf: `${asOfDate}T15:00:00+08:00`,
      checkPeriodEnd: shift(asOfDate, spec.periodLength),
      consumptionRecords: spec.days.flatMap((draft, offset) => {
        if (draft === null) return []
        const date = shift(BASE, offset)
        return [day(date, draft.dayCoverage, itemsOf(date, draft.items))]
      }),
      reserves: spec.reserves.map(({ start, length }, index) => living(`R-LIV-${index + 1}`, shift(BASE, start), shift(BASE, start + length - 1))),
      events: [
        ...spec.arrangements.map(({ category, offset, amount }, index) => arrangement(`E-A${index + 1}`, shift(asOfDate, offset), category, amount)),
        ...spec.spentToday.map(({ category, amount }, index) => spent(`E-T${index + 1}`, `${asOfDate}T12:00:00+08:00`, category, amount)),
      ],
    }
  })

describe('性质（fast-check）', () => {
  test('历史记录不进入现金流：计入快照与否不改变情景；情景支出只来自 Δg，落在检查期间内，不复用记录编号', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = recentMonthScenario(input, DEMO_CFG_1)
        const flipped = {
          ...input,
          consumptionRecords: input.consumptionRecords.map((record) => editItems(record, (item) => ({ ...item, inSnapshot: !item.inSnapshot }))),
        }
        expect(recentMonthScenario(flipped, DEMO_CFG_1)).toEqual(result)
        const asOfDate = input.asOf.slice(0, 10)
        const end = input.checkPeriodEnd ?? ''
        const recordIds = new Set(input.consumptionRecords.flatMap((record) => record.items.map((item) => item.eventId)))
        for (const expense of result.expenses) {
          expect(expense.expectedAt >= asOfDate && expense.expectedAt <= end).toBe(true)
          expect(recordIds.has(expense.eventId)).toBe(false)
          expect(expense.amount).toBeGreaterThan(0)
        }
        const increments = sum(result.scenario.groups.map((item) => item.scenarioIncrement.value))
        const todaySameScope = sum(
          result.scenario.groups
            .filter((item) => CATEGORY_FLAGS[item.category]?.sameScopeAsDiscretionary === true)
            .flatMap((item) => item.dailyAmounts.filter(({ date }) => date === asOfDate).map(({ amount }) => amount.value)),
        )
        expect(sum(result.expenses.map((expense) => expense.amount))).toBe(increments - todaySameScope)
      }),
      FC_PARAMS,
    )
  })

  test('未来信息不影响过去：as_of 当日及以后的消费记录不改变结果', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const asOfDate = input.asOf.slice(0, 10)
        const past = { ...input, consumptionRecords: input.consumptionRecords.filter((record) => record.observedOn < asOfDate) }
        expect(recentMonthScenario(past, DEMO_CFG_1)).toEqual(recentMonthScenario(input, DEMO_CFG_1))
      }),
      FC_PARAMS,
    )
  })

  test('缺记录不当 0：在没有记录的日子插入 MISSING 日（带任意记录），结果不变', () => {
    const missingArb = fc.array(fc.record({ offset: fc.integer({ min: 0, max: SPAN - 1 }), items: fc.array(itemArb, { maxLength: 3 }) }), {
      maxLength: 10,
    })
    fc.assert(
      fc.property(inputArb, missingArb, (input, missing) => {
        const taken = new Set(input.consumptionRecords.map((record) => record.observedOn))
        const extra: ConsumptionDayInput[] = []
        for (const { offset, items } of missing) {
          const date = shift(BASE, offset)
          if (taken.has(date)) continue
          taken.add(date)
          extra.push(day(date, 'MISSING', itemsOf(date, items)))
        }
        const withMissing = { ...input, consumptionRecords: [...input.consumptionRecords, ...extra] }
        expect(recentMonthScenario(withMissing, DEMO_CFG_1)).toEqual(recentMonthScenario(input, DEMO_CFG_1))
      }),
      FC_PARAMS,
    )
  })

  test('情景与已确认安排去重：每组 Eg+Δg=max(Pg,Eg)，逐日分摊合计为 Δg；多列一笔安排 e，Eg 加 e、Δg 减 min(e, Δg)', () => {
    let checked = 0
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 1, max: 5000 }), fc.nat(), (input, extra, pick) => {
        const { groups } = recentMonthScenario(input, DEMO_CFG_1).scenario
        for (const item of groups) {
          const scenarioTotal = item.scenarioGroupTotal.value
          const scheduledTotal = item.scheduledGroupTotal.value
          expect(scheduledTotal + item.scenarioIncrement.value).toBe(Math.max(scenarioTotal, scheduledTotal))
          const amounts = item.dailyAmounts.map(({ amount }) => amount.value)
          expect(sum(amounts)).toBe(item.scenarioIncrement.value)
          expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
          expect(amounts).toEqual([...amounts].sort((left, right) => right - left))
        }
        if (groups.length === 0) return
        checked += 1
        const target = groups[pick % groups.length]
        const date = target.dailyAmounts[pick % target.dailyAmounts.length].date
        const more = { ...input, events: [...input.events, arrangement('E-EXTRA', date, target.category, extra)] }
        const after = recentMonthScenario(more, DEMO_CFG_1).scenario.groups.filter(
          (item) => item.category === target.category && item.coverageStart === target.coverageStart && item.coverageEnd === target.coverageEnd,
        )
        expect(after).toHaveLength(1)
        expect(after[0].scenarioGroupTotal.value).toBe(target.scenarioGroupTotal.value)
        expect(after[0].scheduledGroupTotal.value).toBe(target.scheduledGroupTotal.value + extra)
        expect(after[0].scenarioIncrement.value).toBe(Math.max(0, target.scenarioIncrement.value - extra))
      }),
      FC_PARAMS,
    )
    expect(checked, '生成的输入大多得不出可用情景，性质没有被检验').toBeGreaterThan(FC_PARAMS.numRuns / 4)
  })
})
