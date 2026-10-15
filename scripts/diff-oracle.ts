/**
 * pnpm diff:oracle
 * 用同一批案例和向量跑 evaluate 与参考实现，归一化后逐字段比较，写入 docs/_work/diff_report.md。
 * 参考实现只经 scripts/lib/oracle-run.ts；不读 oracle/ 源码。
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_CFG_1 } from '../src/engine/config.ts'
import { evaluate } from '../src/engine/evaluate.ts'
import { moneyPaths } from '../src/engine/money.ts'
import { resultCoreSchema } from '../src/engine/result.ts'
import { caseFileSchema } from '../src/engine/schema.ts'
import { toSnakeKey, toWire } from '../src/engine/wire.ts'
import { parsePath, type PathSegment } from '../tests/lib/path.ts'
import { loadVectorFiles, vectorSchema } from '../tests/lib/vector.ts'
import { runOracle, type OracleSpawn } from './lib/oracle-run.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const REPORT = 'docs/_work/diff_report.md'
const CELL_LIMIT = 200
const IGNORED = new Set(['basis', 'rule', 'refs'])
const SET_KEYS = new Set(['labels', 'related', 'event_ids'])
const ID_KEY = /_id$/
const UNSAFE_ID = /[[\]=]/

export const MISSING: unique symbol = Symbol('missing')

const SPECIFIC: Readonly<Record<string, string>> = {
  tie_group: 'R016',
  rank: '§12.7',
  node_verdict: 'D36、§10.4',
}

const TOP: Readonly<Record<string, string>> = {
  daily_reference: 'R019、D26、D27、D59',
  forecasts: 'R020、§9.6',
  scenarios: 'R018、§9.5',
  labels: '§11.4、§12.7',
  action_list: 'R017 第7条',
  confirmation: 'D46、R017',
  pending_differences: 'R017 第10条',
  user_confirmations: 'D60',
  states: '§11、D47',
  check_period: 'D04、D41、D56',
  input_issues: '§11.1',
  snapshot: '§9.2',
  nodes: '§10.4、D72',
  earliest_gap: 'D11、D35',
  gap_list: 'D11、D35',
  cost: '§3、§11.1',
  candidates: 'R016、§12.7',
  input_version: '§12.4',
}

const SECTIONS = [
  { id: 'P1', title: 'P1 演示案例' },
  { id: 'P2', title: 'P2 向量中未被断言的字段' },
  { id: 'P3', title: 'P3 其余' },
] as const

export type Priority = 'P1' | 'P2' | 'P3'

export type RawDiff = {
  path: string
  ts: unknown
  oracle: unknown
}

export type CheckpointDiff = RawDiff & { checkpoint: string }

export type Checkpoint = {
  label: string
  result: unknown
}

export type RunTsInput = {
  kind: 'cases' | 'vectors'
  name: string
  data: unknown
}

export type RunTs = (input: RunTsInput) => { checkpoints: Checkpoint[] }

export type ReportDiff = {
  object: string
  path: string
  ts: string
  oracle: string
  clause: string
  priority: Priority
}

export type ReportFailure = {
  object: string
  message: string
}

export type ReportInput = {
  stale: readonly string[]
  caseCount: number
  vectorCount: number
  tsCheckpoints: number
  oracleCheckpoints: number
  failures: readonly ReportFailure[]
  diffs: readonly ReportDiff[]
}

export type ExpectRef = {
  checkpoint: string
  path: string
}

type Visit = {
  parent: unknown
  value: unknown
}

type Side = 'cases' | 'vectors'

const MONEY_PATTERNS = new Set(moneyPaths().map(toWirePattern))

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function toWirePattern(camelPath: string): string {
  return camelPath
    .split('.')
    .map((segment) => {
      const array = segment.endsWith('[]')
      const name = array ? segment.slice(0, -2) : segment
      const wire = name === '' ? '' : toSnakeKey(name)
      return array ? `${wire}[]` : wire
    })
    .join('.')
}

function patternOf(fieldPath: string): string {
  return fieldPath.replace(/\[[^\]]*\]/g, '[]').replace(/(?:\[\]){2,}/g, '[]')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => !IGNORED.has(key))
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function stripIgnored(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripIgnored(item))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (IGNORED.has(key)) continue
    out[key] = stripIgnored(value[key])
  }
  return out
}

function uniqueSorted(values: readonly unknown[]): unknown[] {
  const entries = new Map<string, unknown>()
  for (const value of values) {
    const stripped = stripIgnored(value)
    const key = canonical(stripped)
    if (!entries.has(key)) entries.set(key, stripped)
  }
  return [...entries.entries()].sort((left, right) => byCodePoint(left[0], right[0])).map((entry) => entry[1])
}

function childPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`
}

function readMoney(value: unknown): number | null | undefined {
  if (value === null) return null
  if (isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value)) return value.value
  return undefined
}

function diffMoney(fieldPath: string, ts: unknown, oracle: unknown, out: RawDiff[]): void {
  const left = readMoney(ts)
  const right = readMoney(oracle)
  if (typeof left === 'number' && typeof right === 'number') {
    if (left !== right) out.push({ path: `${fieldPath}.value`, ts: left, oracle: right })
    return
  }
  if (left === null && right === null) return
  if (canonical(ts) !== canonical(oracle)) out.push({ path: fieldPath, ts: stripIgnored(ts), oracle: stripIgnored(oracle) })
}

function qualifyingIdKeys(elements: readonly unknown[]): string[] | null {
  if (elements.length === 0 || !elements.every(isRecord)) return null
  let shared: string[] | null = null
  for (const element of elements) {
    const keys = Object.keys(element)
      .filter((key) => ID_KEY.test(key))
      .filter((key) => element[key] === null || typeof element[key] === 'string')
      .sort()
    shared = shared === null ? keys : shared.filter((key) => keys.includes(key))
  }
  if (shared === null || shared.length === 0) return null
  return shared
}

function idsUsable(elements: readonly unknown[], keys: readonly string[]): boolean {
  const seen = new Set<string>()
  for (const element of elements) {
    if (!isRecord(element)) return false
    const parts: unknown[] = []
    for (const key of keys) {
      const value = element[key]
      if (value !== null && typeof value !== 'string') return false
      if (typeof value === 'string' && UNSAFE_ID.test(value)) return false
      parts.push(value)
    }
    const token = JSON.stringify(parts)
    if (seen.has(token)) return false
    seen.add(token)
  }
  return true
}

function alignmentKeys(ts: readonly unknown[], oracle: readonly unknown[]): string[] | null {
  const tsKeys = qualifyingIdKeys(ts)
  const oracleKeys = qualifyingIdKeys(oracle)
  let keys: string[] | null
  if (ts.length === 0) keys = oracleKeys
  else if (oracle.length === 0) keys = tsKeys
  else if (tsKeys === null || oracleKeys === null) keys = null
  else keys = tsKeys.filter((key) => oracleKeys.includes(key))
  if (keys === null || keys.length === 0) return null
  const sides = [ts, oracle].filter((side) => side.length > 0)
  if (!sides.every((side) => idsUsable(side, keys))) return null
  return keys
}

function idPath(parent: string, element: Record<string, unknown>, keys: readonly string[]): string {
  const selectors = keys
    .map((key) => {
      const value = element[key]
      return `[${key}=${value === null ? 'null' : String(value)}]`
    })
    .join('')
  return `${parent}${selectors}`
}

function diffOrderArrays(fieldPath: string, ts: readonly unknown[], oracle: readonly unknown[], out: RawDiff[]): void {
  const length = Math.max(ts.length, oracle.length)
  for (let index = 0; index < length; index += 1) {
    const child = `${fieldPath}[${index}]`
    if (index >= ts.length) out.push({ path: child, ts: MISSING, oracle: stripIgnored(oracle[index]) })
    else if (index >= oracle.length) out.push({ path: child, ts: stripIgnored(ts[index]), oracle: MISSING })
    else diffAt(child, ts[index], oracle[index], out)
  }
}

function diffIdArrays(fieldPath: string, ts: readonly unknown[], oracle: readonly unknown[], keys: readonly string[], out: RawDiff[]): void {
  const tokenOf = (element: Record<string, unknown>) => JSON.stringify(keys.map((key) => element[key]))
  const tsMap = new Map<string, Record<string, unknown>>()
  const oracleMap = new Map<string, Record<string, unknown>>()
  for (const element of ts) {
    if (isRecord(element)) tsMap.set(tokenOf(element), element)
  }
  for (const element of oracle) {
    if (isRecord(element)) oracleMap.set(tokenOf(element), element)
  }
  const tokens = [...new Set([...tsMap.keys(), ...oracleMap.keys()])].sort(byCodePoint)
  for (const token of tokens) {
    const left = tsMap.get(token)
    const right = oracleMap.get(token)
    const element = left ?? right
    if (element === undefined) continue
    const child = idPath(fieldPath, element, keys)
    if (left === undefined) out.push({ path: child, ts: MISSING, oracle: stripIgnored(right) })
    else if (right === undefined) out.push({ path: child, ts: stripIgnored(left), oracle: MISSING })
    else diffAt(child, left, right, out)
  }
}

function diffArrays(fieldPath: string, ts: readonly unknown[], oracle: readonly unknown[], out: RawDiff[]): void {
  const keys = alignmentKeys(ts, oracle)
  if (keys === null) diffOrderArrays(fieldPath, ts, oracle, out)
  else diffIdArrays(fieldPath, ts, oracle, keys, out)
}

function diffObjects(fieldPath: string, ts: Record<string, unknown>, oracle: Record<string, unknown>, out: RawDiff[]): void {
  const keys = [...new Set([...Object.keys(ts), ...Object.keys(oracle)])].filter((key) => !IGNORED.has(key)).sort()
  for (const key of keys) {
    const child = childPath(fieldPath, key)
    const hasTs = Object.hasOwn(ts, key)
    const hasOracle = Object.hasOwn(oracle, key)
    if (!hasTs) {
      out.push({ path: child, ts: MISSING, oracle: stripIgnored(oracle[key]) })
      continue
    }
    if (!hasOracle) {
      out.push({ path: child, ts: stripIgnored(ts[key]), oracle: MISSING })
      continue
    }
    if (SET_KEYS.has(key) && Array.isArray(ts[key]) && Array.isArray(oracle[key])) {
      const left = ts[key]
      const right = oracle[key]
      if (canonical(uniqueSorted(left)) !== canonical(uniqueSorted(right))) {
        out.push({ path: child, ts: uniqueSorted(left), oracle: uniqueSorted(right) })
      }
      continue
    }
    diffAt(child, ts[key], oracle[key], out)
  }
}

function diffAt(fieldPath: string, ts: unknown, oracle: unknown, out: RawDiff[]): void {
  if (fieldPath !== '' && MONEY_PATTERNS.has(patternOf(fieldPath))) {
    diffMoney(fieldPath, ts, oracle, out)
    return
  }
  if (isRecord(ts) && isRecord(oracle)) {
    diffObjects(fieldPath, ts, oracle, out)
    return
  }
  if (Array.isArray(ts) && Array.isArray(oracle)) {
    diffArrays(fieldPath, ts, oracle, out)
    return
  }
  if (canonical(ts) !== canonical(oracle)) out.push({ path: fieldPath, ts: stripIgnored(ts), oracle: stripIgnored(oracle) })
}

/** 去掉 basis、rule、refs 后逐字段比较；金额只比 value，三个集合字段忽略顺序 */
export function diffResults(ts: unknown, oracle: unknown): RawDiff[] {
  const out: RawDiff[] = []
  diffAt('', ts, oracle, out)
  out.sort((left, right) => byCodePoint(left.path, right.path))
  return out
}

