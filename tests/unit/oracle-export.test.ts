import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { parseCsv, stringifyCsv } from '../../scripts/lib/csv.ts'
import { exportOracle, stripExpectedColumn, stripVector } from '../../scripts/oracle-export.ts'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const CSV = [
  '规则编号,规则描述,最小数据字段,拟建测试,预期结果,项目书章节,状态',
  'R001,统一计算时点,"as_of、cash_as_of",T001,"重算结果一致，“今天”不变","P2、P3；附录A",待执行',
  'R001,统一计算时点｜设备日期无关,"as_of, C0",T001-01,"初始：c01；预期：G0=700，""引号""保留","开发期忽略，定稿后回填（D33）",待执行',
].join('\n')

const vector = {
  test_id: 'T001-07#1',
  rule: 'R001',
  layer: 'ENGINE',
  needs_review: false,
  source_text: '初始：c01……',
  base: 'c01',
  input: { meta: { case_id: 'T001-07#1' } },
  ops: [{ type: 'EVALUATE', label: 'final' }],
  expect: [{ checkpoint: 'final', path: 'states.plan_state', op: 'eq', value: 'INCOMPLETE' }],
}

describe('CSV', () => {
  test('解析与输出往返：含逗号、引号的字段加引号，其余不加', () => {
    const rows = parseCsv(CSV)
    expect(rows[2][2]).toBe('as_of, C0')
    expect(rows[2][4]).toBe('初始：c01；预期：G0=700，"引号"保留')
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows)
    expect(stringifyCsv([['a,b', 'c"d', '中文']])).toBe('"a,b","c""d",中文')
  })

  test('去掉“预期结果”列，其余列和行不变', () => {
    const rows = parseCsv(stripExpectedColumn(CSV))
    expect(rows[0]).toEqual(['规则编号', '规则描述', '最小数据字段', '拟建测试', '项目书章节', '状态'])
    expect(rows[2]).toEqual(['R001', '统一计算时点｜设备日期无关', 'as_of, C0', 'T001-01', '开发期忽略，定稿后回填（D33）', '待执行'])
  })

  test('仓库中的 traceability.csv 去列后行数不变，且不再出现预期结果的文字', () => {
    const text = readFileSync(path.join(REPO_ROOT, 'docs/traceability.csv'), 'utf8')
    const original = parseCsv(text)
    const stripped = parseCsv(stripExpectedColumn(text))
    const expectedColumn = original[0].indexOf('预期结果')
    expect(stripped).toHaveLength(original.length)
    expect(stripped[0]).not.toContain('预期结果')
    expect(stripped.every((row) => row.length === original[0].length - 1)).toBe(true)
    expect(stripExpectedColumn(text)).not.toContain(original[2][expectedColumn])
  })

  test('没有“预期结果”列时报错', () => {
    expect(() => stripExpectedColumn('a,b\n1,2')).toThrow('预期结果')
  })
})

describe('stripVector', () => {
  test('删去 expect 与 source_text，其余字段和顺序不变', () => {
    const stripped = JSON.parse(stripVector(JSON.stringify(vector)))
    expect(Object.keys(stripped)).toEqual(['test_id', 'rule', 'layer', 'needs_review', 'base', 'input', 'ops'])
    expect(stripped.ops).toEqual(vector.ops)
  })
})

describe('exportOracle', () => {
  let source = ''
  let target = ''
  let written: string[] = []

  const write = (root: string, relativePath: string, text: string) => {
    const file = path.join(root, relativePath)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  }
  const read = (relativePath: string) => readFileSync(path.join(target, relativePath), 'utf8')
  const exists = (relativePath: string) => existsSync(path.join(target, relativePath))

  beforeAll(async () => {
    source = mkdtempSync(path.join(tmpdir(), 'oracle-src-'))
    target = mkdtempSync(path.join(tmpdir(), 'oracle-dst-'))
    for (const name of ['rules.md', 'policy_card.md', 'scope.md', 'sources.md']) write(source, `docs/${name}`, `# ${name}\n`)
    write(source, 'docs/traceability.csv', CSV)
    for (const name of ['schema.json', 'result.schema.json', 'ops.schema.json']) write(source, `docs/_work/${name}`, '{}\n')
    write(source, 'docs/_work/spec_gaps.md', '# 规格缺口\n')
    write(source, 'docs/_work/vector_gaps.md', '# 向量缺口\n')
    write(source, 'fixtures/cases/c01_base.json', '{"meta":{}}\n')
    write(source, 'fixtures/cases/.gitkeep', '')
    write(source, 'fixtures/vectors/T001-07#1.json', `${JSON.stringify(vector, null, 2)}\n`)
    write(source, 'src/engine/evaluate.ts', 'export {}\n')
    write(source, 'tests/unit/vectors.test.ts', 'export {}\n')
    write(source, 'tests/golden/vectors/T001-07#1.json', '{}\n')
    write(source, 'scripts/oracle-template/AGENTS.md', '')
    write(target, 'fixtures/vectors/T999-01.json', '{}\n')
    write(target, 'fixtures/cases/old.json', '{}\n')
    write(target, 'oracle/engine.py', 'print(1)\n')
    written = await exportOracle(source, target)
  })

  afterAll(() => {
    rmSync(source, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  })

  test('返回写入的文件清单', () => {
    expect(written).toEqual([
      'AGENTS.md',
      'docs/_work/ops.schema.json',
      'docs/_work/result.schema.json',
      'docs/_work/schema.json',
      'docs/policy_card.md',
      'docs/rules.md',
      'docs/scope.md',
      'docs/traceability_noexpect.csv',
      'fixtures/cases/c01_base.json',
      'fixtures/vectors/T001-07#1.json',
    ])
  })

  test('规格、schema 与案例原样复制，模板复制到根目录', () => {
    expect(read('docs/rules.md')).toBe('# rules.md\n')
    expect(read('docs/_work/schema.json')).toBe('{}\n')
    expect(read('fixtures/cases/c01_base.json')).toBe('{"meta":{}}\n')
    expect(exists('AGENTS.md')).toBe(true)
    expect(read('AGENTS.md')).toBe('')
  })

  test('追溯表去掉“预期结果”列，另存为 traceability_noexpect.csv', () => {
    expect(exists('docs/traceability.csv')).toBe(false)
    expect(parseCsv(read('docs/traceability_noexpect.csv'))[0]).not.toContain('预期结果')
    expect(read('docs/traceability_noexpect.csv')).not.toContain('G0=700')
  })

  test('向量去掉 expect 与 source_text', () => {
    const stripped = JSON.parse(read('fixtures/vectors/T001-07#1.json'))
    expect(stripped).not.toHaveProperty('expect')
    expect(stripped).not.toHaveProperty('source_text')
    expect(stripped.test_id).toBe('T001-07#1')
  })

  test('不复制 src、tests、其他文档和非 JSON 文件', () => {
    for (const relativePath of [
      'src',
      'tests',
      'docs/sources.md',
      'docs/_work/spec_gaps.md',
      'docs/_work/vector_gaps.md',
      'fixtures/cases/.gitkeep',
      'scripts',
    ]) {
      expect(exists(relativePath), relativePath).toBe(false)
    }
  })

  test('目标中 fixtures 两个目录的旧文件被清掉，其他目录不动', () => {
    expect(exists('fixtures/vectors/T999-01.json')).toBe(false)
    expect(exists('fixtures/cases/old.json')).toBe(false)
    expect(read('oracle/engine.py')).toBe('print(1)\n')
  })
})
