import { readFileSync } from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { normalize } from '../../src/engine/normalize/index.ts'
import { PRICE_BASIS_ORDER, priceCandidates, type PricedCandidate } from '../../src/engine/pricing/index.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import { REPO_ROOT } from '../lib/vector.ts'
import { withCase } from './samples.ts'

function loadCase(id: string): CaseFile {
  const file = path.join(REPO_ROOT, 'fixtures/vectors', `${id}.json`)
  const vector = JSON.parse(readFileSync(file, 'utf8')) as { input: unknown }
  return caseFileSchema.parse(vector.input)
}

function priceOf(id: string, edit?: (data: CaseFile) => void): PricedCandidate[] {
  const data = loadCase(id)
  edit?.(data)
  return priceCandidates(normalize(data))
}

function byId(rows: readonly PricedCandidate[], id: string): PricedCandidate {
  const row = rows.find((item) => item.candidateId === id)
  if (row === undefined) throw new Error(`没有候选 ${id}`)
  return row
}

function codes(reasons: readonly { code: string }[]): string[] {
  return reasons.map((item) => item.code)
}

const QUOTE = {
  valid_from: '2026-09-01',
  valid_to: '2026-09-30',
  recorded_at: '2026-09-01T08:00:00+08:00',
  available_at: '2026-09-01T08:00:00+08:00',
} as const

function lodgingCase(price: number, edit?: (data: CaseFile) => void): CaseFile {
  return withCase((draft) => {
    draft.cost_items.push({
      cost_item_id: 'LODGING',
      category: 'LODGING',
      necessary: true,
      amount_status: 'CONFIRMED',
    })
    draft.candidates.push({
      candidate_id: 'C01',
      items: [
        {
          cost_item_id: 'LODGING',
          channel: '渠道乙',
          spec: '大床房',
          price,
          currency: 'CNY',
          price_basis: 'QUOTE',
          order_id: 'O1',
          purchase_date: '2026-09-10',
          payment_at: '2026-09-10',
          quote: { ...QUOTE },
        },
      ],
      offers_used: [],
      returns: [],
    })
    edit?.(draft)
  })
}

describe('价格依据 R009、D13', () => {
  test('D13 五档顺序为有效报价、已确认预测、有效参考价、有效期未知、待填', () => {
    expect([...PRICE_BASIS_ORDER]).toEqual(['QUOTE', 'FORECAST', 'REFERENCE', 'UNDATED_QUOTE', 'PENDING'])
  })

  test('T009-01 过期报价停止完整判断且不降为估算', () => {
    const rows = priceOf('T009-01')
    expect(rows.map((row) => row.candidateId)).toEqual(['C01', 'C02'])
    const expired = byId(rows, 'C02')
    expect(codes(expired.pendingReasons)).toContain('QUOTE_EXPIRED')
    expect(expired.items[0]?.estimate).toBe(false)
    expect(expired.items[0]?.priceBasis).toBe('QUOTE')
    expect(expired.items[0]?.payment).toBeNull()
    expect(expired.netSpend).toBeNull()
    const kept = byId(rows, 'C01')
    expect(kept.pendingReasons).toEqual([])
    expect(kept.items[0]?.estimate).toBe(false)
    expect(kept.items[0]?.payment?.value).toBe(30000)
    expect(kept.netSpend?.value).toBe(30000)
  })

  test('T009-02 有效期未知的报价标估算且排在有效参考价之后', () => {
    const row = byId(priceOf('T009-02'), 'C01')
    const item = row.items[0]
    expect(item?.priceBasis).toBe('UNDATED_QUOTE')
    expect(item?.estimate).toBe(true)
    expect(item?.payment?.value).toBe(30000)
    expect(PRICE_BASIS_ORDER.indexOf('UNDATED_QUOTE')).toBeGreaterThan(PRICE_BASIS_ORDER.indexOf('REFERENCE'))
    expect(PRICE_BASIS_ORDER.indexOf('UNDATED_QUOTE')).toBeLessThan(PRICE_BASIS_ORDER.indexOf('PENDING'))
    expect(row.netSpend?.value).toBe(30000)
  })

  test('未确认预测不进入第二档，不把该价格当作估算', () => {
    const rows = priceOf('T009-01', (data) => {
      const item = data.candidates[0]?.items[0]
      if (item) item.price_basis = 'FORECAST'
    })
    const row = byId(rows, 'C01')
    expect(codes(row.pendingReasons)).toContain('PRICE_PENDING')
    expect(row.items[0]?.payment).toBeNull()
    expect(row.items[0]?.estimate).toBe(false)
    expect(row.netSpend).toBeNull()
  })

  test('待填不补 0', () => {
    const rows = priceOf('T009-02', (data) => {
      const item = data.candidates[0]?.items[0]
      if (item) {
        item.price_basis = 'PENDING'
        item.price = null
      }
    })
    const row = byId(rows, 'C01')
    expect(codes(row.pendingReasons)).toContain('PRICE_PENDING')
    expect(row.items[0]?.payment).toBeNull()
    expect(row.netSpend).toBeNull()
  })

  test('T008-02 非人民币不换算，净支出为 null', () => {
    const rows = priceOf('T008-02')
    const foreign = byId(rows, 'C02')
    expect(codes(foreign.pendingReasons)).toContain('NON_CNY')
    expect(foreign.items[0]?.payment).toBeNull()
    expect(foreign.netSpend).toBeNull()
    expect(byId(rows, 'C01').items[0]?.payment?.value).toBe(50000)
    expect(byId(rows, 'C01').netSpend?.value).toBe(50000)
  })
})

