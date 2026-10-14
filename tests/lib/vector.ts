/**
 * 测试向量的结构、读取与断言语义（SPEC-GAP SG-35、SG-38）。
 * 向量为 {test_id, rule, layer, needs_review, source_text, base, input, ops, expect}；
 * expect 每项为 {checkpoint, path, op, value}，path 相对该检查点的 result，键名为 toWire() 之后的 snake_case。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { parseCsv } from '../../scripts/lib/csv.ts'
import { FINAL_CHECKPOINT_LABEL, opsSchema, type Op } from '../../src/engine/ops.ts'
import { resultCoreSchema } from '../../src/engine/result.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'
import { toSnakeKey } from '../../src/engine/wire.ts'
import { PathError, parsePath, type PathSegment, type Resolved } from './path.ts'

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const GOLDEN_VECTORS_DIR = 'tests/golden/vectors'
export const FIXTURE_VECTORS_DIR = 'fixtures/vectors'
export const DISPUTES_FILE = 'tests/vector-disputes.json'
export const DISPUTES_DOC = 'docs/_work/vector_disputes.md'
export const TRACEABILITY_FILE = 'docs/traceability.csv'
export const LAYERS_FILE = 'docs/_work/test_layers.md'
export const GAPS_FILE = 'docs/_work/vector_gaps.md'

export const LAYERS = ['ENGINE', 'NL', 'UI', 'DOC'] as const
export const EXPECT_OPS = ['eq', 'not_eq', 'absent', 'includes', 'lte', 'gte'] as const
export type ExpectOp = (typeof EXPECT_OPS)[number]

/** 预期结果以此结尾的子用例，向量 needs_review 为 true */
export const AI_DERIVED_MARK = '（AI推算，H3复核）'

/** 子用例编号，①②③ 分情形的加 #n */
const TEST_ID = /^(T\d{3}-\d{2})(?:#[1-9][0-9]*)?$/

const checkpointSchema = z.string().min(1)
const pathSchema = z.string().min(1)

export const expectationSchema = z.union([
  z.strictObject({ checkpoint: checkpointSchema, path: pathSchema, op: z.literal('absent') }),
  z.strictObject({ checkpoint: checkpointSchema, path: pathSchema, op: z.enum(['eq', 'not_eq', 'includes']), value: z.json() }),
  z.strictObject({ checkpoint: checkpointSchema, path: pathSchema, op: z.enum(['lte', 'gte']), value: z.number() }),
])
export type Expectation = z.infer<typeof expectationSchema>

export const vectorSchema = z.strictObject({
  test_id: z.string().regex(TEST_ID),
  rule: z.string().regex(/^R\d{3}$/),
  layer: z.literal('ENGINE'),
  needs_review: z.boolean(),
  source_text: z.string().min(1),
  base: z.enum(['c00', 'c01']).nullable(),
  input: caseFileSchema,
  ops: opsSchema,
  expect: z.array(expectationSchema).min(1),
})
export type Vector = z.infer<typeof vectorSchema>

/** value 只在同一检查点、路径和 op 下有多条断言时才需要写 */
export const disputesSchema = z.array(
  z.strictObject({
    test_id: z.string().regex(TEST_ID),
    checkpoint: checkpointSchema,
    path: pathSchema,
    op: z.enum(EXPECT_OPS),
    value: z.json().optional(),
  }),
)
export type Dispute = z.infer<typeof disputesSchema>[number]

/** 去掉 #n */
export function baseTestId(testId: string): string {
  return TEST_ID.exec(testId)?.[1] ?? testId
}

function readRepo(root: string, relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function listJson(root: string, dir: string): string[] {
  let entries
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => `${dir}/${name}`)
}

/** tests/golden/vectors 有 json 时读它，否则读 fixtures/vectors */
export function vectorsDir(root = REPO_ROOT): string {
  return listJson(root, GOLDEN_VECTORS_DIR).length > 0 ? GOLDEN_VECTORS_DIR : FIXTURE_VECTORS_DIR
}

export type VectorFile = {
  file: string
  text: string
}

export function loadVectorFiles(root = REPO_ROOT): { dir: string; files: VectorFile[] } {
  const dir = vectorsDir(root)
  return { dir, files: listJson(root, dir).map((file) => ({ file, text: readRepo(root, file) })) }
}

export type TraceRow = {
  rule: string
  expected: string
}

/** traceability.csv 的子用例（编号带“-”），父行不收 */
export function loadTraceability(root = REPO_ROOT): Map<string, TraceRow> {
  const [header, ...rows] = parseCsv(readRepo(root, TRACEABILITY_FILE))
  const ruleColumn = header.indexOf('规则编号')
  const testColumn = header.indexOf('拟建测试')
  const expectedColumn = header.indexOf('预期结果')
  const trace = new Map<string, TraceRow>()
  for (const cells of rows) {
    const testId = cells[testColumn] ?? ''
    if (!testId.includes('-')) continue
    trace.set(testId, { rule: cells[ruleColumn] ?? '', expected: cells[expectedColumn] ?? '' })
  }
  return trace
}

export type LayerRow = {
  id: string
  layer: string
  coverage: string
}

/** Markdown 表格中以 | T 开头的行（首列为测试编号），按单元格切分 */
export function testIdRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| T'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
}

