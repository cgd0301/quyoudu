import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { buildCost } from '../../src/engine/cost/index.ts'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { normalize } from '../../src/engine/normalize/index.ts'
import { opsSchema, type Op } from '../../src/engine/ops/index.ts'
import { PRICE_BASIS_ORDER, priceCandidates } from '../../src/engine/pricing/index.ts'
import { LABEL_TEXT, type ResultCore } from '../../src/engine/result.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import { buildSnapshot } from '../../src/engine/snapshot/index.ts'
import { REPO_ROOT } from '../lib/vector.ts'
import { RECORDED, withCase } from './samples.ts'

const SELECT: Op = { type: 'SELECT_CANDIDATE', candidate_id: 'C01' }
const QUOTE = {
  valid_from: '2026-09-01',
  valid_to: '2026-09-30',
  recorded_at: '2026-09-01T08:00:00+08:00',
  available_at: '2026-09-01T08:00:00+08:00',
}

function loadVector(id: string): { input: CaseFile; ops: Op[] } {
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/vectors', `${id}.json`), 'utf8')) as {
    input: unknown
    ops: unknown
  }
  return { input: caseFileSchema.parse(raw.input), ops: opsSchema.parse(raw.ops) }
}

function run(data: CaseFile, ops: readonly Op[] = []): ResultCore {
  const result = evaluate(data, ops, DEMO_CFG_1).checkpoints.at(-1)?.result
  if (result === undefined) throw new Error('没有检查点')
  return result
}

function checkpoint(data: CaseFile, ops: readonly Op[], label: string): ResultCore {
  const result = evaluate(data, ops, DEMO_CFG_1).checkpoints.find((item) => item.label === label)?.result
  if (result === undefined) throw new Error(`没有检查点 ${label}`)
  return result
}

function paid(eventId: string, costItemId: string, amount: number): CaseFile['events'][number] {
  return {
    event_id: eventId,
    event_kind: 'GOAL_PAYMENT',
    event_status: 'ACTUAL',
    amount,
    expected_at: '2026-08-20',
    actual_at: '2026-08-20T12:00:00+08:00',
    time_precision: 'DATETIME',
    in_snapshot: true,
    goal_id: 'G1',
    cost_item_id: costItemId,
    coverage: [],
    ...RECORDED,
    currency: 'CNY',
  }
}

function returned(amount: number): CaseFile['events'][number] {
  return {
    event_id: 'E-RF',
    event_kind: 'RETURN',
    event_status: 'ACTUAL',
    amount,
    expected_at: '2026-08-25',
    actual_at: '2026-08-25T12:00:00+08:00',
    time_precision: 'DATETIME',
    in_snapshot: true,
    goal_id: 'G1',
    coverage: [],
    ...RECORDED,
    currency: 'CNY',
  }
}

function item(costItemId: string, price: number, basis: CaseFile['candidates'][number]['items'][number]['price_basis'] = 'QUOTE') {
  return {
    cost_item_id: costItemId,
    channel: '渠道甲',
    spec: '标准',
    price,
    currency: 'CNY',
    price_basis: basis,
    order_id: 'O1',
    purchase_date: '2026-09-10',
    payment_at: '2026-09-10',
    quote: { ...QUOTE },
  }
}

function withPlan(edit?: (draft: CaseFile) => void): CaseFile {
  return withCase((draft) => {
    draft.candidates.push({ candidate_id: 'C01', items: [], offers_used: [], returns: [] })
    edit?.(draft)
  })
}

/** 现金充足、没有预留，付款节点可以通过，用来单独看预算 */
function quiet(edit: (draft: CaseFile) => void): CaseFile {
  return withCase((draft) => {
    draft.snapshot.cash = 2_000_000
    draft.snapshot.goal_allocation = 0
    draft.reserves = []
    draft.candidates.push({ candidate_id: 'C01', items: [], offers_used: [], returns: [] })
    edit(draft)
  })
}

