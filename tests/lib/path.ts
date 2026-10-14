/**
 * 测试向量的断言路径（SPEC-GAP SG-38）：点号键名、[数字] 下标、[字段=值] 选择器。
 * 选择器字段可写点号子路径；字段值是数组时按“包含”匹配；比较前把数字、布尔和 null 转成字符串；
 * 连写的选择器 [a=x][b=y] 合并为同时满足。选择器必须恰好命中一个元素：0 个视为不存在，多于 1 个报错。
 * 选择值不能含方括号。
 */

export type SelectCondition = {
  field: string[]
  value: string
}

export type PathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'select'; conditions: SelectCondition[] }

export type Resolved = { found: true; value: unknown } | { found: false }

export class PathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathError'
  }
}

const MISSING: Resolved = { found: false }
const INDEX = /^(0|[1-9][0-9]*)$/

function readKey(path: string, start: number): { key: string; end: number } {
  let end = start
  while (end < path.length && path[end] !== '.' && path[end] !== '[') end += 1
  const key = path.slice(start, end)
  if (key === '') throw new PathError(`路径 ${path} 第 ${start + 1} 个字符处缺少键名`)
  if (key.includes(']')) throw new PathError(`路径 ${path} 的键名 ${key} 含右方括号`)
  return { key, end }
}

function parseBracket(path: string, content: string): PathSegment {
  if (content === '') throw new PathError(`路径 ${path} 有空方括号`)
  if (content.includes('[')) throw new PathError(`路径 ${path} 的方括号里不能再有方括号`)
  if (INDEX.test(content)) return { kind: 'index', index: Number(content) }
  const equals = content.indexOf('=')
  if (equals < 0) throw new PathError(`路径 ${path} 的 [${content}] 既不是下标也不是 [字段=值]`)
  const field = content.slice(0, equals).split('.')
  const value = content.slice(equals + 1)
  if (field.some((part) => part === '')) throw new PathError(`路径 ${path} 的选择器 [${content}] 字段不完整`)
  if (value === '') throw new PathError(`路径 ${path} 的选择器 [${content}] 缺少值`)
  return { kind: 'select', conditions: [{ field, value }] }
}

export function parsePath(path: string): PathSegment[] {
  if (path === '') throw new PathError('路径为空')
  const segments: PathSegment[] = []
  let i = 0
  if (path[0] !== '[') {
    const { key, end } = readKey(path, 0)
    segments.push({ kind: 'key', key })
    i = end
  }
  while (i < path.length) {
    if (path[i] === '.') {
      const { key, end } = readKey(path, i + 1)
      segments.push({ kind: 'key', key })
      i = end
      continue
    }
    const close = path.indexOf(']', i)
    if (close < 0) throw new PathError(`路径 ${path} 的方括号未闭合`)
    const segment = parseBracket(path, path.slice(i + 1, close))
    const previous = segments.at(-1)
    if (segment.kind === 'select' && previous?.kind === 'select') previous.conditions.push(...segment.conditions)
    else segments.push(segment)
    i = close + 1
    if (i < path.length && path[i] !== '.' && path[i] !== '[') {
      throw new PathError(`路径 ${path} 的方括号后须接点号、方括号或结束`)
    }
  }
  return segments
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function scalarMatches(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual === expected
  if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected
  return actual === null && expected === 'null'
}

function conditionMatches(element: unknown, condition: SelectCondition): boolean {
  let current: unknown = element
  for (const key of condition.field) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return false
    current = current[key]
  }
  if (Array.isArray(current)) return current.some((item) => scalarMatches(item, condition.value))
  return scalarMatches(current, condition.value)
}

function describeSelect(conditions: readonly SelectCondition[]): string {
  return conditions.map((condition) => `[${condition.field.join('.')}=${condition.value}]`).join('')
}

/** 按路径取值；选择器命中多个元素或语法错误时抛 PathError */
export function resolvePath(root: unknown, path: string | readonly PathSegment[]): Resolved {
  const segments = typeof path === 'string' ? parsePath(path) : path
  let current: unknown = root
  for (const segment of segments) {
    if (segment.kind === 'key') {
      if (!isRecord(current) || !Object.hasOwn(current, segment.key)) return MISSING
      current = current[segment.key]
    } else if (segment.kind === 'index') {
      if (!Array.isArray(current) || segment.index >= current.length) return MISSING
      current = current[segment.index]
    } else {
      if (!Array.isArray(current)) return MISSING
      const hits = current.filter((element) => segment.conditions.every((condition) => conditionMatches(element, condition)))
      if (hits.length === 0) return MISSING
      if (hits.length > 1) {
        throw new PathError(`选择器 ${describeSelect(segment.conditions)} 命中 ${hits.length} 个元素，须恰好命中一个`)
      }
      current = hits[0]
    }
  }
  return { found: true, value: current }
}