export function parseLayerTable(text: string): LayerRow[] {
  return testIdRows(text).map(([id = '', layer = '', coverage = '']) => ({ id, layer, coverage }))
}

export function loadDisputes(root = REPO_ROOT): Dispute[] {
  return disputesSchema.parse(JSON.parse(readRepo(root, DISPUTES_FILE)))
}

export function disputeMatches(dispute: Dispute, testId: string, expectation: Expectation): boolean {
  return (
    dispute.test_id === testId &&
    dispute.checkpoint === expectation.checkpoint &&
    dispute.path === expectation.path &&
    dispute.op === expectation.op &&
    (dispute.value === undefined || ('value' in expectation && jsonEqual(dispute.value, expectation.value)))
  )
}

export function isDisputed(disputes: readonly Dispute[], testId: string, expectation: Expectation): boolean {
  return disputes.some((dispute) => disputeMatches(dispute, testId, expectation))
}

/** EVALUATE 的 label；ops 中没有 EVALUATE 时只有自动补的 final（§12.6） */
export function checkpointLabels(ops: readonly Op[]): string[] {
  const labels = ops.flatMap((op) => (op.type === 'EVALUATE' ? [op.label] : []))
  return labels.length > 0 ? labels : [FINAL_CHECKPOINT_LABEL]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 经 JSON 往返后比较，-0 与 0 视为相同，键的顺序不计 */
function jsonEqual(actual: unknown, expected: unknown): boolean {
  if (actual === undefined || expected === undefined) return actual === expected
  return isDeepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))
}

/** 对象按子集匹配：只比较模式里写出的键 */
function matchesPattern(actual: unknown, pattern: unknown): boolean {
  if (!isRecord(pattern)) return jsonEqual(actual, pattern)
  return (
    isRecord(actual) &&
    Object.entries(pattern).every(([key, inner]) => Object.hasOwn(actual, key) && matchesPattern(actual[key], inner))
  )
}

/**
 * eq 深相等；not_eq 取反，路径不存在也算不等；absent 要求路径不存在，值为 null 不算不存在；
 * includes 要求数组含某元素（对象按子集匹配）或字符串含子串；lte、gte 只比较数字。
 */
