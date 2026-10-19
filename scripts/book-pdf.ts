/**
 * pnpm book:pdf
 *
 * 把 book/build/趣有度_项目书.md 排成 A4 版式并输出 PDF：
 * - 自带的 Markdown 解析只覆盖项目书实际用到的语法（标题、段落、列表、表格、代码块、引用、
 *   图片、脚注、分隔线、行内粗体/代码/链接），不引入新依赖；
 * - 分页在浏览器内按固定页框手工完成（每页 .page 等于 A4），目录页码、页眉章节名与页脚
 *   页码都来自真实版面位置，不用 CSS 计数器猜页码；
 * - 目录页码 = PDF 实际页码（封面为第 1 页，不显示页码、不显示页眉页脚）；
 * - 输出 PDF 后逐页截图到 .cache/pdf-pages/，供人工核验版面。
 *
 * 缺图、脚注缺定义、分页溢出、PDF 页数与版面页数不一致，一律非零退出，不输出"看起来像成稿"的结果。
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { BUILD_DIR, FIGURES_DIR } from './lib/book.ts'
import { paginate } from './lib/pdf-paginate.ts'
import { readTextIfExists, repoPath } from './lib/repo.ts'

const SOURCE = `${BUILD_DIR}/趣有度_项目书.md`
const DEFAULT_OUTPUT = 'submission/趣有度_项目书.pdf'
const SHOT_DIR = '.cache/pdf-pages'
const HTML_OUT = `${BUILD_DIR}/趣有度_项目书.html`

type Block =
  | { t: 'h'; level: 2 | 3 | 4; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'table'; header: string[]; rows: string[][]; align: string[] }
  | { t: 'code'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'img'; src: string; alt: string; width: string | null }
  | { t: 'notes'; items: { label: string; text: string }[] }

type Section = { heading: string; blocks: Block[]; notes: Map<string, number> }

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 构建过程的阶段日志：写文件而不写标准输出，避免长时间无输出时无法判断卡在哪一步 */
function trace(message: string): void {
  try {
    appendFileSync(repoPath('.cache/book-pdf.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // 日志失败不影响构建
  }
}

function inline(text: string, notes: Map<string, number>): string {
  const slots: string[] = []
  const hold = (html: string): string => {
    slots.push(html)
    return `\uE000${slots.length - 1}\uE001`
  }
  let rest = text.replace(/`([^`]+)`/g, (_m, code: string) => hold(`<code>${esc(code)}</code>`))
  rest = rest.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) =>
    hold(`<a href="${esc(url)}">${esc(label)}</a>`),
  )
  rest = rest.replace(/(?<!["\w])(https?:\/\/[^\s<>）)、，。；]+)/g, (_m, url: string) => hold(`<a href="${esc(url)}">${esc(url)}</a>`))
  rest = rest.replace(/\*\*([^*]+)\*\*/g, (_m, strong: string) => hold(`<strong>${esc(strong)}</strong>`))
  rest = rest.replace(/\[\^([^\]]+)\]/g, (_m, id: string) => {
    const num = notes.get(id)
    if (num === undefined) throw new Error(`脚注引用 [^${id}] 没有对应定义`)
    return hold(`<sup class="fnref"><a href="#fn-${esc(id)}">${num}</a></sup>`)
  })
  // 占位符用私用区字符，避免与正文冲突，也避免正则里出现控制字符。
  // 加粗里可能还嵌着行内代码的占位符，因此要反复替换到没有占位符为止。
  let out = esc(rest)
  for (let round = 0; round < 6 && /\uE000\d+\uE001/.test(out); round += 1) {
    out = out.replace(/\uE000(\d+)\uE001/g, (_m, index: string) => slots[Number(index)] ?? '')
  }
  // 表格单元格里的 <br> 是原作者用于换行的，转义后要还原成真实换行；
  // 相邻的多个脚注合并成一个上标并用逗号分隔，避免出现「345」这样的连写
  return out.replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/<\/sup>(<sup class="fnref">)/g, ',')
}

const FIGURE_NUMBER = new Map<string, number>()

function loadFigureNumbers(): void {
  const index = readTextIfExists(repoPath(FIGURES_DIR, 'index.md')) ?? ''
  for (const line of index.split('\n')) {
    const match = /^\|\s*图\s*(\d+)\s*\|[^|]*\|\s*([^|\s]+)\s*\|/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) FIGURE_NUMBER.set(match[2].trim(), Number(match[1]))
  }
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i]
    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i += 1
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

const startsBlock = (line: string): boolean =>
  /^#{2,4}\s/.test(line) ||
  /^!\[/.test(line.trim()) ||
  /^\|/.test(line.trim()) ||
  /^- /.test(line) ||
  /^\d+\. /.test(line) ||
  /^>\s?/.test(line) ||
  /^---+\s*$/.test(line) ||
  line.trimStart().startsWith('```') ||
  /^\[\^[^\]]+\]:/.test(line)

export function parseBook(markdown: string): { front: string[]; sections: Section[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const front: string[] = []
  const sections: Section[] = []
  let current: Section | null = null
  let chunk: string[] = []

  const emit = (): void => {
    if (current === null || chunk.length === 0) {
      chunk = []
      return
    }
    const notes = new Map<string, number>()
    const register = (id: string): void => {
      if (!notes.has(id)) notes.set(id, notes.size + 1)
    }
    for (const line of chunk) {
      const def = /^\[\^([^\]]+)\]:/.exec(line)
      if (def?.[1] !== undefined) register(def[1])
      else for (const ref of line.matchAll(/\[\^([^\]]+)\]/g)) register(ref[1] ?? '')
    }
    const blocks: Block[] = []
    const noteItems: { label: string; text: string }[] = []
    let i = 0
    while (i < chunk.length) {
      const line = chunk[i] ?? ''
      if (line.trim() === '') {
        i += 1
        continue
      }
      const heading = /^(#{2,4})\s+(.*)$/.exec(line)
      if (heading?.[1] !== undefined) {
        blocks.push({ t: 'h', level: heading[1].length as 2 | 3 | 4, text: (heading[2] ?? '').trim() })
        i += 1
        continue
      }
      const image = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/.exec(line.trim())
      if (image !== null) {
        const width = /width\s*=\s*([0-9.]+(?:%|px))/.exec(image[3] ?? '')?.[1] ?? null
        blocks.push({ t: 'img', alt: image[1] ?? '', src: image[2] ?? '', width })
        i += 1
        continue
      }
      const def = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line)
      if (def?.[1] !== undefined) {
        noteItems.push({ label: def[1], text: def[2] ?? '' })
        i += 1
        continue
      }
      if (line.trimStart().startsWith('```')) {
        const body: string[] = []
        i += 1
        while (i < chunk.length && !(chunk[i] ?? '').trimStart().startsWith('```')) {
          body.push(chunk[i] ?? '')
          i += 1
        }
        i += 1
        blocks.push({ t: 'code', text: body.join('\n') })
        continue
      }
      const isTable = /^\|/.test(line.trim()) && /^\|?[\s:|-]+\|[\s:|-]*$/.test((chunk[i + 1] ?? '').trim())
      if (isTable) {
        const header = splitRow(line)
        const align = splitRow(chunk[i + 1] ?? '').map((cell) =>
          cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left',
        )
        i += 2
        const rows: string[][] = []
        while (i < chunk.length && /^\|/.test((chunk[i] ?? '').trim())) {
          rows.push(splitRow(chunk[i] ?? ''))
          i += 1
        }
        blocks.push({ t: 'table', header, rows, align })
        continue
      }
      if (/^- /.test(line)) {
        const items: string[] = []
        while (i < chunk.length && /^- /.test(chunk[i] ?? '')) {
          items.push((chunk[i] ?? '').replace(/^- /, '').trim())
          i += 1
        }
        blocks.push({ t: 'ul', items })
        continue
      }
      if (/^\d+\. /.test(line)) {
        const items: string[] = []
        while (i < chunk.length && /^\d+\. /.test(chunk[i] ?? '')) {
          items.push((chunk[i] ?? '').replace(/^\d+\. /, '').trim())
          i += 1
        }
        blocks.push({ t: 'ol', items })
        continue
      }
      if (/^>\s?/.test(line)) {
        const parts: string[] = []
        while (i < chunk.length && /^>\s?/.test(chunk[i] ?? '')) {
          parts.push((chunk[i] ?? '').replace(/^>\s?/, '').trim())
          i += 1
        }
        blocks.push({ t: 'quote', text: parts.join(' ') })
        continue
      }
      if (/^---+\s*$/.test(line)) {
        i += 1
        continue
      }
      const para: string[] = [line.trim()]
      i += 1
      while (i < chunk.length) {
        const next = chunk[i] ?? ''
        if (next.trim() === '' || startsBlock(next)) break
        para.push(next.trim())
        i += 1
      }
      blocks.push({ t: 'p', text: para.join('') })
    }
    if (noteItems.length > 0) blocks.push({ t: 'notes', items: noteItems })
    current.blocks = blocks
    current.notes = notes
    chunk = []
  }

  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2 !== null) {
      emit()
      current = { heading: (h2[1] ?? '').trim(), blocks: [], notes: new Map() }
      sections.push(current)
      continue
    }
    if (line.startsWith('# ')) {
      emit()
      front.push(line)
      continue
    }
    if (current === null) {
      front.push(line)
      continue
    }
    chunk.push(line)
  }
  emit()
  return { front, sections }
}

