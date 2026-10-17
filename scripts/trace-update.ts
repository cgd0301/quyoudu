/**
 * pnpm trace:update
 *
 * 用 .cache/report 下的真实运行证据更新 docs/traceability.csv 的“状态”列。
 *
 * 判定（与 docs/_work/vector_gaps.md、test_layers.md 对齐）：
 * - 通过：该子行各层的检查都已执行且通过，且 vector_gaps 条目全部“已裁决”或“已覆盖”且覆盖它的单元测试在跑；
 * - 部分覆盖：已执行的部分都通过，但仍有层未执行或有缺口未处置；
 * - 已执行未通过：任何一层失败；
 * - 待执行：没有任何一层的运行记录。
 * 父行按子行汇总。状态文本只写小写短哈希与日期，不写 SG／D／V 编号（spec:lint 会核对）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEvidenceIndex } from './lib/results.ts'
import { REPORT_DIR, codeCommitInfo, commitDate, readTextIfExists, repoPath, writeRepoFile } from './lib/repo.ts'
import { computeVerdicts, readTraceability, rewriteStatuses, statusText } from './lib/trace.ts'

const SUB_ROW = /^T\d{3}-\d{2}$/
const PARENT_ROW = /^T\d{3}$/

export type TraceResult = {
  rows: number
  written: boolean
  counts: { pass: number; partial: number; failed: number; pending: number }
}

export function updateStatuses(input: { table: ReturnType<typeof readTraceability>; index: ReturnType<typeof buildEvidenceIndex>; stamp: string }): {
  text: string
  verdicts: ReturnType<typeof computeVerdicts>
} {
  const verdicts = computeVerdicts(input.table, input.index)
  const statuses = new Map<number, string>()
  for (const row of input.table.rows) {
    const verdict = SUB_ROW.test(row.testId) ? verdicts.sub.get(row.testId) : verdicts.parent.get(row.testId)
    if (verdict === undefined) continue
    statuses.set(row.line, statusText(verdict, input.stamp))
  }
  return { text: rewriteStatuses(input.table, statuses), verdicts }
}

function checkIntegrity(table: ReturnType<typeof readTraceability>, layers: Map<string, Set<string>>): void {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const row of table.rows) {
    if (!SUB_ROW.test(row.testId) && !PARENT_ROW.test(row.testId)) {
      problems.push(`第 ${row.line} 行的测试编号不是 T001 或 T001-01 形式：${row.testId || '（空）'}`)
      continue
    }
    if (ids.has(row.testId)) problems.push(`测试编号重复：${row.testId}`)
    ids.add(row.testId)
    if (SUB_ROW.test(row.testId) && !layers.has(row.testId)) {
      problems.push(`子行 ${row.testId} 没有出现在 test_layers.md 中`)
    }
  }
  for (const id of ids) {
    if (!PARENT_ROW.test(id)) continue
    const children = [...ids].filter((child) => child.startsWith(`${id}-`))
    if (children.length === 0) problems.push(`父行 ${id} 没有子行`)
  }
  if (problems.length > 0) throw new Error(`追溯表结构不完整（${table.rows.length} 行）：\n- ${problems.join('\n- ')}`)
}

export async function main(): Promise<number> {
  const vitest = readTextIfExists(path.join(REPORT_DIR, 'vitest.json'))
  const vec = readTextIfExists(path.join(REPORT_DIR, 'vec.json'))
  if (vitest === null || vec === null) {
    throw new Error(`缺少运行证据（${vitest === null ? 'vitest.json ' : ''}${vec === null ? 'vec.json' : ''}），请先运行 pnpm test:report`)
  }
  const index = buildEvidenceIndex(REPORT_DIR)
  const table = readTraceability()
  checkIntegrity(table, index.layers)
  const commit = codeCommitInfo()
  if (commit.hash === '') throw new Error('取不到最后一次代码提交，无法写入可追溯的状态')
  const stamp = `${commit.hash}，${commitDate(commit)}`
  const { text, verdicts } = updateStatuses({ table, index, stamp })
  const original = readTextIfExists(repoPath('docs/traceability.csv')) ?? ''
  const written = text !== original
  if (written) writeRepoFile('docs/traceability.csv', text)
  console.log(
    `${written ? '已更新' : '无变化'}：${table.rows.length} 行；` +
      `通过 ${verdicts.counts.pass}、部分覆盖 ${verdicts.counts.partial}、已执行未通过 ${verdicts.counts.failed}、待执行 ${verdicts.counts.pending}；标记 ${stamp}`,
  )
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
