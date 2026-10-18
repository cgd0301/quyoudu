import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'
import { canonicalWire } from '../../scripts/lib/canonical.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'
import { buildCaseFile, buildExports, exportMeta } from '../../scripts/export-results.ts'
import { renderAppendix, parsePrecheckReport, precheckDisplay, precheckMismatches, type ReportInput } from '../../scripts/test-report.ts'
import { runPresubmit, STEPS } from '../../scripts/presubmit.ts'

const meta = exportMeta({ hash: 'abc1234', time: '2026-10-17T10:00:00+08:00' })

function loadCase(name: string) {
  return caseFileSchema.parse(JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/cases', `${name}.json`), 'utf8')))
}

describe('export-results 结果导出', () => {
  test('export-results 导出的检查点与直接运行 evaluate 再 canonicalWire 的结果一致', () => {
    const data = loadCase('c01_base')
    const built = buildCaseFile(data, meta)
    const expected = canonicalWire({ meta: JSON.parse(built.text).meta, checkpoints: evaluate(data, [], DEMO_CFG_1).checkpoints })
    expect(built.text).toBe(`${expected}`)
  })

  test('export-results meta 含来源、配置版本、模拟数据标识与生成方式', () => {
    const built = buildCaseFile(loadCase('c01_base'), meta)
    const parsed = JSON.parse(built.text) as { meta: Record<string, unknown> }
    expect(parsed.meta).toMatchObject({
      engine: 'ts',
      commit: 'abc1234',
      commit_time: '2026-10-17T10:00:00+08:00',
      config_version: 'DEMO-CFG-1',
      simulated: true,
      notice: '模拟数据',
      generated_by: 'pnpm export:results',
      kind: 'case',
      source: 'fixtures/cases/c01_base.json',
    })
    expect(parsed.meta.done_modules).toContain('M1')
  })

  test('export-results 同一输入两次生成逐字相同，且索引不含金额', () => {
    const data = loadCase('c01_base')
    const first = buildExports({ cases: [data], flows: [], meta })
    const second = buildExports({ cases: [data], flows: [], meta })
    expect(second.indexText).toBe(first.indexText)
    expect(second.files).toEqual(first.files)
    expect(JSON.parse(first.indexText)).not.toHaveProperty('entries.0.checkpoints.0.cost')
  })

  test('export-results 脚本不读系统时钟', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'scripts/export-results.ts'), 'utf8')
    expect(source).not.toMatch(/Date\.now\(/)
    expect(source).not.toMatch(/new Date\(\s*\)/)
  })
})