const CSS = String.raw`
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #fff }
body {
  font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif;
  font-size: 10.2pt; line-height: 1.72; color: #1c2226;
  /* 中文整行本来就会被填满；用 justify 时，含长路径/代码的行会被拉成稀字距，
     因此正文改为左对齐，避免出现跨行大间隙。 */
  text-align: left;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #fff; page-break-after: always; break-after: page }
.page:last-child { page-break-after: auto; break-after: auto }
.page-head, .page-foot { position: absolute; left: 20mm; right: 20mm; display: flex; font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 7.8pt; color: #7c8794 }
.page-head { top: 10.5mm; justify-content: space-between; gap: 8mm }
.page-head .hr { text-align: right; color: #4f6b5d; overflow: hidden; white-space: nowrap }
.page-foot { bottom: 9mm; justify-content: space-between; align-items: baseline; border-top: .4pt solid #d7dfda; padding-top: 2.2mm }
.page-body { position: absolute; top: 21mm; left: 20mm; right: 20mm; bottom: 19mm; overflow: hidden }
.page-body > *:first-child { margin-top: 0 }
.page-num { font-variant-numeric: tabular-nums; color: #46505a }
.cover { position: absolute; inset: 0; padding: 36mm 24mm 20mm; display: flex; flex-direction: column }
.cover .kicker { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 8.8pt; letter-spacing: .14em; color: #0d6b4f; margin-bottom: 6mm }
.cover h1 { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 20pt; line-height: 1.4; margin: 0 0 4mm; color: #0b3d2c; font-weight: 800; text-align: left }
.cover .sub { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 11.5pt; color: #2f4a3f; margin-bottom: 9mm; text-align: left; line-height: 1.6 }
.cover .rule { height: 1.4pt; background: linear-gradient(90deg,#0d6b4f,#8fbfa8); width: 46mm; margin: 0 0 9mm }
.cover .meta { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 10.2pt; line-height: 2; color: #22302a; text-align: left }
.cover .meta b { color: #0b3d2c; font-weight: 600 }
.cover .note { margin-top: auto; font-size: 8.3pt; line-height: 1.66; color: #5d6a63; border-top: .5pt solid #cfdad4; padding-top: 4mm; text-align: left }
.toc-title { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 17pt; font-weight: 800; color: #0b3d2c; margin: 0 0 5mm }
.toc-row { display: flex; align-items: baseline; gap: 2mm; font-size: 10pt; line-height: 1.9 }
.toc-row.lvl3 { font-size: 8.9pt; color: #44514b; padding-left: 7mm; line-height: 1.7 }
.toc-row .t { max-width: 88% }
.toc-row .dots { flex: 1; border-bottom: .5pt dotted #b9c4be; transform: translateY(-2px) }
.toc-row .num { font-variant-numeric: tabular-nums; color: #33403a; font-family: "Noto Sans SC","Microsoft YaHei",sans-serif; font-size: 9pt }
.toc-row.lvl2 { font-weight: 700; color: #10382b; font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif }
.toc-group { position: relative; width: 100% }
h2.chap { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 15.5pt; font-weight: 800; color: #0b3d2c;
  margin: 0 0 5mm; padding: 0 0 2.6mm; border-bottom: 1.1pt solid #0d6b4f; line-height: 1.34; text-align: left }
h2.chap .pre { display: block; font-size: 8.4pt; letter-spacing: .2em; color: #4d7a68; font-weight: 600; margin-bottom: 1.4mm }
h3 { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 11.5pt; font-weight: 700; color: #123f30;
  margin: 5.2mm 0 2.2mm; line-height: 1.45; text-align: left; padding-left: 2.6mm; border-left: 2.4pt solid #4f9a7c }
h4 { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 10.3pt; font-weight: 700; color: #1c4b3a; margin: 3.4mm 0 1.4mm; text-align: left }
p { margin: 0 0 2.4mm; orphans: 2; widows: 2 }
strong { font-weight: 700; color: #0f2f24 }
code { font-family: "Cascadia Mono", Consolas, "Noto Sans SC", monospace; font-size: 8.7pt; background: #f2f6f4; border: .4pt solid #dde6e1; border-radius: 1mm; padding: 0 .7mm; color: #164b38 }
pre { margin: 0 0 2.6mm; background: #f5f8f6; border: .5pt solid #dbe5df; border-left: 2.2pt solid #4f9a7c; border-radius: 1mm; padding: 2.4mm 3mm; white-space: pre-wrap; word-break: break-word }
pre code { background: none; border: none; padding: 0; font-size: 8.4pt; line-height: 1.55 }
ul, ol { margin: 0 0 2.4mm; padding-left: 6mm }
li { margin: 0 0 1.2mm; line-height: 1.66 }
blockquote { margin: 0 0 2.6mm; padding: 2.2mm 3.2mm; background: #f4f8f6; border-left: 2.2pt solid #7fb59c; color: #23453a; font-size: 9.5pt }
table { width: 100%; border-collapse: collapse; margin: 0 0 2.8mm; font-size: 8.4pt; line-height: 1.48; font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif }
th, td { border: .4pt solid #cdd9d3; padding: 1.4mm 1.7mm; vertical-align: top; text-align: left; word-break: break-word }
th { background: #eaf2ee; color: #10382b; font-weight: 700 }
tr:nth-child(even) td { background: #fafcfb }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums }
td.code-id, th.code-id { white-space: nowrap; font-variant-numeric: tabular-nums }
figure { margin: 0 0 2mm; text-align: center }
figure img { display: block; margin: 0 auto; max-width: 100%; max-height: 180mm; object-fit: contain }
figure img.shot { border: .4pt solid #d5ded9 }
figcaption { margin-top: 1.4mm; font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 8.1pt; color: #5c6b64; line-height: 1.5; text-align: center }
.notes { margin-top: 3.4mm; border-top: .5pt solid #d3ded8; padding-top: 1.8mm; font-size: 7.8pt; line-height: 1.52; color: #55635c; font-family: "Noto Sans SC","Microsoft YaHei",sans-serif }
.notes .item { display: flex; gap: 1.5mm; margin-bottom: .9mm }
.notes .no { color: #0d6b4f; font-weight: 700; min-width: 4mm }
sup.fnref { font-size: 6.4pt; vertical-align: super; line-height: 0; color: #0d6b4f; font-weight: 700 }
sup.fnref a { text-decoration: none; color: inherit }
a { color: #10557f; text-decoration: none; word-break: break-all }
`

