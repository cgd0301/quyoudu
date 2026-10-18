/**
 * pnpm survey:report
 *
 * 按 docs/_work/survey/schema.json 的题型与清洗规则，统计 docs/_work/survey/raw/responses.csv。
 *
 * 纪律（本脚本的存在理由）：
 * - 客户证据只能来自真实问卷。没有原始答卷时，本脚本只写“未运行（缺少输入）”，**不生成任何数字**；
 * - 无效答卷（重复、时长过短、注意力检查未通过、必答缺失）不计入任何分母；
 * - 多选题分母为有效答卷数，单选/量表分母为该题有效回答数；
 * - 开放题只统计条数，原文不进入报告；
 * - 报告头部写 data_version、原始文件 SHA-256 与采集日期，任何统计都能追溯到具体文件。
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { parseCsv } from './lib/csv.ts'
import { readText, readTextIfExists, repoPath, writeFileAtomic } from './lib/repo.ts'

export const SURVEY_DIR = 'docs/_work/survey'
export const RAW_CSV = `${SURVEY_DIR}/raw/responses.csv`
export const RAW_META = `${SURVEY_DIR}/raw/metadata.json`
export const SCHEMA_PATH = `${SURVEY_DIR}/schema.json`
export const REPORT_PATH = `${SURVEY_DIR}/report.md`

export type QuestionType = 'single' | 'multi' | 'scale' | 'open' | 'meta'

export type SurveyQuestion = {
  id: string
  label: string
  type: QuestionType
  options?: string[]
  min?: number
  max?: number
}

export type SurveySchema = {
  version: string
  title: string
  rules: {
    min_duration_seconds: number
    attention_check: { question: string; expected: string } | null
    duplicate_key: string | null
    duplicate_keep: 'latest' | 'first'
    required: string[]
    min_valid_for_conclusions: number
  }
  questions: SurveyQuestion[]
}

export type RawMetadata = {
  data_version?: string
  collected_from?: string
  collected_to?: string
  channel?: string
  sampling?: string
  distributed?: number
}

/** 一条答卷 + 剔除原因；invalid 为空表示有效 */
export type ResponseRow = {
  rowNumber: number
  values: Record<string, string>
  invalid: string[]
}

export type QuestionStats = {
  id: string
  label: string
  type: QuestionType
  /** 回答了该题的答卷数（单选题与量表题的分母；多选题分母是 validTotal） */
  answered: number
  missing: number
  counts: { option: string; count: number; share: number }[]
  mean: number | null
  median: number | null
  /** 多选题平均选择项数 */
  averageSelections: number | null
  openCount: number | null
}

export type SurveySummary = {
  state: 'not_run' | 'ok'
  dataVersion: string
  collectedFrom: string | null
  collectedTo: string | null
  channel: string | null
  sampling: string | null
  submitted: number
  valid: number
  invalid: { reason: string; count: number }[]
  minValidForConclusions: number
  belowMinimum: boolean
  sha256: string | null
  questions: QuestionStats[]
}

export function isQuestionType(value: unknown): value is QuestionType {
  return value === 'single' || value === 'multi' || value === 'scale' || value === 'open' || value === 'meta'
}

