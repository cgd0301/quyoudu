import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1, type EngineConfig } from '../../src/engine/config.ts'
import {
  Dec,
  extractSamples,
  fitHolt,
  fmt12,
  forecast,
  forecastSeries,
  originFits,
  q12,
  rollingBacktest,
  selectParams,
  toCents,
  type HoltForecast,
  type PriceObservation,
} from '../../src/engine/holt/index.ts'
import { resultCoreSchema } from '../../src/engine/result.ts'

const AS_OF = '2026-10-01T09:00:00+08:00'
const SERIES_ID = 'S-LODGING'
const MIN_SAMPLES = DEMO_CFG_1.forecast.minSamples
const GRID = {
  alpha: DEMO_CFG_1.forecast.alphaGrid,
  beta: DEMO_CFG_1.forecast.betaGrid,
  phi: DEMO_CFG_1.forecast.phiGrid,
}

function days(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

function dateOf(month: number, day: number): string {
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function observation(day: number, price: number, extra: Partial<PriceObservation> = {}): PriceObservation {
  const date = dateOf(9, day)
  return {
    seriesId: SERIES_ID,
    costItemId: 'LODGING',
    channel: '渠道乙',
    spec: '大床房',
    serviceDate: '2026-10-27',
    observedOn: date,
    price,
    currency: 'CNY',
    recordedAt: `${date}T20:00:00+08:00`,
    availableAt: `${date}T20:00:00+08:00`,
    ...extra,
  }
}

/** 9/1—9/30 逐日一笔，跳过 missing 中的日子 */
function september(price: (day: number) => number, missing: readonly number[] = []): PriceObservation[] {
  return days(1, 30)
    .filter((day) => !missing.includes(day))
    .map((day) => observation(day, price(day)))
}

function run(observations: readonly PriceObservation[], octoberDays: readonly number[], config: EngineConfig = DEMO_CFG_1): HoltForecast[] {
  return forecastSeries(
    {
      seriesId: SERIES_ID,
      observations,
      asOf: AS_OF,
      targets: octoberDays.map((day) => ({ costItemId: 'LODGING', purchaseDate: dateOf(10, day) })),
    },
    config,
  )
}

function lazy<T>(make: () => T): () => T {
  let value: T | undefined
  return () => {
    value ??= make()
    return value
  }
}

const constant = lazy(() => run(september(() => 58000), days(1, 13)))
const mixedTiers = september(() => 58000).map((item, index) => (index % 2 === 0 ? item : { ...item, spec: '看台' }))
// 9/30 为 3000 分，按日下降 1900 分
const declining = september((day) => 60000 - 1900 * day)

describe('D25、D50 数值规则', () => {
  test('D50 运算为 34 位有效数字、ROUND_HALF_UP', () => {
    expect(Dec.precision).toBe(34)
    expect(Dec.rounding).toBe(Dec.ROUND_HALF_UP)
  })

  test('T020-11 gap q12 保留 12 位小数（0.5 远离零），toCents 转为整数分', () => {
    expect(q12('0.1234567890125').toFixed()).toBe('0.123456789013')
    expect(q12('-0.1234567890125').toFixed()).toBe('-0.123456789013')
    expect(toCents(new Dec('12874.72'))).toBe(12875)
  })

  test('T007-05 gap 12 位预测中间值按 D25 转为整数分', () => {
    expect(fmt12(q12('4999.500000000000'))).toBe('4999.500000000000')
    expect(toCents(q12('4999.500000000000'))).toBe(5000)
    expect(fmt12(q12('4999.499999999999'))).toBe('4999.499999999999')
    expect(toCents(q12('4999.499999999999'))).toBe(4999)
  })
})

describe('§6 公式与 §7.2 网格选参', () => {
  test('T020-01 gap 固定参数三笔样本逐项复算', () => {
    const fit = fitHolt([10000, 11000, 11500], '0.2', '0.2', '0.80')
    expect(fmt12(fit.initLevel)).toBe('11000.000000000000')
    expect(fmt12(fit.initTrend)).toBe('1000.000000000000')
    expect(fit.steps).toHaveLength(1)
    const [third] = fit.steps
    expect(fmt12(third.oneStep)).toBe('11800.000000000000')
    expect(fmt12(third.error)).toBe('-300.000000000000')
    expect(fmt12(third.level)).toBe('11740.000000000000')
    expect(fmt12(third.trend)).toBe('788.000000000000')
    const { powerSum, predicted } = forecast(fit, 2)
    expect(fmt12(powerSum)).toBe('1.440000000000')
    expect(fmt12(predicted)).toBe('12874.720000000000')
    expect(toCents(predicted)).toBe(12875)
    expect(fitHolt([10000, 11000, 11500], '0.2', '0.2', '0.80')).toEqual(fit)
  })

  test('T020-02 gap 常量序列 64 组参数的训练 SSE 都为 0', () => {
    const { best, grid } = selectParams(Array<number>(30).fill(58000), GRID)
    expect(grid.map((entry) => fmt12(entry.sse))).toEqual(Array<string>(64).fill('0.000000000000'))
    expect([best.alpha, best.beta, best.phi]).toEqual(['0.2', '0.2', '0.80'])
  })

  test('同值按 α、β、φ 升序取第一组，与网格书写顺序无关', () => {
    const samples = Array<number>(30).fill(58000)
    const reversed = { alpha: [...GRID.alpha].reverse(), beta: [...GRID.beta].reverse(), phi: [...GRID.phi].reverse() }
    const order = (grid: ReturnType<typeof selectParams>['grid']) => grid.map((entry) => `${entry.alpha}/${entry.beta}/${entry.phi}`)
    const fromReversed = selectParams(samples, reversed)
    expect([fromReversed.best.alpha, fromReversed.best.beta, fromReversed.best.phi]).toEqual(['0.2', '0.2', '0.80'])
    expect(order(fromReversed.grid)).toEqual(order(selectParams(samples, GRID).grid))
  })
})

describe('滚动回测与简单基线', () => {
  test('T020-02 常量序列各步长预测 58000 分，回测 MAE 与基线 MAE 都为 0', () => {
    const entries = constant().slice(0, 12)
    expect(entries.map((entry) => entry.purchaseDate)).toEqual(days(1, 12).map((day) => dateOf(10, day)))
    for (const entry of entries) {
      expect(entry).toMatchObject({
        status: 'AVAILABLE',
        alpha: '0.2',
        beta: '0.2',
        phi: '0.80',
        trainSse: '0.000000000000',
        predicted: '58000.000000000000',
        backtestMae: '0.000000000000',
        baselineMae: '0.000000000000',
      })
      expect(entry.amount?.value).toBe(58000)
    }
  })

  test('T020-05 各步长有效回测误差数为 30−h−13，h=12 可用、h=13 回测不足', () => {
    const entries = constant()
    expect(entries.map((entry) => entry.horizon)).toEqual(days(1, 13))
    expect(entries.map((entry) => entry.backtestCount)).toEqual(days(1, 13).map((h) => 30 - h - 13))
    expect(entries[0]).toMatchObject({ horizon: 1, backtestCount: 16, status: 'AVAILABLE' })
    expect(entries[11]).toMatchObject({ horizon: 12, backtestCount: 5, status: 'AVAILABLE' })
    expect(entries[12]).toMatchObject({
      horizon: 13,
      backtestCount: 4,
      status: 'BACKTEST_INSUFFICIENT',
      predicted: '58000.000000000000',
    })
    expect(entries[12]?.amount?.value).toBe(58000)
  })

  test(
    'T020-03 gap 第21—30个样本各加5000分后，起点20、h=3的预测逐位不变',
    () => {
      const price = (day: number) => 50000 + 200 * day + 300 * (day % 4)
      const prices = extractSamples(september(price), SERIES_ID, AS_OF).samples.map((sample) => sample.price)
      const raised = extractSamples(
        september((day) => price(day) + (day >= 21 ? 5000 : 0)),
        SERIES_ID,
        AS_OF,
      ).samples.map((sample) => sample.price)
      expect(raised.slice(0, 20)).toEqual(prices.slice(0, 20))
      expect(raised.slice(20)).toEqual(prices.slice(20).map((value) => value + 5000))

      const atOrigin20 = (series: readonly number[]) =>
        rollingBacktest(series, 3, originFits(series, GRID, MIN_SAMPLES)).points.find((point) => point.t === 20)
      const before = atOrigin20(prices)
      const after = atOrigin20(raised)
      expect(before).toBeDefined()
      expect(after?.predicted.toFixed()).toBe(before?.predicted.toFixed())

      const firstTwenty = selectParams(prices.slice(0, 20), GRID).best
      expect(originFits(prices, GRID, MIN_SAMPLES).find((item) => item.t === 20)?.fit).toEqual(firstTwenty)
      expect(before?.predicted.toFixed()).toBe(forecast(firstTwenty, 3, true).predicted.toFixed())
    },
    30_000,
  )

  test('T020-10② 缺9/11：最近连续段9/12—9/30共19个，h=1有5个回测误差可用，h=2为4个回测不足', () => {
    const observations = september(() => 58000, [11])
    expect(extractSamples(observations, SERIES_ID, AS_OF).samples[0]?.observedOn).toBe('2026-09-12')
    const [first, second] = run(observations, [1, 2])
    expect(first).toMatchObject({ sampleCount: 19, historyEnd: '2026-09-30', horizon: 1, backtestCount: 5, status: 'AVAILABLE' })
    expect(second).toMatchObject({ sampleCount: 19, horizon: 2, backtestCount: 4, status: 'BACKTEST_INSUFFICIENT' })
  })
})

describe('样本提取（D24、D66、R020 第3条）', () => {
  test('T020-10① 缺9/20：最近连续段9/21—9/30共10个，少于14，历史不足', () => {
    const observations = september(() => 58000, [20])
    expect(extractSamples(observations, SERIES_ID, AS_OF).samples[0]?.observedOn).toBe('2026-09-21')
    const [entry] = run(observations, [1])
    expect(entry).toMatchObject({
      status: 'HISTORY_INSUFFICIENT',
      sampleCount: 10,
      historyEnd: '2026-09-30',
      alpha: null,
      predicted: null,
      amount: null,
    })
  })

  test('D66 同日多条只取一条：available_at 最晚，相同取 recorded_at 最晚，仍相同取位置靠后', () => {
    const observations = [
      observation(1, 200, { availableAt: '2026-09-01T21:00:00+08:00' }),
      observation(1, 100),
      observation(2, 300, { recordedAt: '2026-09-02T19:00:00+08:00' }),
      observation(2, 400, { recordedAt: '2026-09-02T18:00:00+08:00' }),
      observation(3, 500),
      observation(3, 600),
      observation(3, 700, { availableAt: '2026-10-01T10:00:00+08:00' }),
    ]
    expect(extractSamples(observations, SERIES_ID, AS_OF).samples.map((sample) => sample.price)).toEqual([200, 300, 600])
  })

  test('available_at 不晚于起点的观测可用，晚于起点的不用', () => {
    const lastAt = (availableAt: string) => [
      ...days(17, 29).map((day) => observation(day, 58000)),
      observation(30, 58000, { availableAt }),
    ]
    expect(extractSamples(lastAt(AS_OF), SERIES_ID, AS_OF)).toMatchObject({ historyEnd: '2026-09-30' })
    expect(extractSamples(lastAt(AS_OF), SERIES_ID, AS_OF).samples).toHaveLength(14)
    const late = extractSamples(lastAt('2026-10-01T09:00:01+08:00'), SERIES_ID, AS_OF)
    expect(late).toMatchObject({ historyEnd: '2026-09-29' })
    expect(late.samples).toHaveLength(13)
  })

  test('T008-05 没有可用历史时样本数为0，历史不足', () => {
    const [entry] = run([], [1])
    expect(entry).toMatchObject({ status: 'HISTORY_INSUFFICIENT', sampleCount: 0, historyEnd: null, amount: null })
  })
})

describe('状态判定', () => {
  test('T020-07① 序列混合两个票档：不可比，不拟合', () => {
    const [entry] = run(mixedTiers, [12])
    expect(entry).toMatchObject({
      status: 'NOT_COMPARABLE',
      alpha: null,
      beta: null,
      phi: null,
      trainSse: null,
      predicted: null,
      amount: null,
    })
  })

  test('T020-07② 某步预测值为负：结果无效，停止使用该预测成本', () => {
    const prices = extractSamples(declining, SERIES_ID, AS_OF).samples.map((sample) => sample.price)
    expect(forecast(selectParams(prices, GRID).best, 12).predicted.isNegative()).toBe(true)
    const projected = forecast(selectParams(prices, GRID).best, 12)
    const [entry] = run(declining, [12])
    expect(entry).toMatchObject({ horizon: 12, status: 'INVALID_RESULT', predicted: fmt12(projected.predicted), amount: null })
  })

  test('T020-07③ 预测结果未引用配置版本：预测配置未冻结，不给出预测成本', () => {
    const [entry] = run(september(() => 58000), [1], { ...DEMO_CFG_1, configVersion: null })
    expect(entry).toMatchObject({ status: 'CONFIG_NOT_FROZEN', configVersion: null, amount: null })
  })

  test('各状态的条目补上 confirmed 后都符合 ResultCore forecasts 结构，金额为整数分', () => {
    const forecastSchema = resultCoreSchema.shape.forecasts.unwrap().element
    const entries = [
      ...constant(),
      ...run(september(() => 58000, [20]), [1]),
      ...run([], [1]),
      ...run(mixedTiers, [1]),
      ...run(declining, [12]),
      ...run(september(() => 58000), [1], { ...DEMO_CFG_1, configVersion: null }),
    ]
    expect(new Set(entries.map((entry) => entry.status))).toEqual(
      new Set(['AVAILABLE', 'BACKTEST_INSUFFICIENT', 'HISTORY_INSUFFICIENT', 'NOT_COMPARABLE', 'INVALID_RESULT', 'CONFIG_NOT_FROZEN']),
    )
    for (const entry of entries) {
      expect(forecastSchema.safeParse({ ...entry, confirmed: false }).error).toBeUndefined()
      expect(Object.values(entry)).not.toContain(undefined)
      expect(entry.amount === null || Number.isSafeInteger(entry.amount.value)).toBe(true)
      expect(entry.amount === null).toBe(entry.status !== 'AVAILABLE' && entry.status !== 'BACKTEST_INSUFFICIENT')
    }
    expect(constant()[0]?.configVersion).toBe('DEMO-CFG-1')
    expect(constant()[0]?.amount?.basis.rules).toContain('R020')
  })
})

describe('性质', () => {
  test('常量序列预测出同一常量', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: MIN_SAMPLES, max: 20 }),
        fc.integer({ min: 1, max: 30 }),
        (price, length, h) => {
          const { predicted } = forecast(selectParams(Array<number>(length).fill(price), GRID).best, h)
          return fmt12(predicted) === `${price}.000000000000` && toCents(predicted) === price
        },
      ),
      { seed: 20020, numRuns: 30 },
    )
  })

  test(
    '改动回测起点之后的数据，不影响该起点的预测',
    () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: MIN_SAMPLES + 1, maxLength: MIN_SAMPLES + 4 }),
          fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: MIN_SAMPLES + 4, maxLength: MIN_SAMPLES + 4 }),
          fc.integer({ min: 1, max: 4 }),
          fc.nat(),
          (series, replacement, wanted, pick) => {
            const h = Math.min(wanted, series.length - MIN_SAMPLES)
            const t = MIN_SAMPLES + (pick % (series.length - h - MIN_SAMPLES + 1))
            const changed = series.map((value, index) => (index < t ? value : replacement[index]))
            const at = (prices: readonly number[]) =>
              rollingBacktest(prices, h, originFits(prices, GRID, MIN_SAMPLES)).points.find((point) => point.t === t)
            const before = at(series)
            const after = at(changed)
            return before !== undefined && after !== undefined && before.predicted.toFixed() === after.predicted.toFixed()
          },
        ),
        { seed: 20030, numRuns: 20 },
      )
    },
    60_000,
  )
})