export function compareCheckpoints(ts: readonly Checkpoint[], oracle: readonly Checkpoint[]): CheckpointDiff[] {
  const tsMap = indexCheckpoints(ts)
  const oracleMap = indexCheckpoints(oracle)
  const labels = [...new Set([...tsMap.keys(), ...oracleMap.keys()])].sort(byCodePoint)
  const out: CheckpointDiff[] = []
  for (const label of labels) {
    const left = tsMap.get(label)
    const right = oracleMap.get(label)
    if (left === undefined || right === undefined) {
      out.push({
        checkpoint: label,
        path: '(检查点)',
        ts: left === undefined ? MISSING : stripIgnored(left),
        oracle: right === undefined ? MISSING : stripIgnored(right),
      })
      continue
    }
    for (const diff of diffResults(left, right)) out.push({ checkpoint: label, ...diff })
  }
  return out
}

function indexCheckpoints(list: readonly Checkpoint[]): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const item of list) {
    if (map.has(item.label)) throw new Error(`检查点 ${item.label} 重复`)
    map.set(item.label, item.result)
  }
  return map
}

function pathKeys(fieldPath: string): string[] {
  let segments: PathSegment[]
  try {
    segments = parsePath(fieldPath)
  } catch {
    return []
  }
  const keys: string[] = []
  for (const segment of segments) {
    if (segment.kind === 'key') keys.push(segment.key)
    else if (segment.kind === 'select') {
      for (const condition of segment.conditions) keys.push(...condition.field)
    }
  }
  return keys
}

