import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import {
  CONFIRMED_ONLY_SCENARIO,
  PROBE_ID,
  checkDaily,
  dailyProbe,
  dailyReference,
  dailyScenarios,
  maxPassing,
  type DailyContext,
  type DailyPlan,
  type DailyProbe,
  type DailyScenario,
} from '../../src/engine/daily/index.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { inputIssues } from '../../src/engine/issues/index.ts'
import { normalize } from '../../src/engine/normalize/index.ts'
import { applyMutation, opsSchema, type Op } from '../../src/engine/ops/index.ts'
import { priceCandidates } from '../../src/engine/pricing/index.ts'
import { LABEL_TEXT, resultCoreSchema, type ResultCore } from '../../src/engine/result.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import type { TimelineEvent } from '../../src/engine/timeline/index.ts'
import { REPO_ROOT } from '../lib/vector.ts'
import { AS_OF, RECORDED } from './samples.ts'

type Node = ResultCore['nodes'][number]
type CaseEvent = CaseFile['events'][number]
type Item = CaseFile['candidates'][number]['items'][number]

const RECENT_UNAVAILABLE = [{ scenario: 'RECENT_MONTH', reason: 'HISTORY_INSUFFICIENT' }]

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

/** 依次执行改变输入的操作，得到最后的案例 */
function applied(data: CaseFile, ops: readonly Op[]): CaseFile {
  let current = data
  let created = new Map<string, string>()
  for (const op of ops) {
    const next = applyMutation(current, op, created)
    current = next.data
    created = next.createdReserves
  }
  return current
}

/** 与 evaluate 同一口径：案例自带的已确认方案，金额取当前定价 */
function planOf(raw: CaseFile): DailyPlan | null {
  const candidateId = raw.confirmed_plan?.candidate_id
  if (candidateId === undefined) return null
  const priced = priceCandidates(normalize(raw)).find((row) => row.candidateId === candidateId)
  return { candidateId, priced, lifecycle: 'ACTIVE' }
}

function contextOf(raw: CaseFile, scenarios?: readonly DailyScenario[]): DailyContext {
  const result = run(raw)
  return {
    data: normalize(raw),
    plan: planOf(raw),
    issues: inputIssues(raw, []).issues,
    nodes: result.nodes,
    scenarios: scenarios ?? dailyScenarios(normalize(raw), DEMO_CFG_1, result.checkPeriod.end),
  }
}

function probeOf(raw: CaseFile, ops: readonly Op[] = [], events: readonly TimelineEvent[] = []): DailyProbe {
  const data = applied(raw, ops)
  const plan = planOf(data)
  if (plan === null) throw new Error('没有已确认方案')
  return dailyProbe({ data: normalize(data), plan, issues: inputIssues(data, []).issues, events })
}

function only<T>(rows: readonly T[], what: string): T {
  const [row] = rows
  if (rows.length !== 1 || row === undefined) throw new Error(`${what}命中 ${rows.length} 个`)
  return row
}

function nodeAt(nodes: readonly Node[], at: string): Node {
  return only(
    nodes.filter((node) => node.at === at),
    `at=${at} 的节点`,
  )
}

/** §1 的 C、L、A、H、U */
function pick(node: Node): Record<'C' | 'L' | 'A' | 'H' | 'U', number> {
  return {
    C: node.cash.value,
    L: node.livingReserve.value,
    A: node.goalAllocation.value,
    H: node.paymentHeadroom.value,
    U: node.unallocated.value,
  }
}

function eventOf(data: CaseFile, eventId: string): CaseEvent {
  const event = data.events.find((item) => item.event_id === eventId)
  if (event === undefined) throw new Error(`没有事件 ${eventId}`)
  return event
}

function itemOf(data: CaseFile, candidateId: string, index: number): Item {
  const item = data.candidates.find((row) => row.candidate_id === candidateId)?.items[index]
  if (item === undefined) throw new Error(`没有 ${candidateId} 的第 ${index} 个价格项`)
  return item
}

/** M9 的情景支出：不属于本目标、无预留覆盖，标 scenario */
function scenarioExpense(id: string, amount: number, day: string): TimelineEvent {
  return { id, kind: 'OTHER_EXPENSE', amount, at: day, day, coverage: [], goalRelated: false, confirmedIncome: false, scenario: true }
}

