import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildModel, buildOutputs, deriveAnchors, parseParams } from '../../scripts/business-model.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'

const PARAMS_TEXT = readFileSync(`${REPO_ROOT}/docs/_work/business_model.params.json`, 'utf8')

function params() {
  return parseParams(PARAMS_TEXT)
}

describe('business-model 事实锚点与缺口登记', () => {
  test('参数文件只登记事实与缺口，出现 assumptions 或取值轴即报错', () => {
    const raw = JSON.parse(PARAMS_TEXT) as Record<string, unknown>
    expect(raw.assumptions).toBeUndefined()

    const withAssumptions = { ...raw, assumptions: { age_share: { axis: [0.2] } } }
    expect(() => parseParams(JSON.stringify(withAssumptions))).toThrow('assumptions')

    const withAxis = JSON.parse(PARAMS_TEXT) as { open_items: Record<string, Record<string, unknown>> }
    withAxis.open_items.age_share.axis = [0.2]
    expect(() => parseParams(JSON.stringify(withAxis))).toThrow('不得包含 axis')

    const withUnknown = { ...raw, scenarios: [] }
    expect(() => parseParams(JSON.stringify(withUnknown))).toThrow('未登记')
  })

  test('每条事实都带来源编号与单位，display 与数值一致', () => {
    const parsed = params()
    for (const [key, item] of Object.entries(parsed.known)) {
      expect(item.source, key).toMatch(/^E\d{2}$/)
      expect(parsed.sources[item.source], `${key} 的来源 ${item.source}`).toBeTypeOf('string')
      expect(Number(item.display), key).toBe(item.value)
      expect(item.unit.length, key).toBeGreaterThan(0)
      expect(item.note.length, key).toBeGreaterThan(0)
    }
  })

  test('来源编号不存在时直接报错，不做猜测', () => {
    const broken = JSON.parse(PARAMS_TEXT) as { known: Record<string, { source: string }> }
    broken.known.large_event_attendance_2025_wan.source = 'E99'
    expect(() => parseParams(JSON.stringify(broken))).toThrow('不存在的来源')
  })

  test('人均口径由两个事实复算，合计等于两项之和', () => {
    const anchors = deriveAnchors(params())
    // 324.48 亿元 ÷ 4338.58 万人次 ≈ 747.8945 元/人次
    expect(anchors.ticket_exact).toBeCloseTo(747.89, 2)
    expect(anchors.ticket_cny_per_attendance).toBe(748)
    // 747.8945 × 6.85 ≈ 5123 元
    expect(anchors.other_cny_per_attendance).toBe(5123)
    expect(anchors.total_cny_per_attendance).toBe(anchors.ticket_cny_per_attendance + anchors.other_cny_per_attendance)
    expect(anchors.attendance_wan).toBe(4338.58)
    expect(anchors.event_count).toBe(3000)
  })

  test('模型输出不含市场规模、情景数值与摊平人数', () => {
    const { json } = buildOutputs(params())
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.sweep).toBeUndefined()
    expect(parsed.break_even).toBeUndefined()
    expect(json).not.toContain('conditional_wan')
    expect(json).not.toContain('break_even_users_per_10k_fixed')
    expect(json).toContain('不含市场规模')
    expect(Object.keys(parsed)).not.toContain('market_size')
    expect(Object.keys(parsed)).not.toContain('revenue_forecast')
  })

  test('缺口清单覆盖全部未验证参数，且不带任何数值字段', () => {
    const parsed = params()
    const required = [
      'age_share',
      'cross_city_share',
      'multi_payment_share',
      'unique_attendee_ratio',
      'llm_input_tokens_per_session',
      'llm_output_tokens_per_session',
      'usd_cny',
      'price_cny_per_plan',
      'acquisition_cny_per_user',
      'annual_plans_per_user',
      'annual_fixed_cost',
      'competitor_price',
    ]
    for (const key of required) expect(parsed.openItems[key], key).toBeDefined()
    for (const [key, item] of Object.entries(parsed.openItems)) {
      expect(Object.keys(item).sort(), key).toEqual(['label', 'status', 'to_verify_by', 'why'])
      expect(item.status.length, key).toBeGreaterThan(0)
    }
  })

  test('人读版只给公式：写明无法给出市场规模，且不出现情景表头', () => {
    const { text } = buildOutputs(params())
    expect(text).toContain('目前无法给出可验证的市场规模')
    expect(text).toContain('人次不是人数')
    expect(text).toContain('公式：')
    expect(text).not.toContain('条件式人次（万）')
    expect(text).not.toContain('摊平 1 万元固定成本')
    expect(text).not.toContain('获客成本（元）')
    expect(text).not.toContain('年毛利')
  })

  test('展示串保持原文精度或整数，不出现浮点噪声', () => {
    const model = buildModel(params())
    expect(model.display.large_event_box_office_2025_yi).toBe('324.48')
    expect(model.display.large_event_attendance_2025_wan).toBe('4338.58')
    expect(model.display.he_students_2024_wan).toBe('4846.00')
    expect(model.display.llm_input_usd_per_mtok_peak).toBe('0.30')
    expect(model.display.ticket_per_attendance_cny).toBe('748')
    for (const [key, value] of Object.entries(model.display)) expect(value, key).toMatch(/^\d+(?:\.\d{1,4})?$/)
  })
})
