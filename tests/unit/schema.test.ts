import { describe, expect, test } from 'vitest'
import { opSchema, opsSchema, type Op } from '../../src/engine/ops.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import { RECORDED, c01, expense, withCase } from './samples.ts'

function fullCase(): CaseFile {
  const base = c01()
  return {
    ...base,
    meta: {
      ...base.meta,
      case_id: 'cX_full',
      demo_points: ['逐项最低价组合不相容'],
      boundary_test: false,
      continuation_of: 'c01',
    },
    snapshot: {
      ...base.snapshot,
      other_goal_hold: { name: '第二目标', amount: 10000 },
      living_arrangement: 'PROVIDED',
    },
    reserves: [
      ...base.reserves,
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
        event_id: 'E-TICKET',
        event_kind: 'GOAL_PAYMENT',
        event_status: 'ACTUAL',
        amount: 58000,
        expected_at: '2026-08-20',
        actual_at: '2026-08-20T12:00:00+08:00',
        time_precision: 'DATETIME',
        in_snapshot: true,
        goal_id: 'G1',
        cost_item_id: 'TICKET',
        task_id: 'T-TICKET',
      }),
      expense({
        event_id: 'E-LIV-0903',
        known_order: 1,
        coverage: [{ reserve_id: 'R-LIV-09', covered_amount: 20000 }],
        category: 'MEALS',
      }),
      expense({
        event_id: 'E-LODGING-BAL',
        event_kind: 'GOAL_PAYMENT',
        amount: 30000,
        expected_at: '2026-09-15',
        goal_id: 'G1',
        cost_item_id: 'LODGING',
        task_id: 'T-LODGING',
        payment_windows: [{ window_id: 'W-LODGING-0927', expected_at: '2026-09-27' }],
        cancellable: false,
      }),
      expense({ event_id: 'E-INC-10', event_kind: 'INCOME', amount: 150000, expected_at: '2026-10-01' }),
      expense({
        event_id: 'E-DEPOSIT-REFUND',
        event_kind: 'RETURN',
        amount: null,
        expected_at: '2026-09-30',
        goal_id: 'G1',
        trigger_condition: '平台审核通过',
      }),
    ],
    goal: {
      ...base.goal,
      name: '演唱会资金',
      arrive_before_show_min: 60,
      return_after_show_min: 30,
      lodging_nights_required: ['2026-09-27'],
      seat_tier_allowed: ['A'],
      lodging_max_distance_m: 3000,
      refundable_required: ['LODGING'],
    },
    cost_items: [
      { cost_item_id: 'TICKET', category: 'TICKET', necessary: true, amount_status: 'CONFIRMED' },
      {
        cost_item_id: 'TRAIN-OUT',
        category: 'OUTBOUND_TRANSPORT',
        necessary: true,
        amount_status: 'ESTIMATE',
      },
      {
        cost_item_id: 'LODGING',
        category: 'LODGING',
        necessary: true,
        amount_status: 'CONFIRMED_FREE',
        confirm_basis: '住亲友家（用户确认）',
      },
      { cost_item_id: 'MERCH', category: 'OPTIONAL_PURCHASE', necessary: false, amount_status: 'NOT_APPLICABLE' },
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
            depart_at: '2026-09-27T12:00:00+08:00',
            refundable: true,
            quote: { valid_from: '2026-09-01', valid_to: '2026-09-15', ...RECORDED },
            payment_windows: [{ window_id: 'W-TRAIN-0912', payment_at: '2026-09-12' }],
            cancellable: true,
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
    ],
    offers: [
      {
        offer_id: 'Y1',
        type: 'THRESHOLD_OFF',
        value: 5000,
        scope: ['OUTBOUND_TRANSPORT', 'LODGING'],
        threshold: 50000,
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
        rounding: 'UNKNOWN',
        expected_at: '2026-09-12',
        trigger_condition: '付款完成即返',
      },
    ],
    price_series: [
      {
        series_id: 'S-LODGING',
        cost_item_id: 'LODGING',
        channel: '渠道乙',
        spec: '大床房',
        service_date: '2026-09-27',
        observed_on: '2026-09-01',
        price: 40000,
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
            category: 'MEALS',
            amount: 3000,
            currency: 'CNY',
            in_snapshot: true,
            ...RECORDED,
            covered_by_living_reserve: true,
            same_scope_as_discretionary: false,
          },
        ],
      },
      { observed_on: '2026-09-02', day_coverage: 'MISSING', items: [] },
    ],
    planned_allocation: { funding_event_id: 'E-INC-10', amount: 20000 },
    confirmed_plan: { candidate_id: 'C01', plan_version: 'C01@v1', input_version: 'v1' },
    forecast_confirmations: [
      { series_id: 'S-LODGING', purchase_date: '2026-09-10', price: 39500, config_version: 'DEMO-CFG-1' },
    ],
    confirmations: [
      { field: 'TRAVEL_DATE', value: '2026-09-27', input_version: 'v1' },
      { field: 'LODGING_NIGHTS', value: 1, input_version: 'v1' },
    ],
    nl_script: {
      script_id: 'demo-1',
      utterances: ['我9月27日去上海看演唱会，已经花580买了票，预算900'],
    },
  }
}

