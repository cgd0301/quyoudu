import { describe, expect, it } from 'vitest'
import type { ResultCore } from '../../src/engine/result.ts'
import { dailyReasonText, dailyStatusText, dailyValueText } from '../../src/ui/dailyText.ts'

/**
 * 每日参考展示的回归测试（R019、§11.4）。
 *
 * 背景：引擎在 display='NOT_RECOMMENDED' 时返回 amount=0（该 0 只用于携带判定依据），
 * 界面原先按 `amount == null` 决定显示金额还是状态文案，导致"当前不建议新增非计划支出"
 * 被渲染成"0.00 元"。这组用例锁定两件事：
 * 1) NOT_RECOMMENDED 必须显示状态文案，不得显示 0.00 元；
 * 2) 真实的 0 元（display='AMOUNT' 且 amount.value=0）仍必须显示成金额。
 */

type Daily = ResultCore['dailyReference']

const basis = { rules: ['R019'] }
const money = (value: number): { value: number; basis: typeof basis } => ({ value, basis })

const make = (partial: Partial<Daily> & Pick<Daily, 'display'>): Daily =>
  ({ unavailable: [], missingReasons: [], ...partial }) as unknown as Daily

describe('dailyValueText：只有 AMOUNT 才显示金额', () => {
  it('AMOUNT 显示金额', () => {
    expect(dailyValueText(make({ display: 'AMOUNT', amount: money(14000) as never }))).toBe('140.00 元')
  })

  it('AMOUNT 且金额为 0 时仍显示 0.00 元（真实 0 元不是"无法给出"）', () => {
    expect(dailyValueText(make({ display: 'AMOUNT', amount: money(0) as never }))).toBe('0.00 元')
  })

  it('NOT_RECOMMENDED 显示状态文案，不得显示 0.00 元', () => {
    const text = dailyValueText(make({ display: 'NOT_RECOMMENDED', amount: money(0) as never }))
    expect(text).toBe('当前不建议新增非计划支出')
    expect(text).not.toContain('0.00')
  })

  it('UNAVAILABLE 显示"暂无法给出建议金额"，不得显示 0.00 元', () => {
    const text = dailyValueText(make({ display: 'UNAVAILABLE' }))
    expect(text).toBe('暂无法给出建议金额')
    expect(text).not.toContain('0.00')
  })

  it('NEED_CONFIRMED_PLAN 显示"确认方案后可计算"', () => {
    expect(dailyValueText(make({ display: 'NEED_CONFIRMED_PLAN' }))).toBe('确认方案后可计算')
  })

  it('AMOUNT 缺金额属于契约异常，给"待确认"而不是 0.00 元', () => {
    const text = dailyValueText(make({ display: 'AMOUNT' }))
    expect(text).toBe('待确认')
    expect(text).not.toContain('0.00')
  })
})

describe('dailyStatusText：AMOUNT 不带状态字样', () => {
  it('AMOUNT 返回空串', () => {
    expect(dailyStatusText('AMOUNT')).toBe('')
  })

  it('三种非金额状态各有文案', () => {
    expect(dailyStatusText('NOT_RECOMMENDED')).toBe('当前不建议新增非计划支出')
    expect(dailyStatusText('UNAVAILABLE')).toBe('暂无法给出建议金额')
    expect(dailyStatusText('NEED_CONFIRMED_PLAN')).toBe('确认方案后可计算')
  })
})

describe('dailyReasonText：原因与状态一致', () => {
  it('AMOUNT 用免责说明', () => {
    expect(dailyReasonText(make({ display: 'AMOUNT', amount: money(14000) as never }))).toBe(
      '按当前输入和假设测算，不是资金安全保证',
    )
  })

  it('NOT_RECOMMENDED 说明"待测额为 0 时已不通过"，不盖成免责说明', () => {
    const text = dailyReasonText(make({ display: 'NOT_RECOMMENDED', amount: money(0) as never }))
    expect(text).toContain('待测额为 0 时已不通过')
    expect(text).not.toBe('按当前输入和假设测算，不是资金安全保证')
  })

  it('UNAVAILABLE 且生活安排未提供时给出具体原因', () => {
    expect(dailyReasonText(make({ display: 'UNAVAILABLE', missingReasons: ['LIVING_ARRANGEMENT_MISSING'] }))).toBe(
      '生活安排未提供',
    )
  })

  it('情景不可用时列出情景与原因', () => {
    const text = dailyReasonText(
      make({ display: 'UNAVAILABLE', unavailable: [{ scenario: 'RECENT_MONTH', reason: 'HISTORY_INSUFFICIENT' }] }),
    )
    expect(text).toContain('近月情景')
    expect(text).toContain('历史不足')
  })

  it('NEED_CONFIRMED_PLAN 说明还没有已确认方案', () => {
    expect(dailyReasonText(make({ display: 'NEED_CONFIRMED_PLAN' }))).toBe('还没有已确认方案')
  })
})
