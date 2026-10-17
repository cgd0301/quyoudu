/**
 * pnpm doc:lint
 *
 * 检查项目书与交付文档：必需文件与章节、标题结构、数据占位符、断链、代码路径、
 * 禁用词、八条“表述不混淆”检查、金额可追溯性、图表数量。
 *
 * 只做能由脚本可靠判断的检查；语义判断（叙事是否成立、论证是否充分）不在脚本内假装通过，
 * 一律列进 review 待人工审查。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalWire } from './lib/canonical.ts'
import { CHAPTERS, DATA_DIR, FIGURES_DIR, OVERVIEW_LIMIT, PRODUCT_ADVICE_LIMIT, chapterPath } from './lib/book.ts'
import { findBannedNames } from './lib/banned.ts'
import { parseCsv } from './lib/csv.ts'
import { REPORT_DIR, readText, readTextIfExists, repoPath, writeFileAtomic } from './lib/repo.ts'
import { checkData } from './lib/placeholder.ts'

export type DocCheck = { id: string; passed: boolean; message: string }

export type DocLintOutput = {
  checks: DocCheck[]
  review: string[]
  figures: number
  chapters: number
}

const LOCAL_LINK = /!?\[[^\]]*\]\(([^)\s]+)\)/g
const REPO_PATH = /^((?:src|scripts|tests|fixtures|docs|book)\/[^\s`）,。；：]+)$/

function listFigures(): string[] {
  const dir = repoPath(FIGURES_DIR)
  if (!existsSync(dir)) return []
  const out: string[] = []
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      if (statSync(full).isDirectory()) visit(full)
      else if (/\.(svg|png)$/.test(name)) out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  visit(dir)
  return out.sort()
}

function headingOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.trim())
}

function checkHeadings(file: string, text: string, expectedTitle: string): string[] {
  const problems: string[] = []
  const headings = headingOf(text)
  const h1 = headings.filter((line) => line.startsWith('# '))
  if (h1.length !== 1) problems.push(`${file}：一级标题应恰好 1 个，实际 ${h1.length} 个`)
  const title = h1[0]?.replace(/^#\s+/, '').trim()
  if (title !== undefined && !title.includes(expectedTitle)) problems.push(`${file}：一级标题“${title}”与章节标题“${expectedTitle}”不符`)
  let previous = 0
  for (const line of headings) {
    const level = (line.match(/^#+/)?.[0] ?? '').length
    if (previous !== 0 && level > previous + 1) problems.push(`${file}：标题层级跳跃（${previous} → ${level}）：${line}`)
    previous = level
  }
  const fences = text.split(/\r?\n/).filter((line) => line.trimStart().startsWith('```')).length
  if (fences % 2 !== 0) problems.push(`${file}：代码块围栏没有成对闭合`)
  return problems
}

function checkLinks(file: string, text: string): string[] {
  const problems: string[] = []
  for (const match of text.matchAll(LOCAL_LINK)) {
    const target = match[1] ?? ''
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue
    const clean = target.split('#')[0] ?? ''
    if (clean === '') continue
    const candidates = [repoPath(clean), repoPath('book', clean), path.join(path.dirname(repoPath(chapterPath(file))), clean)]
    if (!candidates.some((candidate) => existsSync(candidate))) problems.push(`${file}：断开的本地引用 ${target}`)
  }
  return problems
}

function checkCodePaths(file: string, text: string): string[] {
  const problems: string[] = []
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const candidate = (match[1] ?? '').trim()
    if (!REPO_PATH.test(candidate)) continue
    // 通配符、尖括号占位、省略号与目录形式是在描述命名规则，不是具体文件
    if (/[*<>{}…]/.test(candidate) || candidate.endsWith('/')) continue
    // book/build 是可重建的构建产物（.gitignore 忽略），只要求目录存在
    if (candidate.startsWith('book/build/')) {
      if (!existsSync(repoPath('book/build'))) problems.push(`${file}：引用了不存在的构建目录 book/build`)
      continue
    }
    const clean = candidate.replace(/[:#].*$/, '')
    if (!existsSync(repoPath(clean))) problems.push(`${file}：引用了不存在的路径 ${candidate}`)
  }
  return problems
}

/** 八条表述检查：每条给出可复现的触发片段，避免“看起来不对”却没依据 */
const STATEMENT_RULES: { id: string; pattern: RegExp; message: string }[] = [
  {
    id: 'T014-01',
    pattern: /模拟(案例|数据)[^。！？\n]{0,24}(?<![不非])(证明|表明|说明)(了)?[^。！？\n]{0,8}(需求|用户)/,
    message: '把模拟案例或模拟数据当成需求／用户证据',
  },
  {
    id: 'T014-02',
    pattern: /(已经完成|已完成|已开展)[^。！？\n]{0,12}(访谈|问卷|调研)|受访者\s*\d+\s*人/,
    message: '把访谈计划写成已经完成',
  },
  {
    id: 'T014-03',
    pattern: /测试(通过|全部通过)[^。！？\n]{0,16}(证明|说明|表明)[^。！？\n]{0,10}需求|需求已(得到)?验证(成立)?/,
    message: '把技术测试通过当成需求成立',
  },
  {
    id: 'T014-04',
    pattern: /回测(结果)?[^。！？\n]{0,16}(?<![不非])(证明|说明|表明)[^。！？\n]{0,12}(真实|实际)[^。！？\n]{0,8}(效果|预测|收益)/,
    message: '把虚拟回测当成真实预测效果',
  },
  {
    id: 'T014-05',
    pattern: /规则已确认[^。！？\n]{0,8}(即|就是|等于)已实现|规则确认[^。！？\n]{0,8}(等于|即)实现/,
    message: '把规则确认等同于实现',
  },
  {
    id: 'T014-06',
    pattern: /DEMO-CFG-1[^。！？\n]{0,16}(已)?(成为|作为|是)[^。！？\n]{0,8}(最终|已批准|批准)[^。！？\n]{0,8}默认/,
    message: '把演示配置写成已批准的最终默认',
  },
  {
    id: 'T014-08',
    pattern: /问卷[^。！？\n]{0,30}(已回收|完成\d+份|样本\d+份)/,
    message: '把可选问卷写成已完成的调研',
  },
]