describe('CaseFile 合法样例', () => {
  test('c01 最小样例通过', () => {
    expect(caseFileSchema.safeParse(c01()).error).toBeUndefined()
  })

  test('覆盖全部可选段的完整样例通过', () => {
    expect(caseFileSchema.safeParse(fullCase()).error).toBeUndefined()
  })
})

const percentOffer: CaseFile['offers'][number] = {
  offer_id: 'Y1',
  type: 'PERCENT_OFF',
  value: 9500,
  scope: ['LODGING'],
  threshold: null,
  valid_from: null,
  valid_to: null,
  applies_at: 'ORDER',
  max_uses: 1,
  stackable_with: [],
  rounding: 'FLOOR',
}

const lodgingItem: CaseFile['cost_items'][number] = {
  cost_item_id: 'LODGING',
  category: 'LODGING',
  necessary: true,
  amount_status: 'PENDING',
}

/** 放入一条只在给定字段上不合法的记录 */
function editExpense(fields: Record<string, unknown>): (draft: CaseFile) => void {
  return (draft) => draft.events.push(Object.assign(expense(), fields))
}

function editOffer(fields: Record<string, unknown>): (draft: CaseFile) => void {
  return (draft) => draft.offers.push(Object.assign({ ...percentOffer }, fields))
}

function editCostItem(fields: Record<string, unknown>): (draft: CaseFile) => void {
  return (draft) => draft.cost_items.push(Object.assign({ ...lodgingItem }, fields))
}

