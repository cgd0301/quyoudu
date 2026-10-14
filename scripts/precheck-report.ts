/**
 * pnpm precheck
 * 由 .cache/precheck.json、.cache/oracle-out 和 python -m oracle unit 生成 docs/_work/precheck_report.md。
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pythonCmd } from './lib/py.ts'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DISTINCT_LIMIT = 20
const LOCATION_LIMIT = 20
const INDEX = /^(0|[1-9]\d*)$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/

export type PrecheckAssertion = {
  testId: string
  checkpoint: string
  path: string
  op: string
  expected: string
  actual: string
  status: 'pass' | 'fail' | 'skipped'
}

export type PrecheckSummary = {
  vectorsPassed: number
  vectorsTotal: number
  assertionsPassed: number
  assertionsTotal: number
  assertionsSkipped: number
  runErrors: number
}

export type RunError = {
  testId: string
  message: string
}

type PrecheckFile = {
  summary: PrecheckSummary
  stale: string[]
  assertions: PrecheckAssertion[]
  runErrors: RunError[]
}

export type FailureSample = {
  testId: string
  checkpoint: string
  expected: string
  actual: string
}

export type FailureGroup = {
  signature: string
  count: number
  vectors: string[]
  samples: FailureSample[]
}

export type UnitVerdict = '一致' | '不一致' | '未能核对'

export type UnitCheck = {
  caseId: string
  item: string
  verdict: UnitVerdict
  note: string
}

export type Located = {
  source: string
  checkpoint: string
  text: string
}

export type CountedValue = {
  value: string
  count: number
  shape: string
}

export type FieldFacts = {
  present: number
  missing: number
  values: CountedValue[]
  shapes: { value: string; count: number }[] | null
  examples: Located[]
}

export type PresenceFacts = {
  missing: number
  empty: number
  nonempty: number
  compositions: { value: string; count: number }[]
  examples: Located[]
  locations: Located[] | null
}

export type OracleCheckpoint = {
  source: string
  label: string
  result: Record<string, unknown>
}

export type Observations = {
  checkpoints: number
  nodeAt: FieldFacts
  checkStart: FieldFacts
  candidatePlanVersion: FieldFacts
  candidatesMissing: number
  confirmationNull: number
  confirmationMissing: number
  confirmationOther: number
  confirmationPlanVersion: FieldFacts
  topKMissingCheckpoints: number
  allRanks: FieldFacts
  outsideRank: FieldFacts
  candidateOrders: Located[]
  candidateOrderCheckpoints: number
  forecasts: PresenceFacts
  scenarios: PresenceFacts
  labelsWithSimulated: number
  labelsWithoutSimulated: number
  labelsMissing: number
  labelExamplesWith: Located[]
  labelExamplesWithout: Located[]
  labelValues: FieldFacts
}

const UNIT_ITEMS = [
  ['T020-01', 'l3=11740'],
  ['T020-01', 'b3=788'],
  ['T020-01', 'h=2 预测 12874.72 取整为 12875'],
  ['T020-01', '第3笔一步误差 -300'],
  ['T007-05', '4999.500000000000 得 5000'],
  ['T007-05', '4999.499999999999 得 4999'],
  ['T020-11', '0.1234567890125 得 0.123456789013'],
  ['T020-11', '-0.1234567890125 得 -0.123456789013'],
  ['T020-11', '12874.72 得 12875'],
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAssertionStatus(value: unknown): value is PrecheckAssertion['status'] {
  return value === 'pass' || value === 'fail' || value === 'skipped'
}

function byCountThenText(a: { count: number; value: string }, b: { count: number; value: string }): number {
  if (b.count !== a.count) return b.count - a.count
  if (a.value < b.value) return -1
  if (a.value > b.value) return 1
  return 0
}

export function assertionSignature(pathText: string, op: string): string {
  const normalized = pathText.replace(/\[[^\]]*\]/g, (bracket) => {
    const inner = bracket.slice(1, -1)
    if (INDEX.test(inner)) return '[#]'
    const eq = inner.indexOf('=')
    if (eq >= 0) return `[${inner.slice(0, eq)}=*]`
    return bracket
  })
  return `${normalized} ${op}`
}

export function sampleLine(sample: FailureSample): string {
  const cell = (text: string) => text.replace(/\r?\n/g, ' ')
  return `${sample.testId}｜${sample.checkpoint}｜${cell(sample.expected)}｜${cell(sample.actual)}`
}

export function groupFailures(assertions: readonly PrecheckAssertion[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>()
  for (const row of assertions) {
    if (row.status !== 'fail') continue
    const signature = assertionSignature(row.path, row.op)
    let group = groups.get(signature)
    if (group === undefined) {
      group = { signature, count: 0, vectors: [], samples: [] }
      groups.set(signature, group)
    }
    group.count += 1
    if (!group.vectors.includes(row.testId)) group.vectors.push(row.testId)
    if (group.samples.length < 3) {
      group.samples.push({
        testId: row.testId,
        checkpoint: row.checkpoint,
        expected: row.expected,
        actual: row.actual,
      })
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0))
}

export function multiHitCount(assertions: readonly PrecheckAssertion[]): number {
  return assertions.filter((row) => row.actual === '选择器多命中').length
}

export function staleMessage(stale: readonly string[]): string | null {
  if (stale.length === 0) return null
  return `oracle 输入与记录指纹不一致：${[...stale].sort().join('、')}`
}

function canonNumber(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return null
    return String(value)
  }
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null
  const negative = value.startsWith('-')
  const body = negative ? value.slice(1) : value
  const [intPart, frac = ''] = body.split('.')
  const trimmed = frac.replace(/0+$/, '')
  const normalized = trimmed === '' ? intPart : `${intPart}.${trimmed}`
  if (negative && normalized !== '0') return `-${normalized}`
  return normalized
}

function blankChecks(note: string): UnitCheck[] {
  return UNIT_ITEMS.map(([caseId, item]) => ({ caseId, item, verdict: '未能核对', note }))
}

function fieldVerdict(actual: unknown, expected: string, field: string): { verdict: UnitVerdict; note: string } | null {
  const got = canonNumber(actual)
  const want = canonNumber(expected)
  if (got === null || want === null) return { verdict: '未能核对', note: `字段 ${field} 不是十进制数` }
  if (got === want) return null
  return { verdict: '不一致', note: `${field} oracle 为 ${JSON.stringify(actual)}，追溯表为 ${expected}` }
}

function matchFields(
  record: Record<string, unknown> | null,
  missingNote: string,
  pairs: readonly { field: string; expected: string }[],
): { verdict: UnitVerdict; note: string } {
  if (record === null) return { verdict: '未能核对', note: missingNote }
  const notes: string[] = []
  let missing = false
  let mismatch = false
  for (const pair of pairs) {
    if (!Object.hasOwn(record, pair.field)) {
      missing = true
      notes.push(`缺少字段 ${pair.field}`)
      continue
    }
    const judged = fieldVerdict(record[pair.field], pair.expected, pair.field)
    if (judged === null) notes.push(`${pair.field} oracle 为 ${JSON.stringify(record[pair.field])}`)
    else {
      notes.push(judged.note)
      if (judged.verdict === '不一致') mismatch = true
      else missing = true
    }
  }
  const verdict: UnitVerdict = mismatch ? '不一致' : missing ? '未能核对' : '一致'
  return { verdict, note: notes.join('；') }
}

function findRow(rows: unknown[] | null, caseId: string, input: string): { row: Record<string, unknown> } | { note: string } {
  if (rows === null) return { note: `输出中没有 ${caseId}` }
  const want = canonNumber(input)
  if (want === null) return { note: `输入 ${input} 不是十进制数` }
  const hits: Record<string, unknown>[] = []
  for (const row of rows) {
    if (!isRecord(row) || !Object.hasOwn(row, 'input')) continue
    if (canonNumber(row.input) === want) hits.push(row)
  }
  if (hits.length === 0) return { note: `输出中没有 input=${input}` }
  if (hits.length > 1) return { note: `input=${input} 命中 ${hits.length} 条` }
  const row = hits[0]
  if (row === undefined) return { note: `输出中没有 input=${input}` }
  return { row }
}

function rowCheck(caseId: string, item: string, rows: unknown[] | null, input: string, field: string, expected: string): UnitCheck {
  const found = findRow(rows, caseId, input)
  if ('note' in found) return { caseId, item, verdict: '未能核对', note: found.note }
  const judged = matchFields(found.row, `输出中没有 ${caseId}`, [{ field, expected }])
  return { caseId, item, ...judged }
}

export function compareUnit(stdout: string): UnitCheck[] {
  let data: unknown
  try {
    data = JSON.parse(stdout.replace(/^\uFEFF/, ''))
  } catch {
    return blankChecks('输出不是 JSON')
  }
  if (!isRecord(data)) return blankChecks('输出不是 JSON 对象')
  const t02001 = isRecord(data['T020-01']) ? data['T020-01'] : null
  const t007 = Array.isArray(data['T007-05']) ? data['T007-05'] : null
  const t02011 = Array.isArray(data['T020-11']) ? data['T020-11'] : null
  const block = (item: string, pairs: readonly { field: string; expected: string }[]): UnitCheck => ({
    caseId: 'T020-01',
    item,
    ...matchFields(t02001, '输出中没有 T020-01', pairs),
  })
  return [
    block('l3=11740', [{ field: 'l3', expected: '11740' }]),
    block('b3=788', [{ field: 'b3', expected: '788' }]),
    block('h=2 预测 12874.72 取整为 12875', [
      { field: 'forecast_h2', expected: '12874.72' },
      { field: 'integer_cents', expected: '12875' },
    ]),
    block('第3笔一步误差 -300', [{ field: 'third_one_step_error', expected: '-300' }]),
    rowCheck('T007-05', '4999.500000000000 得 5000', t007, '4999.500000000000', 'integer_cents', '5000'),
    rowCheck('T007-05', '4999.499999999999 得 4999', t007, '4999.499999999999', 'integer_cents', '4999'),
    rowCheck('T020-11', '0.1234567890125 得 0.123456789013', t02011, '0.1234567890125', 'rounded_12', '0.123456789013'),
    rowCheck('T020-11', '-0.1234567890125 得 -0.123456789013', t02011, '-0.1234567890125', 'rounded_12', '-0.123456789013'),
    rowCheck('T020-11', '12874.72 得 12875', t02011, '12874.72', 'integer_cents', '12875'),
  ]
}

export function checksForUnitRun(status: number | null, stdout: string, stderr: string): { checks: UnitCheck[]; raw: string } {
  const raw = stderr.trim() === '' ? stdout : `${stdout}${stdout.endsWith('\n') || stdout === '' ? '' : '\n'}${stderr}`
  if (status !== 0) return { checks: blankChecks(`退出码 ${status ?? '未知'}`), raw }
  return { checks: compareUnit(stdout), raw: stdout }
}

type Bucket = {
  present: number
  missing: number
  order: string[]
  rows: Map<string, { count: number; shape: string; samples: Located[] }>
}

function createBucket(): Bucket {
  return { present: 0, missing: 0, order: [], rows: new Map() }
}

function timeShape(value: unknown): string {
  if (typeof value !== 'string') return '非字符串'
  if (DATE_ONLY.test(value)) return 'YYYY-MM-DD'
  if (ISO_OFFSET.test(value)) return 'YYYY-MM-DDTHH:mm:ss+08:00'
  return '其他'
}

function addValue(bucket: Bucket, value: unknown, sample: Located, classifyTime: boolean): void {
  bucket.present += 1
  const key = JSON.stringify(value)
  const shape = classifyTime ? timeShape(value) : key
  let row = bucket.rows.get(key)
  if (row === undefined) {
    row = { count: 0, shape, samples: [] }
    bucket.rows.set(key, row)
    bucket.order.push(key)
  }
  row.count += 1
  if (row.samples.length < 3) row.samples.push(sample)
}

function pickExamples(bucket: Bucket): Located[] {
  const picked: Located[] = []
  const seenShape = new Set<string>()
  const rows = bucket.order.map((key) => {
    const row = bucket.rows.get(key)
    if (row === undefined) throw new Error(`内部错误：缺少取值 ${key}`)
    return row
  })
  for (const row of rows) {
    if (seenShape.has(row.shape)) continue
    const sample = row.samples[0]
    if (sample === undefined) continue
    seenShape.add(row.shape)
    picked.push(sample)
    if (picked.length === 3) return picked
  }
  for (const row of rows) {
    for (const sample of row.samples) {
      if (picked.includes(sample)) continue
      picked.push(sample)
      if (picked.length === 3) return picked
    }
  }
  return picked
}

function finishBucket(bucket: Bucket, classifyTime: boolean): FieldFacts {
  const values = bucket.order.map((key) => {
    const row = bucket.rows.get(key)
    if (row === undefined) throw new Error(`内部错误：缺少取值 ${key}`)
    return { value: key, count: row.count, shape: row.shape }
  })
  let shapes: { value: string; count: number }[] | null = null
  if (classifyTime) {
    const counts = new Map<string, number>()
    for (const item of values) counts.set(item.shape, (counts.get(item.shape) ?? 0) + item.count)
    shapes = [...counts.entries()].map(([value, count]) => ({ value, count })).sort(byCountThenText)
  }
  return {
    present: bucket.present,
    missing: bucket.missing,
    values: [...values].sort(byCountThenText),
    shapes,
    examples: pickExamples(bucket),
  }
}

type PresenceBuilder = {
  missing: number
  empty: number
  nonempty: number
  order: string[]
  compositions: Map<string, { count: number; sample: Located }>
  locations: Located[]
}

function createPresence(): PresenceBuilder {
  return { missing: 0, empty: 0, nonempty: 0, order: [], compositions: new Map(), locations: [] }
}

function addPresent(builder: PresenceBuilder, detail: string, sample: Located): void {
  builder.nonempty += 1
  builder.locations.push(sample)
  let composition = builder.compositions.get(detail)
  if (composition === undefined) {
    composition = { count: 0, sample }
    builder.compositions.set(detail, composition)
    builder.order.push(detail)
  }
  composition.count += 1
}

function finishPresence(builder: PresenceBuilder): PresenceFacts {
  const examples: Located[] = []
  for (const key of builder.order) {
    const composition = builder.compositions.get(key)
    if (composition === undefined) continue
    examples.push(composition.sample)
    if (examples.length === 3) break
  }
  for (const located of builder.locations) {
    if (examples.length === 3) break
    if (!examples.includes(located)) examples.push(located)
  }
  return {
    missing: builder.missing,
    empty: builder.empty,
    nonempty: builder.nonempty,
    compositions: builder.order
      .map((key) => {
        const composition = builder.compositions.get(key)
        return composition === undefined ? null : { value: key, count: composition.count }
      })
      .filter((item): item is { value: string; count: number } => item !== null)
      .sort(byCountThenText),
    examples,
    locations: builder.locations.length <= LOCATION_LIMIT ? builder.locations : null,
  }
}

function noteArray(builder: PresenceBuilder, value: unknown, detail: (items: unknown[]) => string, sampleFor: (text: string) => Located): void {
  if (!Array.isArray(value)) {
    builder.missing += 1
    return
  }
  if (value.length === 0) {
    builder.empty += 1
    return
  }
  const text = detail(value)
  addPresent(builder, text, sampleFor(text))
}

function forecastDetail(items: unknown[]): string {
  const statuses = new Map<string, number>()
  for (const item of items) {
    const status = isRecord(item) && typeof item.status === 'string' ? item.status : JSON.stringify(isRecord(item) ? item.status : item)
    statuses.set(status, (statuses.get(status) ?? 0) + 1)
  }
  const brief = [...statuses.entries()].map(([status, count]) => `${status}×${count}`).join('，')
  return `长度 ${items.length}；status ${brief}`
}

function scenarioDetail(items: unknown[]): string {
  const parts = items.map((item) => {
    if (!isRecord(item)) return JSON.stringify(item)
    return `${String(item.kind)} available=${String(item.available)}`
  })
  return `长度 ${items.length}；${parts.join('，')}`
}

function located(source: string, checkpoint: string, text: string): Located {
  return { source, checkpoint, text }
}

export function collectObservations(checkpoints: readonly OracleCheckpoint[]): Observations {
  const nodeAt = createBucket()
  const checkStart = createBucket()
  const candidatePlanVersion = createBucket()
  const confirmationPlanVersion = createBucket()
  const allRanks = createBucket()
  const outsideRank = createBucket()
  const labelValues = createBucket()
  const forecasts = createPresence()
  const scenarios = createPresence()
  let candidatesMissing = 0
  let confirmationNull = 0
  let confirmationMissing = 0
  let confirmationOther = 0
  let topKMissingCheckpoints = 0
  let candidateOrderCheckpoints = 0
  const candidateOrders: Located[] = []
  let labelsWithSimulated = 0
  let labelsWithoutSimulated = 0
  let labelsMissing = 0
  const labelExamplesWith: Located[] = []
  const labelExamplesWithout: Located[] = []

  for (const checkpoint of checkpoints) {
    const { source, label, result } = checkpoint
    if (!Array.isArray(result.nodes)) nodeAt.missing += 1
    else {
      for (const node of result.nodes) {
        if (!isRecord(node) || !Object.hasOwn(node, 'at')) nodeAt.missing += 1
        else addValue(nodeAt, node.at, located(source, label, JSON.stringify(node.at)), true)
      }
    }
    if (!isRecord(result.check_period) || !Object.hasOwn(result.check_period, 'start')) checkStart.missing += 1
    else addValue(checkStart, result.check_period.start, located(source, label, JSON.stringify(result.check_period.start)), true)

    const topK = isRecord(result.optimization) && typeof result.optimization.top_k === 'number' ? result.optimization.top_k : null
    if (topK === null) topKMissingCheckpoints += 1
    if (!Array.isArray(result.candidates)) candidatesMissing += 1
    else {
      if (result.candidates.length > 1) {
        candidateOrderCheckpoints += 1
        if (candidateOrders.length < 3) {
          const text = result.candidates
            .map((candidate) => {
              if (!isRecord(candidate)) return JSON.stringify(candidate)
              const id = typeof candidate.candidate_id === 'string' ? candidate.candidate_id : '缺candidate_id'
              const rankText = Object.hasOwn(candidate, 'rank') ? JSON.stringify(candidate.rank) : '缺字段'
              return `${id} rank=${rankText}`
            })
            .join('，')
          candidateOrders.push(located(source, label, text))
        }
      }
      for (const candidate of result.candidates) {
        if (!isRecord(candidate)) {
          candidatePlanVersion.missing += 1
          allRanks.missing += 1
          outsideRank.missing += 1
          continue
        }
        const id = typeof candidate.candidate_id === 'string' ? candidate.candidate_id : '缺candidate_id'
        if (!Object.hasOwn(candidate, 'plan_version')) candidatePlanVersion.missing += 1
        else addValue(candidatePlanVersion, candidate.plan_version, located(source, label, JSON.stringify(candidate.plan_version)), false)
        if (!Object.hasOwn(candidate, 'rank')) {
          allRanks.missing += 1
          addValue(outsideRank, '缺字段', located(source, label, `candidate_id=${id} rank=缺字段 top_k=${JSON.stringify(topK)}`), false)
          continue
        }
        addValue(allRanks, candidate.rank, located(source, label, JSON.stringify(candidate.rank)), false)
        const rank = candidate.rank
        const beyond = typeof rank === 'number' && topK !== null && rank > topK
        if (rank === null || beyond) {
          addValue(outsideRank, rank, located(source, label, `candidate_id=${id} rank=${JSON.stringify(rank)} top_k=${JSON.stringify(topK)}`), false)
        }
      }
    }

    if (!Object.hasOwn(result, 'confirmation')) confirmationMissing += 1
    else if (result.confirmation === null) confirmationNull += 1
    else if (!isRecord(result.confirmation)) confirmationOther += 1
    else if (!Object.hasOwn(result.confirmation, 'plan_version')) confirmationPlanVersion.missing += 1
    else {
      addValue(
        confirmationPlanVersion,
        result.confirmation.plan_version,
        located(source, label, JSON.stringify(result.confirmation.plan_version)),
        false,
      )
    }

    const sampleFor = (text: string) => located(source, label, text)
    if (!Object.hasOwn(result, 'forecasts')) forecasts.missing += 1
    else noteArray(forecasts, result.forecasts, forecastDetail, sampleFor)
    if (!Object.hasOwn(result, 'scenarios')) scenarios.missing += 1
    else noteArray(scenarios, result.scenarios, scenarioDetail, sampleFor)

    if (!Array.isArray(result.labels)) labelsMissing += 1
    else {
      const text = JSON.stringify(result.labels)
      const sample = located(source, label, text)
      addValue(labelValues, result.labels, sample, false)
      if (result.labels.includes('SIMULATED_DATA')) {
        labelsWithSimulated += 1
        if (labelExamplesWith.length < 3) labelExamplesWith.push(sample)
      } else {
        labelsWithoutSimulated += 1
        if (labelExamplesWithout.length < 3) labelExamplesWithout.push(sample)
      }
    }
  }

  return {
    checkpoints: checkpoints.length,
    nodeAt: finishBucket(nodeAt, true),
    checkStart: finishBucket(checkStart, true),
    candidatePlanVersion: finishBucket(candidatePlanVersion, false),
    candidatesMissing,
    confirmationNull,
    confirmationMissing,
    confirmationOther,
    confirmationPlanVersion: finishBucket(confirmationPlanVersion, false),
    topKMissingCheckpoints,
    allRanks: finishBucket(allRanks, false),
    outsideRank: finishBucket(outsideRank, false),
    candidateOrders,
    candidateOrderCheckpoints,
    forecasts: finishPresence(forecasts),
    scenarios: finishPresence(scenarios),
    labelsWithSimulated,
    labelsWithoutSimulated,
    labelsMissing,
    labelExamplesWith,
    labelExamplesWithout,
    labelValues: finishBucket(labelValues, false),
  }
}

function fence(text: string): string {
  const body = text.endsWith('\n') ? text : `${text}\n`
  const mark = body.includes('```') ? '~~~~' : '```'
  return `${mark}\n${body}${mark}`
}

function exampleLines(examples: readonly Located[]): string[] {
  if (examples.length === 0) return ['  - 无']
  return examples.map((example) => `  - ${example.source}｜${example.checkpoint}｜${example.text}`)
}

function fieldLines(title: string, facts: FieldFacts, extra: readonly string[] = []): string[] {
  const lines = [`### ${title}`, '', `- 出现次数：${facts.present}；缺失：${facts.missing}；不同取值：${facts.values.length}`]
  if (facts.shapes !== null) {
    lines.push(`- 形态：${facts.shapes.map((item) => `${item.value} × ${item.count}`).join('；')}`)
    const others = facts.values.filter((item) => item.shape === '其他' || item.shape === '非字符串')
    if (others.length > 0) lines.push(`- 其他原文：${others.map((item) => `${item.value} × ${item.count}`).join('；')}`)
  }
  if (facts.values.length <= DISTINCT_LIMIT) {
    lines.push(`- 取值：${facts.values.map((item) => `${item.value} × ${item.count}`).join('；')}`)
  }
  lines.push(...extra, '- 样例：', ...exampleLines(facts.examples), '')
  return lines
}

function presenceLines(title: string, facts: PresenceFacts): string[] {
  const lines = [
    `### ${title}`,
    '',
    `- 键缺失或不是数组：${facts.missing}`,
    `- 空数组：${facts.empty}`,
    `- 非空：${facts.nonempty}`,
  ]
  if (facts.compositions.length > 0 && facts.compositions.length <= DISTINCT_LIMIT) {
    lines.push(`- 非空构成：${facts.compositions.map((item) => `${item.value} × ${item.count}`).join('；')}`)
  }
  const shown = facts.locations ?? facts.examples
  if (facts.locations === null) lines.push(`- 非空位置共 ${facts.nonempty} 处，下列 ${shown.length} 处`)
  lines.push('- 样例：', ...exampleLines(shown), '')
  return lines
}

export function renderReport(input: {
  summary: PrecheckSummary
  groups: readonly FailureGroup[]
  runErrors: readonly RunError[]
  multiHits: number
  unitStatus: number | null
  checks: readonly UnitCheck[]
  unitRaw: string
  observations: Observations
}): string {
  const { summary, observations } = input
  const lines = [
    '# 向量预检报告',
    '',
    '## 总体',
    '',
    `- 向量通过数：${summary.vectorsPassed}／${summary.vectorsTotal}`,
    `- 断言通过数：${summary.assertionsPassed}／${summary.assertionsTotal}（跳过 ${summary.assertionsSkipped}）`,
    `- 运行错误数：${summary.runErrors}`,
    `- 选择器多命中数：${input.multiHits}`,
  ]
  if (input.runErrors.length === 0) lines.push('- 运行错误：无')
  else {
    lines.push('- 运行错误：')
    for (const error of input.runErrors) lines.push(`  - ${error.testId}｜${error.message.replace(/\r?\n/g, ' ')}`)
  }
  lines.push('', '## 失败分组', '', `共 ${input.groups.length} 组。`, '')
  if (input.groups.length === 0) lines.push('无失败断言。', '')
  input.groups.forEach((group, index) => {
    lines.push(
      `### 组 ${index + 1}`,
      '',
      `- 签名：\`${group.signature}\``,
      `- 失败断言数：${group.count}`,
      `- 涉及向量：${group.vectors.join('、')}`,
      '- 样例：',
      ...group.samples.map((sample) => `  - ${sampleLine(sample)}`),
      '',
    )
  })
  lines.push('## 单元核对', '', `- 退出码：${input.unitStatus ?? '未知'}`)
  for (const check of input.checks) lines.push(`- ${check.caseId}｜${check.item}｜${check.verdict}｜${check.note}`)
  lines.push('', '### 原始输出', '', fence(input.unitRaw.trim() === '' ? '（空）' : input.unitRaw), '')
  lines.push(
    '## 约定观察',
    '',
    `检查点 ${observations.checkpoints} 个，来自 .cache/oracle-out 的 cases 与 vectors。`,
    '',
    ...fieldLines('nodes[].at', observations.nodeAt),
    ...fieldLines('check_period.start', observations.checkStart),
    ...fieldLines('candidates[].plan_version', observations.candidatePlanVersion, [
      `- candidates 缺失或不是数组的检查点：${observations.candidatesMissing}`,
    ]),
    ...fieldLines('confirmation.plan_version', observations.confirmationPlanVersion, [
      `- confirmation 为 null：${observations.confirmationNull}`,
      `- confirmation 缺少：${observations.confirmationMissing}`,
      `- confirmation 不是对象也不是 null：${observations.confirmationOther}`,
    ]),
    ...fieldLines('不在前 K 名的候选的 rank', observations.outsideRank, [
      '- 统计范围：rank 为 null、缺字段，或大于该检查点 optimization.top_k 的数字',
      `- top_k 不是数字的检查点：${observations.topKMissingCheckpoints}`,
    ]),
    ...fieldLines('candidates[].rank（全部）', observations.allRanks),
    '### candidates[] 的排列顺序',
    '',
    `- 候选数大于 1 的检查点：${observations.candidateOrderCheckpoints}`,
    '- 样例：',
    ...exampleLines(observations.candidateOrders),
    '',
    ...presenceLines('forecasts', observations.forecasts),
    ...presenceLines('scenarios', observations.scenarios),
    '### labels 是否含 SIMULATED_DATA',
    '',
    `- 含 SIMULATED_DATA：${observations.labelsWithSimulated}`,
    `- 不含 SIMULATED_DATA：${observations.labelsWithoutSimulated}`,
    `- labels 缺失或不是数组：${observations.labelsMissing}`,
    '- 样例（含）：',
    ...exampleLines(observations.labelExamplesWith),
    '- 样例（不含）：',
    ...exampleLines(observations.labelExamplesWithout),
    '',
    ...fieldLines('labels 取值', observations.labelValues),
  )
  return `${lines.join('\n').trimEnd()}\n`
}

function readCount(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`precheck.json 的 ${key} 不是整数`)
  return value
}

function parsePrecheck(text: string): PrecheckFile {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data) || !isRecord(data.summary) || !Array.isArray(data.stale) || !Array.isArray(data.assertions) || !Array.isArray(data.runErrors)) {
    throw new Error('precheck.json 结构不符')
  }
  if (!data.stale.every((item) => typeof item === 'string')) throw new Error('precheck.json 的 stale 格式不符')
  const assertions = data.assertions.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.testId !== 'string' ||
      typeof item.checkpoint !== 'string' ||
      typeof item.path !== 'string' ||
      typeof item.op !== 'string' ||
      typeof item.expected !== 'string' ||
      typeof item.actual !== 'string' ||
      !isAssertionStatus(item.status)
    ) {
      throw new Error('precheck.json 的断言格式不符')
    }
    return {
      testId: item.testId,
      checkpoint: item.checkpoint,
      path: item.path,
      op: item.op,
      expected: item.expected,
      actual: item.actual,
      status: item.status,
    }
  })
  const runErrors = data.runErrors.map((item) => {
    if (!isRecord(item) || typeof item.testId !== 'string' || typeof item.message !== 'string') {
      throw new Error('precheck.json 的运行错误格式不符')
    }
    return { testId: item.testId, message: item.message }
  })
  return {
    summary: {
      vectorsPassed: readCount(data.summary, 'vectorsPassed'),
      vectorsTotal: readCount(data.summary, 'vectorsTotal'),
      assertionsPassed: readCount(data.summary, 'assertionsPassed'),
      assertionsTotal: readCount(data.summary, 'assertionsTotal'),
      assertionsSkipped: readCount(data.summary, 'assertionsSkipped'),
      runErrors: readCount(data.summary, 'runErrors'),
    },
    stale: data.stale.filter((item): item is string => typeof item === 'string'),
    assertions,
    runErrors,
  }
}

export function checkpointsFrom(source: string, data: unknown): OracleCheckpoint[] {
  if (!isRecord(data) || !Array.isArray(data.checkpoints)) throw new Error(`${source} 缺少 checkpoints`)
  return data.checkpoints.map((checkpoint, index) => {
    if (!isRecord(checkpoint) || typeof checkpoint.label !== 'string' || !isRecord(checkpoint.result)) {
      throw new Error(`${source} 第 ${index + 1} 个检查点格式不符`)
    }
    return { source, label: checkpoint.label, result: checkpoint.result }
  })
}

async function loadCheckpoints(repoRoot: string): Promise<OracleCheckpoint[]> {
  const checkpoints: OracleCheckpoint[] = []
  for (const kind of ['cases', 'vectors'] as const) {
    const dir = path.join(repoRoot, '.cache', 'oracle-out', kind)
    const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()
    for (const name of names) {
      const source = `${kind}/${name}`
      checkpoints.push(...checkpointsFrom(source, JSON.parse(await readFile(path.join(dir, name), 'utf8'))))
    }
  }
  return checkpoints
}

function runUnit(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(pythonCmd, ['-m', 'oracle', 'unit'], {
    cwd,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  let stderr = typeof result.stderr === 'string' ? result.stderr : ''
  if (stderr === '' && result.error instanceof Error) stderr = result.error.message
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr,
  }
}

async function main(): Promise<number> {
  const precheck = parsePrecheck(await readFile(path.join(root, '.cache', 'precheck.json'), 'utf8'))
  const stale = staleMessage(precheck.stale)
  if (stale !== null) {
    console.error(stale)
    return 1
  }
  const unit = runUnit(root)
  const interpreted = checksForUnitRun(unit.status, unit.stdout, unit.stderr)
  const report = renderReport({
    summary: precheck.summary,
    groups: groupFailures(precheck.assertions),
    runErrors: precheck.runErrors,
    multiHits: multiHitCount(precheck.assertions),
    unitStatus: unit.status,
    checks: interpreted.checks,
    unitRaw: interpreted.raw,
    observations: collectObservations(await loadCheckpoints(root)),
  })
  const reportPath = path.join(root, 'docs', '_work', 'precheck_report.md')
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, report, 'utf8')
  const headline = report.split('\n').find((line) => line.startsWith('- 向量通过数'))
  console.log(headline ?? '已写入 docs/_work/precheck_report.md')
  return 0
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
