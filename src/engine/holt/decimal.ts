import Decimal from 'decimal.js'
import { roundHalfUp, roundToCents } from '../money/round.ts'

// D25、D50：34 位有效数字、ROUND_HALF_UP；clone 出独立的构造器，不改全局 Decimal
export const Dec = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP })

const PLACES = 12

/** 模型中间量按其公式算出后保留 12 位小数（D25） */
export function q12(value: Decimal.Value): Decimal {
  return (value instanceof Dec ? value : new Dec(value)).toDecimalPlaces(PLACES, Dec.ROUND_HALF_UP)
}

/** ResultCore 中保留 12 位小数的十进制串 */
export function fmt12(value: Decimal): string {
  return roundHalfUp(value.toFixed(), PLACES)
}

/** 预测进入金额计算前按同一舍入转为整数分（R007、D25）；不是安全整数时抛错 */
export function toCents(value: Decimal): number {
  return roundToCents(value.toFixed())
}
