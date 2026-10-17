/**
 * pnpm export:results
 *
 * 把演示案例与演示流程交给正式引擎（src/engine 的 evaluate，配置 DEMO_CFG_1）计算，
 * 结果导出到 book/data，供项目书正文、图表和附录引用。
 *
 * 约定：
 * - 只调用 TS 引擎，不复制 tests/golden 或历史预期输出；
 * - doneModules 少于 M1—M7 时以退出码 1 结束，不改用参考实现；
 * - 输出用 canonicalWire（toWire、键排序、2 空格、LF，末尾换行）；
 * - 先清空 book/data/cases 与 book/data/flows 再写，重跑结果逐字节相同；
 * - meta 里的 commit 与 commit_time 取最后一次改动代码和数据的提交，不读系统时钟；
 * - 导出始终带“模拟数据”标识（AGENTS.md §3）。
 */
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_CFG_1 } from '../src/engine/config.ts'
import { evaluate, type EvaluateOutput } from '../src/engine/evaluate.ts'
import { doneModules } from '../src/engine/modules.ts'
import { opsSchema } from '../src/engine/ops/index.ts'
import { caseFileSchema, type CaseFile } from '../src/engine/schema.ts'
import { canonicalWire } from './lib/canonical.ts'
import { codeCommitInfo, listFiles, readJson, writeFileAtomic, repoPath } from './lib/repo.ts'

const REQUIRED_MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const
const CASES_DIR = 'fixtures/cases'
const FLOWS_DIR = 'fixtures/flows'
const OUT_DIR = 'book/data'

export type ExportMeta = {
  engine: 'ts'
  commit: string
  commit_time: string
  config_version: string
  done_modules: readonly string[]
  simulated: true
  notice: string
  generated_by: string
}

export type CheckpointSummary = {
  label: string
  input_version: string
  plan_state: string
  optimization_state: string
  confirmation_state: string
  labels: readonly string[]
}

export type IndexEntry = {
  kind: 'case' | 'flow'
  id: string
  title: string
  file: string
  checkpoints: readonly CheckpointSummary[]
}

export type ExportFile = { file: string; text: string }

export type FlowFile = { flow_id: string; input: CaseFile; ops: unknown[] }

export function exportMeta(commit: { hash: string; time: string }): ExportMeta {
  return {
    engine: 'ts',
    commit: commit.hash,
    commit_time: commit.time,
    config_version: DEMO_CFG_1.configVersion ?? '',
    done_modules: [...doneModules],
    simulated: true,
    notice: '模拟数据',
    generated_by: 'pnpm export:results',
  }
}

function summarize(output: EvaluateOutput): CheckpointSummary[] {
  return output.checkpoints.map((checkpoint) => ({
    label: checkpoint.label,
    input_version: checkpoint.result.inputVersion,
    plan_state: checkpoint.result.states.planState,
    optimization_state: checkpoint.result.states.optimizationState,
    confirmation_state: checkpoint.result.states.confirmationState,
    labels: [...checkpoint.result.labels],
  }))
}

/** 一个案例的导出文件：meta 与全部检查点（案例没有操作，只有 final 一个检查点） */
export function buildCaseFile(caseData: CaseFile, meta: ExportMeta): { file: string; text: string; entry: IndexEntry } {
  const caseId = caseData.meta.case_id
  const output = evaluate(caseData, [], DEMO_CFG_1)
  const text = canonicalWire({
    meta: {
      ...meta,
      kind: 'case',
      id: caseId,
      source: `${CASES_DIR}/${caseId}.json`,
      purpose: caseData.meta.purpose,
      case_data_version: caseData.meta.data_version,
      source_type: caseData.meta.source_type,
    },
    checkpoints: output.checkpoints,
  })
  return {
    file: `cases/${caseId}.json`,
    text,
    entry: {
      kind: 'case',
      id: caseId,
      title: caseData.meta.purpose,
      file: `cases/${caseId}.json`,
      checkpoints: summarize(output),
    },
  }
}

