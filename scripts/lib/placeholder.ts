/**
 * 项目书正文的数据占位符。
 *
 * 写法：<!-- data: cases/c01_base.json#checkpoints.0.result.cost.total.value -->
 * 可选格式：在路径后加 “ | cents”（整数分转两位小数元）或 “ | json”（紧凑 JSON）。
 * 路径相对 book/data，段用点号分隔，数组下标写在方括号里也可直接写数字。
 * 解析失败必须报错，不允许把占位符原样留在成稿里。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { formatCents } from '../../src/engine/money/format.ts'
import { repoPath } from './repo.ts'

export type PlaceholderFormat = 'raw' | 'cents' | 'json'

export type Placeholder = {
  /** 完整的占位符原文，用于报错定位 */
  raw: string
  /** 相对 book/data 的文件与路径 */
  target: string
  segments: string[]
  format: PlaceholderFormat
}

const PLACEHOLDER = /<!--\s*data:\s*([^\s]+?\.json)#([^\s|]+?)(?:\s*\|\s*(cents|json))?\s*-->/g

export function parsePlaceholder(raw: string): Placeholder | null {
  const match = /^<!--\s*data:\s*([^\s]+?\.json)#([^\s|]+?)(?:\s*\|\s*(cents|json))?\s*-->$/.exec(raw.trim())
  if (match === null) return null
  const target = match[1] ?? ''
  const keyPath = match[2] ?? ''
  const format = (match[3] ?? 'raw') as PlaceholderFormat
  const segments = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.').filter((segment) => segment !== '')
  return { raw, target, segments, format }
}

/** 找出文本里的全部占位符；无法解析的写法按原文返回 null，由调用方报错 */
export function findPlaceholders(text: string): { raw: string; parsed: Placeholder | null }[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => ({ raw: match[0], parsed: parsePlaceholder(match[0]) }))
}

type Json = unknown

function walk(value: Json, segments: readonly string[]): { found: boolean; value?: Json } {
  let current: Json = value
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false }
      current = current[index]
      continue
    }
    if (current === null || typeof current !== 'object') return { found: false }
    const record = current as Record<string, Json>
    if (!(segment in record)) return { found: false }
    current = record[segment]
  }
  return { found: true, value: current }
}

export function renderPlaceholder(placeholder: Placeholder): string {
  const file = repoPath('book/data', placeholder.target)
  let data: Json
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    throw new Error(`${placeholder.raw}：读不到 book/data/${placeholder.target}（${reason}）`)
  }
  const found = walk(data, placeholder.segments)
  if (!found.found) throw new Error(`${placeholder.raw}：book/data/${placeholder.target} 中没有该路径`)
  const value = found.value
  if (placeholder.format === 'cents') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new Error(`${placeholder.raw}：cents 只能用于整数分，实际为 ${JSON.stringify(value)}`)
    }
    return formatCents(value)
  }
  if (placeholder.format === 'json') return JSON.stringify(value)
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** 把文本里的占位符全部替换为真实数据；任一占位符失败即抛错（不产出半份成稿） */
export function renderData(text: string): { text: string; count: number } {
  let count = 0
  const rendered = text.replace(PLACEHOLDER, (raw) => {
    const parsed = parsePlaceholder(raw)
    if (parsed === null) throw new Error(`占位符写法不合法：${raw}`)
    count += 1
    return renderPlaceholder(parsed)
  })
  return { text: rendered, count }
}

/** 只校验、不替换；返回每条占位符的错误信息 */
export function checkData(text: string): string[] {
  const errors: string[] = []
  for (const item of findPlaceholders(text)) {
    if (item.parsed === null) {
      errors.push(`占位符写法不合法：${item.raw}`)
      continue
    }
    try {
      renderPlaceholder(item.parsed)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return errors
}

export function dataFiles(): string[] {
  const dir = repoPath('book/data')
  const out: string[] = []
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      if (statSync(full).isDirectory()) visit(full)
      else if (name.endsWith('.json')) out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  visit(dir)
  return out.sort()
}
