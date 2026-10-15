import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { compareCandidates } from '../../src/engine/compare/index.ts'
import { DEMO_CFG_1, type EngineConfig } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { normalize } from '../../src/engine/normalize/index.ts'
import { opsSchema, type Op } from '../../src/engine/ops/index.ts'
import { priceCandidates } from '../../src/engine/pricing/index.ts'
import type { ResultCore } from '../../src/engine/result.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import { buildSnapshot } from '../../src/engine/snapshot/index.ts'
import { REPO_ROOT } from '../lib/vector.ts'
import { c01 } from './samples.ts'

type Row = ResultCore['candidates'][number]
type Item = CaseFile['candidates'][number]['items'][number]
type OptimizationState = ResultCore['states']['optimizationState']

function loadVector(id: string): { input: CaseFile; ops: Op[] } {
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/vectors', `${id}.json`), 'utf8')) as {
    input: unknown
    ops: unknown
  }
  return { input: caseFileSchema.parse(raw.input), ops: opsSchema.parse(raw.ops) }
}

function run(data: CaseFile, ops: readonly Op[] = [], config: EngineConfig = DEMO_CFG_1): ResultCore {
  const result = evaluate(data, ops, config).checkpoints.at(-1)?.result
  if (result === undefined) throw new Error('没有检查点')
  return result
}

function checkpoint(data: CaseFile, ops: readonly Op[], label: string): ResultCore {
  const result = evaluate(data, ops, DEMO_CFG_1).checkpoints.find((item) => item.label === label)?.result
  if (result === undefined) throw new Error(`没有检查点 ${label}`)
  return result
}

function candidate(result: ResultCore, id: string): Row {
  const row = result.candidates.find((item) => item.candidateId === id)
  if (row === undefined) throw new Error(`没有候选 ${id}`)
  return row
}

function codes(reasons: readonly { code: string }[]): string[] {
  return reasons.map((reason) => reason.code)
}

function rankedRows(result: ResultCore): Row[] {
  return result.candidates.filter((row) => row.rank !== null).sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))
}

/** 按 rank 排列的推荐 */
function ranked(result: ResultCore): string[] {
  return rankedRows(result).map((row) => row.candidateId)
}

function exclusionsOf(result: ResultCore): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const row of result.candidates) {
    if (row.excludedReasons.length > 0) out.set(row.candidateId, codes(row.excludedReasons).sort())
  }
  return out
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

type Plain = { id: string; net: number }