export function checkExpectation(resolved: Resolved, expectation: Expectation): boolean {
  switch (expectation.op) {
    case 'absent':
      return !resolved.found
    case 'eq':
      return resolved.found && jsonEqual(resolved.value, expectation.value)
    case 'not_eq':
      return !(resolved.found && jsonEqual(resolved.value, expectation.value))
    case 'includes': {
      if (!resolved.found) return false
      const actual = resolved.value
      if (Array.isArray(actual)) return actual.some((element) => matchesPattern(element, expectation.value))
      return typeof actual === 'string' && typeof expectation.value === 'string' && actual.includes(expectation.value)
    }
    case 'lte':
      return resolved.found && typeof resolved.value === 'number' && resolved.value <= expectation.value
    case 'gte':
      return resolved.found && typeof resolved.value === 'number' && resolved.value >= expectation.value
  }
}

type AnySchema = z.core.$ZodType

function unwrap(schema: AnySchema): { inner: AnySchema; optional: boolean; nullable: boolean } {
  let inner = schema
  let optional = false
  let nullable = false
  for (;;) {
    if (inner instanceof z.ZodOptional) {
      optional = true
      inner = inner.unwrap()
    } else if (inner instanceof z.ZodNullable) {
      nullable = true
      inner = inner.unwrap()
    } else {
      return { inner, optional, nullable }
    }
  }
}

/** wire 键名（snake_case）对应的字段 */
function fieldOf(schema: AnySchema, wireKey: string): AnySchema | undefined {
  const { inner } = unwrap(schema)
  if (!(inner instanceof z.ZodObject)) return undefined
  const shape: Record<string, AnySchema> = inner.shape
  const key = Object.keys(shape).find((name) => toSnakeKey(name) === wireKey)
  return key === undefined ? undefined : shape[key]
}

export type SchemaTarget = {
  schema: AnySchema
  /** 路径经过可缺省字段、下标或选择器，absent 才有意义 */
  canBeMissing: boolean
}

/** 按 resultCoreSchema 走一遍路径，确认每个键名存在 */
export function resolveResultSchema(
  segments: readonly PathSegment[],
): { ok: true; target: SchemaTarget } | { ok: false; reason: string } {
  let schema: AnySchema = resultCoreSchema
  let canBeMissing = false
  for (const segment of segments) {
    const { inner, optional, nullable } = unwrap(schema)
    if (optional || nullable) canBeMissing = true
    if (segment.kind === 'key') {
      const next = fieldOf(inner, segment.key)
      if (next === undefined) return { ok: false, reason: `键名 ${segment.key} 不在 ResultCore 的该位置（应为 toWire 之后的 snake_case）` }
      schema = next
      continue
    }
    if (!(inner instanceof z.ZodArray)) return { ok: false, reason: '下标或选择器只能用在数组上' }
    const element: AnySchema = inner.element
    if (segment.kind === 'select') {
      for (const condition of segment.conditions) {
        let field: AnySchema | undefined = element
        for (const key of condition.field) field = field === undefined ? undefined : fieldOf(field, key)
        if (field === undefined) return { ok: false, reason: `选择器字段 ${condition.field.join('.')} 不在数组元素中` }
      }
    }
    canBeMissing = true
    schema = element
  }
  return { ok: true, target: { schema, canBeMissing: canBeMissing || unwrap(schema).optional } }
}

function toCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())
}

/** 把断言值里的 snake_case 键名转回 camelCase，再按 resultCoreSchema 校验 */
function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [toCamelKey(key), fromWire(inner)]))
  return value
}

function valueFits(schema: AnySchema, value: unknown): boolean {
  return z.safeParse(schema, fromWire(value)).success
}

function patternProblems(schema: AnySchema, pattern: unknown): string[] {
  const { inner } = unwrap(schema)
  if (!isRecord(pattern) || !(inner instanceof z.ZodObject)) {
    return valueFits(schema, pattern) ? [] : [`值 ${JSON.stringify(pattern)} 不符合数组元素的类型`]
  }
  return Object.entries(pattern).flatMap(([key, value]) => {
    const field = fieldOf(inner, key)
    return field === undefined ? [`键名 ${key} 不在数组元素中`] : patternProblems(field, value)
  })
}