const structuralErrors: [string, (draft: CaseFile) => void][] = [
  ['缺少 snapshot.cash', (d) => Reflect.deleteProperty(d.snapshot, 'cash')],
  ['缺少 goal', (d) => Reflect.deleteProperty(d, 'goal')],
  ['缺少 meta.batch', (d) => Reflect.deleteProperty(d.meta, 'batch')],
  ['cash 写成字符串', (d) => Object.assign(d.snapshot, { cash: '100000' })],
  ['cash 不是整数分', (d) => Object.assign(d.snapshot, { cash: 1000.5 })],
  ['cash 超出安全整数', (d) => Object.assign(d.snapshot, { cash: 2 ** 53 })],
  ['预留金额不是整数分', (d) => Object.assign(d.reserves[0], { amount: 300.25 })],
  ['未知 event_kind', editExpense({ event_kind: 'TRANSFER' })],
  ['未知 time_precision', editExpense({ time_precision: 'HOUR' })],
  ['in_snapshot 写成字符串', editExpense({ in_snapshot: 'true' })],
  ['coverage 缺 covered_amount', editExpense({ coverage: [{ reserve_id: 'R-LIV-09' }] })],
  ['事件金额不是整数分', editExpense({ amount: 199.99 })],
  ['未知 reserve_kind', (d) => Object.assign(d.reserves[0], { reserve_kind: 'MEDICAL' })],
  ['未知项目类别', editCostItem({ category: 'HOTEL' })],
  ['未知 amount_status', editCostItem({ amount_status: 'FREE' })],
  ['snapshot_phase 不在 D03 取值内', (d) => Object.assign(d.snapshot, { snapshot_phase: 'NOON' })],
  ['AFTER_EVENT(0)', (d) => Object.assign(d.snapshot, { snapshot_phase: 'AFTER_EVENT(0)' })],
  ['AFTER_EVENT 缺少 n', (d) => Object.assign(d.snapshot, { snapshot_phase: 'AFTER_EVENT' })],
  ['旧键 lodging_max_distance_km（D44 已改名）', (d) => Object.assign(d.goal, { lodging_max_distance_km: 3 })],
  ['未知字段', (d) => Object.assign(d.snapshot, { balance_note: '无' })],
  ['折扣写成小数 0.95', editOffer({ value: 0.95 })],
  ['未知 rounding', editOffer({ rounding: 'ROUND' })],
  ['未知优惠类型', editOffer({ type: 'COUPON' })],
  ['日期写成 2026/09/01', (d) => Object.assign(d.reserves[0], { coverage_start: '2026/09/01' })],
  ['日期不存在', (d) => Object.assign(d.reserves[0], { coverage_end: '2026-09-31' })],
  ['simulated=false', (d) => Object.assign(d.meta, { simulated: false })],
  ['source_type 未知', (d) => Object.assign(d.meta, { source_type: 'BANK_EXPORT' })],
  ['other_goal_hold 写成数组', (d) => Object.assign(d.snapshot, { other_goal_hold: [{ name: '第二目标', amount: 10000 }] })],
  ['未知 living_arrangement', (d) => Object.assign(d.snapshot, { living_arrangement: 'MISSING' })],
  [
    '未知确认事项',
    (d) => {
      d.confirmations = [{ field: 'TRAVEL_DATE', value: '2026-09-27', input_version: 'v1' }]
      Object.assign(d.confirmations[0], { field: 'NOTE' })
    },
  ],
]

describe('结构错误被拒绝', () => {
  test('改写前的基础记录本身合法', () => {
    const base = withCase((d) => {
      d.events.push(expense())
      d.offers.push({ ...percentOffer })
      d.cost_items.push({ ...lodgingItem })
    })
    expect(caseFileSchema.safeParse(base).error).toBeUndefined()
  })

  test.each(structuralErrors)('%s', (_name, edit) => {
    expect(caseFileSchema.safeParse(withCase(edit)).success).toBe(false)
  })
})

