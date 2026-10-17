/**
 * pnpm flows [--check]
 *
 * 由 fixtures/flow_index.json 生成 fixtures/flows/<flow_id>.json，结构严格为
 * { flow_id, input, ops }（与 scripts/golden-write.ts 的人工作用格式一致）：
 * input 为该案例文件的原文内容，ops 为索引里的操作。
 *
 * --check：只比较、不写入，不一致时以退出码 1 结束（用于门禁，防止流程文件与索引脱节）。
 */
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { opsSchema } from '../src/engine/ops/index.ts'
import { caseFileSchema } from '../src/engine/schema.ts'
import { canonicalWire } from './lib/canonical.ts'
import { repoPath, writeFileAtomic } from './lib/repo.ts'

export const flowIndexSchema = z.strictObject({
  simulated: z.literal(true),
  notice: z.string(),
  source: z.string(),
  flows: z.array(
    z.strictObject({
      flow_id: z.string().min(1),
      case: z.string().min(1),
      title: z.string().min(1),
      ops: opsSchema,
    }),
  ),
})

export type FlowIndex = z.infer<typeof flowIndexSchema>

export type FlowOutput = { flow_id: string; case: string; title: string; text: string }

/** 纯函数：由索引与案例原文生成每个流程文件的文本 */
export function buildFlows(index: FlowIndex, cases: ReadonlyMap<string, unknown>): FlowOutput[] {
  return index.flows.map((flow) => {
    const input = cases.get(flow.case)
    if (input === undefined) throw new Error(`流程 ${flow.flow_id} 引用了不存在的案例 ${flow.case}`)
    return {
      flow_id: flow.flow_id,
      case: flow.case,
      title: flow.title,
      text: canonicalWire({ flow_id: flow.flow_id, input, ops: flow.ops }),
    }
  })
}

async function loadInputs(index: FlowIndex): Promise<Map<string, unknown>> {
  const cases = new Map<string, unknown>()
  for (const flow of index.flows) {
    if (cases.has(flow.case)) continue
    const file = repoPath('fixtures/cases', `${flow.case}.json`)
    const data = caseFileSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    cases.set(flow.case, data)
  }
  return cases
}

async function readExisting(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    out.set(name, (await readFile(path.join(dir, name), 'utf8')).replace(/\r\n/g, '\n'))
  }
  return out
}

export async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check')
  const unknown = argv.filter((arg) => arg !== '--check')
  if (unknown.length > 0) throw new Error(`未知参数 ${unknown.join(' ')}；用法：pnpm flows [--check]`)

  const index = flowIndexSchema.parse(JSON.parse(await readFile(repoPath('fixtures/flow_index.json'), 'utf8')))
  const ids = new Set<string>()
  for (const flow of index.flows) {
    if (ids.has(flow.flow_id)) throw new Error(`流程编号重复：${flow.flow_id}`)
    ids.add(flow.flow_id)
  }
  const built = buildFlows(index, await loadInputs(index))
  const dir = repoPath('fixtures/flows')

  if (check) {
    const existing = await readExisting(dir)
    const problems: string[] = []
    for (const flow of built) {
      const current = existing.get(`${flow.flow_id}.json`)
      if (current === undefined) problems.push(`缺少 fixtures/flows/${flow.flow_id}.json`)
      else if (current !== flow.text) problems.push(`fixtures/flows/${flow.flow_id}.json 与索引不一致`)
    }
    for (const name of existing.keys()) {
      if (!ids.has(name.slice(0, -'.json'.length))) problems.push(`fixtures/flows/${name} 不在索引中`)
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem)
      console.error('请运行 pnpm flows 重新生成')
      return 1
    }
    console.log(`流程 ${built.length} 个，与索引一致`)
    return 0
  }

  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const flow of built) writeFileAtomic(path.join(dir, `${flow.flow_id}.json`), flow.text)
  console.log(`已生成 ${built.length} 个流程到 fixtures/flows`)
  return 0
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
