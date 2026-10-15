import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { planVersionOf } from '../../src/engine/confirm/index.ts'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { buildCost } from '../../src/engine/cost/index.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { normalize } from '../../src/engine/normalize/index.ts'
import { opsSchema, type Op } from '../../src/engine/ops/index.ts'
import { priceCandidates } from '../../src/engine/pricing/index.ts'
import { LABEL_TEXT, type ResultCore } from '../../src/engine/result.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import { buildSnapshot } from '../../src/engine/snapshot/index.ts'
import { REPO_ROOT } from '../lib/vector.ts'
import { RECORDED } from './samples.ts'

type Node = ResultCore['nodes'][number]
type Task = ResultCore['actionList'][number]
type Confirmation = NonNullable<ResultCore['confirmation']>
type CaseEvent = CaseFile['events'][number]

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

function at(data: CaseFile, ops: readonly Op[], label: string): ResultCore {
  const result = evaluate(data, ops, DEMO_CFG_1).checkpoints.find((item) => item.label === label)?.result
  if (result === undefined) throw new Error(`没有检查点 ${label}`)
  return result
}

function select(candidateId: string): Op {
  return { type: 'SELECT_CANDIDATE', candidate_id: candidateId }
}

function confirmOp(candidateId: string, inputVersion = 'v1'): Op {
  return { type: 'CONFIRM', candidate_id: candidateId, plan_version: `${candidateId}@v1`, input_version: inputVersion }
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

/** §1 的 C、A、H、U */
function pick(node: Node): Record<'C' | 'A' | 'H' | 'U', number> {
  return {
    C: node.cash.value,
    A: node.goalAllocation.value,
    H: node.paymentHeadroom.value,
    U: node.unallocated.value,
  }
}

function lowestU(result: ResultCore): number {
  return Math.min(...result.nodes.map((node) => node.unallocated.value))
}

function record(result: ResultCore): Confirmation {
  const confirmation = result.confirmation
  if (confirmation === null) throw new Error('没有确认记录')
  return confirmation
}

function taskOf(result: ResultCore, costItemId: string): Task {
  return only(
    result.actionList.filter((task) => task.costItemId === costItemId),
    `${costItemId} 的任务`,
  )
}

function income(eventId: string, amount: number, expectedAt: string): CaseEvent {
  return {
    event_id: eventId,
    event_kind: 'INCOME',
    event_status: 'EXPECTED',
    amount,
    expected_at: expectedAt,
    time_precision: 'DATE',
    in_snapshot: false,
    coverage: [],
    ...RECORDED,
    currency: 'CNY',
  }
}

function eventOf(data: CaseFile, eventId: string): CaseEvent {
  const event = data.events.find((item) => item.event_id === eventId)
  if (event === undefined) throw new Error(`没有事件 ${eventId}`)
  return event
}

function itemOf(data: CaseFile, candidateId: string, index: number): CaseFile['candidates'][number]['items'][number] {
  const item = data.candidates.find((row) => row.candidate_id === candidateId)?.items[index]
  if (item === undefined) throw new Error(`没有 ${candidateId} 的第 ${index} 个价格项`)
  return item
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

describe('D46 确认时的建议分配额与计划分配', () => {
  test('T017-04 W=850、m=200、ΔA=300：确认后 A=300、U0=200，计划分配 550 挂在 9/20 收入上，不计入当前 A 和 U0', () => {
    const { input, ops } = loadVector('T017-04')
    const before = at(input, ops, '确认前')
    expect(before.snapshot?.goalAllocation.value).toBe(0)
    expect(nodeAt(before, '2026-09-05').unallocated.value).toBe(20000)
    const after = at(input, ops, '确认后')
    const confirmation = record(after)
    expect(confirmation).toMatchObject({ candidateId: 'C02', planVersion: 'C02@v1', inputVersion: 'v1' })
    expect([confirmation.w.value, confirmation.m.value, confirmation.deltaA.value]).toEqual([85000, 20000, 30000])
    expect(confirmation.plannedAllocation?.fundingEventId).toBe('E-INC')
    expect(confirmation.plannedAllocation?.amount.value).toBe(55000)
    expect(confirmation.unallocatedNote).toBeNull()
    expect(after.snapshot?.cash.value).toBe(100000)
    expect([after.snapshot?.goalAllocation.value, after.snapshot?.unallocated.value]).toEqual([30000, 20000])
    expect(pick(nth(after, 0))).toMatchObject({ A: 30000, U: 20000 })
    expect(pick(nodeAt(after, '2026-09-05'))).toMatchObject({ A: 0, H: 20000, U: 20000 })
    expect(pick(nodeOf(after, 'E-INC'))).toEqual({ C: 130000, A: 55000, H: 80000, U: 25000 })
    expect(pick(nodeAt(after, '2026-09-25'))).toEqual({ C: 75000, A: 0, H: 25000, U: 25000 })
    expect(lowestU(after)).toBe(confirmation.m.value)
    expect(after.states.confirmationState).toBe('CONFIRMED')
    expect(after.inputVersion).toBe('v2')
  })

  test('T017-10 ①W−A0=200 时 ΔA=200，没有可挂计划分配的收入；②W=300≤A0 时 ΔA=0，确认后 A 仍为 400', () => {
    const first = loadVector('T017-10#1')
    const one = run(first.input, first.ops)
    const c1 = record(one)
    expect(c1.w.value - first.input.snapshot.goal_allocation).toBe(20000)
    expect([c1.m.value, c1.deltaA.value]).toEqual([10000, 20000])
    expect(c1.plannedAllocation).toBeNull()
    expect([one.snapshot?.goalAllocation.value, one.snapshot?.unallocated.value]).toEqual([60000, 10000])
    expect(nth(one, 0).unallocated.value).toBe(10000)
    expect(pick(nodeAt(one, '2026-09-10'))).toEqual({ C: 40000, A: 0, H: 10000, U: 10000 })
    expect(lowestU(one)).toBe(10000)
    expect(one.states.confirmationState).toBe('CONFIRMED')
    const second = loadVector('T017-10#2')
    const two = run(second.input, second.ops)
    const c2 = record(two)
    expect(c2.w.value).toBe(30000)
    expect(c2.w.value).toBeLessThanOrEqual(second.input.snapshot.goal_allocation)
    expect(c2.deltaA.value).toBe(0)
    expect(two.snapshot?.goalAllocation.value).toBe(40000)
    expect(two.states.confirmationState).toBe('CONFIRMED')
  })

  test('T017-11 确认前按 A=0 模拟各节点通过、最小 U=400；ΔA=0，A0 仍为 0，计划分配 600 挂在 9/8 收入上', () => {
    const { input, ops } = loadVector('T017-11')
    const before = at(input, ops, '确认前')
    expect(before.nodes.every((node) => node.nodeVerdict === 'PASS')).toBe(true)
    expect(nodeOf(before, 'E-0905').unallocated.value).toBe(40000)
    expect(nodeAt(before, '2026-09-10').unallocated.value).toBe(40000)
    expect(lowestU(before)).toBe(40000)
    const after = at(input, ops, '确认后')
    const confirmation = record(after)
    expect([confirmation.m.value, confirmation.deltaA.value]).toEqual([40000, 0])
    expect(confirmation.plannedAllocation?.fundingEventId).toBe('E-INC')
    expect(confirmation.plannedAllocation?.amount.value).toBe(60000)
    expect(after.snapshot?.goalAllocation.value).toBe(0)
    expect(pick(nodeOf(after, 'E-0905'))).toMatchObject({ C: 40000, A: 0, U: 40000 })
    expect(pick(nodeOf(after, 'E-INC'))).toMatchObject({ C: 100000, A: 60000, U: 40000 })
    expect(pick(nodeAt(after, '2026-09-10'))).toMatchObject({ C: 40000, A: 0, U: 40000 })
    expect(lowestU(after)).toBe(40000)
    expect(after.states.confirmationState).toBe('CONFIRMED')
  })

  test('T017-12 确认前最小 U=100；ΔA=100，计划分配 500 挂在 9/8；确认后各节点 U 的最小值仍为 100', () => {
    const { input, ops } = loadVector('T017-12')
    expect(lowestU(run(input, [select('C01')]))).toBe(10000)
    const after = run(input, ops)
    const confirmation = record(after)
    expect([confirmation.m.value, confirmation.deltaA.value]).toEqual([10000, 10000])
    expect(confirmation.plannedAllocation?.fundingEventId).toBe('E-INC')
    expect(confirmation.plannedAllocation?.amount.value).toBe(50000)
    expect(pick(nth(after, 0))).toMatchObject({ A: 10000, U: 40000 })
    expect(pick(nodeOf(after, 'E-0905'))).toMatchObject({ C: 70000, A: 10000, U: 10000 })
    expect(pick(nodeOf(after, 'E-INC'))).toMatchObject({ C: 120000, A: 60000, U: 10000 })
    expect(pick(nodeAt(after, '2026-09-10'))).toMatchObject({ C: 60000, A: 0, U: 10000 })
    expect(lowestU(after)).toBe(10000)
    expect(after.states.confirmationState).toBe('CONFIRMED')
  })

  test('D46 已指定计划分配所挂收入时挂在指定收入上；未指定时挂在最早到账的已确认预计收入上', () => {
    const { input, ops } = loadVector('T017-12')
    const specified = structuredClone(input)
    specified.events.push({ ...structuredClone(eventOf(input, 'E-INC')), event_id: 'E-INC2', expected_at: '2026-09-09' })
    specified.planned_allocation = { funding_event_id: 'E-INC2', amount: 0 }
    const chosen = run(specified, ops)
    expect(record(chosen).plannedAllocation?.fundingEventId).toBe('E-INC2')
    expect(lowestU(chosen)).toBeGreaterThanOrEqual(record(chosen).m.value)
    const unspecified = structuredClone(specified)
    unspecified.planned_allocation = null
    expect(record(run(unspecified, ops)).plannedAllocation?.fundingEventId).toBe('E-INC')
  })

  test('D46 计划分配只挂在最后一笔目标付款之前到账的已确认预计收入上，没有这样的收入就不建', () => {
    const { input, ops } = loadVector('T017-10#1')
    for (const day of ['2026-09-12', '2026-09-10']) {
      const data = structuredClone(input)
      data.events.push(income('E-LATE', 50000, day))
      const result = run(data, ops)
      expect(result.states.confirmationState, day).toBe('CONFIRMED')
      expect(record(result).plannedAllocation, day).toBeNull()
    }
  })

  test('D46、D06 仍未分配的部分注明“届时由未分配资金支付”', () => {
    const { input, ops } = loadVector('T017-11')
    const data = structuredClone(input)
    const refund = eventOf(data, 'E-INC')
    refund.event_kind = 'RETURN'
    refund.goal_id = 'G2'
    const after = at(data, ops, '确认后')
    const confirmation = record(after)
    expect(confirmation.plannedAllocation).toBeNull()
    expect(confirmation.unallocatedNote?.value).toBe(confirmation.w.value - data.snapshot.goal_allocation - confirmation.deltaA.value)
    expect(confirmation.unallocatedNote?.value).toBe(60000)
    expect(after.labels).toContain('PAID_BY_UNALLOCATED_LATER')
    expect(LABEL_TEXT.PAID_BY_UNALLOCATED_LATER).toBe('届时由未分配资金支付')
  })

  test('§11.3 待用户确认时给出建议分配额预览，与确认后写入的记录相同，但不写入主记录', () => {
    const { input, ops } = loadVector('T017-04')
    const before = at(input, ops, '确认前')
    const after = at(input, ops, '确认后')
    expect(before.states.confirmationState).toBe('PENDING_CONFIRMATION')
    expect(before.confirmation).toEqual(after.confirmation)
    expect(before.snapshot?.goalAllocation.value).toBe(0)
    expect(nodeOf(before, 'E-INC').goalAllocation.value).toBe(0)
    expect(before.actionList).toEqual([])
  })
})

describe('R017 第4条、D46 草案', () => {
  test('T017-08 有保护性资金缺口时只能保存为草案，不写入正式分配，A0 仍为 400', () => {
    const { input, ops } = loadVector('T017-08')
    const draft = run(input, ops)
    const selected = run(
      input,
      ops.filter((op) => op.type !== 'CONFIRM'),
    )
    expect(draft.states.confirmationState).toBe('DRAFT')
    expect(draft.snapshot?.goalAllocation.value).toBe(40000)
    expect(draft.earliestGap).toMatchObject({ nodeVerdict: 'PROTECTED_SHORTFALL', at: '2026-09-05' })
    expect(draft.earliestGap?.amount.value).toBe(30000)
    expect(draft.snapshot).toEqual(selected.snapshot)
    expect(draft.nodes).toEqual(selected.nodes)
    expect(draft.inputVersion).toBe('v1')
    expect(draft.actionList).toEqual([])
    expect(draft.confirmation).toBeNull()
    expect(draft.labels).toEqual(expect.arrayContaining(['DRAFT_PREVIEW', 'PREVIEW_UNCONFIRMED']))
  })

  test('D46 存在约束问题或暂无法完整判断的方案同样只能保存为草案', () => {
    const { input, ops } = loadVector('T017-04')
    const edits: ((draft: CaseFile) => void)[] = [
      (draft) => {
        draft.goal.budget_cap = 80000
      },
      (draft) => {
        const later = itemOf(draft, 'C02', 1)
        later.price = null
        later.price_basis = 'PENDING'
      },
    ]
    for (const edit of edits) {
      const data = structuredClone(input)
      edit(data)
      const before = at(data, ops, '确认前')
      const after = at(data, ops, '确认后')
      expect(before.states.planState).not.toBe('FEASIBLE_UNDER_ASSUMPTIONS')
      expect(after.states.confirmationState).toBe('DRAFT')
      expect(after.snapshot).toEqual(before.snapshot)
      expect(after.nodes).toEqual(before.nodes)
      expect(after.inputVersion).toBe('v1')
      expect(after.confirmation).toBeNull()
      expect(after.actionList).toEqual([])
    }
  })

  test('R017 旧方案版本不能直接确认：plan_version 不是该候选当前版本时报引用无效，只存草案', () => {
    const { input } = loadVector('T017-04')
    const result = run(input, [select('C02'), { type: 'CONFIRM', candidate_id: 'C02', plan_version: 'C02@v0', input_version: 'v1' }])
    expect(result.states.confirmationState).toBe('DRAFT')
    expect(result.inputIssues).toEqual(expect.arrayContaining([{ code: 'REFERENCE_INVALID', rule: 'R017', refs: ['C02@v0'] }]))
    expect(result.snapshot?.goalAllocation.value).toBe(0)
    expect(result.inputVersion).toBe('v1')
  })

  test('CONFIRM 用的方案版本与候选比较给出的 plan_version 写法相同；CONFIRM 同时选中该候选', () => {
    const { input, ops } = loadVector('T017-12')
    const compared = run(input)
    for (const row of compared.candidates) expect(row.planVersion).toBe(planVersionOf(row.candidateId))
    expect(run(input, ops.filter((op) => op.type !== 'SELECT_CANDIDATE'))).toEqual(run(input, ops))
  })

  test('R017 第1条 替换方案确认不成时，保留原有已确认方案、分配和行动清单', () => {
    const { input } = loadVector('T013-07')
    const data = structuredClone(input)
    itemOf(data, 'C01', 0).price = 200000
    const kept = run(data)
    const attempted = run(data, [select('C01'), confirmOp('C01')])
    expect(attempted.states).toMatchObject({ confirmationState: 'CONFIRMED', planTarget: 'CONFIRMED_PLAN' })
    expect(attempted.snapshot).toEqual(kept.snapshot)
    expect(attempted.actionList).toEqual(kept.actionList)
    expect(attempted.inputVersion).toBe('v1')
  })
})

describe('D63 过期确认的复查', () => {
  test('T017-02 输入版本过期时先按 v2 重新检查，通过后直接确认，确认记录的输入版本为 v2', () => {
    const { input, ops } = loadVector('T017-02')
    expect(at(input, ops, 'v1').inputVersion).toBe('v1')
    const confirmed = at(input, ops, '确认')
    expect(confirmed.states.confirmationState).toBe('CONFIRMED')
    expect(record(confirmed).inputVersion).toBe('v2')
    expect(confirmed.inputVersion).toBe('v3')
    const current = ops.map((op) => (op.type === 'CONFIRM' ? { ...op, input_version: 'v2' } : op))
    expect(at(input, current, '确认')).toEqual(confirmed)
  })

  test('D63 复查后不能写入正式安排时只保存为草案，不写入 v1 的分配结论', () => {
    const { input, ops } = loadVector('T017-02')
    const heavier = ops.map((op) => (op.type === 'ADD_LIVING_EXPENSE' ? { ...op, amount: 50000 } : op))
    const result = at(input, heavier, '确认')
    expect(result.states.planState).toBe('PAYMENT_GAP')
    expect(result.states.confirmationState).toBe('DRAFT')
    expect(result.snapshot?.goalAllocation.value).toBe(0)
    expect(nodeOf(result, 'E-INC').goalAllocation.value).toBe(0)
    expect(result.confirmation).toBeNull()
    expect(result.inputVersion).toBe('v2')
  })
})

describe('R017 第5条 重复确认', () => {
  test('T017-03 同一方案版本和输入版本连续提交两次：A 只建立一次为 300，付款任务各一条，计划分配 550 只建立一次', () => {
    const { input, ops } = loadVector('T017-03')
    const first = at(input, ops, '第1次确认')
    const second = at(input, ops, '第2次确认')
    for (const result of [first, second]) {
      expect(result.snapshot?.goalAllocation.value).toBe(30000)
      expect(result.actionList.filter((task) => task.paymentAt === '2026-09-05')).toHaveLength(1)
      expect(result.actionList.filter((task) => task.paymentAt === '2026-09-25')).toHaveLength(1)
      expect(record(result).plannedAllocation?.fundingEventId).toBe('E-INC')
      expect(record(result).plannedAllocation?.amount.value).toBe(55000)
      expect(nodeOf(result, 'E-INC').goalAllocation.value).toBe(55000)
    }
    expect(second).toEqual(first)
    expect(second.inputVersion).toBe('v2')
  })

  test('R017 第5条 案例已有确认记录时，再次提交同一确认不改记录、不加版本', () => {
    const { input } = loadVector('T017-09')
    const plain = run(input)
    const again = run(input, [confirmOp('C02')])
    expect(again).toEqual(plain)
    expect(again.inputVersion).toBe('v1')
  })
})

describe('R017 第7—10条 行动清单', () => {
  test('T017-09 每项待购任务都包含项目和规格、购买日期、渠道、优惠步骤、预计支付金额、付款日期、待核价条件、任务状态和关联方案版本', () => {
    const { input } = loadVector('T017-09')
    const result = run(input)
    const items = input.candidates.find((row) => row.candidate_id === 'C02')?.items ?? []
    expect(result.actionList).toHaveLength(items.length)
    for (const item of items) {
      const task = taskOf(result, item.cost_item_id)
      const category = input.cost_items.find((row) => row.cost_item_id === item.cost_item_id)?.category
      expect(task).toMatchObject({
        costItemId: item.cost_item_id,
        category,
        spec: item.spec,
        purchaseDate: item.purchase_date,
        channel: item.channel,
        offerIds: [],
        paymentAt: item.payment_at,
        taskState: 'PENDING_PURCHASE',
        planVersion: 'C02@v1',
      })
      expect(task.amount?.value).toBe(item.price)
      expect(Array.isArray(task.pendingChecks)).toBe(true)
    }
  })

  test('T017-05 清单分别显示购买日 9/10 和付款日 9/27；时间轴的 400 流出在 9/27，不在 9/10', () => {
    const result = run(loadVector('T017-05').input)
    const task = taskOf(result, 'LODGING')
    expect([task.purchaseDate, task.paymentAt]).toEqual(['2026-09-10', '2026-09-27'])
    expect(task.amount?.value).toBe(40000)
    expect(nodeAt(result, '2026-09-27').trigger.kind).toBe('OUTFLOW')
    expect(result.nodes.some((node) => node.at === '2026-09-10')).toBe(false)
  })

  test('T017-06 以 9/11 的快照计算、未录入购买或付款记录时，9/10 的高铁任务仍为待购买', () => {
    const result = run(loadVector('T017-06').input)
    expect(taskOf(result, 'TRAIN-OUT').taskState).toBe('PENDING_PURCHASE')
  })

  test('T017-07 收入延期形成付款缺口时显示风险；渠道、购买日、付款日和优惠安排不变，不自动暂停或取消', () => {
    const { input, ops } = loadVector('T017-07')
    const delayed = run(input, ops)
    expect(delayed.states.planState).toBe('PAYMENT_GAP')
    expect(delayed.states.confirmationState).toBe('CONFIRMED')
    expect(delayed.actionList).toEqual(run(input).actionList)
    expect(taskOf(delayed, 'LODGING')).toMatchObject({
      channel: '渠道甲',
      purchaseDate: '2026-09-10',
      paymentAt: '2026-09-10',
      offerIds: [],
    })
  })

  test('T013-07 新预测显示别的渠道更便宜时，正式方案的渠道、购买日和优惠安排不变', () => {
    const result = run(loadVector('T013-07').input)
    expect(taskOf(result, 'LODGING')).toMatchObject({ channel: '渠道甲', purchaseDate: '2026-09-10', offerIds: [], planVersion: 'C02@v1' })
  })

  test('T017-01 选中未确认时不生成正式付款任务，A0 仍为 0、U0=500，资金日历同时标“草案预览”和“预览，未确认”', () => {
    const { input, ops } = loadVector('T017-01')
    const result = run(input, ops)
    expect([result.snapshot?.goalAllocation.value, result.snapshot?.unallocated.value]).toEqual([0, 50000])
    expect(result.actionList).toEqual([])
    expect(result.pendingDifferences).toEqual([])
    expect(result.states).toMatchObject({ confirmationState: 'PENDING_CONFIRMATION', planTarget: 'SELECTED_CANDIDATE' })
    expect(result.labels).toEqual(expect.arrayContaining(['DRAFT_PREVIEW', 'PREVIEW_UNCONFIRMED']))
  })

  test('T002-06、T015-03 门票已付时，购买任务和行动清单中都没有门票', () => {
    for (const id of ['T002-06', 'T015-03']) {
      const result = run(loadVector(id).input)
      expect(result.cost.paidPayments.find((line) => line.costItemId === 'TICKET')?.amount.value, id).toBe(58000)
      expect(result.actionList.map((task) => task.costItemId), id).toEqual(['LODGING'])
    }
  })

  test('D75 已购项目在候选中的另一报价不生成待购任务；带 settles_event_id 的尾款照常列入', () => {
    const paidTicket = structuredClone(loadVector('T002-06').input)
    const lodging = itemOf(paidTicket, 'C01', 0)
    paidTicket.candidates[0]?.items.push({ ...structuredClone(lodging), cost_item_id: 'TICKET', spec: 'B', price: 58000, order_id: 'O2' })
    expect(run(paidTicket).actionList.map((task) => task.costItemId)).toEqual(['LODGING'])
    const deposit = loadVector('T015-04').input
    expect(taskOf(run(deposit), 'LODGING').amount?.value).toBe(30000)
    const withoutSettles = structuredClone(deposit)
    const balance = itemOf(withoutSettles, 'C01', 0)
    delete balance.settles_event_id
    expect(run(withoutSettles).actionList).toEqual([])
  })

  test('R017 第7条、§12.7 待核价条件：估算价格须核价；用了优惠或依据已确认的预测估算时还须复核优惠条件', () => {
    const quoted = run(loadVector('T017-09').input)
    for (const task of quoted.actionList) expect(task.pendingChecks, task.costItemId).toEqual([])
    const estimate = structuredClone(loadVector('T017-09').input)
    itemOf(estimate, 'C02', 1).price_basis = 'REFERENCE'
    expect(taskOf(run(estimate), 'LODGING').pendingChecks).toEqual(['RECHECK_PRICE'])
    const forecast = run(loadVector('T020-09').input)
    expect(taskOf(forecast, 'LODGING').pendingChecks).toEqual(['RECHECK_PRICE', 'RECHECK_OFFER_CONDITIONS'])
    const offered = structuredClone(loadVector('T017-09').input)
    offered.offers.push({
      offer_id: 'Y1',
      type: 'INSTANT_OFF',
      value: 1000,
      scope: ['TICKET'],
      threshold: null,
      valid_from: '2026-09-01',
      valid_to: '2026-09-30',
      applies_at: 'ORDER',
      max_uses: 1,
      stackable_with: [],
      rounding: 'FLOOR',
    })
    offered.candidates[1]?.offers_used.push({ offer_id: 'Y1', order_id: 'O1' })
    const withOffer = run(offered)
    expect(taskOf(withOffer, 'TICKET')).toMatchObject({ offerIds: ['Y1'], pendingChecks: ['RECHECK_OFFER_CONDITIONS'] })
    expect(taskOf(withOffer, 'LODGING').offerIds).toEqual([])
  })

  test('R017 第10条 确认后价格变化只形成待确认差异：delta＝新金额−已确认金额，行动清单保持原金额', () => {
    const { input, ops } = loadVector('T017-04')
    const changed: Op[] = [
      ...ops,
      { type: 'PATCH', path: '/candidates/1/items/1/price', value: 60000 },
      { type: 'EVALUATE', label: '改价后' },
    ]
    const after = at(input, changed, '确认后')
    const repriced = at(input, changed, '改价后')
    expect(after.pendingDifferences).toEqual([])
    expect(repriced.actionList).toEqual(after.actionList)
    expect(repriced.pendingDifferences.map((row) => [row.costItemId, row.delta.value])).toEqual([['TICKET', 60000 - 55000]])
    expect(repriced.confirmation).toEqual(after.confirmation)
    expect(repriced.states.confirmationState).toBe('CONFIRMED')
  })

  test('R017 第9条 改变付款日期须再次确认：确认前行动清单保持原付款日，再次确认后才更新', () => {
    const { input, ops } = loadVector('T017-04')
    const data = structuredClone(input)
    itemOf(data, 'C02', 1).payment_windows = [{ window_id: 'W-0924', payment_at: '2026-09-24' }]
    const flow: Op[] = [
      ...ops,
      { type: 'CHANGE_PAYMENT_DATE', window_id: 'W-0924' },
      { type: 'EVALUATE', label: '改期后' },
      confirmOp('C02', 'v3'),
      { type: 'EVALUATE', label: '再次确认' },
    ]
    const moved = at(data, flow, '改期后')
    expect(moved.nodes.some((node) => node.at === '2026-09-24')).toBe(true)
    expect(moved.actionList.map((task) => task.paymentAt)).toEqual(['2026-09-05', '2026-09-25'])
    const reconfirmed = at(data, flow, '再次确认')
    expect(reconfirmed.actionList.map((task) => task.paymentAt)).toEqual(['2026-09-05', '2026-09-24'])
    expect(record(reconfirmed).inputVersion).toBe('v3')
    expect(reconfirmed.states.confirmationState).toBe('CONFIRMED')
  })
})

describe('向量缺口', () => {
  test('T015-04 gap 费用清单中住宿为 400，其中已付 100；只保留尾款 300 的付款任务', () => {
    const data = loadVector('T015-04').input
    const normalized = normalize(data)
    const candidateId = data.confirmed_plan?.candidate_id ?? null
    const report = buildCost({
      data: normalized,
      candidateId,
      priced: priceCandidates(normalized).find((row) => row.candidateId === candidateId),
      lifecycle: 'ACTIVE',
      snapshot: buildSnapshot(normalized),
    })
    expect(report.facts.find((fact) => fact.costItemId === 'LODGING')?.amount).toBe(40000)
    expect(report.cost.paidPayments.filter((line) => line.costItemId === 'LODGING').map((line) => line.amount.value)).toEqual([10000])
    const result = run(data)
    expect(result.actionList.filter((task) => task.costItemId === 'LODGING').map((task) => task.amount?.value)).toEqual([30000])
  })
})

/**
 * T017-04 的结构：C02 在 9/5、9/25 各付一笔本目标付款，E-INC 为已确认预计收入。
 * 另加一笔不属于本目标的支出和一笔其他目标的返还，使 U 先降后升，ΔA、计划分配才会停在上界之下。
 */
const BASE = loadVector('T017-04').input

const DRAW = fc.record({
  cash: fc.integer({ min: 0, max: 300_000 }),
  living: fc.integer({ min: 0, max: 60_000 }),
  contingency: fc.integer({ min: 0, max: 40_000 }),
  allocation: fc.integer({ min: 0, max: 100_000 }),
  first: fc.integer({ min: 0, max: 120_000 }),
  second: fc.integer({ min: 0, max: 120_000 }),
  income: fc.integer({ min: 0, max: 150_000 }),
  incomeDay: fc.constantFrom('2026-09-03', '2026-09-10', '2026-09-20', '2026-09-25', '2026-09-26'),
  other: fc.integer({ min: 0, max: 100_000 }),
  otherDay: fc.constantFrom('2026-09-03', '2026-09-15', '2026-09-22'),
  refund: fc.integer({ min: 0, max: 100_000 }),
  refundDay: fc.constantFrom('2026-09-04', '2026-09-16', '2026-09-23'),
})

type Draw = {
  cash: number
  living: number
  contingency: number
  allocation: number
  first: number
  second: number
  income: number
  incomeDay: string
  other: number
  otherDay: string
  refund: number
  refundDay: string
}

function caseOf(draw: Draw): CaseFile {
  const data = structuredClone(BASE)
  data.snapshot.cash = draw.cash
  data.snapshot.goal_allocation = draw.allocation
  data.goal.budget_cap = 1_000_000
  for (const reserve of data.reserves) reserve.amount = reserve.reserve_kind === 'LIVING' ? draw.living : draw.contingency
  const funding = eventOf(data, 'E-INC')
  funding.amount = draw.income
  funding.expected_at = draw.incomeDay
  data.events.push(
    { ...income('E-OTHER', draw.other, draw.otherDay), event_kind: 'OTHER_EXPENSE' },
    { ...income('E-REFUND', draw.refund, draw.refundDay), event_kind: 'RETURN', goal_id: 'G2' },
  )
  itemOf(data, 'C02', 0).price = draw.first
  itemOf(data, 'C02', 1).price = draw.second
  return data
}

/** 按给定的 A 和挂在 E-INC 上的计划分配，只选中 C02 不确认 */
function arranged(data: CaseFile, allocation: number, planned: number): CaseFile {
  const next = structuredClone(data)
  next.snapshot.goal_allocation = allocation
  next.planned_allocation = planned > 0 ? { funding_event_id: 'E-INC', amount: planned } : null
  return next
}

describe('性质', () => {
  test('R017 第5条 同一版本重复确认，结果不变', () => {
    fc.assert(
      fc.property(DRAW, (draw) => {
        const data = caseOf(draw)
        const ops: Op[] = [
          select('C02'),
          confirmOp('C02'),
          { type: 'EVALUATE', label: 'a' },
          confirmOp('C02'),
          { type: 'EVALUATE', label: 'b' },
          confirmOp('C02'),
          { type: 'EVALUATE', label: 'c' },
        ]
        const [first, second, third] = evaluate(data, ops, DEMO_CFG_1).checkpoints.map((item) => item.result)
        expect(second).toEqual(first)
        expect(third).toEqual(first)
      }),
      { numRuns: 50 },
    )
  })

  test('D46 ΔA 满足条件而 ΔA+1 不满足；计划分配在 ΔA 确定后按同一条件取最大值', () => {
    fc.assert(
      fc.property(DRAW, (draw) => {
        const data = caseOf(draw)
        const after = run(data, [select('C02'), confirmOp('C02')])
        if (after.states.confirmationState !== 'CONFIRMED') return
        const confirmation = record(after)
        const a0 = draw.allocation
        const w = draw.first + draw.second
        const m = confirmation.m.value
        const deltaA = confirmation.deltaA.value
        const lowestWith = (allocation: number, planned: number) => lowestU(run(arranged(data, allocation, planned), [select('C02')]))
        expect(confirmation.w.value).toBe(w)
        expect(m).toBe(lowestU(run(data, [select('C02')])))
        const upper = Math.max(0, w - a0)
        expect(deltaA).toBeGreaterThanOrEqual(0)
        expect(deltaA).toBeLessThanOrEqual(upper)
        expect(lowestWith(a0 + deltaA, 0)).toBeGreaterThanOrEqual(m)
        if (deltaA < upper) expect(lowestWith(a0 + deltaA + 1, 0)).toBeLessThan(m)
        const planned = confirmation.plannedAllocation?.amount.value ?? 0
        const plannedCap = Math.max(0, w - a0 - deltaA)
        expect(planned).toBeLessThanOrEqual(plannedCap)
        const lastPayment = draw.second > 0 ? '2026-09-25' : draw.first > 0 ? '2026-09-05' : null
        const eligible = draw.income > 0 && lastPayment !== null && draw.incomeDay < lastPayment
        if (!eligible) expect(confirmation.plannedAllocation).toBeNull()
        else {
          if (confirmation.plannedAllocation !== null) expect(confirmation.plannedAllocation.fundingEventId).toBe('E-INC')
          expect(lowestWith(a0 + deltaA, planned)).toBeGreaterThanOrEqual(m)
          if (planned < plannedCap) expect(lowestWith(a0 + deltaA, planned + 1)).toBeLessThan(m)
        }
        expect(confirmation.unallocatedNote?.value ?? 0).toBe(Math.max(0, w - a0 - deltaA - planned))
        expect(after.snapshot?.goalAllocation.value).toBe(a0 + deltaA)
      }),
      { numRuns: 120 },
    )
  })

  test('D46、R004 确认前不可行只存草案且不改主记录；可行则直接写入，A=A0+ΔA≥A0，确认后 U0≥0', () => {
    fc.assert(
      fc.property(DRAW, (draw) => {
        const data = caseOf(draw)
        const before = run(data, [select('C02')])
        const after = run(data, [select('C02'), confirmOp('C02')])
        const feasible = before.states.planState === 'FEASIBLE_UNDER_ASSUMPTIONS'
        expect(after.states.confirmationState).toBe(feasible ? 'CONFIRMED' : 'DRAFT')
        if (!feasible) {
          expect(after.snapshot).toEqual(before.snapshot)
          expect(after.nodes).toEqual(before.nodes)
          expect(after.inputVersion).toBe('v1')
          expect(after.actionList).toEqual([])
          expect(after.confirmation).toBeNull()
          return
        }
        expect(after.inputVersion).toBe('v2')
        expect(after.snapshot?.goalAllocation.value).toBe(draw.allocation + record(after).deltaA.value)
        expect(after.snapshot?.goalAllocation.value).toBeGreaterThanOrEqual(draw.allocation)
        expect(after.snapshot?.unallocated.value).toBeGreaterThanOrEqual(0)
        expect(lowestU(after)).toBeGreaterThanOrEqual(record(after).m.value)
      }),
      { numRuns: 120 },
    )
  })

  test('evaluate 不改输入：深冻结输入和操作后运行不报错，两次结果相同', () => {
    for (const id of ['T017-02', 'T017-03', 'T017-04', 'T017-08', 'T017-12', 'T013-07']) {
      const { input, ops } = loadVector(id)
      const frozen = deepFreeze(structuredClone(input))
      const frozenOps = deepFreeze(structuredClone(ops))
      const first = evaluate(frozen, frozenOps, DEMO_CFG_1)
      expect(evaluate(frozen, frozenOps, DEMO_CFG_1), id).toEqual(first)
    }
  })
})