/** 一个演示流程的导出文件：按 fixtures/flows 里的 ops 计算，保留全部检查点 */
export function buildFlowFile(flow: FlowFile, meta: ExportMeta): { file: string; text: string; entry: IndexEntry } {
  const output = evaluate(flow.input, opsSchema.parse(flow.ops), DEMO_CFG_1)
  const text = canonicalWire({
    meta: {
      ...meta,
      kind: 'flow',
      id: flow.flow_id,
      source: `${FLOWS_DIR}/${flow.flow_id}.json`,
      purpose: flow.input.meta.purpose,
      case_id: flow.input.meta.case_id,
      case_data_version: flow.input.meta.data_version,
      source_type: flow.input.meta.source_type,
    },
    checkpoints: output.checkpoints,
  })
  return {
    file: `flows/${flow.flow_id}.json`,
    text,
    entry: {
      kind: 'flow',
      id: flow.flow_id,
      title: flow.input.meta.purpose,
      file: `flows/${flow.flow_id}.json`,
      checkpoints: summarize(output),
    },
  }
}

/** 纯函数：由案例、流程和 meta 生成全部导出文件与目录索引 */
export function buildExports(input: {
  cases: readonly CaseFile[]
  flows: readonly FlowFile[]
  meta: ExportMeta
}): { files: ExportFile[]; indexText: string; entries: IndexEntry[] } {
  const files: ExportFile[] = []
  const entries: IndexEntry[] = []
  for (const caseData of input.cases) {
    const built = buildCaseFile(caseData, input.meta)
    files.push({ file: built.file, text: built.text })
    entries.push(built.entry)
  }
  for (const flow of input.flows) {
    const built = buildFlowFile(flow, input.meta)
    files.push({ file: built.file, text: built.text })
    entries.push(built.entry)
  }
  const indexText = canonicalWire({
    meta: { ...input.meta, kind: 'index', entries: entries.length },
    entries,
  })
  return { files, indexText, entries }
}

function assertModules(): void {
  const missing = REQUIRED_MODULES.filter((module) => !doneModules.includes(module))
  if (missing.length > 0) {
    throw new Error(`doneModules 缺少 ${missing.join('、')}，不能用正式引擎导出；不改用参考实现`)
  }
}

async function readCases(): Promise<CaseFile[]> {
  const dir = repoPath(CASES_DIR)
  const names = listFiles(dir, '.json')
  if (names.length === 0) throw new Error(`${CASES_DIR} 下没有案例文件`)
  return names.map((name) => {
    const data = caseFileSchema.parse(readJson(path.join(dir, name)))
    const expected = name.slice(0, -'.json'.length)
    if (data.meta.case_id !== expected) throw new Error(`${name} 的 case_id 应为 ${expected}，实际为 ${data.meta.case_id}`)
    return data
  })
}

async function readFlows(): Promise<FlowFile[]> {
  const dir = repoPath(FLOWS_DIR)
  let names: string[]
  try {
    names = listFiles(dir, '.json')
  } catch (error) {
    if (String(error).includes('目录不存在')) return []
    throw error
  }
  return names.map((name) => {
    const data = readJson<FlowFile>(path.join(dir, name))
    const expected = name.slice(0, -'.json'.length)
    if (data.flow_id !== expected) throw new Error(`${name} 的 flow_id 应为 ${expected}，实际为 ${data.flow_id}`)
    caseFileSchema.parse(data.input)
    opsSchema.parse(data.ops)
    return data
  })
}

async function clearOut(relativeDir: string): Promise<void> {
  const target = repoPath(OUT_DIR, relativeDir)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
}

export async function main(): Promise<number> {
  assertModules()
  const [cases, flows] = await Promise.all([readCases(), readFlows()])
  const built = buildExports({ cases, flows, meta: exportMeta(codeCommitInfo()) })
  await clearOut('cases')
  await clearOut('flows')
  for (const file of built.files) writeFileAtomic(repoPath(OUT_DIR, file.file), file.text)
  writeFileAtomic(repoPath(OUT_DIR, 'index.json'), built.indexText)
  const first = cases[0]
  console.log(
    `已导出 ${cases.length} 个案例、${flows.length} 个流程到 ${OUT_DIR}；` +
      `配置版本 ${DEMO_CFG_1.configVersion ?? '（未给出）'}；` +
      `首个案例计划状态 ${built.entries[0]?.checkpoints[0]?.plan_state ?? '—'}` +
      (first === undefined ? '' : `（${first.meta.case_id}）`),
  )
  const names = await readdir(repoPath(OUT_DIR, 'cases'))
  if (names.length !== cases.length) throw new Error(`book/data/cases 写入 ${names.length} 个文件，应为 ${cases.length} 个`)
  return 0
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
