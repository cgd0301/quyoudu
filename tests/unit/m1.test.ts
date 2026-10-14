import fc from 'fast-check'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { formatCents } from '../../src/engine/money/format.ts'
import { roundHalfUp, roundToCents } from '../../src/engine/money/round.ts'
import { applyMutation } from '../../src/engine/ops/index.ts'
import { resultCoreSchema, type ResultCore } from '../../src/engine/result.ts'
import type { CaseFile } from '../../src/engine/schema.ts'
import type { Op } from '../../src/engine/ops/index.ts'
import { AS_OF, c01, expense, withCase } from './samples.ts'

function run(data: CaseFile, ops: readonly Op[] = []): ResultCore {
  const result = evaluate(data, ops, DEMO_CFG_1).checkpoints.at(-1)?.result
  if (result === undefined) throw new Error('没有检查点')
  return result
}

function codes(result: ResultCore): string[] {
  return result.inputIssues.map((issue) => issue.code)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

function assertSafeMoney(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeMoney(item)
    return
  }
  if (value !== null && typeof value === 'object') {
    if ('value' in value && 'basis' in value && typeof value.value === 'number') {
      expect(Number.isSafeInteger(value.value)).toBe(true)
    }
    for (const inner of Object.values(value)) assertSafeMoney(inner)
  }
}

