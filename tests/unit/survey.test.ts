import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  assessInput,
  cleanResponses,
  parseSchema,
  renderBlocked,
  renderNotRun,
  renderReport,
  summarize,
  summarizeQuestions,
  SurveyInputBlocked,
} from '../../scripts/survey-report.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'

/**
 * 本文件里的答卷全部是**测试用合成数据**，只用于验证清洗与统计代码，不是问卷结果，
 * 也不得被引用为任何客户证据。
 */
function schemaOf(text: string) {
  return parseSchema(text)
}

const SCHEMA_TEXT = readFileSync(`${REPO_ROOT}/docs/_work/survey/schema.json`, 'utf8')

const HEADER = [
  'meta_respondent_id',
  'meta_submitted_at',
  'meta_duration_seconds',
  'Q1',
  'Q2',
  'Q3',
  'Q9',
  'Q11',
  'Q15',
].join(',')

function csv(rows: readonly string[]): string {
  return [HEADER, ...rows].join('\n')
}

describe('survey 问卷统计口径', () => {
  test('问卷 schema 结构合法：15 道题 + 3 个元字段，必答题与注意力检查题都在题目清单里', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    expect(schema.questions).toHaveLength(18)
    expect(schema.rules.required).toEqual(['Q1', 'Q2', 'Q3', 'Q9'])
    expect(schema.rules.attention_check).toEqual({ question: 'Q9', expected: '4' })
    expect(schema.rules.duplicate_key).toBe('meta_respondent_id')
  })

  test('问卷 schema 不合法时直接报错，不做猜测', () => {
    expect(() => schemaOf('{}')).toThrow()
    expect(() => schemaOf(JSON.stringify({ version: '1', title: 't', rules: { min_duration_seconds: '60' }, questions: [] }))).toThrow()
  })

  test('清洗顺序：必答缺失、时长过短、注意力检查、重复答卷都不计入有效样本', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const rows = [
      { meta_respondent_id: 'r1', meta_submitted_at: '2026-10-01T10:00:00+08:00', meta_duration_seconds: '200', Q1: '1 次', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '4', Q11: '4', Q15: '' },
      // 重复：同一 respondent_id，晚提交的保留
      { meta_respondent_id: 'r1', meta_submitted_at: '2026-10-01T11:00:00+08:00', meta_duration_seconds: '210', Q1: '2—3 次', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '4', Q11: '4', Q15: '' },
      // 时长过短
      { meta_respondent_id: 'r2', meta_submitted_at: '2026-10-01T12:00:00+08:00', meta_duration_seconds: '5', Q1: '0 次', Q2: '1000 元以下', Q3: '当月生活费', Q9: '4', Q11: '2', Q15: '' },
      // 注意力检查未通过
      { meta_respondent_id: 'r3', meta_submitted_at: '2026-10-01T13:00:00+08:00', meta_duration_seconds: '300', Q1: '1 次', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '3', Q11: '4', Q15: '' },
      // 必答缺失
      { meta_respondent_id: 'r4', meta_submitted_at: '2026-10-01T14:00:00+08:00', meta_duration_seconds: '300', Q1: '', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '4', Q11: '4', Q15: '' },
    ]
    const cleaned = cleanResponses(schema, rows)
    expect(cleaned[0]?.invalid).toEqual(['重复，剔除'])
    expect(cleaned[1]?.invalid).toEqual([])
    expect(cleaned[2]?.invalid.join()).toContain('时长达短')
    expect(cleaned[3]?.invalid.join()).toContain('注意力检查未通过')
    expect(cleaned[4]?.invalid.join()).toContain('必答缺失：Q1')
  })

  test('统计只算有效答卷；单选题分母为该题有效回答，多选题分母为有效答卷数，开放题只数条数', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const rows = [
      { meta_respondent_id: 'a', meta_submitted_at: '2026-10-01T10:00:00+08:00', meta_duration_seconds: '200', Q1: '1 次', Q2: '2000—2999 元', Q3: '当月生活费;兼职或实习收入', Q9: '4', Q11: '5', Q15: '' },
      { meta_respondent_id: 'b', meta_submitted_at: '2026-10-01T10:10:00+08:00', meta_duration_seconds: '200', Q1: '1 次', Q2: '2000—2999 元', Q3: '兼职或实习收入', Q9: '4', Q11: '4', Q15: '希望能提醒我付款日' },
      // Q1 为空（必答题缺失）：该答卷无效，Q1 计为缺失
      { meta_respondent_id: 'c', meta_submitted_at: '2026-10-01T10:20:00+08:00', meta_duration_seconds: '200', Q1: '', Q2: '3000—4999 元', Q3: '当月生活费', Q9: '4', Q11: '3', Q15: '' },
    ]
    const summary = summarize(schema, csv(rows.map((row) => Object.values(row).join(','))), { data_version: 'TEST-v1' })
    expect(summary.state).toBe('ok')
    expect(summary.submitted).toBe(3)
    // 必答题里没有 Q1 之外的空值：Q1 属于 required，因此第三条整体无效
    expect(summary.valid).toBe(2)
    expect(summary.invalid.map((item) => item.reason)).toEqual(['必答缺失：Q1'])
    const q1 = summary.questions.find((question) => question.id === 'Q1')
    expect(q1?.counts.find((item) => item.option === '1 次')?.count).toBe(2)
    expect(q1?.counts.find((item) => item.option === '1 次')?.share).toBe(100)
    const q3 = summary.questions.find((question) => question.id === 'Q3')
    expect(q3?.averageSelections).toBe(1.5)
    expect(q3?.counts.find((item) => item.option === '兼职或实习收入')?.count).toBe(2)
    // 分母是有效答卷数 2：兼职 2/2 = 100%
    expect(q3?.counts.find((item) => item.option === '兼职或实习收入')?.share).toBe(100)
    const q15 = summary.questions.find((question) => question.id === 'Q15')
    expect(q15?.openCount).toBe(1)
    expect(summary.belowMinimum).toBe(true)
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test('量表题报告 n、均值与中位数，不把均值当结论', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const stats = summarizeQuestions(schema, [
      { values: { Q11: '5' }, rowNumber: 2, invalid: [] },
      { values: { Q11: '3' }, rowNumber: 3, invalid: [] },
      { values: { Q11: '' }, rowNumber: 4, invalid: [] },
    ].map((row) => row as never))
    const q11 = stats.find((question) => question.id === 'Q11')
    expect(q11?.answered).toBe(2)
    expect(q11?.missing).toBe(1)
    expect(q11?.mean).toBe(4)
    expect(q11?.median).toBe(4)
    expect(q11?.counts.map((item) => item.option)).toEqual(['1', '2', '3', '4', '5'])
  })

  test('没有原始答卷时只写“未运行（缺少输入）”，不出现任何统计数字', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const text = renderNotRun(schema)
    expect(text).toContain('状态：未运行（缺少输入）')
    expect(text).toContain('不得被当作“没有需求”或“样本为 0”的证据')
    expect(text).not.toMatch(/\d+\.\d%/)
    expect(text).not.toMatch(/\| 选项 \|/)
  })

  test('报告头部写数据版本、SHA-256、采集区间与样本量不足提示', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const summary = summarize(schema, csv(['a,2026-10-01T10:00:00+08:00,200,1 次,2000—2999 元,当月生活费,4,4,']), {
      data_version: 'TEST-v2',
      collected_from: '2026-10-01',
      collected_to: '2026-10-07',
      channel: '线上测试链接',
      sampling: '便利抽样（测试）',
    })
    const text = renderReport(summary, schema)
    expect(text).toContain('数据版本：TEST-v2')
    expect(text).toContain('采集起止：2026-10-01 — 2026-10-07')
    expect(text).toContain('有效 / 提交：1 / 1')
    expect(text).toContain('样本量不足')
    expect(text).toContain('只能写“在这批受访者中……”')
  })

  test('字段与 schema 不一致时在统计前阻断，不按缺失值算出一份“0 答卷”', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const issues = assessInput(schema, 'a,b\n1,2')
    expect(issues.map((issue) => issue.code)).toContain('schema_mismatch')
    expect(() => summarize(schema, 'a,b\n1,2', {})).toThrow(SurveyInputBlocked)
    const report = renderBlocked(schema, issues)
    expect(report).toContain('状态：阻塞（原始导出不可用）')
    expect(report).not.toMatch(/\d+\.\d%/)
  })

  test('中文题干被替换成问号的导出件在统计前阻断，报告不出现回答分布', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    const header = 'meta_respondent_id,meta_submitted_at,meta_duration_seconds,Q1,Q2,Q3,Q9'
    const text = [header, 'a,2026-10-01T10:00:00+08:00,200,???;????,?????,???,4'].join('\n')
    const issues = assessInput(schema, text)
    expect(issues.map((issue) => issue.code)).toContain('encoding_loss')
    expect(() => summarize(schema, text, {})).toThrow(SurveyInputBlocked)
    const report = renderBlocked(schema, issues)
    expect(report).toContain('编码')
    expect(report).not.toContain('| 选项 |')
  })

  test('空 CSV 在统计前阻断', () => {
    const schema = schemaOf(SCHEMA_TEXT)
    expect(assessInput(schema, '').map((issue) => issue.code)).toContain('empty')
    expect(() => summarize(schema, '', {})).toThrow(SurveyInputBlocked)
  })
})
