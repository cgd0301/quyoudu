/**
 * pnpm test:report
 *
 * 汇总本轮真实运行结果，生成：
 * - book/chapters/91_appendix_test_report.md（项目书附录）
 * - book/data/status.json（项目书引用的计数）
 * - .cache/report/vitest.json、vec.json（其余脚本的证据来源）
 *
 * 原则：不为任何未运行的检查报“通过”；不同口径分开计数，不把向量数、断言数、
 * 单元测试注册数、端到端用例数混成一个数。时间只取提交时间，不读系统时钟。
 */
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { canonicalWire } from './lib/canonical.ts'
import { buildEvidenceIndex, type EvidenceIndex } from './lib/results.ts'
import { REPORT_DIR, REPO_ROOT, codeCommitInfo, readTextIfExists, repoPath, writeFileAtomic } from './lib/repo.ts'
import { runTsx, runVitest } from './lib/run.ts'
import { computeVerdicts, readTraceability } from './lib/trace.ts'
import { parseVecArgs, runEntries } from './vec.ts'
import { DEMO_CFG_1 } from '../src/engine/config.ts'

const APPENDIX_PATH = 'book/chapters/91_appendix_test_report.md'
const STATUS_PATH = 'book/data/status.json'

type GateRun = { status: string; exit_code: number; detail: string }

export type UnitSummary = { files: number; tests: number; passed: number; failed: number; skipped: number }
export type VecReportSummary = {
  vectors_passed: number
  vectors_total: number
  assertions_passed: number
  assertions_total: number
  assertions_skipped: number
  run_errors: number
}

export type OracleDiff = { cases: number; vectors: number; checkpoints_ts: number; checkpoints_oracle: number; differences: number; p1: number; p2: number; p3: number; run_failures: number } | null

function parseDiffReport(text: string | null): OracleDiff {
  if (text === null) return null
  const head = /案例 (\d+)，向量 (\d+)，检查点 TS (\d+) \/ oracle (\d+)/.exec(text)
  const diff = /差异 合计 (\d+)（P1 (\d+)，P2 (\d+)，P3 (\d+)）/.exec(text)
  const failed = /运行失败 (\d+)/.exec(text)
  if (head === null || diff === null) return null
  return {
    cases: Number(head[1]),
    vectors: Number(head[2]),
    checkpoints_ts: Number(head[3]),
    checkpoints_oracle: Number(head[4]),
    differences: Number(diff[1]),
    p1: Number(diff[2]),
    p2: Number(diff[3]),
    p3: Number(diff[4]),
    run_failures: Number(failed?.[1] ?? 0),
  }
}

function parsePrecheckSection(text: string | null): { vectors: string; assertions: string; run_errors: string; unit_exit: string } | null {
  if (text === null) return null
  const vectors = /- 向量通过数：(\S+)/.exec(text)?.[1]
  const assertions = /- 断言通过数：(\S+)/.exec(text)?.[1]
  const runErrors = /- 运行错误数：(\S+)/.exec(text)?.[1]
  const unitExit = /- 退出码：(\S+)/.exec(text)?.[1]
  if (vectors === undefined || assertions === undefined || runErrors === undefined) return null
  return { vectors, assertions, run_errors: runErrors, unit_exit: unitExit ?? '未给出' }
}

export type RuleRow = {
  rule: string
  children: number
  pass: number
  partial: number
  failed: number
  pending: number
  implemented: boolean
  tested: boolean
}

function ruleRows(table: ReturnType<typeof readTraceability>, index: EvidenceIndex, verdicts: ReturnType<typeof computeVerdicts>): RuleRow[] {
  const rows = new Map<string, RuleRow>()
  for (const row of table.rows) {
    if (!/^T\d{3}-\d{2}$/.test(row.testId)) continue
    const verdict = verdicts.sub.get(row.testId)
    if (verdict === undefined) continue
    const current = rows.get(row.ruleId) ?? {
      rule: row.ruleId,
      children: 0,
      pass: 0,
      partial: 0,
      failed: 0,
      pending: 0,
      implemented: false,
      tested: false,
    }
    current.children += 1
    current[verdict.status] += 1
    const evidence = index.ids.get(row.testId)
    if (evidence !== undefined && (evidence.vector === 'pass' || evidence.unit === 'pass' || evidence.e2e === 'pass')) {
      current.implemented = true
    }
    rows.set(row.ruleId, current)
  }
  for (const row of rows.values()) row.tested = row.children > 0 && row.pass === row.children
  return [...rows.values()].sort((left, right) => left.rule.localeCompare(right.rule))
}

