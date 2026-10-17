/**
 * pnpm vec [编号前缀…] [--module Mx] [--all] [--impl ts|oracle] [--md 路径] [--json 路径]
 * 单独出现的 -- 一律忽略。
 * tests/vector-modules.json 形如 { "T003-01": "M1" }，由 pnpm vector:modules 生成。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_CFG_1 } from '../src/engine/config.ts'
import { evaluate } from '../src/engine/evaluate.ts'
import { doneModules } from '../src/engine/modules.ts'
import { resultCoreSchema } from '../src/engine/result.ts'
import { toWire } from '../src/engine/wire.ts'
import { runOracle, type OracleFailure } from './lib/oracle-run.ts'
import { PathError, resolvePath } from '../tests/lib/path.ts'
import {
  checkExpectation,
  isDisputed,
  loadDisputes,
  loadVectorFiles,
  vectorSchema,
  REPO_ROOT,
  type Dispute,
  type Expectation,
  type Vector,
} from '../tests/lib/vector.ts'

const VECTOR_MODULES_FILE = 'tests/vector-modules.json'
const MODULE_FILE_HINT = '请先运行 pnpm vector:modules'
const MODULE_ID = /^M(\d+)$/
const CELL_LIMIT = 100
const FAILURE_LIMIT = 80

export type VecArgs = {
  prefixes: string[]
  module: string | null
  all: boolean
  impl: 'ts' | 'oracle'
  md: string | null
  json: string | null
}

export type AssertionStatus = 'pass' | 'fail' | 'skipped'

export type AssertionRow = {
  testId: string
  checkpoint: string
  path: string
  op: string
  expected: string
  actual: string
  status: AssertionStatus
}

export type VecEntry = {
  testId: string
  rows: AssertionRow[]
  runError: string | null
}

export type VecOutput = {
  stdout: string
  overflow: string
  exitCode: number
  jsonText: string
}

type Runnable = {
  file: string
  test_id: string
  vector: Vector | null
  loadError: string | null
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function firstLineOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split(/\r?\n/).find((item) => item.trim() !== '')
  return line?.trim() ?? '未知错误'
}

function flagValue(argv: readonly string[], arg: string, flag: string, nextIndex: number): { value: string; consumed: boolean } {
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1)
    if (value === '') throw new Error(`缺少 ${flag} 的参数`)
    return { value, consumed: false }
  }
  const value = argv[nextIndex]
  if (value === undefined || value.startsWith('--')) throw new Error(`缺少 ${flag} 的参数`)
  return { value, consumed: true }
}

export function parseVecArgs(argv: readonly string[]): VecArgs {
  const prefixes: string[] = []
  let moduleId: string | null = null
  let all = false
  let impl: 'ts' | 'oracle' = 'ts'
  let md: string | null = null
  let jsonPath: string | null = null
  let index = 0
  while (index < argv.length) {
    const arg = argv[index] ?? ''
    index += 1
    if (arg === '--') continue
    if (arg === '--all') {
      all = true
      continue
    }
    if (arg === '--module' || arg.startsWith('--module=')) {
      const option = flagValue(argv, arg, '--module', index)
      if (option.consumed) index += 1
      if (!MODULE_ID.test(option.value)) throw new Error(`模块编号应为 M 加数字，实际为 ${option.value}`)
      moduleId = option.value
      continue
    }
    if (arg === '--impl' || arg.startsWith('--impl=')) {
      const option = flagValue(argv, arg, '--impl', index)
      if (option.consumed) index += 1
      if (option.value !== 'ts' && option.value !== 'oracle') throw new Error(`--impl 应为 ts 或 oracle，实际为 ${option.value}`)
      impl = option.value
      continue
    }
    if (arg === '--md' || arg.startsWith('--md=')) {
      const option = flagValue(argv, arg, '--md', index)
      if (option.consumed) index += 1
      md = option.value
      continue
    }
    if (arg === '--json' || arg.startsWith('--json=')) {
      const option = flagValue(argv, arg, '--json', index)
      if (option.consumed) index += 1
      jsonPath = option.value
      continue
    }
    if (arg.startsWith('--')) throw new Error(`未知参数 ${arg}`)
    prefixes.push(arg)
  }
  return { prefixes, module: moduleId, all, impl, md, json: jsonPath }
}

function moduleNumber(id: string): number {
  const match = MODULE_ID.exec(id)
  if (match === null) throw new Error(`模块编号应为 M 加数字，实际为 ${id}`)
  return Number(match[1])
}

export function needsVectorModules(args: Pick<VecArgs, 'prefixes' | 'module' | 'all'>, done: readonly string[]): boolean {
  if (args.module !== null) return true
  return !args.all && args.prefixes.length === 0 && done.length > 0
}

export function loadVectorModules(root: string): Map<string, string> {
  let text: string
  try {
    text = readFileSync(path.join(root, VECTOR_MODULES_FILE), 'utf8')
  } catch (error) {
    if (isEnoent(error)) throw new Error(`${VECTOR_MODULES_FILE} 不存在，${MODULE_FILE_HINT}`)
    throw error
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${VECTOR_MODULES_FILE} 不是对象，${MODULE_FILE_HINT}`)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${VECTOR_MODULES_FILE} 不是对象，${MODULE_FILE_HINT}`)
  }
  const modules = new Map<string, string>()
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !MODULE_ID.test(value)) {
      throw new Error(`${VECTOR_MODULES_FILE} 的模块值不是 M 加数字，${MODULE_FILE_HINT}`)
    }
    modules.set(key, value)
  }
  return modules
}

export function selectVectors<T extends { test_id: string }>(
  vectors: readonly T[],
  args: Pick<VecArgs, 'prefixes' | 'module' | 'all'>,
  modules: ReadonlyMap<string, string> | null,
  done: readonly string[],
): T[] {
  const useDefault = !args.all && args.prefixes.length === 0 && args.module === null
  let selected = useDefault
    ? vectors.filter((vector) => {
        const required = modules?.get(vector.test_id)
        return required !== undefined && done.includes(required)
      })
    : [...vectors]
  if (args.prefixes.length > 0) {
    selected = selected.filter((vector) => args.prefixes.some((prefix) => vector.test_id.startsWith(prefix)))
  }
  if (args.module !== null) {
    const limit = moduleNumber(args.module)
    selected = selected.filter((vector) => {
      const required = modules?.get(vector.test_id)
      return required !== undefined && moduleNumber(required) <= limit
    })
  }
  return selected
}

function show(value: unknown): string {
  const text = JSON.stringify(value)
  return text === undefined ? 'undefined' : text
}

function expectedText(expectation: Expectation): string {
  return 'value' in expectation ? show(expectation.value) : ''
}

export function judgeVector(
  testId: string,
  expectations: readonly Expectation[],
  checkpoints: ReadonlyMap<string, unknown>,
  disputes: readonly Dispute[],
): AssertionRow[] {
  const rows: AssertionRow[] = []
  for (const expectation of expectations) {
    const base = {
      testId,
      checkpoint: expectation.checkpoint,
      path: expectation.path,
      op: expectation.op,
      expected: expectedText(expectation),
    }
    if (isDisputed(disputes, testId, expectation)) {
      rows.push({ ...base, actual: '', status: 'skipped' })
      continue
    }
    const result = checkpoints.get(expectation.checkpoint)
    if (result === undefined) {
      rows.push({ ...base, actual: '缺少检查点', status: 'fail' })
      continue
    }
    try {
      const resolved = resolvePath(result, expectation.path)
      const ok = checkExpectation(resolved, expectation)
      const actual = resolved.found ? show(resolved.value) : '不存在'
      rows.push({ ...base, actual, status: ok ? 'pass' : 'fail' })
    } catch (error) {
      if (!(error instanceof PathError)) throw error
      const actual = error.message.includes('命中') ? '选择器多命中' : error.message
      rows.push({ ...base, actual, status: 'fail' })
    }
  }
  return rows
}

function truncateCell(text: string): string {
  const chars = [...text]
  return chars.length <= CELL_LIMIT ? text : chars.slice(0, CELL_LIMIT).join('')
}

function failureLine(cells: readonly string[]): string {
  return cells.map(truncateCell).join('｜')
}

export function formatVecOutput(input: { entries: readonly VecEntry[]; stale?: readonly string[]; impl?: 'ts' | 'oracle' }): VecOutput {
  let vectorsPassed = 0
  let assertionsPassed = 0
  let assertionsFailed = 0
  let assertionsSkipped = 0
  let runErrorCount = 0
  const assertions: AssertionRow[] = []
  const runErrorItems: { testId: string; message: string }[] = []
  const failureLines: string[] = []
  for (const entry of input.entries) {
    if (entry.runError !== null) {
      runErrorCount += 1
      runErrorItems.push({ testId: entry.testId, message: entry.runError })
      failureLines.push(failureLine([entry.testId, '', '', '', '', entry.runError]))
      continue
    }
    let failed = false
    for (const row of entry.rows) {
      assertions.push(row)
      if (row.status === 'skipped') assertionsSkipped += 1
      else if (row.status === 'pass') assertionsPassed += 1
      else {
        assertionsFailed += 1
        failed = true
        failureLines.push(failureLine([row.testId, row.checkpoint, row.path, row.op, row.expected, row.actual]))
      }
    }
    if (!failed) vectorsPassed += 1
  }
  const stale = [...(input.stale ?? [])].sort()
  const summary = `向量 ${vectorsPassed}/${input.entries.length}；断言 ${assertionsPassed}/${assertionsPassed + assertionsFailed}/${assertionsSkipped}；运行错误数 ${runErrorCount}`
  const warning = (input.impl ?? 'ts') === 'oracle' && stale.length > 0 ? `警告：oracle 输入与记录指纹不一致：${stale.join('、')}` : null
  const shown = failureLines.slice(0, FAILURE_LIMIT)
  const rest = failureLines.slice(FAILURE_LIMIT)
  const lines = [...(warning === null ? [] : [warning]), summary, ...shown]
  return {
    stdout: `${lines.join('\n')}\n`,
    overflow: rest.length === 0 ? '' : `${rest.join('\n')}\n`,
    exitCode: assertionsFailed > 0 || runErrorCount > 0 ? 1 : 0,
    jsonText: `${JSON.stringify(
      {
        summary: {
          vectorsPassed,
          vectorsTotal: input.entries.length,
          assertionsPassed,
          assertionsTotal: assertionsPassed + assertionsFailed,
          assertionsSkipped,
          runErrors: runErrorCount,
        },
        stale,
        assertions,
        runErrors: runErrorItems,
      },
      null,
      2,
    )}\n`,
  }
}

function loadRunnable(root: string): Runnable[] {
  return loadVectorFiles(root).files.map(({ file, text }) => {
    const fallbackId = path.basename(file, '.json')
    try {
      const parsed = vectorSchema.safeParse(JSON.parse(text))
      if (!parsed.success) {
        return { file, test_id: fallbackId, vector: null, loadError: parsed.error.issues[0]?.message ?? '向量结构不符' }
      }
      return { file, test_id: parsed.data.test_id, vector: parsed.data, loadError: null }
    } catch (error) {
      return { file, test_id: fallbackId, vector: null, loadError: firstLineOf(error) }
    }
  })
}

function runTypeScript(vector: Vector): { checkpoints: Map<string, unknown> } | { error: string } {
  try {
    const output = evaluate(vector.input, vector.ops, DEMO_CFG_1)
    const checkpoints = new Map<string, unknown>()
    for (const checkpoint of output.checkpoints) {
      checkpoints.set(checkpoint.label, toWire(resultCoreSchema.parse(checkpoint.result)))
    }
    return { checkpoints }
  } catch (error) {
    return { error: `运行错误：${firstLineOf(error)}` }
  }
}

function parseOracleCheckpoints(text: string): Map<string, unknown> {
  const data: unknown = JSON.parse(text)
  if (data === null || typeof data !== 'object' || !('checkpoints' in data) || !Array.isArray(data.checkpoints)) {
    throw new Error('结果缺少 checkpoints')
  }
  const checkpoints = new Map<string, unknown>()
  for (const checkpoint of data.checkpoints) {
    if (checkpoint === null || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) throw new Error('检查点格式不符')
    if (!('label' in checkpoint) || typeof checkpoint.label !== 'string') throw new Error('检查点缺少 label')
    if (!('result' in checkpoint)) throw new Error('检查点缺少 result')
    checkpoints.set(checkpoint.label, checkpoint.result)
  }
  return checkpoints
}

function readOracleResult(root: string, fileName: string, errors: ReadonlyMap<string, string>): Map<string, unknown> {
  const recorded = errors.get(fileName)
  if (recorded !== undefined) throw new Error(recorded)
  try {
    return parseOracleCheckpoints(readFileSync(path.join(root, '.cache', 'oracle-out', 'vectors', fileName), 'utf8'))
  } catch (error) {
    if (isEnoent(error)) throw new Error('缺少结果文件')
    throw error
  }
}

function vectorFailures(failures: readonly OracleFailure[]): Map<string, string> {
  const errors = new Map<string, string>()
  for (const failure of failures) {
    if (failure.file.startsWith('vectors/')) errors.set(failure.file.slice('vectors/'.length), failure.error)
  }
  return errors
}

function entriesFrom(selected: readonly Runnable[], disputes: readonly Dispute[], checkpointsOf: (item: Runnable) => Map<string, unknown>): VecEntry[] {
  return selected.map((item) => {
    if (item.vector === null) return { testId: item.test_id, rows: [], runError: `运行错误：${item.loadError ?? '向量结构不符'}` }
    try {
      return { testId: item.test_id, rows: judgeVector(item.test_id, item.vector.expect, checkpointsOf(item), disputes), runError: null }
    } catch (error) {
      const line = firstLineOf(error)
      return { testId: item.test_id, rows: [], runError: line.startsWith('运行错误：') ? line : `运行错误：${line}` }
    }
  })
}

/** 供 test:report 等脚本直接复用：不重新实现选向量与判定逻辑，也不另开进程 */
export async function runEntries(args: VecArgs, root: string): Promise<VecOutput> {
  const modules = needsVectorModules(args, doneModules) ? loadVectorModules(root) : null
  const selected = selectVectors(loadRunnable(root), args, modules, doneModules)
  const disputes = loadDisputes(root)
  if (args.impl === 'ts') {
    return formatVecOutput({
      entries: entriesFrom(selected, disputes, (item) => {
        if (item.vector === null) throw new Error(item.loadError ?? '向量结构不符')
        const ran = runTypeScript(item.vector)
        if ('error' in ran) throw new Error(ran.error)
        return ran.checkpoints
      }),
      impl: 'ts',
    })
  }
  const outcome = await runOracle({ root })
  const errors = vectorFailures(outcome.failures)
  return formatVecOutput({
    entries: entriesFrom(selected, disputes, (item) => readOracleResult(root, path.basename(item.file), errors)),
    stale: outcome.stale,
    impl: 'oracle',
  })
}

async function writeOptional(file: string | null, text: string): Promise<void> {
  if (file === null) return
  const target = path.resolve(file)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, text, 'utf8')
}

async function main(): Promise<number> {
  const args = parseVecArgs(process.argv.slice(2))
  const output = await runEntries(args, REPO_ROOT)
  process.stdout.write(output.stdout)
  await writeOptional(args.md, output.overflow)
  await writeOptional(args.json, output.jsonText)
  return output.exitCode
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
