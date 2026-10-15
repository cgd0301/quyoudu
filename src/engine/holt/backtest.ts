import type Decimal from 'decimal.js'
import { Dec, q12 } from './decimal.ts'
import { forecast, selectParams, type HoltFit, type ParamGrid } from './holt.ts'

export type OriginFit = {
  /** 预测起点：训练段为前 t 笔样本 */
  t: number
  fit: HoltFit
}

export type BacktestPoint = {
  t: number
  /** 保留 12 位的预测值 */
  predicted: Decimal
  /** 第 t+h 笔观测 */
  actual: number
  /** 观测值−预测值 */
  error: Decimal
  /** 简单基线（沿用起点最后一笔观测）的误差 */
  baselineError: number
}

export type Backtest = {
  h: number
  /** 有效回测误差数 */
  count: number
  /** MAE_h；没有有效误差时为 null */
  mae: Decimal | null
  baselineMae: Decimal | null
  points: BacktestPoint[]
}

/** 起点 t=minSamples…n−1 各自只用前 t 笔重新选参（R020 第6条、§7.2），供各步长共用 */
export function originFits(samples: readonly number[], grid: ParamGrid, minSamples: number): OriginFit[] {
  const fits: OriginFit[] = []
  for (let t = minSamples; t < samples.length; t += 1) {
    fits.push({ t, fit: selectParams(samples.slice(0, t), grid).best })
  }
  return fits
}

function meanAbs(values: readonly Decimal.Value[]): Decimal | null {
  if (values.length === 0) return null
  return q12(Dec.sum(...values.map((value) => new Dec(value).abs())).div(values.length))
}

/** 步长 h 的滚动回测与简单基线，二者使用相同起点、步长和有效样本（§6） */
export function rollingBacktest(samples: readonly number[], h: number, fits: readonly OriginFit[]): Backtest {
  const points: BacktestPoint[] = []
  for (const { t, fit } of fits) {
    if (t + h > samples.length) continue
    const actual = samples[t + h - 1]
    // D25：误差保留 12 位后再汇总成 MAE
    const { predicted } = forecast(fit, h)
    points.push({ t, predicted, actual, error: q12(new Dec(actual).minus(predicted)), baselineError: actual - samples[t - 1] })
  }
  return {
    h,
    count: points.length,
    mae: meanAbs(points.map((point) => point.error)),
    baselineMae: meanAbs(points.map((point) => point.baselineError)),
    points,
  }
}
