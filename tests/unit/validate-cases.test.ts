import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BANNED_PLATFORM_NAMES, findBannedNames } from '../../scripts/lib/banned.ts'
import {
  PROBLEM_CODES,
  formatProblem,
  runValidateCases,
  validateDemoCase,
  validateFixtures,
  validateVector,
  type Problem,
  type ProblemCode,
} from '../../scripts/validate-cases.ts'
import * as enums from '../../src/engine/enums.ts'
import type { CaseFile } from '../../src/engine/schema.ts'
import { RECORDED, c01, expense, withCase } from './samples.ts'

const FILE = 'fixtures/cases/cA_test.json'
const VECTOR_FILE = 'fixtures/vectors/T001-02.json'
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * 严格校验应为零问题的演示案例。events 依次为：
 * [0] 2026-08-20 范围前已付门票（D57）；[1] 9/1 08:00 已计入快照的餐饮，对应 AFTER_EVENT(1)；
 * [2] 9/3 生活支出，由 R-LIV-09 覆盖 200；[3] 9/15 住宿付款；[4] 10/1 收入，R-LIV-10 挂在其上。
 * reserves 依次为 R-LIV-09（300）、R-CON、R-MED（N，覆盖至 2027-01-01）、R-LIV-10。
 */
function demoCase(): CaseFile {
  const base = c01()
  return {
    ...base,
    meta: {
      ...base.meta,
      case_id: 'cA_test',
      purpose: 'validate:cases 严格模式基线',
      generator: 'tests/unit/validate-cases.test.ts',
    },
    snapshot: { ...base.snapshot, snapshot_phase: 'AFTER_EVENT(1)' },
    reserves: [
      ...base.reserves,
      {
        reserve_id: 'R-MED',
        reserve_kind: 'OTHER_PROTECTED',
        amount: 10000,
        coverage_start: '2026-09-01',
        coverage_end: '2027-01-01',
        release_at_end: false,
      },
      {
        reserve_id: 'R-LIV-10',
        reserve_kind: 'LIVING',
        amount: 150000,
        coverage_start: '2026-10-01',
        coverage_end: '2026-10-31',
        release_at_end: false,
        funding_event_id: 'E-INC-10',
      },
    ],
    events: [
      expense({
        event_id: 'E0',
        event_kind: 'GOAL_PAYMENT',
        event_status: 'ACTUAL',
        amount: 58000,
        expected_at: '2026-08-20',
        actual_at: '2026-08-20T12:00:00+08:00',
        time_precision: 'DATETIME',
        in_snapshot: true,
        goal_id: 'G1',
        cost_item_id: 'TICKET',
        recorded_at: '2026-08-20T12:00:00+08:00',
        available_at: '2026-08-20T12:00:00+08:00',
      }),
      expense({
        event_id: 'E-MEAL-0901',
        event_status: 'ACTUAL',
        amount: 3000,
        expected_at: '2026-09-01T08:00:00+08:00',
        actual_at: '2026-09-01T08:00:00+08:00',
        time_precision: 'DATETIME',
        in_snapshot: true,
        coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 3000 }],
        category: 'MEALS',
      }),
      expense({
        event_id: 'E-LIV-0903',
        coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 20000 }],
        category: 'MEALS',
      }),
      expense({
        event_id: 'E-LODGING',
        event_kind: 'GOAL_PAYMENT',
        amount: 30000,
        expected_at: '2026-09-15',
        goal_id: 'G1',
        cost_item_id: 'LODGING',
        task_id: 'T-LODGING',
        payment_windows: [{ window_id: 'W-LODGING-0927', expected_at: '2026-09-27' }],
      }),
      expense({ event_id: 'E-INC-10', event_kind: 'INCOME', amount: 150000, expected_at: '2026-10-01' }),
    ],
    cost_items: [
      { cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' },
      { cost_item_id: 'TRAIN-OUT', category: 'OUTBOUND_TRANSPORT', necessary: true, amount_status: 'ESTIMATE' },
      { cost_item_id: 'LODGING', category: 'LODGING', necessary: true, amount_status: 'PENDING' },
    ],
    candidates: [
      {
        candidate_id: 'C01',
        items: [
          {
            cost_item_id: 'TRAIN-OUT',
            channel: '渠道甲',
            spec: '二等座',
            price: 35000,
            currency: 'CNY',
            price_basis: 'QUOTE',
            order_id: 'O1',
            purchase_date: '2026-09-10',
            payment_at: '2026-09-10',
            arrive_at: '2026-09-27T17:30:00+08:00',
            refundable: true,
            quote: { valid_from: '2026-09-01', valid_to: '2026-09-15', ...RECORDED },
            payment_windows: [{ window_id: 'W-TRAIN-0912', payment_at: '2026-09-12' }],
          },
          {
            cost_item_id: 'LODGING',
            channel: '渠道乙',
            spec: '大床房',
            price: null,
            currency: 'CNY',
            price_basis: 'PENDING',
            order_id: 'O2',
            purchase_date: '2026-09-10',
            payment_at: '2026-09-27',
            lodging_distance_m: 1500,
            lodging_nights: ['2026-09-27'],
            quote: { valid_from: null, valid_to: null, ...RECORDED },
          },
        ],
        offers_used: [
          { offer_id: 'Y1', order_id: 'O1', sequence: 1 },
          { offer_id: 'Y2', order_id: 'O1', sequence: 2 },
        ],
        returns: [
          {
            event_id: 'E-C01-CASHBACK',
            amount: 5000,
            expected_at: '2026-09-12',
            time_precision: 'DATE',
            cost_item_id: 'TRAIN-OUT',
            currency: 'CNY',
            ...RECORDED,
          },
        ],
      },
      {
        candidate_id: 'C02',
        items: [
          {
            cost_item_id: 'TRAIN-OUT',
            channel: '渠道丙',
            spec: '二等座',
            price: 36000,
            currency: 'CNY',
            price_basis: 'QUOTE',
            order_id: 'O1',
            purchase_date: '2026-09-10',
            payment_at: '2026-09-10',
            quote: { valid_from: '2026-09-01', valid_to: '2026-09-15', ...RECORDED },
          },
        ],
        offers_used: [],
        returns: [],
      },
    ],
    offers: [
      {
        offer_id: 'Y1',
        type: 'THRESHOLD_OFF',
        value: 5000,
        scope: ['OUTBOUND_TRANSPORT'],
        threshold: 30000,
        valid_from: '2026-09-01',
        valid_to: '2026-09-30',
        applies_at: 'PAYMENT',
        max_uses: 1,
        stackable_with: ['Y2'],
        rounding: 'FLOOR',
      },
      {
        offer_id: 'Y2',
        type: 'CASHBACK',
        value: 5000,
        scope: ['OUTBOUND_TRANSPORT'],
        threshold: null,
        valid_from: null,
        valid_to: null,
        applies_at: 'PAYMENT',
        max_uses: 1,
        stackable_with: ['Y1'],
        rounding: 'FLOOR',
        expected_at: '2026-09-12',
        trigger_condition: '付款完成即返',
      },
      {
        offer_id: 'Y3',
        type: 'INSTANT_OFF',
        value: 2000,
        scope: ['OUTBOUND_TRANSPORT'],
        threshold: null,
        valid_from: '2026-09-01',
        valid_to: '2026-09-30',
        applies_at: 'ORDER',
        max_uses: 1,
        stackable_with: [],
        rounding: 'FLOOR',
      },
    ],
    price_series: [
      {
        series_id: 'S-TRAIN',
        cost_item_id: 'TRAIN-OUT',
        channel: '渠道甲',
        spec: '二等座',
        service_date: '2026-09-27',
        observed_on: '2026-09-01',
        price: 35000,
        currency: 'CNY',
        ...RECORDED,
      },
    ],
    consumption_records: [
      {
        observed_on: '2026-09-01',
        day_coverage: 'COMPLETE',
        items: [
          {
            event_id: 'H-0901-1',
            category: 'ENTERTAINMENT',
            amount: 2000,
            currency: 'CNY',
            in_snapshot: true,
            ...RECORDED,
            covered_by_living_reserve: false,
            same_scope_as_discretionary: true,
          },
        ],
      },
    ],
    forecast_confirmations: [
      { series_id: 'S-TRAIN', purchase_date: '2026-09-10', price: 35000, config_version: 'DEMO-CFG-1' },
    ],
    nl_script: {
      script_id: 'demo-1',
      utterances: ['我9月27日去上海看演唱会，已经花580买了票，预算900'],
    },
  }
}