function recentMonth(events: readonly TimelineEvent[] | null): DailyScenario {
  return { kind: 'RECENT_MONTH', unavailableReason: null, events }
}

function todaySpend(amount: number): Op {
  return { type: 'ADD_TODAY_SPEND', event_id: 'E-TODAY', amount, actual_at: AS_OF, coverage: [] }
}

describe('§4、§10.6 checkDaily(x)', () => {
  test('§4 x 是 as_of 时刻不属于本目标、无预留覆盖的流出，排在时间轴最前；x=0 不成节点，检查期间不变', () => {
    const probe = probeOf(loadVector('T019-01').input)
    const zero = checkDaily(probe, 0)
    expect(zero.timeline.nodes.some((node) => node.trigger.eventIds.includes(PROBE_ID))).toBe(false)
    const spent = checkDaily(probe, 2500)
    expect(spent.timeline.nodes[0]?.trigger.kind).toBe('START')
    expect(spent.timeline.nodes[1]).toMatchObject({ at: AS_OF, trigger: { kind: 'OUTFLOW', eventIds: [PROBE_ID] } })
    expect(spent.timeline.nodes[1]?.cash.value).toBe(100000 - 2500)
    expect(spent.timeline.nodes).toHaveLength(zero.timeline.nodes.length + 1)
    expect(spent.timeline.checkPeriod).toEqual(zero.timeline.checkPeriod)
  })

  test('R019 第2条 x 不核销保护性预留、不减少 A 和其他目标占用；其后各节点只有现金少 x', () => {
    for (const id of ['T004-06', 'T019-01']) {
      const probe = probeOf(loadVector(id).input)
      const zero = checkDaily(probe, 0).timeline.nodes
      const spent = checkDaily(probe, 3000).timeline.nodes.filter((node) => !node.trigger.eventIds.includes(PROBE_ID))
      expect(spent, id).toHaveLength(zero.length)
      spent.forEach((node, index) => {
        const before = zero[index]
        if (before === undefined) throw new Error(`${id} 没有第 ${index} 个节点`)
        const held = (row: Node) => [
          row.livingReserve.value,
          row.otherProtectedReserve.value,
          row.otherGoalHold.value,
          row.contingencyReserve.value,
          row.goalAllocation.value,
        ]
        expect(held(node), `${id} ${node.at}`).toEqual(held(before))
        expect(node.cash.value, `${id} ${node.at}`).toBe(index === 0 ? before.cash.value : before.cash.value - 3000)
      })
    }
  })

  test('§10.6 待测额只取非负整数分', () => {
    const probe = probeOf(loadVector('T019-01').input)
    expect(() => checkDaily(probe, -1)).toThrow(RangeError)
    expect(() => checkDaily(probe, 0.5)).toThrow(RangeError)
  })

  test('§10.6 maxPassing 取 [0, upper] 内满足条件的最大整数分', () => {
    for (const upper of [0, 1, 2, 3, 7, 8, 100, 30000]) {
      for (const limit of [0, 1, 5, 99, 100, 101, 29999, 30000, 40000]) {
        expect(maxPassing(upper, (value) => value <= limit), `${upper} ${limit}`).toBe(Math.min(upper, limit))
      }
    }
    expect(maxPassing(-5, () => true)).toBe(0)
  })
})

