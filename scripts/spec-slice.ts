/**
 * pnpm slice Mx
 * 把该模块的规则、演示配置、数据结构和本模块向量写入 .cache/slices/Mx.md。
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadVectorModules } from './vec.ts'
import { MODULES, type ModuleId } from '../src/engine/modules.ts'
import { GAPS_FILE, baseTestId, loadVectorFiles, testIdRows, vectorSchema, type Vector } from '../tests/lib/vector.ts'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

type SliceSpec = {
  name: string
  rules: readonly string[]
  sections: readonly string[]
  decisions: readonly string[]
}

function expandDecisions(parts: readonly string[]): string[] {
  return parts.flatMap((part) => {
    const range = /^D(\d+)-D(\d+)$/.exec(part)
    if (range === null) return [part]
    const start = Number(range[1])
    const end = Number(range[2])
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) throw new Error(`决策范围无效：${part}`)
    const ids: string[] = []
    for (let number = start; number <= end; number += 1) ids.push(`D${String(number).padStart(2, '0')}`)
    return ids
  })
}

function spec(name: string, rules: readonly string[], sections: readonly string[], decisions: readonly string[]): SliceSpec {
  return { name, rules, sections, decisions: expandDecisions(decisions) }
}

const SLICE_SPECS: Record<ModuleId, SliceSpec> = {
  M1: spec(
    '输入、操作与快照',
    ['R001', 'R004', 'R007', 'R008', 'R013', 'R015'],
    ['1', '9'],
    ['D01', 'D02', 'D03', 'D28', 'D29', 'D51', 'D57', 'D58', 'D59', 'D60', 'D69', 'D70', 'D71'],
  ),
  M2: spec(
    '价格项与优惠（单个候选）',
    ['R009', 'R016'],
    ['9.7'],
    ['D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D42', 'D43', 'D44', 'D45', 'D65'],
  ),
  M3: spec(
    '时间轴、检查期间与节点判定',
    ['R002', 'R003', 'R005', 'R006', 'R012'],
    ['2', '10.1', '10.2', '10.3', '10.4', '10.6', '10.7', '10.8'],
    ['D04-D11', 'D34-D41', 'D47', 'D54', 'D55', 'D56', 'D61', 'D64', 'D72-D74'],
  ),
  M4: spec(
    '成本、状态与依赖',
    ['R007', 'R010', 'R012', 'R015'],
    ['3', '11'],
    ['D12', 'D19', 'D20', 'D42', 'D47', 'D55', 'D61', 'D62'],
  ),
  M5: spec('候选比较与 Top-K', ['R011', 'R016'], [], ['D01', 'D13', 'D15', 'D43']),
  M6: spec('确认与行动清单', ['R017'], [], ['D18', 'D46', 'D53', 'D63']),
  M7: spec('每日参考', ['R019'], ['4', '10.5', '10.6'], ['D22', 'D26', 'D27', 'D59']),
  M8: spec('Holt 预测', ['R020', 'R009'], ['6', '7.2', '7.3'], ['D14', 'D24', 'D25', 'D50', 'D66']),
  M9: spec('消费情景', ['R018'], ['5', '7.1', '7.3'], ['D21', 'D22', 'D23', 'D48', 'D49', 'D67']),
}

function isModuleId(value: string): value is ModuleId {
  return (MODULES as readonly string[]).includes(value)
}

function testIdParts(id: string): [number, number, number] | null {
  const match = /^T(\d+)-(\d+)(?:#(\d+))?$/.exec(id)
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), match[3] === undefined ? 0 : Number(match[3])]
}

function compareTestId(left: string, right: string): number {
  const a = testIdParts(left)
  const b = testIdParts(right)
  if (a === null || b === null) return left < right ? -1 : left > right ? 1 : 0
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function numberedHeading(id: string): RegExp {
  return new RegExp(`^(#{2,4}) ${id.replaceAll('.', '\\.')}(?:\\.(?!\\d)| )`)
}

function extract(lines: readonly string[], pattern: RegExp, label: string): string {
  const start = lines.findIndex((line) => pattern.test(line))
  if (start < 0) throw new Error(`找不到 ${label}`)
  const marks = /^(#+)/.exec(lines[start] ?? '')
  const level = marks?.[1]?.length ?? 0
  if (level === 0) throw new Error(`找不到 ${label}`)
  let end = start + 1
  while (end < lines.length) {
    const next = /^(#+)/.exec(lines[end] ?? '')
    const marks = next?.[1]
    if (marks !== undefined && marks.length <= level) break
    end += 1
  }
  const text = lines.slice(start, end).join('\n').trimEnd()
  if (text === '') throw new Error(`${label} 为空`)
  return text
}

function decisionText(lines: readonly string[], id: string): string {
  const start = lines.findIndex((line) => line.startsWith(`- ${id} `))
  if (start < 0) throw new Error(`找不到 ${id}`)
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (line.startsWith('- D') || line.startsWith('#')) break
    end += 1
  }
  const text = lines.slice(start, end).join('\n').trimEnd()
  if (text === '') throw new Error(`${id} 为空`)
  return text
}

function loadVectors(): Vector[] {
  const { files } = loadVectorFiles(root)
  return files.map(({ file, text }) => {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`${file} 不是 JSON`)
    }
    const parsed = vectorSchema.safeParse(data)
    if (!parsed.success) throw new Error(`${file} 不是合法向量`)
    return parsed.data
  })
}

function vectorBody(ids: readonly string[], byId: ReadonlyMap<string, Vector>): string {
  if (ids.length === 0) return '无'
  return ids
    .map((id) => {
      const vector = byId.get(id)
      if (vector === undefined) throw new Error(`${id} 在 vector-modules.json 中，但没有对应向量`)
      return `### ${id}\n\n${vector.source_text.trimEnd()}`
    })
    .join('\n\n')
}

function gapBelongs(gapId: string, released: ReadonlySet<string>, bases: ReadonlySet<string>): boolean {
  if (released.has(gapId)) return true
  return !gapId.includes('#') && bases.has(gapId)
}

function gapBody(ids: readonly string[]): string {
  const released = new Set(ids)
  const bases = new Set(ids.map((id) => baseTestId(id)))
  const rows = testIdRows(readText(GAPS_FILE)).filter((row) => {
    const id = row[0] ?? ''
    const reason = row[2] ?? ''
    if (reason.startsWith('已裁决') || reason.startsWith('已覆盖')) return false
    return gapBelongs(id, released, bases)
  })
  if (rows.length === 0) return '无'
  const lines = ['| 编号 | 原文 | 原因 |', '| --- | --- | --- |']
  for (const row of rows) {
    const cells = [0, 1, 2].map((index) => (row[index] ?? '').replaceAll('|', '\\|').replaceAll('\n', ' '))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function withByteCount(body: string): string {
  const head = `${body.trimEnd()}\n`
  let size = Buffer.byteLength(`${head}字节数：0\n`, 'utf8')
  let attempt = 0
  while (attempt < 6) {
    attempt += 1
    const file = `${head}字节数：${size}\n`
    const next = Buffer.byteLength(file, 'utf8')
    if (next === size) return file
    size = next
  }
  throw new Error('字节数未收敛')
}

function sliceOf(moduleId: ModuleId, rulesLines: readonly string[]): string {
  const slice = SLICE_SPECS[moduleId]
  const rules = slice.rules.map((id) => extract(rulesLines, new RegExp(`^(#{2,4}) ${id}\\b`), id))
  const sections = slice.sections.map((id) => extract(rulesLines, numberedHeading(id), `§${id}`))
  const decisions = slice.decisions.map((id) => decisionText(rulesLines, id))
  const dataSections = moduleId === 'M1' ? ['12'] : ['12.1', '12.5', '12.7']
  const data = dataSections.map((id) => extract(rulesLines, numberedHeading(id), `§${id}`))
  const modules = loadVectorModules(root)
  const ids = [...modules.entries()]
    .filter((entry) => entry[1] === moduleId)
    .map((entry) => entry[0])
    .sort(compareTestId)
  const byId = new Map(loadVectors().map((vector) => [vector.test_id, vector]))
  const chunks = [
    `# ${moduleId} ${slice.name}`,
    ['## 规则', [rules, sections].flat().join('\n\n')].join('\n\n'),
    ['## 演示配置', decisions.join('\n\n')].join('\n\n'),
    ['## 数据结构', data.join('\n\n')].join('\n\n'),
    ['## 向量', vectorBody(ids, byId)].join('\n\n'),
    ['## 向量缺口', gapBody(ids)].join('\n\n'),
  ]
  return withByteCount(chunks.join('\n\n'))
}

const moduleArg = process.argv[2]
if (moduleArg === undefined || !isModuleId(moduleArg)) {
  console.error('用法：pnpm slice Mx')
  process.exit(1)
}

const text = sliceOf(moduleArg, readText('docs/rules.md').split('\n'))
const size = Buffer.byteLength(text, 'utf8')
const last = text.trimEnd().split('\n').at(-1)
if (last !== `字节数：${size}`) throw new Error(`字节数不一致：${last ?? ''}，实际 ${size}`)
const target = path.join(root, '.cache/slices', `${moduleArg}.md`)
await mkdir(path.dirname(target), { recursive: true })
await writeFile(target, text, 'utf8')
console.log(`${moduleArg} ${size}`)