describe('优惠 D17、D45、D65', () => {
  test('T007-06 9.5 折按渠道 FLOOR 得 11727 分，不是 11728', () => {
    const row = byId(priceOf('T007-06#1'), 'C01')
    const payment = row.items[0]?.payment
    expect(payment?.value).toBe(11727)
    expect(payment?.value).not.toBe(11728)
    expect(payment?.basis.rules).toEqual(expect.arrayContaining(['D45', 'D65']))
    expect(Number.isSafeInteger(payment?.value)).toBe(true)
    expect(row.futurePayable?.value).toBe(11727)
    expect(row.netSpend?.value).toBe(11727)
  })

  test('T007-06 舍入未知时不产出应付', () => {
    const row = byId(priceOf('T007-06#2'), 'C01')
    expect(codes(row.pendingReasons)).toContain('ROUNDING_UNKNOWN')
    expect(row.items[0]?.payment).toBeNull()
    expect(row.futurePayable).toBeNull()
    expect(row.netSpend).toBeNull()
  })

  test('T009-03 付款时点已过期的优惠排除', () => {
    const row = byId(priceOf('T009-03#1'), 'C01')
    expect(codes(row.excludedReasons)).toContain('OFFER_EXPIRED')
    expect(row.items[0]?.payment?.value).toBe(row.items[0]?.listPrice?.value)
  })

  test('T009-03 不可叠加的优惠排除', () => {
    const row = byId(priceOf('T009-03#2'), 'C01')
    expect(codes(row.excludedReasons)).toContain('OFFER_NOT_STACKABLE')
  })

  test('T009-03 超出 max_uses 时排除且计入次数为 0', () => {
    const row = byId(priceOf('T009-03#3'), 'C03')
    expect(codes(row.excludedReasons)).toContain('OFFER_MAX_USES_EXCEEDED')
    expect(row.appliedUses.find((item) => item.offerId === 'Y4')?.count).toBe(0)
  })

  test('T015-06 未使用的满减不加入项目，46000 不享受满减', () => {
    const rows = priceOf('T015-06')
    expect(rows.map((row) => row.candidateId)).toEqual(['C01'])
    const row = rows[0]
    expect(row?.items).toHaveLength(1)
    expect(row?.items[0]?.payment?.value).toBe(46000)
    expect(row?.netSpend?.value).toBe(46000)
    expect(codes(row?.excludedReasons ?? [])).not.toContain('OFFER_THRESHOLD_NOT_MET')
    expect(row?.appliedUses).toEqual([])
  })

  test('T016-02 同一优惠两单超次数；不用优惠的净支出为 88000', () => {
    const rows = priceOf('T016-02')
    const over = byId(rows, 'C02')
    expect(codes(over.excludedReasons)).toContain('OFFER_MAX_USES_EXCEEDED')
    expect(over.appliedUses.find((item) => item.offerId === 'Y1')?.count).toBe(0)
    expect(over.items.map((item) => item.payment?.value)).toEqual([50000, 50000])
    const plain = byId(rows, 'C03')
    expect(plain.excludedReasons).toEqual([])
    expect(plain.netSpend?.value).toBe(88000)
    expect(plain.items.reduce((sum, item) => sum + (item.payment?.value ?? 0), 0)).toBe(88000)
  })
})