function edited(edit: (draft: CaseFile) => void): CaseFile {
  const draft = demoCase()
  edit(draft)
  return draft
}

function strict(data: unknown): Problem[] {
  return validateDemoCase(data, FILE)
}

/** 演示案例不允许、测试向量允许的冲突输入 */
function conflictingCase(): CaseFile {
  return withCase((d) => {
    d.meta.purpose = '对照携程报价的冲突输入'
    d.snapshot.as_of = '2026-10-01T09:00:00+08:00'
    d.snapshot.cash_as_of = '2026-10-02T09:00:00+08:00'
    d.reserves[0].release_at_end = true
    d.events.push(
      expense({ event_id: 'E1', event_kind: 'INCOME', amount: 50000, expected_at: '2026-09-08' }),
      expense({
        event_id: 'E1',
        event_kind: 'RETURN',
        amount: 15000,
        expected_at: '2027-01-02',
        goal_id: 'G1',
        currency: 'HKD',
      }),
    )
  })
}

type Expected = { code: ProblemCode; path: string }

const counterexamples: [string, (draft: CaseFile) => void, Expected][] = [
  ['schema：cash 写成字符串', (d) => Object.assign(d.snapshot, { cash: '100000' }), { code: 'SCHEMA', path: 'snapshot.cash' }],
  ['schema：simulated=false', (d) => Object.assign(d.meta, { simulated: false }), { code: 'SCHEMA', path: 'meta.simulated' }],
  [
    'event_id 与候选返还重复',
    (d) => {
      d.candidates[0].returns[0].event_id = 'E-LIV-0903'
    },
    { code: 'EVENT_ID_DUPLICATE', path: 'candidates[0].returns[0].event_id' },
  ],
  [
    'event_id 与消费记录重复',
    (d) => {
      d.consumption_records[0].items[0].event_id = 'E0'
    },
    { code: 'EVENT_ID_DUPLICATE', path: 'consumption_records[0].items[0].event_id' },
  ],
  [
    'reserve_id 重复',
    (d) => {
      d.reserves[1].reserve_id = 'R-LIV-09'
    },
    { code: 'RESERVE_ID_DUPLICATE', path: 'reserves[1].reserve_id' },
  ],
  [
    'offer_id 重复',
    (d) => {
      d.offers[2].offer_id = 'Y1'
    },
    { code: 'OFFER_ID_DUPLICATE', path: 'offers[2].offer_id' },
  ],
  [
    '候选编号重复',
    (d) => {
      d.candidates[1].candidate_id = 'C01'
    },
    { code: 'CANDIDATE_ID_DUPLICATE', path: 'candidates[1].candidate_id' },
  ],
  [
    '候选编号跳号',
    (d) => {
      d.candidates[1].candidate_id = 'C03'
    },
    { code: 'CANDIDATE_ID_SEQUENCE', path: 'candidates[1].candidate_id' },
  ],
  [
    '港币报价',
    (d) => {
      d.candidates[1].items[0].currency = 'HKD'
    },
    { code: 'CURRENCY', path: 'candidates[1].items[0].currency' },
  ],
  [
    'as_of 没有时区偏移',
    (d) => {
      d.snapshot.as_of = '2026-09-01 09:00'
      d.snapshot.cash_as_of = '2026-09-01 09:00'
    },
    { code: 'AS_OF_FORMAT', path: 'snapshot.as_of' },
  ],
  [
    'V-06 as_of 为 2026-10-01',
    (d) => {
      d.snapshot.as_of = '2026-10-01T09:00:00+08:00'
      d.snapshot.cash_as_of = '2026-10-01T09:00:00+08:00'
    },
    { code: 'V-06', path: 'snapshot.as_of' },
  ],
  [
    'cash_as_of 与 as_of 不一致',
    (d) => {
      d.snapshot.cash_as_of = '2026-09-02T09:00:00+08:00'
    },
    { code: 'CASH_AS_OF', path: 'snapshot.cash_as_of' },
  ],
  [
    '缺少快照阶段',
    (d) => {
      d.snapshot.snapshot_phase = null
    },
    { code: 'SNAPSHOT_PHASE', path: 'snapshot.snapshot_phase' },
  ],
  [
    'DAY_START，但当日已计入 1 笔支出',
    (d) => {
      d.snapshot.snapshot_phase = 'DAY_START'
    },
    { code: 'SNAPSHOT_PHASE', path: 'snapshot.snapshot_phase' },
  ],
  [
    'AFTER_EVENT(2)，但当日只计入 1 笔',
    (d) => {
      d.snapshot.snapshot_phase = 'AFTER_EVENT(2)'
    },
    { code: 'SNAPSHOT_PHASE', path: 'snapshot.snapshot_phase' },
  ],
  [
    'DAY_END，但当日还有未计入的预计支出',
    (d) => {
      d.snapshot.snapshot_phase = 'DAY_END'
      d.events.push(expense({ event_id: 'E-0901', expected_at: '2026-09-01' }))
    },
    { code: 'SNAPSHOT_PHASE', path: 'snapshot.snapshot_phase' },
  ],
  [
    '已计入快照的事件不是 ACTUAL',
    (d) => {
      d.events[2].in_snapshot = true
    },
    { code: 'IN_SNAPSHOT', path: 'events[2].in_snapshot' },
  ],
  [
    '实际时刻不晚于 cash_as_of，却未计入快照',
    (d) => {
      d.events[1].in_snapshot = false
      d.snapshot.snapshot_phase = 'DAY_START'
    },
    { code: 'IN_SNAPSHOT', path: 'events[1].in_snapshot' },
  ],
  [
    '已计入快照的事件实际时刻晚于 cash_as_of',
    (d) => {
      d.events[1].actual_at = '2026-09-01T10:00:00+08:00'
    },
    { code: 'IN_SNAPSHOT', path: 'events[1].actual_at' },
  ],
  [
    '实际事件缺少 actual_at',
    (d) => {
      Reflect.deleteProperty(d.events[1], 'actual_at')
    },
    { code: 'IN_SNAPSHOT', path: 'events[1].actual_at' },
  ],
  [
    'as_of 当日的实际事件只给日期',
    (d) => {
      d.events[1].actual_at = '2026-09-01'
    },
    { code: 'IN_SNAPSHOT', path: 'events[1].actual_at' },
  ],
  [
    '时刻写成 2026-09-01 08:00',
    (d) => {
      d.events[2].recorded_at = '2026-09-01 08:00'
    },
    { code: 'INSTANT_FORMAT', path: 'events[2].recorded_at' },
  ],
  [
    '时刻用 Z 而不是 +08:00',
    (d) => {
      d.goal.show_start_at = '2026-09-27T11:30:00Z'
    },
    { code: 'INSTANT_FORMAT', path: 'goal.show_start_at' },
  ],
  [
    '价格观测在 2026-08-25',
    (d) => {
      d.price_series[0].observed_on = '2026-08-25'
    },
    { code: 'DATE_RANGE', path: 'price_series[0].observed_on' },
  ],
  [
    '8 月实付但不是 P 或 R，不适用 D57',
    (d) => {
      d.events[0].event_kind = 'OTHER_EXPENSE'
    },
    { code: 'DATE_RANGE', path: 'events[0].actual_at' },
  ],
  [
    '预留覆盖期晚于 2027-01-01，boundary_test 也不放行',
    (d) => {
      d.meta.boundary_test = true
      d.reserves[3].coverage_end = '2027-01-31'
    },
    { code: 'DATE_RANGE', path: 'reserves[3].coverage_end' },
  ],
  [
    '必要事件在 2027-01-02，未标 boundary_test',
    (d) => {
      d.events.push(
        expense({ event_id: 'E-REFUND', event_kind: 'RETURN', amount: 15000, expected_at: '2027-01-02', goal_id: 'G1' }),
      )
    },
    { code: 'EVENT_AFTER_RANGE', path: 'events[5].expected_at' },
  ],
  [
    '候选付款在 2027-01-05，未标 boundary_test',
    (d) => {
      d.candidates[1].items[0].payment_at = '2027-01-05'
    },
    { code: 'EVENT_AFTER_RANGE', path: 'candidates[1].items[0].payment_at' },
  ],
  [
    '覆盖引用的预留不存在',
    (d) => {
      d.events[2].coverage[0].reserve_id = 'R-NONE'
    },
    { code: 'COVERAGE_REF', path: 'events[2].coverage[0].reserve_id' },
  ],
  [
    '覆盖合计超过支出额',
    (d) => {
      d.events[2].amount = 15000
    },
    { code: 'COVERAGE_OVER_AMOUNT', path: 'events[2].coverage' },
  ],
  [
    '支出金额未知却声明覆盖',
    (d) => {
      d.events[2].amount = null
    },
    { code: 'COVERAGE_OVER_AMOUNT', path: 'events[2].coverage' },
  ],
  [
    '覆盖额超过预留剩余额',
    (d) => {
      d.events.push(
        expense({
          event_id: 'E-LIV-0910',
          amount: 15000,
          expected_at: '2026-09-10',
          coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 15000 }],
        }),
      )
    },
    { code: 'COVERAGE_OVER_REMAINING', path: 'events[5].coverage[0].covered_amount' },
  ],
  [
    'V-05 同日两笔共用一项预留，声明合计超额',
    (d) => {
      d.events.push(
        expense({
          event_id: 'E-LIV-0903B',
          amount: 15000,
          coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 15000 }],
        }),
      )
    },
    { code: 'V-05', path: 'reserves[0]' },
  ],
  [
    'V-01 release_at_end=true',
    (d) => {
      d.reserves[0].release_at_end = true
    },
    { code: 'V-01', path: 'reserves[0].release_at_end' },
  ],
  [
    'V-02 N 挂在收入上建立',
    (d) => {
      d.reserves[2].funding_event_id = 'E-INC-10'
    },
    { code: 'V-02', path: 'reserves[2].funding_event_id' },
  ],
  [
    'V-02 N 在 2027-01-01 前到期',
    (d) => {
      d.reserves[2].coverage_end = '2026-12-31'
    },
    { code: 'V-02', path: 'reserves[2].coverage_end' },
  ],
  [
    'V-03 同一订单两张即时类优惠',
    (d) => {
      d.candidates[0].offers_used.push({ offer_id: 'Y3', order_id: 'O1', sequence: 3 })
    },
    { code: 'V-03', path: 'candidates[0].offers_used' },
  ],
  [
    'V-03 同一订单两张返现',
    (d) => {
      d.candidates[0].offers_used.push({ offer_id: 'Y2', order_id: 'O1', sequence: 3 })
    },
    { code: 'V-03', path: 'candidates[0].offers_used' },
  ],
  [
    '优惠引用不存在',
    (d) => {
      d.candidates[0].offers_used[0].offer_id = 'Y9'
    },
    { code: 'OFFER_REF', path: 'candidates[0].offers_used[0].offer_id' },
  ],
  [
    'V-04 当日 08:30 的预计支出仍未履行',
    (d) => {
      d.events.push(expense({ event_id: 'E-OVERDUE', expected_at: '2026-09-01T08:30:00+08:00', time_precision: 'DATETIME' }))
    },
    { code: 'V-04', path: 'events[5].expected_at' },
  ],
  [
    'V-04 候选付款时刻早于 cash_as_of',
    (d) => {
      d.candidates[1].items[0].payment_at = '2026-09-01T08:00:00+08:00'
    },
    { code: 'V-04', path: 'candidates[1].items[0].payment_at' },
  ],
  [
    '价格依据缺少生成批次',
    (d) => {
      d.meta.batch = ' '
    },
    { code: 'PRICE_SOURCE', path: 'meta.batch' },
  ],
  [
    '报价缺少模拟记录时间',
    (d) => {
      d.candidates[0].items[0].quote.recorded_at = ''
    },
    { code: 'PRICE_SOURCE', path: 'candidates[0].items[0].quote.recorded_at' },
  ],
  [
    '价格观测的可获得时间格式不对',
    (d) => {
      d.price_series[0].available_at = '2026/09/01'
    },
    { code: 'PRICE_SOURCE', path: 'price_series[0].available_at' },
  ],
  [
    '真实平台名称',
    (d) => {
      d.candidates[0].items[0].channel = '携程'
    },
    { code: 'BANNED_NAME', path: 'candidates[0].items[0].channel' },
  ],
  [
    '真实平台名称，拉丁字母不分大小写',
    (d) => {
      d.nl_script?.utterances.push('打算在 DAMAI 上抢票')
    },
    { code: 'BANNED_NAME', path: 'nl_script.utterances[1]' },
  ],
]

