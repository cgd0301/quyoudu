/**
 * 从真实运行产物里取每条测试编号的证据，供 test:report 和 trace:update 共用。
 *
 * 证据来源只有四种：TS 向量结果、vitest 结果、Playwright 结果、doc:lint 结果。
 * 没有运行记录的编号一律视为“未执行”，不因为存在同名测试文件就当通过。
 */
import path from 'node:path'
import { REPO_ROOT, readJsonIfExists, readText, repoPath } from './repo.ts'

export type Status = 'pass' | 'fail' | 'skipped' | 'none'

const TEST_ID = /^T\d{3}-\d{2}/
const PARENT_ID = /^T\d{3}$/

export function subIdOf(name: string): string | null {
  return TEST_ID.exec(name.trim())?.[0] ?? null
}

export function isParentId(id: string): boolean {
  return PARENT_ID.test(id)
}

export type VecSummary = {
  vectorsPassed: number
  vectorsTotal: number
  assertionsPassed: number
  assertionsTotal: number
  assertionsSkipped: number
  runErrors: number
}

export type VecJson = {
  summary: VecSummary
  stale: string[]
  assertions: { testId: string; checkpoint: string; path: string; op: string; expected: string; actual: string; status: string }[]
  runErrors: { testId: string; message: string }[]
}

export type NamedStatus = { name: string; fullName?: string; status: 'pass' | 'fail' | 'skipped' }

export type DocCheck = { id: string; passed: boolean; message: string }

export type DocLintJson = {
  checks: DocCheck[]
}

export type VecGapRow = {
  id: string
  text: string
  reason: string
  disposition: 'resolved' | 'covered' | 'open'
  coveredBy: string | null
}

export type Evidence = {
  vector: Status
  unit: Status
  e2e: Status
  doc: Status
  /** 命中的单元测试名，用于核对 vector_gaps 的“已覆盖”条目 */
  unitNames: string[]
  vectorSkipped: number
  vectorFailed: number
  vectorPassed: number
}

export type EvidenceIndex = {
  ids: Map<string, Evidence>
  unitTitles: Set<string>
  vitestTotals: { passed: number; failed: number; skipped: number; total: number } | null
  vec: VecJson | null
  playwright: { passed: number; failed: number; skipped: number } | null
  doc: DocLintJson | null
  gaps: VecGapRow[]
  layers: Map<string, Set<string>>
}

function emptyEvidence(): Evidence {
  return { vector: 'none', unit: 'none', e2e: 'none', doc: 'none', unitNames: [], vectorSkipped: 0, vectorFailed: 0, vectorPassed: 0 }
}

function entryFor(map: Map<string, Evidence>, id: string): Evidence {
  const existing = map.get(id)
  if (existing !== undefined) return existing
  const created = emptyEvidence()
  map.set(id, created)
  return created
}

function mergeStatus(target: Evidence, key: 'vector' | 'unit' | 'e2e' | 'doc', status: Status): void {
  if (status === 'fail') target[key] = 'fail'
  else if (status === 'skipped' && target[key] !== 'fail') target[key] = 'skipped'
  else if (status === 'pass' && target[key] === 'none') target[key] = 'pass'
}

export function parseVitestJson(text: string): { named: NamedStatus[]; totals: { passed: number; failed: number; skipped: number; total: number } } {
  const data = JSON.parse(text) as {
    numTotalTests?: number
    numPassedTests?: number
    numFailedTests?: number
    numPendingTests?: number
    testResults?: { assertionResults?: { title?: string; fullName?: string; status?: string }[] }[]
  }
  const named: NamedStatus[] = []
  for (const file of data.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      // 用例编号写在 test() 的名称里，describe 前缀不算；fullName 只用于按完整名称核对缺口覆盖
      const name = assertion.title ?? assertion.fullName ?? ''
      const fullName = assertion.fullName ?? name
      const status = assertion.status === 'passed' ? 'pass' : assertion.status === 'pending' || assertion.status === 'skipped' || assertion.status === 'todo' ? 'skipped' : 'fail'
      named.push({ name, fullName, status })
    }
  }
  const passed = data.numPassedTests ?? named.filter((item) => item.status === 'pass').length
  const failed = data.numFailedTests ?? named.filter((item) => item.status === 'fail').length
  const skipped = data.numPendingTests ?? named.filter((item) => item.status === 'skipped').length
  return { named, totals: { passed, failed, skipped, total: data.numTotalTests ?? named.length } }
}