/** 按路径上的键名推断 rules.md §12.5 及结果结构注释中的条款；更具体的键优先 */
export function clauseFor(fieldPath: string): string {
  const keys = pathKeys(fieldPath)
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const clause = SPECIFIC[keys[index] ?? '']
    if (clause !== undefined) return clause
  }
  const first = keys[0]
  if (first !== undefined && TOP[first] !== undefined) return TOP[first]
  return '§12.5'
}

function scalarMatches(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual === expected
  if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected
  return actual === null && expected === 'null'
}

function conditionMatches(element: unknown, field: readonly string[], expected: string): boolean {
  let current: unknown = element
  for (const key of field) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return false
    current = current[key]
  }
  if (Array.isArray(current)) return current.some((item) => scalarMatches(item, expected))
  return scalarMatches(current, expected)
}

function segmentEqual(left: PathSegment, right: PathSegment): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'key' && right.kind === 'key') return left.key === right.key
  if (left.kind === 'index' && right.kind === 'index') return left.index === right.index
  if (left.kind === 'select' && right.kind === 'select') {
    if (left.conditions.length !== right.conditions.length) return false
    return left.conditions.every((condition, index) => {
      const other = right.conditions[index]
      return other !== undefined && condition.value === other.value && condition.field.join('.') === other.field.join('.')
    })
  }
  return false
}

