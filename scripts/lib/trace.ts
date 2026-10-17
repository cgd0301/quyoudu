/**
 * docs/traceability.csv 的读取与“只改状态列”的写回。
 *
 * 追溯表是交付物，改写时必须保持原有行序、字段、引号风格与 LF 换行，
 * 因此逐行处理：只替换每行最后一个字段（状态），其余字节不动。
 * 子行编号在“拟建测试”列，形如 T001-05；父行形如 T001。
 */
import { parseCsv } from './csv.ts'
import { judgeParentRow, judgeSubRow, parentChildren, type EvidenceIndex, type RowVerdict } from './results.ts'
import { repoPath, readText } from './repo.ts'

export const TRACE_PATH = 'docs/traceability.csv'

export type TraceRow = {
  /** 文件里的行号（1 起，含表头） */
  line: number
  ruleId: string
  testId: string
  description: string
  status: string
  cells: string[]
}

export type TraceTable = {
  header: string
  rows: TraceRow[]
  lines: string[]
  eol: '\n' | '\r\n'
}

function splitRecordLine(line: string): string[] | null {
  // 引号成对才说明该记录不跨行；跨行记录无法逐行替换状态，报错交给调用方
  const quotes = line.split('"').length - 1
  if (quotes % 2 !== 0) return null
  const records = parseCsv(`${line}\n`)
  if (records.length !== 1) return null
  return records[0] ?? null
}

export function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export function parseTraceability(text: string): TraceTable {
  const eol = detectEol(text)
  const lines = text.split(eol)
  const header = lines[0] ?? ''
  const rows: TraceRow[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const cells = splitRecordLine(line)
    if (cells === null) throw new Error(`第 ${index + 1} 行不是单行 CSV 记录，无法只改状态列：${line.slice(0, 40)}`)
    rows.push({
      line: index + 1,
      ruleId: cells[0] ?? '',
      description: cells[1] ?? '',
      testId: cells[3] ?? '',
      status: cells[cells.length - 1] ?? '',
      cells,
    })
  }
  return { header, rows, lines, eol }
}

export function readTraceability(): TraceTable {
  return parseTraceability(readText(repoPath(TRACE_PATH)))
}

export type Verdicts = {
  sub: Map<string, RowVerdict>
  parent: Map<string, RowVerdict>
  counts: { pass: number; partial: number; failed: number; pending: number }
}

/** 先判子行，再用父行规则汇总（父行规则见 spec_gaps.md SG-77 的父行汇总约定） */
export function computeVerdicts(table: TraceTable, index: EvidenceIndex): Verdicts {
  const subIds = table.rows.map((row) => row.testId).filter((id) => /^T\d{3}-\d{2}$/.test(id))
  const sub = new Map<string, RowVerdict>()
  for (const id of subIds) sub.set(id, judgeSubRow(id, index))
  const grouped = parentChildren(subIds)
  const parent = new Map<string, RowVerdict>()
  for (const row of table.rows) {
    if (!/^T\d{3}$/.test(row.testId)) continue
    const children = grouped.get(row.testId) ?? []
    parent.set(row.testId, judgeParentRow(children.map((id) => sub.get(id) ?? { status: 'pending', detail: '无子行' })))
  }
  const counts = { pass: 0, partial: 0, failed: 0, pending: 0 }
  for (const verdict of [...sub.values(), ...parent.values()]) counts[verdict.status] += 1
  return { sub, parent, counts }
}

export function statusText(verdict: RowVerdict, stamp: string): string {
  if (verdict.status === 'pass') return `通过（${stamp}）`
  if (verdict.status === 'partial') return `部分覆盖（${stamp}；${verdict.detail}）`
  if (verdict.status === 'failed') return `已执行未通过（${stamp}；${verdict.detail}）`
  return verdict.detail === '未执行' ? '待执行' : `待执行（${verdict.detail}）`
}

function quoteField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}

/** 把一行里最后一个未被引号包裹的逗号之后的内容整体替换，其余字符逐字保留 */
function replaceLastField(line: string, value: string): string {
  let inQuotes = false
  let cut = -1
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') index += 1
      else inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) cut = index
  }
  if (cut < 0) return line
  return `${line.slice(0, cut + 1)}${quoteField(value)}`
}

/** 只替换状态字段，其余字符（含原有引号风格）原样保留；写回一律 LF（AGENTS.md §3） */
export function rewriteStatuses(table: TraceTable, statuses: Map<number, string>): string {
  const lines = [...table.lines]
  for (const row of table.rows) {
    const next = statuses.get(row.line)
    if (next === undefined) continue
    const current = lines[row.line - 1] ?? ''
    const rebuilt = replaceLastField(current, next)
    if (rebuilt !== current) lines[row.line - 1] = rebuilt
  }
  return lines.join('\n')
}