export function checkStatements(files: { file: string; text: string }[]): DocCheck[] {
  const hits = new Map<string, string[]>()
  for (const { file, text } of files) {
    for (const rule of STATEMENT_RULES) {
      const match = rule.pattern.exec(text)
      if (match === null) continue
      const list = hits.get(rule.id) ?? []
      list.push(`${file}：${match[0].trim()}`)
      hits.set(rule.id, list)
    }
  }
  return STATEMENT_RULES.map((rule) => {
    const list = hits.get(rule.id) ?? []
    return {
      id: rule.id,
      passed: list.length === 0,
      message: list.length === 0 ? `${rule.message}：未发现` : `${rule.message}：${list.join('；')}`,
    }
  })
}

/** 功能状态与测试运行记录一致：写了“测试通过”的规则，追溯表里该规则的子行必须都标为通过 */
function checkStatusConsistency(files: { file: string; text: string }[]): DocCheck {
  const csv = readTextIfExists(repoPath('docs/traceability.csv'))
  if (csv === null) return { id: 'T014-07', passed: false, message: '缺少 docs/traceability.csv，无法核对功能状态' }
  const passedRules = new Set<string>()
  const seenRules = new Set<string>()
  for (const row of parseCsv(csv)) {
    const rule = row[0] ?? ''
    const status = row[row.length - 1] ?? ''
    if (!/^R\d{3}$/.test(rule)) continue
    seenRules.add(rule)
    if (status.startsWith('通过')) passedRules.add(rule)
  }
  const problems: string[] = []
  for (const { file, text } of files) {
    for (const match of text.matchAll(/(R\d{3})[^\n]{0,24}测试通过/g)) {
      const rule = match[1] ?? ''
      if (!seenRules.has(rule)) problems.push(`${file}：声称 ${rule} 测试通过，但追溯表中没有该规则`)
      else if (!passedRules.has(rule)) problems.push(`${file}：声称 ${rule} 测试通过，但追溯表中该规则仍有子行未通过`)
    }
  }
  return {
    id: 'T014-07',
    passed: problems.length === 0,
    message: problems.length === 0 ? '功能状态与追溯表一致：未发现夸大（按上一次 trace:update 的状态）' : problems.join('；'),
  }
}

/** 金额可追溯：X.YY 元 的金额须能在 book/data 的导出结果或 rules.md 原文中找到依据 */
export function checkAmounts(files: { file: string; text: string }[]): DocCheck {
  const dataText = collectDataText()
  const rulesText = readTextIfExists(repoPath('docs/rules.md')) ?? ''
  const problems: string[] = []
  for (const { file, text } of files) {
    for (const match of text.matchAll(/(\d{1,9}\.\d{2})\s*元/g)) {
      const literal = match[1] ?? ''
      const cents = Math.round(Number(literal) * 100)
      const inRules = rulesText.includes(literal)
      const inData = dataText.includes(cents.toString())
      if (!inRules && !inData) problems.push(`${file}：${match[0].trim()} 在导出数据与规则原文中都找不到依据`)
    }
  }
  return {
    id: 'NUM',
    passed: problems.length === 0,
    message: problems.length === 0 ? '金额均可追溯到导出结果或规则原文' : problems.slice(0, 8).join('；'),
  }
}