describe('快照公式 §1', () => {
  test('c01 的 G、H、U 与保护性预留合计', () => {
    const result = run(c01())
    const snap = result.snapshot
    expect(snap).not.toBeNull()
    if (snap == null) return
    expect(snap.cash.value).toBe(100000)
    expect(snap.livingReserve.value).toBe(30000)
    expect(snap.livingReserve.basis.reserveIds).toEqual(['R-LIV-09'])
    expect(snap.otherProtectedReserve.value).toBe(0)
    expect(snap.otherGoalHold.value).toBe(0)
    expect(snap.contingencyReserve.value).toBe(20000)
    expect(snap.contingencyReserve.basis.reserveIds).toEqual(['R-CON'])
    expect(snap.goalAllocation.value).toBe(40000)
    expect(snap.goalAvailable.value).toBe(70000)
    expect(snap.paymentHeadroom.value).toBe(50000)
    expect(snap.unallocated.value).toBe(10000)
    expect(snap.protectedTotal.value).toBe(50000)
    expect(snap.issues).toEqual([])
    expect(snap.cash.basis.rules).toEqual(['R001'])
    expect(result.asOf).toBe(AS_OF)
    expect(result.inputVersion).toBe('v1')
    expect(result.configVersion).toBe('DEMO-CFG-1')
    expect(result.topKLabel).toBe('K=3（演示配置v1）')
    expect(result.checkPeriod).toEqual({ start: AS_OF, end: null, outOfRange: false })
    expect(result.labels).toEqual(['SIMULATED_DATA', 'TOP_K_DEMO', 'DRAFT_PREVIEW', 'PREVIEW_UNCONFIRMED'])
    expect(resultCoreSchema.safeParse(result).success).toBe(true)
  })

  test('未到账收入上的生活预留不计入 L0（T004-07）', () => {
    const data = withCase((draft) => {
      draft.events.push(
        expense({
          event_id: 'E-INC',
          event_kind: 'INCOME',
          amount: 30000,
          expected_at: '2026-09-08',
        }),
      )
      draft.reserves.push({
        reserve_id: 'R-LIV-0908',
        reserve_kind: 'LIVING',
        amount: 30000,
        coverage_start: '2026-09-08',
        coverage_end: '2026-09-30',
        release_at_end: false,
        funding_event_id: 'E-INC',
      })
    })
    const snap = run(data).snapshot
    expect(snap?.livingReserve.value).toBe(30000)
    expect(snap?.unallocated.value).toBe(10000)
  })

  test('已计入快照的到账收入所挂预留计入 L0', () => {
    const data = withCase((draft) => {
      draft.snapshot.snapshot_phase = 'AFTER_EVENT(1)'
      draft.events.push(
        expense({
          event_id: 'E-INC',
          event_kind: 'INCOME',
          event_status: 'ACTUAL',
          amount: 30000,
          expected_at: '2026-09-01T08:00:00+08:00',
          actual_at: '2026-09-01T08:00:00+08:00',
          time_precision: 'DATETIME',
          in_snapshot: true,
        }),
      )
      draft.reserves.push({
        reserve_id: 'R-LIV-0908',
        reserve_kind: 'LIVING',
        amount: 30000,
        coverage_start: '2026-09-01',
        coverage_end: '2026-09-30',
        release_at_end: false,
        funding_event_id: 'E-INC',
      })
    })
    const snap = run(data).snapshot
    expect(snap?.livingReserve.value).toBe(60000)
    expect(snap?.unallocated.value).toBe(100000 - 60000 - 20000 - 40000)
    expect(snap?.issues.map((issue) => issue.nodeVerdict)).toEqual(['ALLOCATION_CONFLICT'])
    expect(snap?.issues[0]?.amount.value).toBe(20000)
  })

  test('其他目标占用按 §1 从 G 和 U 中扣除', () => {
    const hold = 10000
    const data = withCase((draft) => {
      draft.snapshot.other_goal_hold = { name: '第二目标', amount: hold }
    })
    const snap = run(data).snapshot
    expect(snap?.otherGoalHold.value).toBe(hold)
    expect(snap?.goalAvailable.value).toBe(100000 - 30000 - hold)
    expect(snap?.unallocated.value).toBe(100000 - 30000 - hold - 20000 - 40000)
  })

  test('现金未知时快照为 null', () => {
    const data = withCase((draft) => {
      draft.snapshot.cash = null
    })
    expect(run(data).snapshot).toBeNull()
  })

  test('分配加大后 U 为负且不归零（T004-02）', () => {
    const result = run(c01(), [{ type: 'SET_ALLOCATION', goal_allocation: 60000 }])
    const snap = result.snapshot
    expect(result.inputVersion).toBe('v2')
    expect(snap?.goalAllocation.value).toBe(60000)
    expect(snap?.protectedTotal.value).toBe(50000)
    expect(snap?.unallocated.value).toBe(-10000)
    expect(snap?.issues).toEqual([
      expect.objectContaining({
        nodeVerdict: 'ALLOCATION_CONFLICT',
        amount: expect.objectContaining({ value: 10000 }),
      }),
    ])
  })

  test('保护性预留超过现金时只记保护性资金缺口，金额为 -U', () => {
    const cash = 40000
    const data = withCase((draft) => {
      draft.snapshot.cash = cash
    })
    const l = 30000
    const m = 20000
    const a = 40000
    const unallocated = cash - l - m - a
    const snap = run(data).snapshot
    expect(snap?.unallocated.value).toBe(unallocated)
    expect(snap?.issues.map((issue) => issue.nodeVerdict)).toEqual(['PROTECTED_SHORTFALL'])
    expect(snap?.issues[0]?.amount.value).toBe(-unallocated)
  })

  test('省略生活安排视为 PROVIDED；NOT_PROVIDED 不给出金额（D59）', () => {
    expect(run(c01()).dailyReference).toEqual({
      display: 'NEED_CONFIRMED_PLAN',
      unavailable: [],
      missingReasons: [],
    })
    const missing = withCase((draft) => {
      draft.snapshot.living_arrangement = 'NOT_PROVIDED'
    })
    expect(run(missing).dailyReference).toEqual({
      display: 'UNAVAILABLE',
      unavailable: [],
      missingReasons: ['LIVING_ARRANGEMENT_MISSING'],
    })
  })

  test('候选保持输入顺序，方案版本为编号@v1', () => {
    const data = withCase((draft) => {
      draft.candidates = [
        { candidate_id: 'C02', items: [], offers_used: [], returns: [] },
        { candidate_id: 'C01', items: [], offers_used: [], returns: [] },
      ]
      draft.confirmed_plan = { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' }
    })
    const result = run(data)
    expect(result.candidates.map((item) => item.candidateId)).toEqual(['C02', 'C01'])
    expect(result.candidates[0]).toMatchObject({ planVersion: 'C02@v1', evaluable: false, rank: null, feasible: null })
    expect(result.labels).toEqual(['SIMULATED_DATA', 'TOP_K_DEMO'])
    expect(result.states.planTarget).toBe('CONFIRMED_PLAN')
    expect(result.dailyReference.display).toBe('UNAVAILABLE')
  })
})

describe('输入冲突', () => {
  test('cash_as_of 与 as_of 不一致（T001-02）', () => {
    const data = withCase((draft) => {
      draft.snapshot.cash_as_of = '2026-09-02T09:00:00+08:00'
    })
    expect(codes(run(data))).toContain('CASH_AS_OF_MISMATCH')
  })

  test('as_of 缺少时区偏移（T001-06）', () => {
    const data = withCase((draft) => {
      draft.snapshot.as_of = '2026-09-01 09:00'
      draft.snapshot.cash_as_of = '2026-09-01 09:00'
    })
    const found = codes(run(data))
    expect(found).toContain('AS_OF_FORMAT')
    expect(found).not.toContain('CASH_AS_OF_MISMATCH')
  })

  test('缺少快照阶段', () => {
    const data = withCase((draft) => {
      draft.snapshot.snapshot_phase = null
    })
    expect(codes(run(data))).toContain('SNAPSHOT_PHASE_MISSING')
  })

  test('快照阶段与计入标记不符时冲突，相符时 G、H、U 不变（T001-07）', () => {
    const spent = (phase: CaseFile['snapshot']['snapshot_phase'], inSnapshot: boolean) =>
      withCase((draft) => {
        draft.snapshot.snapshot_phase = phase
        draft.events.push(
          expense({
            event_id: 'E1',
            event_status: 'ACTUAL',
            amount: 5000,
            expected_at: '2026-09-01T08:00:00+08:00',
            actual_at: '2026-09-01T08:00:00+08:00',
            time_precision: 'DATETIME',
            in_snapshot: inSnapshot,
          }),
        )
      })
    expect(codes(run(spent('DAY_START', true)))).toContain('SNAPSHOT_PHASE_MISMATCH')
    expect(codes(run(spent('AFTER_EVENT(1)', false)))).toContain('SNAPSHOT_PHASE_MISMATCH')
    const matched = run(spent('AFTER_EVENT(1)', true))
    expect(codes(matched)).not.toContain('SNAPSHOT_PHASE_MISMATCH')
    expect(matched.snapshot?.goalAvailable.value).toBe(70000)
    expect(matched.snapshot?.paymentHeadroom.value).toBe(50000)
    expect(matched.snapshot?.unallocated.value).toBe(10000)
  })

  test('非人民币记 NON_CNY，全为 CNY 则没有该问题（T008-01）', () => {
    expect(codes(run(c01()))).not.toContain('NON_CNY')
    const data = withCase((draft) => {
      draft.events.push(expense({ event_id: 'E-FX', currency: 'USD' }))
    })
    expect(codes(run(data))).toContain('NON_CNY')
  })

  test('日期边界含首尾，超出则记 OUT_OF_RANGE（T008-03、T008-04）', () => {
    const on = (expectedAt: string) =>
      withCase((draft) => {
        draft.events.push(expense({ event_id: 'E-LAST', amount: 1000, expected_at: expectedAt }))
      })
    expect(codes(run(on('2026-09-01')))).not.toContain('OUT_OF_RANGE')
    expect(run(on('2027-01-01')).checkPeriod.outOfRange).toBe(false)
    const late = run(on('2027-01-02'))
    expect(codes(late)).toContain('OUT_OF_RANGE')
    expect(late.checkPeriod.outOfRange).toBe(true)
  })

  test('范围前已付的本目标实付不报超界，并标 PRE_RANGE_PAID（D57）', () => {
    const data = withCase((draft) => {
      draft.events.push(
        expense({
          event_id: 'E-OLD',
          event_kind: 'GOAL_PAYMENT',
          event_status: 'ACTUAL',
          amount: 58000,
          expected_at: '2026-08-20T12:00:00+08:00',
          actual_at: '2026-08-20T12:00:00+08:00',
          time_precision: 'DATETIME',
          in_snapshot: true,
          goal_id: 'G1',
        }),
      )
    })
    const result = run(data)
    expect(codes(result)).not.toContain('OUT_OF_RANGE')
    expect(result.labels).toContain('PRE_RANGE_PAID')
    const other = withCase((draft) => {
      draft.events.push(
        expense({
          event_id: 'E-OLD',
          event_status: 'ACTUAL',
          amount: 1000,
          expected_at: '2026-08-20T12:00:00+08:00',
          actual_at: '2026-08-20T12:00:00+08:00',
          time_precision: 'DATETIME',
          in_snapshot: true,
        }),
      )
    })
    expect(codes(run(other))).toContain('OUT_OF_RANGE')
  })

  test('覆盖合计超过支出额', () => {
    const data = withCase((draft) => {
      draft.events.push(
        expense({
          event_id: 'E-OVER',
          amount: 1000,
          coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 2000 }],
        }),
      )
    })
    expect(codes(run(data))).toContain('COVERAGE_EXCEEDS_AMOUNT')
  })
})

