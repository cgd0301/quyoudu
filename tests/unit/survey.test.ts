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
import { parseCsv } from '../../scripts/lib/csv.ts'

/**
 * 本文件里的答卷全部是**测试用合成数据**，只用于验证清洗与统计代码，不是问卷结果，
 * 也不得被引用为任何客户证据。实际投放 schema 的结构与脱敏数据另有对齐测试。
 */
const FIXTURE_SCHEMA = JSON.stringify({
  version: 'test-1',
  title: '测试用 schema',
  rules: {
    min_duration_seconds: 60,
    attention_check: { question: 'Q9', expected: '4' },
    duplicate_key: 'meta_respondent_id',
    duplicate_keep: 'latest',
    required: ['Q1', 'Q2', 'Q3', 'Q9'],
    min_valid_for_conclusions: 3,
  },
  questions: [
    { id: 'Q1', label: 'q1', type: 'single', options: ['1 次', '2—3 次'] },
    { id: 'Q2', label: 'q2', type: 'single', options: ['1000 元以下', '2000—2999 元'] },
    { id: 'Q3', label: 'q3', type: 'multi', options: ['当月生活费', '兼职或实习收入'] },
    { id: 'Q9', label: 'attention', type: 'scale', min: 1, max: 5 },
    { id: 'Q11', label: 'intent', type: 'scale', min: 1, max: 5 },
    { id: 'Q15', label: 'open', type: 'open' },
    { id: 'meta_respondent_id', label: 'id', type: 'meta' },
    { id: 'meta_submitted_at', label: 'time', type: 'meta' },
    { id: 'meta_duration_seconds', label: 'duration', type: 'meta' },
  ],
})

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

function schema() {
  return parseSchema(FIXTURE_SCHEMA)
}

function csv(rows: readonly string[]): string {
  return [HEADER, ...rows].join('\n')
}