const businessBoundaries: [string, CaseFile][] = [
  [
    'T001-02 cash_as_of 与 as_of 不对应',
    withCase((d) => {
      d.snapshot.cash_as_of = '2026-09-02T09:00:00+08:00'
    }),
  ],
  [
    'T001-06 as_of 没有时区偏移',
    withCase((d) => {
      d.snapshot.as_of = '2026-09-01 09:00'
    }),
  ],
  [
    'T001-07① DAY_START，但当日 08:00 的实际支出已计入快照',
    withCase((d) => {
      d.events.push(
        expense({
          event_status: 'ACTUAL',
          amount: 5000,
          expected_at: '2026-09-01T08:00:00+08:00',
          actual_at: '2026-09-01T08:00:00+08:00',
          time_precision: 'DATETIME',
          in_snapshot: true,
        }),
      )
    }),
  ],
  [
    'T001-07② AFTER_EVENT(1)，但该支出未计入快照',
    withCase((d) => {
      d.snapshot.snapshot_phase = 'AFTER_EVENT(1)'
      d.events.push(
        expense({
          event_status: 'ACTUAL',
          amount: 5000,
          expected_at: '2026-09-01T08:00:00+08:00',
          actual_at: '2026-09-01T08:00:00+08:00',
          time_precision: 'DATETIME',
        }),
      )
    }),
  ],
  [
    'D03 缺少快照阶段',
    withCase((d) => {
      d.snapshot.snapshot_phase = null
    }),
  ],
  [
    '§11.1 现金和预算缺失',
    withCase((d) => {
      d.snapshot.cash = null
      d.goal.budget_cap = null
    }),
  ],
  [
    'T002-07 2026-08-20 范围前已付的门票',
    withCase((d) => {
      d.events.push(
        expense({
          event_id: 'E0',
          event_kind: 'GOAL_PAYMENT',
          event_status: 'ACTUAL',
          amount: 58000,
          expected_at: '2026-08-20',
          actual_at: '2026-08-20',
          in_snapshot: true,
          goal_id: 'G1',
          cost_item_id: 'TICKET',
        }),
      )
    }),
  ],
  [
    'T003-04② 覆盖合计 150 超过支出 120',
    withCase((d) => {
      d.events.push(
        expense({
          amount: 12000,
          coverage: [
            { reserve_id: 'R-MED', covered_amount: 7000 },
            { reserve_id: 'R-LIV-09', covered_amount: 8000 },
          ],
        }),
      )
    }),
  ],
  [
    'T005-04 预计日期已过仍未到账的收入',
    withCase((d) => {
      d.snapshot.as_of = '2026-09-10T09:00:00+08:00'
      d.snapshot.cash_as_of = '2026-09-10T09:00:00+08:00'
      d.events.push(expense({ event_kind: 'INCOME', amount: 50000, expected_at: '2026-09-08' }))
    }),
  ],
  [
    'T005-03 金额未知的押金退款',
    withCase((d) => {
      d.events.push(expense({ event_kind: 'RETURN', amount: null, expected_at: '2026-09-30', goal_id: 'G1' }))
    }),
  ],
  [
    'T008-02 港币报价',
    withCase((d) => {
      d.candidates.push({
        candidate_id: 'C02',
        items: [
          {
            cost_item_id: 'LODGING',
            channel: '渠道乙',
            spec: '大床房',
            price: 50000,
            currency: 'HKD',
            price_basis: 'QUOTE',
            order_id: 'O1',
            purchase_date: '2026-09-10',
            payment_at: '2026-09-10',
            quote: { valid_from: '2026-09-01', valid_to: '2026-09-30', ...RECORDED },
          },
        ],
        offers_used: [],
        returns: [],
      })
    }),
  ],
  [
    'T008-04 2027-01-02 的本目标退款',
    withCase((d) => {
      d.events.push(expense({ event_kind: 'RETURN', amount: 15000, expected_at: '2027-01-02', goal_id: 'G1' }))
    }),
  ],
  [
    'T008-05 2026-08-25 的价格与消费记录',
    withCase((d) => {
      d.price_series.push({
        series_id: 'S1',
        cost_item_id: 'LODGING',
        channel: '渠道乙',
        spec: '大床房',
        service_date: '2026-09-27',
        observed_on: '2026-08-25',
        price: 40000,
        currency: 'CNY',
        ...RECORDED,
      })
      d.consumption_records.push({
        observed_on: '2026-08-25',
        day_coverage: 'COMPLETE',
        items: [
          { event_id: 'H-0825', category: 'MEALS', amount: 3000, currency: 'CNY', in_snapshot: true, ...RECORDED },
        ],
      })
    }),
  ],
  [
    'V-01 release_at_end=true',
    withCase((d) => {
      d.reserves[0].release_at_end = true
    }),
  ],
  [
    'R020 第11条 负价格观测',
    withCase((d) => {
      d.price_series.push({
        series_id: 'S1',
        cost_item_id: 'LODGING',
        channel: '渠道乙',
        spec: '大床房',
        service_date: '2026-09-27',
        observed_on: '2026-09-01',
        price: -100,
        currency: 'CNY',
        ...RECORDED,
      })
    }),
  ],
  [
    'D44 seat_tier_allowed 引用 Goal 中不存在的编码',
    withCase((d) => {
      d.goal.seat_tier_allowed = ['VIP']
    }),
  ],
  [
    'V-06 as_of 为 2026-10-01 的独立快照',
    withCase((d) => {
      d.snapshot.as_of = '2026-10-01T09:00:00+08:00'
      d.snapshot.cash_as_of = '2026-10-01T09:00:00+08:00'
    }),
  ],
]