describe('向量缺口', () => {
  test('T004-06 gap x=100 时 9/10 后 C=500、A=0、H=0、U=0，各节点通过', () => {
    const probe = probeOf(loadVector('T004-06').input)
    const check = checkDaily(probe, 10000)
    expect(check.timeline.nodes[0]?.unallocated.value).toBe(10000)
    expect(check.timeline.nodes.every((node) => node.nodeVerdict === 'PASS')).toBe(true)
    expect(check.pass).toBe(true)
    expect(pick(nodeAt(check.timeline.nodes, '2026-09-10'))).toMatchObject({ C: 50000, A: 0, H: 0, U: 0 })
    expect(checkDaily(probe, 10001).pass).toBe(false)
  })

  test('T006-03 gap x 按 as_of 时刻立即发生，排在该收入之前', () => {
    const probe = probeOf(loadVector('T006-03').input)
    const check = checkDaily(probe, 10000)
    const order = check.timeline.nodes.map((node) => node.trigger.eventIds.join('+'))
    expect(check.timeline.nodes[1]).toMatchObject({ at: AS_OF, trigger: { kind: 'OUTFLOW', eventIds: [PROBE_ID] } })
    expect(order.indexOf(PROBE_ID)).toBeLessThan(order.indexOf('E-INC'))
    expect(check.timeline.nodes[1]?.unallocated.value).toBe(0)
    expect(check.pass).toBe(true)
    const over = checkDaily(probe, 10001)
    expect(over.failingNode).toBe(1)
    expect(checkDaily(probe, 40000).pass).toBe(false)
  })

  test('T010-08 gap 省略 living_arrangement 视为 PROVIDED，没有生活支出时照常给出金额', () => {
    const { input } = loadVector('T010-08')
    const omitted = structuredClone(input)
    delete omitted.snapshot.living_arrangement
    const explicit = structuredClone(input)
    explicit.snapshot.living_arrangement = 'PROVIDED'
    expect(omitted.events.filter((event) => event.event_kind === 'OTHER_EXPENSE')).toEqual([])
    const result = run(omitted)
    expect(result.dailyReference).toMatchObject({ display: 'AMOUNT', missingReasons: [] })
    expect(result.labels).not.toContain('LIVING_ARRANGEMENT_MISSING')
    expect(run(explicit).dailyReference).toEqual(result.dailyReference)
  })

  test('T019-01 gap x=100 时 9/10 后 A=0、U=0，各节点通过；x=101 时 9/10 后 U=-1，不通过', () => {
    const probe = probeOf(loadVector('T019-01').input)
    const pass = checkDaily(probe, 10000)
    expect(pass.timeline.nodes.every((node) => node.nodeVerdict === 'PASS')).toBe(true)
    expect(pass.pass).toBe(true)
    expect(pick(nodeAt(pass.timeline.nodes, '2026-09-10'))).toMatchObject({ A: 0, U: 0 })
    const fail = checkDaily(probe, 10001)
    const node = nodeAt(fail.timeline.nodes, '2026-09-10')
    expect(node.unallocated.value).toBe(-1)
    expect(node.nodeVerdict).not.toBe('PASS')
    expect(fail.failingNode).toBe(fail.timeline.nodes.indexOf(node))
    expect(fail.pass).toBe(false)
  })

  test('T019-08 gap 各资金节点在 x≤50 时仍通过（9/10 后 U=50-x），但检查含预算约束，x=0 即不通过', () => {
    const { input, ops } = loadVector('T019-08')
    const probe = probeOf(input, ops)
    for (const x of [0, 1, 2500, 5000]) {
      const check = checkDaily(probe, x)
      expect(check.nodesPass, `x=${x}`).toBe(true)
      expect(nodeAt(check.timeline.nodes, '2026-09-10').unallocated.value, `x=${x}`).toBe(5000 - x)
      expect(check.budgetPass, `x=${x}`).toBe(false)
      expect(check.pass, `x=${x}`).toBe(false)
    }
    expect(checkDaily(probe, 0).overrun?.value).toBe(5000)
    expect(checkDaily(probe, 5001).nodesPass).toBe(false)
    const result = run(input, ops)
    expect(result.dailyReference).toMatchObject({ display: 'NOT_RECOMMENDED', amount: { value: 0 } })
  })
})

