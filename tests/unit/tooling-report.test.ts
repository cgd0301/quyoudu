import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'
import { canonicalWire } from '../../scripts/lib/canonical.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'
import { buildCaseFile, buildExports, exportMeta } from '../../scripts/export-results.ts'
import { renderAppendix, type ReportInput } from '../../scripts/test-report.ts'
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
    unit: { files: 23, tests: 10, passed: 9, failed: 0, skipped: 1 },
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

  test('test-report 未执行的检查如实写“未执行”，不写成通过', () => {
    const text = renderAppendix({ ...base, docLint: { status: '未执行', exit_code: -1, detail: '本轮未执行' } })
    expect(text).toMatch(/文档检查（doc:lint） \| 未执行/)
    expect(text).toMatch(/端到端（Playwright） \| 未执行/)
    expect(text).toContain('未执行：前端未交付')
    expect(text).toContain('均已在对应文件中登记原因')
  })

  test('test-report 规则表按子行状态汇总，未全部通过时不标测试通过', () => {
    const text = renderAppendix(base)
    expect(text).toMatch(/\| R001 \| 7 \| 3 \| 2 \| 0 \| 2 \|/)
    expect(text).toMatch(/\| R001 \| 是 \| 是 \| 否 \| 未开展 \|/)
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
