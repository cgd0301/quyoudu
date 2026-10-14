import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadVectorModules } from '../../scripts/vec.ts'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { doneModules } from '../../src/engine/modules.ts'
import { resultCoreSchema } from '../../src/engine/result.ts'
import { toWire } from '../../src/engine/wire.ts'
import { PathError, resolvePath, type Resolved } from '../lib/path.ts'
import {
  DISPUTES_DOC,
  FIXTURE_VECTORS_DIR,
  GAPS_FILE,
  GOLDEN_VECTORS_DIR,
  LAYERS,
  LAYERS_FILE,
  REPO_ROOT,
  baseTestId,
  checkExpectation,
  disputeMatches,
  expectationProblems,
  isDisputed,
  loadDisputes,
  loadTraceability,
  loadVectorFiles,
  parseLayerTable,
  testIdRows,
  vectorProblems,
  vectorSchema,
  type Expectation,
  type Vector,
} from '../lib/vector.ts'
import { c01 } from './samples.ts'

function readRepo(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

const trace = loadTraceability()
const { dir, files } = loadVectorFiles()
const disputes = loadDisputes()

const vectors: Vector[] = files.flatMap(({ text }) => {
  try {
    const parsed = vectorSchema.safeParse(JSON.parse(text))
    return parsed.success ? [parsed.data] : []
  } catch {
    return []
  }
})

let vectorModules = new Map<string, string>()
let vectorModulesError: string | null = null
try {
  vectorModules = loadVectorModules(REPO_ROOT)
} catch (error) {
  vectorModulesError = error instanceof Error ? error.message : String(error)
}

function isDoneModule(testId: string): boolean {
  const required = vectorModules.get(testId)
  return required !== undefined && doneModules.some((id) => id === required)
}

describe('测试向量结构', () => {
  test('tests/golden/vectors 有 json 时读它，否则读 fixtures/vectors；目录不为空', () => {
    expect([GOLDEN_VECTORS_DIR, FIXTURE_VECTORS_DIR]).toContain(dir)
    expect(files.length).toBeGreaterThan(0)
  })

  test.each(files.map(({ file, text }) => [file, text]))('%s', (file, text) => {
    expect(text.startsWith('\uFEFF'), '文件带 BOM').toBe(false)
    expect(vectorProblems(JSON.parse(text), file, trace)).toEqual([])
  })

  test('分情形的向量不与同号的不分情形向量并存', () => {
    const groups = new Map<string, string[]>()
    for (const { test_id: testId } of vectors) groups.set(baseTestId(testId), [...(groups.get(baseTestId(testId)) ?? []), testId])
    const mixed = [...groups].filter(([testId, ids]) => ids.length > 1 && ids.includes(testId))
    expect(mixed.map(([testId, ids]) => `${testId}：${ids.join('、')}`)).toEqual([])
  })

  test('test_layers.md 覆盖 traceability.csv 全部子用例；向量都对应标为 A4 向量的 ENGINE 行', () => {
    const rows = parseLayerTable(readRepo(LAYERS_FILE))
    const layers: readonly string[] = LAYERS
    expect(rows.filter((row) => !layers.includes(row.layer)).map((row) => `${row.id} ${row.layer}`)).toEqual([])
    const listed = new Set(rows.map((row) => row.id))
    expect([...trace.keys()].filter((id) => !listed.has(id))).toEqual([])
    expect(rows.filter((row) => !trace.has(row.id)).map((row) => row.id)).toEqual([])
    const withVector = new Set(vectors.map((vector) => baseTestId(vector.test_id)))
    const engineA4 = new Set(rows.filter((row) => row.layer === 'ENGINE' && row.coverage.startsWith('A4 向量')).map((row) => row.id))
    expect([...withVector].filter((id) => !engineA4.has(id))).toEqual([])
    expect([...engineA4].filter((id) => !withVector.has(id))).toEqual([])
  })

  test('vector_gaps.md 的编号都在 traceability.csv 中；整行缺口与“A4 不可表达”一一对应，且没有向量', () => {
    const gaps = testIdRows(readRepo(GAPS_FILE))
    expect(gaps.filter(([id = '']) => !trace.has(baseTestId(id))).map(([id]) => id)).toEqual([])
    const wholeRows = gaps.filter(([, text = '']) => text.startsWith('（整行）')).map(([id = '']) => id)
    const notExpressible = parseLayerTable(readRepo(LAYERS_FILE))
      .filter((row) => row.layer === 'ENGINE' && row.coverage.startsWith('A4 不可表达'))
      .map((row) => row.id)
    expect([...wholeRows].sort()).toEqual([...notExpressible].sort())
    const withVector = new Set(vectors.map((vector) => baseTestId(vector.test_id)))
    expect(wholeRows.filter((id) => withVector.has(id))).toEqual([])
  })

  test('vector-disputes.json 每条恰好对应一条现有断言，并登记在 vector_disputes.md', () => {
    const doc = readRepo(DISPUTES_DOC)
    const problems = disputes.flatMap((dispute) => {
      const vector = vectors.find((candidate) => candidate.test_id === dispute.test_id)
      if (vector === undefined) return [`${dispute.test_id}：没有对应的向量`]
      const hits = vector.expect.filter((expectation) => disputeMatches(dispute, vector.test_id, expectation)).length
      return [
        ...(hits === 1 ? [] : [`${dispute.test_id}：${dispute.checkpoint} ${dispute.path} ${dispute.op} 对应 ${hits} 条断言`]),
        ...(doc.includes(dispute.test_id) ? [] : [`${dispute.test_id}：未登记在 vector_disputes.md`]),
      ]
    })
    expect(problems).toEqual([])
  })

  test('每个向量都在 vector-modules.json 中', () => {
    if (vectorModulesError !== null) throw new Error(vectorModulesError)
    const missing = vectors.filter((vector) => !vectorModules.has(vector.test_id)).map((vector) => vector.test_id)
    expect(missing, '这些向量不在 tests/vector-modules.json 中，请先运行 pnpm vector:modules').toEqual([])
  })
})

const found = (value: unknown): Resolved => ({ found: true, value })
const missing: Resolved = { found: false }

function assertion(fields: Record<string, unknown>): Expectation {
  return { checkpoint: 'final', path: 'states.plan_state', ...fields } as Expectation
}

describe('断言语义', () => {
  test('eq：深相等，键的顺序不计，-0 与 0 相同；路径不存在不等', () => {
    expect(checkExpectation(found({ a: 1, b: [2] }), assertion({ op: 'eq', value: { b: [2], a: 1 } }))).toBe(true)
    expect(checkExpectation(found(-0), assertion({ op: 'eq', value: 0 }))).toBe(true)
    expect(checkExpectation(found(null), assertion({ op: 'eq', value: null }))).toBe(true)
    expect(checkExpectation(found(1), assertion({ op: 'eq', value: '1' }))).toBe(false)
    expect(checkExpectation(missing, assertion({ op: 'eq', value: null }))).toBe(false)
  })

  test('not_eq：取反，路径不存在也算不等', () => {
    expect(checkExpectation(found(6000), assertion({ op: 'not_eq', value: 2000 }))).toBe(true)
    expect(checkExpectation(found(2000), assertion({ op: 'not_eq', value: 2000 }))).toBe(false)
    expect(checkExpectation(missing, assertion({ op: 'not_eq', value: 2000 }))).toBe(true)
  })

  test('absent：只有路径不存在才通过，null 不算不存在', () => {
    expect(checkExpectation(missing, assertion({ op: 'absent' }))).toBe(true)
    expect(checkExpectation(found(null), assertion({ op: 'absent' }))).toBe(false)
  })

  test('includes：数组含元素（对象按子集匹配），或字符串含子串', () => {
    expect(checkExpectation(found(['E1', 'E2']), assertion({ op: 'includes', value: 'E2' }))).toBe(true)
    const issues = [{ code: 'CASH_AS_OF_MISMATCH', rule: 'R001', refs: [] }]
    expect(checkExpectation(found(issues), assertion({ op: 'includes', value: { code: 'CASH_AS_OF_MISMATCH' } }))).toBe(true)
    expect(checkExpectation(found(issues), assertion({ op: 'includes', value: { code: 'AS_OF_FORMAT' } }))).toBe(false)
    expect(checkExpectation(found([{ amount: { value: 1, basis: {} } }]), assertion({ op: 'includes', value: { amount: { value: 1 } } }))).toBe(true)
    expect(checkExpectation(found('2026-09-01T09:00:00+08:00'), assertion({ op: 'includes', value: '2026-09-01' }))).toBe(true)
    expect(checkExpectation(found(5), assertion({ op: 'includes', value: 5 }))).toBe(false)
    expect(checkExpectation(missing, assertion({ op: 'includes', value: 'E1' }))).toBe(false)
  })

  test('lte、gte 只比较数字', () => {
    expect(checkExpectation(found(5), assertion({ op: 'lte', value: 5 }))).toBe(true)
    expect(checkExpectation(found(6), assertion({ op: 'lte', value: 5 }))).toBe(false)
    expect(checkExpectation(found(5), assertion({ op: 'gte', value: 6 }))).toBe(false)
    expect(checkExpectation(found('5'), assertion({ op: 'gte', value: 1 }))).toBe(false)
    expect(checkExpectation(missing, assertion({ op: 'gte', value: 1 }))).toBe(false)
  })
})

describe('断言按 ResultCore 校验', () => {
  const labels = ['final']

  test.each([
    ['金额写到 .value', { path: 'nodes[trigger.event_ids=E1].cash.value', op: 'eq', value: 80000 }],
    ['枚举取值', { path: 'states.plan_state', op: 'not_eq', value: 'PAYMENT_GAP' }],
    ['可为 null 的位置写 eq null', { path: 'earliest_gap', op: 'eq', value: null }],
    ['可缺省字段写 absent', { path: 'daily_reference.amount', op: 'absent' }],
    ['选择器之后写 absent', { path: 'nodes[trigger.event_ids=E0]', op: 'absent' }],
    ['标签代码 includes', { path: 'labels', op: 'includes', value: 'CONFIRMED_ONLY' }],
    ['对象子集 includes', { path: 'input_issues', op: 'includes', value: { code: 'CASH_AS_OF_MISMATCH' } }],
    ['选择器字段为点号子路径', { path: 'nodes[trigger.event_ids=E2].unallocated.value', op: 'eq', value: -4000 }],
    ['选择器字段为数组', { path: 'gap_list[related=E1].amount.value', op: 'eq', value: 5000 }],
    ['整数比较', { path: 'optimization.pending_count', op: 'gte', value: 1 }],
  ])('通过：%s', (_name, fields) => {
    expect(expectationProblems(assertion(fields), labels)).toEqual([])
  })

  test.each([
    ['检查点不存在', { checkpoint: 'after', path: 'states.plan_state', op: 'eq', value: 'INCOMPLETE' }],
    ['camelCase 键名', { path: 'dailyReference.display', op: 'eq', value: 'UNAVAILABLE' }],
    ['键名不存在', { path: 'snapshot.balance', op: 'eq', value: 1 }],
    ['金额没写到 .value', { path: 'snapshot.cash', op: 'eq', value: 100000 }],
    ['金额不是整数分', { path: 'snapshot.cash.value', op: 'eq', value: 1000.5 }],
    ['枚举取值不存在', { path: 'states.plan_state', op: 'eq', value: 'FEASIBLE' }],
    ['不可为 null 的位置写 not_eq null', { path: 'states', op: 'not_eq', value: null }],
    ['不会缺省的位置写 absent', { path: 'earliest_gap', op: 'absent' }],
    ['标签代码不存在', { path: 'labels', op: 'includes', value: '历史不足' }],
    ['对象子集的键名不存在', { path: 'input_issues', op: 'includes', value: { reason: 'x' } }],
    ['includes 用在数字上', { path: 'snapshot.cash.value', op: 'includes', value: 1 }],
    ['lte 用在字符串上', { path: 'as_of', op: 'lte', value: 1 }],
    ['选择器字段不存在', { path: 'nodes[event_id=E1].cash.value', op: 'eq', value: 1 }],
    ['下标用在对象上', { path: 'snapshot[0]', op: 'absent' }],
    ['路径语法错误', { path: 'nodes[', op: 'absent' }],
  ])('报告：%s', (_name, fields) => {
    expect(expectationProblems(assertion(fields), labels).length).toBeGreaterThan(0)
  })

  test('向量与 traceability.csv 对照：文件名、rule、source_text、needs_review', () => {
    const row = trace.get('T003-01')
    expect(row).toBeDefined()
    const vector = {
      test_id: 'T003-01',
      rule: 'R003',
      layer: 'ENGINE',
      needs_review: false,
      source_text: row?.expected,
      base: 'c01',
      input: c01(),
      ops: [],
      expect: [{ checkpoint: 'final', path: 'snapshot.cash.value', op: 'eq', value: 100000 }],
    }
    expect(vectorProblems(vector, 'fixtures/vectors/T003-01.json', trace)).toEqual([])
    expect(vectorProblems(vector, 'fixtures/vectors/T003-02.json', trace)).toHaveLength(1)
    expect(vectorProblems({ ...vector, rule: 'R004' }, 'fixtures/vectors/T003-01.json', trace)).toHaveLength(1)
    expect(vectorProblems({ ...vector, source_text: '改写过的预期' }, 'fixtures/vectors/T003-01.json', trace)).toHaveLength(1)
    expect(vectorProblems({ ...vector, needs_review: true }, 'fixtures/vectors/T003-01.json', trace)).toHaveLength(1)
    const reviewRow = trace.get('T003-08')
    const review = { ...vector, test_id: 'T003-08', source_text: reviewRow?.expected, needs_review: true }
    expect(vectorProblems(review, 'fixtures/vectors/T003-08.json', trace)).toEqual([])
    const duplicated = { ...vector, expect: [...vector.expect, ...vector.expect] }
    expect(vectorProblems(duplicated, 'fixtures/vectors/T003-01.json', trace)).toHaveLength(1)
    expect(vectorProblems({ ...vector, input: { cash: 1 } }, 'fixtures/vectors/T003-01.json', trace).length).toBeGreaterThan(0)
  })
})

function checkOne(result: unknown, expectation: Expectation): string[] {
  const label = `${expectation.checkpoint} ${expectation.path} ${expectation.op}${'value' in expectation ? ` ${JSON.stringify(expectation.value)}` : ''}`
  let resolved: Resolved
  try {
    resolved = resolvePath(result, expectation.path)
  } catch (error) {
    if (error instanceof PathError) return [`${label}：${error.message}`]
    throw error
  }
  if (checkExpectation(resolved, expectation)) return []
  return [`${label}：实际为 ${resolved.found ? JSON.stringify(resolved.value) : '不存在'}`]
}

describe('运行已完成模块的向量', () => {
  let skippedAssertions = 0
  let ran = 0

  for (const vector of vectors) {
    test.skipIf(!isDoneModule(vector.test_id))(vector.test_id, () => {
      ran += 1
      const output = evaluate(vector.input, vector.ops, DEMO_CFG_1)
      const results = new Map<string, unknown>()
      for (const checkpoint of output.checkpoints) {
        results.set(checkpoint.label, toWire(resultCoreSchema.parse(checkpoint.result)))
      }
      const failures: string[] = []
      for (const expectation of vector.expect) {
        if (isDisputed(disputes, vector.test_id, expectation)) {
          skippedAssertions += 1
          continue
        }
        const result = results.get(expectation.checkpoint)
        if (result === undefined) failures.push(`缺少检查点 ${expectation.checkpoint}`)
        else failures.push(...checkOne(result, expectation))
      }
      expect(failures).toEqual([])
    })
  }

  // 同一文件内的测试按定义顺序执行，这一条在全部向量之后
  test('汇总：运行的向量数与登记跳过的断言数', () => {
    const selected = vectors.filter((vector) => isDoneModule(vector.test_id)).length
    console.log(
      `测试向量 ${vectors.length} 个，按 doneModules 运行 ${ran} 个；vector-disputes.json 登记跳过 ${skippedAssertions} 条断言`,
    )
    expect(ran).toBe(selected)
  })
})