describe('返还 D12、D42', () => {
  test('T007-01 付款即返计入 R，付款仍为 60000，净支出 50000', () => {
    const row = byId(priceOf('T007-01'), 'C01')
    expect(row.items[0]?.payment?.value).toBe(60000)
    expect(row.eligibleReturn?.value).toBe(10000)
    expect(row.eligibleReturn?.basis.eventIds).toEqual(['E-CB'])
    expect(row.eligibleReturn?.basis.rules).toEqual(expect.arrayContaining(['D12']))
    expect(row.netSpend?.value).toBe(50000)
    expect(row.netSpendIfReceived).toBeNull()
  })

  test('依赖后续条件的返现不计入 R，也不冲减付款', () => {
    const row = byId(
      priceOf('T007-01', (data) => {
        const event = data.events[0]
        if (event) event.trigger_condition = '离店后提交入住评价并审核通过'
      }),
      'C01',
    )
    expect(row.items[0]?.payment?.value).toBe(60000)
    expect(row.eligibleReturn?.value).toBe(0)
    expect(row.netSpend?.value).toBe(60000)
    expect(row.netSpendIfReceived?.value).toBe(50000)
  })

  test('相同金额、到账日和触发条件的返现优惠与返还只计一次', () => {
    const row = byId(
      priceOf('T007-01', (data) => {
        data.offers.push({
          offer_id: 'Y-CB',
          type: 'CASHBACK',
          value: 10000,
          scope: ['TICKET'],
          threshold: null,
          valid_from: '2026-09-01',
          valid_to: '2026-09-30',
          applies_at: 'PAYMENT',
          max_uses: 1,
          stackable_with: [],
          rounding: 'FLOOR',
          expected_at: '2026-09-10',
        })
        const candidate = data.candidates[0]
        if (candidate) candidate.offers_used.push({ offer_id: 'Y-CB', order_id: 'O1' })
      }),
      'C01',
    )
    expect(row.eligibleReturn?.value).toBe(10000)
    expect(row.items[0]?.payment?.value).toBe(60000)
    expect(row.netSpend?.value).toBe(50000)
  })

  test('返现优惠与返还对不上时两笔都不计入', () => {
    const row = byId(
      priceOf('T007-01', (data) => {
        data.offers.push({
          offer_id: 'Y-CB',
          type: 'CASHBACK',
          value: 10000,
          scope: ['TICKET'],
          threshold: null,
          valid_from: '2026-09-01',
          valid_to: '2026-09-30',
          applies_at: 'PAYMENT',
          max_uses: 1,
          stackable_with: [],
          rounding: 'FLOOR',
          expected_at: '2026-09-12',
        })
        const candidate = data.candidates[0]
        if (candidate) candidate.offers_used.push({ offer_id: 'Y-CB', order_id: 'O1' })
      }),
      'C01',
    )
    expect(codes(row.pendingReasons)).toContain('OFFER_CONDITION_UNKNOWN')
    expect(row.eligibleReturn).toBeNull()
    expect(row.netSpend).toBeNull()
    expect(row.items[0]?.payment?.value).toBe(60000)
  })
})