function byNetThenId(left: Plain, right: Plain): number {
  if (left.net !== right.net) return left.net - right.net
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function lexLess(left: readonly string[], right: readonly string[]): boolean {
  for (let index = 0; index < left.length && index < right.length; index += 1) {
    const a = left[index] ?? ''
    const b = right[index] ?? ''
    if (a !== b) return a < b
  }
  return left.length < right.length
}

/** 穷举全部 min(K, n) 元子集：总额最小者胜，同额取排序后编号序列较小者；选中的再按净支出、编号排列 */
function enumerateTopK(rows: readonly Plain[], topK: number): string[] {
  const size = Math.min(topK, rows.length)
  let best: Plain[] = []
  let bestTotal = Number.POSITIVE_INFINITY
  let bestIds: string[] = []
  for (let mask = 0; mask < 2 ** rows.length; mask += 1) {
    const picked = rows.filter((_row, index) => ((mask >> index) & 1) === 1)
    if (picked.length !== size) continue
    const total = picked.reduce((sum, row) => sum + row.net, 0)
    const ids = picked.map((row) => row.id).sort()
    if (total < bestTotal || (total === bestTotal && lexLess(ids, bestIds))) {
      best = picked
      bestTotal = total
      bestIds = ids
    }
  }
  return [...best].sort(byNetThenId).map((row) => row.id)
}

type Enumerated = {
  feasible: string[]
  pending: string[]
  excluded: Map<string, string[]>
  top: string[]
  samePrice: boolean
  state: OptimizationState
}

/**
 * 独立复算（R016 第1、4、6条，§3，§10.4），只适用于：没有事件和优惠，候选没有返还，A0=0，
 * 预留都已建立，没有相容约束。此时 P=0，净支出为价格项之和；价格项是仅有的流出，
 * 最低的 U = 现金 − 预留合计 − 净支出。
 */
function enumerateCase(data: CaseFile, topK: number): Enumerated {
  const goal = data.goal
  expect(data.events).toEqual([])
  expect(data.offers).toEqual([])
  expect(data.snapshot.goal_allocation).toBe(0)
  expect(data.reserves.every((reserve) => reserve.funding_event_id === undefined)).toBe(true)
  expect([goal.arrive_before_show_min, goal.return_after_show_min, goal.lodging_nights_required, goal.seat_tier_allowed]).toEqual([
    null,
    null,
    null,
    null,
  ])
  expect([goal.lodging_max_distance_m, goal.refundable_required]).toEqual([null, null])
  const budget = goal.budget_cap
  const cash = data.snapshot.cash
  if (budget == null || cash == null) throw new Error('需要现金和预算')
  const headroom = cash - data.reserves.reduce((sum, reserve) => sum + reserve.amount, 0)
  const seen = new Set<string>()
  const feasible: Plain[] = []
  const pending: string[] = []
  const excluded = new Map<string, string[]>()
  for (const row of data.candidates) {
    expect(row.offers_used).toEqual([])
    expect(row.returns).toEqual([])
    const reasons: string[] = []
    const key = JSON.stringify(row.items)
    if (seen.has(key)) reasons.push('DUPLICATE_CANDIDATE')
    seen.add(key)
    const prices = row.items.map((item) => item.price)
    const net = prices.every((price) => price !== null) ? prices.reduce<number>((sum, price) => sum + (price ?? 0), 0) : null
    if (net !== null && headroom - net < 0) reasons.push('PAYMENT_GAP')
    if (net !== null && net > budget) reasons.push('BUDGET_EXCEEDED')
    if (reasons.length > 0) excluded.set(row.candidate_id, reasons.sort())
    else if (net === null) pending.push(row.candidate_id)
    else feasible.push({ id: row.candidate_id, net })
  }
  const nets = feasible.map((row) => row.net)
  let state: OptimizationState = 'NO_KNOWN_FEASIBLE'
  if (pending.length > 0) state = 'PARTIALLY_EVALUABLE'
  else if (feasible.length > 0) state = 'COMPLETED_FEASIBLE'
  return {
    feasible: feasible.map((row) => row.id),
    pending,
    excluded,
    top: enumerateTopK(feasible, topK),
    samePrice: new Set(nets).size < nets.length,
    state,
  }
}

/** T016-04 的资金：C0=3000、L0=300、M0=200、A0=0，B=1000；每个候选一笔 9/10 的高铁付款 */
const BASE = loadVector('T016-04').input

const TEMPLATE: Item = (() => {
  const item = BASE.candidates[0]?.items[0]
  if (item === undefined) throw new Error('T016-04 没有价格项')
  return item
})()

type Draft = {
  kind: 'quote' | 'pending' | 'dup'
  price: number
  target: number
}

const draftsArb = fc.array(
  fc.record({
    kind: fc.constantFrom<Draft['kind']>('quote', 'quote', 'quote', 'pending', 'dup'),
    price: fc.constantFrom(80000, 85000, 86000, 87000, 90000, 100000, 100001, 120000),
    target: fc.nat({ max: 6 }),
  }),
  { minLength: 1, maxLength: 7 },
)

const topKArb = fc.integer({ min: 1, max: 5 })

/** 重复记录照抄此前某个已报价候选的全部价格项；其余候选各用一个渠道 */
function buildCase(drafts: readonly Draft[]): CaseFile {
  const data = structuredClone(BASE)
  data.candidates = []
  drafts.forEach((draft, index) => {
    const id = `C${String(index + 1).padStart(2, '0')}`
    const quoted = data.candidates.filter((row) => row.items.every((item) => item.price !== null))
    const original = quoted[draft.target % Math.max(1, quoted.length)]
    if (draft.kind === 'dup' && original !== undefined) {
      data.candidates.push({ ...structuredClone(original), candidate_id: id })
      return
    }
    const pending = draft.kind === 'pending'
    const item: Item = {
      ...structuredClone(TEMPLATE),
      channel: `渠道${index + 1}`,
      price: pending ? null : draft.price,
      price_basis: pending ? 'PENDING' : 'QUOTE',
    }
    data.candidates.push({ candidate_id: id, items: [item], offers_used: [], returns: [] })
  })
  return data
}

describe('R016 完整购买组合与 Top-K', () => {
  test('T016-01 逐项低价但组合不相容的方案被排除，推荐 C02', () => {
    const result = run(loadVector('T016-01').input)
    const early = candidate(result, 'C01')
    expect(codes(early.excludedReasons)).toContain('ARRIVAL_TOO_LATE')
    expect(early).toMatchObject({ feasible: false, rank: null })
    expect(candidate(result, 'C02').rank).toBe(1)
    expect(ranked(result)).toEqual(['C02'])
  })

  test('T016-02 优惠超出使用次数的候选排除；C03 的预计消费净支出 = 860 + 20', () => {
    const result = run(loadVector('T016-02').input)
    const over = candidate(result, 'C02')
    expect(codes(over.excludedReasons)).toContain('OFFER_MAX_USES_EXCEEDED')
    expect(over).toMatchObject({ feasible: false, rank: null })
    expect(candidate(result, 'C03').netSpend?.value).toBe(86000 + 2000)
  })

  test('T016-03 预计消费净支出 = 580 + 450 = 1030 > B，按预算排除，不能只用 450 与 B 比较', () => {
    const data = loadVector('T016-03').input
    const result = run(data)
    const row = candidate(result, 'C04')
    expect(row.netSpend?.value).toBe(58000 + 45000)
    expect(row).toMatchObject({ evaluable: true, feasible: false, rank: null })
    const budget = row.excludedReasons.find((reason) => reason.code === 'BUDGET_EXCEEDED')
    expect(budget).toBeDefined()
    expect(budget?.refs).toContain('E0')
    expect(45000).toBeLessThanOrEqual(data.goal.budget_cap ?? 0)
    expect(ranked(result)).toEqual([])
  })

  test('T016-04 K=3 时返回 C02（850）、C04（860）、C03（870），并显示 K=3（演示配置v1）', () => {
    const result = run(loadVector('T016-04').input)
    expect(ranked(result)).toEqual(['C02', 'C04', 'C03'])
    expect(rankedRows(result).map((row) => row.netSpend?.value)).toEqual([85000, 86000, 87000])
    expect(candidate(result, 'C01').rank).toBeNull()
    expect(candidate(result, 'C05').rank).toBeNull()
    expect(result.topKLabel).toBe('K=3（演示配置v1）')
    expect(result.optimization.topK).toBe(3)
    expect(result.labels.slice(0, 2)).toEqual(['SIMULATED_DATA', 'TOP_K_DEMO'])
  })

  test('T016-05 C03—C05 按预算排除，只返回 C01、C02，不凑满 3 个', () => {
    const result = run(loadVector('T016-05').input)
    expect(ranked(result)).toEqual(['C01', 'C02'])
    for (const id of ['C03', 'C04', 'C05']) {
      expect(codes(candidate(result, id).excludedReasons)).toContain('BUDGET_EXCEEDED')
      expect(candidate(result, id)).toMatchObject({ feasible: false, rank: null })
    }
    expect(result.states.optimizationState).toBe('COMPLETED_FEASIBLE')
  })

  test('T016-06 全部按预算排除时不推荐任何方案，优化状态为未找到已知可行方案', () => {
    const result = run(loadVector('T016-06').input)
    expect(ranked(result)).toEqual([])
    for (const row of result.candidates) expect(codes(row.excludedReasons)).toContain('BUDGET_EXCEEDED')
    expect(result.states.optimizationState).toBe('NO_KNOWN_FEASIBLE')
    expect(result.optimization).toMatchObject({ evaluatedCount: 0, pendingCount: 0, excludedCount: 3 })
  })

  test('T016-07 末位同价按编号升序截取，不因同价返回第 4 个', () => {
    const result = run(loadVector('T016-07').input)
    expect(ranked(result)).toEqual(['C01', 'C02', 'C03'])
    expect(candidate(result, 'C04').rank).toBeNull()
    expect(candidate(result, 'C05').rank).toBeNull()
    expect(result.labels).toContain('SAME_PRICE')
  })

  test('T016-08 重复记录不计入结果，只返回 C01、C02，不凑满 3 个', () => {
    const result = run(loadVector('T016-08').input)
    const copy = candidate(result, 'C05')
    expect(codes(copy.excludedReasons)).toContain('DUPLICATE_CANDIDATE')
    expect(copy).toMatchObject({ feasible: false, rank: null, tieGroup: null })
    expect(ranked(result)).toEqual(['C01', 'C02'])
    expect(result.labels).not.toContain('SAME_PRICE')
  })

  test('T016-09 只对数据列出的候选校验、排除和排序，不生成新候选，编号沿用数据', () => {
    const data = loadVector('T016-09').input
    const ids = data.candidates.map((row) => row.candidate_id)
    expect(ids).toEqual(['C01', 'C02', 'C03'])
    const result = run(data)
    expect(result.candidates.map((row) => row.candidateId)).toEqual(ids)
    expect(result.optimization.scope).toEqual(ids)
  })

  test('R016 第1条 候选缺少必要项目时计入待确认数，不按 0 元计算', () => {
    const data = loadVector('T016-02').input
    const first = data.candidates[0]
    if (first === undefined) throw new Error('没有候选')
    first.items = first.items.filter((item) => item.cost_item_id !== 'LODGING')
    const row = candidate(run(data), 'C01')
    expect(row.pendingReasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRICE_PENDING', refs: ['LODGING'] })]))
    expect(row).toMatchObject({ evaluable: false, feasible: null, netSpend: null, rank: null })
  })

  test('R016 第5条 K 不是正整数时不输出正式 Top-K', () => {
    const data = loadVector('T016-04').input
    for (const topK of [0, -1]) {
      const result = run(data, [], { ...DEMO_CFG_1, topK })
      expect(result.candidates.every((row) => row.rank === null)).toBe(true)
    }
    expect(ranked(run(data, [], { ...DEMO_CFG_1, topK: 2 }))).toEqual(['C02', 'C04'])
  })

  test('R016 异常 共同资金或预算缺失时停止依赖它的完整判断', () => {
    const edits: ((data: CaseFile) => void)[] = [
      (data) => {
        data.snapshot.cash = null
      },
      (data) => {
        data.goal.budget_cap = null
      },
    ]
    for (const edit of edits) {
      const data = loadVector('T016-04').input
      edit(data)
      const result = run(data)
      for (const row of result.candidates) {
        expect(codes(row.pendingReasons)).toContain('SHARED_INPUT_INCOMPLETE')
        expect(row).toMatchObject({ evaluable: false, feasible: null, netSpend: null, rank: null })
      }
      expect(result.states.optimizationState).toBe('PARTIALLY_EVALUABLE')
      expect(result.optimization.pendingCount).toBe(data.candidates.length)
    }
  })

  test('T008-02 非人民币报价的候选计入待确认数，不污染其他人民币候选', () => {
    const data = loadVector('T008-02').input
    const result = run(data)
    const foreign = candidate(result, 'C02')
    expect(codes(foreign.pendingReasons)).toContain('NON_CNY')
    expect(foreign).toMatchObject({ evaluable: false, netSpend: null, rank: null })
    const local = candidate(result, 'C01')
    expect(local.evaluable).toBe(true)
    expect(local.pendingReasons).toEqual([])
    const alone = structuredClone(data)
    alone.candidates = alone.candidates.filter((row) => row.candidate_id === 'C01')
    expect(candidate(run(alone), 'C01')).toEqual(local)
    expect(result.optimization.pendingCount).toBe(1)
  })

  test('D54 候选付款时间早于 as_of 时计入待确认数，其他候选照常排序', () => {
    const data = loadVector('T016-04').input
    const item = data.candidates[0]?.items[0]
    if (item === undefined) throw new Error('没有价格项')
    item.purchase_date = '2026-09-01'
    item.payment_at = '2026-09-01T08:00:00+08:00'
    const result = run(data)
    expect(codes(candidate(result, 'C01').pendingReasons)).toContain('PAYMENT_TIME_MISSING')
    expect(candidate(result, 'C01')).toMatchObject({ evaluable: false, feasible: null, rank: null })
    expect(ranked(result)).toEqual(['C02', 'C04', 'C03'])
  })
})

describe('R011 比较覆盖范围与优化状态', () => {
  test('T010-04 部分可评估：C01 照常评估并可推荐，C02 计入待确认数', () => {
    const result = run(loadVector('T010-04').input)
    expect(candidate(result, 'C01')).toMatchObject({ evaluable: true, feasible: true, rank: 1 })
    const pending = candidate(result, 'C02')
    expect(codes(pending.pendingReasons)).toContain('PRICE_PENDING')
    expect(pending).toMatchObject({ evaluable: false, feasible: null, netSpend: null, tieGroup: null, rank: null })
    expect(result.states.optimizationState).toBe('PARTIALLY_EVALUABLE')
    expect(result.optimization).toMatchObject({ scope: ['C01', 'C02'], evaluatedCount: 1, pendingCount: 1, excludedCount: 0 })
  })

  test('T011-03 部分可评估时结论限于已评估子集，不宣称全部已知候选最低，也不宣称无解', () => {
    const result = run(loadVector('T011-03').input)
    expect(result.states.optimizationState).toBe('PARTIALLY_EVALUABLE')
    expect(candidate(result, 'C01')).toMatchObject({ feasible: true, rank: 1 })
    expect(candidate(result, 'C01').netSpend?.value).toBe(85000)
    expect(candidate(result, 'C02')).toMatchObject({ evaluable: false, feasible: null, rank: null })
  })

  test('T011-01 每个候选在独立分支里检查付款节点：C01 有保护性资金缺口而排除，推荐 C02（850）', () => {
    const { input, ops } = loadVector('T011-01')
    const compared = checkpoint(input, ops, '比较')
    const gap = candidate(compared, 'C01')
    expect(gap).toMatchObject({ evaluable: true, feasible: false, rank: null })
    expect(gap.excludedReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PAYMENT_GAP', refs: expect.arrayContaining(['PLAN:C01:0:TICKET']) })]),
    )
    expect(candidate(compared, 'C02')).toMatchObject({ evaluable: true, feasible: true, rank: 1 })
    expect(candidate(compared, 'C02').netSpend?.value).toBe(85000)
    expect(ranked(compared)).toEqual(['C02'])
    expect(compared.optimization.topK).toBe(3)
    expect(compared.nodes.some((node) => node.trigger.eventIds.some((id) => id.startsWith('PLAN:')))).toBe(false)
    const selectedC01 = checkpoint(input, ops, 'C01')
    const selectedC02 = checkpoint(input, ops, 'C02')
    expect(selectedC01.candidates).toEqual(compared.candidates)
    expect(selectedC02.candidates).toEqual(compared.candidates)
    expect(selectedC01.states.planState).toBe('PAYMENT_GAP')
    expect(selectedC02.states.planState).toBe('FEASIBLE_UNDER_ASSUMPTIONS')
  })

  test('T011-02 两个候选都有保护性资金缺口时不推荐，优化状态为未找到已知可行方案', () => {
    const { input, ops } = loadVector('T011-02')
    const compared = checkpoint(input, ops, '比较')
    for (const id of ['C01', 'C03']) {
      expect(codes(candidate(compared, id).excludedReasons)).toContain('PAYMENT_GAP')
      expect(candidate(compared, id).rank).toBeNull()
    }
    expect(ranked(compared)).toEqual([])
    expect(compared.states.optimizationState).toBe('NO_KNOWN_FEASIBLE')
    expect(compared.optimization).toMatchObject({ evaluatedCount: 0, pendingCount: 0, excludedCount: 2 })
  })

  test('R011 仍有候选待确认时，不宣称全部已知候选均不可行', () => {
    const data = loadVector('T011-02').input
    const source = data.candidates[0]
    if (source === undefined) throw new Error('没有候选')
    const unknown = structuredClone(source)
    unknown.candidate_id = 'C04'
    for (const item of unknown.items) {
      item.price = null
      item.price_basis = 'PENDING'
    }
    data.candidates.push(unknown)
    const result = run(data)
    expect(candidate(result, 'C04')).toMatchObject({ evaluable: false, feasible: null, rank: null })
    expect(result.states.optimizationState).toBe('PARTIALLY_EVALUABLE')
    expect(result.optimization).toMatchObject({ pendingCount: 1, excludedCount: 2 })
  })

  test('R011、§11.2 已确定排除的候选即使仍有待确认信息也计入确定排除，只列排除原因（SG-60、SG-61）', () => {
    const data = loadVector('T016-01').input
    const late = data.candidates[0]?.items[0]
    if (late === undefined) throw new Error('没有价格项')
    late.price = null
    late.price_basis = 'PENDING'
    const result = run(data)
    const row = candidate(result, 'C01')
    expect(codes(row.excludedReasons)).toEqual(['ARRIVAL_TOO_LATE'])
    expect(row.pendingReasons).toEqual([])
    expect(row).toMatchObject({ evaluable: true, feasible: false, netSpend: null, rank: null })
    expect(result.optimization).toMatchObject({ evaluatedCount: 1, pendingCount: 0, excludedCount: 1 })
    expect(result.states.optimizationState).toBe('COMPLETED_FEASIBLE')
    expect(ranked(result)).toEqual(['C02'])
  })

  test('T011-05 已确认的合格预测参与比较，C01 是唯一可行候选并列出该预测估算', () => {
    const { input, ops } = loadVector('T011-05')
    const result = run(input, ops)
    expect(candidate(result, 'C01')).toMatchObject({ evaluable: true, feasible: true, rank: 1 })
    expect(ranked(result)).toEqual(['C01'])
    expect(result.states.optimizationState).toBe('COMPLETED_FEASIBLE')
    expect(result.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'CONFIRMED_FORECAST', refs: ['LODGING'] })]))
  })

  test('T012-01 结果只含 C01、C02，取消不是候选', () => {
    const result = run(loadVector('T012-01').input)
    expect(result.candidates.map((row) => row.candidateId)).toEqual(['C01', 'C02'])
    expect(result.optimization.scope).toEqual(['C01', 'C02'])
    expect([...ranked(result)].sort()).toEqual(['C01', 'C02'])
  })

  test('T007-06#2 渠道舍入规则未知时，依赖该优惠的候选计入待确认数', () => {
    const result = run(loadVector('T007-06#2').input)
    const row = candidate(result, 'C01')
    expect(codes(row.pendingReasons)).toContain('ROUNDING_UNKNOWN')
    expect(row).toMatchObject({ evaluable: false, feasible: null, netSpend: null, rank: null })
    expect(result.optimization.pendingCount).toBe(1)
  })

  test('T009-07 住宿保持待填，依赖它的候选计入待确认数，不按 0 元计算', () => {
    const { input, ops } = loadVector('T009-07')
    const result = run(input, ops)
    const row = candidate(result, 'C01')
    expect(codes(row.pendingReasons)).toContain('PRICE_PENDING')
    expect(row).toMatchObject({ evaluable: false, netSpend: null, rank: null })
    expect(result.cost.pendingCostItemIds).toContain('LODGING')
    expect(result.optimization.pendingCount).toBe(1)
  })

  test('D13、D43 预测不可用时按参考价 600 估算参与比较；没有参考价的保持待填', () => {
    const reference = loadVector('T020-08#1')
    const result = run(reference.input, reference.ops)
    const row = candidate(result, 'C01')
    expect(row).toMatchObject({ evaluable: true, feasible: true, rank: 1 })
    expect(row.netSpend?.value).toBe(60000)
    expect(result.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ESTIMATE', refs: ['LODGING'] })]))
    const missing = loadVector('T020-08#2')
    const pending = candidate(run(missing.input, missing.ops), 'C01')
    expect(codes(pending.pendingReasons)).toContain('PRICE_PENDING')
    expect(pending).toMatchObject({ evaluable: false, netSpend: null, rank: null })
  })

  test('T013-05 带模拟标识并通过确定性校验的报价可以进入计算', () => {
    const { input, ops } = loadVector('T013-05')
    const result = run(input, ops)
    expect(candidate(result, 'C01').evaluable).toBe(true)
    expect(result.labels).toContain('SIMULATED_DATA')
  })

  test('T015-06 不为凑满减加入非必要项目，460 不享受满减', () => {
    const result = run(loadVector('T015-06').input)
    expect(result.candidates).toHaveLength(1)
    expect(candidate(result, 'C01').netSpend?.value).toBe(46000)
  })

  test('没有候选时优化状态为未比较（SG-61）', () => {
    const result = run(c01())
    expect(result.candidates).toEqual([])
    expect(result.optimization).toEqual({ scope: [], evaluatedCount: 0, pendingCount: 0, excludedCount: 0, topK: 3 })
    expect(result.states.optimizationState).toBe('NOT_COMPARED')
  })
})