export type ReportInput = {
  unit: UnitSummary
  vec: VecReportSummary
  golden: GateRun
  cases: GateRun
  specLint: GateRun & { warnings: number }
  rules: RuleRow[]
  traceCounts: { pass: number; partial: number; failed: number; pending: number }
  traceRows: number
  nlLayer: { covered: number; total: number }
  e2e: GateRun
  docLint: GateRun
  oracleDiff: OracleDiff
  precheck: ReturnType<typeof parsePrecheckSection>
  commit: { hash: string; time: string }
}

/** 附录正文：全部数字来自实跑结果，口径分行列出 */
export function renderAppendix(input: ReportInput): string {
  const { commit } = input
  const lines: string[] = []
  lines.push('# 附录A 测试与验证记录', '')
  lines.push(`- 生成方式：\`pnpm test:report\`；代码与数据提交 \`${commit.hash}\`（${commit.time}）；配置版本 ${DEMO_CFG_1.configVersion ?? '未给出'}`)
  lines.push('- 数据性质：模拟数据。以下为技术测试结果，不代表需求成立、市场预测效果或用户效果。')
  lines.push('')
  lines.push('## A.1 分层结果（口径分开计数）', '')
  lines.push('| 口径 | 结果 | 说明 |')
  lines.push('| --- | --- | --- |')
  lines.push(`| 测试套件 | ${input.unit.files} | vitest 的 suite 计数（含文件内的 describe 分组），不是文件数 |`)
  lines.push(`| 单元测试用例 | 通过 ${input.unit.passed}／失败 ${input.unit.failed}／跳过 ${input.unit.skipped}／注册 ${input.unit.tests} | 注册数含跳过的用例 |`)
  lines.push(
    `| 测试向量 | 通过 ${input.vec.vectors_passed}／${input.vec.vectors_total} | 一个向量含多条断言，不等于单元测试数 |`,
  )
  lines.push(
    `| 向量断言 | 通过 ${input.vec.assertions_passed}／失败 ${input.vec.assertions_total - input.vec.assertions_passed - input.vec.assertions_skipped}／跳过 ${input.vec.assertions_skipped} | 运行错误 ${input.vec.run_errors} |`,
  )
  lines.push(`| Golden 冻结 | ${input.golden.status} | 退出码 ${input.golden.exit_code} |`)
  lines.push(`| 案例与向量结构校验（validate:cases） | ${input.cases.status} | 退出码 ${input.cases.exit_code} |`)
  lines.push(`| 规格自洽（spec:lint） | ${input.specLint.status} | 警告 ${input.specLint.warnings} 条（AI暂定条目待团队复核） |`)
  lines.push(
    `| 参考实现对拍 | ${input.oracleDiff === null ? '未取得报告' : `差异 ${input.oracleDiff.differences}（P1 ${input.oracleDiff.p1}，P2 ${input.oracleDiff.p2}，P3 ${input.oracleDiff.p3}）`} | 只读 docs/_work/diff_report.md，不在本脚本内运行 |`,
  )
  lines.push(`| 文档检查（doc:lint） | ${input.docLint.status} | ${input.docLint.detail} |`)
  lines.push(`| 端到端（Playwright） | ${input.e2e.status} | ${input.e2e.detail} |`)
  lines.push(
    `| 自然语言层（NL 子用例） | ${input.nlLayer.covered}／${input.nlLayer.total} 已执行且通过 | 由单元测试覆盖，不是端到端 |`,
  )
  lines.push('')
  lines.push('## A.2 按规则编号的追溯结果', '')
  lines.push('| 规则 | 子用例 | 通过 | 部分覆盖 | 未通过 | 未执行 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const row of input.rules) {
    lines.push(`| ${row.rule} | ${row.children} | ${row.pass} | ${row.partial} | ${row.failed} | ${row.pending} |`)
  }
  lines.push('')
  lines.push(
    `追溯表共 ${input.traceRows} 条数据行：通过 ${input.traceCounts.pass}、部分覆盖 ${input.traceCounts.partial}、已执行未通过 ${input.traceCounts.failed}、待执行 ${input.traceCounts.pending}（含父行）。`,
  )
  lines.push('')
  lines.push('## A.3 功能实现状态表', '')
  lines.push('按“规则已确认／已实现／测试通过／真实用户验证”四级标注；真实用户验证一律为“未开展”（政策卡第九节：本阶段不做需求调研）。')
  lines.push('')
  lines.push('| 规则 | 规则已确认 | 已实现 | 测试通过 | 真实用户验证 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of input.rules) {
    lines.push(`| ${row.rule} | 是 | ${row.implemented ? '是' : '否'} | ${row.tested ? '是' : '否'} | 未开展 |`)
  }
  lines.push('')
  lines.push('## A.4 未完成的检查及原因', '')
  lines.push(`- 端到端：${input.e2e.detail}`)
  if (input.docLint.status !== '通过') lines.push(`- 文档检查：${input.docLint.detail}`)
  lines.push(`- 案例与向量结构校验：${input.cases.status}`)
  lines.push(`- 单元测试跳过 ${input.unit.skipped} 条、向量断言跳过 ${input.vec.assertions_skipped} 条，均已在对应文件中登记原因。`)
  if (input.oracleDiff === null) lines.push('- 参考实现对拍：本轮没有可读的对拍报告，不能视为通过。')
  lines.push('')
  return lines.join('\n')
}