type PlaywrightSpec = { title?: string; ok?: boolean; tests?: { results?: { status?: string }[] }[] }
type PlaywrightNode = { title?: string; ok?: boolean; specs?: PlaywrightSpec[]; suites?: PlaywrightNode[] }

export function parsePlaywrightJson(text: string): NamedStatus[] {
  const data = JSON.parse(text) as PlaywrightNode
  const named: NamedStatus[] = []
  const visit = (node: PlaywrightNode): void => {
    for (const spec of node.specs ?? []) {
      const results = (spec.tests ?? []).flatMap((test) => test.results ?? [])
      const status = spec.ok === true ? 'pass' : results.every((result) => result.status === 'skipped') ? 'skipped' : 'fail'
      named.push({ name: spec.title ?? '', status })
    }
    for (const suite of node.suites ?? []) visit(suite)
  }
  visit(data)
  return named
}

/** traceability.csv 的编号列取自“拟建测试”；子行形如 T001-05，父行形如 T001 */
export function parseTestLayers(text: string): Map<string, Set<string>> {
  const layers = new Map<string, Set<string>>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('| T')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const id = cells[0] ?? ''
    const layer = cells[1] ?? ''
    if (id === '' || layer === '') continue
    const set = layers.get(id) ?? new Set<string>()
    set.add(layer)
    layers.set(id, set)
  }
  return layers
}

export function parseVecGaps(text: string): VecGapRow[] {
  const rows: VecGapRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('| T')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const id = cells[0] ?? ''
    const reason = cells[2] ?? ''
    if (id === '' || reason === '') continue
    const covered = /^已覆盖：([^\s「]+)「(.+)」/.exec(reason)
    if (covered !== null) {
      rows.push({ id, text: cells[1] ?? '', reason, disposition: 'covered', coveredBy: covered[2] ?? null })
      continue
    }
    if (reason.includes('已裁决')) {
      rows.push({ id, text: cells[1] ?? '', reason, disposition: 'resolved', coveredBy: null })
      continue
    }
    rows.push({ id, text: cells[1] ?? '', reason, disposition: 'open', coveredBy: null })
  }
  return rows
}

export function buildEvidenceIndex(reportDir: string = path.join(REPO_ROOT, '.cache', 'report')): EvidenceIndex {
  const ids = new Map<string, Evidence>()
  const vec = readJsonIfExists<VecJson>(path.join(reportDir, 'vec.json'))
  if (vec !== null) {
    for (const assertion of vec.assertions) {
      const entry = entryFor(ids, assertion.testId)
      if (assertion.status === 'pass') {
        entry.vectorPassed += 1
        mergeStatus(entry, 'vector', 'pass')
      } else if (assertion.status === 'skipped') {
        entry.vectorSkipped += 1
        mergeStatus(entry, 'vector', 'skipped')
      } else {
        entry.vectorFailed += 1
        mergeStatus(entry, 'vector', 'fail')
      }
    }
    for (const error of vec.runErrors) mergeStatus(entryFor(ids, error.testId), 'vector', 'fail')
  }

  const unitTitles = new Set<string>()
  let vitestTotals: EvidenceIndex['vitestTotals'] = null
  const vitestText = (() => {
    const file = path.join(reportDir, 'vitest.json')
    try {
      return readText(file)
    } catch {
      return null
    }
  })()
  if (vitestText !== null) {
    const parsed = parseVitestJson(vitestText)
    vitestTotals = parsed.totals
    for (const item of parsed.named) {
      unitTitles.add(item.name)
      if (item.fullName !== undefined) unitTitles.add(item.fullName)
      const id = subIdOf(item.name)
      if (id === null) continue
      const entry = entryFor(ids, id)
      entry.unitNames.push(item.name)
      mergeStatus(entry, 'unit', item.status)
    }
  }

  let playwright: EvidenceIndex['playwright'] = null
  const playwrightText = (() => {
    const file = path.join(reportDir, 'playwright.json')
    try {
      return readText(file)
    } catch {
      return null
    }
  })()
  if (playwrightText !== null) {
    const named = parsePlaywrightJson(playwrightText)
    playbackCount(named, ids)
    playwright = {
      passed: named.filter((item) => item.status === 'pass').length,
      failed: named.filter((item) => item.status === 'fail').length,
      skipped: named.filter((item) => item.status === 'skipped').length,
    }
  }

  const doc = readJsonIfExists<DocLintJson>(path.join(reportDir, 'doc-lint.json'))
  if (doc !== null) {
    for (const check of doc.checks) {
      const id = subIdOf(check.id)
      if (id === null) continue
      mergeStatus(entryFor(ids, id), 'doc', check.passed ? 'pass' : 'fail')
    }
  }

  const gaps = parseVecGaps(readText(repoPath('docs/_work/vector_gaps.md')))
  const layers = parseTestLayers(readText(repoPath('docs/_work/test_layers.md')))
  return { ids, unitTitles, vitestTotals, vec, playwright, doc, gaps, layers }
}

