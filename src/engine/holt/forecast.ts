import type { EngineConfig } from '../config.ts'
import type { ForecastStatus } from '../enums.ts'
import { makeMoney } from '../money.ts'
import type { ResultCore } from '../result.ts'
import { originFits, rollingBacktest, type Backtest, type OriginFit } from './backtest.ts'
import { Dec, fmt12, toCents } from './decimal.ts'
import { forecast, selectParams } from './holt.ts'
import { extractSamples, type PriceObservation } from './samples.ts'
import { dayNumber } from './time.ts'

type ForecastEntry = NonNullable<ResultCore['forecasts']>[number]

/** ResultCore forecasts[] 的一条，不含 confirmed（D14 由接入时按 forecast_confirmations 填写） */
export type HoltForecast = Omit<ForecastEntry, 'confirmed'>

export type ForecastTarget = {
  costItemId: string
  purchaseDate: string
}

export type SeriesInput = {
  seriesId: string
  /** 按 price_series 原顺序 */
  observations: readonly PriceObservation[]
  /** 预测起点 */
  asOf: string
  targets: readonly ForecastTarget[]
}

const AMOUNT_RULES = ['R020', 'D25']
// 四舍五入后不足 1 分即为零值或负值
const MIN_PREDICTED = new Dec('0.5')

/** 一条序列对各购买日的预测（R020、§6、§7.2）；每个目标一条，顺序与 targets 相同 */
export function forecastSeries(input: SeriesInput, config: EngineConfig): HoltForecast[] {
  const settings = config.forecast
  const extracted = extractSamples(input.observations, input.seriesId, input.asOf)
  const prices = extracted.samples.map((sample) => sample.price)
  const endDay = extracted.historyEnd === null ? null : dayNumber(extracted.historyEnd)

  const blank = (target: ForecastTarget, status: ForecastStatus): HoltForecast => {
    const purchaseDay = dayNumber(target.purchaseDate)
    return {
      seriesId: input.seriesId,
      costItemId: target.costItemId,
      purchaseDate: target.purchaseDate,
      // SPEC-GAP SG-49：没有样本时步长取 0
      horizon: endDay === null || purchaseDay === null ? 0 : purchaseDay - endDay,
      status,
      configVersion: config.configVersion,
      sampleCount: prices.length,
      historyEnd: extracted.historyEnd,
      alpha: null,
      beta: null,
      phi: null,
      level: null,
      trend: null,
      trainSse: null,
      predicted: null,
      amount: null,
      backtestMae: null,
      baselineMae: null,
      backtestCount: 0,
    }
  }

  // SPEC-GAP SG-49：判定顺序为配置、可比性、历史样本、步长、预测值、回测误差数
  if (config.configVersion === null) return input.targets.map((target) => blank(target, 'CONFIG_NOT_FROZEN'))
  if (!extracted.comparable) return input.targets.map((target) => blank(target, 'NOT_COMPARABLE'))
  if (prices.length < settings.minSamples) return input.targets.map((target) => blank(target, 'HISTORY_INSUFFICIENT'))

  const grid = { alpha: settings.alphaGrid, beta: settings.betaGrid, phi: settings.phiGrid }
  const fit = selectParams(prices, grid).best
  let fits: OriginFit[] | null = null
  const backtest = (h: number): Backtest => {
    fits ??= originFits(prices, grid, settings.minSamples)
    return rollingBacktest(prices, h, fits)
  }

  return input.targets.map((target): HoltForecast => {
    const fitted: HoltForecast = {
      ...blank(target, 'AVAILABLE'),
      alpha: fit.alpha,
      beta: fit.beta,
      phi: fit.phi,
      level: fmt12(fit.level),
      trend: fmt12(fit.trend),
      trainSse: fmt12(fit.sse),
    }
    const h = fitted.horizon
    // SPEC-GAP SG-49：购买日不晚于历史末日时结果无效
    if (h < 1) return { ...fitted, status: 'INVALID_RESULT' }

    const tested = backtest(h)
    const assessed: HoltForecast = {
      ...fitted,
      backtestMae: tested.mae === null ? null : fmt12(tested.mae),
      baselineMae: tested.baselineMae === null ? null : fmt12(tested.baselineMae),
      backtestCount: tested.count,
    }
    const { predicted } = forecast(fit, h)
    // R020 第11条、§7.2：负值和零值停止该预测成本的使用；SPEC-GAP SG-50：此时不给出预测值
    if (predicted.lt(MIN_PREDICTED) || predicted.gte(Number.MAX_SAFE_INTEGER)) return { ...assessed, status: 'INVALID_RESULT' }
    // §7.2：有效回测误差不足时该步长回测不足；SPEC-GAP SG-50：此时不给出预测值
    if (tested.count < settings.minBacktestErrors) return { ...assessed, status: 'BACKTEST_INSUFFICIENT' }
    return { ...assessed, predicted: fmt12(predicted), amount: makeMoney(toCents(predicted), AMOUNT_RULES) }
  })
}
