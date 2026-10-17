/**
 * pnpm presubmit
 *
 * 提交前门禁：按依赖顺序执行本轮应通过的全部检查，逐步核对退出码，最后给出一张汇总表。
 * - 上游失败时，依赖它的步骤标为“跳过（上游失败）”，绝不报通过；
 * - 本脚本只调用仓库自己的工具，不联网、不读 .env、不运行仅限人工的脚本（golden:write、golden:freeze、oracle:export、oracle:import）；
 * - 端到端与前端截图不在本轮交付范围，单独列为外部依赖，不计入通过。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeCommitInfo, git } from './lib/repo.ts'
import { runOxlint, runTsc, runTsx, runVitest } from './lib/run.ts'

type Step = {
  id: string
  title: string
  needs?: string[]
  run: () => { status: number; summary: string }
}

type StepResult = { id: string; title: string; status: '通过' | '未通过' | '跳过'; summary: string }

const script = (name: string, args: readonly string[] = []): (() => { status: number; summary: string }) => () => {
  const result = runTsx(`scripts/${name}`, args)
  const line = (result.stdout.trim().split('\n').filter((item) => item.trim() !== '').slice(-1)[0] ?? '').trim()
  return { status: result.status, summary: line === '' ? `退出码 ${result.status}` : line }
}

export const STEPS: readonly Step[] = [
  { id: 'typecheck', title: '类型检查（tsc --noEmit）', run: () => summarize(runTsc(['--noEmit'])) },
  { id: 'lint', title: '静态检查（oxlint）', run: () => summarize(runOxlint([])) },
  { id: 'flows', title: '演示流程与索引一致（flows --check）', run: script('make-flows.ts', ['--check']) },
  { id: 'unit', title: '单元测试（vitest run）', run: () => summarize(runVitest(['run'])) },
  { id: 'vectors', title: '测试向量（vec --all）', run: script('vec.ts', ['--all']) },
  { id: 'cases', title: '案例与向量结构（validate:cases）', run: script('validate-cases.ts') },
  { id: 'spec', title: '规格自洽（spec:lint）', run: script('spec-lint.ts') },
  { id: 'golden', title: 'Golden 冻结完整性（golden:check）', run: script('golden-check.ts') },
  { id: 'export', title: '结果导出（export:results）', run: script('export-results.ts') },
  { id: 'doclint', title: '文档检查（doc:lint）', needs: ['export'], run: script('doc-lint.ts') },
  { id: 'report', title: '测试报告与 status.json（test:report）', needs: ['unit', 'vectors', 'doclint'], run: script('test-report.ts') },
  { id: 'trace', title: '追溯状态同步（trace:update）', needs: ['report', 'doclint'], run: script('trace-update.ts') },
  { id: 'figures', title: '图表生成（figures）', needs: ['report'], run: script('figures.ts') },
  { id: 'book', title: '项目书构建（book:build）', needs: ['figures', 'doclint'], run: script('book-build.ts') },
  { id: 'chars', title: '篇幅统计（count:chars）', needs: ['figures'], run: script('count-chars.ts') },
]

function summarize(result: { status: number; stdout: string; stderr: string }): { status: number; summary: string } {
  const lines = `${result.stdout}\n${result.stderr}`.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const tail = lines.slice(-1)[0] ?? `退出码 ${result.status}`
  return { status: result.status, summary: tail }
}

export function runPresubmit(steps: readonly Step[] = STEPS): { results: StepResult[]; failed: number } {
  const results: StepResult[] = []
  const statusById = new Map<string, StepResult['status']>()
  for (const step of steps) {
    const blocked = (step.needs ?? []).filter((id) => statusById.get(id) !== '通过')
    if (blocked.length > 0) {
      const result: StepResult = { id: step.id, title: step.title, status: '跳过', summary: `上游未通过：${blocked.join('、')}` }
      results.push(result)
      statusById.set(step.id, result.status)
      continue
    }
    const outcome = step.run()
    const result: StepResult = { id: step.id, title: step.title, status: outcome.status === 0 ? '通过' : '未通过', summary: outcome.summary }
    results.push(result)
    statusById.set(step.id, result.status)
  }
  return { results, failed: results.filter((item) => item.status !== '通过').length }
}

function dirtyFiles(): string[] {
  const text = git(['status', '--porcelain'])
  return text === '' ? [] : text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

export async function main(): Promise<number> {
  const commit = codeCommitInfo()
  console.log(`presubmit｜代码提交 ${commit.hash || '（无）'}（${commit.time || '—'}）｜Node ${process.version}`)
  const { results, failed } = runPresubmit()
  console.log('')
  for (const result of results) console.log(`${result.status === '通过' ? '✓' : result.status === '跳过' ? '–' : '✗'} ${result.title}：${result.status}（${result.summary}）`)
  console.log('')
  console.log('外部依赖：端到端业务验收与项目书截图依赖尚未交付的前端页面，本轮不计入通过；tests/e2e 没有业务用例时 playwright 会直接报错，不会被当成成功。')
  const dirty = dirtyFiles()
  if (dirty.length === 0) console.log('工作区：干净')
  else {
    console.log(`工作区：有 ${dirty.length} 项未提交变更（生成产物需与本轮代码一起提交后再运行一次 presubmit 复核）`)
    for (const line of dirty.slice(0, 20)) console.log(`  ${line}`)
  }
  if (failed > 0) {
    console.error(`presubmit 有 ${failed} 项未通过`)
    return 1
  }
  console.log('presubmit 通过（不含前端与端到端外部依赖）')
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
      console.error(`presubmit 出错：${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
}
