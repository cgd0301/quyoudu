/**
 * 每日非计划支出参考（R019、§11.4）的展示文案。
 *
 * 这层逻辑从 src/App.tsx 抽出，原因是一个真实缺陷：
 * 引擎在 display='NOT_RECOMMENDED' 时仍返回 amount（值为 0，用于携带判定依据，
 * 见 src/engine/daily/index.ts 的 blockedAmount），而界面原先用
 * `amount == null` 决定显示金额还是状态文案，于是"当前不建议新增非计划支出"
 * 被显示成"0.00 元"。0 元与"不建议新增"是两种不同结论，不能互相替代（§11.4）。
 *
 * 现在的规则是：**只有 display==='AMOUNT' 才显示金额**；
 * 其余三种状态一律显示 §11.4 的状态文案。这样真实的 0 元（若出现）
 * 仍会以金额出现，而 NOT_RECOMMENDED 的 0 不再被当作可花金额。
 */
import { formatCents } from '../engine/money/format.ts'
import { LABEL_TEXT, type ResultCore } from '../engine/result.ts'

type DailyReference = ResultCore['dailyReference']
type DailyDisplay = DailyReference['display']

/** 情景不可用原因的中文（§11.4、R018 异常） */
const SCENARIO_REASON_TEXT: Readonly<Record<DailyReference['unavailable'][number]['reason'], string>> = {
  HISTORY_INSUFFICIENT: '历史不足',
  RECORDS_INCOMPLETE: '记录不完整',
  CATEGORY_FLAGS_MISSING: '类别标注缺失',
  COVERAGE_UNCLEAR: '覆盖关系不清',
  CONFIG_VERSION_MISSING: '配置版本缺失',
}

/** §11.4 的状态文案；AMOUNT 不是状态，有金额时不显示状态字样 */
export function dailyStatusText(display: DailyDisplay): string {
  switch (display) {
    case 'AMOUNT':
      return ''
    case 'NEED_CONFIRMED_PLAN':
      return LABEL_TEXT.NEED_CONFIRMED_PLAN
    case 'UNAVAILABLE':
      return LABEL_TEXT.UNAVAILABLE
    case 'NOT_RECOMMENDED':
      return LABEL_TEXT.NOT_RECOMMENDED
  }
}

/**
 * 主展示位应显示的文本：AMOUNT 显示金额（含真实的 0.00 元），
 * 其余状态显示状态文案，绝不把"无法给出"或"不建议"折成 0 元。
 */
export function dailyValueText(reference: DailyReference): string {
  if (reference.display !== 'AMOUNT') return dailyStatusText(reference.display)
  const amount = reference.amount
  // AMOUNT 时引擎保证有金额；缺失属于契约异常，给"待确认"而不是 0.00 元
  return amount == null ? '待确认' : `${formatCents(amount.value)} 元`
}

/** 没有金额时给出真实原因，不统一写成"尚无已确认方案"，也不盖掉"不建议新增"的原因 */
export function dailyReasonText(reference: DailyReference): string {
  if (reference.display === 'AMOUNT') return LABEL_TEXT.DAILY_DISCLAIMER
  if (reference.display === 'NOT_RECOMMENDED') return '待测额为 0 时已不通过：存在缺口、冲突或预算超限'
  if (reference.missingReasons.length > 0) return reference.missingReasons.map((reason) => LABEL_TEXT[reason]).join('、')
  if (reference.unavailable.length > 0) {
    return reference.unavailable
      .map((row) => `${row.scenario === 'RECENT_MONTH' ? '近月情景' : '仅已确认安排'}：${SCENARIO_REASON_TEXT[row.reason]}`)
      .join('；')
  }
  if (reference.display === 'NEED_CONFIRMED_PLAN') return '还没有已确认方案'
  return '关键资金、付款、生活安排、用途或检查期间不足'
}