describe('操作', () => {
  test('新增生活支出默认新建预留，同一事件改由现有预留覆盖（T013-01、T013-08）', () => {
    const created = run(c01(), [
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
    expect(created.inputVersion).toBe('v2')
    expect(created.snapshot?.livingReserve.value).toBe(40000)
    expect(created.snapshot?.paymentHeadroom.value).toBe(40000)
    expect(created.snapshot?.unallocated.value).toBe(0)
    const rewritten = run(c01(), [
      {
        type: 'ADD_LIVING_EXPENSE',
        event_id: 'E-NEW',
        expected_at: '2026-09-03',
        amount: 10000,
        cover_mode: 'NEW_RESERVE',
        reserve_id: 'R-NEW',
        category: 'MEALS',
      },
      {
        type: 'ADD_LIVING_EXPENSE',
        event_id: 'E-NEW',
        expected_at: '2026-09-03',
        amount: 10000,
        cover_mode: 'EXISTING_RESERVE',
        reserve_id: 'R-LIV-09',
        category: 'MEALS',
      },
    ])
    expect(rewritten.inputVersion).toBe('v3')
    expect(rewritten.snapshot?.livingReserve.value).toBe(30000)
    expect(rewritten.snapshot?.paymentHeadroom.value).toBe(50000)
    expect(rewritten.snapshot?.unallocated.value).toBe(10000)
  })

  test('无覆盖的本目标实付冲减 A 并减少现金（T002-02）', () => {
    const data = withCase((draft) => {
      draft.snapshot.as_of = '2026-09-10T09:00:00+08:00'
      draft.snapshot.cash_as_of = '2026-09-10T09:00:00+08:00'
      draft.events.push(
        expense({
          event_id: 'E1',
          event_kind: 'GOAL_PAYMENT',
          amount: 40000,
          expected_at: '2026-09-10',
          goal_id: 'G1',
        }),
      )
    })
    const snap = run(data, [
      {
        type: 'ADD_TODAY_SPEND',
        event_id: 'E1',
        amount: 40000,
        actual_at: '2026-09-10T09:00:00+08:00',
        goal_id: 'G1',
        coverage: [],
      },
    ]).snapshot
    expect(snap?.cash.value).toBe(60000)
    expect(snap?.goalAllocation.value).toBe(0)
    expect(snap?.paymentHeadroom.value).toBe(10000)
    expect(snap?.unallocated.value).toBe(10000)
  })

  test('不归属本目标的当日支出只减少现金（T019-02）', () => {
    const data = withCase((draft) => {
      draft.reserves = draft.reserves.filter((reserve) => reserve.reserve_kind !== 'CONTINGENCY')
    })
    const snap = run(data, [
      {
        type: 'ADD_TODAY_SPEND',
        event_id: 'E-TODAY',
        amount: 4000,
        actual_at: '2026-09-01T09:00:00+08:00',
        coverage: [],
      },
    ]).snapshot
    expect(snap?.cash.value).toBe(96000)
    expect(snap?.livingReserve.value).toBe(30000)
    expect(snap?.goalAllocation.value).toBe(40000)
    expect(snap?.unallocated.value).toBe(26000)
  })

  test('由生活预留覆盖的 200 元支出同时减少 C 与 L（T001-05）', () => {
    const snap = run(c01(), [
      {
        type: 'ADD_TODAY_SPEND',
        event_id: 'E1',
        amount: 20000,
        actual_at: AS_OF,
        coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 20000 }],
      },
    ]).snapshot
    expect(snap?.cash.value).toBe(80000)
    expect(snap?.livingReserve.value).toBe(10000)
    expect(snap?.paymentHeadroom.value).toBe(50000)
    expect(snap?.unallocated.value).toBe(10000)
  })

  test('已计入快照的支出再次提交不重复扣现金（R002）', () => {
    const once = {
      type: 'ADD_TODAY_SPEND' as const,
      event_id: 'E-TODAY',
      amount: 4000,
      actual_at: AS_OF,
      coverage: [],
    }
    const data = withCase((draft) => {
      draft.reserves = draft.reserves.filter((reserve) => reserve.reserve_kind !== 'CONTINGENCY')
    })
    const snap = run(data, [once, once]).snapshot
    expect(snap?.cash.value).toBe(96000)
  })

  test('延期预计收入不改变现金（R005）；目标不符则不改时间', () => {
    const data = withCase((draft) => {
      draft.events.push(
        expense({ event_id: 'E-INC', event_kind: 'INCOME', amount: 10000, expected_at: '2026-09-12' }),
        expense({ event_id: 'E-PAY', amount: 1000, expected_at: '2026-09-12' }),
      )
    })
    const delayed = applyMutation(data, { type: 'DELAY_INCOME', event_id: 'E-INC', expected_at: '2026-09-20' }, new Map())
    expect(delayed.issue).toBeNull()
    expect(delayed.data.events.find((event) => event.event_id === 'E-INC')?.expected_at).toBe('2026-09-20')
    expect(delayed.data.snapshot.cash).toBe(100000)
    const rejected = applyMutation(data, { type: 'DELAY_INCOME', event_id: 'E-PAY', expected_at: '2026-09-20' }, new Map())
    expect(rejected.issue?.code).toBe('SPEC_NOT_COVERED')
    expect(rejected.data.events.find((event) => event.event_id === 'E-PAY')?.expected_at).toBe('2026-09-12')
    expect(run(data, [{ type: 'DELAY_INCOME', event_id: 'E-PAY', expected_at: '2026-09-20' }]).inputVersion).toBe('v2')
  })

  test('改付款日期只改到案例中的窗口', () => {
    const data = withCase((draft) => {
      draft.events.push(
        expense({
          event_id: 'E-PAY',
          expected_at: '2026-09-15',
          payment_windows: [{ window_id: 'W1', expected_at: '2026-09-20' }],
        }),
      )
    })
    const moved = applyMutation(data, { type: 'CHANGE_PAYMENT_DATE', window_id: 'W1' }, new Map())
    expect(moved.data.events[0]?.expected_at).toBe('2026-09-20')
    const missing = applyMutation(data, { type: 'CHANGE_PAYMENT_DATE', window_id: 'W-NONE' }, new Map())
    expect(missing.issue?.code).toBe('SPEC_NOT_COVERED')
    expect(missing.data.events[0]?.expected_at).toBe('2026-09-15')
  })

  test('PATCH 替换已有字段；路径不存在或结果不合法则抛错（D69、T004-03）', () => {
    const data = withCase((draft) => {
      draft.goal.name = '演唱会资金'
    })
    const renamed = run(data, [{ type: 'PATCH', path: '/goal/name', value: '观演基金' }])
    expect(renamed.inputVersion).toBe('v2')
    expect(renamed.snapshot?.cash.value).toBe(100000)
    expect(renamed.snapshot?.unallocated.value).toBe(10000)
    const allocated = applyMutation(data, { type: 'PATCH', path: '/snapshot/goal_allocation', value: 60000 }, new Map())
    expect(allocated.data.snapshot.goal_allocation).toBe(60000)
    expect(() => run(c01(), [{ type: 'PATCH', path: '/goal/missing', value: 1 }])).toThrow(/路径不存在/)
    expect(() => run(c01(), [{ type: 'PATCH', path: '/snapshot/cash', value: '100' }])).toThrow(/caseFileSchema/)
  })

  test('暂停不改余额；取消释放未使用的 A 且不增加现金（D55）', () => {
    const paused = run(c01(), [{ type: 'PAUSE' }])
    expect(paused.inputVersion).toBe('v2')
    expect(paused.snapshot?.cash.value).toBe(100000)
    expect(paused.snapshot?.goalAllocation.value).toBe(40000)
    expect(paused.snapshot?.contingencyReserve.value).toBe(20000)
    const cancelled = run(c01(), [{ type: 'CANCEL' }]).snapshot
    expect(cancelled?.cash.value).toBe(100000)
    expect(cancelled?.goalAllocation.value).toBe(0)
    expect(cancelled?.contingencyReserve.value).toBe(20000)
    expect(cancelled?.unallocated.value).toBe(100000 - 30000 - 20000)
  })

  test('选择、确认和空确认预测不加版本；连续重算仍为 v1（T013-02）', () => {
    const selected = evaluate(
      c01(),
      [
        { type: 'SELECT_CANDIDATE', candidate_id: 'C01' },
        { type: 'CONFIRM', candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' },
        { type: 'CONFIRM_FORECASTS', forecasts: [] },
      ],
      DEMO_CFG_1,
    )
    expect(selected.checkpoints).toHaveLength(1)
    expect(selected.checkpoints[0]?.result.inputVersion).toBe('v1')
    expect(selected.checkpoints[0]?.result.snapshot?.cash.value).toBe(100000)
    const repeated = evaluate(
      c01(),
      [
        { type: 'EVALUATE', label: '第1次' },
        { type: 'EVALUATE', label: '第2次' },
        { type: 'EVALUATE', label: '第3次' },
      ],
      DEMO_CFG_1,
    )
    expect(repeated.checkpoints.map((item) => item.result.inputVersion)).toEqual(['v1', 'v1', 'v1'])
    expect(repeated.checkpoints.map((item) => item.result.snapshot?.unallocated.value)).toEqual([10000, 10000, 10000])
  })
})

describe('D60 确认', () => {
  test('当前版本的确认是 CURRENT', () => {
    const data = withCase((draft) => {
      draft.confirmations = [{ field: 'TRAVEL_DATE', value: '2026-09-27', input_version: 'v1' }]
    })
    expect(run(data).userConfirmations).toEqual([
      { field: 'TRAVEL_DATE', value: '2026-09-27', inputVersion: 'v1', status: 'CURRENT' },
    ])
  })

  test('演出日期改为 v2 后，早于 v2 的确认需重新确认且不删旧记录（T015-07）', () => {
    const data = withCase((draft) => {
      draft.confirmations = [
        { field: 'TRAVEL_DATE', value: '2026-09-27', input_version: 'v1' },
        { field: 'LODGING_NIGHTS', value: 1, input_version: 'v1' },
      ]
    })
    const result = run(data, [{ type: 'PATCH', path: '/goal/show_start_at', value: '2026-09-28T19:30:00+08:00' }])
    expect(result.inputVersion).toBe('v2')
    expect(result.userConfirmations).toEqual([
      { field: 'TRAVEL_DATE', value: '2026-09-27', inputVersion: 'v1', status: 'NEEDS_RECONFIRM' },
      { field: 'LODGING_NIGHTS', value: 1, inputVersion: 'v1', status: 'NEEDS_RECONFIRM' },
    ])
  })

  test('同一字段的新确认与旧记录并存，以当前版本那条为 CURRENT', () => {
    const data = withCase((draft) => {
      draft.confirmations = [{ field: 'TRAVEL_DATE', value: '2026-09-27', input_version: 'v1' }]
    })
    const result = run(data, [
      {
        type: 'PATCH',
        path: '/confirmations',
        value: [
          { field: 'TRAVEL_DATE', value: '2026-09-27', input_version: 'v1' },
          { field: 'TRAVEL_DATE', value: '2026-09-28', input_version: 'v2' },
        ],
      },
    ])
    expect(result.userConfirmations).toEqual([
      { field: 'TRAVEL_DATE', value: '2026-09-27', inputVersion: 'v1', status: 'NEEDS_RECONFIRM' },
      { field: 'TRAVEL_DATE', value: '2026-09-28', inputVersion: 'v2', status: 'CURRENT' },
    ])
  })
})

describe('T001-01 gap 改设备系统日期后同一输入结果不变', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('T001-01 gap 改设备系统日期后同一输入结果不变', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00+08:00'))
    const before = evaluate(c01(), [], DEMO_CFG_1)
    vi.setSystemTime(new Date('2026-10-13T00:00:00+08:00'))
    const after = evaluate(c01(), [], DEMO_CFG_1)
    expect(after).toEqual(before)
    expect(after.checkpoints[0]?.result.asOf).toContain('2026-09-01')
  })
})

