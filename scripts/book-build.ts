/**
 * pnpm book:build [--check]
 *
 * 把 book/chapters 按 scripts/lib/book.ts 的固定顺序合成一份可提交的项目书（Markdown），
 * 构建过程中：
 * - 解析 book/meta.yml 的标题、副标题与成员；
 * - 校验章节与图表文件确实存在；
 * - 把 <!-- data: … --> 占位符替换为 book/data 的正式导出结果（任一失败即中止）；
 * - 生成目录；章内标题整体下移一级（#→##，##→###），编号章加上“第N章”；
 * - 不静默省略缺失章节；不生成任何占位图片。
 *
 * 输出先写临时文件再改名，构建失败不会留下半份成稿。--check 只比较，不写入。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import {
  BUILD_DIR,
  CHAPTERS,
  FIGURE_APPENDIX,
  FIGURES_DIR,
  chapterNumeral,
  chapterPath,
  type Chapter,
} from './lib/book.ts'
import { readTextIfExists, repoPath, writeFileAtomic } from './lib/repo.ts'
import { renderData } from './lib/placeholder.ts'

export type Meta = {
  title: string
  subtitle: string
  team_name: string
  school: string
  date: string
  members: { name: string; role: string }[]
}

/** 只解析 book/meta.yml 用到的结构；遇到不认识的写法直接报错，不做猜测 */
export function parseMeta(text: string): Meta {
  const fields = new Map<string, string>()
  const members: { name: string; role: string }[] = []
  let current: { name?: string; role?: string } | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (line.startsWith('  - name:')) {
      if (current?.name !== undefined) members.push({ name: current.name, role: current.role ?? '' })
      current = { name: unquote(line.split(':', 2)[1] ?? '') }
      continue
    }
    if (line.startsWith('    role:') && current !== null) {
      current.role = unquote(line.split(':', 2)[1] ?? '')
      continue
    }
    const match = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (match === null) throw new Error(`book/meta.yml 有不认识的写法：${raw}`)
    fields.set(match[1] ?? '', unquote(match[2] ?? ''))
  }
  if (current?.name !== undefined) members.push({ name: current.name, role: current.role ?? '' })
  const need = (key: string): string => {
    const value = fields.get(key)
    if (value === undefined || value === '') throw new Error(`book/meta.yml 缺少 ${key}`)
    return value
  }
  return {
    title: need('title'),
    subtitle: need('subtitle'),
    team_name: need('team_name'),
    school: need('school'),
    date: need('date'),
    members,
  }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

/**
 * 章内标题整体下移一级：`#`→`##`、`##`→`###`、`###`→`####`。
 * 这样章节标题占 `##`，章内小节占 `###`，Markdown 层级与成稿结构一致。
 * 代码块围栏内的行不参与下移。
 */
export function shiftHeadings(text: string): string {
  const lines = text.split(/\r?\n/)
  let fenced = false
  return lines
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      const match = /^(#{1,5})(\s+)/.exec(line)
      if (match === null) return line
      return `#${line}`
    })
    .join('\n')
}

/** 把（已下移的）一级标题改成“第N章 标题”或原样标题，返回文本与目录行 */
export function retitleChapter(text: string, chapter: Chapter, ordinal: number | null): { text: string; toc: string } {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => line.startsWith('## '))
  if (index < 0) throw new Error(`${chapter.file}：章节缺少一级标题`)
  const label = ordinal === null ? chapter.title : `第${chapterNumeral(ordinal)}章　${chapter.title}`
  lines[index] = `## ${label}`
  return { text: lines.join('\n'), toc: label }
}

export type BuildResult = { text: string; chapters: number; placeholders: number; figures: number }