function isSegmentPrefix(leftPath: string, rightPath: string): boolean {
  let left: PathSegment[]
  let right: PathSegment[]
  try {
    left = parsePath(leftPath)
    right = parsePath(rightPath)
  } catch {
    return false
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  for (let index = 0; index < shorter.length; index += 1) {
    const a = shorter[index]
    const b = longer[index]
    if (a === undefined || b === undefined || !segmentEqual(a, b)) return false
  }
  return true
}

function walk(root: unknown, fieldPath: string): Visit[] | null {
  let segments: PathSegment[]
  try {
    segments = parsePath(fieldPath)
  } catch {
    return null
  }
  const visits: Visit[] = []
  let current = root
  for (const segment of segments) {
    const parent = current
    if (segment.kind === 'key') {
      if (!isRecord(current) || !Object.hasOwn(current, segment.key)) return null
      current = current[segment.key]
    } else if (segment.kind === 'index') {
      if (!Array.isArray(current) || segment.index >= current.length) return null
      current = current[segment.index]
    } else {
      if (!Array.isArray(current)) return null
      const hits = current.filter((element) => segment.conditions.every((condition) => conditionMatches(element, condition.field, condition.value)))
      if (hits.length !== 1) return null
      current = hits[0]
    }
    visits.push({ parent, value: current })
  }
  return visits
}

function chainPrefix(shorter: readonly Visit[], longer: readonly Visit[]): boolean {
  if (shorter.length > longer.length) return false
  for (let index = 0; index < shorter.length; index += 1) {
    const left = shorter[index]
    const right = longer[index]
    if (left === undefined || right === undefined) return false
    if (!Object.is(left.parent, right.parent) || !Object.is(left.value, right.value)) return false
  }
  return true
}

function covers(expectPath: string, diffPath: string, ts: unknown, oracle: unknown): boolean {
  if (isSegmentPrefix(expectPath, diffPath)) return true
  for (const root of [ts, oracle]) {
    if (root === undefined || root === null) continue
    const expected = walk(root, expectPath)
    const actual = walk(root, diffPath)
    if (expected !== null && actual !== null && (chainPrefix(expected, actual) || chainPrefix(actual, expected))) return true
  }
  return false
}

export function priorityFor(input: {
  kind: 'case' | 'vector'
  checkpoint: string
  path: string
  expects: readonly ExpectRef[]
  tsResult: unknown
  oracleResult: unknown
}): Priority {
  if (input.kind === 'case') return 'P1'
  if (input.path === '(检查点)') return input.expects.some((item) => item.checkpoint === input.checkpoint) ? 'P3' : 'P2'
  const relevant = input.expects.filter((item) => item.checkpoint === input.checkpoint)
  if (relevant.some((item) => covers(item.path, input.path, input.tsResult, input.oracleResult))) return 'P3'
  return 'P2'
}

function truncate(text: string): string {
  const chars = [...text]
  return chars.length <= CELL_LIMIT ? text : `${chars.slice(0, CELL_LIMIT).join('')}…`
}

function showCell(value: unknown): string {
  if (value === MISSING) return '缺失'
  const text = JSON.stringify(stripIgnored(value))
  return text === undefined ? '缺失' : text
}

export function formatDiffReport(input: ReportInput): string {
  const lines: string[] = []
  const stale = [...input.stale].sort(byCodePoint)
  if (stale.length > 0) lines.push(`警告：oracle 输入与记录指纹不一致：${stale.join('、')}`, '')
  lines.push('# 引擎与参考实现对拍', '', '## 总体', '')
  const counts: Record<Priority, number> = { P1: 0, P2: 0, P3: 0 }
  for (const diff of input.diffs) counts[diff.priority] += 1
  lines.push(`案例 ${input.caseCount}，向量 ${input.vectorCount}，检查点 TS ${input.tsCheckpoints} / oracle ${input.oracleCheckpoints}`)
  lines.push(`差异 合计 ${counts.P1 + counts.P2 + counts.P3}（P1 ${counts.P1}，P2 ${counts.P2}，P3 ${counts.P3}）`)
  lines.push(`运行失败 ${input.failures.length}`)
  if (input.failures.length > 0) {
    lines.push('', '对象｜说明')
    const failures = [...input.failures].sort((left, right) => byCodePoint(left.object, right.object) || byCodePoint(left.message, right.message))
    for (const failure of failures) lines.push(`${failure.object}｜${failure.message}`)
  }
  for (const section of SECTIONS) {
    lines.push('', `## ${section.title}`, '')
    const rows = input.diffs.filter((diff) => diff.priority === section.id).sort((left, right) => byCodePoint(left.object, right.object) || byCodePoint(left.path, right.path))
    if (rows.length === 0) lines.push('无')
    else {
      lines.push('对象｜字段路径｜TS｜oracle｜相关条款')
      for (const row of rows) lines.push([row.object, row.path, truncate(row.ts), truncate(row.oracle), row.clause].join('｜'))
    }
  }
  return `${lines.join('\n')}\n`
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split(/\r?\n/).find((item) => item.trim() !== '')
  return line?.trim() ?? '未知错误'
}

function stem(name: string): string {
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name
}

function assertCheckpoints(value: unknown): Checkpoint[] {
  if (!Array.isArray(value)) throw new Error('结果缺少 checkpoints')
  const seen = new Set<string>()
  const checkpoints: Checkpoint[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.label !== 'string' || item.label === '') throw new Error('检查点缺少 label')
    if (!Object.hasOwn(item, 'result')) throw new Error('检查点缺少 result')
    if (seen.has(item.label)) throw new Error(`检查点 ${item.label} 重复`)
    seen.add(item.label)
    checkpoints.push({ label: item.label, result: item.result })
  }
  return checkpoints
}