describe('相容性 D16、D44 与重复组合 R016', () => {
  test('T016-01 到达距开演 40 分钟小于 60 则排除，无返还时净支出等于付款', () => {
    const rows = priceOf('T016-01')
    const early = byId(rows, 'C01')
    expect(codes(early.excludedReasons)).toContain('ARRIVAL_TOO_LATE')
    expect(early.items[0]?.payment?.value).toBe(82000)
    expect(early.netSpend?.value).toBe(82000)
    const later = byId(rows, 'C02')
    expect(later.excludedReasons).toEqual([])
    expect(later.items[0]?.payment?.value).toBe(85000)
    expect(later.netSpend?.value).toBe(85000)
  })

  test('约束已填写但缺少到达时刻时待确认，不排除', () => {
    const rows = priceOf('T016-01', (data) => {
      const item = data.candidates[1]?.items[0]
      if (item) delete item.arrive_at
    })
    const row = byId(rows, 'C02')
    expect(codes(row.pendingReasons)).toContain('COMPARISON_FIELD_MISSING')
    expect(codes(row.excludedReasons)).not.toContain('ARRIVAL_TOO_LATE')
    expect(row.netSpend).toBeNull()
  })

  test('T016-08 重复组合标出且仍保留全部候选', () => {
    const rows = priceOf('T016-08')
    expect(rows.map((row) => row.candidateId)).toEqual(['C01', 'C02', 'C05'])
    expect(codes(byId(rows, 'C02').excludedReasons)).not.toContain('DUPLICATE_CANDIDATE')
    expect(codes(byId(rows, 'C05').excludedReasons)).toContain('DUPLICATE_CANDIDATE')
  })
})

describe('evaluate 接线', () => {
  test('报价失效写入待确认原因，该候选的 evaluable 与净支出留空', () => {
    const result = evaluate(loadCase('T009-01'), [], DEMO_CFG_1).checkpoints.at(-1)?.result
    if (result === undefined) throw new Error('没有检查点')
    const expired = result.candidates.find((item) => item.candidateId === 'C02')
    expect(expired?.pendingReasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'QUOTE_EXPIRED' })]))
    expect(expired?.evaluable).toBe(false)
    expect(expired?.netSpend).toBeNull()
    expect(result.cost.futurePayable).toBeNull()
  })
})