describe('严格模式：每类错误一个反例', () => {
  test.each(counterexamples)('%s', (_name, edit, expected) => {
    expect(strict(edited(edit))).toContainEqual(expect.objectContaining({ file: FILE, ...expected }))
  })

  test('每个问题代码都有反例（JSON、VECTOR_SHAPE 见下方文件与向量测试）', () => {
    const covered = new Set<ProblemCode>(['JSON', 'VECTOR_SHAPE', ...counterexamples.map(([, , expected]) => expected.code)])
    expect(PROBLEM_CODES.filter((code) => !covered.has(code))).toEqual([])
  })

  test('schema 不通过时只报 schema 和禁用词，不做后续检查', () => {
    const problems = strict(
      edited((d) => {
        Object.assign(d.snapshot, { cash: '100000' })
        d.snapshot.as_of = '2026-10-01T09:00:00+08:00'
        d.candidates[0].items[0].channel = '携程'
      }),
    )
    expect(problems.map((problem) => problem.code)).toEqual(['SCHEMA', 'BANNED_NAME'])
  })
})

describe('严格模式放行的情形', () => {
  test('基线演示案例零问题（含 D57 范围前已付门票）', () => {
    expect(strict(demoCase())).toEqual([])
  })

  test('演示范围首尾日期 2026-09-01、2027-01-01 通过', () => {
    const data = edited((d) => {
      d.events.push(
        expense({ event_id: 'E-FIRST', expected_at: '2026-09-01' }),
        expense({ event_id: 'E-LAST', expected_at: '2027-01-01' }),
      )
    })
    expect(strict(data)).toEqual([])
  })

  test('boundary_test=true 时必要事件可以晚于 2027-01-01', () => {
    const data = edited((d) => {
      d.meta.boundary_test = true
      d.events.push(
        expense({ event_id: 'E-REFUND', event_kind: 'RETURN', amount: 15000, expected_at: '2027-01-02', goal_id: 'G1' }),
      )
      d.candidates[1].items[0].payment_at = '2027-01-05'
    })
    expect(strict(data)).toEqual([])
  })

  test('已计入快照的覆盖不占用剩余预留', () => {
    const data = edited((d) => {
      d.events.push(
        expense({
          event_id: 'E-LIV-0910',
          amount: 10000,
          expected_at: '2026-09-10',
          coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 10000 }],
        }),
      )
    })
    expect(strict(data)).toEqual([])
  })

  test('V-03：demo_points 写明“C01 违规叠加用于排除”时豁免 C01', () => {
    const data = edited((d) => {
      d.meta.demo_points = ['C01 违规叠加用于排除']
      d.candidates[0].offers_used.push({ offer_id: 'Y3', order_id: 'O1', sequence: 3 })
    })
    expect(strict(data)).toEqual([])
  })

  test('V-03 的豁免只对写明的候选生效', () => {
    const data = edited((d) => {
      d.meta.demo_points = ['C02 违规叠加用于排除', 'C01 逐项最低价组合不相容']
      d.candidates[0].offers_used.push({ offer_id: 'Y3', order_id: 'O1', sequence: 3 })
    })
    expect(strict(data)).toContainEqual(expect.objectContaining({ code: 'V-03', path: 'candidates[0].offers_used' }))
  })
})