describe('§10.5 每日参考的前提与展示', () => {
  test('D27 没有已确认方案时显示“确认方案后可计算”，不计算 D、不显示 0；未确认时先于生活安排判断', () => {
    const { input, ops } = loadVector('T019-06')
    const result = run(input, ops)
    expect(result.states.confirmationState).toBe('PENDING_CONFIRMATION')
    expect(result.dailyReference).toEqual({ display: 'NEED_CONFIRMED_PLAN', unavailable: [], missingReasons: [] })
    expect(result.labels).not.toContain('DAILY_DISCLAIMER')
    const missing = structuredClone(input)
    missing.snapshot.living_arrangement = 'NOT_PROVIDED'
    expect(run(missing, ops).dailyReference.display).toBe('NEED_CONFIRMED_PLAN')
    expect(LABEL_TEXT.NEED_CONFIRMED_PLAN).toBe('确认方案后可计算')
  })

  test('D59 生活安排未提供时暂无法给出建议金额，缺失原因为“生活安排未提供”，不显示数值', () => {
    for (const id of ['T019-04', 'T010-08']) {
      const result = run(loadVector(id).input)
      expect(result.dailyReference, id).toEqual({ display: 'UNAVAILABLE', unavailable: [], missingReasons: ['LIVING_ARRANGEMENT_MISSING'] })
      expect(result.labels, id).toContain('LIVING_ARRANGEMENT_MISSING')
      expect(result.labels, id).not.toContain('DAILY_DISCLAIMER')
    }
    expect(LABEL_TEXT.UNAVAILABLE).toBe('暂无法给出建议金额')
    expect(LABEL_TEXT.LIVING_ARRANGEMENT_MISSING).toBe('生活安排未提供')
  })

  test('§10.5 第2步 检查期间超出 2027-01-01、现金或预算未知、必要价格待填时暂无法给出建议金额，不截断、不给 0', () => {
    const outOfRange = loadVector('T008-07').input
    const result = run(outOfRange)
    expect(result.checkPeriod.outOfRange).toBe(true)
    expect(result.dailyReference).toEqual({ display: 'UNAVAILABLE', unavailable: [], missingReasons: [] })
    expect(checkDaily(probeOf(outOfRange), 0).complete).toBe(false)
    const base = loadVector('T019-01').input
    const edits: [string, (draft: CaseFile) => void][] = [
      [
        '现金未知',
        (draft) => {
          draft.snapshot.cash = null
        },
      ],
      [
        '预算未知',
        (draft) => {
          draft.goal.budget_cap = null
        },
      ],
      [
        '价格待填',
        (draft) => {
          const item = itemOf(draft, 'C01', 0)
          item.price = null
          item.price_basis = 'PENDING'
        },
      ],
    ]
    for (const [name, edit] of edits) {
      const data = structuredClone(base)
      edit(data)
      const edited = run(data)
      expect(edited.states.planState, name).toBe('INCOMPLETE')
      expect(edited.dailyReference, name).toEqual({ display: 'UNAVAILABLE', unavailable: [], missingReasons: [] })
      expect(checkDaily(probeOf(data), 0).complete, name).toBe(false)
    }
  })

  test('§10.5 第3步 方案金额取已确认方案版本：确认后改价只形成待确认差异，D 仍按 600 算得 100', () => {
    const { input } = loadVector('T019-01')
    const result = run(input, [{ type: 'PATCH', path: '/candidates/0/items/0/price', value: 65000 }])
    expect(result.pendingDifferences.map((row) => [row.costItemId, row.delta.value])).toEqual([['TICKET', 5000]])
    expect(result.actionList.map((task) => [task.costItemId, task.amount?.value])).toEqual([['TICKET', 60000]])
    expect(nodeAt(result.nodes, '2026-09-10').unallocated.value).toBe(5000)
    expect(result.dailyReference).toMatchObject({ display: 'AMOUNT', amount: { value: 10000 } })
  })

  test('§10.5 第4步、D26 9 月 1 日近月情景历史不足，从情景集合移出；按仅已确认安排给出并列出原因', () => {
    const result = run(loadVector('T019-01').input)
    expect(result.dailyReference.unavailable).toEqual(RECENT_UNAVAILABLE)
    expect(result.dailyReference.label).toBe('CONFIRMED_ONLY')
    expect(result.dailyReference.limitedBy?.scenario).toBe('CONFIRMED_ONLY')
    expect(result.labels.slice(0, 2)).toEqual(['SIMULATED_DATA', 'TOP_K_DEMO'])
    expect(result.labels).toEqual(expect.arrayContaining(['HISTORY_INSUFFICIENT', 'DAILY_DISCLAIMER']))
    expect(LABEL_TEXT.CONFIRMED_ONLY).toBe('仅依据已确认安排')
    expect(LABEL_TEXT.HISTORY_INSUFFICIENT).toBe('历史不足')
    expect(LABEL_TEXT.DAILY_DISCLAIMER).toBe('按当前输入和假设测算，不是资金安全保证')
  })

  test('§12.7、D26 近月情景：完整历日不足 30 个为历史不足；满 30 个时两种情景都算，主展示取较低者', () => {
    const september = loadVector('T019-01').input
    expect(dailyScenarios(normalize(september), DEMO_CFG_1, run(september).checkPeriod.end)).toEqual([
      CONFIRMED_ONLY_SCENARIO,
      { kind: 'RECENT_MONTH', unavailableReason: 'HISTORY_INSUFFICIENT', events: [] },
    ])
    const { input } = loadVector('T019-03')
    const end = run(input).checkPeriod.end
    expect(dailyScenarios(normalize(input), DEMO_CFG_1, end)[1]?.unavailableReason).toBe('HISTORY_INSUFFICIENT')
    const full = structuredClone(input)
    full.consumption_records = Array.from({ length: 30 }, (_, index) => ({
      observed_on: `2026-09-${String(index + 1).padStart(2, '0')}`,
      day_coverage: 'NO_SPEND' as const,
      items: [],
    }))
    const fullDaily = dailyScenarios(normalize(full), DEMO_CFG_1, end)
    expect(fullDaily[1]?.unavailableReason).toBeNull()
    expect(fullDaily[1]?.events).toEqual([])
    const fullResult = run(full)
    expect(fullResult.dailyReference).toMatchObject({
      display: 'AMOUNT',
      amount: { value: 10000 },
      limitedBy: { scenario: 'CONFIRMED_ONLY' },
    })
    expect(fullResult.dailyReference.label).toBeUndefined()
    expect(fullResult.scenarios?.[1]).toMatchObject({ kind: 'RECENT_MONTH', available: true, unavailableReason: null })
    expect(fullResult.scenarios?.[0]?.dailyReference?.value).toBe(10000)
    expect(fullResult.scenarios?.[1]?.dailyReference?.value).toBe(10000)
    const gap = structuredClone(full)
    const missing = gap.consumption_records[14]
    if (missing === undefined) throw new Error('没有 9/15 的记录')
    missing.day_coverage = 'MISSING'
    expect(dailyScenarios(normalize(gap), DEMO_CFG_1, end)[1]?.unavailableReason).toBe('HISTORY_INSUFFICIENT')
    expect(run(gap).dailyReference).toMatchObject({
      display: 'AMOUNT',
      amount: { value: 10000 },
      label: 'CONFIRMED_ONLY',
      unavailable: RECENT_UNAVAILABLE,
    })
  })

  test('§10.5 第5步 x=0 即不通过时显示“当前不建议新增非计划支出”和 0 元：保护性资金缺口、预算超限、分配冲突', () => {
    const conflict = structuredClone(loadVector('T019-01').input)
    conflict.snapshot.goal_allocation = 80000
    const cases: [string, CaseFile, Op[]][] = [
      ['T019-05', loadVector('T019-05').input, loadVector('T019-05').ops],
      ['T019-08', loadVector('T019-08').input, loadVector('T019-08').ops],
      ['分配冲突', conflict, []],
    ]
    const results = new Map(cases.map(([name, data, ops]) => [name, run(data, ops)]))
    for (const [name, result] of results) {
      expect(result.dailyReference, name).toEqual({
        display: 'NOT_RECOMMENDED',
        amount: expect.objectContaining({ value: 0 }),
        unavailable: RECENT_UNAVAILABLE,
        missingReasons: [],
      })
      expect(result.labels, name).not.toContain('DAILY_DISCLAIMER')
    }
    expect(results.get('T019-05')?.states.planState).toBe('PAYMENT_GAP')
    expect(results.get('T019-05')?.dailyReference.amount?.basis.eventIds).toEqual(['PLAN:C01:0:TICKET'])
    expect(results.get('T019-08')?.states.planState).toBe('CONSTRAINT_ISSUE')
    expect(results.get('T019-08')?.dailyReference.amount?.basis.rules).toContain('§3')
    expect(results.get('分配冲突')?.snapshot?.issues.map((issue) => issue.nodeVerdict)).toEqual(['ALLOCATION_CONFLICT'])
    expect(LABEL_TEXT.NOT_RECOMMENDED).toBe('当前不建议新增非计划支出')
  })

  test('R019 第7条 多个情景分别检查，主展示取较低者并注明来源（T019-03 的算式 300-30-200=70）；不利或无法评估的已选情景不被忽略', () => {
    const raw = loadVector('T019-01').input
    const lower = dailyReference(contextOf(raw, [CONFIRMED_ONLY_SCENARIO, recentMonth([scenarioExpense('SCN-0905', 3000, '2026-09-05')])]))
    expect(lower.dailyReference).toMatchObject({
      display: 'AMOUNT',
      amount: { value: 7000 },
      limitedBy: { scenario: 'RECENT_MONTH', nodeIndex: 1 },
      unavailable: [],
    })
    expect(lower.dailyReference).not.toHaveProperty('label')
    const blocked = dailyReference(contextOf(raw, [CONFIRMED_ONLY_SCENARIO, recentMonth([scenarioExpense('SCN-0905', 20000, '2026-09-05')])]))
    expect(blocked.dailyReference).toMatchObject({ display: 'NOT_RECOMMENDED', amount: { value: 0 } })
    const unknown = dailyReference(contextOf(raw, [CONFIRMED_ONLY_SCENARIO, recentMonth(null)]))
    expect(unknown.dailyReference).toEqual({ display: 'UNAVAILABLE', unavailable: [], missingReasons: [] })
    const removed = dailyReference(
      contextOf(raw, [
        CONFIRMED_ONLY_SCENARIO,
        { kind: 'RECENT_MONTH', unavailableReason: 'RECORDS_INCOMPLETE', events: [scenarioExpense('SCN-0905', 20000, '2026-09-05')] },
      ]),
    )
    expect(removed.dailyReference).toMatchObject({
      display: 'AMOUNT',
      amount: { value: 10000 },
      label: 'CONFIRMED_ONLY',
      unavailable: [{ scenario: 'RECENT_MONTH', reason: 'RECORDS_INCOMPLETE' }],
    })
  })

  test('§4 最小案例 D=100 由 9/10 付款节点限制；D 到 U0 时没有限制节点；记一笔 40 元当日支出后重算得 60，不是 20', () => {
    const before = run(loadVector('T019-01').input)
    expect(before.snapshot?.unallocated.value).toBe(30000)
    expect(before.dailyReference).toMatchObject({ display: 'AMOUNT', amount: { value: 10000 }, limitedBy: { scenario: 'CONFIRMED_ONLY', nodeIndex: 1 } })
    expect(before.nodes[1]?.at).toBe('2026-09-10')
    expect(before.dailyReference.amount?.basis.eventIds).toEqual(before.nodes[1]?.trigger.eventIds)
    for (const wrong of [30000, 70000, 100000]) expect(before.dailyReference.amount?.value).not.toBe(wrong)
    const bound = run(loadVector('T004-06').input)
    expect(bound.dailyReference).toMatchObject({ amount: { value: 10000 }, limitedBy: { scenario: 'CONFIRMED_ONLY', nodeIndex: null } })
    expect(bound.dailyReference.amount?.basis.eventIds).toEqual([])
    expect(bound.snapshot?.goalAllocation.value).toBe(40000)
    const spend = loadVector('T019-02')
    const after = run(spend.input, spend.ops)
    expect(after.snapshot?.cash.value).toBe(96000)
    expect(after.dailyReference.amount?.value).toBe(6000)
    const probe = probeOf(spend.input, spend.ops)
    expect(checkDaily(probe, 6000).pass).toBe(true)
    expect(checkDaily(probe, 6001).pass).toBe(false)
  })

  test('R012、D47 暂停后每日参考仍按原已确认方案；取消后从释放 A 之后的快照起算，仍有效的付款继续限制 D', () => {
    const { input } = loadVector('T019-01')
    const active = run(input)
    const paused = run(input, [{ type: 'PAUSE' }])
    expect(paused.states.planState).toBe('PAUSED')
    expect(paused.dailyReference).toEqual(active.dailyReference)
    const cancelled = run(loadVector('T004-06').input, [{ type: 'CANCEL' }])
    expect(cancelled.states.planState).toBe('CANCELLED')
    expect(cancelled.snapshot?.unallocated.value).toBe(50000)
    expect(cancelled.dailyReference.display).toBe('AMOUNT')
    expect(cancelled.dailyReference.amount?.value).toBeLessThan(50000)
  })

  test('§12.7（15）序列不再合格时，候选比较仍待填，计划与每日参考用确认价', () => {
    const data = structuredClone(loadVector('T019-10').input)
    data.price_series = [
      {
        series_id: 'S-TICKET',
        cost_item_id: 'TICKET',
        channel: '渠道甲',
        spec: 'B',
        service_date: '2026-09-27',
        observed_on: '2026-09-01',
        price: 60000,
        currency: 'CNY',
        ...RECORDED,
      },
    ]
    const result = run(data)
    expect(result.forecasts?.[0]?.status).toBe('HISTORY_INSUFFICIENT')
    expect(result.forecasts?.[0]?.confirmed).toBe(true)
    expect(result.candidates[0]?.pendingReasons.map((reason) => reason.code)).toContain('PRICE_PENDING')
    expect(result.actionList.map((task) => [task.costItemId, task.amount?.value ?? null])).toEqual([['TICKET', 60000]])
    expect(result.actionList[0]?.pendingChecks).toEqual(['RECHECK_PRICE', 'RECHECK_OFFER_CONDITIONS'])
    expect(result.dailyReference.display).toBe('AMOUNT')
    expect(result.dailyReference.amount?.value).toBe(10000)
    const raised = run(data, [{ type: 'PATCH', path: '/forecast_confirmations/0/price', value: 65000 }])
    expect(raised.cost.netSpend?.value).toBe(65000)
    expect(raised.dailyReference.display).toBe('AMOUNT')
  })

  test('每日参考的输出：各展示都通过 resultCoreSchema，可省略的键不写 undefined；与直接调用 dailyReference 的结果相同', () => {
    const amount = run(loadVector('T019-01').input)
    const notRecommended = run(loadVector('T019-05').input, loadVector('T019-05').ops)
    const needPlan = run(loadVector('T019-06').input, loadVector('T019-06').ops)
    const unavailable = run(loadVector('T019-04').input)
    for (const result of [amount, notRecommended, needPlan, unavailable]) {
      expect(resultCoreSchema.safeParse(result).success, result.dailyReference.display).toBe(true)
      expect(Object.values(result.dailyReference), result.dailyReference.display).not.toContain(undefined)
    }
    expect(Object.keys(amount.dailyReference)).toEqual(['display', 'amount', 'limitedBy', 'label', 'unavailable', 'missingReasons'])
    expect(Object.keys(notRecommended.dailyReference)).toEqual(['display', 'amount', 'unavailable', 'missingReasons'])
    expect(Object.keys(needPlan.dailyReference)).toEqual(['display', 'unavailable', 'missingReasons'])
    for (const id of ['T019-01', 'T004-06', 'T006-03', 'T019-04']) {
      const raw = loadVector(id).input
      expect(dailyReference(contextOf(raw)).dailyReference, id).toEqual(run(raw).dailyReference)
    }
  })
})

