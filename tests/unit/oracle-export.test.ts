import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { parseCsv, stringifyCsv } from '../../scripts/lib/csv.ts'
import { contentFingerprint, exportOracle, stripExpectedColumn, stripVector } from '../../scripts/oracle-export.ts'

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

  test('子用例保留“预期：”之前的部分，父行置空，列名改为“初始与操作”', () => {
    const rows = parseCsv(stripExpectedColumn(CSV))
    expect(rows[0]).toEqual(['规则编号', '规则描述', '最小数据字段', '拟建测试', '初始与操作', '项目书章节', '状态'])
    expect(rows[1][4]).toBe('')
    expect(rows[2]).toEqual(['R001', '统一计算时点｜设备日期无关', 'as_of, C0', 'T001-01', '初始：c01', '开发期忽略，定稿后回填（D33）', '待执行'])
    expect(stripExpectedColumn(CSV)).not.toContain('G0=700')
  })

  test('去掉“预期：”前末尾的分号，操作说明保留', () => {
    const csv = '拟建测试,预期结果\nT001-01,初始：c01；操作：重算；预期：G0=700\nT001,父行整段\n'
    const rows = parseCsv(stripExpectedColumn(csv))
    expect(rows[1]).toEqual(['T001-01', '初始：c01；操作：重算'])
    expect(rows[2]).toEqual(['T001', ''])
  })

  test('仓库追溯表列数不变，子用例不含“预期：”，父行该列为空', () => {
    const text = readFileSync(path.join(REPO_ROOT, 'docs/traceability.csv'), 'utf8')
    const original = parseCsv(text)
    const stripped = parseCsv(stripExpectedColumn(text))
    const expectedColumn = original[0].indexOf('预期结果')
    const testColumn = original[0].indexOf('拟建测试')
    expect(stripped).toHaveLength(original.length)
    expect(stripped[0][expectedColumn]).toBe('初始与操作')
    expect(stripped.every((row) => row.length === original[0].length)).toBe(true)
    const problems: string[] = []
    for (let index = 1; index < original.length; index += 1) {
      const testId = original[index]?.[testColumn] ?? ''
      const cell = stripped[index]?.[expectedColumn] ?? ''
      if (!testId.includes('-')) {
        if (cell !== '') problems.push(`${testId || `第${index}行`} 父行未置空`)
      } else if (cell.includes('预期：')) {
        problems.push(`${testId} 仍含预期`)
      }
    }
    expect(problems).toEqual([])
  })

  test('没有“预期结果”列时报错', () => {
    expect(() => stripExpectedColumn('a,b\n1,2')).toThrow('预期结果')
  })

  test('子用例缺少“预期：”时报错', () => {
    expect(() => stripExpectedColumn('拟建测试,预期结果\nT001-01,初始：c01\n')).toThrow('预期：')
  })
})

describe('指纹', () => {
  test('把 \\r\\n 换成 \\n 后取 SHA-256 前 12 位', () => {
    const digest = createHash('sha256').update('a\nb', 'utf8').digest('hex').slice(0, 12)
    expect(contentFingerprint('a\r\nb')).toBe(digest)
    expect(contentFingerprint('a\nb')).toBe(digest)
    expect(digest).toHaveLength(12)
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
    write(source, 'docs/_work/oracle_fixes/h3-r1.md', '# 修正\n')
    write(source, 'docs/_work/oracle_fixes/notes.txt', '不复制\n')
    write(target, 'fixtures/vectors/T999-01.json', '{}\n')
    write(target, 'fixtures/cases/old.json', '{}\n')
    write(target, 'fixes/old.md', '旧修正\n')
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
      'fixes/h3-r1.md',
      'fixtures/cases/c01_base.json',
      'fixtures/vectors/T001-07#1.json',
      'oracle_inputs.json',
    ])
  })

  test('规格、schema 与案例原样复制，模板复制到根目录', () => {
    expect(read('docs/rules.md')).toBe('# rules.md\n')
    expect(read('docs/_work/schema.json')).toBe('{}\n')
    expect(read('fixtures/cases/c01_base.json')).toBe('{"meta":{}}\n')
    expect(exists('AGENTS.md')).toBe(true)
    expect(read('AGENTS.md')).toBe('')
  })

  test('追溯表改为“初始与操作”，另存为 traceability_noexpect.csv', () => {
    expect(exists('docs/traceability.csv')).toBe(false)
    const rows = parseCsv(read('docs/traceability_noexpect.csv'))
    expect(rows[0]).toContain('初始与操作')
    expect(rows[0]).not.toContain('预期结果')
    expect(rows[1][4]).toBe('')
    expect(rows[2][4]).toBe('初始：c01')
    expect(read('docs/traceability_noexpect.csv')).not.toContain('G0=700')
  })

  test('oracle_inputs.json 记录每个导出文件的指纹，不含清单自身', () => {
    const manifest = JSON.parse(read('oracle_inputs.json')) as Record<string, string>
    expect(Object.keys(manifest)).toEqual(written.filter((file) => file !== 'oracle_inputs.json'))
    for (const file of Object.keys(manifest)) expect(manifest[file]).toBe(contentFingerprint(read(file)))
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

  test('目标中 fixtures 两个目录和 fixes 的旧文件被清掉，其他目录不动', () => {
    expect(exists('fixtures/vectors/T999-01.json')).toBe(false)
    expect(exists('fixtures/cases/old.json')).toBe(false)
    expect(exists('fixes/old.md')).toBe(false)
    expect(exists('fixes/notes.txt')).toBe(false)
    expect(read('fixes/h3-r1.md')).toBe('# 修正\n')
    expect(read('oracle/engine.py')).toBe('print(1)\n')
  })
})

describe('没有修正单时仍清空目标 fixes', () => {
  test('源目录不存在时，目标 fixes 被清空且清单不含 fixes', async () => {
    const source = mkdtempSync(path.join(tmpdir(), 'oracle-src-empty-'))
    const target = mkdtempSync(path.join(tmpdir(), 'oracle-dst-empty-'))
    const write = (relativePath: string, text: string) => {
      const file = path.join(source, relativePath)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, text, 'utf8')
    }
    try {
      for (const name of ['rules.md', 'policy_card.md', 'scope.md']) write(`docs/${name}`, `# ${name}\n`)
      write('docs/traceability.csv', CSV)
      write('docs/_work/schema.json', '{}\n')
      write('fixtures/cases/c01_base.json', '{}\n')
      write('fixtures/vectors/T001-07#1.json', `${JSON.stringify(vector, null, 2)}\n`)
      write('scripts/oracle-template/AGENTS.md', '')
      mkdirSync(path.join(target, 'fixes'), { recursive: true })
      writeFileSync(path.join(target, 'fixes', 'old.md'), '旧\n', 'utf8')
      const written = await exportOracle(source, target)
      expect(written).not.toContain('fixes/old.md')
      expect(written.some((file) => file.startsWith('fixes/'))).toBe(false)
      expect(existsSync(path.join(target, 'fixes', 'old.md'))).toBe(false)
    } finally {
      rmSync(source, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
    }
  })
})
