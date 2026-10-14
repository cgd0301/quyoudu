/**
 * 统计 spec_gaps.md 的状态，并检查缺口编号与追溯表引用是否对得上。
 * 存在“待团队裁决”、延后条目没有对应 V 约束，或追溯表引用了不存在的 SG/D/V 时，退出码为 1。
 * “AI暂定（保守）”只打印警告。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8')
}

type GapRow = {
  id: string
  handling: string
  status: string
}

function tableCells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

function parseGapRows(text: string): GapRow[] {
  const rows: GapRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('| SG-')) continue
    const cells = tableCells(line)
    rows.push({
      id: cells[0] ?? '',
      handling: cells[3] ?? '',
      status: cells[5] ?? '',
    })
  }
  return rows
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char ?? ''
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char ?? ''
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function definedDecisionIds(rules: string): Set<string> {
  const ids = new Set<string>()
  for (const match of rules.matchAll(/^- D(\d+)\b/gm)) {
    ids.add(`D${match[1]}`)
  }
  for (const match of rules.matchAll(/D(\d+)—D(\d+)/g)) {
    const start = Number(match[1])
    const end = Number(match[2])
    for (let number = start; number <= end; number += 1) {
      ids.add(`D${number}`)
    }
  }
  return ids
}

function definedConstraintIds(rules: string): Set<string> {
  const section = rules.split('#### 8.9 提交版数据约束')[1]?.split('\n### ')[0] ?? ''
  const ids = new Set<string>()
  for (const match of section.matchAll(/^- V-(\d+)\b/gm)) {
    ids.add(`V-${match[1]}`)
  }
  return ids
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

const gapsText = readRepoFile('docs/_work/spec_gaps.md')
const rulesText = readRepoFile('docs/rules.md')
const traceText = readRepoFile('docs/traceability.csv')

const gapRows = parseGapRows(gapsText)
const definedSg = new Set(gapRows.map((row) => row.id))
const definedD = definedDecisionIds(rulesText)
const definedV = definedConstraintIds(rulesText)

const counts = {
  decided: 0,
  derived: 0,
  deferred: 0,
  removed: 0,
  provisional: 0,
  pending: 0,
  other: 0,
}
const errors: string[] = []
const warnings: string[] = []

if (gapsText.includes('待团队裁决')) {
  errors.push('spec_gaps.md 仍有“待团队裁决”')
}

for (const row of gapRows) {
  const status = row.status
  if (status.includes('待团队裁决')) counts.pending += 1
  else if (status.includes('AI暂定')) {
    counts.provisional += 1
    warnings.push(`${row.id} 状态为 AI暂定（保守），待团队批量复核`)
  } else if (status.includes('已解决')) counts.derived += 1
  else if (status.startsWith('延后')) counts.deferred += 1
  else if (status.startsWith('移出规格')) counts.removed += 1
  else if (status.startsWith('已裁决')) counts.decided += 1
  else {
    counts.other += 1
    errors.push(`${row.id} 的状态无法归类：${status}`)
  }

  const deferredText = `${status}\n${row.handling}`
  if (deferredText.includes('延后')) {
    const mentioned = unique([...deferredText.matchAll(/V-\d+/g)].map((match) => match[0]))
    if (mentioned.length === 0) {
      errors.push(`${row.id} 写了“延后”，但没有对应的 V 编号`)
    }
    for (const constraintId of mentioned) {
      if (!definedV.has(constraintId)) {
        errors.push(`${row.id} 的 ${constraintId} 不在 rules.md §8.9 提交版数据约束中`)
      }
    }
  }
}

const traceRows = parseCsv(traceText)
for (const [index, cells] of traceRows.entries()) {
  if (index === 0) continue
  const testId = cells[3] ?? `第${index + 1}行`
  const text = cells.join('\n')
  for (const match of text.matchAll(/SG-\d+/g)) {
    const gapId = match[0]
    if (!definedSg.has(gapId)) errors.push(`${testId} 引用了不存在的 ${gapId}`)
  }
  for (const match of text.matchAll(/V-\d+/g)) {
    const constraintId = match[0]
    if (!definedV.has(constraintId)) errors.push(`${testId} 引用了不存在的 ${constraintId}`)
  }
  for (const match of text.matchAll(/D-?(\d+)\b/g)) {
    const decisionId = `D${match[1]}`
    if (!definedD.has(decisionId)) errors.push(`${testId} 引用了不存在的 ${decisionId}`)
  }
}

console.log('spec_gaps.md 状态统计')
console.log(`已裁决 ${counts.decided}`)
console.log(`已解决（推出） ${counts.derived}`)
console.log(`延后 ${counts.deferred}`)
console.log(`移出规格 ${counts.removed}`)
console.log(`AI暂定（保守） ${counts.provisional}`)
console.log(`待团队裁决 ${counts.pending}`)
console.log(`其他 ${counts.other}`)

for (const warning of warnings) console.warn(`警告 ${warning}`)

if (errors.length > 0) {
  for (const error of errors) console.error(error)
  process.exit(1)
}