function gate(status: number, label: string, detail: string): GateRun {
  return { status: status === 0 ? '通过' : '未通过', exit_code: status, detail: label === '' ? detail : `${label}；${detail}` }
}

async function collectUnit(): Promise<UnitSummary> {
  await mkdir(REPORT_DIR, { recursive: true })
  const outputFile = path.join(REPORT_DIR, 'vitest.json')
  const result = runVitest(['run', '--reporter=json', '--outputFile', outputFile])
  const text = readTextIfExists(outputFile)
  if (text === null) throw new Error(`vitest 没有生成 ${outputFile}；退出码 ${result.status}\n${result.stderr.slice(0, 800)}`)
  const data = JSON.parse(text) as {
    numTotalTestSuites?: number
    numTotalTests?: number
    numPassedTests?: number
    numFailedTests?: number
    numPendingTests?: number
  }
  const summary: UnitSummary = {
    files: data.numTotalTestSuites ?? 0,
    tests: data.numTotalTests ?? 0,
    passed: data.numPassedTests ?? 0,
    failed: data.numFailedTests ?? 0,
    skipped: data.numPendingTests ?? 0,
  }
  if (summary.failed > 0) throw new Error(`单元测试有 ${summary.failed} 条失败，先修复再生成报告`)
  return summary
}

async function collectVectors(): Promise<VecReportSummary> {
  const output = await runEntries(parseVecArgs(['--all']), REPO_ROOT)
  await mkdir(REPORT_DIR, { recursive: true })
  writeFileAtomic(path.join(REPORT_DIR, 'vec.json'), output.jsonText)
  const parsed = JSON.parse(output.jsonText) as { summary: { vectorsPassed: number; vectorsTotal: number; assertionsPassed: number; assertionsTotal: number; assertionsSkipped: number; runErrors: number } }
  if (output.exitCode !== 0) {
    throw new Error(`向量未全部通过（退出码 ${output.exitCode}），先修复再生成报告：\n${output.stdout.slice(0, 1200)}`)
  }
  return {
    vectors_passed: parsed.summary.vectorsPassed,
    vectors_total: parsed.summary.vectorsTotal,
    assertions_passed: parsed.summary.assertionsPassed,
    assertions_total: parsed.summary.assertionsTotal,
    assertions_skipped: parsed.summary.assertionsSkipped,
    run_errors: parsed.summary.runErrors,
  }
}

/** spec:lint 的告警条数：AI暂定条目会打印“警告 SG-xx …”，其余警告同样计数 */
function countWarnings(stdout: string, stderr: string): number {
  return `${stdout}\n${stderr}`.split('\n').filter((line) => line.trim().startsWith('警告 ')).length
}

