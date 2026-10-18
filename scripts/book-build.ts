/**
 * pnpm book:build [--check]
 *
 * 把 book/chapters 按 scripts/lib/book.ts 的固定顺序合成一份可提交的项目书（Markdown），
 * 构建过程中：
 * - 解析 book/meta.yml 的标题、副标题与成员；
 * - 校验章节与图表文件确实存在；
 * - 把 <!-- data: … --> 占位符替换为 book/data 的正式导出结果（任一失败即中止）；
 * - 生成目录，章节一级标题降为二级并连续编号；
 * - 不静默省略缺失章节；不生成任何占位图片或前端截图。
 *
 * 输出先写临时文件再改名，构建失败不会留下半份成稿。--check 只比较，不写入。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { BUILD_DIR, CHAPTERS, FIGURES_DIR, chapterPath } from './lib/book.ts'
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

/** 章节一级标题降为二级，并加上连续编号；其余标题整体下移一级以外保持不变 */
function demoteChapter(text: string, ordinal: number): string {
  const lines = text.split(/\r?\n/)
  const firstHeading = lines.findIndex((line) => line.startsWith('# '))
  if (firstHeading < 0) throw new Error('章节缺少一级标题')
  lines[firstHeading] = `## 第${ordinal}章 ${(lines[firstHeading] ?? '').replace(/^#\s+/, '').trim()}`
  return lines.join('\n')
}

export type BuildResult = { text: string; chapters: number; placeholders: number; figures: number }

export function buildBook(): BuildResult {
  const metaText = readTextIfExists(repoPath('book/meta.yml'))
  if (metaText === null) throw new Error('缺少 book/meta.yml')
  const meta = parseMeta(metaText)

  const figuresDir = repoPath(FIGURES_DIR)
  if (!existsSync(figuresDir)) throw new Error(`缺少图表目录 ${FIGURES_DIR}，先运行 pnpm figures`)
  const figureIndex = readTextIfExists(repoPath(FIGURES_DIR, 'index.md'))
  if (figureIndex === null) throw new Error(`缺少 ${FIGURES_DIR}/index.md，先运行 pnpm figures`)

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
    ordinal += 1
    const demoted = demoteChapter(rendered.text, ordinal)
    const titleLine = demoted.split(/\r?\n/).find((line) => line.startsWith('## ')) ?? `## 第${ordinal}章 ${chapter.title}`
    toc.push(`- ${titleLine.replace(/^##\s+/, '')}`)
    parts.push(demoted.trimEnd(), '')
  }

  const header = [
    `# ${meta.title}`,
    '',
    `> ${meta.subtitle}`,
    '',
    `队伍：${meta.team_name}｜院校：${meta.school}｜日期：${meta.date}`,
    `成员：${meta.members.map((member) => `${member.name}（${member.role}）`).join('、')}`,
    '',
    '> 数据性质：本稿所有案例、报价、优惠、历史价格与消费记录均为**模拟数据**，用于规则与技术验证，不代表真实市场价格或真实用户反馈。',
    '> 界面截图单独交付（`submission/screenshots/`），正文未插入任何前端截图或占位图片。',
    '',
    '## 目录',
    '',
    ...toc,
  ].join('\n')

  const text = `${header}\n\n${parts.join('\n')}\n---\n\n${figureIndex.trimEnd()}\n`
  return { text, chapters: CHAPTERS.length, placeholders, figures: countFigures() }
}

function countFigures(): number {
  const indexText = readTextIfExists(repoPath(FIGURES_DIR, 'index.md')) ?? ''
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
    console.log(`成稿一致：${built.chapters} 章、${built.placeholders} 处数据占位符、${built.figures} 张图`)
    return 0
  }
  if (built.figures < 15) {
    console.error(`图表只有 ${built.figures} 张，比赛建议不少于 15 张（docs/sources.md）`)
    return 1
  }
  writeFileAtomic(target, built.text)
  console.log(`已生成 ${BUILD_DIR}/趣有度_项目书.md：${built.chapters} 章、${built.placeholders} 处数据占位符、${built.figures} 张图`)
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