function playbackCount(named: readonly NamedStatus[], ids: Map<string, Evidence>): void {
  for (const item of named) {
    const id = subIdOf(item.name)
    if (id === null) continue
    mergeStatus(entryFor(ids, id), 'e2e', item.status)
  }
}

export type RowVerdict = {
  status: 'pass' | 'partial' | 'failed' | 'pending'
  detail: string
}

/** 单个子行的判定：只有真实执行过且全部通过、缺口也已处置，才算通过 */
export function judgeSubRow(id: string, index: EvidenceIndex): RowVerdict {
  const evidence = index.ids.get(id) ?? emptyEvidence()
  const layers = index.layers.get(id) ?? new Set<string>(['ENGINE'])
  const failures: string[] = []
  const executed: string[] = []
  if (evidence.vector === 'fail') failures.push('向量未通过')
  if (evidence.unit === 'fail') failures.push('单元测试未通过')
  if (evidence.e2e === 'fail') failures.push('端到端未通过')
  if (evidence.doc === 'fail') failures.push('文档检查未通过')
  if (failures.length > 0) return { status: 'failed', detail: failures.join('、') }

  const unexecuted: string[] = []
  if (layers.has('ENGINE')) {
    if (evidence.vector === 'pass') executed.push('向量')
    else if (evidence.vector === 'skipped') {
      executed.push('向量')
      unexecuted.push('向量有登记跳过的断言')
    } else unexecuted.push('向量未执行')
  }
  if (layers.has('NL')) {
    if (evidence.unit === 'pass') executed.push('自然语言单元测试')
    else if (evidence.unit === 'skipped') {
      executed.push('自然语言单元测试')
      unexecuted.push('自然语言单元测试被跳过')
    } else unexecuted.push('自然语言单元测试未执行')
  }
  if (layers.has('UI')) {
    if (evidence.e2e === 'pass') executed.push('端到端')
    else if (evidence.e2e === 'skipped') {
      executed.push('端到端')
      unexecuted.push('端到端被跳过')
    } else unexecuted.push('端到端未执行（前端未交付）')
  }
  if (layers.has('DOC')) {
    if (evidence.doc === 'pass') executed.push('文档检查')
    else unexecuted.push('文档检查未执行')
  }

  const openGaps = index.gaps.filter((row) => row.id === id && row.disposition === 'open')
  const coveredButNotRun = index.gaps.filter(
    (row) => row.id === id && row.disposition === 'covered' && (row.coveredBy === null || !index.unitTitles.has(row.coveredBy)),
  )
  const gapsBlocked = openGaps.length > 0 || coveredButNotRun.length > 0
  const gapNote = '缺口见 vector_gaps'

  if (executed.length === 0 && gapsBlocked) return { status: 'pending', detail: '未执行，缺口见 vector_gaps' }
  if (executed.length === 0) return { status: 'pending', detail: '未执行' }
  if (unexecuted.length === 0 && !gapsBlocked) return { status: 'pass', detail: executed.join('、') }
  const parts = [...unexecuted]
  if (gapsBlocked) parts.push(gapNote)
  return { status: 'partial', detail: parts.join('；') }
}

export type ParentRow = { id: string; children: string[] }

/** 父行的子行清单：把子行编号按前缀归到父行 */
export function parentChildren(ids: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const id of ids) {
    const match = /^(T\d{3})-\d{2}$/.exec(id)
    if (match === null) continue
    const parent = match[1] ?? ''
    const list = map.get(parent) ?? []
    list.push(id)
    map.set(parent, list)
  }
  return map
}

/** 父行规则：子行全部通过才通过；有失败即失败；否则部分覆盖 */
export function judgeParentRow(verdicts: readonly RowVerdict[]): RowVerdict {
  if (verdicts.length === 0) return { status: 'pending', detail: '无子行' }
  if (verdicts.some((item) => item.status === 'failed')) return { status: 'failed', detail: '有子行未通过' }
  if (verdicts.every((item) => item.status === 'pass')) return { status: 'pass', detail: '全部子行通过' }
  if (verdicts.every((item) => item.status === 'pending')) return { status: 'pending', detail: '子行均未执行' }
  return { status: 'partial', detail: '部分子行未完成' }
}
