import Decimal from 'decimal.js'

// D25、D50：34 位有效数字，ROUND_HALF_UP，0.5 远离零
const decimal = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP })

/** 按 D25 保留指定位小数，返回固定小数位的十进制字符串 */
export function roundHalfUp(value: string, places: number): string {
  return new decimal(value).toDecimalPlaces(places, decimal.ROUND_HALF_UP).toFixed(places)
}

/** 预测进入金额计算前，按同一舍入转为整数分（R007、D25） */
export function roundToCents(value: string): number {
  const rounded = new decimal(value).toDecimalPlaces(0, decimal.ROUND_HALF_UP)
  const cents = rounded.toNumber()
  if (!Number.isSafeInteger(cents)) throw new Error('舍入后的金额不是安全整数')
  return cents
}
