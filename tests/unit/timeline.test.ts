import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { normalize } from '../../src/engine/normalize/index.ts'
import type { Op } from '../../src/engine/ops/index.ts'
import { priceCandidates } from '../../src/engine/pricing/index.ts'
import { resultCoreSchema, type ResultCore } from '../../src/engine/result.ts'
import type { CaseFile } from '../../src/engine/schema.ts'
import {
  RELEASE_ID,
  checkPeriod,
  planItemId,
  runTimeline,
  timelineInput,
  type TimelineEvent,
} from '../../src/engine/timeline/index.ts'
import { REPO_ROOT, vectorSchema, vectorsDir } from '../lib/vector.ts'
import { AS_OF, RECORDED, c01, expense, withCase } from './samples.ts'

type Node = ResultCore['nodes'][number]
type CaseEvent = CaseFile['events'][number]
type Item = CaseFile['candidates'][number]['items'][number]

const SELECT: Op = { type: 'SELECT_CANDIDATE', candidate_id: 'C01' }
const TICKET_ID = planItemId('C01', 0, 'TICKET')

const QUOTE = { valid_from: '2026-09-01', valid_to: '2027-01-01', ...RECORDED }

const COST_ITEMS: CaseFile['cost_items'] = [
  { cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' },
  { cost_item_id: 'LODGING', category: 'LODGING', necessary: true, amount_status: 'CONFIRMED' },
  { cost_item_id: 'TRAIN-BACK', category: 'RETURN_TRANSPORT', necessary: true, amount_status: 'CONFIRMED' },
]

function run(data: CaseFile, ops: readonly Op[] = []): ResultCore {
  const result = evaluate(data, ops, DEMO_CFG_1).checkpoints.at(-1)?.result
  if (result === undefined) throw new Error('没有检查点')
  return result
}

function only<T>(rows: readonly T[], what: string): T {
  const [row] = rows
  if (rows.length !== 1 || row === undefined) throw new Error(`${what}命中 ${rows.length} 个`)
  return row
}

function nth(result: ResultCore, index: number): Node {
  const node = result.nodes[index]
  if (node === undefined) throw new Error(`没有第 ${index} 个节点`)
  return node
}

function nodeOf(result: ResultCore, eventId: string): Node {
  return only(
    result.nodes.filter((node) => node.trigger.eventIds.includes(eventId)),
    `触发事件 ${eventId} 的节点`,
  )
}

function nodeAt(result: ResultCore, at: string): Node {
  return only(
    result.nodes.filter((node) => node.at === at),
    `at=${at} 的节点`,
  )
}

function triggered(result: ResultCore): string[] {
  return result.nodes.flatMap((node) => node.trigger.eventIds)
}

/** §1 的 C、L、N、O、M、A、G、H、U */
function figures(node: Node): Record<'C' | 'L' | 'N' | 'O' | 'M' | 'A' | 'G' | 'H' | 'U', number> {
  return {
    C: node.cash.value,
    L: node.livingReserve.value,
    N: node.otherProtectedReserve.value,
    O: node.otherGoalHold.value,
    M: node.contingencyReserve.value,
    A: node.goalAllocation.value,
    G: node.goalAvailable.value,
    H: node.paymentHeadroom.value,
    U: node.unallocated.value,
  }
}

function codes(result: ResultCore): string[] {
  return result.inputIssues.map((issue) => issue.code)
}

function refsOf(result: ResultCore, code: string): string[] {
  return result.inputIssues.find((issue) => issue.code === code)?.refs ?? []
}

function item(costItemId: string, paymentAt: string, price: number, overrides: Partial<Item> = {}): Item {
  return {
    cost_item_id: costItemId,
    channel: '渠道甲',
    spec: '标准',
    price,
    currency: 'CNY',
    price_basis: 'QUOTE',
    order_id: `O-${costItemId}`,
    purchase_date: paymentAt.slice(0, 10),
    payment_at: paymentAt,
    quote: { ...QUOTE },
    ...overrides,
  }
}

/** c01 加上候选 C01，items 为该候选的价格项 */
function planCase(items: Item[], edit?: (draft: CaseFile) => void): CaseFile {
  return withCase((draft) => {
    draft.cost_items = structuredClone(COST_ITEMS)
    draft.candidates = [{ candidate_id: 'C01', items, offers_used: [], returns: [] }]
    edit?.(draft)
  })
}

function income(eventId: string, expectedAt: string, amount: number, overrides: Partial<CaseEvent> = {}): CaseEvent {
  return expense({ event_id: eventId, event_kind: 'INCOME', amount, expected_at: expectedAt, ...overrides })
}

function goalPayment(eventId: string, expectedAt: string, amount: number, overrides: Partial<CaseEvent> = {}): CaseEvent {
  return expense({ event_id: eventId, event_kind: 'GOAL_PAYMENT', goal_id: 'G1', amount, expected_at: expectedAt, ...overrides })
}

function covered(reserveId: string, amount: number): CaseEvent['coverage'][number] {
  return { reserve_id: reserveId, covered_amount: amount }
}

function withoutContingency(draft: CaseFile): void {
  draft.reserves = draft.reserves.filter((reserve) => reserve.reserve_kind !== 'CONTINGENCY')
}

function loadVector(id: string): { input: CaseFile; ops: Op[] } {
  const parsed = vectorSchema.parse(JSON.parse(readFileSync(path.join(REPO_ROOT, vectorsDir(), `${id}.json`), 'utf8')))
  return { input: parsed.input, ops: parsed.ops }
}

function flow(event: Partial<TimelineEvent> & Pick<TimelineEvent, 'id' | 'kind' | 'day'>): TimelineEvent {
  return { amount: 1000, at: event.day, coverage: [], goalRelated: false, confirmedIncome: false, ...event }
}

function day(date: number, month = 9): string {
  return `2026-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
}

/** §10.7：C0=1000、L0=300、N0=O0=M0=0、A0=400；9/5 不属于本目标、无覆盖的支出 400；9/10 本目标付款 400，无覆盖 */
function example1(): ResultCore {
  return run(
    planCase([item('TICKET', '2026-09-10', 40000)], (draft) => {
      withoutContingency(draft)
      draft.events.push(expense({ event_id: 'E-0905', amount: 40000, expected_at: '2026-09-05' }))
    }),
    [SELECT],
  )
}

/** §10.8 T006：c01；9/10 本目标付款 650（无覆盖）与预计收入 400 都只有日期 */
function sameDayIncome(): ResultCore {
  return run(
    planCase([item('TICKET', '2026-09-10', 65000)], (draft) => {
      draft.events.push(income('E-INC', '2026-09-10', 40000))
    }),
    [SELECT],
  )
}

/** T004-07：c01；9/8 已确认预计收入 100，以它为 funding_event_id 的生活预留 300（覆盖 9/8—9/30） */
function reserveOnIncome(): ResultCore {
  return run(
    planCase([], (draft) => {
      draft.events.push(income('E-INC', '2026-09-08', 10000))
      draft.reserves.push({
        reserve_id: 'R-LIV-0908',
        reserve_kind: 'LIVING',
        amount: 30000,
        coverage_start: '2026-09-08',
        coverage_end: '2026-09-30',
        release_at_end: false,
        funding_event_id: 'E-INC',
      })
    }),
    [SELECT],
  )
}

describe('§10.7 例1：最早缺口按 D05 判定', () => {
  test('时间轴为起始、9/5、9/10 三个节点', () => {
    expect(example1().nodes.map((node) => node.at)).toEqual([AS_OF, '2026-09-05', '2026-09-10'])
  })

  test('起始节点：C=1000、L=300、A=400、G=700、H=700、U=300，通过', () => {
    const start = nth(example1(), 0)
    expect(start.trigger).toEqual({ kind: 'START', eventIds: [] })
    expect(figures(start)).toEqual({ C: 100000, L: 30000, N: 0, O: 0, M: 0, A: 40000, G: 70000, H: 70000, U: 30000 })
    expect(start.nodeVerdict).toBe('PASS')
    expect(start.amount).toBeNull()
  })

  test('9/5 不属于本目标的支出 400 由未分配资金承担（D07）：付款缺口 100，相关项目为该笔支出', () => {
    const node = nodeOf(example1(), 'E-0905')
    expect(node.at).toBe('2026-09-05')
    expect(node.trigger.kind).toBe('OUTFLOW')
    expect(figures(node)).toEqual({ C: 60000, L: 30000, N: 0, O: 0, M: 0, A: 40000, G: 30000, H: 30000, U: -10000 })
    expect(node.protectedTotal.value).toBe(30000)
    expect(node.nodeVerdict).toBe('PAYMENT_SHORTFALL')
    expect(node.amount?.value).toBe(10000)
    expect(node.related).toEqual(['E-0905'])
  })

  test('9/10 本目标付款 400，A 冲减 400（D06）：U 没有继续下降，缺口延续 100', () => {
    const node = nodeAt(example1(), '2026-09-10')
    expect(node.trigger).toEqual({ kind: 'OUTFLOW', eventIds: [TICKET_ID] })
    expect(figures(node)).toEqual({ C: 20000, L: 30000, N: 0, O: 0, M: 0, A: 0, G: -10000, H: -10000, U: -10000 })
    expect(node.protectedTotal.value).toBeGreaterThan(node.cash.value)
    expect(node.nodeVerdict).toBe('GAP_CONTINUED')
    expect(node.amount?.value).toBe(10000)
  })

  test('最早缺口为 9/5 的付款缺口 100，计算依据取该节点；不以 9/10 为最早缺口', () => {
    const result = example1()
    const earliest = result.earliestGap
    expect(earliest).toMatchObject({
      at: '2026-09-05',
      nodeVerdict: 'PAYMENT_SHORTFALL',
      amount: { value: 10000 },
      related: ['E-0905'],
    })
    expect(figures(nth(result, earliest?.nodeIndex ?? -1))).toEqual({
      C: 60000,
      L: 30000,
      N: 0,
      O: 0,
      M: 0,
      A: 40000,
      G: 30000,
      H: 30000,
      U: -10000,
    })
  })

  test('缺口列表：9/5 付款缺口 100，9/10 缺口延续 100（D35）', () => {
    expect(example1().gapList.map((gap) => [gap.at, gap.nodeVerdict, gap.amount.value])).toEqual([
      ['2026-09-05', 'PAYMENT_SHORTFALL', 10000],
      ['2026-09-10', 'GAP_CONTINUED', 10000],
    ])
  })

  test('检查期间：最后一笔目标相关收付款在 9/10，其后没有已确认收入，终点为 2027-01-01（D04）', () => {
    expect(example1().checkPeriod).toEqual({ start: AS_OF, end: '2027-01-01', outOfRange: false })
  })
})

describe('§10.8 例2：用 c01 验证 T003、T004、T006', () => {
  test('快照：G0=700、H0=500、U0=100；L0+N0+O0+M0+A0=900≤1000，通过', () => {
    const start = nth(run(c01()), 0)
    expect(figures(start)).toEqual({ C: 100000, L: 30000, N: 0, O: 0, M: 20000, A: 40000, G: 70000, H: 50000, U: 10000 })
    expect(start.protectedTotal.value + start.goalAllocation.value).toBe(90000)
    expect(start.nodeVerdict).toBe('PASS')
  })

  test('T003 生活支出 200 由生活预留覆盖（q=200）：付款空间仍为 500，A、U 不变', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(expense({ coverage: [covered('R-LIV-09', 20000)] }))
      }),
    )
    const node = nodeOf(result, 'E1')
    expect(figures(node)).toEqual({ C: 80000, L: 10000, N: 0, O: 0, M: 20000, A: 40000, G: 70000, H: 50000, U: 10000 })
    expect(node.nodeVerdict).toBe('PASS')
    expect(node.cash.basis.eventIds).toEqual(['E1'])
    expect(node.livingReserve.basis.reserveIds).toEqual(['R-LIV-09'])
  })

  test('T004 用户把 A 改为 600（起始节点）：分配冲突 100，即 1100-1000；不是付款缺口', () => {
    const result = run(c01(), [{ type: 'SET_ALLOCATION', goal_allocation: 60000 }])
    const start = nth(result, 0)
    expect(figures(start)).toEqual({ C: 100000, L: 30000, N: 0, O: 0, M: 20000, A: 60000, G: 70000, H: 50000, U: -10000 })
    expect(start.protectedTotal.value).toBe(50000)
    expect(start.nodeVerdict).toBe('ALLOCATION_CONFLICT')
    expect(start.amount?.value).toBe(110000 - 100000)
    expect(result.earliestGap).toBeNull()
    expect(result.gapList).toEqual([])
    expect(result.constraintIssues.allocationConflicts.map((gap) => [gap.nodeIndex, gap.nodeVerdict, gap.amount.value])).toEqual([
      [0, 'ALLOCATION_CONFLICT', 10000],
    ])
  })

  test('T006 同日本目标付款 650 与预计收入 400 先后不明：按 D10 付款在前，A 冲减 400，保护性资金缺口 150', () => {
    const result = sameDayIncome()
    const node = nth(result, 1)
    expect(node.trigger).toEqual({ kind: 'OUTFLOW', eventIds: [TICKET_ID] })
    expect(figures(node)).toEqual({ C: 35000, L: 30000, N: 0, O: 0, M: 20000, A: 0, G: 5000, H: -15000, U: -15000 })
    expect(node.protectedTotal.value).toBe(50000)
    expect(node.nodeVerdict).toBe('PROTECTED_SHORTFALL')
    expect(node.amount?.value).toBe(15000)
    expect(-node.paymentHeadroom.value).toBe(15000)
    expect(node.protectedOverCash?.value).toBe(50000 - 35000)
    expect(node.allocationUnsupported?.value).toBe(0)
    expect(result.earliestGap?.nodeVerdict).toBe('PROTECTED_SHORTFALL')
  })

  test('T006（续）随后入账 400：C=750、H=U=250，日终通过', () => {
    const node = nth(sameDayIncome(), 2)
    expect(node.trigger).toEqual({ kind: 'INCOME', eventIds: ['E-INC'] })
    expect(figures(node)).toEqual({ C: 75000, L: 30000, N: 0, O: 0, M: 20000, A: 0, G: 45000, H: 25000, U: 25000 })
    expect(node.nodeVerdict).toBe('PASS')
  })

  test('R019 最小数值案例（M0=0）：H0=700、U0=300；把分配改为 600 时 U0=100，不产生分配冲突', () => {
    const start = nth(run(withCase(withoutContingency)), 0)
    expect([start.paymentHeadroom.value, start.unallocated.value]).toEqual([70000, 30000])
    const raised = run(withCase(withoutContingency), [{ type: 'SET_ALLOCATION', goal_allocation: 60000 }])
    expect([nth(raised, 0).unallocated.value, nth(raised, 0).nodeVerdict]).toEqual([10000, 'PASS'])
    expect(raised.constraintIssues.allocationConflicts).toEqual([])
  })
})

describe('§2 预留核销与 §10.3 逐事件计算', () => {
  test('T003-02 生活支出 350 其中 300 由生活预留覆盖：H 只减少未覆盖的 50，A 不变', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(expense({ amount: 35000, coverage: [covered('R-LIV-09', 30000)] }))
      }),
    )
    expect(figures(nodeOf(result, 'E1'))).toMatchObject({ C: 65000, L: 0, A: 40000, H: 45000, U: 5000 })
  })

  test('T003-06 本目标付款 300 其中 100 由机动预留覆盖：A 只冲减未覆盖的 200，H′=500-(300-100)=300', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(goalPayment('E1', '2026-09-10', 30000, { coverage: [covered('R-CON', 10000)] }))
      }),
    )
    const node = nodeOf(result, 'E1')
    expect(figures(node)).toMatchObject({ C: 70000, M: 10000, A: 20000, H: 30000, U: 10000 })
    expect(node.paymentHeadroom.value).toBe(50000 - (30000 - 10000))
  })

  test('T004-01 本目标付款 400 无覆盖：A 冲减至 0，U 与付款前相同，现金只减少一次', () => {
    const result = run(planCase([item('TICKET', '2026-09-10', 40000)]), [SELECT])
    expect([result.snapshot?.cash.value, result.snapshot?.paymentHeadroom.value]).toEqual([100000, 50000])
    const node = nodeAt(result, '2026-09-10')
    expect(figures(node)).toMatchObject({ C: 60000, A: 0, H: 10000, U: 10000 })
    expect(node.unallocated.value).toBe(nth(result, 0).unallocated.value)
  })

  test('q 不超过对应剩余预留：声明 400、剩余 300 时只核销 300，H′=H-(x-q)', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(expense({ amount: 40000, coverage: [covered('R-LIV-09', 40000)] }))
      }),
    )
    const node = nodeOf(result, 'E1')
    expect(node.livingReserve.value).toBe(0)
    expect(node.paymentHeadroom.value).toBe(50000 - (40000 - 30000))
  })

  test('T003-04 覆盖合计超过支出额时不执行核销，现金仍扣支出额', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(expense({ amount: 10000, coverage: [covered('R-LIV-09', 20000)] }))
      }),
    )
    expect(codes(result)).toContain('COVERAGE_EXCEEDS_AMOUNT')
    const start = nth(result, 0)
    const node = nodeOf(result, 'E1')
    expect(node.livingReserve.value).toBe(start.livingReserve.value)
    expect(node.cash.value).toBe(start.cash.value - 10000)
    expect(node.paymentHeadroom.value).toBe(start.paymentHeadroom.value - 10000)
  })

  test('多项预留共同覆盖时 q 为不重叠核销额之和，只有未覆盖部分冲减 A', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(
          goalPayment('E1', '2026-09-10', 30000, { coverage: [covered('R-LIV-09', 10000), covered('R-CON', 10000)] }),
        )
      }),
    )
    const start = nth(result, 0)
    const node = nodeOf(result, 'E1')
    const q =
      start.livingReserve.value - node.livingReserve.value + (start.contingencyReserve.value - node.contingencyReserve.value)
    expect(q).toBe(10000 + 10000)
    expect(start.goalAllocation.value - node.goalAllocation.value).toBe(30000 - q)
    expect(node.paymentHeadroom.value).toBe(start.paymentHeadroom.value - (30000 - q))
  })
})

describe('§10.1 检查期间（D04、D41、D56、D64）', () => {
  function partlyCovered(): ResultCore {
    return run(
      planCase([], (draft) => {
        draft.events.push(expense({ amount: 45000, coverage: [covered('R-LIV-09', 30000)] }))
      }),
      [SELECT],
    )
  }

  test('T003-07 没有未来目标收付款，也没有 as_of 之后的已确认收入：检查期间为 2026-09-01 至 2027-01-01', () => {
    const period = partlyCovered().checkPeriod
    expect(period.start).toBe(AS_OF)
    expect(period.start).toContain('2026-09-01')
    expect(period.end).toBe('2027-01-01')
  })

  test('T003-07 部分覆盖的生活支出 450：U<0 且由流出触发，付款缺口 50，相关项目为该笔支出（D36）', () => {
    const node = nodeOf(partlyCovered(), 'E1')
    expect(figures(node)).toEqual({ C: 55000, L: 0, N: 0, O: 0, M: 20000, A: 40000, G: 55000, H: 35000, U: -5000 })
    expect(node.protectedTotal.value).toBe(20000)
    expect(node.nodeVerdict).toBe('PAYMENT_SHORTFALL')
    expect(node.amount?.value).toBe(5000)
    expect(node.related).toEqual(['E1'])
  })

  test('T004-07 没有未来目标收付款：终点为 as_of 之后第一笔已确认收入日 9/8，含当日全部事件（D41④）', () => {
    const result = reserveOnIncome()
    expect(result.checkPeriod.end).toBe('2026-09-08')
    expect(nodeOf(result, 'E-INC').at).toBe('2026-09-08')
  })

  test('T006-01 与最后一笔目标收付款同日的已确认收入算"其后"，终点日含当日全部事件（D41②③）', () => {
    const result = sameDayIncome()
    expect(result.checkPeriod.end).toBe('2026-09-10')
    expect(nodeOf(result, 'E-INC').at).toBe('2026-09-10')
  })

  test('T019-03 检查期间按 D41、D56 为 10/1—10/10', () => {
    const { input, ops } = loadVector('T019-03')
    expect(run(input, ops).checkPeriod.end).toBe('2026-10-10')
  })

  test('D56：终点再取基础时间轴最晚一笔 OTHER_EXPENSE 的日期', () => {
    const result = run(
      planCase([item('TICKET', '2026-09-10', 10000)], (draft) => {
        draft.events.push(
          income('E-INC', '2026-09-20', 50000),
          expense({ event_id: 'E-LIV-0925', expected_at: '2026-09-25', coverage: [covered('R-LIV-09', 20000)] }),
        )
      }),
      [SELECT],
    )
    expect(result.checkPeriod.end).toBe('2026-09-25')
    expect(nodeOf(result, 'E-LIV-0925').at).toBe('2026-09-25')
  })

  test('D56：情景支出不参与确定终点', () => {
    const known = [
      flow({ id: 'G', kind: 'GOAL_PAYMENT', day: '2026-09-10', goalRelated: true }),
      flow({ id: 'I', kind: 'INCOME', day: '2026-09-20', confirmedIncome: true }),
    ]
    const late = flow({ id: 'S', kind: 'OTHER_EXPENSE', day: '2026-09-25' })
    expect(checkPeriod(AS_OF, [...known, { ...late, scenario: true }]).end).toBe('2026-09-20')
    expect(checkPeriod(AS_OF, [...known, late]).end).toBe('2026-09-25')
  })

  test('D41①⑤、D64：条件收入不是已确认收入，不参与确定检查期间，也不进入基础时间轴', () => {
    const result = run(
      planCase([item('TICKET', '2026-09-10', 10000)], (draft) => {
        draft.events.push(income('E-COND', '2026-09-20', 50000, { trigger_condition: '审核通过后发放' }))
      }),
      [SELECT],
    )
    expect(result.checkPeriod.end).toBe('2027-01-01')
    expect(triggered(result)).not.toContain('E-COND')
  })

  test('D41①：返还不是已确认收入；金额、日期和条件均明确的返还按目标相关收款进入时间轴', () => {
    const result = run(
      planCase([item('TICKET', '2026-09-10', 10000)], (draft) => {
        draft.events.push(expense({ event_id: 'E-CB', event_kind: 'RETURN', goal_id: 'G1', amount: 5000, expected_at: '2026-09-15' }))
      }),
      [SELECT],
    )
    expect(result.checkPeriod.end).toBe('2027-01-01')
    expect(nodeOf(result, 'E-CB').trigger.kind).toBe('OTHER')
  })

  test('D41⑥：应取的收入日晚于 2027-01-01 时超界，终点不截断', () => {
    const result = run(
      planCase([item('TICKET', '2026-12-20', 10000)], (draft) => {
        draft.events.push(income('E-INC', '2027-01-15', 50000))
      }),
      [SELECT],
    )
    expect(result.checkPeriod).toMatchObject({ end: '2027-01-15', outOfRange: true })
    expect(codes(result)).toContain('OUT_OF_RANGE')
    expect(nodeOf(result, 'E-INC').at).toBe('2027-01-15')
  })

  test('T008-03 2026-09-01 与 2027-01-01 的事件都在演示范围内，进入时间轴', () => {
    const result = run(
      planCase([], (draft) => {
        draft.events.push(
          expense({ event_id: 'E-FIRST', amount: 1000, expected_at: '2026-09-01' }),
          expense({ event_id: 'E-LAST', amount: 1000, expected_at: '2027-01-01' }),
        )
      }),
      [SELECT],
    )
    expect(nodeOf(result, 'E-FIRST').trigger.eventIds).toContain('E-FIRST')
    expect(nodeOf(result, 'E-LAST').trigger.eventIds).toContain('E-LAST')
    expect(result.checkPeriod).toEqual({ start: AS_OF, end: '2027-01-01', outOfRange: false })
  })
})

describe('§10.1 第7步 逾期事件（D54）', () => {
  test('T005-04 9/8 的预计收入未标记实收：不计入 C0，报逾期，不进入时间轴', () => {
    const { input, ops } = loadVector('T005-04')
    const result = run(input, ops)
    expect(result.snapshot?.cash.value).toBe(100000)
    expect(refsOf(result, 'OVERDUE_EVENT')).toEqual(['E-INC'])
    expect(triggered(result)).not.toContain('E-INC')
  })

  test('逾期流出按 as_of 立即发生：排在起始节点之后，记录的预计日期不变', () => {
    const result = run(
      withCase((draft) => {
        draft.snapshot.as_of = '2026-09-10T09:00:00+08:00'
        draft.snapshot.cash_as_of = '2026-09-10T09:00:00+08:00'
        draft.events.push(
          expense({ event_id: 'E-LATE', amount: 10000, expected_at: '2026-09-08' }),
          expense({ event_id: 'E-NEXT', amount: 1000, expected_at: '2026-09-12' }),
        )
      }),
    )
    expect(refsOf(result, 'OVERDUE_EVENT')).toEqual(['E-LATE'])
    expect(result.nodes.map((node) => node.trigger.eventIds)).toEqual([[], ['E-LATE'], ['E-NEXT']])
    const late = nodeOf(result, 'E-LATE')
    expect(late.at).toBe('2026-09-08')
    expect(late.cash.value).toBe(nth(result, 0).cash.value - 10000)
  })

  test('只有日期的事件在 as_of 当日不算逾期；有时刻精度且早于 cash_as_of 的算逾期', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(
          expense({ event_id: 'E-DAY', amount: 1000, expected_at: '2026-09-01' }),
          expense({ event_id: 'E-EARLY', amount: 1000, expected_at: '2026-09-01T08:00:00+08:00', time_precision: 'DATETIME' }),
        )
      }),
    )
    expect(refsOf(result, 'OVERDUE_EVENT')).toEqual(['E-EARLY'])
  })
})

describe('§10.2 事件排序与流出组（D10、D38）', () => {
  test('T006-02 同日两笔先后未知的支出组成流出组：组末 U=-40，日级累计付款缺口 40，不指认先失败的一笔', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(
          expense({ event_id: 'E1', amount: 8000, expected_at: '2026-09-10' }),
          expense({ event_id: 'E2', amount: 6000, expected_at: '2026-09-10' }),
        )
      }),
    )
    const node = nodeOf(result, 'E1')
    expect(nodeOf(result, 'E2')).toBe(node)
    expect(node.trigger).toEqual({ kind: 'OUTFLOW_GROUP', eventIds: ['E1', 'E2'] })
    expect(node.at).toBe('2026-09-10')
    expect(figures(node)).toMatchObject({ C: 86000, A: 40000, H: 36000, U: -4000 })
    expect(node.protectedTotal.value).toBe(50000)
    expect(node.nodeVerdict).toBe('PAYMENT_SHORTFALL')
    expect(node.amount?.value).toBe(4000)
    expect(node.related).toEqual(['E1', 'E2'])
  })

  function sharedReserve(each: number, swapped = false): ResultCore {
    return run(
      withCase((draft) => {
        draft.events.push(
          goalPayment(swapped ? 'E2' : 'E1', '2026-09-10', 20000, { coverage: [covered('R-LIV-09', each)] }),
          expense({ event_id: swapped ? 'E1' : 'E2', amount: 20000, expected_at: '2026-09-10', coverage: [covered('R-LIV-09', each)] }),
        )
      }),
    )
  }

  test('T006-06① 同一生活预留的覆盖声明合计 200≤300：各笔足额核销，组末通过；交换 event_id 后结果相同', () => {
    for (const swapped of [false, true]) {
      const node = nodeOf(sharedReserve(10000, swapped), 'E1')
      expect(node.trigger.kind).toBe('OUTFLOW_GROUP')
      expect(figures(node)).toMatchObject({ C: 60000, L: 10000, M: 20000, A: 30000, G: 50000, H: 30000, U: 0 })
      expect(node.nodeVerdict).toBe('PASS')
    }
  })

  test('T006-06② 覆盖声明合计 400>300：按输入冲突处理，不报告该日的日级累计缺口', () => {
    const result = sharedReserve(20000)
    expect(refsOf(result, 'GROUP_COVERAGE_OVERSUBSCRIBED')).toEqual(['E1', 'E2'])
    expect(triggered(result)).not.toContain('E1')
    expect(result.gapList.some((gap) => gap.related.includes('E1') || gap.related.includes('E2'))).toBe(false)
  })

  test('同日先后只认 known_order，事件自带的时刻不决定先后', () => {
    const timed = (morning: Partial<CaseEvent>, evening: Partial<CaseEvent>) =>
      run(
        withCase((draft) => {
          draft.events.push(
            expense({ event_id: 'E-AM', amount: 1000, expected_at: '2026-09-10T08:00:00+08:00', time_precision: 'DATETIME', ...morning }),
            expense({ event_id: 'E-PM', amount: 1000, expected_at: '2026-09-10T20:00:00+08:00', time_precision: 'DATETIME', ...evening }),
          )
        }),
      )
    expect(timed({}, {}).nodes.map((node) => node.trigger)).toEqual([
      { kind: 'START', eventIds: [] },
      { kind: 'OUTFLOW_GROUP', eventIds: ['E-AM', 'E-PM'] },
    ])
    expect(timed({ known_order: 2 }, { known_order: 1 }).nodes.map((node) => node.trigger)).toEqual([
      { kind: 'START', eventIds: [] },
      { kind: 'OUTFLOW', eventIds: ['E-PM'] },
      { kind: 'OUTFLOW', eventIds: ['E-AM'] },
    ])
  })

  test('T003-08 10/6 的支出按 D10 排在同日收入之前；迟建的生活预留扣减此前声明的覆盖额（D40）', () => {
    const { input, ops } = loadVector('T003-08')
    const result = run(input, ops)
    expect(nth(result, 6).trigger.eventIds).toEqual(['E-1006'])
    expect(nth(result, 7).trigger.eventIds).toEqual(['E-INC'])
    expect(nth(result, 0).nodeVerdict).toBe('PASS')
    const cash = [195000, 190000, 185000, 180000, 175000, 170000]
    cash.forEach((value, index) => {
      const node = nodeOf(result, `E-100${index + 1}`)
      expect([node.cash.value, node.livingReserve.value, node.unallocated.value, node.nodeVerdict]).toEqual([value, 0, value, 'PASS'])
    })
    const received = nodeOf(result, 'E-INC')
    expect([received.cash.value, received.livingReserve.value, received.unallocated.value, received.nodeVerdict]).toEqual([
      320000,
      120000,
      200000,
      'PASS',
    ])
  })

  test('机动预留释放排在当日全部收付之后，即日终（D38、D39）', () => {
    const result = run(
      planCase([], (draft) => {
        draft.events.push(
          expense({ event_id: 'E-0928', amount: 1000, expected_at: '2026-09-28' }),
          income('E-INC-0928', '2026-09-28', 1000),
        )
      }),
      [SELECT],
    )
    expect(result.nodes.slice(-3).map((node) => node.trigger.eventIds)).toEqual([['E-0928'], ['E-INC-0928'], [RELEASE_ID]])
    expect(nodeOf(result, 'E-INC-0928').contingencyReserve.value).toBe(20000)
    expect(nodeOf(result, RELEASE_ID).contingencyReserve.value).toBe(0)
  })

  test('§10.6：待测流出 x 作为 as_of 时刻的流出插在时间轴最前', () => {
    const data = normalize(
      withCase((draft) => {
        draft.events.push(expense({ event_id: 'E1', amount: 1000, expected_at: '2026-09-01' }))
      }),
    )
    const input = timelineInput(data, { candidateId: null, priced: undefined, lifecycle: 'ACTIVE' })
    const x = flow({ id: 'X', kind: 'OTHER_EXPENSE', day: '2026-09-01', at: AS_OF, amount: 5000, leading: true })
    const result = runTimeline({ ...input, events: [...input.events, x] })
    expect(result.nodes.map((node) => node.trigger)).toEqual([
      { kind: 'START', eventIds: [] },
      { kind: 'OUTFLOW', eventIds: ['X'] },
      { kind: 'OUTFLOW', eventIds: ['E1'] },
    ])
    expect(result.nodes[1]?.cash.value).toBe(100000 - 5000)
  })
})

describe('§10.3 收入节点：生活预留建立与计划分配（D08、D18、D37）', () => {
  test('T004-07 收入节点建立生活预留后首次 U<0：分配冲突 100，相关项目为该收入及其建立的预留，不是付款缺口', () => {
    const result = reserveOnIncome()
    expect(nth(result, 0).unallocated.value).toBe(10000)
    const node = nodeOf(result, 'E-INC')
    expect(node.trigger.kind).toBe('INCOME')
    expect(figures(node)).toMatchObject({ C: 110000, L: 60000, M: 20000, A: 40000, G: 50000, H: 30000, U: -10000 })
    expect(node.protectedTotal.value).toBe(80000)
    expect(node.nodeVerdict).toBe('ALLOCATION_CONFLICT')
    expect(node.amount?.value).toBe(10000)
    expect(node.related).toEqual(['E-INC', 'R-LIV-0908'])
    expect(result.constraintIssues.allocationConflicts).toEqual([
      expect.objectContaining({ at: '2026-09-08', nodeVerdict: 'ALLOCATION_CONFLICT', related: ['E-INC', 'R-LIV-0908'] }),
    ])
    expect(result.earliestGap).toBeNull()
    expect(result.gapList).toEqual([])
  })

  test('T017-12 确认后的计划分配 500 挂在 9/8 收入上，紧随该流入转入 A', () => {
    const { input } = loadVector('T017-12')
    const confirmed = structuredClone(input)
    confirmed.snapshot.goal_allocation = 10000
    confirmed.planned_allocation = { funding_event_id: 'E-INC', amount: 50000 }
    const result = run(confirmed, [SELECT])
    const pick = (node: Node) => [node.cash.value, node.goalAllocation.value, node.unallocated.value]
    expect([nth(result, 0).goalAllocation.value, nth(result, 0).unallocated.value]).toEqual([10000, 40000])
    expect(pick(nodeOf(result, 'E-0905'))).toEqual([70000, 10000, 10000])
    expect(pick(nodeOf(result, 'E-INC'))).toEqual([120000, 60000, 10000])
    expect(pick(nodeAt(result, '2026-09-10'))).toEqual([60000, 0, 10000])
  })

  test('R005：依赖后续条件的返还不进入基础时间轴；金额、日期和条件均明确的返还计入现金', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(
          expense({
            event_id: 'E-RF',
            event_kind: 'RETURN',
            goal_id: 'G1',
            amount: 15000,
            expected_at: '2026-09-20',
            trigger_condition: '平台审核通过',
          }),
          expense({ event_id: 'E-CB', event_kind: 'RETURN', goal_id: 'G1', amount: 5000, expected_at: '2026-09-15' }),
        )
      }),
    )
    expect(triggered(result)).not.toContain('E-RF')
    const node = nodeOf(result, 'E-CB')
    expect(node.trigger.kind).toBe('OTHER')
    expect(node.cash.value).toBe(100000 + 5000)
  })
})

describe('机动预留释放（D09、D39、D55）', () => {
  test('有计划对象时，M 在活动结束日（演出结束日）的次日日终释放为未分配资金', () => {
    const result = run(planCase([]), [SELECT])
    const node = nodeOf(result, RELEASE_ID)
    expect(node.at).toBe('2026-09-28')
    expect(node.trigger).toEqual({ kind: 'OTHER', eventIds: [RELEASE_ID] })
    expect(node.contingencyReserve.value).toBe(0)
    expect(node.unallocated.value).toBe(nth(result, 0).unallocated.value + 20000)
  })

  test('有返程交通时，活动结束日取演出结束日与返程到达日的较晚者', () => {
    const result = run(planCase([item('TRAIN-BACK', '2026-09-10', 10000, { arrive_at: '2026-09-29T12:00:00+08:00' })]), [SELECT])
    expect(nodeOf(result, RELEASE_ID).at).toBe('2026-09-30')
  })

  test('没有计划对象时时间轴只含共同事件，不生成释放，原因为尚未形成方案（§12.7、D47）', () => {
    const result = run(c01())
    expect(result.nodes.some((node) => node.trigger.kind === 'OTHER')).toBe(false)
    expect(result.inputIssues).toContainEqual({ code: 'NO_PLAN', rule: 'D47', refs: ['G1'] })
    expect(codes(run(planCase([]), [SELECT]))).not.toContain('NO_PLAN')
  })
})

describe('§10.4 节点判定（D05、D35）', () => {
  test('T004-05 起始节点分配冲突 100；9/20 的预计收入不计入 C0 或 U0，不能消除该冲突', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(income('E-INC', '2026-09-20', 50000))
      }),
      [{ type: 'SET_ALLOCATION', goal_allocation: 60000 }],
    )
    expect([result.snapshot?.cash.value, result.snapshot?.unallocated.value]).toEqual([100000, -10000])
    const start = nth(result, 0)
    expect([start.cash.value, start.unallocated.value, start.nodeVerdict, start.amount?.value]).toEqual([
      100000,
      -10000,
      'ALLOCATION_CONFLICT',
      10000,
    ])
  })

  test('分配冲突之后 U 没有继续下降的负节点标"冲突延续"，只进约束问题', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(expense({ coverage: [covered('R-LIV-09', 20000)] }))
      }),
      [{ type: 'SET_ALLOCATION', goal_allocation: 60000 }],
    )
    const node = nodeOf(result, 'E1')
    expect(node.unallocated.value).toBe(nth(result, 0).unallocated.value)
    expect(node.nodeVerdict).toBe('CONFLICT_CONTINUED')
    expect(node.amount?.value).toBe(10000)
    expect(result.constraintIssues.allocationConflicts.map((gap) => gap.nodeVerdict)).toEqual([
      'ALLOCATION_CONFLICT',
      'CONFLICT_CONTINUED',
    ])
    expect(result.earliestGap).toBeNull()
    expect(result.gapList).toEqual([])
  })
})

describe('暂停与取消（R012、D47、D55、D61）', () => {
  test('T012-04 暂停：时间轴不变，不可退的 9/15 住宿尾款仍保留在时间轴中', () => {
    const { input } = loadVector('T012-04')
    const paused = run(input, [{ type: 'PAUSE' }])
    expect(paused.nodes).toEqual(run(input).nodes)
    expect(nodeOf(paused, 'E-LODGING').trigger.eventIds).toContain('E-LODGING')
  })

  test('暂停不因 cancellable 移除义务', () => {
    const data = planCase([item('TICKET', '2026-09-20', 10000, { cancellable: true })], (draft) => {
      draft.confirmed_plan = { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' }
      draft.events.push(goalPayment('E-MEALS', '2026-09-22', 1000, { cancellable: true }))
    })
    const paused = run(data, [{ type: 'PAUSE' }])
    expect(triggered(paused)).toEqual(expect.arrayContaining([TICKET_ID, 'E-MEALS']))
  })

  test('T012-03 取消：A=0、U0=500，C0 仍为 1000；不生成收入事件；M=200 不因取消释放，仍于活动结束日次日释放', () => {
    const { input } = loadVector('T012-03')
    const result = run(input, [{ type: 'CANCEL' }])
    expect(figures(nth(result, 0))).toMatchObject({ C: 100000, M: 20000, A: 0, U: 50000 })
    expect(result.nodes.some((node) => node.trigger.kind === 'INCOME')).toBe(false)
    const release = nodeOf(result, RELEASE_ID)
    expect(release.at).toBe('2026-09-28')
    expect(release.contingencyReserve.value).toBe(0)
  })

  test('T012-02 取消：可能退款不入账；尚未发生且 cancellable 不为 true 的付款仍计入义务', () => {
    const { input } = loadVector('T012-02')
    const result = run(input, [{ type: 'CANCEL' }])
    expect(result.snapshot?.cash.value).toBe(100000)
    expect(triggered(result)).not.toContain('E-RF')
    expect(nodeOf(result, 'E-PAY').trigger.eventIds).toEqual(['E-PAY'])
  })

  test('取消后 cancellable=true 的预计事件和候选价格项不再计入，省略或 false 的仍计入（D61）', () => {
    const lodging = planItemId('C01', 1, 'LODGING')
    const data = planCase(
      [item('TICKET', '2026-09-20', 10000, { cancellable: true }), item('LODGING', '2026-09-21', 10000)],
      (draft) => {
        draft.confirmed_plan = { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' }
        draft.events.push(
          goalPayment('E-MEALS', '2026-09-22', 1000, { cancellable: true }),
          goalPayment('E-KEEP', '2026-09-23', 1000, { cancellable: false }),
        )
      },
    )
    expect(triggered(run(data))).toEqual(expect.arrayContaining([TICKET_ID, lodging, 'E-MEALS', 'E-KEEP']))
    const cancelled = triggered(run(data, [{ type: 'CANCEL' }]))
    expect(cancelled).toEqual(expect.arrayContaining([lodging, 'E-KEEP']))
    expect(cancelled).not.toContain(TICKET_ID)
    expect(cancelled).not.toContain('E-MEALS')
  })
})

describe('快照与已计入事件（R002、D03、D29）', () => {
  test('T001-05 ①09:00 计算时 E1 为时间轴事件；②记录后 E1 只计入快照一次，②的起始节点与①中 E1 后的节点数值相同', () => {
    const spend = (patch: Partial<CaseEvent>) =>
      expense({
        amount: 20000,
        expected_at: '2026-09-01T10:00:00+08:00',
        time_precision: 'DATETIME',
        coverage: [covered('R-LIV-09', 20000)],
        ...patch,
      })
    const before = nodeOf(
      run(
        withCase((draft) => {
          draft.events.push(spend({}))
        }),
      ),
      'E1',
    )
    expect(figures(before)).toMatchObject({ C: 80000, L: 10000, H: 50000, U: 10000 })
    const after = run(
      withCase((draft) => {
        draft.snapshot.as_of = '2026-09-01T10:30:00+08:00'
        draft.snapshot.cash_as_of = '2026-09-01T10:30:00+08:00'
        draft.snapshot.snapshot_phase = 'AFTER_EVENT(1)'
        draft.snapshot.cash = 80000
        for (const reserve of draft.reserves) if (reserve.reserve_id === 'R-LIV-09') reserve.amount = 10000
        draft.events.push(spend({ event_status: 'ACTUAL', actual_at: '2026-09-01T10:00:00+08:00', in_snapshot: true }))
      }),
    )
    expect(codes(after)).not.toContain('SNAPSHOT_PHASE_MISMATCH')
    expect(triggered(after)).not.toContain('E1')
    expect(figures(nth(after, 0))).toEqual(figures(before))
  })

  test('T001-07③ 已计入快照的实际支出不进入时间轴：G0=700、H0=500、U0=100', () => {
    const result = run(
      planCase([], (draft) => {
        draft.snapshot.snapshot_phase = 'AFTER_EVENT(1)'
        draft.events.push(
          expense({
            amount: 5000,
            event_status: 'ACTUAL',
            expected_at: '2026-09-01T08:00:00+08:00',
            actual_at: '2026-09-01T08:00:00+08:00',
            time_precision: 'DATETIME',
            in_snapshot: true,
          }),
        )
      }),
      [SELECT],
    )
    expect(triggered(result)).not.toContain('E1')
    expect(figures(nth(result, 0))).toMatchObject({ G: 70000, H: 50000, U: 10000 })
  })

  test('T001-03 10/1 快照中的 9 月记录均已计入快照，不再改变 C0，也不进入时间轴', () => {
    const { input, ops } = loadVector('T001-03')
    const result = run(input, ops)
    expect(nth(result, 0).cash.value).toBe(200000)
    expect(triggered(result)).not.toContain('E-0915')
    expect(triggered(result)).not.toContain('E-0920')
  })

  test('T013-01 新增生活支出时默认新建的生活预留并入起始节点检查', () => {
    const result = run(c01(), [
      {
        type: 'ADD_LIVING_EXPENSE',
        event_id: 'E-NEW',
        expected_at: '2026-09-03',
        amount: 10000,
        cover_mode: 'NEW_RESERVE',
        reserve_id: 'R-NEW',
        category: 'MEALS',
      },
    ])
    const start = nth(result, 0)
    expect(figures(start)).toMatchObject({ L: 40000, H: 40000, U: 0 })
    expect(start.nodeVerdict).toBe('PASS')
    expect(figures(nodeOf(result, 'E-NEW'))).toMatchObject({ C: 90000, L: 30000, H: 40000, U: 0 })
  })

  test('T013-08 改由现有生活预留覆盖：起始 L=300、H0=500、U0=100；9/3 后 C=900、L=200、H=500、U=100', () => {
    const add = (mode: 'NEW_RESERVE' | 'EXISTING_RESERVE', reserveId: string): Op => ({
      type: 'ADD_LIVING_EXPENSE',
      event_id: 'E-NEW',
      expected_at: '2026-09-03',
      amount: 10000,
      cover_mode: mode,
      reserve_id: reserveId,
      category: 'MEALS',
    })
    const result = run(c01(), [add('NEW_RESERVE', 'R-NEW'), add('EXISTING_RESERVE', 'R-LIV-09')])
    expect(figures(nth(result, 0))).toMatchObject({ L: 30000, H: 50000, U: 10000 })
    expect(figures(nodeOf(result, 'E-NEW'))).toMatchObject({ C: 90000, L: 20000, H: 50000, U: 10000 })
  })

  test('T005-05 用户确认 9/20 预计收入：C0、U0 不变，该收入只出现在 9/20 的时间轴节点', () => {
    const result = run(c01(), [{ type: 'PATCH', path: '/events', value: [income('E-INC', '2026-09-20', 50000)] }])
    expect([nth(result, 0).cash.value, nth(result, 0).unallocated.value]).toEqual([100000, 10000])
    const node = nodeOf(result, 'E-INC')
    expect([node.at, node.trigger.kind]).toEqual(['2026-09-20', 'INCOME'])
  })
})

describe('金额或日期未知与引用失效（D74）', () => {
  test('金额未知的流出报 MISSING_KEY_INFO，局部检查在该笔处截断；金额和日期未知的流入不计入，也不报', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(
          expense({ event_id: 'E-BEFORE', amount: 1000, expected_at: '2026-09-02' }),
          expense({ event_id: 'E-OUT', amount: null }),
          expense({ event_id: 'E-AFTER', amount: 1000, expected_at: '2026-09-05' }),
          expense({ event_id: 'E-DEP', event_kind: 'RETURN', amount: null, expected_at: null }),
        )
      }),
    )
    expect(refsOf(result, 'MISSING_KEY_INFO')).toEqual(['E-OUT'])
    expect(result.nodes.map((node) => node.trigger.eventIds)).toEqual([[], ['E-BEFORE']])
  })

  test('日期未知的流出无法定位，局部检查在起始节点之后截断', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(
          expense({ event_id: 'E-UNDATED', amount: 1000, expected_at: null }),
          expense({ event_id: 'E-LATER', amount: 1000, expected_at: '2026-09-05' }),
        )
      }),
    )
    expect(refsOf(result, 'MISSING_KEY_INFO')).toEqual(['E-UNDATED'])
    expect(result.nodes.map((node) => node.trigger.eventIds)).toEqual([[]])
  })

  test('T010-03 住宿待填时附已确认的局部缺口：9/10 后 C=400、A=0、H=U=-100，保护性资金缺口 100；局部检查截至待填的住宿付款', () => {
    const { input, ops } = loadVector('T010-03')
    const result = run(input, ops)
    const lodging = planItemId('C01', 1, 'LODGING')
    expect(refsOf(result, 'MISSING_KEY_INFO')).toContain(lodging)
    const node = nodeAt(result, '2026-09-10')
    expect(figures(node)).toMatchObject({ C: 40000, A: 0, H: -10000, U: -10000 })
    expect([node.nodeVerdict, node.amount?.value]).toEqual(['PROTECTED_SHORTFALL', 10000])
    expect(result.earliestGap).toMatchObject({ nodeVerdict: 'PROTECTED_SHORTFALL', amount: { value: 10000 } })
    expect(result.nodes.map((entry) => entry.at)).toEqual([input.snapshot.as_of, '2026-09-10'])
  })

  test('现金未知时不逐节点计算，报 MISSING_KEY_INFO', () => {
    const result = run(
      withCase((draft) => {
        draft.snapshot.cash = null
      }),
    )
    expect(result.nodes).toEqual([])
    expect(refsOf(result, 'MISSING_KEY_INFO')).toContain('snapshot.cash')
  })

  test('覆盖关系指向不存在的预留时按未覆盖处理，报 REFERENCE_INVALID', () => {
    const result = run(
      withCase((draft) => {
        draft.events.push(expense({ coverage: [covered('R-NONE', 20000)] }))
      }),
    )
    expect(refsOf(result, 'REFERENCE_INVALID')).toEqual(['R-NONE'])
    expect(nodeOf(result, 'E1').paymentHeadroom.value).toBe(nth(result, 0).paymentHeadroom.value - 20000)
  })
})

describe('已有本目标付款的项目（D75）', () => {
  /** 住宿定金 100 已在 8/20 付清并计入快照；候选 C01 的住宿价格项 300 在 9/27 付款 */
  function depositCase(overrides: Partial<Item> = {}): CaseFile {
    return planCase([item('LODGING', '2026-09-27', 30000, overrides)], (draft) => {
      draft.events.push(
        goalPayment('E-DEPOSIT', '2026-08-20', 10000, {
          event_status: 'ACTUAL',
          actual_at: '2026-08-20T12:00:00+08:00',
          time_precision: 'DATETIME',
          in_snapshot: true,
          cost_item_id: 'LODGING',
        }),
      )
    })
  }

  const LODGING_ID = planItemId('C01', 0, 'LODGING')

  test('T002-05 门票已付 580 时，C02 同票档报价 520 是另一报价，不在时间轴上付款', () => {
    const { input, ops } = loadVector('T002-05')
    const result = run(input, ops)
    expect(triggered(result)).not.toContain(planItemId('C02', 1, 'TICKET'))
    expect(triggered(result)).toContain(planItemId('C02', 0, 'LODGING'))
  })

  test('没有 settles_event_id 时，已付项目的价格项不付款', () => {
    expect(triggered(run(depositCase(), [SELECT]))).not.toContain(LODGING_ID)
  })

  test('带 settles_event_id 的价格项是定金之后的尾款，照常付款（T015-04）', () => {
    const result = run(depositCase({ settles_event_id: 'E-DEPOSIT' }), [SELECT])
    const node = nodeOf(result, LODGING_ID)
    expect(nth(result, 0).cash.value - node.cash.value).toBe(30000)
    expect(codes(result)).not.toContain('REFERENCE_INVALID')
  })

  test('settles_event_id 指向不存在或别的项目的付款时报 REFERENCE_INVALID，该价格项仍付款', () => {
    const missing = run(depositCase({ settles_event_id: 'E-NONE' }), [SELECT])
    expect(refsOf(missing, 'REFERENCE_INVALID')).toEqual(['E-NONE'])
    expect(triggered(missing)).toContain(LODGING_ID)
    const other = depositCase({ settles_event_id: 'E-TICKET' })
    other.events.push(goalPayment('E-TICKET', '2026-09-05', 58000, { cost_item_id: 'TICKET' }))
    const mismatched = run(other, [SELECT])
    expect(refsOf(mismatched, 'REFERENCE_INVALID')).toEqual(['E-TICKET'])
    expect(triggered(mismatched)).toContain(LODGING_ID)
  })
})

describe('T005-06 gap', () => {
  test('T005-06 gap 预测降价不生成流入，只体现为 C02 的预计消费净支出较低', () => {
    const { input, ops } = loadVector('T005-06')
    const data = structuredClone(input)
    data.price_series = [
      {
        series_id: 'S-LODGING',
        cost_item_id: 'LODGING',
        channel: '渠道乙',
        spec: '大床房',
        service_date: '2026-09-10',
        observed_on: '2026-09-01',
        price: 60000,
        currency: 'CNY',
        ...RECORDED,
      },
    ]
    const priced = priceCandidates(normalize(data))
    const net = (id: string) => priced.find((row) => row.candidateId === id)?.netSpend?.value ?? null
    expect(net('C01')).not.toBeNull()
    expect((net('C01') ?? 0) - (net('C02') ?? 0)).toBe(5000)
    const result = run(data, ops)
    const start = nth(result, 0)
    expect([start.cash.value, start.unallocated.value]).toEqual([100000, 10000])
    expect(result.nodes.some((node) => node.trigger.kind === 'INCOME')).toBe(false)
    expect(result.nodes.filter((node) => node.trigger.kind === 'OTHER').map((node) => node.trigger.eventIds)).toEqual([[RELEASE_ID]])
    const lodging = only(
      result.nodes.filter((node) => node.trigger.kind === 'OUTFLOW'),
      'C02 的住宿付款',
    )
    expect(start.cash.value - lodging.cash.value).toBe(net('C02'))
  })
})

describe('性质', () => {
  test('已计入快照的事件不改变未来各节点的现金（R002）', () => {
    const asOf = '2026-09-10T09:00:00+08:00'
    const build = (history: CaseEvent[]) =>
      planCase([item('TICKET', '2026-09-20', 30000)], (draft) => {
        draft.snapshot.as_of = asOf
        draft.snapshot.cash_as_of = asOf
        draft.events.push(
          expense({ event_id: 'E-F1', amount: 5000, expected_at: '2026-09-12' }),
          income('E-F2', '2026-09-15', 10000),
          ...history,
        )
      })
    const cashOf = (result: ResultCore) => result.nodes.map((node) => [node.trigger.eventIds, node.cash.value])
    const baseline = cashOf(run(build([]), [SELECT]))
    const row = fc.record({
      kind: fc.constantFrom('GOAL_PAYMENT', 'OTHER_EXPENSE', 'INCOME', 'RETURN'),
      amount: fc.integer({ min: 1, max: 100000 }),
      date: fc.integer({ min: 1, max: 9 }),
    })
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), (rows) => {
        const history = rows.map((entry, index) =>
          expense({
            event_id: `E-H${index}`,
            event_kind: entry.kind,
            event_status: 'ACTUAL',
            amount: entry.amount,
            expected_at: `${day(entry.date)}T12:00:00+08:00`,
            actual_at: `${day(entry.date)}T12:00:00+08:00`,
            time_precision: 'DATETIME',
            in_snapshot: true,
            ...(entry.kind === 'GOAL_PAYMENT' || entry.kind === 'RETURN' ? { goal_id: 'G1' } : {}),
          }),
        )
        const result = run(build(history), [SELECT])
        expect(codes(result)).not.toContain('SNAPSHOT_PHASE_MISMATCH')
        expect(cashOf(result)).toEqual(baseline)
      }),
      { numRuns: 50 },
    )
  })

  test('H′＝H－(x－q)：q 不超过声明额、剩余预留和 x；本目标付款只以未覆盖部分冲减 A（§2、D06、D07）', () => {
    const row = fc.record({
      goal: fc.boolean(),
      amount: fc.integer({ min: 1, max: 80000 }),
      living: fc.integer({ min: 0, max: 80000 }),
      contingency: fc.integer({ min: 0, max: 80000 }),
      allocation: fc.integer({ min: 0, max: 80000 }),
      coverLiving: fc.integer({ min: 0, max: 80000 }),
      coverContingency: fc.integer({ min: 0, max: 80000 }),
    })
    fc.assert(
      fc.property(row, (entry) => {
        const result = run(
          withCase((draft) => {
            draft.snapshot.goal_allocation = entry.allocation
            for (const reserve of draft.reserves) reserve.amount = reserve.reserve_kind === 'LIVING' ? entry.living : entry.contingency
            const coverage = [covered('R-LIV-09', entry.coverLiving), covered('R-CON', entry.coverContingency)]
            draft.events.push(
              entry.goal ? goalPayment('E1', '2026-09-10', entry.amount, { coverage }) : expense({ amount: entry.amount, coverage }),
            )
          }),
        )
        const start = nth(result, 0)
        const node = nodeOf(result, 'E1')
        const takenLiving = start.livingReserve.value - node.livingReserve.value
        const takenContingency = start.contingencyReserve.value - node.contingencyReserve.value
        const q = takenLiving + takenContingency
        const declared = entry.coverLiving + entry.coverContingency
        const withinSpend = Math.min(entry.coverLiving, entry.living) + Math.min(entry.coverContingency, entry.contingency)
        expect(takenLiving).toBeGreaterThanOrEqual(0)
        expect(takenLiving).toBeLessThanOrEqual(Math.min(entry.coverLiving, entry.living))
        expect(takenContingency).toBeGreaterThanOrEqual(0)
        expect(takenContingency).toBeLessThanOrEqual(Math.min(entry.coverContingency, entry.contingency))
        expect(q).toBe(declared > entry.amount ? 0 : Math.min(entry.amount, withinSpend))
        expect(node.cash.value).toBe(start.cash.value - entry.amount)
        expect(node.paymentHeadroom.value).toBe(start.paymentHeadroom.value - (entry.amount - q))
        expect(start.goalAllocation.value - node.goalAllocation.value).toBe(
          entry.goal ? Math.min(entry.amount - q, entry.allocation) : 0,
        )
      }),
    )
  })

  test('加一笔未覆盖流出，最早缺口不会变晚', () => {
    const row = fc.record({
      kind: fc.constantFrom('OTHER_EXPENSE', 'INCOME', 'GOAL_PAYMENT'),
      date: fc.integer({ min: 1, max: 30 }),
      amount: fc.integer({ min: 1000, max: 60000 }),
      cover: fc.integer({ min: 0, max: 30000 }),
    })
    const extra = fc.record({
      goal: fc.boolean(),
      month: fc.constantFrom(9, 10, 11, 12),
      date: fc.integer({ min: 1, max: 28 }),
      amount: fc.integer({ min: 1, max: 80000 }),
    })
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), fc.integer({ min: 0, max: 60000 }), extra, (rows, allocation, more) => {
        const events = rows.map((entry, index) => {
          const id = `E${index}`
          const at = day(entry.date)
          if (entry.kind === 'INCOME') return income(id, at, entry.amount)
          const coverage = entry.cover > 0 ? [covered('R-LIV-09', Math.min(entry.cover, entry.amount))] : []
          return entry.kind === 'GOAL_PAYMENT'
            ? goalPayment(id, at, entry.amount, { coverage })
            : expense({ event_id: id, amount: entry.amount, expected_at: at, coverage })
        })
        const addedAt = day(more.date, more.month)
        const added = more.goal
          ? goalPayment('E-ADD', addedAt, more.amount)
          : expense({ event_id: 'E-ADD', amount: more.amount, expected_at: addedAt })
        const make = (list: CaseEvent[]) =>
          planCase([], (draft) => {
            draft.snapshot.goal_allocation = allocation
            draft.events.push(...list)
          })
        const before = run(make(events), [SELECT]).earliestGap
        const after = run(make([...events, added]), [SELECT]).earliestGap
        if (before === null) return
        expect(after).not.toBeNull()
        expect((after?.at ?? '').slice(0, 10) <= before.at.slice(0, 10)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  test('流出组的覆盖声明未超额时，组末结果与组内执行次序无关（D10、D38）', () => {
    const row = fc.record({
      goal: fc.boolean(),
      amount: fc.integer({ min: 1, max: 30000 }),
      living: fc.integer({ min: 0, max: 5000 }),
      contingency: fc.integer({ min: 0, max: 5000 }),
    })
    fc.assert(
      fc.property(fc.array(row, { minLength: 2, maxLength: 4 }), fc.integer({ min: 0, max: 60000 }), (rows, allocation) => {
        const group = (idOf: (index: number) => string) =>
          run(
            withCase((draft) => {
              draft.snapshot.goal_allocation = allocation
              rows.forEach((entry, index) => {
                const living = Math.min(entry.living, entry.amount)
                const coverage = [
                  covered('R-LIV-09', living),
                  covered('R-CON', Math.min(entry.contingency, entry.amount - living)),
                ]
                const id = idOf(index)
                draft.events.push(
                  entry.goal
                    ? goalPayment(id, '2026-09-10', entry.amount, { coverage })
                    : expense({ event_id: id, amount: entry.amount, expected_at: '2026-09-10', coverage }),
                )
              })
            }),
          )
        const forward = nodeOf(group((index) => `E${index}`), 'E0')
        const backward = nodeOf(group((index) => `E${rows.length - 1 - index}`), 'E0')
        expect(forward.trigger.kind).toBe('OUTFLOW_GROUP')
        expect(figures(backward)).toEqual(figures(forward))
        expect(backward.nodeVerdict).toBe(forward.nodeVerdict)
      }),
    )
  })

  test('D36：本目标付款使 U 由非负变为负时，A 已冲减为 0，U=H<0，节点为保护性资金缺口', () => {
    const row = fc.record({
      cash: fc.integer({ min: 50000, max: 150000 }),
      allocation: fc.integer({ min: 0, max: 50000 }),
      amount: fc.integer({ min: 1, max: 150000 }),
      cover: fc.integer({ min: 0, max: 30000 }),
    })
    fc.assert(
      fc.property(row, (entry) => {
        fc.pre(entry.cash - 50000 - entry.allocation >= 0)
        const result = run(
          withCase((draft) => {
            draft.snapshot.cash = entry.cash
            draft.snapshot.goal_allocation = entry.allocation
            const coverage = entry.cover > 0 ? [covered('R-LIV-09', Math.min(entry.cover, entry.amount))] : []
            draft.events.push(goalPayment('E1', '2026-09-10', entry.amount, { coverage }))
          }),
        )
        const node = nodeOf(result, 'E1')
        if (node.unallocated.value >= 0) return
        expect(node.goalAllocation.value).toBe(0)
        expect(node.unallocated.value).toBe(node.paymentHeadroom.value)
        expect(node.protectedTotal.value).toBeGreaterThan(node.cash.value)
        expect(node.nodeVerdict).toBe('PROTECTED_SHORTFALL')
        expect(node.amount?.value).toBe(-node.unallocated.value)
      }),
    )
  })

  test('D34：保护性资金缺口的两项计算依据之和为 -U；结果符合 ResultCore', () => {
    const row = fc.record({
      cash: fc.integer({ min: 0, max: 120000 }),
      allocation: fc.integer({ min: 0, max: 60000 }),
      spend: fc.integer({ min: 1, max: 80000 }),
    })
    fc.assert(
      fc.property(row, (entry) => {
        const result = run(
          planCase([item('TICKET', '2026-09-10', entry.spend)], (draft) => {
            draft.snapshot.cash = entry.cash
            draft.snapshot.goal_allocation = entry.allocation
            draft.events.push(expense({ amount: entry.spend }))
          }),
          [SELECT],
        )
        for (const node of result.nodes) {
          if (node.nodeVerdict !== 'PROTECTED_SHORTFALL') continue
          expect(node.protectedOverCash?.value).toBe(node.protectedTotal.value - node.cash.value)
          expect(node.allocationUnsupported?.value).toBe(node.goalAllocation.value)
          expect((node.protectedOverCash?.value ?? 0) + (node.allocationUnsupported?.value ?? 0)).toBe(-node.unallocated.value)
          expect(node.amount?.value).toBe(-node.unallocated.value)
        }
        expect(resultCoreSchema.safeParse(result).success).toBe(true)
      }),
    )
  })
})