/** 章节标题：把“第N章”“附录 X”单独提为小字标签，其余为标题正文 */
function chapterHeadingHtml(heading: string): string {
  const prefix = /^第[0-9一二三四五六七八九十]+章/.exec(heading)?.[0] ?? /^附录\s*[A-E]/.exec(heading)?.[0] ?? ''
  const rest = prefix === '' ? heading : heading.slice(prefix.length).replace(/^[\s\u3000]+/, '')
  return `<h2 class="chap" data-toc="${esc(heading)}">${prefix === '' ? '' : `<span class="pre">${esc(prefix)}</span>`}${esc(rest)}</h2>`
}

function renderBlock(block: Block, notes: Map<string, number>): string {
  switch (block.t) {
    case 'h': {
      if (block.level !== 2) return `<h${block.level}>${inline(block.text, notes)}</h${block.level}>`
      return chapterHeadingHtml(block.text)
    }
    case 'p':
      return `<p>${inline(block.text, notes)}</p>`
    case 'ul':
      return `<ul>${block.items.map((item) => `<li>${inline(item, notes)}</li>`).join('')}</ul>`
    case 'ol':
      return `<ol>${block.items.map((item) => `<li>${inline(item, notes)}</li>`).join('')}</ol>`
    case 'quote':
      return `<blockquote>${inline(block.text, notes)}</blockquote>`
    case 'code':
      return `<pre><code>${esc(block.text)}</code></pre>`
    case 'table': {
      // 编号类单元格（GH01、E19、R003…）不换行，避免被挤成两三个字一行
      const cell = (tag: 'th' | 'td', text: string, index: number): string => {
        const className = [block.align[index] === 'right' ? 'num' : '', /^[A-Z]{1,3}\d{1,3}$/.test(text.trim()) ? 'code-id' : '']
          .filter((item) => item !== '')
          .join(' ')
        return `<${tag}${className === '' ? '' : ` class="${className}"`}>${inline(text, notes)}</${tag}>`
      }
      const head = block.header.map((text, i) => cell('th', text, i)).join('')
      const body = block.rows.map((row) => `<tr>${row.map((text, i) => cell('td', text, i)).join('')}</tr>`).join('')
      // 图表索引表列多且内容长，固定列宽比自动分配更整齐
      const isFigureIndex = block.header.some((text) => text.includes('文件名'))
      const colgroup = isFigureIndex
        ? '<colgroup><col style="width:7%"><col style="width:18%"><col style="width:19%"><col style="width:30%"><col style="width:26%"></colgroup>'
        : ''
      const tableStyle = isFigureIndex ? ' style="table-layout:fixed"' : ''
      return `<table${tableStyle}>${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    }
    case 'img': {
      const file = path.basename(block.src)
      const number = FIGURE_NUMBER.get(file)
      const caption = block.alt.startsWith('图') ? block.alt : number === undefined ? block.alt : `图 ${number}　${block.alt}`
      const style = block.width === null ? '' : ` style="width:${block.width}"`
      const shot = block.src.includes('/screenshots/') ? ' class="shot"' : ''
      const alt = block.alt.replace(/^图\s*[0-9-]+\s*/, '')
      // 图表 SVG 自身已带编号、标题与数据来源，再加一条图注会重复
      const captionHtml = /\.svg$/i.test(block.src) ? '' : `<figcaption>${esc(caption)}</figcaption>`
      return `<figure><img${shot}${style} src="${esc(block.src)}" alt="${esc(alt)}">${captionHtml}</figure>`
    }
    case 'notes': {
      // 注释按正文引用顺序排列（编号由引用顺序决定，定义顺序可能不同），并允许行内代码
      const ordered = [...block.items].sort((left, right) => (notes.get(left.label) ?? 0) - (notes.get(right.label) ?? 0))
      return `<div class="notes">${ordered
        .map(
          (item) =>
            `<div class="item" id="fn-${esc(item.label)}"><span class="no">${notes.get(item.label) ?? 0}</span><span>${inline(item.text, notes)}</span></div>`,
        )
        .join('')}</div>`
    }
  }
}

export async function buildPdf(options: { output: string; shots: boolean }): Promise<{
  pages: number
  tocPages: number
  sections: { heading: string; page: number }[]
}> {
  const markdown = readTextIfExists(repoPath(SOURCE))
  if (markdown === null) throw new Error(`缺少 ${SOURCE}，先运行 pnpm book:build`)
  loadFigureNumbers()
  const parsed = parseBook(markdown)
  const title = (parsed.front.find((line) => line.startsWith('# ')) ?? '# 趣有度').replace(/^#\s+/, '')
  const subtitle = (parsed.front.find((line) => line.startsWith('> ')) ?? '').replace(/^>\s+/, '')
  const meta = parsed.front.filter((line) => /^(队伍|成员)[：:]/.test(line))
  const note = parsed.front
    .filter((line) => line.startsWith('> ') && line.replace(/^>\s+/, '') !== subtitle)
    .map((line) => line.replace(/^>\s+/, ''))
  const sections = parsed.sections.filter((section) => section.heading.replace(/[\s「」（）]/g, '') !== '目录')
  if (sections.length === 0) throw new Error('没有解析到任何 ## 章节')

  let imageCount = 0
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.t !== 'img') continue
      const target = path.resolve(repoPath(BUILD_DIR), block.src)
      if (!existsSync(target)) throw new Error(`章节「${section.heading}」引用的图片不存在：${block.src}`)
      imageCount += 1
      block.src = path.relative(repoPath(BUILD_DIR), target).split(path.sep).join('/')
    }
  }

  const bodyHtml = sections
    .map(
      (section) =>
        `<section class="chapter" data-title="${esc(section.heading)}">\n${chapterHeadingHtml(section.heading)}\n${section.blocks
          .map((block) => renderBlock(block, section.notes))
          .join('\n')}\n</section>`,
    )
    .join('\n')

  const browser = await chromium.launch()
  try {
    return await renderWithBrowser(browser, { sections, bodyHtml, title, subtitle, meta, note, imageCount, output: options.output, shots: options.shots })
  } finally {
    await browser.close()
  }
}

async function renderWithBrowser(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  input: {
    sections: Section[]
    bodyHtml: string
    title: string
    subtitle: string
    meta: string[]
    note: string[]
    imageCount: number
    output: string
    shots: boolean
  },
): Promise<{ pages: number; tocPages: number; sections: { heading: string; page: number }[] }> {
  const { sections, bodyHtml, title, subtitle, meta, note, imageCount, output: outputPath, shots } = input
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 }, deviceScaleFactor: 2 })
  page.setDefaultTimeout(90_000)
  const renderPath = repoPath(BUILD_DIR, '.pdf-render.html')
  writeFileSync(
    renderPath,
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="author" content="${esc(meta[0]?.replace(/^队伍[：:]/, '').split('｜')[0] ?? '')}">
<meta name="description" content="${esc(subtitle)}">
<script>window.__name = function (fn) { return fn }</script>
<style>${CSS}</style></head><body>
<div id="flow" style="position:absolute;left:-6000px;top:0;width:170mm">${bodyHtml}</div>
<div id="stage"></div>
<div id="measure" style="position:absolute;left:-6000px;top:0;width:170mm"></div>
</body></html>`,
  )
  trace(`渲染源已写入 ${BUILD_DIR}/.pdf-render.html：${sections.length} 节、${imageCount} 张图`)
  await page.goto(`file:///${renderPath.replace(/\\/g, '/')}`, { waitUntil: 'load' })
  trace('页面已载入')
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), undefined, {
    timeout: 30_000,
  })
  await page.emulateMedia({ media: 'print' })
  const loaded = await page.evaluate(() =>
    Array.from(document.images).map((img) => ({ src: img.getAttribute('src') ?? '', w: img.naturalWidth })),
  )
  const broken = loaded.filter((item) => item.w === 0)
  if (broken.length > 0) throw new Error(`图片未能渲染：${broken.map((item) => item.src).slice(0, 5).join('、')}`)
  trace(`图片全部载入 ${loaded.length} 张`)

  const result = await page.evaluate(paginate, { cover: { title, subtitle, meta, note }, imageCount })
  trace(`分页完成 ${result.pages} 页，目录 ${result.tocPages} 页，溢出 ${result.overflow.length} 项`)
  if (result.overflow.length > 0) throw new Error(`分页溢出：${result.overflow.slice(0, 6).join('；')}`)
  if (result.images !== imageCount) throw new Error(`图片数量不符：版面 ${result.images}／应有 ${imageCount}`)

  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
  const outPath = repoPath(outputPath)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, pdf)

  if (shots) {
    rmSync(repoPath(SHOT_DIR), { recursive: true, force: true })
    mkdirSync(repoPath(SHOT_DIR), { recursive: true })
    const handles = await page.$$('.page')
    for (let i = 0; i < handles.length; i += 1) {
      await handles[i]?.screenshot({ path: repoPath(SHOT_DIR, `page-${String(i + 1).padStart(2, '0')}.png`) })
    }
  }
  writeFileSync(repoPath(HTML_OUT), `<!-- 由 pnpm book:pdf 生成，勿手工编辑 -->\n${await page.content()}\n`)

  const declared = countPdfPages(pdf)
  if (declared !== result.pages) throw new Error(`PDF 实际页数 ${declared} 与版面页数 ${result.pages} 不一致`)
  console.log(
    `版面：封面 1 页 + 目录 ${result.tocPages} 页 + 正文 ${result.pages - 1 - result.tocPages} 页 = ${result.pages} 页；图片 ${result.images} 张`,
  )
  for (const item of result.sections) console.log(`  ${String(item.page).padStart(3)}  ${item.heading}`)
  console.log(`已生成 ${outputPath}：${result.pages} 页、${(pdf.length / 1024).toFixed(0)} KB`)
  return { pages: result.pages, tocPages: result.tocPages, sections: result.sections }
}