describe('向量缺口', () => {
  test('T009-01 gap 关键报价失效时停止完整判断，不自动降为估算', () => {
    const data = loadVector('T009-01').input
    const expired = priceCandidates(normalize(data)).find((row) => row.candidateId === 'C02')
    expect(expired?.items[0]?.priceBasis).toBe('QUOTE')
    expect(expired?.items[0]?.estimate).toBe(false)
    expect(expired?.items[0]?.payment).toBeNull()
    const result = run(data)
    const row = candidate(result, 'C02')
    expect(codes(row.pendingReasons)).toContain('QUOTE_EXPIRED')
    expect(row).toMatchObject({ evaluable: false, feasible: null, netSpend: null, tieGroup: null, rank: null })
    expect(candidate(result, 'C01').evaluable).toBe(true)
    expect(result.states.optimizationState).toBe('PARTIALLY_EVALUABLE')
    expect(result.optimization.pendingCount).toBe(1)
  })

  test('T016-07 gap C03 与 C04 同属一个同价组', () => {
    const result = run(loadVector('T016-07').input)
    const c03 = candidate(result, 'C03')
    const c04 = candidate(result, 'C04')
    expect(c03.tieGroup).not.toBeNull()
    expect(c04.tieGroup).toBe(c03.tieGroup)
    expect(c04.netSpend?.value).toBe(c03.netSpend?.value)
    expect(candidate(result, 'C02').tieGroup).not.toBe(c03.tieGroup)
    expect(c03.rank).toBe(3)
    expect(c04.rank).toBeNull()
  })

  test('T011-04 gap 独立穷举复算与程序排序一致：可行集合、排除原因和前 3 名顺序', () => {
    for (const id of ['T016-04', 'T016-05', 'T016-06', 'T016-07', 'T016-08']) {
      const data = loadVector(id).input
      const expected = enumerateCase(data, 3)
      const result = run(data)
      expect(
        result.candidates.filter((row) => row.feasible === true).map((row) => row.candidateId),
        id,
      ).toEqual(expected.feasible)
      expect(exclusionsOf(result), id).toEqual(expected.excluded)
      expect(ranked(result), id).toEqual(expected.top)
    }
    expect(enumerateCase(loadVector('T016-04').input, 3).top).toEqual(['C02', 'C04', 'C03'])
  })
})