describe('性质', () => {
  test('T013-06 gap 同一输入两次结果相同', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200_000 }), (allocation) => {
        const data = withCase((draft) => {
          draft.snapshot.goal_allocation = allocation
        })
        expect(evaluate(data, [], DEMO_CFG_1)).toEqual(evaluate(data, [], DEMO_CFG_1))
      }),
    )
  })

  test('深冻结输入后运行不报错', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200_000 }), (allocation) => {
        const data = deepFreeze(
          withCase((draft) => {
            draft.snapshot.goal_allocation = allocation
          }),
        )
        expect(() => evaluate(data, [], DEMO_CFG_1)).not.toThrow()
        expect(data.snapshot.goal_allocation).toBe(allocation)
      }),
    )
  })

  test('金额恒为安全整数', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200_000 }), (allocation) => {
        const data = withCase((draft) => {
          draft.snapshot.goal_allocation = allocation
        })
        assertSafeMoney(evaluate(data, [{ type: 'SET_ALLOCATION', goal_allocation: allocation }], DEMO_CFG_1))
      }),
    )
  })

  test('每个改变输入的 op 使版本加 1', () => {
    const bumping = fc.oneof(
      fc.record({
        type: fc.constant('SET_ALLOCATION' as const),
        goal_allocation: fc.integer({ min: 0, max: 100_000 }),
      }),
      fc.constant({ type: 'PAUSE' as const }),
      fc.constant({ type: 'CANCEL' as const }),
    )
    const quiet = fc.oneof(
      fc.constant({ type: 'SELECT_CANDIDATE' as const, candidate_id: 'C01' }),
      fc.constant({
        type: 'CONFIRM' as const,
        candidate_id: 'C01',
        plan_version: 'C01@v1',
        input_version: 'v1' as const,
      }),
      fc.constant({ type: 'CONFIRM_FORECASTS' as const, forecasts: [] }),
    )
    fc.assert(
      fc.property(fc.array(fc.oneof(bumping, quiet), { maxLength: 6 }), (generated) => {
        let version = 1
        const ops: Op[] = []
        const expected: { label: string; version: string }[] = []
        generated.forEach((op, index) => {
          ops.push(op.type === 'CONFIRM_FORECASTS' ? { type: 'CONFIRM_FORECASTS', forecasts: [...op.forecasts] } : op)
          if (op.type === 'SET_ALLOCATION' || op.type === 'PAUSE' || op.type === 'CANCEL') version += 1
          const label = `p${index}`
          ops.push({ type: 'EVALUATE', label })
          expected.push({ label, version: `v${version}` })
        })
        const output = evaluate(c01(), ops, DEMO_CFG_1)
        if (expected.length === 0) {
          expect(output.checkpoints.map((item) => item.result.inputVersion)).toEqual(['v1'])
          return
        }
        expect(output.checkpoints.map((item) => ({ label: item.label, version: item.result.inputVersion }))).toEqual(expected)
      }),
      { numRuns: 25 },
    )
  })
})

describe('舍入与显示', () => {
  test('T007-05 gap 预测中间值按 D25 转为整数分', () => {
    expect(roundToCents('4999.500000000000')).toBe(5000)
    expect(roundToCents('4999.499999999999')).toBe(4999)
  })

  test('T020-11 gap 舍入函数保留 12 位小数并转到整数分', () => {
    expect(roundHalfUp('0.1234567890125', 12)).toBe('0.123456789013')
    expect(roundHalfUp('-0.1234567890125', 12)).toBe('-0.123456789013')
    expect(roundToCents('12874.72')).toBe(12875)
  })

  test('formatCents 按 D70 用整数除法显示两位小数', () => {
    expect(formatCents(100000)).toBe('1000.00')
    expect(formatCents(1)).toBe('0.01')
    expect(formatCents(-10050)).toBe('-100.50')
    expect(formatCents(0)).toBe('0.00')
  })
})