/** 校验 schema 结构；不合法直接报错，不做猜测 */
export function parseSchema(text: string): SurveySchema {
  const data: unknown = JSON.parse(text)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('schema.json 不是对象')
  const record = data as Record<string, unknown>
  if (typeof record.version !== 'string' || typeof record.title !== 'string') throw new Error('schema.json 缺少 version 或 title')
  const rules = record.rules
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('schema.json 缺少 rules')
  const r = rules as Record<string, unknown>
  if (typeof r.min_duration_seconds !== 'number' || !Number.isSafeInteger(r.min_duration_seconds)) {
    throw new Error('schema.json 的 min_duration_seconds 不是整数')
  }
  if (typeof r.min_valid_for_conclusions !== 'number' || !Number.isSafeInteger(r.min_valid_for_conclusions)) {
    throw new Error('schema.json 的 min_valid_for_conclusions 不是整数')
  }
  if (!Array.isArray(r.required) || !r.required.every((item) => typeof item === 'string')) throw new Error('schema.json 的 required 不是字符串数组')
  const attention = r.attention_check
  let attentionCheck: SurveySchema['rules']['attention_check'] = null
  if (attention !== null && attention !== undefined) {
    if (typeof attention !== 'object' || Array.isArray(attention)) throw new Error('schema.json 的 attention_check 格式不符')
    const a = attention as Record<string, unknown>
    if (typeof a.question !== 'string' || typeof a.expected !== 'string') throw new Error('schema.json 的 attention_check 缺少 question/expected')
    attentionCheck = { question: a.question, expected: a.expected }
  }
  const duplicateKey = r.duplicate_key
  if (duplicateKey !== null && duplicateKey !== undefined && typeof duplicateKey !== 'string') throw new Error('schema.json 的 duplicate_key 格式不符')
  const keep = r.duplicate_keep
  if (keep !== 'latest' && keep !== 'first') throw new Error('schema.json 的 duplicate_keep 只能是 latest 或 first')
  if (!Array.isArray(record.questions)) throw new Error('schema.json 缺少 questions')
  const questions = record.questions.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${index + 1} 题不是对象`)
    const q = item as Record<string, unknown>
    if (typeof q.id !== 'string' || q.id === '') throw new Error(`第 ${index + 1} 题缺少 id`)
    if (typeof q.label !== 'string' || q.label === '') throw new Error(`${q.id} 缺少 label`)
    if (!isQuestionType(q.type)) throw new Error(`${q.id} 的 type 不合法：${String(q.type)}`)
    const question: SurveyQuestion = { id: q.id, label: q.label, type: q.type }
    if (q.type === 'single' || q.type === 'multi') {
      if (!Array.isArray(q.options) || q.options.length === 0 || !q.options.every((option) => typeof option === 'string')) {
        throw new Error(`${q.id} 的 options 不合法`)
      }
      question.options = q.options as string[]
    }
    if (q.type === 'scale') {
      if (typeof q.min !== 'number' || typeof q.max !== 'number' || q.min >= q.max) throw new Error(`${q.id} 的 min/max 不合法`)
      question.min = q.min
      question.max = q.max
    }
    return question
  })
  const ids = new Set(questions.map((question) => question.id))
  if (ids.size !== questions.length) throw new Error('schema.json 有重复的题目 id')
  for (const required of r.required as string[]) {
    if (!ids.has(required)) throw new Error(`required 中的 ${required} 不在题目清单里`)
  }
  if (attentionCheck !== null && !ids.has(attentionCheck.question)) throw new Error('注意力检查题不在题目清单里')
  return {
    version: record.version,
    title: record.title,
    rules: {
      min_duration_seconds: r.min_duration_seconds,
      attention_check: attentionCheck,
      duplicate_key: typeof duplicateKey === 'string' ? duplicateKey : null,
      duplicate_keep: keep,
      required: r.required as string[],
      min_valid_for_conclusions: r.min_valid_for_conclusions,
    },
    questions,
  }
}

function cell(values: Record<string, string>, key: string): string {
  return (values[key] ?? '').trim()
}

function isBlank(value: string): boolean {
  return value === ''
}

/**
 * 清洗：必答缺失 → 时长 → 注意力检查 → 重复。
 * 重复按 duplicate_key 去重（保留 latest 或 first），被丢弃的答卷计为“重复，剔除”。
 */
export function cleanResponses(schema: SurveySchema, rows: readonly Record<string, string>[]): ResponseRow[] {
  const checked: ResponseRow[] = rows.map((values, index) => {
    const invalid: string[] = []
    for (const required of schema.rules.required) {
      if (isBlank(cell(values, required))) invalid.push(`必答缺失：${required}`)
    }
    const duration = Number(cell(values, 'meta_duration_seconds'))
    if (isBlank(cell(values, 'meta_duration_seconds')) || !Number.isFinite(duration)) invalid.push('时长无法解析')
    else if (duration < schema.rules.min_duration_seconds) invalid.push(`时长达短（<${schema.rules.min_duration_seconds} 秒）`)
    const attention = schema.rules.attention_check
    if (attention !== null && cell(values, attention.question) !== attention.expected) invalid.push('注意力检查未通过')
    return { rowNumber: index + 2, values, invalid }
  })

  const key = schema.rules.duplicate_key
  if (key === null) return checked
  const groups = new Map<string, ResponseRow[]>()
  for (const row of checked) {
    const value = cell(row.values, key)
    if (value === '') continue
    const list = groups.get(value) ?? []
    list.push(row)
    groups.set(value, list)
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((left, right) => {
      const a = cell(left.values, 'meta_submitted_at')
      const b = cell(right.values, 'meta_submitted_at')
      return a < b ? -1 : a > b ? 1 : left.rowNumber - right.rowNumber
    })
    const keepRow = schema.rules.duplicate_keep === 'latest' ? sorted[sorted.length - 1] : sorted[0]
    for (const row of list) {
      if (row === keepRow) continue
      row.invalid.push('重复，剔除')
    }
  }
  return checked
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? null
  const a = sorted[middle - 1] ?? 0
  const b = sorted[middle] ?? 0
  return round1((a + b) / 2)
}

/** 逐题统计；只统计有效答卷 */
export function summarizeQuestions(schema: SurveySchema, valid: readonly ResponseRow[]): QuestionStats[] {
  const total = valid.length
  return schema.questions.map((question) => {
    if (question.type === 'meta') {
      return { id: question.id, label: question.label, type: question.type, answered: total, missing: 0, counts: [], mean: null, median: null, averageSelections: null, openCount: null }
    }
    if (question.type === 'multi') {
      const options = question.options ?? []
      const answeredRows = valid.filter((row) => !isBlank(cell(row.values, question.id)))
      const counts = options.map((option) => {
        const count = answeredRows.filter((row) => cell(row.values, question.id).split(/[;；]/).map((item) => item.trim()).includes(option)).length
        return { option, count, share: total === 0 ? 0 : round1((count / total) * 100) }
      })
      for (const row of answeredRows) {
        for (const chosen of cell(row.values, question.id).split(/[;；]/).map((item) => item.trim())) {
          if (chosen !== '' && !options.includes(chosen)) {
            const extra = counts.find((item) => item.option === chosen)
            if (extra === undefined) counts.push({ option: chosen, count: 1, share: total === 0 ? 0 : round1((1 / total) * 100) })
            else {
              extra.count += 1
              extra.share = total === 0 ? 0 : round1((extra.count / total) * 100)
            }
          }
        }
      }
      const selections = answeredRows.map((row) => cell(row.values, question.id).split(/[;；]/).filter((item) => item.trim() !== '').length)
      return {
        id: question.id,
        label: question.label,
        type: question.type,
        answered: answeredRows.length,
        missing: valid.length - answeredRows.length,
        counts,
        mean: null,
        median: null,
        averageSelections: selections.length === 0 ? null : round1(selections.reduce((sum, value) => sum + value, 0) / selections.length),
        openCount: null,
      }
    }
    if (question.type === 'open') {
      const answered = valid.filter((row) => !isBlank(cell(row.values, question.id))).length
      return { id: question.id, label: question.label, type: question.type, answered, missing: valid.length - answered, counts: [], mean: null, median: null, averageSelections: null, openCount: answered }
    }
    // single / scale
    const answeredRows = valid.filter((row) => !isBlank(cell(row.values, question.id)))
    const options = question.type === 'scale'
      ? Array.from({ length: (question.max ?? 0) - (question.min ?? 0) + 1 }, (_, index) => String((question.min ?? 0) + index))
      : (question.options ?? [])
    const counts = options.map((option) => {
      const count = answeredRows.filter((row) => cell(row.values, question.id) === option).length
      return { option, count, share: answeredRows.length === 0 ? 0 : round1((count / answeredRows.length) * 100) }
    })
    let mean: number | null = null
    let med: number | null = null
    if (question.type === 'scale') {
      const numbers = answeredRows.map((row) => Number(cell(row.values, question.id))).filter((value) => Number.isFinite(value))
      if (numbers.length > 0) mean = round1(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)
      med = median(numbers)
    }
    return { id: question.id, label: question.label, type: question.type, answered: answeredRows.length, missing: valid.length - answeredRows.length, counts, mean, median: med, averageSelections: null, openCount: null }
  })
}

function invalidSummary(rows: readonly ResponseRow[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const reason of new Set(row.invalid)) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((left, right) => (left.reason < right.reason ? -1 : 1))
}

export function summarize(schema: SurveySchema, csvText: string, metadata: RawMetadata): SurveySummary {
  const table = parseCsv(csvText.replace(/^\uFEFF/, ''))
  const [header = [], ...body] = table
  const rows = body
    .filter((cells) => cells.some((value) => value.trim() !== ''))
    .map((cells) => {
      const values: Record<string, string> = {}
      header.forEach((name, index) => {
        values[name.trim()] = cells[index] ?? ''
      })
      return values
    })
  const cleaned = cleanResponses(schema, rows)
  const valid = cleaned.filter((row) => row.invalid.length === 0)
  const questions = summarizeQuestions(schema, valid)
  return {
    state: 'ok',
    dataVersion: metadata.data_version ?? '未标注',
    collectedFrom: metadata.collected_from ?? null,
    collectedTo: metadata.collected_to ?? null,
    channel: metadata.channel ?? null,
    sampling: metadata.sampling ?? null,
    submitted: cleaned.length,
    valid: valid.length,
    invalid: invalidSummary(cleaned.filter((row) => row.invalid.length > 0)),
    minValidForConclusions: schema.rules.min_valid_for_conclusions,
    belowMinimum: valid.length < schema.rules.min_valid_for_conclusions,
    sha256: createHash('sha256').update(csvText, 'utf8').digest('hex'),
    questions,
  }
}

/** 未运行时的报告：只有状态与操作指引，没有任何数字 */
export function renderNotRun(schema: SurveySchema): string {
  return [
    '# 问卷统计结果',
    '',
    '> **状态：未运行（缺少输入）**',
    '> 仓库中没有 `docs/_work/survey/raw/responses.csv`，因此本文件不含任何统计数字。',
    '> 问卷尚未发放；本文件不得被当作“没有需求”或“样本为 0”的证据。',
    '',
    '## 口径来源',
    '',
    `- 题型与清洗规则：\`${SCHEMA_PATH}\`（version ${schema.version}）`,
    `- 发放口径：\`${SURVEY_DIR}/questionnaire.md\``,
    `- 结果录入模板：\`${SURVEY_DIR}/analysis_template.md\``,
    '',
    '## 恢复步骤',
    '',
    '1. 导出去标识化答卷到 `docs/_work/survey/raw/responses.csv`（不入库）。',
    '2. 在 `docs/_work/survey/raw/metadata.json` 记录 `data_version`、采集起止日期、渠道与抽样方式。',
    '3. 运行 `pnpm survey:report`。',
    '',
  ].join('\n')
}