function parseCheckpointText(text: string): Checkpoint[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('结果不是 JSON')
  }
  if (!isRecord(data) || !Array.isArray(data.checkpoints)) throw new Error('结果缺少 checkpoints')
  return assertCheckpoints(data.checkpoints)
}

function wireOutput(output: { checkpoints: readonly { label: string; result: unknown }[] }): { checkpoints: Checkpoint[] } {
  return {
    checkpoints: output.checkpoints.map((checkpoint) => ({
      label: checkpoint.label,
      result: toWire(resultCoreSchema.parse(checkpoint.result)),
    })),
  }
}

function defaultRunTs(input: RunTsInput): { checkpoints: Checkpoint[] } {
  if (input.kind === 'cases') {
    const data = caseFileSchema.parse(input.data)
    const caseId = stem(input.name)
    if (data.meta.case_id !== caseId) throw new Error(`${input.name} 的 case_id 应为 ${caseId}，实际为 ${data.meta.case_id}`)
    return wireOutput(evaluate(data, [], DEMO_CFG_1))
  }
  const vector = vectorSchema.parse(input.data)
  return wireOutput(evaluate(vector.input, vector.ops, DEMO_CFG_1))
}

function readExpects(data: unknown): ExpectRef[] {
  if (!isRecord(data) || !Array.isArray(data.expect)) return []
  const expects: ExpectRef[] = []
  for (const item of data.expect) {
    if (isRecord(item) && typeof item.checkpoint === 'string' && typeof item.path === 'string') {
      expects.push({ checkpoint: item.checkpoint, path: item.path })
    }
  }
  return expects
}

function objectId(kind: Side, name: string, data: unknown): string {
  if (kind === 'vectors' && isRecord(data) && typeof data.test_id === 'string' && data.test_id !== '') return data.test_id
  return stem(name)
}

async function jsonFileNames(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort(byCodePoint)
}

