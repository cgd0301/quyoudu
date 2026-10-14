/** camelCase 键名转 snake_case：只在大写字母前加下划线 */
export function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/** 递归把对象键名转为 snake_case，值和顺序不变；用于对拍和导出 */
export function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[toSnakeKey(key)] = toWire(inner)
    return out
  }
  return value
}
