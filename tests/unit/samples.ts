import type { CaseFile } from '../../src/engine/schema.ts'

export const AS_OF = '2026-09-01T09:00:00+08:00'

export const RECORDED = {
  recorded_at: '2026-09-01T08:00:00+08:00',
  available_at: '2026-09-01T08:00:00+08:00',
}

/** rules.md §10.8 的 c01（整数分）：C0=1000、L0=300、M0=200、A0=400、N0=O0=0，B=900 */
export function c01(): CaseFile {
  return {
    meta: {
      case_id: 'c01',
      purpose: '基础资金数据（rules.md §10.8），单元测试用',
      data_version: '1',
      simulated: true,
      source_type: 'HAND_WRITTEN',
      generator: 'tests/unit/samples.ts',
      batch: 'unit-test',
      created_at_real: '2026-10-14T16:00:00+08:00',
      demo_points: [],
    },
    snapshot: {
      as_of: AS_OF,
      cash_as_of: AS_OF,
      snapshot_phase: 'DAY_START',
      cash: 100000,
      goal_allocation: 40000,
      other_goal_hold: null,
    },
    reserves: [
      {
        reserve_id: 'R-LIV-09',
        reserve_kind: 'LIVING',
        amount: 30000,
        coverage_start: '2026-09-01',
        coverage_end: '2026-09-30',
        release_at_end: false,
      },
      {
        reserve_id: 'R-CON',
        reserve_kind: 'CONTINGENCY',
        amount: 20000,
        coverage_start: '2026-09-01',
        coverage_end: '2026-09-28',
        release_at_end: false,
      },
    ],
    events: [],
    goal: {
      goal_id: 'G1',
      budget_cap: 90000,
      show_start_at: '2026-09-27T19:30:00+08:00',
      show_end_at: '2026-09-27T22:00:00+08:00',
      venue_city: '上海',
      seat_tiers: [
        { code: 'A', name: '内场' },
        { code: 'B', name: '看台' },
      ],
      arrive_before_show_min: null,
      return_after_show_min: null,
      lodging_nights_required: null,
      seat_tier_allowed: null,
      lodging_max_distance_m: null,
      refundable_required: null,
    },
    cost_items: [],
    candidates: [],
    offers: [],
    price_series: [],
    consumption_records: [],
    planned_allocation: null,
    forecast_confirmations: [],
  }
}

export function withCase(edit: (draft: CaseFile) => void): CaseFile {
  const draft = structuredClone(c01())
  edit(draft)
  return draft
}

type CaseEvent = CaseFile['events'][number]

/** 不属于本目标、无预留覆盖的预计支出 */
export function expense(overrides: Partial<CaseEvent> = {}): CaseEvent {
  return {
    event_id: 'E1',
    event_kind: 'OTHER_EXPENSE',
    event_status: 'EXPECTED',
    amount: 20000,
    expected_at: '2026-09-03',
    time_precision: 'DATE',
    in_snapshot: false,
    coverage: [],
    ...RECORDED,
    currency: 'CNY',
    ...overrides,
  }
}
