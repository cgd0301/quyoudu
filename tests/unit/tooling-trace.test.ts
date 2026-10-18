import { describe, expect, test } from 'vitest'
import {
  judgeParentRow,
  judgeSubRow,
  parseTestLayers,
  parseVecGaps,
  parseVitestJson,
  subIdOf,
  type EvidenceIndex,
} from '../../scripts/lib/results.ts'
import { computeVerdicts, parseTraceability, rewriteStatuses, statusText } from '../../scripts/lib/trace.ts'

function indexOf(overrides: Partial<EvidenceIndex> = {}): EvidenceIndex {
  return {
    ids: new Map(),
    unitTitles: new Set(),
    vitestTotals: null,
    vec: null,
    playwright: null,
    doc: null,
    gaps: [],
    layers: new Map(),
    ...overrides,
  }
}

describe('results 证据解析', () => {
  test('results 从测试名开头取子用例编号，父行编号不算子行', () => {
    expect(subIdOf('T001-01 gap 改设备系统日期后同一输入结果不变')).toBe('T001-01')
    expect(subIdOf('T015-05#1 gap 确认免费为 0')).toBe('T015-05')
    expect(subIdOf('flows 每个流程只使用界面白名单操作')).toBeNull()
  })

  test('results 解析 test_layers.md 的分层，同一编号可有多层', () => {
    const layers = parseTestLayers('| T001-03 | ENGINE | A4 |\n| T001-03 | UI | A7 |\n| T009-04 | UI | A7 |')
    expect([...(layers.get('T001-03') ?? [])].sort()).toEqual(['ENGINE', 'UI'])
    expect([...(layers.get('T009-04') ?? [])]).toEqual(['UI'])
  })

  test('results 解析 vector_gaps 的三种处置：已裁决、已覆盖、未解决', () => {
    const rows = parseVecGaps(
      [
        '| T003-03 | 该80计入F | 已裁决（§3）。向量已断言 |',
        '| T003-04 | 不执行核销 | 已覆盖：tests/unit/cost-states.test.ts「T003-04 gap x」 |',
        '| T002-04 | 日均参考 | ResultCore 没有日均参考字段 |',
      ].join('\n'),
    )
    expect(rows.map((row) => row.disposition)).toEqual(['resolved', 'covered', 'open'])
    expect(rows[1]?.coveredBy).toBe('T003-04 gap x')
  })

  test('results 从 vitest 的 JSON 统计通过与跳过，跳过的用例不计入通过', () => {
    const parsed = parseVitestJson(
      JSON.stringify({
        numTotalTests: 3,
        numPassedTests: 2,
        numFailedTests: 0,
        numPendingTests: 1,
        testResults: [
          {
            assertionResults: [
              { fullName: 'T001-01 gap 甲', status: 'passed' },
              { fullName: 'T001-02 gap 乙', status: 'passed' },
              { fullName: 'T013-06 gap 丙', status: 'skipped' },
            ],
          },
        ],
      }),
    )
    expect(parsed.totals).toEqual({ passed: 2, failed: 0, skipped: 1, total: 3 })
    expect(parsed.named.map((item) => item.status)).toEqual(['pass', 'pass', 'skipped'])
  })
})

