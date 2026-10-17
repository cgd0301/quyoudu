/**
 * pnpm count:chars
 *
 * 篇幅统计。口径来自比赛原始资料（docs/sources.md，只读原文）：
 * - “无强制模板、无字数限制。推荐含附录40页以上，图表不少于15张”（第133行）；
 * - 作品概述“字数不超过500字”（第144行）；产品建议“不超过500字”（第146行）。
 *
 * 字数口径：汉字按一个字计，英文与数字按词计（不把单词数当字符数），另外单独报告非空白字符数。
 * 页数没有官方换算，因此只给“按每页 900 字符估算”的参考值，并明确标注不是官方口径。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { CHAPTERS, FIGURES_DIR, OVERVIEW_LIMIT, PRODUCT_ADVICE_LIMIT, chapterPath } from './lib/book.ts'
import { countChars } from './doc-lint.ts'
import { renderData } from './lib/placeholder.ts'
import { REPORT_DIR, readTextIfExists, repoPath, writeFileAtomic } from './lib/repo.ts'
import { canonicalWire } from './lib/canonical.ts'

const CHARS_PER_PAGE = 900

export type CharReport = {
  official: { overview_limit: number; advice_limit: number; pages_recommended: number; figures_recommended: number; source: string }
  overview: { wordlike: number; chars: number; limit: number; over: boolean }
  advice: { wordlike: number; chars: number; limit: number; over: boolean }
  body: { wordlike: number; chars: number; chapters: number }
  appendix: { wordlike: number; chars: number; chapters: number }
  total: { wordlike: number; chars: number }
  pages_estimate: number
  figures: number
}

function figureCount(): number {
  const dir = repoPath(FIGURES_DIR)
  if (!existsSync(dir)) return 0
  let count = 0
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      if (statSync(full).isDirectory()) visit(full)
      else if (/\.(svg|png)$/.test(name)) count += 1
    }
  }
  visit(dir)
  return count
}

export function buildCharReport(): CharReport {
  const totals = { overview: { wordlike: 0, chars: 0 }, advice: { wordlike: 0, chars: 0 }, body: { wordlike: 0, chars: 0 }, appendix: { wordlike: 0, chars: 0 } }
  const chapterCount = { body: 0, appendix: 0 }
  for (const chapter of CHAPTERS) {
    const text = readTextIfExists(repoPath(chapterPath(chapter.file)))
    if (text === null) throw new Error(`缺少章节 ${chapterPath(chapter.file)}，无法统计篇幅`)
    const rendered = renderData(text).text
    const counted = countChars(rendered)
    if (chapter.file === '00_overview.md') totals.overview = { wordlike: counted.wordLike, chars: counted.chars }
    else if (chapter.file === '90_product_advice.md') totals.advice = { wordlike: counted.wordLike, chars: counted.chars }
    else if (chapter.kind === 'appendix') {
      totals.appendix.wordlike += counted.wordLike
      totals.appendix.chars += counted.chars
      chapterCount.appendix += 1
    } else {
      totals.body.wordlike += counted.wordLike
      totals.body.chars += counted.chars
      chapterCount.body += 1
    }
  }
  const totalChars = totals.body.chars + totals.appendix.chars + totals.overview.chars + totals.advice.chars
  return {
    official: {
      overview_limit: OVERVIEW_LIMIT,
      advice_limit: PRODUCT_ADVICE_LIMIT,
      pages_recommended: 40,
      figures_recommended: 15,
      source: 'docs/sources.md 第133、144、146行（原文只读）',
    },
    overview: { wordlike: totals.overview.wordlike, chars: totals.overview.chars, limit: OVERVIEW_LIMIT, over: totals.overview.wordlike > OVERVIEW_LIMIT },
    advice: { wordlike: totals.advice.wordlike, chars: totals.advice.chars, limit: PRODUCT_ADVICE_LIMIT, over: totals.advice.wordlike > PRODUCT_ADVICE_LIMIT },
    body: { wordlike: totals.body.wordlike, chars: totals.body.chars, chapters: chapterCount.body },
    appendix: { wordlike: totals.appendix.wordlike, chars: totals.appendix.chars, chapters: chapterCount.appendix },
    total: { wordlike: totals.body.wordlike + totals.appendix.wordlike, chars: totalChars },
    pages_estimate: Math.ceil(totalChars / CHARS_PER_PAGE),
    figures: figureCount(),
  }
}

export function renderReport(report: CharReport): string {
  const lines = [
    '篇幅统计（pnpm count:chars）',
    `口径来源：${report.official.source}`,
    '',
    `作品概述：${report.overview.wordlike} 字（上限 ${report.official.overview_limit}）；非空白字符 ${report.overview.chars}`,
    `产品建议：${report.advice.wordlike} 字（上限 ${report.official.advice_limit}）；非空白字符 ${report.advice.chars}`,
    `正文：${report.body.chapters} 章，${report.body.wordlike} 字；非空白字符 ${report.body.chars}`,
    `附录：${report.appendix.chapters} 章，${report.appendix.wordlike} 字；非空白字符 ${report.appendix.chars}`,
    `合计（不含概述与产品建议）：${report.total.wordlike} 字；非空白字符 ${report.total.chars}`,
    `图表：${report.figures} 张（建议不少于 ${report.official.figures_recommended} 张）`,
    `页数估算：约 ${report.pages_estimate} 页（按每页 ${CHARS_PER_PAGE} 非空白字符折算；官方没有给换算口径，这是估算值，不是官方指标）`,
    `官方页数建议：含附录 ${report.official.pages_recommended} 页以上`,
  ]
  return `${lines.join('\n')}\n`
}

export async function main(): Promise<number> {
  const report = buildCharReport()
  writeFileAtomic(path.join(REPORT_DIR, 'chars.json'), canonicalWire(report))
  process.stdout.write(renderReport(report))
  if (report.overview.over) console.error(`作品概述超过 ${OVERVIEW_LIMIT} 字上限`)
  if (report.advice.over) console.error(`产品建议超过 ${PRODUCT_ADVICE_LIMIT} 字上限`)
  if (report.figures < report.official.figures_recommended) {
    console.error(`图表只有 ${report.figures} 张，少于建议的 ${report.official.figures_recommended} 张`)
    return 1
  }
  return report.overview.over || report.advice.over ? 1 : 0
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