export async function main(): Promise<number> {
  const unit = await collectUnit()
  const vec = await collectVectors()
  const golden = runTsx('scripts/golden-check.ts')
  const cases = runTsx('scripts/validate-cases.ts')
  const specLint = runTsx('scripts/spec-lint.ts')
  const index = buildEvidenceIndex(REPORT_DIR)
  const table = readTraceability()
  const verdicts = computeVerdicts(table, index)
  const rules = ruleRows(table, index, verdicts)

  const nlIds = [...index.layers.entries()].filter(([, layers]) => layers.has('NL')).map(([id]) => id)
  const nlCovered = nlIds.filter((id) => index.ids.get(id)?.unit === 'pass').length
  const docChecks = index.doc?.checks ?? null
  const docStatus = docChecks === null ? '未执行' : docChecks.every((check) => check.passed) ? '通过' : '未通过'
  const e2eStatus = index.playwright === null ? '未执行' : index.playwright.failed > 0 ? '未通过' : '通过'

  const commit = codeCommitInfo()
  const input: ReportInput = {
    unit,
    vec,
    golden: gate(golden.status, 'golden:check', golden.stdout.trim().split('\n')[0] ?? ''),
    cases: gate(cases.status, 'validate:cases', cases.stdout.trim().split('\n').slice(-1)[0] ?? ''),
    specLint: { ...gate(specLint.status, 'spec:lint', ''), warnings: countWarnings(specLint.stdout, specLint.stderr) },
    rules,
    traceCounts: verdicts.counts,
    traceRows: table.rows.length,
    nlLayer: { covered: nlCovered, total: nlIds.length },
    e2e: {
      status: e2eStatus,
      exit_code: index.playwright === null ? -1 : 0,
      detail:
        index.playwright === null
          ? '未执行：tests/e2e 还没有业务用例，前端页面不在本轮交付范围；E2E 业务验收受前端未交付限制'
          : `通过 ${index.playwright.passed}／失败 ${index.playwright.failed}／跳过 ${index.playwright.skipped}`,
    },
    docLint: {
      status: docStatus,
      exit_code: docChecks === null ? -1 : docChecks.every((check) => check.passed) ? 0 : 1,
      detail:
        docChecks === null
          ? '本轮未执行：presubmit 在 test:report 之前运行 doc:lint，本行读取它的结果'
          : docChecks.every((check) => check.passed)
            ? `${docChecks.length} 项检查通过`
            : `${docChecks.filter((check) => !check.passed).map((check) => check.id).join('、')} 未通过`,
    },
    oracleDiff: parseDiffReport(readTextIfExists(repoPath('docs/_work/diff_report.md'))),
    precheck: parsePrecheckSection(readTextIfExists(repoPath('docs/_work/precheck_report.md'))),
    commit,
  }

  writeFileAtomic(repoPath(APPENDIX_PATH), renderAppendix(input))
  const status = {
    meta: {
      generated_by: 'pnpm test:report',
      notice: '模拟数据',
      simulated: true,
      config_version: DEMO_CFG_1.configVersion ?? '',
      commit: commit.hash,
      commit_time: commit.time,
      disclaimer: '技术测试结果，不代表需求成立或用户效果',
    },
    unit: { files: unit.files, tests: unit.tests, passed: unit.passed, failed: unit.failed, skipped: unit.skipped },
    vectors: vec,
    golden: { status: input.golden.status, exit_code: input.golden.exit_code },
    cases: { status: input.cases.status, exit_code: input.cases.exit_code },
    spec_lint: { status: input.specLint.status, exit_code: input.specLint.exit_code, warnings: input.specLint.warnings },
    oracle_diff: input.oracleDiff,
    precheck: input.precheck,
    doc_lint: { status: input.docLint.status, exit_code: input.docLint.exit_code, checks: index.doc?.checks.length ?? 0, failed: index.doc?.checks.filter((check) => !check.passed).length ?? 0 },
    e2e: { status: input.e2e.status, detail: input.e2e.detail },
    nl_layer: input.nlLayer,
    traceability: { rows: input.traceRows, ...input.traceCounts },
    rules: rules.map((row) => ({
      rule: row.rule,
      children: row.children,
      pass: row.pass,
      partial: row.partial,
      failed: row.failed,
      pending: row.pending,
      implemented: row.implemented,
      tested: row.tested,
      real_user_validation: '未开展',
    })),
    unfinished: [
      `端到端：${input.e2e.detail}`,
      ...(input.docLint.status === '通过' ? [] : [`文档检查：${input.docLint.detail}`]),
      `向量断言跳过 ${vec.assertions_skipped} 条；单元测试跳过 ${unit.skipped} 条`,
    ],
  }
  writeFileAtomic(repoPath(STATUS_PATH), canonicalWire(status))
  console.log(
    `已写入 ${APPENDIX_PATH} 与 ${STATUS_PATH}：` +
      `单元 ${unit.passed}／${unit.tests}，向量 ${vec.vectors_passed}／${vec.vectors_total}，` +
      `断言 ${vec.assertions_passed}／${vec.assertions_total}，追溯 ${verdicts.counts.pass} 通过／${verdicts.counts.partial} 部分／${verdicts.counts.failed} 未通过／${verdicts.counts.pending} 待执行`,
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