function countPdfPages(bytes: Buffer): number {
  const text = bytes.toString('latin1')
  // 以页面对象为准；/Count 可能同时出现在大纲等其它字典里，取最大值仅作交叉核对
  const pageObjects = [...text.matchAll(/\/Type\s*\/Page(?![s])/g)].length
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]))
  const largest = counts.length > 0 ? Math.max(...counts) : 0
  if (pageObjects > 0 && largest > 0 && pageObjects !== largest) {
    throw new Error(`PDF 内部页数不一致：页面对象 ${pageObjects}、页树 Count ${largest}`)
  }
  return pageObjects > 0 ? pageObjects : largest
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = [...argv]
  let output = DEFAULT_OUTPUT
  let shots = true
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--out') {
      output = args[i + 1] ?? output
      i += 1
      continue
    }
    if (arg === '--no-shots') {
      shots = false
      continue
    }
    throw new Error(`未知参数 ${String(arg)}；用法：pnpm book:pdf [--out 路径] [--no-shots]`)
  }
  for (const relative of ['submission', '.cache']) {
    if (!existsSync(repoPath(relative))) mkdirSync(repoPath(relative), { recursive: true })
  }
  await buildPdf({ output, shots })
  return 0
}

const invoked = process.argv[1]
if (invoked !== undefined && invoked.replace(/\\/g, '/').endsWith('scripts/book-pdf.ts')) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