describe('宽松模式：测试向量只校验 schema', () => {
  test('含故意冲突输入的向量通过', () => {
    const vector = {
      source_text: 'T001-02 cash_as_of 与 as_of 不对应',
      case: conflictingCase(),
      ops: [{ type: 'EVALUATE', label: 'final' }],
      expect: { plan_state: 'INCOMPLETE' },
    }
    expect(validateVector(vector, VECTOR_FILE)).toEqual([])
    expect(strict(conflictingCase()).length).toBeGreaterThan(0)
  })

  test('case 的 schema 错误带 case 前缀', () => {
    const vector = { case: withCase((d) => Object.assign(d.snapshot, { cash: '100000' })) }
    expect(validateVector(vector, VECTOR_FILE)).toContainEqual(
      expect.objectContaining({ file: VECTOR_FILE, code: 'SCHEMA', path: 'case.snapshot.cash' }),
    )
  })

  test('ops 的 schema 错误带 ops 前缀', () => {
    const vector = { case: c01(), ops: [{ type: 'DELETE_EVENT', event_id: 'E1' }] }
    expect(validateVector(vector, VECTOR_FILE)).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA', path: 'ops[0].type' }),
    )
  })

  test('缺少 case', () => {
    expect(validateVector({ ops: [] }, VECTOR_FILE)).toEqual([
      expect.objectContaining({ code: 'VECTOR_SHAPE', path: 'case' }),
    ])
  })

  test('顶层不是对象', () => {
    expect(validateVector([c01()], VECTOR_FILE)).toEqual([expect.objectContaining({ code: 'VECTOR_SHAPE', path: '$' })])
  })
})

