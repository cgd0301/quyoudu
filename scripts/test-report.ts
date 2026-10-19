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

/** suites 为 vitest 的 suite 数（含文件内的 describe 分组）；files 为实际测试文件数。两者不是一回事。 */
export type UnitSummary = { suites: number; files: number; tests: number; passed: number; failed: number; skipped: number }
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

/**
 * A4 预检记录的机器可读形态。
 *
 * 根因说明：早先这里用 `/- 断言通过数：(\S+)/` 从报告正文里截取整段文字，`\S` 遇到空格就停，
 * 于是 "1004／1004（跳过 0）" 被写成 "1004／1004（跳过"。现在只从正文取整数，展示串由整数拼出，
 * 结构上不可能再被截断；正文缺失或格式不符时返回 null（记为“未取得”），不返回半截值。
 */
export type PrecheckRecord = {
  source: string
  vectors_passed: number
  vectors_total: number
  assertions_passed: number
  assertions_total: number
  assertions_skipped: number
  run_errors: number
  unit_exit: number | null
}

export type PrecheckDisplay = { vectors: string; assertions: string; run_errors: string; unit_exit: string }

const PRECHECK_REPORT = 'docs/_work/precheck_report.md'

/** 只从 A4 预检报告正文取整数；每项都要求整行匹配，取不到就整体返回 null */
export function parsePrecheckReport(text: string): PrecheckRecord | null {
  const head = /^- 向量通过数：(\d+)／(\d+)\r?$/m.exec(text)
  const use = /^- 断言通过数：(\d+)／(\d+)(?:（跳过 (\d+)(?: 条)?）)?\r?$/m.exec(text)
  const errors = /^- 运行错误数：(\d+)\r?$/m.exec(text)
  const exit = /^- 退出码：(-?\d+)\r?$/m.exec(text)
  if (head === null || use === null || errors === null) return null
  return {
    source: PRECHECK_REPORT,
    vectors_passed: Number(head[1]),
    vectors_total: Number(head[2]),
    assertions_passed: Number(use[1]),
    assertions_total: Number(use[2]),
    assertions_skipped: Number(use[3] ?? 0),
    run_errors: Number(errors[1]),
    unit_exit: exit === null ? null : Number(exit[1]),
  }
}

/** 展示串只由上面的整数拼出，因此与数值永远一致 */
export function precheckDisplay(record: PrecheckRecord): PrecheckDisplay {
  return {
    vectors: `${record.vectors_passed}／${record.vectors_total}`,
    assertions: `${record.assertions_passed}／${record.assertions_total}（跳过 ${record.assertions_skipped} 条）`,
    run_errors: String(record.run_errors),
    unit_exit: record.unit_exit === null ? '未给出' : String(record.unit_exit),
  }
}

