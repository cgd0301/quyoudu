import { LABEL_TEXT } from './result.ts'

export type EngineConfig = {
  /** 缺少配置版本时按 R020 第4条、§7.3 处理 */
  configVersion: string | null
  /** D01 */
  topK: number
  topKLabel: string
  /** §7.1 */
  scenario: {
    windowDays: number
  }
  /** §7.2、D25、D50 */
  forecast: {
    minSamples: number
    minBacktestErrors: number
    alphaGrid: readonly string[]
    betaGrid: readonly string[]
    phiGrid: readonly string[]
    decimalPlaces: number
    precision: number
    rounding: 'ROUND_HALF_UP'
  }
}

/** DEMO-CFG-1，仅用于比赛演示，非最终批准默认（rules.md §8） */
export const DEMO_CFG_1: EngineConfig = {
  configVersion: 'DEMO-CFG-1',
  topK: 3,
  topKLabel: LABEL_TEXT.TOP_K_DEMO,
  scenario: {
    windowDays: 30,
  },
  forecast: {
    minSamples: 14,
    minBacktestErrors: 5,
    alphaGrid: ['0.2', '0.4', '0.6', '0.8'],
    betaGrid: ['0.2', '0.4', '0.6', '0.8'],
    phiGrid: ['0.80', '0.90', '0.95', '0.98'],
    decimalPlaces: 12,
    precision: 34,
    rounding: 'ROUND_HALF_UP',
  },
}
