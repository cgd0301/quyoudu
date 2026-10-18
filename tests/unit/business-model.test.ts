import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  breakEven,
  buildModel,
  buildOutputs,
  deriveAnchors,
  marketSweep,
  parseParams,
  unitCost,
  unitTable,
} from '../../scripts/business-model.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'

const PARAMS_TEXT = readFileSync(`${REPO_ROOT}/docs/_work/business_model.params.json`, 'utf8')

function params() {
  return parseParams(PARAMS_TEXT)
}

describe('business-model 参数与派生口径', () => {
  test('参数文件里的已知数字都必须带来源编号，来源必须存在', () => {
    const parsed = params()
    for (const [key, item] of Object.entries(parsed.known)) {
      expect(item.source, key).toMatch(/^E\d{2}$/)
      expect(parsed.sources[item.source], `${key} 的来源 ${item.source}`).toBeTypeOf('string')
    }
  })

  test('来源编号不存在或 axis 非法时直接报错，不做猜测', () => {
    const broken = JSON.parse(PARAMS_TEXT) as Record<string, unknown>
    ;(broken.known as Record<string, { source: string }>).large_event_attendance_2025_wan.source = 'E99'
    expect(() => parseParams(JSON.stringify(broken))).toThrow('不存在的来源')

    const badAxis = JSON.parse(PARAMS_TEXT) as Record<string, unknown>
    ;(badAxis.assumptions as Record<string, { axis: number[] }>).age_share.axis = [0]
    expect(() => parseParams(JSON.stringify(badAxis))).toThrow('axis 必须是正数')
  })

  test('每人均摊票房与票房外消费由两个已知数相除/相乘得到', () => {
    const anchors = deriveAnchors(params())
    // 324.48 亿元 ÷ 4338.58 万人次 ≈ 748 元/人次
    expect(anchors.ticket_cny_per_attendance).toBe(748)
    // 748 × 6.85 ≈ 5123 元
    expect(anchors.other_cny_per_attendance).toBe(5123)
    expect(anchors.total_cny_per_attendance).toBe(5871)
    expect(anchors.attendance_wan).toBe(4338.58)
  })

  test('市场漏斗是变量表达式：结果随三个比例变化，不出现“市场规模”式的定值', () => {
    const parsed = params()
    const rows = marketSweep(parsed)
    const ageAxis = parsed.assumptions.age_share?.axis ?? []
    const crossAxis = parsed.assumptions.cross_city_share?.axis ?? []
    const multiAxis = parsed.assumptions.multi_payment_share?.axis ?? []
    expect(rows).toHaveLength(ageAxis.length * crossAxis.length * multiAxis.length)
    expect(new Set(rows.map((row) => row.conditional_wan)).size).toBeGreaterThan(1)
    // 取最小参数的那一行应等于 观众人次 × 三个最小比例的乘积
    const smallest = rows.reduce((best, row) => (row.conditional_wan < best.conditional_wan ? row : best))
    const expected = parsed.known.large_event_attendance_2025_wan.value * Math.min(...ageAxis) * Math.min(...crossAxis) * Math.min(...multiAxis)
    expect(smallest.conditional_wan).toBeCloseTo(expected, 1)
  })

  test('单次模型调用成本按官方定价线性计算，非高峰恰为高峰的一半', () => {
    const parsed = params()
    const peak = unitCost(parsed, 6000, 1200, true)
    const off = unitCost(parsed, 6000, 1200, false)
    const fx = parsed.assumptions.usd_cny?.axis[0] ?? 1
    expect(peak.usd).toBeCloseTo((6000 / 1e6) * 0.3 + (1200 / 1e6) * 1.2, 10)
    expect(off.usd).toBeCloseTo(peak.usd / 2, 10)
    expect(peak.cny).toBeCloseTo(peak.usd * fx, 10)
    // token 数不影响峰值/非峰值的比例
    for (const row of unitTable(parsed)) expect(row.cost_peak_cny / row.cost_offpeak_cny).toBeCloseTo(2, 6)
  })

  test('单位经济敏感性只在毛利为正时给出摊平人数，负毛利不允许出现“必达人数”', () => {
    const rows = breakEven(params())
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const margin = row.revenue_cny_per_user_year - row.model_cost_cny_per_user_year - row.acquisition_cny_per_user
      if (margin > 0) {
        expect(row.margin_cny_per_user_year).toBeGreaterThan(0)
        expect(row.break_even_users_per_10k_fixed).toBe(Math.ceil(10000 / row.margin_cny_per_user_year))
      } else {
        expect(row.break_even_users_per_10k_fixed).toBeNull()
      }
    }
    // 最低价、最高获客成本那一组必须是负毛利，避免把“越贵越赚”写成结论
    const worst = rows.find((row) => row.price_cny_per_plan === 1 && row.acquisition_cny_per_user === 50)
    expect(worst?.break_even_users_per_10k_fixed).toBeNull()
  })

  test('模型输出带“不是预测”的声明，且不含收入预测类字段', () => {
    const { json, text } = buildOutputs(params())
    expect(json).toContain('条件式模型，不是市场规模或收入预测')
    expect(text).toContain('**这些行不代表任何估计**')
    expect(text).toContain('不能给出收入预测')
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(Object.keys(parsed)).not.toContain('revenue_forecast')
    expect(Object.keys(parsed)).not.toContain('market_size')
  })

  test('模型导出供项目书引用的展示串，且都是整数或四位小数，不出现浮点噪声', () => {
    const model = buildModel(params())
    expect(model.display.ticket_per_attendance_cny).toBe('748')
    expect(model.display.attendance_wan).toBe('4338.58')
    for (const value of [model.display.total_per_attendance_cny, model.display.unit_cost_peak_cny_low, model.display.unit_cost_peak_cny_high]) {
      expect(value).toMatch(/^\d+(?:\.\d{1,4})?$/)
    }
  })
})
