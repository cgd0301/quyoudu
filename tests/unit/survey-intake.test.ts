import { describe, expect, test } from 'vitest'
import { inspectBytes, parseTimestamp, renderIntakeReport } from '../../scripts/survey-intake.ts'

/**
 * 本文件的 CSV 全部是**人工构造的检查用样本**，不是问卷结果，也不得被引用为客户证据。
 * 这里使用独立的测试 schema，避免测试随实际投放问卷改版而失效。
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
    { id: 'meta_respondent_id', label: 'id', type: 'meta' },
    { id: 'meta_submitted_at', label: 'time', type: 'meta' },
    { id: 'meta_duration_seconds', label: 'duration', type: 'meta' },
  ],
})
const HEADER = 'meta_respondent_id,meta_submitted_at,meta_duration_seconds,Q1,Q2,Q3,Q9'

function inspect(text: string) {
  return inspectBytes(Buffer.from(text, 'utf8'), { name: 'test.csv', schemaText: FIXTURE_SCHEMA })
}

function csv(rows: readonly string[]): string {
  return [HEADER, ...rows].join('\n')
}

describe('survey-intake 导出件接收检查', () => {
  test('可读且字段对齐的 UTF-8 CSV 判定为通过，并给出列概况与警告', () => {
    const inventory = inspect(
      csv([
        'r1,2026-10-01T10:00:00+08:00,200,1 次,2000—2999 元,当月生活费,4',
        'r2,2026-10-01T10:05:00+08:00,210,2—3 次,3000—4999 元,之前攒下的余额,4',
      ]),
    )
    expect(inventory.verdict).toBe('ok')
    expect(inventory.table.dataRows).toBe(2)
    expect(inventory.columns).toHaveLength(7)
    expect(inventory.encoding.cjkChars).toBeGreaterThan(0)
    // 只有一个时间列，无法配对算时长：只警告，不阻塞
    expect(inventory.issues.map((issue) => issue.code)).toContain('duration_unavailable')
    expect(inventory.issues.every((issue) => issue.code !== 'encoding_loss')).toBe(true)
  })

  test('全 ASCII 且中文被替换成问号的导出件判定为阻塞，报告不生成需求结论', () => {
    const inventory = inspect(
      [
        'Id,????????,?? 12 ???????????????',
        '1,10/18/2026 14:51,??;???????????????;',
        '2,10/18/2026 14:54,???;',
      ].join('\n'),
    )
    expect(inventory.verdict).toBe('blocked_unreadable')
    expect(inventory.encoding.nonAsciiBytes).toBe(0)
    expect(inventory.encoding.questionMarkRuns).toBeGreaterThanOrEqual(3)
    const report = renderIntakeReport(inventory)
    expect(report).toContain('阻塞（题干与选项不可读）')
    expect(report).toContain('不生成任何需求结论')
    expect(report).not.toContain('18-20')
  })

  test('空文件判定为阻塞（空），不抛异常、不生成统计', () => {
    const inventory = inspect('')
    expect(inventory.verdict).toBe('blocked_empty')
    expect(inventory.table.dataRows).toBe(0)
    expect(renderIntakeReport(inventory)).toContain('阻塞（空文件或没有数据行）')
  })

  test('可读但字段与受治理 schema 不一致时判定为阻塞（字段不一致）', () => {
    const inventory = inspect(['匿名编码,开始时间,选择', 'a,2026-10-01 10:00,愿意'].join('\n'))
    expect(inventory.verdict).toBe('blocked_schema')
    expect(inventory.issues.map((issue) => issue.code)).toContain('schema_mismatch')
  })

  test('检出潜在个人标识时只报告类型，不在报告中回显具体值', () => {
    const inventory = inspect(csv(['r1,2026-10-01T10:00:00+08:00,200,1 次,test@example.com,13800138000,4']))
    const report = renderIntakeReport(inventory)
    expect(inventory.issues.map((issue) => issue.code)).toContain('pii_detected')
    expect(report).toContain('个人标识')
    expect(report).not.toContain('test@example.com')
    expect(report).not.toContain('13800138000')
  })

  test('只有短、纯 ASCII 的列给出取值分布，长开放文本不给', () => {
    const inventory = inspect(
      [HEADER + ',X1,X2', 'r1,2026-10-01T10:00:00+08:00,200,1 次,2000—2999 元,当月生活费,4,18-20,这是一段比较长的开放题回答内容'].join('\n'),
    )
    const x1 = inventory.columns.find((column) => column.header === 'X1')
    const x2 = inventory.columns.find((column) => column.header === 'X2')
    expect(x1?.safeValues).toEqual([{ value: '18-20', count: 1 }])
    expect(x2?.safeValues).toBeNull()
  })

  test('连续行号被识别为导出行号，不能当作应答编号确认独立受访者数', () => {
    const twoRows = inspect(
      [
        'Id,' + HEADER,
        '1,r1,2026-10-01T10:00:00+08:00,200,1 次,2000—2999 元,当月生活费,4',
        '2,r2,2026-10-01T10:05:00+08:00,210,1 次,2000—2999 元,当月生活费,4',
      ].join('\n'),
    )
    expect(twoRows.respondents.candidateColumn).toBe(0)
    expect(twoRows.respondents.looksSequential).toBe(true)
    expect(twoRows.respondents.note).toContain('行号')
    expect(renderIntakeReport(twoRows)).toContain('不能据此确认独立受访者数')
  })

  test('结束时间早于开始时间时报告负时长，并给出可解析的时间格式', () => {
    const inventory = inspect(
      [
        'start,end,meta_respondent_id,meta_submitted_at,meta_duration_seconds,Q1,Q2,Q3,Q9',
        '10/18/2026 15:00,10/18/2026 14:00,r1,2026-10-01T10:00:00+08:00,200,1 次,2000—2999 元,当月生活费,4',
      ].join('\n'),
    )
    expect(inventory.durations?.negative).toBe(1)
    expect(inventory.issues.map((issue) => issue.code)).toContain('duration_negative')
    expect(parseTimestamp('10/18/2026 14:51')).not.toBeNull()
    expect(parseTimestamp('2026-10-01T10:00:00+08:00')).not.toBeNull()
    expect(parseTimestamp('不是时间')).toBeNull()
  })
})