function collectDataText(): string {
  const dir = repoPath(DATA_DIR)
  if (!existsSync(dir)) return ''
  const parts: string[] = []
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      if (statSync(full).isDirectory()) visit(full)
      else if (name.endsWith('.json')) parts.push(readText(full))
    }
  }
  visit(dir)
  return parts.join('\n')
}

export function runDocLint(): DocLintOutput {
  const checks: DocCheck[] = []
  const review: string[] = []
  const problems: Record<string, string[]> = {
    FILES: [],
    HEADINGS: [],
    PLACEHOLDER: [],
    LINKS: [],
    CODEPATHS: [],
    BANNED: [],
    FIGURES: [],
  }

  for (const relative of ['book/meta.yml', `${DATA_DIR}/index.json`]) {
    if (!existsSync(repoPath(relative))) problems.FILES?.push(`缺少必需文件 ${relative}`)
  }

  const files: { file: string; text: string }[] = []
  for (const chapter of CHAPTERS) {
    const file = chapterPath(chapter.file)
    const text = readTextIfExists(repoPath(file))
    if (text === null) {
      problems.FILES?.push(`缺少章节文件 ${file}（${chapter.title}）`)
      continue
    }
    files.push({ file: chapter.file, text })
    problems.HEADINGS?.push(...checkHeadings(chapter.file, text, chapter.title))
    const placeholderErrors = checkData(text)
    problems.PLACEHOLDER?.push(...placeholderErrors.map((error) => `${chapter.file}：${error}`))
    problems.LINKS?.push(...checkLinks(chapter.file, text))
    problems.CODEPATHS?.push(...checkCodePaths(chapter.file, text))
    const banned = findBannedNames(text)
    if (banned.length > 0) problems.BANNED?.push(`${chapter.file}：出现真实平台名称 ${banned.join('、')}`)
    if (/<!--\s*data:/.test(text) === false && chapter.kind === 'body') {
      review.push(`${chapter.file} 没有任何数据占位符：确认正文数字是否都来自导出结果`)
    }
  }

  const figures = listFigures()
  if (figures.length < 15) problems.FIGURES?.push(`图表只有 ${figures.length} 张，比赛建议不少于 15 张（docs/sources.md）`)
  for (const name of figures) {
    const referenced = files.some(({ text }) => text.includes(name))
    if (!referenced) review.push(`图表 ${name} 没有被任何章节引用`)
  }

  const overview = files.find((item) => item.file === '00_overview.md')
  if (overview !== undefined) {
    const chars = countChars(overview.text)
    if (chars.wordLike > OVERVIEW_LIMIT) checks.push({ id: 'LEN-OVERVIEW', passed: false, message: `作品概述 ${chars.wordLike} 字，超过 ${OVERVIEW_LIMIT} 字上限` })
  }
  const advice = files.find((item) => item.file === '90_product_advice.md')
  if (advice !== undefined) {
    const chars = countChars(advice.text)
    if (chars.wordLike > PRODUCT_ADVICE_LIMIT) {
      checks.push({ id: 'LEN-ADVICE', passed: false, message: `产品建议 ${chars.wordLike} 字，超过 ${PRODUCT_ADVICE_LIMIT} 字上限` })
    }
  }

  for (const [id, list] of Object.entries(problems)) {
    checks.push({ id, passed: list.length === 0, message: list.length === 0 ? '未发现问题' : list.slice(0, 10).join('；') })
  }
  checks.push(...checkStatements(files))
  checks.push(checkStatusConsistency(files))
  checks.push(checkAmounts(files))

  review.push('叙事与论证是否成立、价值假设是否充分，脚本无法判断，需人工审查')
  review.push('图表与正文结论是否一致，需人工抽查')
  return { checks, review, figures: figures.length, chapters: files.length }
}

/** 字数口径：wordLike 按中文习惯（一个汉字一个“字”，英文与数字按词），chars 为非空白字符数 */
export function countChars(text: string): { wordLike: number; chars: number; lines: number } {
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>|-]/g, ' ')
  const han = plain.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const latinWords = plain.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:[.'-][A-Za-z0-9]+)*/g)?.length ?? 0
  const chars = plain.replace(/\s/g, '').length
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '').length
  return { wordLike: han + latinWords, chars, lines }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  const output = runDocLint()
  writeFileAtomic(
    path.join(REPORT_DIR, 'doc-lint.json'),
    canonicalWire({ checks: output.checks, review: output.review, figures: output.figures, chapters: output.chapters }),
  )
  const failed = output.checks.filter((check) => !check.passed)
  for (const check of output.checks) console.log(`${check.passed ? '通过' : '未通过'} ${check.id}：${check.message}`)
  console.log(`章节 ${output.chapters} 个，图表 ${output.figures} 张，待人工审查 ${output.review.length} 项`)
  for (const item of output.review) console.log(`待审查：${item}`)
  process.exitCode = failed.length === 0 ? 0 : 1
}