/** T019-01 的结构：9/10 付款、9/15 由生活预留覆盖的生活支出，另加一笔无覆盖的支出和一笔已确认收入 */
const BASE = loadVector('T019-01').input

const DRAW = fc.record({
  cash: fc.integer({ min: 100_000, max: 300_000 }),
  living: fc.integer({ min: 0, max: 60_000 }),
  livingSpend: fc.integer({ min: 0, max: 60_000 }),
  allocation: fc.integer({ min: 0, max: 80_000 }),
  payment: fc.integer({ min: 0, max: 120_000 }),
  paymentDay: fc.constantFrom('2026-09-05', '2026-09-10', '2026-09-20'),
  other: fc.integer({ min: 0, max: 40_000 }),
  otherDay: fc.constantFrom('2026-09-03', '2026-09-12', '2026-09-25'),
  income: fc.integer({ min: 0, max: 80_000 }),
  incomeDay: fc.constantFrom('2026-09-02', '2026-09-08', '2026-09-18'),
  slack: fc.integer({ min: -10_000, max: 50_000 }),
  spend: fc.integer({ min: 0, max: 60_000 }),
})

type Draw = {
  cash: number
  living: number
  livingSpend: number
  allocation: number
  payment: number
  paymentDay: string
  other: number
  otherDay: string
  income: number
  incomeDay: string
  slack: number
  spend: number
}

