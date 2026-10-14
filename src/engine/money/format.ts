// SPEC-GAP SG-44：显示字符串未写，临时为不带千分位和货币符号的两位小数

/** 整数分显示为元，只用整数除法 */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('金额须为安全整数分')
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const yuan = Math.trunc(abs / 100)
  const fen = abs % 100
  return `${sign}${yuan}.${String(fen).padStart(2, '0')}`
}