describe('results 单行判定', () => {
  test('results 向量全部通过且层已执行、缺口已覆盖才算通过', () => {
    const ids = new Map([
      ['T001-01', { vector: 'pass' as const, unit: 'none' as const, e2e: 'none' as const, doc: 'none' as const, unitNames: [], vectorSkipped: 0, vectorFailed: 0, vectorPassed: 3 }],
    ])
    const index = indexOf({ ids, layers: new Map([['T001-01', new Set(['ENGINE'])]]) })
    expect(judgeSubRow('T001-01', index).status).toBe('pass')
  })

  test('results 有登记跳过的断言时不能算通过', () => {
    const ids = new Map([
      ['T001-01', { vector: 'skipped' as const, unit: 'none' as const, e2e: 'none' as const, doc: 'none' as const, unitNames: [], vectorSkipped: 1, vectorFailed: 0, vectorPassed: 2 }],
    ])
    const index = indexOf({ ids, layers: new Map([['T001-01', new Set(['ENGINE'])]]) })
    const verdict = judgeSubRow('T001-01', index)
    expect(verdict.status).toBe('partial')
    expect(verdict.detail).toContain('跳过')
  })

  test('results UI 层未执行时只算部分覆盖，不算通过', () => {
    const ids = new Map([
      ['T001-03', { vector: 'pass' as const, unit: 'none' as const, e2e: 'none' as const, doc: 'none' as const, unitNames: [], vectorSkipped: 0, vectorFailed: 0, vectorPassed: 2 }],
    ])
    const index = indexOf({ ids, layers: new Map([['T001-03', new Set(['ENGINE', 'UI'])]]) })
    expect(judgeSubRow('T001-03', index).detail).toContain('端到端未执行')
  })

  test('results 缺口未处置时不能算通过，且没有任何执行记录时为待执行', () => {
    const gaps = [{ id: 'T002-04', text: '', reason: '', disposition: 'open' as const, coveredBy: null }]
    const index = indexOf({ gaps })
    expect(judgeSubRow('T002-04', index).status).toBe('pending')
    expect(judgeSubRow('T002-04', index).detail).toContain('vector_gaps')
  })

  test('results 标为已覆盖但覆盖它的单元测试没跑时仍不算通过', () => {
    const gaps = [{ id: 'T003-04', text: '', reason: '', disposition: 'covered' as const, coveredBy: 'T003-04 gap x' }]
    const ids = new Map([
      ['T003-04', { vector: 'pass' as const, unit: 'none' as const, e2e: 'none' as const, doc: 'none' as const, unitNames: [], vectorSkipped: 0, vectorFailed: 0, vectorPassed: 2 }],
    ])
    const index = indexOf({ gaps, ids, layers: new Map([['T003-04', new Set(['ENGINE'])]]) })
    expect(judgeSubRow('T003-04', index).status).toBe('partial')
  })
})

describe('results 父行规则', () => {
  test('results 父行：子行全部通过才通过；有失败即失败；其余部分覆盖', () => {
    expect(judgeParentRow([{ status: 'pass', detail: '' }]).status).toBe('pass')
    expect(judgeParentRow([{ status: 'pass', detail: '' }, { status: 'failed', detail: '' }]).status).toBe('failed')
    expect(judgeParentRow([{ status: 'pass', detail: '' }, { status: 'partial', detail: '' }]).status).toBe('partial')
    expect(judgeParentRow([{ status: 'pending', detail: '' }]).status).toBe('pending')
  })
})

describe('trace 追溯表改写', () => {
  const csv = '规则编号,规则描述,最小数据字段,拟建测试,预期结果,项目书章节,状态\nR001,甲,"含,逗号",T001-01,"预期,含引号""与逗号""",章节,待执行\nR001,乙,f,T001,"多行",章节,待执行'

  test('trace 解析出子行与父行，并保留原字段', () => {
    const table = parseTraceability(csv)
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]?.cells[2]).toBe('含,逗号')
    expect(table.rows[0]?.cells[4]).toBe('预期,含引号"与逗号"')
    expect(table.rows[0]?.testId).toBe('T001-01')
  })

  test('trace 改写状态只动最后一列，其余字符逐字保留', () => {
    const table = parseTraceability(csv)
    const statuses = new Map([
      [2, '通过（abc1234，2026-10-17）'],
      [3, '部分覆盖（abc1234，2026-10-17；端到端未执行）'],
    ])
    const next = rewriteStatuses(table, statuses)
    expect(next.split('\n')[0]).toBe(csv.split('\n')[0])
    expect(next.split('\n')[1]).toBe(
      'R001,甲,"含,逗号",T001-01,"预期,含引号""与逗号""",章节,通过（abc1234，2026-10-17）',
    )
    expect(next.split('\n')[2]).toBe('R001,乙,f,T001,"多行",章节,部分覆盖（abc1234，2026-10-17；端到端未执行）')
  })

