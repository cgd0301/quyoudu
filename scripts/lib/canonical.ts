import { toWire } from '../../src/engine/wire.ts'

/** 对象键递归排序；数组顺序不变 */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key])
    return out
  }
  return value
}

/** toWire 之后按键排序，2 空格缩进，LF，末尾换行 */
export function canonicalWire(value: unknown): string {
  return `${JSON.stringify(sortKeys(toWire(value)), null, 2)}\n`
}