/** 预检记录与本轮向量运行必须一致；不一致说明记录已过期，不能拿它当本轮结果 */
export function precheckMismatches(record: PrecheckRecord, vec: VecReportSummary): string[] {
  const pairs: [string, number, number][] = [
    ['向量通过数', record.vectors_passed, vec.vectors_passed],
    ['向量总数', record.vectors_total, vec.vectors_total],
    ['断言通过数', record.assertions_passed, vec.assertions_passed],
    ['断言总数', record.assertions_total, vec.assertions_total],
    ['断言跳过数', record.assertions_skipped, vec.assertions_skipped],
    ['运行错误数', record.run_errors, vec.run_errors],
  ]
  return pairs.filter(([, recorded, live]) => recorded !== live).map(([name, recorded, live]) => `${name}：记录 ${recorded}，本轮 ${live}`)
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
    // DOC 层的子用例由 doc:lint 的检查本身实现，因此文档检查通过也算实现证据；
    // 否则 R014（阶段门槛与证据表述）会出现“测试通过=是、已实现=否”的自相矛盾
    if (evidence !== undefined && (evidence.vector === 'pass' || evidence.unit === 'pass' || evidence.e2e === 'pass' || evidence.doc === 'pass')) {
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
  precheck: PrecheckRecord | null
  commit: { hash: string; time: string }
}

/**
 * 端到端还剩什么没做到：已通过时仍要说明“spec 数不等于 UI 子用例逐条覆盖”，
 * 未运行时如实写未执行，不把已通过的端到端列成“未完成”。
 */
export function e2eRemaining(e2e: GateRun): string {
  if (e2e.status === '通过') return `端到端已运行并通过（${e2e.detail}），UI 层 21 条子用例中 13 条有对应用例、3 条仅有补充断言、5 条未覆盖，界面不计为整体通过`
  return `端到端：${e2e.detail}`
}

/** 附录正文：全部数字来自实跑结果，口径分行列出 */
export function renderAppendix(input: ReportInput): string {
  const { commit } = input
  const lines: string[] = []
  lines.push('# 附录 B　测试、追溯及覆盖矩阵', '')
  lines.push(`- 生成方式：\`pnpm test:report\`；代码与数据提交 \`${commit.hash}\`（${commit.time}）；配置版本 ${DEMO_CFG_1.configVersion ?? '未给出'}`)
  lines.push('- 数据性质：模拟数据。以下为技术测试结果，不代表需求成立、市场预测效果或用户效果。')
  lines.push('')
  lines.push('## B.1 分层结果（口径分开计数）', '')
  lines.push('| 口径 | 结果 | 说明 |')
  lines.push('| --- | --- | --- |')
  lines.push(`| 测试套件 | ${input.unit.suites} | vitest 的 suite 计数：含文件内的 describe 分组，不是文件数 |`)
  lines.push(`| 测试文件 | ${input.unit.files} | vitest 实际运行的测试文件数，与上一行的 suite 数不是同一口径 |`)
  lines.push(`| 单元测试用例 | 通过 ${input.unit.passed}／失败 ${input.unit.failed}／跳过 ${input.unit.skipped}／注册 ${input.unit.tests} | 注册数含跳过的用例 |`)
  lines.push(
    `| 测试向量 | 通过 ${input.vec.vectors_passed}／${input.vec.vectors_total} | 一个向量含多条断言，不等于单元测试数 |`,
  )
  lines.push(
    `| 向量断言 | 通过 ${input.vec.assertions_passed}／失败 ${input.vec.assertions_total - input.vec.assertions_passed - input.vec.assertions_skipped}／跳过 ${input.vec.assertions_skipped} | 运行错误 ${input.vec.run_errors} |`,
  )
  const precheck = input.precheck === null ? null : precheckDisplay(input.precheck)
  lines.push(
    precheck === null
      ? '| 向量预检记录（A4） | 未取得 | 没有可读的 A4 预检报告，不能视为通过 |'
      : `| 向量预检记录（A4） | 向量 ${precheck.vectors}；断言 ${precheck.assertions} | 来源 ${input.precheck?.source ?? ''}，与本轮向量运行逐项一致 |`,
  )
  lines.push(`| Golden 冻结 | ${input.golden.status} | 退出码 ${input.golden.exit_code} |`)
  lines.push(`| 案例与向量结构校验（validate:cases） | ${input.cases.status} | 退出码 ${input.cases.exit_code} |`)
  lines.push(`| 规格自洽（spec:lint） | ${input.specLint.status} | 警告 ${input.specLint.warnings} 条${input.specLint.warnings > 0 ? '（待团队复核的 AI 暂定条目）' : '，无待复核条目'} |`)
  lines.push(
    `| 参考实现对拍 | ${input.oracleDiff === null ? '未取得报告' : `差异 ${input.oracleDiff.differences}（P1 ${input.oracleDiff.p1}，P2 ${input.oracleDiff.p2}，P3 ${input.oracleDiff.p3}）`} | 只读 docs/_work/diff_report.md，不在本脚本内运行 |`,
  )
  lines.push(`| 文档检查（doc:lint） | ${input.docLint.status} | ${input.docLint.detail} |`)
  lines.push(`| 端到端（Playwright） | ${input.e2e.status} | ${input.e2e.detail} |`)
  lines.push(
    `| 自然语言层（NL 子用例） | ${input.nlLayer.covered}／${input.nlLayer.total} 已执行且通过 | 由单元测试覆盖，不是端到端 |`,
  )
  lines.push('')
  lines.push('## B.2 按规则编号的追溯结果', '')
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
  lines.push('## B.3 功能实现状态表', '')
  lines.push('按“规则已确认／已实现／测试通过／真实用户验证”四级标注；真实用户验证一栏为“未做规则级验证”：30 位受访者（n=30）的问卷只支持样本内需求与功能偏好，未验证任何单条规则的实际效果（见 `docs/_work/survey/findings.md`）。')
  lines.push('')
  lines.push('| 规则 | 规则已确认 | 已实现 | 测试通过 | 真实用户验证 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const row of input.rules) {
    lines.push(`| ${row.rule} | 是 | ${row.implemented ? '是' : '否'} | ${row.tested ? '是' : '否'} | 未做规则级验证 |`)
  }
  lines.push('')
  lines.push('## B.4 未完成的检查及原因', '')
  lines.push(`- ${e2eRemaining(input.e2e)}`)
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
    testResults?: unknown[]
  }
  const summary: UnitSummary = {
    suites: data.numTotalTestSuites ?? 0,
    files: data.testResults?.length ?? 0,
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
  const precheck = parsePrecheckReport(readTextIfExists(repoPath(PRECHECK_REPORT)) ?? '')
  // 预检记录是历史产物；与本轮向量运行不一致说明它已过期，不能当作本轮结果
  const mismatch = precheck === null ? [] : precheckMismatches(precheck, vec)
  if (mismatch.length > 0) {
    throw new Error(
      `${PRECHECK_REPORT} 与本轮向量运行不一致（${mismatch.join('；')}）。该报告已过期，` +
        '请先在有 A4 预检产物的环境重跑 pnpm vec:precheck；不要用旧记录冒充本轮结果。',
    )
  }
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
          ? '未执行：本轮没有运行 Playwright（pnpm test:e2e 需要已安装的浏览器）'
          : `通过 ${index.playwright.passed}／失败 ${index.playwright.failed}／跳过 ${index.playwright.skipped}；按 spec 计数，UI 层 21 条子用例中 13 条有对应用例、3 条仅有补充断言、5 条未覆盖`,
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
    precheck,
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
    unit: { suites: unit.suites, files: unit.files, tests: unit.tests, passed: unit.passed, failed: unit.failed, skipped: unit.skipped },
    vectors: vec,
    golden: { status: input.golden.status, exit_code: input.golden.exit_code },
    cases: { status: input.cases.status, exit_code: input.cases.exit_code },
    spec_lint: { status: input.specLint.status, exit_code: input.specLint.exit_code, warnings: input.specLint.warnings },
    oracle_diff: input.oracleDiff,
    // 数值保持数值；display 由数值生成，不从正文截取
    precheck: precheck === null ? null : { ...precheck, display: precheckDisplay(precheck) },
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
      real_user_validation: '未做规则级验证',
    })),
    unfinished: [
      e2eRemaining(input.e2e),
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