describe('survey 问卷统计口径', () => {
  test('实际投放 schema 是 10 题 + 3 个元字段，必答齐全，无注意力检查/无应答编号', () => {
    const deployed = parseSchema(readFileSync(`${REPO_ROOT}/docs/_work/survey/schema.json`, 'utf8'))
    expect(deployed.version).toBe('2')
    expect(deployed.questions.filter((question) => question.type !== 'meta')).toHaveLength(10)
    expect(deployed.questions.filter((question) => question.type === 'meta')).toHaveLength(3)
    expect(deployed.rules.required).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10'])
    expect(deployed.rules.attention_check).toBeNull()
    expect(deployed.rules.duplicate_key).toBeNull()
    expect(deployed.rules.min_valid_for_conclusions).toBe(30)
  })

  test('脱敏分析数据与实际 schema 对齐：10 题齐全、30 行、无身份列、无精确时间戳', () => {
    const deployed = parseSchema(readFileSync(`${REPO_ROOT}/docs/_work/survey/schema.json`, 'utf8'))
    const text = readFileSync(`${REPO_ROOT}/docs/_work/survey/analysis/responses.csv`, 'utf8')
    const table = parseCsv(text.replace(/^\uFEFF/, ''))
    const header = (table[0] ?? []).map((cell) => cell.trim())
    for (const question of deployed.questions) expect(header, question.id).toContain(question.id)
    expect(table.length - 1).toBe(30)
    expect(header).not.toContain('电子邮件')
    expect(header).not.toContain('名称')
    expect(header).not.toContain('开始时间')
    expect(header).not.toContain('完成时间')
  })

  test('问卷 schema 不合法时直接报错，不做猜测', () => {
    expect(() => parseSchema('{}')).toThrow()
    expect(() => parseSchema(JSON.stringify({ version: '1', title: 't', rules: { min_duration_seconds: '60' }, questions: [] }))).toThrow()
  })

  test('清洗顺序：必答缺失、时长过短、注意力检查、重复答卷都不计入有效样本', () => {
    const rows = [
      { meta_respondent_id: 'r1', meta_submitted_at: '2026-10-01T10:00:00+08:00', meta_duration_seconds: '200', Q1: '1 次', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '4', Q11: '4', Q15: '' },
      // 重复：同一 respondent_id，晚提交的保留
      { meta_respondent_id: 'r1', meta_submitted_at: '2026-10-01T11:00:00+08:00', meta_duration_seconds: '210', Q1: '2—3 次', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '4', Q11: '4', Q15: '' },
      // 时长过短
      { meta_respondent_id: 'r2', meta_submitted_at: '2026-10-01T12:00:00+08:00', meta_duration_seconds: '5', Q1: '1 次', Q2: '1000 元以下', Q3: '当月生活费', Q9: '4', Q11: '2', Q15: '' },
      // 注意力检查未通过
      { meta_respondent_id: 'r3', meta_submitted_at: '2026-10-01T13:00:00+08:00', meta_duration_seconds: '300', Q1: '1 次', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '3', Q11: '4', Q15: '' },
      // 必答缺失
      { meta_respondent_id: 'r4', meta_submitted_at: '2026-10-01T14:00:00+08:00', meta_duration_seconds: '300', Q1: '', Q2: '2000—2999 元', Q3: '当月生活费', Q9: '4', Q11: '4', Q15: '' },
    ]
    const cleaned = cleanResponses(schema(), rows)
    expect(cleaned[0]?.invalid).toEqual(['重复，剔除'])
    expect(cleaned[1]?.invalid).toEqual([])
    expect(cleaned[2]?.invalid.join()).toContain('时长达短')
    expect(cleaned[3]?.invalid.join()).toContain('注意力检查未通过')
    expect(cleaned[4]?.invalid.join()).toContain('必答缺失：Q1')
  })

  test('统计只算有效答卷；单选题分母为该题有效回答，多选题分母为有效答卷数，开放题只数条数', () => {
    const rows = [
      { meta_respondent_id: 'a', meta_submitted_at: '2026-10-01T10:00:00+08:00', meta_duration_seconds: '200', Q1: '1 次', Q2: '2000—2999 元', Q3: '当月生活费;兼职或实习收入', Q9: '4', Q11: '5', Q15: '' },
      { meta_respondent_id: 'b', meta_submitted_at: '2026-10-01T10:10:00+08:00', meta_duration_seconds: '200', Q1: '1 次', Q2: '2000—2999 元', Q3: '兼职或实习收入', Q9: '4', Q11: '4', Q15: '希望能提醒我付款日' },
      // Q1 为空（必答题缺失）：该答卷无效，Q1 计为缺失
      { meta_respondent_id: 'c', meta_submitted_at: '2026-10-01T10:20:00+08:00', meta_duration_seconds: '200', Q1: '', Q2: '3000—4999 元', Q3: '当月生活费', Q9: '4', Q11: '3', Q15: '' },
    ]
    const summary = summarize(schema(), csv(rows.map((row) => Object.values(row).join(','))), { data_version: 'TEST-v1' })
    expect(summary.state).toBe('ok')
    expect(summary.submitted).toBe(3)
    expect(summary.valid).toBe(2)
    expect(summary.invalid.map((item) => item.reason)).toEqual(['必答缺失：Q1'])
    const q1 = summary.questions.find((question) => question.id === 'Q1')
    expect(q1?.counts.find((item) => item.option === '1 次')?.count).toBe(2)
    expect(q1?.counts.find((item) => item.option === '1 次')?.share).toBe(100)
    const q3 = summary.questions.find((question) => question.id === 'Q3')
    expect(q3?.averageSelections).toBe(1.5)
    expect(q3?.counts.find((item) => item.option === '兼职或实习收入')?.count).toBe(2)
    expect(q3?.counts.find((item) => item.option === '兼职或实习收入')?.share).toBe(100)
    const q15 = summary.questions.find((question) => question.id === 'Q15')
    expect(q15?.openCount).toBe(1)
    expect(summary.belowMinimum).toBe(true)
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test('实际脱敏数据可复算关键计数（跨城观演 9、只免费 12、试用前两档 21）', () => {
    const deployed = parseSchema(readFileSync(`${REPO_ROOT}/docs/_work/survey/schema.json`, 'utf8'))
    const text = readFileSync(`${REPO_ROOT}/docs/_work/survey/analysis/responses.csv`, 'utf8')
    const metadata = JSON.parse(readFileSync(`${REPO_ROOT}/docs/_work/survey/analysis/metadata.json`, 'utf8')) as Record<string, string | number>
    const summary = summarize(deployed, text, metadata)
    expect(summary.submitted).toBe(30)
    expect(summary.valid).toBe(30)
    const q3 = summary.questions.find((question) => question.id === 'Q3')
    expect(q3?.counts.find((item) => item.option === '跨城演唱会、音乐节或现场演出')?.count).toBe(9)
    const q4 = summary.questions.find((question) => question.id === 'Q4')
    expect(q4?.counts.find((item) => item.option === '以上均没有')?.count).toBe(8)
    const q7 = summary.questions.find((question) => question.id === 'Q7')
    const top2 = (q7?.counts.find((item) => item.option === '一定会尝试')?.count ?? 0) + (q7?.counts.find((item) => item.option === '很可能会尝试')?.count ?? 0)
    expect(top2).toBe(21)
    const q10 = summary.questions.find((question) => question.id === 'Q10')
    expect(q10?.counts.find((item) => item.option === '只使用免费版本，不愿付费')?.count).toBe(12)
    expect(summary.sourceSha256).toBe('06d6b63398328784ee08322b254aee26a3ee448f2fd6a0a756bf05feb002670a')
  })

  test('量表题报告 n、均值与中位数，不把均值当结论', () => {
    const stats = summarizeQuestions(schema(), [
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

  test('没有分析数据时只写“未运行（缺少输入）”，不出现任何统计数字', () => {
    const text = renderNotRun(schema())
    expect(text).toContain('状态：未运行（缺少输入）')
    expect(text).toContain('不得被当作“没有需求”或“样本为 0”的证据')
    expect(text).not.toMatch(/\d+\.\d%/)
    expect(text).not.toMatch(/\| 选项 \|/)
  })

  test('报告头部写数据版本、SHA-256、采集区间与样本量不足提示', () => {
    const summary = summarize(schema(), csv(['a,2026-10-01T10:00:00+08:00,200,1 次,2000—2999 元,当月生活费,4,4,']), {
      data_version: 'TEST-v2',
      collected_from: '2026-10-01',
      collected_to: '2026-10-07',
      channel: '线上测试链接',
      sampling: '便利抽样（测试）',
    })
    const text = renderReport(summary, schema())
    expect(text).toContain('数据版本：TEST-v2')
    expect(text).toContain('采集起止：2026-10-01 — 2026-10-07')
    expect(text).toContain('有效 / 提交：1 / 1')
    expect(text).toContain('样本量不足')
    expect(text).toContain('只能写“在这批受访者中……”')
  })

  test('字段与 schema 不一致时在统计前阻断，不按缺失值算出一份“0 答卷”', () => {
    const issues = assessInput(schema(), 'a,b\n1,2')
    expect(issues.map((issue) => issue.code)).toContain('schema_mismatch')
    expect(() => summarize(schema(), 'a,b\n1,2', {})).toThrow(SurveyInputBlocked)
    const report = renderBlocked(schema(), issues)
    expect(report).toContain('状态：阻塞（原始导出不可用）')
    expect(report).not.toMatch(/\d+\.\d%/)
  })

  test('中文题干被替换成问号的导出件在统计前阻断，报告不出现回答分布', () => {
    const header = 'meta_respondent_id,meta_submitted_at,meta_duration_seconds,Q1,Q2,Q3,Q9,Q11,Q15'
    const text = [header, 'a,2026-10-01T10:00:00+08:00,200,???;????,?????,???,4,4,'].join('\n')
    const issues = assessInput(schema(), text)
    expect(issues.map((issue) => issue.code)).toContain('encoding_loss')
    expect(() => summarize(schema(), text, {})).toThrow(SurveyInputBlocked)
    const report = renderBlocked(schema(), issues)
    expect(report).toContain('编码')
    expect(report).not.toContain('| 选项 |')
  })

  test('空 CSV 在统计前阻断', () => {
    expect(assessInput(schema(), '').map((issue) => issue.code)).toContain('empty')
    expect(() => summarize(schema(), '', {})).toThrow(SurveyInputBlocked)
  })

  test('Q10 分组口径：五组之和必须等于 30，任何付费 8 = 按次 5 + 月费 2 + 一次性 1', () => {
    const deployed = parseSchema(readFileSync(`${REPO_ROOT}/docs/_work/survey/schema.json`, 'utf8'))
    const text = readFileSync(`${REPO_ROOT}/docs/_work/survey/analysis/responses.csv`, 'utf8')
    const metadata = JSON.parse(readFileSync(`${REPO_ROOT}/docs/_work/survey/analysis/metadata.json`, 'utf8')) as Record<string, string | number>
    const summary = summarize(deployed, text, metadata)
    const q10 = summary.questions.find((question) => question.id === 'Q10')
    expect(q10?.answered).toBe(30)
    const groups = new Map((q10?.groups ?? []).map((group) => [group.id, group.count]))
    expect(groups.get('any_paid')).toBe(8)
    expect(groups.get('free_only')).toBe(12)
    expect(groups.get('institution_free')).toBe(5)
    expect(groups.get('undecided')).toBe(4)
    expect(groups.get('conditional')).toBe(1)
    // 任何付费的三种方式必须能对上原始选项人数，不能只写合计
    const optionCount = (option: string): number => q10?.counts.find((item) => item.option === option)?.count ?? -1
    expect(optionCount('为一次完整的消费计划支付少量费用') + optionCount('为持续使用支付月费') + optionCount('为高级功能支付一次性费用')).toBe(8)
    expect(optionCount('只使用免费版本，不愿付费') + optionCount('由银行、学校或其他机构提供免费服务')).toBe(17)
    // 单选：全部选项与全部分组都必须等于有效回答数，出现 29/30 这类缺口即失败
    expect(q10?.counts.reduce((sum, item) => sum + item.count, 0)).toBe(30)
    expect((q10?.groups ?? []).reduce((sum, group) => sum + group.count, 0)).toBe(30)
  })

  test('报告的分组表显式写出分母与分组合计；分组不完整时必须打印口径警告', () => {
    const deployed = parseSchema(readFileSync(`${REPO_ROOT}/docs/_work/survey/schema.json`, 'utf8'))
    const text = readFileSync(`${REPO_ROOT}/docs/_work/survey/analysis/responses.csv`, 'utf8')
    const report = renderReport(summarize(deployed, text, {}), deployed)
    expect(report).toContain('**分组口径**（单选，选项互斥；分组按选项合并，分母仍为该题有效回答）')
    expect(report).toContain('| **分组合计** | 以上全部分组 | 30 | 100% |')
    expect(report).not.toContain('口径警告')

    const partial = parseSchema(
      JSON.stringify({
        version: 'test-partial',
        title: '分组不完整的测试 schema',
        rules: { min_duration_seconds: 0, attention_check: null, duplicate_key: null, duplicate_keep: 'first', required: ['Q1'], min_valid_for_conclusions: 1 },
        questions: [
          {
            id: 'Q1',
            label: 'q1',
            type: 'single',
            options: ['1 次', '2—3 次'],
            groups: [{ id: 'one', label: '只选一次', options: ['1 次'] }],
          },
        ],
      }),
    )
    const partialReport = renderReport(summarize(partial, 'meta_duration_seconds,Q1\n10,1 次\n11,2—3 次', {}), partial)
    expect(partialReport).toContain('口径警告')
    expect(partialReport).toContain('分组只覆盖 1/2')
  })

  test('分组定义不合法时直接报错：多选题不能分组、组内选项必须属于该题、同一选项不能重复计入', () => {
    const base = {
      version: 'test-bad-group',
      title: '非法分组',
      rules: { min_duration_seconds: 0, attention_check: null, duplicate_key: null, duplicate_keep: 'first', required: ['Q1'], min_valid_for_conclusions: 1 },
      questions: [{ id: 'Q1', label: 'q1', type: 'multi', options: ['甲', '乙'] }],
    }
    expect(() => parseSchema(JSON.stringify({ ...base, questions: [{ ...base.questions[0], groups: [{ id: 'g', label: 'g', options: ['甲'] }] }] }))).toThrow(/单选题/)
    expect(() =>
      parseSchema(
        JSON.stringify({
          ...base,
          questions: [{ id: 'Q1', label: 'q1', type: 'single', options: ['甲', '乙'], groups: [{ id: 'g', label: 'g', options: ['丙'] }] }],
        }),
      ),
    ).toThrow(/不在题目选项/)
    expect(() =>
      parseSchema(
        JSON.stringify({
          ...base,
          questions: [
            {
              id: 'Q1',
              label: 'q1',
              type: 'single',
              options: ['甲', '乙'],
              groups: [
                { id: 'g1', label: 'g1', options: ['甲'] },
                { id: 'g2', label: 'g2', options: ['甲'] },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/重复计入/)
  })
})