/** 单条断言：检查点存在、路径能在 ResultCore 中走通、值符合该位置的类型（金额为整数分、枚举在取值内） */
export function expectationProblems(expectation: Expectation, labels: readonly string[]): string[] {
  const where = `${expectation.checkpoint} ${expectation.path} ${expectation.op}`
  const problems: string[] = []
  if (!labels.includes(expectation.checkpoint)) problems.push(`${where}：检查点 ${expectation.checkpoint} 不在 ops 的 EVALUATE 中`)
  let segments: PathSegment[]
  try {
    segments = parsePath(expectation.path)
  } catch (error) {
    if (error instanceof PathError) return [...problems, `${where}：${error.message}`]
    throw error
  }
  const resolved = resolveResultSchema(segments)
  if (!resolved.ok) return [...problems, `${where}：${resolved.reason}`]
  const { schema, canBeMissing } = resolved.target
  const { inner } = unwrap(schema)
  switch (expectation.op) {
    case 'absent':
      if (!canBeMissing) problems.push(`${where}：该位置不会缺省，判断 null 应写 eq null`)
      break
    case 'eq':
    case 'not_eq':
      if (!valueFits(schema, expectation.value)) {
        problems.push(`${where}：值 ${JSON.stringify(expectation.value)} 不符合该位置的类型（金额写到 .value，取整数分）`)
      }
      break
    case 'includes':
      if (inner instanceof z.ZodArray) {
        problems.push(...patternProblems(inner.element, expectation.value).map((problem) => `${where}：${problem}`))
      } else if (!(inner instanceof z.ZodString) || typeof expectation.value !== 'string') {
        problems.push(`${where}：includes 只用于数组，或字符串含子串`)
      }
      break
    case 'lte':
    case 'gte':
      if (!(inner instanceof z.ZodNumber) || !valueFits(inner, expectation.value)) {
        problems.push(`${where}：lte、gte 只比较整数`)
      }
      break
  }
  return problems
}

/** 向量结构问题；trace 为 traceability.csv 的子用例 */
export function vectorProblems(data: unknown, file: string, trace: ReadonlyMap<string, TraceRow>): string[] {
  const parsed = vectorSchema.safeParse(data)
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `schema ${issue.path.map(String).join('.')}：${issue.message}`)
  }
  const vector = parsed.data
  const problems: string[] = []
  const name = path.basename(file, '.json')
  if (name !== vector.test_id) problems.push(`文件名 ${name} 与 test_id ${vector.test_id} 不一致`)
  const testId = baseTestId(vector.test_id)
  const row = trace.get(testId)
  if (row === undefined) {
    problems.push(`traceability.csv 中没有子用例 ${testId}`)
  } else {
    if (vector.rule !== row.rule) problems.push(`rule 应为 ${row.rule}，实际为 ${vector.rule}`)
    if (vector.source_text !== row.expected) problems.push('source_text 与 traceability.csv 该行“预期结果”不一致')
    const review = row.expected.endsWith(AI_DERIVED_MARK)
    if (vector.needs_review !== review) problems.push(`needs_review 应为 ${String(review)}`)
  }
  const evaluateLabels = vector.ops.flatMap((op) => (op.type === 'EVALUATE' ? [op.label] : []))
  if (new Set(evaluateLabels).size !== evaluateLabels.length) problems.push('EVALUATE 的 label 重复')
  const labels = checkpointLabels(vector.ops)
  const seen = new Set<string>()
  for (const expectation of vector.expect) {
    const value = 'value' in expectation ? expectation.value : null
    const key = JSON.stringify([expectation.checkpoint, expectation.path, expectation.op, value])
    if (seen.has(key)) problems.push(`断言重复：${expectation.checkpoint} ${expectation.path} ${expectation.op}`)
    seen.add(key)
    problems.push(...expectationProblems(expectation, labels))
  }
  return problems
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