describe('test-report 测试报告', () => {
  const base: ReportInput = {
    unit: { suites: 148, files: 28, tests: 10, passed: 9, failed: 0, skipped: 1 },
    vec: { vectors_passed: 152, vectors_total: 152, assertions_passed: 1004, assertions_total: 1004, assertions_skipped: 0, run_errors: 0 },
    golden: { status: '通过', exit_code: 0, detail: '' },
    cases: { status: '通过', exit_code: 0, detail: '' },
    specLint: { status: '通过', exit_code: 0, detail: '', warnings: 14 },
    rules: [{ rule: 'R001', children: 7, pass: 3, partial: 2, failed: 0, pending: 2, implemented: true, tested: false }],
    traceCounts: { pass: 84, partial: 62, failed: 0, pending: 35 },
    traceRows: 181,
    nlLayer: { covered: 6, total: 6 },
    e2e: { status: '未执行', exit_code: -1, detail: '未执行：前端未交付' },
    docLint: { status: '通过', exit_code: 0, detail: '20 项检查通过' },
    oracleDiff: { cases: 10, vectors: 152, checkpoints_ts: 180, checkpoints_oracle: 180, differences: 0, p1: 0, p2: 0, p3: 0, run_failures: 0 },
    precheck: null,
    commit: { hash: 'abc1234', time: '2026-10-17T10:00:00+08:00' },
  }

  test('test-report 分开口径列出单元测试、向量、断言与注册数，不混为一个数', () => {
    const text = renderAppendix(base)
    expect(text).toContain('单元测试用例 | 通过 9／失败 0／跳过 1／注册 10')
    expect(text).toContain('测试向量 | 通过 152／152')
    expect(text).toContain('向量断言 | 通过 1004')
    expect(text).toContain('不等于单元测试数')
    expect(text).toContain('不代表需求成立')
  })

  test('test-report 把 suite 数与测试文件数分成两行，不把 describe 分组当文件数', () => {
    const text = renderAppendix(base)
    expect(text).toContain('| 测试套件 | 148 |')
    expect(text).toContain('| 测试文件 | 28 |')
    expect(text).toContain('不是文件数')
    expect(text).toContain('与上一行的 suite 数不是同一口径')
  })

  test('test-report 未执行的检查如实写“未执行”，不写成通过', () => {
    const text = renderAppendix({ ...base, docLint: { status: '未执行', exit_code: -1, detail: '本轮未执行' } })
    expect(text).toMatch(/文档检查（doc:lint） \| 未执行/)
    expect(text).toMatch(/端到端（Playwright） \| 未执行/)
    expect(text).toContain('未执行：前端未交付')
    expect(text).toContain('均已在对应文件中登记原因')
  })

  test('端到端已通过时不列进“未完成的检查”，但仍写明 spec 数不等于 UI 子用例逐条覆盖', () => {
    const passed = { ...base, e2e: { status: '通过', exit_code: 0, detail: '通过 1／失败 0／跳过 0；按 spec 计数，不等于 UI 层子用例逐条覆盖' } }
    const text = renderAppendix(passed)
    expect(text).toMatch(/端到端（Playwright） \| 通过/)
    expect(text).toContain('端到端已运行并通过')
    expect(text).toContain('UI 层子用例仍未逐条覆盖')
    expect(text).not.toContain('未执行：前端未交付')
    // 未运行时仍按“未完成”如实列出
    expect(renderAppendix(base)).toContain('- 端到端：未执行：前端未交付')
  })

  test('test-report 规则表按子行状态汇总，未全部通过时不标测试通过', () => {
    const text = renderAppendix(base)
    expect(text).toMatch(/\| R001 \| 7 \| 3 \| 2 \| 0 \| 2 \|/)
    expect(text).toMatch(/\| R001 \| 是 \| 是 \| 否 \| 未取得可用结果 \|/)
  })

  test('A4 预检记录只取整数并重新拼出展示串，含空格的“（跳过 0）”不会被截断', () => {
    const report = [
      '# 向量预检报告',
      '',
      '- 向量通过数：152／152',
      '- 断言通过数：1004／1004（跳过 0）',
      '- 运行错误数：0',
      '',
      '## 单元核对',
      '',
      '- 退出码：0',
      '',
    ].join('\n')
    const record = parsePrecheckReport(report)
    expect(record).toEqual({
      source: 'docs/_work/precheck_report.md',
      vectors_passed: 152,
      vectors_total: 152,
      assertions_passed: 1004,
      assertions_total: 1004,
      assertions_skipped: 0,
      run_errors: 0,
      unit_exit: 0,
    })
    // 展示串由整数拼出：完整、无截断、带单位
    expect(precheckDisplay(record!).assertions).toBe('1004／1004（跳过 0 条）')
    expect(precheckDisplay(record!).assertions).not.toBe('1004／1004（跳过')
    expect(renderAppendix({ ...base, precheck: record })).toContain('断言 1004／1004（跳过 0 条）')
  })

  test('A4 预检记录格式不符或缺失时整体记为未取得，不返回半截字符串', () => {
    expect(parsePrecheckReport('')).toBeNull()
    // 截断的正文（缺少“跳过”的右括号）不再被当成可用的值
    expect(parsePrecheckReport('- 向量通过数：152／152\n- 断言通过数：1004／1004（跳过 0\n- 运行错误数：0\n')).toBeNull()
    expect(renderAppendix(base)).toContain('未取得')
  })

  test('A4 预检记录与本轮向量运行逐项比对，任何一项不符都报出来', () => {
    const record = parsePrecheckReport('- 向量通过数：152／152\n- 断言通过数：1004／1004（跳过 0）\n- 运行错误数：0\n- 退出码：0\n')
    expect(record).not.toBeNull()
    expect(precheckMismatches(record!, base.vec)).toEqual([])
    expect(precheckMismatches({ ...record!, assertions_passed: 1003 }, base.vec)).toEqual(['断言通过数：记录 1003，本轮 1004'])
    expect(precheckMismatches({ ...record!, run_errors: 1 }, base.vec)).toEqual(['运行错误数：记录 1，本轮 0'])
  })
})

describe('presubmit 提交前门禁', () => {
  test('presubmit 上游失败时下游步骤标为跳过，且不计入通过', () => {
    const steps = [
      { id: 'a', title: 'A', run: () => ({ status: 1, summary: '失败' }) },
      { id: 'b', title: 'B', needs: ['a'], run: () => ({ status: 0, summary: '不该运行' }) },
      { id: 'c', title: 'C', run: () => ({ status: 0, summary: 'ok' }) },
    ]
    const { results, failed } = runPresubmit(steps)
    expect(results.map((item) => item.status)).toEqual(['未通过', '跳过', '通过'])
    expect(failed).toBe(2)
  })

  test('presubmit 门禁清单包含本轮必须的检查，且不含仅限人工运行的脚本', () => {
    const ids = STEPS.map((step) => step.id)
    for (const id of ['typecheck', 'lint', 'unit', 'vectors', 'cases', 'spec', 'golden', 'export', 'doclint', 'report', 'trace', 'figures', 'book', 'chars']) {
      expect(ids, `缺少 ${id}`).toContain(id)
    }
    expect(JSON.stringify(STEPS)).not.toContain('golden:write')
    expect(JSON.stringify(STEPS)).not.toContain('oracle:export')
  })
})
