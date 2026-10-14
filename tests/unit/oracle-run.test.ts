import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { contentFingerprint, stripVector } from '../../scripts/oracle-export.ts'
import { listStale, runOracle, runOracleOne, type OracleSpawn } from '../../scripts/lib/oracle-run.ts'

const vector = {
  test_id: 'T003-01',
  source_text: '秘密',
  expect: [{ checkpoint: 'final', path: 'a', op: 'eq', value: 1 }],
  input: { meta: { case_id: 'c01' } },
  ops: [],
}

function write(root: string, relativePath: string, text: string) {
  const file = path.join(root, relativePath)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-run-'))
  write(root, 'docs/rules.md', '规则\r\n')
  write(root, 'docs/policy_card.md', '政策\n')
  write(root, 'docs/scope.md', '范围\n')
  write(root, 'fixtures/cases/c01.json', '{}\n')
  write(root, 'fixtures/vectors/T003-01.json', `${JSON.stringify(vector, null, 2)}\n`)
  return root
}

function manifest(root: string, overrides: Record<string, string> = {}): void {
  const vectorText = readFileSync(path.join(root, 'fixtures/vectors/T003-01.json'), 'utf8')
  const files: Record<string, string> = {
    'docs/rules.md': contentFingerprint(readFileSync(path.join(root, 'docs/rules.md'), 'utf8')),
    'docs/policy_card.md': contentFingerprint(readFileSync(path.join(root, 'docs/policy_card.md'), 'utf8')),
    'docs/scope.md': contentFingerprint(readFileSync(path.join(root, 'docs/scope.md'), 'utf8')),
    'fixtures/cases/c01.json': contentFingerprint(readFileSync(path.join(root, 'fixtures/cases/c01.json'), 'utf8')),
    'fixtures/vectors/T003-01.json': contentFingerprint(stripVector(vectorText)),
    'docs/_work/schema.json': 'ignored',
    ...overrides,
  }
  write(root, 'oracle/oracle_inputs.json', `${JSON.stringify(files, null, 2)}\n`)
}

describe('listStale', () => {
  test('指纹不一致或一侧多出的可比文件列入 stale，schema 不参与', async () => {
    const root = makeRoot()
    try {
      manifest(root, { 'docs/policy_card.md': 'wrong', 'fixtures/cases/gone.json': 'abc' })
      expect(await listStale(root)).toEqual(['docs/policy_card.md', 'fixtures/cases/gone.json'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('清单缺失时，当前可比文件全部列入 stale', async () => {
    const root = makeRoot()
    try {
      expect(await listStale(root)).toEqual([
        'docs/policy_card.md',
        'docs/rules.md',
        'docs/scope.md',
        'fixtures/cases/c01.json',
        'fixtures/vectors/T003-01.json',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runOracle', () => {
  test('batch 参数、环境变量和去掉 expect 的向量；stale 不阻止运行', async () => {
    const root = makeRoot()
    try {
      manifest(root, { 'docs/policy_card.md': 'wrong' })
      write(root, '.cache/oracle-in/vectors/old.json', '{}\n')
      write(root, '.cache/oracle-in/cases/old.json', '{}\n')
      write(root, '.cache/oracle-out/vectors/old.json', '{}\n')
      const calls: string[][] = []
      const spawn: OracleSpawn = (args, options) => {
        calls.push([...args])
        expect(options.cwd).toBe(root)
        expect(options.env.PYTHONDONTWRITEBYTECODE).toBe('1')
        expect(options.env.PYTHONUTF8).toBe('1')
        expect(options.env.PYTHONIOENCODING).toBe('utf-8')
        return { status: 0, stdout: '', stderr: '' }
      }
      const result = await runOracle({ root, spawn })
      expect(result.stale).toEqual(['docs/policy_card.md'])
      expect(result.failures).toEqual([])
      expect(calls).toEqual([
        ['-m', 'oracle', 'batch', '--cases', '.cache/oracle-in/cases', '--vectors', '.cache/oracle-in/vectors', '--out', '.cache/oracle-out'],
      ])
      const stripped = JSON.parse(readFileSync(path.join(root, '.cache/oracle-in/vectors/T003-01.json'), 'utf8')) as Record<string, unknown>
      expect(stripped).not.toHaveProperty('expect')
      expect(stripped).not.toHaveProperty('source_text')
      expect(stripped.input).toEqual(vector.input)
      expect(existsSync(path.join(root, '.cache/oracle-in/vectors/old.json'))).toBe(false)
      expect(existsSync(path.join(root, '.cache/oracle-in/cases/old.json'))).toBe(false)
      expect(existsSync(path.join(root, '.cache/oracle-out/vectors/old.json'))).toBe(false)
      expect(readFileSync(path.join(root, '.cache/oracle-in/cases/c01.json'), 'utf8')).toBe('{}\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('batch 非零退出时逐个 run，失败只记录错误首行', async () => {
    const root = makeRoot()
    try {
      manifest(root)
      const spawn: OracleSpawn = (args, options) => {
        if (args[2] === 'batch') {
          write(options.cwd, '.cache/oracle-out/vectors/partial.json', 'partial')
          return { status: 1, stdout: '', stderr: 'batch failed\nmore' }
        }
        if (args[3]?.includes('/cases/')) return { status: 0, stdout: '{"ok":1}\n', stderr: '' }
        return { status: 2, stdout: '标准输出不该用\n', stderr: '向量炸了\n第二行' }
      }
      const result = await runOracle({ root, spawn })
      expect(result.failures).toEqual([{ file: 'vectors/T003-01.json', error: '向量炸了' }])
      expect(readFileSync(path.join(root, '.cache/oracle-out/cases/c01.json'), 'utf8')).toBe('{"ok":1}\n')
      expect(existsSync(path.join(root, '.cache/oracle-out/vectors/partial.json'))).toBe(false)
      expect(existsSync(path.join(root, '.cache/oracle-out/vectors/T003-01.json'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runOracleOne', () => {
  test('写入 {input, ops} 并返回解析后的标准输出', async () => {
    const root = makeRoot()
    const caseFile = path.join(root, 'case.json')
    writeFileSync(caseFile, '{"meta":{"case_id":"c01"}}\n', 'utf8')
    try {
      const spawn: OracleSpawn = (args, options) => {
        expect(args).toEqual(['-m', 'oracle', 'run', '.cache/oracle-in/one/input.json'])
        expect(options.env.PYTHONIOENCODING).toBe('utf-8')
        const written = JSON.parse(readFileSync(path.join(root, '.cache/oracle-in/one/input.json'), 'utf8')) as unknown
        expect(written).toEqual({ input: { meta: { case_id: 'c01' } }, ops: [{ type: 'EVALUATE', label: 'final' }] })
        return { status: 0, stdout: '{"checkpoints":[]}\n', stderr: '' }
      }
      await expect(runOracleOne(caseFile, [{ type: 'EVALUATE', label: 'final' }], { root, spawn })).resolves.toEqual({ checkpoints: [] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('非零退出抛出错误首行', async () => {
    const root = makeRoot()
    const caseFile = path.join(root, 'case.json')
    writeFileSync(caseFile, '{}\n', 'utf8')
    try {
      const spawn: OracleSpawn = () => ({ status: 1, stdout: '', stderr: '坏了\n更多' })
      await expect(runOracleOne(caseFile, [], { root, spawn })).rejects.toThrow('坏了')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