function flow(eventId: string, kind: 'OTHER_EXPENSE' | 'INCOME', amount: number, day: string): CaseEvent {
  return {
    event_id: eventId,
    event_kind: kind,
    event_status: 'EXPECTED',
    amount,
    expected_at: day,
    time_precision: 'DATE',
    in_snapshot: false,
    coverage: [],
    ...RECORDED,
    currency: 'CNY',
  }
}

function caseOf(draw: Draw): CaseFile {
  const data = structuredClone(BASE)
  data.snapshot.cash = draw.cash
  data.snapshot.goal_allocation = draw.allocation
  for (const reserve of data.reserves) reserve.amount = draw.living
  const covered = Math.min(draw.livingSpend, draw.living)
  const living = eventOf(data, 'E-LIV-0915')
  living.amount = covered
  living.coverage = [{ reserve_id: 'R-LIV-09', covered_amount: covered }]
  const ticket = itemOf(data, 'C01', 0)
  ticket.price = draw.payment
  ticket.payment_at = draw.paymentDay
  data.goal.budget_cap = Math.max(0, draw.payment + draw.slack)
  data.events.push(flow('E-OTHER', 'OTHER_EXPENSE', draw.other, draw.otherDay), flow('E-INC', 'INCOME', draw.income, draw.incomeDay))
  return data
}