describe('禁用词表', () => {
  test('没有重复和空白项', () => {
    expect(new Set(BANNED_PLATFORM_NAMES).size).toBe(BANNED_PLATFORM_NAMES.length)
    expect(BANNED_PLATFORM_NAMES.filter((name) => name === '' || name.trim() !== name)).toEqual([])
  })

  test('拉丁字母不分大小写，按整词匹配', () => {
    expect(findBannedNames('在ctrip下单')).toEqual(['Ctrip'])
    expect(findBannedNames('applies_at=PAYMENT')).toEqual([])
  })

  test('中文按子串匹配，常见地名不误报', () => {
    expect(findBannedNames('在京东下单')).toEqual(['京东'])
    expect(findBannedNames('南京东路附近的大床房')).toEqual([])
  })

  test('枚举取值不会被误判', () => {
    const values = Object.values(enums).flatMap((value) => (Array.isArray(value) ? value.map(String) : []))
    expect(values.length).toBeGreaterThan(0)
    expect(values.flatMap(findBannedNames)).toEqual([])
  })
})

describe('读取 fixtures 目录', () => {
  let root = ''

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'validate-cases-'))
    const write = (relativePath: string, text: string) => {
      const target = path.join(root, relativePath)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, text, 'utf8')
    }
    write('fixtures/cases/cA_ok.json', `${JSON.stringify(demoCase(), null, 2)}\n`)
    write('fixtures/cases/cB_bom.json', `\uFEFF${JSON.stringify(demoCase())}`)
    write('fixtures/cases/cB_broken.json', '{ "meta": ')
    write('fixtures/cases/README.txt', '不是 JSON，不检查')
    write('fixtures/vectors/T001-02.json', JSON.stringify({ case: conflictingCase(), ops: [] }))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('formatProblem 输出“文件:路径:问题”', () => {
    const problem: Problem = {
      file: 'fixtures/cases/c01.json',
      path: 'snapshot.as_of',
      code: 'V-06',
      message: 'V-06：演示案例的 as_of 只能是 2026-09-01',
    }
    expect(formatProblem(problem)).toBe('fixtures/cases/c01.json:snapshot.as_of:V-06：演示案例的 as_of 只能是 2026-09-01')
  })

  test('逐个文件校验：BOM 与解析失败报在根路径，向量只校验 schema', async () => {
    const report = await validateFixtures(root)
    expect([report.caseCount, report.vectorCount]).toEqual([3, 1])
    expect(report.problems.map((problem) => [problem.file, problem.path, problem.code])).toEqual([
      ['fixtures/cases/cB_bom.json', '$', 'JSON'],
      ['fixtures/cases/cB_broken.json', '$', 'JSON'],
    ])
  })

  test('有问题时逐行打印并返回退出码 1', async () => {
    const errors: string[] = []
    const code = await runValidateCases(root, { log: () => {}, error: (line) => errors.push(line) })
    const { problems } = await validateFixtures(root)
    expect(code).toBe(1)
    expect(errors.slice(0, problems.length)).toEqual(problems.map(formatProblem))
    expect(errors.slice(0, problems.length).every((line) => /^fixtures\/cases\/[^:]+\.json:\$:.+/.test(line))).toBe(true)
  })

  test('目录不存在时按 0 个文件处理，退出码 0', async () => {
    const missing = path.join(root, 'missing')
    expect(await validateFixtures(missing)).toEqual({ problems: [], caseCount: 0, vectorCount: 0 })
    expect(await runValidateCases(missing, { log: () => {}, error: () => {} })).toBe(0)
  })

  test('仓库中的 fixtures 全部通过 validate:cases', async () => {
    const report = await validateFixtures(REPO_ROOT)
    expect(report.problems.map(formatProblem)).toEqual([])
  })
})