describe('性质', () => {
  test('返回数不超过 K，rank 从 1 起连续', () => {
    fc.assert(
      fc.property(draftsArb, topKArb, (drafts, topK) => {
        const result = run(buildCase(drafts), [], { ...DEMO_CFG_1, topK })
        const ranks = result.candidates.flatMap((row) => (row.rank === null ? [] : [row.rank])).sort((a, b) => a - b)
        expect(ranks.length).toBeLessThanOrEqual(topK)
        expect(ranks).toEqual(ranks.map((_rank, index) => index + 1))
      }),
    )
  })

  test('推荐按预计消费净支出非降序，同价按编号升序', () => {
    fc.assert(
      fc.property(draftsArb, topKArb, (drafts, topK) => {
        const rows = rankedRows(run(buildCase(drafts), [], { ...DEMO_CFG_1, topK }))
        for (let index = 1; index < rows.length; index += 1) {
          const before = rows[index - 1]
          const after = rows[index]
          if (before === undefined || after === undefined) continue
          const left = before.netSpend?.value ?? Number.NaN
          const right = after.netSpend?.value ?? Number.NaN
          expect(left).toBeLessThanOrEqual(right)
          if (left === right) expect(before.candidateId < after.candidateId).toBe(true)
        }
      }),
    )
  })

  test('与独立穷举一致：可行集合、排除原因、前 K 名、同价组、计数与优化状态', () => {
    fc.assert(
      fc.property(draftsArb, topKArb, (drafts, topK) => {
        const data = buildCase(drafts)
        const expected = enumerateCase(data, topK)
        const result = run(data, [], { ...DEMO_CFG_1, topK })
        expect(result.candidates.filter((row) => row.feasible === true).map((row) => row.candidateId)).toEqual(expected.feasible)
        expect(result.candidates.filter((row) => row.feasible === null).map((row) => row.candidateId)).toEqual(expected.pending)
        expect(exclusionsOf(result)).toEqual(expected.excluded)
        expect(ranked(result)).toEqual(expected.top)
        for (const left of result.candidates) {
          if (left.feasible !== true) {
            expect(left.tieGroup).toBeNull()
            continue
          }
          expect(left.tieGroup).not.toBeNull()
          for (const right of result.candidates) {
            if (right.feasible !== true) continue
            expect(left.tieGroup === right.tieGroup).toBe(left.netSpend?.value === right.netSpend?.value)
          }
        }
        expect(result.labels.includes('SAME_PRICE')).toBe(expected.samePrice)
        expect(result.optimization).toMatchObject({
          evaluatedCount: expected.feasible.length,
          pendingCount: expected.pending.length,
          excludedCount: expected.excluded.size,
        })
        expect(result.states.optimizationState).toBe(expected.state)
      }),
    )
  })

  test('候选分支不改输入，也不改主记录：选中某候选时与只含该候选的案例相同', () => {
    fc.assert(
      fc.property(draftsArb, fc.nat(), (drafts, pick) => {
        const data = buildCase(drafts)
        const target = data.candidates[pick % data.candidates.length]?.candidate_id ?? 'C01'
        const ops: Op[] = [{ type: 'SELECT_CANDIDATE', candidate_id: target }]
        const full = run(deepFreeze(structuredClone(data)), ops)
        const alone = structuredClone(data)
        alone.candidates = alone.candidates.filter((row) => row.candidate_id === target)
        const single = run(alone, ops)
        expect(full.inputIssues).toEqual(single.inputIssues)
        expect(full.nodes).toEqual(single.nodes)
        expect(full.earliestGap).toEqual(single.earliestGap)
        expect(full.gapList).toEqual(single.gapList)
        expect(full.constraintIssues).toEqual(single.constraintIssues)
        expect(full.cost).toEqual(single.cost)
        expect(full.dependencies).toEqual(single.dependencies)
        expect(full.states.planState).toBe(single.states.planState)
      }),
      { numRuns: 50 },
    )
  })

  test('compareCandidates 是纯函数：深冻结输入后运行不报错，两次结果相同', () => {
    for (const id of ['T010-04', 'T011-01', 'T016-07']) {
      const data = loadVector(id).input
      const normalized = normalize(data)
      const input = deepFreeze({
        raw: data,
        data: normalized,
        priced: priceCandidates(normalized),
        opIssues: [],
        snapshot: buildSnapshot(normalized),
        topK: 3,
      })
      const first = compareCandidates(input)
      expect(compareCandidates(input)).toEqual(first)
    }
  })
})
