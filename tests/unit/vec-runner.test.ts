import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  formatVecOutput,
  judgeVector,
  loadVectorModules,
  needsVectorModules,
  parseVecArgs,
  selectVectors,
  type AssertionRow,
  type VecEntry,
} from '../../scripts/vec.ts'
import type { Dispute, Expectation } from '../lib/vector.ts'

const vectors = [
  { test_id: 'T003-01' },
  { test_id: 'T003-08#1' },
  { test_id: 'T017-01' },
  { test_id: 'T017-10' },
  { test_id: 'T004-01' },
  { test_id: 'T009-01' },
]

const modules = new Map([
  ['T003-01', 'M1'],
  ['T003-08#1', 'M1'],
  ['T017-01', 'M2'],
  ['T017-10', 'M3'],
  ['T004-01', 'M2'],
])

function ids(selected: readonly { test_id: string }[]): string[] {
  return selected.map((vector) => vector.test_id)
}

describe('参数与选择', () => {
  test('忽略单独的 --，默认 impl 为 ts', () => {
    expect(parseVecArgs(['--', '--all', '--', 'T003', '--module', 'M1', '--impl', 'oracle', '--md', 'a.md', '--json', 'a.json'])).toEqual({
      prefixes: ['T003'],
      module: 'M1',
      all: true,
      impl: 'oracle',
      md: 'a.md',
      json: 'a.json',
    })
  })

  test('未知参数、缺模块和非法 impl 报错', () => {
    expect(() => parseVecArgs(['--nope'])).toThrow('未知参数')
    expect(() => parseVecArgs(['--module'])).toThrow('--module')
    expect(() => parseVecArgs(['--impl', 'py'])).toThrow('--impl')
  })

  test('编号前缀：T003 命中分情形，T017-1 不命中 T017-01', () => {
    expect(ids(selectVectors(vectors, { prefixes: ['T003', 'T017-1'], module: null, all: false }, null, []))).toEqual([
      'T003-01',
      'T003-08#1',
      'T017-10',
    ])
  })

  test('模块不晚于 Mx，未登记的向量不入选', () => {
    expect(ids(selectVectors(vectors, { prefixes: [], module: 'M2', all: false }, modules, []))).toEqual([
      'T003-01',
      'T003-08#1',
      'T017-01',
      'T004-01',
    ])
  })

  test('前缀与模块同时给出时取交集', () => {
    expect(ids(selectVectors(vectors, { prefixes: ['T017'], module: 'M2', all: false }, modules, []))).toEqual(['T017-01'])
  })

  test('都没给时只选 doneModules；--all 选全部', () => {
    expect(ids(selectVectors(vectors, { prefixes: [], module: null, all: false }, modules, ['M1']))).toEqual(['T003-01', 'T003-08#1'])
    expect(selectVectors(vectors, { prefixes: [], module: null, all: false }, null, [])).toEqual([])
    expect(selectVectors(vectors, { prefixes: [], module: null, all: true }, modules, ['M1'])).toHaveLength(vectors.length)
  })

  test('只有 --module 或非空默认名单才需要模块文件', () => {
    expect(needsVectorModules({ prefixes: [], module: 'M2', all: false }, [])).toBe(true)
    expect(needsVectorModules({ prefixes: [], module: null, all: false }, ['M1'])).toBe(true)
    expect(needsVectorModules({ prefixes: [], module: null, all: false }, [])).toBe(false)
    expect(needsVectorModules({ prefixes: ['T003'], module: null, all: false }, ['M1'])).toBe(false)
    expect(needsVectorModules({ prefixes: [], module: null, all: true }, ['M1'])).toBe(false)
  })

  test('模块文件不存在、不是对象或模块值非法时提示先运行 pnpm vector:modules', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vec-modules-'))
    try {
      expect(() => loadVectorModules(root)).toThrow('tests/vector-modules.json 不存在，请先运行 pnpm vector:modules')
      const file = path.join(root, 'tests/vector-modules.json')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, '[]\n', 'utf8')
      expect(() => loadVectorModules(root)).toThrow('tests/vector-modules.json 不是对象，请先运行 pnpm vector:modules')
      writeFileSync(file, '{"T003-01":"later"}\n', 'utf8')
      expect(() => loadVectorModules(root)).toThrow('tests/vector-modules.json 的模块值不是 M 加数字，请先运行 pnpm vector:modules')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('断言', () => {
  const checkpoints = new Map<string, unknown>([
    ['final', { states: { plan_state: 'INCOMPLETE' }, nodes: [{ at: 'a' }, { at: 'a' }] }],
  ])
  const expectations: Expectation[] = [
    { checkpoint: 'final', path: 'states.plan_state', op: 'eq', value: 'INCOMPLETE' },
    { checkpoint: 'final', path: 'states.plan_state', op: 'eq', value: 'FEASIBLE' },
    { checkpoint: 'final', path: 'states.other', op: 'eq', value: 1 },
    { checkpoint: 'final', path: 'missing.key', op: 'eq', value: 1 },
    { checkpoint: 'later', path: 'states.plan_state', op: 'eq', value: 'INCOMPLETE' },
    { checkpoint: 'final', path: 'nodes[at=a]', op: 'absent' },
  ]
  const disputes: Dispute[] = [{ test_id: 'T003-01', checkpoint: 'final', path: 'states.other', op: 'eq', value: 1 }]

  test('通过、失败、登记跳过、路径不存在、缺少检查点、选择器多命中', () => {
    const rows = judgeVector('T003-01', expectations, checkpoints, disputes)
    expect(rows.map((row) => row.status)).toEqual(['pass', 'fail', 'skipped', 'fail', 'fail', 'fail'])
    expect(rows[3]?.actual).toBe('不存在')
    expect(rows[4]?.actual).toBe('缺少检查点')
    expect(rows[5]?.actual).toBe('选择器多命中')
    const output = formatVecOutput({ entries: [{ testId: 'T003-01', rows, runError: null }] })
    expect(output.exitCode).toBe(1)
    expect(output.stdout).toBe(
      [
        '向量 0/1；断言 1/5/1；运行错误数 0',
        'T003-01｜final｜states.plan_state｜eq｜"FEASIBLE"｜"INCOMPLETE"',
        'T003-01｜final｜missing.key｜eq｜1｜不存在',
        'T003-01｜later｜states.plan_state｜eq｜"INCOMPLETE"｜缺少检查点',
        'T003-01｜final｜nodes[at=a]｜absent｜｜选择器多命中',
        '',
      ].join('\n'),
    )
    const json = JSON.parse(output.jsonText) as { assertions: AssertionRow[] }
    expect(json.assertions.map((row) => row.status)).toEqual(['pass', 'fail', 'skipped', 'fail', 'fail', 'fail'])
    expect(output.stdout).not.toContain('states.other')
  })
})

describe('输出', () => {
  test('运行错误不计入断言，全部通过时退出码为 0，json 含通过项', () => {
    const pass: AssertionRow = {
      testId: 'T003-01',
      checkpoint: 'final',
      path: 'states.plan_state',
      op: 'eq',
      expected: '"INCOMPLETE"',
      actual: '"INCOMPLETE"',
      status: 'pass',
    }
    const output = formatVecOutput({
      entries: [
        { testId: 'T003-01', rows: [pass], runError: null },
        {
          testId: 'T003-02',
          rows: [{ ...pass, testId: 'T003-02', path: 'ignored', status: 'fail', actual: '9' }],
          runError: '运行错误：未实现',
        },
      ],
    })
    expect(output.exitCode).toBe(1)
    expect(output.stdout).toBe('向量 1/2；断言 1/1/0；运行错误数 1\nT003-02｜｜｜｜｜运行错误：未实现\n')
    expect(JSON.parse(output.jsonText)).toMatchObject({
      summary: { vectorsPassed: 1, vectorsTotal: 2, assertionsPassed: 1, assertionsTotal: 1, assertionsSkipped: 0, runErrors: 1 },
      assertions: [pass],
      runErrors: [{ testId: 'T003-02', message: '运行错误：未实现' }],
    })
  })

  test('失败单元格按码点截到 100，json 保留全文', () => {
    const actual = '字'.repeat(120)
    const output = formatVecOutput({
      entries: [
        {
          testId: 'T003-01',
          rows: [{ testId: 'T003-01', checkpoint: 'c', path: 'p', op: 'eq', expected: '1', actual, status: 'fail' }],
          runError: null,
        },
      ],
    })
    const cells = output.stdout.trim().split('\n')[1]?.split('｜')
    expect(cells?.[5]).toBe('字'.repeat(100))
    const json = JSON.parse(output.jsonText) as { assertions: AssertionRow[] }
    expect(json.assertions[0]?.actual).toBe(actual)
  })

  test('终端最多 80 行失败，其余写入 overflow', () => {
    const entries: VecEntry[] = Array.from({ length: 81 }, (_, index) => {
      const testId = `T${String(index).padStart(3, '0')}-01`
      return {
        testId,
        rows: [{ testId, checkpoint: 'final', path: 'p', op: 'eq', expected: '1', actual: '2', status: 'fail' }],
        runError: null,
      }
    })
    const output = formatVecOutput({ entries })
    const lines = output.stdout.split('\n')
    expect(lines[0]).toBe('向量 0/81；断言 0/81/0；运行错误数 0')
    expect(lines.slice(0, -1)).toHaveLength(81)
    expect(lines[1]).toContain('T000-01')
    expect(lines[80]).toContain('T079-01')
    expect(output.overflow).toBe('T080-01｜final｜p｜eq｜1｜2\n')
    expect(output.stdout).not.toContain('T080-01')
  })

  test('oracle 的 stale 在输出开头警告，ts 不打印', () => {
    const warning = formatVecOutput({ entries: [], stale: ['fixtures/cases/a.json', 'docs/rules.md'], impl: 'oracle' })
    expect(warning.stdout).toBe('警告：oracle 输入与记录指纹不一致：docs/rules.md、fixtures/cases/a.json\n向量 0/0；断言 0/0/0；运行错误数 0\n')
    expect(warning.exitCode).toBe(0)
    const quiet = formatVecOutput({ entries: [], stale: ['docs/rules.md'], impl: 'ts' })
    expect(quiet.stdout.startsWith('向量')).toBe(true)
  })
})