describe('§3 净成本与预算', () => {
  test('T007-02 净支出 = 已付 − 已到账返还，立减不再计入 R，返还只扣一次', () => {
    const result = run(
      withPlan((draft) => {
        draft.cost_items.push({ cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' })
        draft.events.push(paid('E0', 'TICKET', 55000), returned(10000))
      }),
      [SELECT],
    )
    expect(result.cost.paidTotal.value).toBe(55000)
    expect(result.cost.eligibleReturn.value).toBe(10000)
    expect(result.cost.netSpend?.value).toBe(45000)
    expect(result.cost.netSpend?.value).not.toBe(40000)
    expect(result.cost.netSpend?.value).not.toBe(35000)
  })

  test('T007-03 后续应付按整数分相加', () => {
    const result = run(
      withPlan((draft) => {
        for (const [id, price] of [
          ['FEE-1', 10],
          ['FEE-2', 20],
          ['FEE-3', 3333],
        ] as const) {
          draft.cost_items.push({ cost_item_id: id, category: 'SERVICE_FEE', necessary: true, amount_status: 'CONFIRMED' })
          draft.candidates[0]?.items.push(item(id, price))
        }
      }),
      [SELECT],
    )
    expect(result.cost.futurePayable?.value).toBe(3363)
  })

  test('T007-04 预算检查含历史已付：P + F − R − B = 10000，不能只用 F 与 B 比较', () => {
    const result = run(
      withCase((draft) => {
        draft.goal.budget_cap = 90000
        draft.cost_items.push(
          { cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' },
          { cost_item_id: 'LODGING', category: 'LODGING', necessary: true, amount_status: 'CONFIRMED' },
        )
        draft.events.push(paid('E0', 'TICKET', 58000))
        draft.candidates.push({
          candidate_id: 'C01',
          items: [item('LODGING', 42000)],
          offers_used: [],
          returns: [],
        })
      }),
      [SELECT],
    )
    expect(result.cost.paidTotal.value).toBe(58000)
    expect(result.cost.futurePayable?.value).toBe(42000)
    expect(result.cost.netSpend?.value).toBe(100000)
    expect(result.cost.budgetOverrun?.value).toBe(10000)
    expect(result.constraintIssues.budgetOverrun?.value).toBe(10000)
    expect(result.states.planState).toBe('CONSTRAINT_ISSUE')
  })

  test('T004-04 节点通过且 P + F > B 时为存在约束问题，超限 5000', () => {
    const result = run(
      withCase((draft) => {
        draft.goal.budget_cap = 45000
        draft.cost_items.push({ cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' })
        draft.candidates.push({ candidate_id: 'C01', items: [item('TICKET', 50000)], offers_used: [], returns: [] })
      }),
      [SELECT],
    )
    expect(result.cost.netSpend?.value).toBe(50000)
    expect(result.cost.budgetOverrun?.value).toBe(5000)
    expect(result.states.planState).toBe('CONSTRAINT_ISSUE')
  })

  test('付款缺口优先于预算超限，超限金额仍列出', () => {
    const vector = loadVector('T010-09')
    const result = checkpoint(vector.input, vector.ops, '②')
    expect(result.states.planState).toBe('PAYMENT_GAP')
    expect(result.cost.budgetOverrun?.value).toBe(15000)
    expect(result.constraintIssues.budgetOverrun?.value).toBe(15000)
  })

  test('T010-01 待填不按 0，净支出为 null，计划状态为暂无法完整判断', () => {
    const result = run(
      withPlan((draft) => {
        draft.cost_items.push({ cost_item_id: 'LODGING', category: 'LODGING', necessary: true, amount_status: 'PENDING' })
        draft.candidates[0]?.items.push({ ...item('LODGING', 0, 'PENDING'), price: null })
      }),
      [SELECT],
    )
    expect(result.cost.pendingCostItemIds).toContain('LODGING')
    expect(result.cost.netSpend).toBeNull()
    expect(result.cost.budgetOverrun).toBeNull()
    expect(result.states.planState).toBe('INCOMPLETE')
  })

  test('T012-02 条件退款写入可能退回且不计入 R', () => {
    const vector = loadVector('T012-02')
    const result = run(vector.input, vector.ops)
    expect(result.states.planState).toBe('CANCELLED')
    expect(result.cost.possibleRefund?.amount.value).toBe(15000)
    expect(result.cost.possibleRefund?.condition).toBe('平台审核通过')
    expect(result.cost.eligibleReturn.value).toBe(0)
    expect(result.snapshot?.cash.value).toBe(vector.input.snapshot.cash)
  })
})

describe('状态、标签与依赖', () => {
  test('D62 未确认时两个标签同时出现，已确认时都没有', () => {
    const selected = run(withPlan(), [SELECT]).labels
    expect(selected).toContain('DRAFT_PREVIEW')
    expect(selected).toContain('PREVIEW_UNCONFIRMED')
    const confirmed = withPlan()
    confirmed.confirmed_plan = { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' }
    const labels = run(confirmed).labels
    expect(labels).not.toContain('DRAFT_PREVIEW')
    expect(labels).not.toContain('PREVIEW_UNCONFIRMED')
  })

  test('已暂停、已取消时给出底层计划状态', () => {
    const data = withPlan((draft) => {
      draft.confirmed_plan = { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' }
      draft.cost_items.push({ cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' })
      draft.candidates[0]?.items.push(item('TICKET', 70000))
    })
    const paused = run(data, [{ type: 'PAUSE' }])
    expect(paused.states.planState).toBe('PAUSED')
    expect(paused.states.underlyingPlanState).toBe('PAYMENT_GAP')
    const cancelled = run(data, [{ type: 'CANCEL' }])
    expect(cancelled.states.planState).toBe('CANCELLED')
    expect(cancelled.states.underlyingPlanState).toBe('PAYMENT_GAP')
  })

  test('依赖预计收入时计划状态为按当前假设可行', () => {
    const vector = loadVector('T005-01')
    const before = checkpoint(vector.input, vector.ops, '延期前')
    expect(before.states.planState).toBe('FEASIBLE_UNDER_ASSUMPTIONS')
    const income = before.dependencies.find((item) => item.kind === 'EXPECTED_INCOME')
    expect(income?.refs).toContain('E-INC')
    expect(income?.amount?.value).toBe(50000)
    expect(checkpoint(vector.input, vector.ops, '延期后').states.planState).toBe('PAYMENT_GAP')
  })
})

describe('向量缺口', () => {
  test('T003-04 gap 覆盖合计超过支出额时不执行核销', () => {
    const vector = loadVector('T003-04')
    const result = checkpoint(vector.input, vector.ops, '②')
    const start = result.nodes[0]
    expect(start).toBeDefined()
    for (const node of result.nodes) {
      expect(node.livingReserve.value).toBe(start?.livingReserve.value)
      expect(node.otherProtectedReserve.value).toBe(start?.otherProtectedReserve.value)
    }
  })

  test('T005-04 gap 逾期预计收入保持 EXPECTED', () => {
    const vector = loadVector('T005-04')
    const income = vector.input.events.find((event) => event.event_id === 'E-INC')
    expect(income?.event_status).toBe('EXPECTED')
    const result = run(vector.input, vector.ops)
    expect(income?.event_status).toBe('EXPECTED')
    expect(result.snapshot?.cash.value).toBe(vector.input.snapshot.cash)
    expect(result.states.planState).toBe('INCOMPLETE')
  })

  test('T009-02 gap 有效期未知的报价排在有效参考价之后、待填之前', () => {
    const vector = loadVector('T009-02')
    const row = priceCandidates(normalize(vector.input)).find((item) => item.candidateId === 'C01')
    expect(row?.items[0]?.priceBasis).toBe('UNDATED_QUOTE')
    expect(row?.items[0]?.estimate).toBe(true)
    const undated = PRICE_BASIS_ORDER.indexOf('UNDATED_QUOTE')
    expect(undated).toBeGreaterThan(PRICE_BASIS_ORDER.indexOf('REFERENCE'))
    expect(undated).toBeLessThan(PRICE_BASIS_ORDER.indexOf('PENDING'))
  })

  test('T010-02 gap 确认免费的住宿按 0 计入并保留确认依据', () => {
    const vector = loadVector('T010-02')
    const normalized = normalize(vector.input)
    const report = buildCost({
      data: normalized,
      candidateId: 'C01',
      priced: priceCandidates(normalized).find((item) => item.candidateId === 'C01'),
      lifecycle: 'ACTIVE',
      snapshot: buildSnapshot(normalized),
    })
    const lodging = report.facts.find((item) => item.costItemId === 'LODGING')
    const source = vector.input.cost_items.find((item) => item.cost_item_id === 'LODGING')
    expect(lodging?.amount).toBe(0)
    expect(lodging?.confirmBasis).toBe(source?.confirm_basis)
    expect(lodging?.pending).toBe(false)
    expect(run(vector.input, vector.ops).cost.pendingCostItemIds).toEqual([])
  })

  test('T015-05#1 gap 确认免费为 0，未提及的住宿保持待填', () => {
    const free = loadVector('T015-05#1')
    const freeNorm = normalize(free.input)
    const freeFact = buildCost({
      data: freeNorm,
      candidateId: 'C01',
      priced: priceCandidates(freeNorm).find((item) => item.candidateId === 'C01'),
      lifecycle: 'ACTIVE',
      snapshot: buildSnapshot(freeNorm),
    }).facts.find((item) => item.costItemId === 'LODGING')
    expect(freeFact?.amount).toBe(0)
    expect(freeFact?.confirmBasis).toBe(free.input.cost_items.find((item) => item.cost_item_id === 'LODGING')?.confirm_basis)
    const pending = loadVector('T015-05#2')
    const pendingNorm = normalize(pending.input)
    const pendingFact = buildCost({
      data: pendingNorm,
      candidateId: 'C01',
      priced: priceCandidates(pendingNorm).find((item) => item.candidateId === 'C01'),
      lifecycle: 'ACTIVE',
      snapshot: buildSnapshot(pendingNorm),
    }).facts.find((item) => item.costItemId === 'LODGING')
    expect(pendingFact?.pending).toBe(true)
    expect(pendingFact?.amount).not.toBe(0)
  })
})

describe('性质', () => {
  test('返还只扣一次', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400_000 }), fc.integer({ min: 1, max: 200_000 }), (paidAmount, refund) => {
        const result = run(
          quiet((draft) => {
            draft.cost_items.push({ cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' })
            draft.events.push(paid('E0', 'TICKET', paidAmount), returned(refund))
            draft.candidates[0]?.returns.push({
              event_id: 'E-RF',
              amount: refund,
              expected_at: '2026-08-25T12:00:00+08:00',
              time_precision: 'DATETIME',
              currency: 'CNY',
              ...RECORDED,
            })
          }),
          [SELECT],
        )
        expect(result.cost.eligibleReturn.value).toBe(refund)
        expect(result.cost.netSpend?.value).toBe(paidAmount - refund)
        expect(result.cost.netSpend?.value).not.toBe(paidAmount - refund - refund)
      }),
    )
  })

  test('B 检查包含历史已付', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80_000 }),
        fc.integer({ min: 0, max: 80_000 }),
        fc.integer({ min: 0, max: 80_000 }),
        (paidAmount, future, budget) => {
          fc.pre(future <= budget && paidAmount + future > budget)
          const result = run(
            quiet((draft) => {
              draft.goal.budget_cap = budget
              draft.cost_items.push({ cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' })
              draft.events.push(paid('E0', 'TICKET', paidAmount))
              if (future > 0) {
                draft.cost_items.push({ cost_item_id: 'LODGING', category: 'LODGING', necessary: true, amount_status: 'CONFIRMED' })
                draft.candidates[0]?.items.push(item('LODGING', future))
              }
            }),
            [SELECT],
          )
          expect(result.cost.netSpend?.value).toBe(paidAmount + future)
          expect(result.cost.budgetOverrun?.value).toBe(paidAmount + future - budget)
          expect(result.states.planState).toBe('CONSTRAINT_ISSUE')
        },
      ),
    )
  })

  test('依赖预计收入时不出现资金充足类文案', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50_000 }), (income) => {
        const result = run(
          quiet((draft) => {
            draft.events.push({
              event_id: 'E-INC',
              event_kind: 'INCOME',
              event_status: 'EXPECTED',
              amount: income,
              expected_at: '2026-09-08',
              time_precision: 'DATE',
              in_snapshot: false,
              coverage: [],
              ...RECORDED,
              currency: 'CNY',
            })
          }),
          [SELECT],
        )
        expect(result.states.planState).toBe('FEASIBLE_UNDER_ASSUMPTIONS')
        expect(result.dependencies.some((item) => item.kind === 'EXPECTED_INCOME' && item.amount?.value === income)).toBe(true)
        for (const code of result.labels) expect(LABEL_TEXT[code]).not.toMatch(/资金充足|已经充足/)
        expect(JSON.stringify(result)).not.toContain('资金充足')
        expect(JSON.stringify(result)).not.toContain('已经充足')
      }),
    )
  })

  test('D62 两个标签同进同出', () => {
    fc.assert(
      fc.property(fc.boolean(), (confirmed) => {
        const data = withPlan()
        if (confirmed) data.confirmed_plan = { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' }
        const labels = run(data, confirmed ? [] : [SELECT]).labels
        expect(labels.includes('DRAFT_PREVIEW')).toBe(labels.includes('PREVIEW_UNCONFIRMED'))
        expect(labels.includes('DRAFT_PREVIEW')).toBe(!confirmed)
      }),
    )
  })
})
