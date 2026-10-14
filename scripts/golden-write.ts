/**
 * 仅限人工运行
 *
 * --vectors：清空 tests/golden/vectors，再把 fixtures/vectors/*.json 原样复制进去。
 * --cases：对 fixtures/cases 每个案例（ops 为空）运行 evaluate，toWire 后按键排序、
 * 2 空格缩进、LF，写入 tests/golden/cases/<case_id>.result.json（含 checkpoints）。
 * fixtures/flows 存在且有 json 时，每个文件为 { flow_id, input, ops }，同样写入
 * tests/golden/flows/<flow_id>.result.json，保留全部检查点。目录不存在或没有 json 时跳过。
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DEMO_CFG_1 } from '../src/engine/config.ts'
import { evaluate } from '../src/engine/evaluate.ts'
import { opsSchema } from '../src/engine/ops/index.ts'
import { caseFileSchema } from '../src/engine/schema.ts'
import { toWire } from '../src/engine/wire.ts'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const USAGE = '用法：pnpm golden:write --vectors 或 --cases（可同时给出）'

export const flowFileSchema = z.strictObject({
  flow_id: z.string().min(1),
  input: caseFileSchema,
  ops: opsSchema,
})

/** 对象键递归排序；数组顺序不变 */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key])
    return out
  }
  return value
}

/** toWire 之后按键排序，2 空格缩进，LF，末尾换行 */
export function canonicalWire(value: unknown): string {
  return `${JSON.stringify(sortKeys(toWire(value)), null, 2)}\n`
}

function stem(name: string, suffix: string): string {
  return name.slice(0, -suffix.length)
}

async function clearResultJson(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const names = await readdir(dir)
  await Promise.all(
    names.filter((name) => name.endsWith('.result.json')).map((name) => rm(path.join(dir, name))),
  )
}

export async function writeGoldenVectors(root = rootDir): Promise<number> {
  const dest = path.join(root, 'tests/golden/vectors')
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  const src = path.join(root, 'fixtures/vectors')
  const names = (await readdir(src)).filter((name) => name.endsWith('.json')).sort()
  for (const name of names) await copyFile(path.join(src, name), path.join(dest, name))
  return names.length
}

export async function writeGoldenCases(root = rootDir): Promise<number> {
  const dest = path.join(root, 'tests/golden/cases')
  await clearResultJson(dest)
  const src = path.join(root, 'fixtures/cases')
  const names = (await readdir(src)).filter((name) => name.endsWith('.json')).sort()
  for (const name of names) {
    const caseId = stem(name, '.json')
    const data = caseFileSchema.parse(JSON.parse(await readFile(path.join(src, name), 'utf8')))
    if (data.meta.case_id !== caseId) throw new Error(`${name} 的 case_id 应为 ${caseId}，实际为 ${data.meta.case_id}`)
    const output = evaluate(data, [], DEMO_CFG_1)
    await writeFile(path.join(dest, `${data.meta.case_id}.result.json`), canonicalWire(output), 'utf8')
  }
  return names.length
}

export async function writeGoldenFlows(root = rootDir): Promise<number> {
  const src = path.join(root, 'fixtures/flows')
  let names: string[]
  try {
    names = (await readdir(src)).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    if (isEnoent(error)) return 0
    throw error
  }
  if (names.length === 0) return 0
  const dest = path.join(root, 'tests/golden/flows')
  await clearResultJson(dest)
  for (const name of names) {
    const flowId = stem(name, '.json')
    const flow = flowFileSchema.parse(JSON.parse(await readFile(path.join(src, name), 'utf8')))
    if (flow.flow_id !== flowId) throw new Error(`${name} 的 flow_id 应为 ${flowId}，实际为 ${flow.flow_id}`)
    const output = evaluate(flow.input, flow.ops, DEMO_CFG_1)
    await writeFile(path.join(dest, `${flow.flow_id}.result.json`), canonicalWire(output), 'utf8')
  }
  return names.length
}

function parseArgs(argv: readonly string[]): { vectors: boolean; cases: boolean } | null {
  if (argv.length === 0 || argv.some((arg) => arg !== '--vectors' && arg !== '--cases')) return null
  return { vectors: argv.includes('--vectors'), cases: argv.includes('--cases') }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed === null) {
    console.error(USAGE)
    process.exit(1)
  }
  const run = async () => {
    if (parsed.vectors) {
      const count = await writeGoldenVectors()
      console.log(`已复制 ${count} 个向量到 tests/golden/vectors`)
    }
    if (parsed.cases) {
      const cases = await writeGoldenCases()
      const flows = await writeGoldenFlows()
      console.log(`已写入 ${cases} 个案例结果`)
      if (flows > 0) console.log(`已写入 ${flows} 个流程结果`)
    }
  }
  run().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
