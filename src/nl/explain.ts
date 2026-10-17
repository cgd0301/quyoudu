/**
 * 解释句（D32、D52）。
 *
 * 规则：解释句只能由模板生成，句中出现的每个金额与日期都必须能在引擎结果里找到；
 * 对不上的句子整句删掉，回退为不含数字的模板句。百分比与计数不参与这一匹配。
 * 这里不产生任何新的数字、状态或排序，只把 ResultCore 已有的值放进句子。
 */
import { moneyPaths } from '../engine/money.ts'
import { formatCents } from '../engine/money/format.ts'
import type { ResultCore } from '../engine/result.ts'

const PLAN_TEXT: Record<string, string> = {
  FEASIBLE_UNDER_ASSUMPTIONS: '按当前假设可行',
  INCOMPLETE: '暂无法完整判断',
  PAYMENT_GAP: '发现付款缺口',
  CONSTRAINT_ISSUE: '存在约束问题',
  PAUSED: '已暂停',
  CANCELLED: '已取消',
}

const DAILY_TEXT: Record<string, string> = {
  AMOUNT: '今天仍可额外支出',
  NOT_RECOMMENDED: '当前不建议新增非计划支出',
  NEED_CONFIRMED_PLAN: '确认方案后可计算',
  UNAVAILABLE: '暂无法给出建议金额',
}

function moneyValues(result: ResultCore): number[] {
  const values: number[] = []
  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, `${path}[]`))
      return
    }
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (moneyPaths().includes(path) && typeof record.value === 'number') {
      values.push(record.value)
      return
    }
    for (const [key, inner] of Object.entries(record)) walk(inner, path === '' ? key : `${path}.${key}`)
  }
  walk(result, '')
  return values
}

/** 结果中出现过的日期（YYYY-MM-DD）与原始时刻字符串 */
function dateStrings(result: ResultCore): string[] {
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(node)) out.push(node.slice(0, 10), node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const inner of Object.values(node as Record<string, unknown>)) visit(inner)
  }
  visit(result)
  return out
}

const AMOUNT_IN_SENTENCE = /-?\d+(?:\.\d{2})?\s*元/g
const DATE_IN_SENTENCE = /\d{4}-\d{2}-\d{2}/g

/** D32 校验：金额必须是结果中某个金额值，日期必须出现在结果里 */
export function sentenceIsSupported(sentence: string, result: ResultCore): boolean {
  const values = new Set(moneyValues(result))
  for (const match of sentence.matchAll(AMOUNT_IN_SENTENCE)) {
    const text = (match[0] ?? '').replace(/\s*元$/, '')
    const cents = Math.round(Number(text) * 100)
    if (!values.has(cents)) return false
  }
  const dates = new Set(dateStrings(result))
  for (const match of sentence.matchAll(DATE_IN_SENTENCE)) {
    if (!dates.has(match[0] ?? '')) return false
  }
  return true
}

/** 模板句：只用结果里已有的状态与金额，按句子逐个校验，不合格的整句删掉 */
export function explain(result: ResultCore): string[] {
  const sentences: string[] = []
  const plan = result.states.planState
  sentences.push(`计划状态：${PLAN_TEXT[plan] ?? '暂无法完整判断'}。`)
  if (result.earliestGap !== null) {
    sentences.push(`最早缺口在 ${result.earliestGap.at.slice(0, 10)}，金额 ${formatCents(result.earliestGap.amount.value)} 元。`)
  }
  if (result.cost.netSpend !== null) {
    sentences.push(`该方案的预计消费净支出为 ${formatCents(result.cost.netSpend.value)} 元。`)
  }
  const daily = result.dailyReference
  sentences.push(`每日参考：${DAILY_TEXT[daily.display] ?? '暂无法给出建议金额'}${daily.amount == null ? '。' : ` ${formatCents(daily.amount.value)} 元。`}`)
  if (result.confirmation !== null) {
    sentences.push(`建议分配额（不减少今日可额外支出）为 ${formatCents(result.confirmation.deltaA.value)} 元。`)
  }
  const kept = sentences.filter((sentence) => sentenceIsSupported(sentence, result))
  if (kept.length === 0) return ['结果已生成，详细金额与日期见各页数据。']
  return kept
}