describe('优惠性质', () => {
  test('D45 满减门槛未达时不减免，付款仍为原价', () => {
    const data = lodgingCase(30000, (draft) => {
      draft.offers.push({
        offer_id: 'Y-TH',
        type: 'THRESHOLD_OFF',
        value: 5000,
        scope: ['LODGING'],
        threshold: 40000,
        valid_from: '2026-09-01',
        valid_to: '2026-09-30',
        applies_at: 'PAYMENT',
        max_uses: 1,
        stackable_with: [],
        rounding: 'FLOOR',
      })
      draft.candidates[0]?.offers_used.push({ offer_id: 'Y-TH', order_id: 'O1' })
    })
    const row = priceCandidates(normalize(data))[0]
    expect(codes(row?.excludedReasons ?? [])).toContain('OFFER_THRESHOLD_NOT_MET')
    expect(row?.items[0]?.payment?.value).toBe(30000)
  })

  test('D65 同一订单多笔付款时从付款时刻最晚的一笔开始冲减', () => {
    const data = lodgingCase(30000, (draft) => {
      draft.cost_items.push({ cost_item_id: 'MEALS', category: 'MEALS', necessary: true, amount_status: 'CONFIRMED' })
      draft.candidates[0]?.items.push({
        cost_item_id: 'MEALS',
        channel: '渠道乙',
        spec: '正餐',
        price: 20000,
        currency: 'CNY',
        price_basis: 'QUOTE',
        order_id: 'O1',
        purchase_date: '2026-09-10',
        payment_at: '2026-09-20',
        quote: { ...QUOTE },
      } as never)
      draft.offers.push({
        offer_id: 'Y-IO',
        type: 'INSTANT_OFF',
        value: 5000,
        scope: ['LODGING', 'MEALS'],
        threshold: null,
        valid_from: '2026-09-01',
        valid_to: '2026-09-30',
        applies_at: 'PAYMENT',
        max_uses: 1,
        stackable_with: [],
        rounding: 'FLOOR',
      })
      draft.candidates[0]?.offers_used.push({ offer_id: 'Y-IO', order_id: 'O1' })    })
    const row = priceCandidates(normalize(data))[0]
    const meals = row?.items.find((item) => item.costItemId === 'MEALS')
    const lodging = row?.items.find((item) => item.costItemId === 'LODGING')
    // 付款时刻最晚的是 MEALS（9-20），减免先冲减它
    expect(meals?.payment?.value).toBe(15000)
    expect(lodging?.payment?.value).toBe(30000)
  })

  test('D45 同一订单两张即时优惠未给计算顺序时计入待确认', () => {
    const data = lodgingCase(30000, (draft) => {
      for (const id of ['Y-A', 'Y-B']) {
        draft.offers.push({
          offer_id: id,
          type: 'INSTANT_OFF',
          value: 1000,
          scope: ['LODGING'],
          threshold: null,
          valid_from: '2026-09-01',
          valid_to: '2026-09-30',
          applies_at: 'PAYMENT',
          max_uses: 1,
          stackable_with: ['Y-A', 'Y-B'],
          rounding: 'FLOOR',
        })
        draft.candidates[0]?.offers_used.push({ offer_id: id, order_id: 'O1' })
      }
    })
    const row = priceCandidates(normalize(data))[0]
    expect(codes(row?.pendingReasons ?? [])).toContain('OFFER_ORDER_MISSING')
  })

  test('返现不冲减付款', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), fc.integer({ min: 0, max: 200_000 }), (price, cashback) => {
        const data = lodgingCase(price, (draft) => {
          draft.offers.push({
            offer_id: 'Y-CB',
            type: 'CASHBACK',
            value: cashback,
            scope: ['LODGING'],
            threshold: null,
            valid_from: '2026-09-01',
            valid_to: '2026-09-30',
            applies_at: 'PAYMENT',
            max_uses: 1,
            stackable_with: [],
            rounding: 'FLOOR',
            expected_at: '2026-09-12',
          })
          draft.candidates[0]?.offers_used.push({ offer_id: 'Y-CB', order_id: 'O1' })
        })
        const row = priceCandidates(normalize(data))[0]
        expect(row?.items[0]?.payment?.value).toBe(price)
      }),
    )
  })

  test('同一优惠计入次数不超过 max_uses', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), (uses, maxUses) => {
        const data = lodgingCase(10000, (draft) => {
          draft.offers.push({
            offer_id: 'Y1',
            type: 'CASHBACK',
            value: 100,
            scope: ['LODGING'],
            threshold: null,
            valid_from: '2026-09-01',
            valid_to: '2026-09-30',
            applies_at: 'PAYMENT',
            max_uses: maxUses,
            stackable_with: [],
            rounding: 'FLOOR',
            expected_at: '2026-09-12',
          })
          const candidate = draft.candidates[0]
          for (let index = 0; index < uses; index += 1) {
            candidate?.offers_used.push({ offer_id: 'Y1', order_id: 'O1' })
          }
        })
        const row = priceCandidates(normalize(data))[0]
        const count = row?.appliedUses.find((item) => item.offerId === 'Y1')?.count ?? 0
        expect(count).toBeLessThanOrEqual(maxUses)
        expect(count).toBe(uses > maxUses ? 0 : uses)
      }),
    )
  })

  test('减免后付款不小于 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 400_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.constantFrom('FLOOR', 'HALF_UP', 'CEIL'),
        (price, instant, ratio, rounding) => {
          const instantCase = lodgingCase(price, (draft) => {
            draft.offers.push({
              offer_id: 'Y1',
              type: 'INSTANT_OFF',
              value: instant,
              scope: ['LODGING'],
              threshold: null,
              valid_from: '2026-09-01',
              valid_to: '2026-09-30',
              applies_at: 'ORDER',
              max_uses: 1,
              stackable_with: [],
              rounding,
            })
            draft.candidates[0]?.offers_used.push({ offer_id: 'Y1', order_id: 'O1' })
          })
          const percentCase = lodgingCase(price, (draft) => {
            draft.offers.push({
              offer_id: 'Y1',
              type: 'PERCENT_OFF',
              value: ratio,
              scope: ['LODGING'],
              threshold: null,
              valid_from: '2026-09-01',
              valid_to: '2026-09-30',
              applies_at: 'ORDER',
              max_uses: 1,
              stackable_with: [],
              rounding,
            })
            draft.candidates[0]?.offers_used.push({ offer_id: 'Y1', order_id: 'O1' })
          })
          for (const data of [instantCase, percentCase]) {
            const payment = priceCandidates(normalize(data))[0]?.items[0]?.payment
            expect(payment).not.toBeNull()
            expect(payment?.value).toBeGreaterThanOrEqual(0)
            expect(Number.isSafeInteger(payment?.value)).toBe(true)
          }
        },
      ),
    )
  })
})