export function buildBook(): BuildResult {
  const metaText = readTextIfExists(repoPath('book/meta.yml'))
  if (metaText === null) throw new Error('缺少 book/meta.yml')
  const meta = parseMeta(metaText)

  const figuresDir = repoPath(FIGURES_DIR)
  if (!existsSync(figuresDir)) throw new Error(`缺少图表目录 ${FIGURES_DIR}，先运行 pnpm figures`)
  const figureIndex = readTextIfExists(repoPath(FIGURE_APPENDIX.source))
  if (figureIndex === null) throw new Error(`缺少 ${FIGURE_APPENDIX.source}，先运行 pnpm figures`)

  const parts: string[] = []
  const toc: string[] = []
  let placeholders = 0
  let ordinal = 0
  for (const chapter of CHAPTERS) {
    const file = chapterPath(chapter.file)
    const source = readTextIfExists(repoPath(file))
    if (source === null) throw new Error(`缺少章节文件 ${file}`)
    const rendered = renderData(source)
    placeholders += rendered.count
    ordinal += chapter.numbered === false ? 0 : 1
    const shifted = shiftHeadings(rendered.text)
    const { text, toc: label } = retitleChapter(shifted, chapter, chapter.numbered === false ? null : ordinal)
    toc.push(`- ${label}`)
    parts.push(text.trimEnd(), '')
  }

  const figureBody = figureIndex
    .trimEnd()
    .split(/\r?\n/)
    .map((line, index) => (index === 0 ? `## ${FIGURE_APPENDIX.title}` : line))
    .join('\n')
  toc.push(`- ${FIGURE_APPENDIX.title}`)
  parts.push(figureBody, '')

  const header = [
    `# ${meta.title}`,
    '',
    `> ${meta.subtitle}`,
    '',
    `队伍：${meta.team_name}｜院校：${meta.school}｜日期：${meta.date}`,
    `成员：${meta.members.map((member) => `${member.name}（${member.role}）`).join('、')}`,
    '',
    '> 数据性质：本稿所有案例、报价、优惠、历史价格与消费记录均为**模拟数据**，用于规则与技术验证，不代表真实市场价格或真实用户反馈。',
    '> 阅读顺序：主文按“问题→方案→技术→验证→市场→商业→落地”组织；规则编号、逐规则公式、测试向量明细与复现命令集中放在附录 A—F。',
    '',
    '## 目录',
    '',
    ...toc,
  ].join('\n')

  const text = `${header}\n\n${parts.join('\n')}\n`
  return { text, chapters: CHAPTERS.length, placeholders, figures: countFigures() }
}

function countFigures(): number {
  const indexText = readTextIfExists(repoPath(FIGURE_APPENDIX.source)) ?? ''
  return indexText.split('\n').filter((line) => /^\| 图 \d+ \|/.test(line)).length
}

export async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check')
  const unknown = argv.filter((arg) => arg !== '--check')
  if (unknown.length > 0) throw new Error(`未知参数 ${unknown.join(' ')}；用法：pnpm book:build [--check]`)
  const built = buildBook()
  const target = repoPath(BUILD_DIR, '趣有度_项目书.md')
  if (check) {
    const existing = readTextIfExists(target)?.replace(/\r\n/g, '\n') ?? null
    if (existing === null) {
      console.error(`缺少 ${BUILD_DIR}/趣有度_项目书.md，请先运行 pnpm book:build`)
      return 1
    }
    if (existing !== built.text) {
      console.error('book/build 的成稿与当前章节不一致，请重新运行 pnpm book:build')
      return 1
    }
    console.log(`成稿一致：${built.chapters} 节、${built.placeholders} 处数据占位符、${built.figures} 张图`)
    return 0
  }
  if (built.figures < 15) {
    console.error(`图表只有 ${built.figures} 张，比赛建议不少于 15 张（docs/sources.md）`)
    return 1
  }
  writeFileAtomic(target, built.text)
  console.log(`已生成 ${BUILD_DIR}/趣有度_项目书.md：${built.chapters} 节、${built.placeholders} 处数据占位符、${built.figures} 张图`)
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