export function renderReport(summary: SurveySummary, schema: SurveySchema): string {
  const lines: string[] = []
  lines.push('# 问卷统计结果', '')
  lines.push(`- 数据版本：${summary.dataVersion}`)
  lines.push(`- 原始文件 SHA-256：\`${summary.sha256 ?? ''}\``)
  lines.push(`- 采集起止：${summary.collectedFrom ?? '未标注'} — ${summary.collectedTo ?? '未标注'}`)
  lines.push(`- 发放渠道：${summary.channel ?? '未标注'}；抽样方式：${summary.sampling ?? '未标注'}`)
  lines.push(`- 有效 / 提交：${summary.valid} / ${summary.submitted}`)
  if (summary.belowMinimum) lines.push(`- **样本量不足（<${summary.minValidForConclusions}）**：只作探索性描述，不用于推广结论。`)
  lines.push(`- 题型与清洗规则：\`${SCHEMA_PATH}\`（version ${schema.version}）`)
  lines.push('')
  lines.push('## 清洗明细', '')
  lines.push('| 剔除原因 | 条数 |')
  lines.push('| --- | --- |')
  for (const item of summary.invalid) lines.push(`| ${item.reason} | ${item.count} |`)
  if (summary.invalid.length === 0) lines.push('| 无 | 0 |')
  lines.push('')
  lines.push('## 逐题结果', '')
  for (const question of summary.questions) {
    if (question.type === 'meta') continue
    lines.push(`### ${question.id}（${question.type}）`, '')
    lines.push(`题目：${question.label}`, '')
    if (question.type === 'open') {
      lines.push(`- 作答条数：${question.openCount ?? 0}；缺失：${question.missing}（原文不进入报告）`)
    } else if (question.type === 'multi') {
      lines.push(`- 有效答卷：${summary.valid}；作答：${question.answered}；缺失：${question.missing}；平均选择 ${question.averageSelections ?? 0} 项`)
      lines.push('')
      lines.push('| 选项 | 选择数 | 占比（分母=有效答卷） |')
      lines.push('| --- | --- | --- |')
      for (const item of question.counts) lines.push(`| ${item.option} | ${item.count} | ${item.share}% |`)
    } else {
      lines.push(`- 有效回答：${question.answered}；缺失：${question.missing}`)
      if (question.mean !== null) lines.push(`- 均值：${question.mean}；中位数：${question.median ?? '—'}`)
      lines.push('')
      lines.push('| 选项 | 人数 | 占比（分母=该题有效回答） |')
      lines.push('| --- | --- | --- |')
      for (const item of question.counts) lines.push(`| ${item.option} | ${item.count} | ${item.share}% |`)
    }
    lines.push('')
  }
  lines.push('## 结论边界', '')
  lines.push('- 只能写“在这批受访者中……”，必须同时给出样本量、采集时间与抽样方式。')
  lines.push('- 自报使用意愿不等于实际使用；自报付费区间不等于购买转化。')
  lines.push('- 便利抽样不得外推为全国 18—30 岁青年的比例。')
  lines.push('')
  return lines.join('\n')
}