describe('results 编号映射的健壮性', () => {
  test('results 编号必须写在用例名开头，describe 前缀不影响识别', () => {
    expect(subIdOf('T015-01 gap 固定话术提取')).toBe('T015-01')
    const parsed = parseVitestJson(
      JSON.stringify({
        numTotalTests: 1,
        testResults: [
          { assertionResults: [{ title: 'T015-01 gap 固定话术提取', fullName: '自然语言层：提取与追问 T015-01 gap 固定话术提取', status: 'passed' }] },
        ],
      }),
    )
    expect(parsed.named[0]?.name).toBe('T015-01 gap 固定话术提取')
    expect(parsed.named[0]?.fullName).toContain('自然语言层')
    expect(subIdOf(parsed.named[0]?.name ?? '')).toBe('T015-01')
  })

  test('results 不做“包含即命中”：编号不在开头或只是子串时不算', () => {
    expect(subIdOf('补充 T015-01 的用例')).toBeNull()
    expect(subIdOf('用例 T015-01')).toBeNull()
    expect(subIdOf('flows 每个流程只使用界面白名单操作')).toBeNull()
  })

  test('results 相似编号不会被截断匹配（T015-010 不等于 T015-01）', () => {
    expect(subIdOf('T015-010 gap 相似编号')).toBeNull()
    expect(subIdOf('T015-01 gap 正常编号')).toBe('T015-01')
    expect(subIdOf('T015-011 gap 相似编号')).toBeNull()
  })

  test('results 编号后接 ASCII 字母的非法写法不命中，非 ASCII 的子情形后缀仍归同一编号', () => {
    // 规范写法是“编号 + 空格 + 说明”，或“编号 + #n／①②③”；接字母属非法写法，宁可记为未执行
    expect(subIdOf('T015-01a gap 非法后缀')).toBeNull()
    expect(subIdOf('T015-01gap 缺少分隔')).toBeNull()
    // 子情形后缀不是 ASCII 数字或字母，照旧归到同一子用例编号
    expect(subIdOf('T015-05#1 gap 确认免费为 0')).toBe('T015-05')
    expect(subIdOf('T020-07③ 预测未引用配置版本')).toBe('T020-07')
    expect(subIdOf('T020-07② 预测值为负')).toBe('T020-07')
  })

  test('results 名称为空或缺失时不产生编号', () => {
    expect(subIdOf('')).toBeNull()
    const parsed = parseVitestJson(JSON.stringify({ numTotalTests: 1, testResults: [{ assertionResults: [{ status: 'passed' }] }] }))
    expect(parsed.named[0]?.name).toBe('')
    expect(subIdOf(parsed.named[0]?.name ?? '')).toBeNull()
  })

  test('results 同一编号多条测试时任一失败即失败，跳过不记通过', () => {
    const parsed = parseVitestJson(
      JSON.stringify({
        numTotalTests: 3,
        testResults: [
          {
            assertionResults: [
              { title: 'T020-01 gap 甲', status: 'passed' },
              { title: 'T020-01 gap 乙', status: 'failed' },
              { title: 'T013-06 gap 丙', status: 'skipped' },
            ],
          },
        ],
      }),
    )
    expect(parsed.named.find((item) => item.name === 'T020-01 gap 甲')?.status).toBe('pass')
    expect(parsed.named.find((item) => item.name === 'T020-01 gap 乙')?.status).toBe('fail')
    expect(parsed.named.find((item) => item.name === 'T013-06 gap 丙')?.status).toBe('skipped')
  })
})

describe('trace 状态文本与汇总', () => {
  test('trace 状态文本按四种判定生成，且不写入 SG/D/V 编号', () => {
    const stamp = 'abc1234，2026-10-17'
    const texts = [
      statusText({ status: 'pass', detail: '' }, stamp),
      statusText({ status: 'partial', detail: '端到端未执行' }, stamp),
      statusText({ status: 'failed', detail: '向量未通过' }, stamp),
      statusText({ status: 'pending', detail: '未执行' }, stamp),
    ]
    expect(texts[0]).toBe('通过（abc1234，2026-10-17）')
    expect(texts[3]).toBe('待执行')
    for (const text of texts) expect(text).not.toMatch(/SG-|D\d|V-\d/)
  })

  test('trace 汇总子行与父行计数', () => {
    const table = parseTraceability(csv)
    const ids = new Map([
      ['T001-01', { vector: 'pass' as const, unit: 'none' as const, e2e: 'none' as const, doc: 'none' as const, unitNames: [], vectorSkipped: 0, vectorFailed: 0, vectorPassed: 2 }],
    ])
    const index = indexOf({ ids, layers: new Map([['T001-01', new Set(['ENGINE'])]]) })
    const verdicts = computeVerdicts(table, index)
    expect(verdicts.sub.get('T001-01')?.status).toBe('pass')
    expect(verdicts.parent.get('T001')?.status).toBe('pass')
    expect(verdicts.counts).toEqual({ pass: 2, partial: 0, failed: 0, pending: 0 })
  })
})
})