describe('性质', () => {
  test('R019 第3条 D 是不超过 U0 的非负整数分；信息完整的案例不显示暂无法给出建议金额', () => {
    let amounts = 0
    fc.assert(
      fc.property(DRAW, (draw) => {
        const result = run(caseOf(draw))
        const daily = result.dailyReference
        expect(daily.display).not.toBe('UNAVAILABLE')
        if (daily.display !== 'AMOUNT') return
        amounts += 1
        const value = daily.amount?.value ?? -1
        expect(Number.isSafeInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(result.snapshot?.unallocated.value ?? -1)
      }),
      { numRuns: 100 },
    )
    expect(amounts).toBeGreaterThan(10)
  })

  test('§4 D 通过而 D+1 不通过（未到 U0 时）；D 等于 x=0 时各节点 U 的最小值，不是余额', () => {
    let amounts = 0
    fc.assert(
      fc.property(DRAW, (draw) => {
        const data = caseOf(draw)
        const result = run(data)
        if (result.dailyReference.display !== 'AMOUNT') return
        amounts += 1
        const d = result.dailyReference.amount?.value ?? -1
        const probe = probeOf(data)
        expect(checkDaily(probe, d).pass).toBe(true)
        if (d < (result.snapshot?.unallocated.value ?? 0)) expect(checkDaily(probe, d + 1).pass).toBe(false)
        expect(d).toBe(Math.min(...checkDaily(probe, 0).timeline.nodes.map((node) => node.unallocated.value)))
      }),
      { numRuns: 80 },
    )
    expect(amounts).toBeGreaterThan(10)
  })

  test('R019 第1条 当日支出只扣一次：记一笔 s 后重算，s≤D 时 D 减 s，否则不建议新增支出', () => {
    let amounts = 0
    fc.assert(
      fc.property(DRAW, (draw) => {
        const data = caseOf(draw)
        const before = run(data).dailyReference
        if (before.display !== 'AMOUNT') return
        amounts += 1
        const d = before.amount?.value ?? -1
        const after = run(data, [todaySpend(draw.spend)])
        expect(after.snapshot?.cash.value).toBe(draw.cash - draw.spend)
        expect(after.snapshot?.goalAllocation.value).toBe(draw.allocation)
        if (draw.spend <= d) expect(after.dailyReference).toMatchObject({ display: 'AMOUNT', amount: { value: d - draw.spend } })
        else expect(after.dailyReference.display).toBe('NOT_RECOMMENDED')
      }),
      { numRuns: 80 },
    )
    expect(amounts).toBeGreaterThan(10)
  })
})
