import type Decimal from 'decimal.js'
import { Dec, q12 } from './decimal.ts'

export type HoltStep = {
  /** 一步预测值 l(i-1)+φ×b(i-1) */
  oneStep: Decimal
  /** 一步训练误差：观测值−一步预测值 */
  error: Decimal
  sqError: Decimal
  level: Decimal
  trend: Decimal
}

export type HoltFit = {
  alpha: string
  beta: string
  phi: string
  /** l2 = y2（§7.2） */
  initLevel: Decimal
  /** b2 = y2 − y1（§7.2） */
  initTrend: Decimal
  /** 第 3 笔起逐笔递推 */
  steps: HoltStep[]
  level: Decimal
  trend: Decimal
  /** 一步训练误差平方和 */
  sse: Decimal
}

export type ParamGrid = {
  alpha: readonly string[]
  beta: readonly string[]
  phi: readonly string[]
}

export type GridEntry = {
  alpha: string
  beta: string
  phi: string
  sse: Decimal
}

export type Selection = {
  best: HoltFit
  /** 全部参数组，按 α、β、φ 升序 */
  grid: GridEntry[]
}

export type Projection = {
  /** φ + φ² + … + φ^h */
  powerSum: Decimal
  predicted: Decimal
}

/** §6 阻尼趋势递推；样本为整数分，参数取配置原文 */
export function fitHolt(samples: readonly number[], alpha: string, beta: string, phi: string): HoltFit {
  if (samples.length < 2) throw new RangeError('Holt 初始化需要至少两笔样本')
  const y = samples.map((value) => new Dec(value))
  const a = new Dec(alpha)
  const b = new Dec(beta)
  const p = new Dec(phi)
  const keepLevel = new Dec(1).minus(a)
  const keepTrend = new Dec(1).minus(b).times(p)

  const initLevel = q12(y[1])
  const initTrend = q12(y[1].minus(y[0]))
  let level = initLevel
  let trend = initTrend
  let sse = q12(0)
  const steps: HoltStep[] = []
  for (const actual of y.slice(2)) {
    // SPEC-GAP SG-47：式内的 l(i-1)+φ×b(i-1) 不先舍入，一步预测值单独保留 12 位
    const projected = level.plus(p.times(trend))
    const oneStep = q12(projected)
    const error = actual.minus(oneStep)
    const sqError = q12(error.times(error))
    sse = q12(sse.plus(sqError))
    const nextLevel = q12(a.times(actual).plus(keepLevel.times(projected)))
    const nextTrend = q12(b.times(nextLevel.minus(level)).plus(keepTrend.times(trend)))
    steps.push({ oneStep, error, sqError, level: nextLevel, trend: nextTrend })
    level = nextLevel
    trend = nextTrend
  }
  return { alpha, beta, phi, initLevel, initTrend, steps, level, trend, sse }
}

function ascending(values: readonly string[]): string[] {
  return [...values].sort((x, y) => new Dec(x).comparedTo(y))
}

/** §7.2：网格内一步训练 SSE（保留 12 位后）最低者；同值按 α、β、φ 升序取第一组（D25、D50） */
export function selectParams(samples: readonly number[], grid: ParamGrid): Selection {
  let best: HoltFit | null = null
  const entries: GridEntry[] = []
  for (const alpha of ascending(grid.alpha)) {
    for (const beta of ascending(grid.beta)) {
      for (const phi of ascending(grid.phi)) {
        const fit = fitHolt(samples, alpha, beta, phi)
        entries.push({ alpha, beta, phi, sse: fit.sse })
        if (best === null || fit.sse.lt(best.sse)) best = fit
      }
    }
  }
  if (best === null) throw new RangeError('参数网格为空')
  return { best, grid: entries }
}

/**
 * §6：预测(n+h | n) = ln + bn × (φ + φ² + … + φ^h)。
 * 前向预测式内用未舍入的幂和（SG-47）。回测传 useRoundedPowerSum，先把幂和保留 12 位再代入（D25）。
 */
export function forecast(fit: HoltFit, h: number, useRoundedPowerSum = false): Projection {
  if (!Number.isSafeInteger(h) || h < 1) throw new RangeError('步长 h 须为正整数')
  const p = new Dec(fit.phi)
  let power = new Dec(1)
  let sum = new Dec(0)
  for (let k = 1; k <= h; k += 1) {
    power = power.times(p)
    sum = sum.plus(power)
  }
  const powerSum = q12(sum)
  const factor = useRoundedPowerSum ? powerSum : sum
  return { powerSum, predicted: q12(fit.level.plus(fit.trend.times(factor))) }
}
