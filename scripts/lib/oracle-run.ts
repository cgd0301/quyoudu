/**
 * 调用参考实现：batch 失败时改为逐个 run。
 * 向量目录与 tests/lib/vector.ts 的 loadVectorFiles 相同；指纹不一致只返回 stale，不阻止运行。
 */
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadVectorFiles } from '../../tests/lib/vector.ts'
import { contentFingerprint, stripVector } from '../oracle-export.ts'
import { pythonCmd } from './py.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

const DOC_FILES = ['docs/rules.md', 'docs/policy_card.md', 'docs/scope.md'] as const
const CASES_IN = '.cache/oracle-in/cases'
const VECTORS_IN = '.cache/oracle-in/vectors'
const ORACLE_OUT = '.cache/oracle-out'
const ONE_INPUT = '.cache/oracle-in/one/input.json'

export type OracleSpawnResult = {
  status: number | null
  stdout: string
  stderr: string
}

export type OracleSpawn = (
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => OracleSpawnResult

export type OracleFailure = {
  file: string
  error: string
}

export type OracleRunResult = {
  stale: string[]
  failures: OracleFailure[]
}

export type OracleRunOptions = {
  root?: string
  spawn?: OracleSpawn
}

type InputFile = {
  kind: 'cases' | 'vectors'
  name: string
  arg: string
}

function oracleEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
}

function defaultSpawn(args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): OracleSpawnResult {
  const result = spawnSync(pythonCmd, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  let stderr = typeof result.stderr === 'string' ? result.stderr : ''
  if (stderr === '' && result.error instanceof Error) stderr = result.error.message
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr,
  }
}

function firstErrorLine(result: OracleSpawnResult): string {
  const source = result.stderr.trim() !== '' ? result.stderr : result.stdout
  const line = source.split(/\r?\n/).find((item) => item.trim() !== '')
  return line?.trim() ?? `退出码 ${result.status ?? '未知'}`
}

function isComparedPath(file: string): boolean {
  return (DOC_FILES as readonly string[]).includes(file) || file.startsWith('fixtures/cases/') || file.startsWith('fixtures/vectors/')
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return null
    throw error
  }
}

async function jsonNames(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
}

function readManifest(text: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(text)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
    return data as Record<string, unknown>
  } catch {
    return null
  }
}

async function currentFingerprints(root: string): Promise<Map<string, string>> {
  const current = new Map<string, string>()
  for (const file of DOC_FILES) {
    const text = await readOptional(path.join(root, file))
    if (text !== null) current.set(file, contentFingerprint(text))
  }
  for (const name of await jsonNames(path.join(root, 'fixtures', 'cases'))) {
    const relative = `fixtures/cases/${name}`
    current.set(relative, contentFingerprint(await readFile(path.join(root, 'fixtures', 'cases', name), 'utf8')))
  }
  for (const name of await jsonNames(path.join(root, 'fixtures', 'vectors'))) {
    const relative = `fixtures/vectors/${name}`
    const text = await readFile(path.join(root, 'fixtures', 'vectors', name), 'utf8')
    current.set(relative, contentFingerprint(stripVector(text)))
  }
  return current
}

/** 与 oracle/oracle_inputs.json 不一致的相对路径；清单缺失时返回全部可比文件 */
export async function listStale(root: string): Promise<string[]> {
  const current = await currentFingerprints(root)
  const text = await readOptional(path.join(root, 'oracle', 'oracle_inputs.json'))
  if (text === null) return [...current.keys()].sort()
  const manifest = readManifest(text)
  if (manifest === null) return [...current.keys()].sort()
  const stale = new Set<string>()
  for (const [file, fingerprint] of current) {
    if (manifest[file] !== fingerprint) stale.add(file)
  }
  for (const file of Object.keys(manifest)) {
    if (isComparedPath(file) && !current.has(file)) stale.add(file)
  }
  return [...stale].sort()
}

async function prepareInputs(root: string): Promise<InputFile[]> {
  const casesDir = path.join(root, '.cache', 'oracle-in', 'cases')
  const vectorsDir = path.join(root, '.cache', 'oracle-in', 'vectors')
  await rm(casesDir, { recursive: true, force: true })
  await rm(vectorsDir, { recursive: true, force: true })
  await mkdir(casesDir, { recursive: true })
  await mkdir(vectorsDir, { recursive: true })
  const inputs: InputFile[] = []
  for (const name of await jsonNames(path.join(root, 'fixtures', 'cases'))) {
    await copyFile(path.join(root, 'fixtures', 'cases', name), path.join(casesDir, name))
    inputs.push({ kind: 'cases', name, arg: `${CASES_IN}/${name}` })
  }
  const { files } = loadVectorFiles(root)
  for (const file of files) {
    const name = path.basename(file.file)
    await writeFile(path.join(vectorsDir, name), stripVector(file.text), 'utf8')
    inputs.push({ kind: 'vectors', name, arg: `${VECTORS_IN}/${name}` })
  }
  return inputs
}

async function runOneFile(spawn: OracleSpawn, root: string, env: NodeJS.ProcessEnv, item: InputFile): Promise<OracleFailure | null> {
  const result = spawn(['-m', 'oracle', 'run', item.arg], { cwd: root, env })
  if (result.status === 0) {
    const target = path.join(root, '.cache', 'oracle-out', item.kind, item.name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, result.stdout, 'utf8')
    return null
  }
  return { file: `${item.kind}/${item.name}`, error: firstErrorLine(result) }
}

export async function runOracle(options: OracleRunOptions = {}): Promise<OracleRunResult> {
  const root = options.root ?? repoRoot
  const spawn = options.spawn ?? defaultSpawn
  const stale = await listStale(root)
  const inputs = await prepareInputs(root)
  const env = oracleEnv()
  await rm(path.join(root, ORACLE_OUT), { recursive: true, force: true })
  const batch = spawn(['-m', 'oracle', 'batch', '--cases', CASES_IN, '--vectors', VECTORS_IN, '--out', ORACLE_OUT], { cwd: root, env })
  if (batch.status === 0) return { stale, failures: [] }
  await rm(path.join(root, ORACLE_OUT), { recursive: true, force: true })
  const failures: OracleFailure[] = []
  for (const item of inputs) {
    const failure = await runOneFile(spawn, root, env, item)
    if (failure !== null) failures.push(failure)
  }
  return { stale, failures }
}

/** 把 { input, ops } 交给 python -m oracle run，返回解析后的标准输出 */
export async function runOracleOne(caseFile: string, ops: unknown, options: OracleRunOptions = {}): Promise<unknown> {
  const root = options.root ?? repoRoot
  const spawn = options.spawn ?? defaultSpawn
  const input: unknown = JSON.parse(await readFile(caseFile, 'utf8'))
  const target = path.join(root, '.cache', 'oracle-in', 'one', 'input.json')
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({ input, ops }, null, 2)}\n`, 'utf8')
  const result = spawn(['-m', 'oracle', 'run', ONE_INPUT], { cwd: root, env: oracleEnv() })
  if (result.status !== 0) throw new Error(firstErrorLine(result))
  return JSON.parse(result.stdout) as unknown
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