describe('业务边界样例能通过 schema（由引擎报告输入冲突，演示案例由 validate:cases 拒绝）', () => {
  test.each(businessBoundaries)('%s', (_name, data) => {
    expect(caseFileSchema.safeParse(data).error).toBeUndefined()
  })
})

const validOps: Op[] = [
  { type: 'DELAY_INCOME', event_id: 'E-INC', expected_at: '2026-09-12' },
  {
    type: 'ADD_LIVING_EXPENSE',
    event_id: 'E-NEW',
    expected_at: '2026-09-03',
    amount: 10000,
    cover_mode: 'NEW_RESERVE',
    reserve_id: 'R-NEW',
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
  { type: 'CHANGE_PAYMENT_DATE', window_id: 'W-LODGING-0927' },
  { type: 'SET_ALLOCATION', goal_allocation: 60000 },
  { type: 'ADD_TODAY_SPEND', event_id: 'E-TODAY', amount: 4000, actual_at: '2026-09-01T10:00:00+08:00', coverage: [] },
  {
    type: 'ADD_TODAY_SPEND',
    event_id: 'E-TODAY-GOAL',
    amount: 5000,
    actual_at: '2026-09-01T10:30:00+08:00',
    goal_id: 'G1',
    cost_item_id: 'LOCAL',
    category: 'GOAL_RELATED',
    coverage: [{ reserve_id: 'R-CON', covered_amount: 1000 }],
  },
  { type: 'PAUSE' },
  { type: 'CANCEL' },
  { type: 'SELECT_CANDIDATE', candidate_id: 'C02' },
  { type: 'CONFIRM', candidate_id: 'C02', plan_version: 'C02@v1', input_version: 'v1' },
  { type: 'CONFIRM_FORECASTS', forecasts: [{ series_id: 'S-LODGING', purchase_date: '2026-10-10' }] },
  { type: 'PATCH', path: '/goal/budget_cap', value: 50000 },
  { type: 'EVALUATE', label: 'v2' },
]

describe('操作 Op', () => {
  test('合法操作序列通过', () => {
    expect(opsSchema.safeParse(validOps).error).toBeUndefined()
  })

  test('改付款日期指向案例中不存在的窗口也能通过 schema（引用由引擎检查）', () => {
    expect(opSchema.safeParse({ type: 'CHANGE_PAYMENT_DATE', window_id: 'W-NOT-IN-CASE' }).error).toBeUndefined()
  })

  test('收入延期到 2027-01-02 也能通过 schema（范围由引擎检查）', () => {
    expect(opSchema.safeParse({ type: 'DELAY_INCOME', event_id: 'E-INC', expected_at: '2027-01-02' }).error).toBeUndefined()
  })

  const opErrors: [string, unknown][] = [
    ['未知操作类型', { type: 'DELETE_EVENT', event_id: 'E1' }],
    [
      'cover_mode 不在 NEW_RESERVE / EXISTING_RESERVE 内',
      {
        type: 'ADD_LIVING_EXPENSE',
        event_id: 'E-NEW',
        expected_at: '2026-09-03',
        amount: 10000,
        cover_mode: 'AUTO',
        reserve_id: 'R-NEW',
      },
    ],
    ['CONFIRM 缺 input_version', { type: 'CONFIRM', candidate_id: 'C02', plan_version: 'C02@v1' }],
    ['input_version 不是 vN', { type: 'CONFIRM', candidate_id: 'C02', plan_version: 'C02@v1', input_version: '1' }],
    ['SET_ALLOCATION 金额不是整数分', { type: 'SET_ALLOCATION', goal_allocation: 600.5 }],
    ['PATCH 路径不是 JSON Pointer', { type: 'PATCH', path: 'goal.budget_cap', value: 1 }],
    ['操作带未知字段', { type: 'PAUSE', reason: '临时有事' }],
    ['EVALUATE 缺 label', { type: 'EVALUATE' }],
  ]

  test.each(opErrors)('%s 被拒绝', (_name, op) => {
    expect(opSchema.safeParse(op).success).toBe(false)
  })
})