async function loadOracle(root: string, kind: Side, name: string, errors: ReadonlyMap<string, string>): Promise<Checkpoint[]> {
  const recorded = errors.get(`${kind}/${name}`)
  if (recorded !== undefined) throw new Error(recorded)
  const file = path.join(root, '.cache/oracle-out', kind, name)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isEnoent(error)) throw new Error('缺少结果文件')
    throw error
  }
  return parseCheckpointText(text)
}

async function writeTs(root: string, kind: Side, name: string, checkpoints: readonly Checkpoint[]): Promise<void> {
  const target = path.join(root, '.cache/ts-out', kind, name)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({ checkpoints }, null, 2)}\n`, 'utf8')
}

type Source = {
  kind: Side
  name: string
  text: string
}

async function loadSources(root: string): Promise<{ cases: Source[]; vectors: Source[] }> {
  const cases: Source[] = []
  for (const name of await jsonFileNames(path.join(root, 'fixtures/cases'))) {
    cases.push({ kind: 'cases', name, text: await readFile(path.join(root, 'fixtures/cases', name), 'utf8') })
  }
  const vectors = loadVectorFiles(root).files.map((file) => ({
    kind: 'vectors' as const,
    name: path.basename(file.file),
    text: file.text,
  }))
  return { cases, vectors }
}

function rowsFor(kind: 'case' | 'vector', id: string, data: unknown, ts: readonly Checkpoint[], oracle: readonly Checkpoint[]): ReportDiff[] {
  const expects = kind === 'vector' ? readExpects(data) : []
  const tsMap = indexCheckpoints(ts)
  const oracleMap = indexCheckpoints(oracle)
  const rows: ReportDiff[] = []
  for (const diff of compareCheckpoints(ts, oracle)) {
    rows.push({
      object: `${id}/${diff.checkpoint}`,
      path: diff.path,
      ts: showCell(diff.ts),
      oracle: showCell(diff.oracle),
      clause: clauseFor(diff.path),
      priority: priorityFor({
        kind,
        checkpoint: diff.checkpoint,
        path: diff.path,
        expects,
        tsResult: tsMap.get(diff.checkpoint),
        oracleResult: oracleMap.get(diff.checkpoint),
      }),
    })
  }
  return rows
}

export async function runDiff(options: { root?: string; spawn?: OracleSpawn; runTs?: RunTs; reportPath?: string } = {}): Promise<{ text: string; exitCode: number }> {
  const root = options.root ?? repoRoot
  const runTs = options.runTs ?? defaultRunTs
  const outcome = await runOracle({ root, spawn: options.spawn })
  await rm(path.join(root, '.cache/ts-out'), { recursive: true, force: true })
  const errors = new Map(outcome.failures.map((failure) => [failure.file, failure.error]))
  const sources = await loadSources(root)
  const failures: ReportFailure[] = []
  const diffs: ReportDiff[] = []
  let tsCheckpoints = 0
  let oracleCheckpoints = 0
  for (const item of [...sources.cases, ...sources.vectors]) {
    let data: unknown = undefined
    let id = stem(item.name)
    let ts: Checkpoint[] | null = null
    let oracle: Checkpoint[] | null = null
    try {
      data = JSON.parse(item.text) as unknown
      id = objectId(item.kind, item.name, data)
      ts = assertCheckpoints(runTs({ kind: item.kind, name: item.name, data }).checkpoints)
      await writeTs(root, item.kind, item.name, ts)
    } catch (error) {
      failures.push({ object: id, message: `TS 失败：${firstLine(error)}` })
    }
    try {
      oracle = await loadOracle(root, item.kind, item.name, errors)
    } catch (error) {
      failures.push({ object: id, message: `oracle 失败：${firstLine(error)}` })
    }
    if (ts !== null) tsCheckpoints += ts.length
    if (oracle !== null) oracleCheckpoints += oracle.length
    if (ts !== null && oracle !== null) diffs.push(...rowsFor(item.kind === 'cases' ? 'case' : 'vector', id, data, ts, oracle))
  }
  const text = formatDiffReport({
    stale: outcome.stale,
    caseCount: sources.cases.length,
    vectorCount: sources.vectors.length,
    tsCheckpoints,
    oracleCheckpoints,
    failures,
    diffs,
  })
  const reportPath = options.reportPath ?? path.join(root, REPORT)
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, text, 'utf8')
  return { text, exitCode: 0 }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  runDiff()
    .then(() => {
      process.exitCode = 0
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