export function readSchema(): SurveySchema {
  return parseSchema(readText(repoPath(SCHEMA_PATH)))
}

export function readMetadata(): RawMetadata {
  const text = readTextIfExists(repoPath(RAW_META))
  if (text === null) return {}
  const data: unknown = JSON.parse(text)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${RAW_META} 不是对象`)
  return data as RawMetadata
}

export function runSurvey(): { written: boolean; summary: SurveySummary | null } {
  const schema = readSchema()
  const csvPath = repoPath(RAW_CSV)
  if (!existsSync(csvPath)) {
    writeFileAtomic(repoPath(REPORT_PATH), renderNotRun(schema))
    return { written: true, summary: null }
  }
  const summary = summarize(schema, readText(csvPath), readMetadata())
  writeFileAtomic(repoPath(REPORT_PATH), renderReport(summary, schema))
  return { written: true, summary }
}

export async function main(): Promise<number> {
  const { summary } = runSurvey()
  if (summary === null) {
    console.log(`缺少输入：${RAW_CSV} 不存在。已写入“未运行（缺少输入）”，未生成任何统计。`)
    return 0
  }
  console.log(
    `已写入 ${REPORT_PATH}：有效 ${summary.valid} / 提交 ${summary.submitted}；` +
      `数据版本 ${summary.dataVersion}；${summary.belowMinimum ? '样本量不足，只作探索性描述' : '样本量达到最低要求'}`,
  )
  return 0
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
