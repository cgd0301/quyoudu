/**
 * 项目书的章节清单与数据占位符约定。
 *
 * 章节顺序由本文件固定（book:build 按此排序），文件缺失、标题不符或占位符解析失败都算构建失败。
 * 数据占位符写作 <!-- data: 路径 -->，路径相对 book/data 下的 JSON 文件，形如
 * cases/c01_base.json#checkpoints.0.result.cost.total。build 时由真实导出结果填入。
 *
 * 结构（2026-10-19 改版）：
 * - 前置：项目摘要（不编号）；
 * - 主文：第一章—第八章，按“问题→方案→技术→验证→市场→商业→落地”顺序编号；
 * - 收尾：结论、产品建议（不编号）；
 * - 附录 A—F：规则细节、测试与覆盖、复现与数据字典、来源与证据、风险台账、图表索引。
 *
 * numbered=false 的章节不参与“第N章”编号，标题按 title 原样输出。
 */
export type ChapterKind = 'overview' | 'body' | 'appendix'

export type Chapter = {
  file: string
  title: string
  kind: ChapterKind
  /** 是否编入“第N章”；前置/收尾/附录为 false */
  numbered?: boolean
}

export const BOOK_DIR = 'book'
export const CHAPTERS_DIR = 'book/chapters'
export const FIGURES_DIR = 'book/figures'
export const DATA_DIR = 'book/data'
export const BUILD_DIR = 'book/build'

/** 作品概述与产品建议的篇幅上限（docs/sources.md：字数不超过500字） */
export const OVERVIEW_LIMIT = 500
export const PRODUCT_ADVICE_LIMIT = 500

export const CHAPTERS: readonly Chapter[] = [
  { file: '00_overview.md', title: '项目摘要', kind: 'overview', numbered: false },
  { file: '01_positioning.md', title: '项目概述与核心价值', kind: 'body' },
  { file: '02_problem.md', title: '用户问题与需求证据', kind: 'body' },
  { file: '03_solution.md', title: '产品方案与真实使用流程', kind: 'body' },
  { file: '04_technology.md', title: '核心技术与创新机制', kind: 'body' },
  { file: '05_validation.md', title: '原型实现与技术验证', kind: 'body' },
  { file: '06_market.md', title: '市场规模与竞争环境', kind: 'body' },
  { file: '07_business.md', title: '商业模式与市场进入策略', kind: 'body' },
  { file: '08_roadmap.md', title: '实施路线图、团队与风险', kind: 'body' },
  { file: '09_conclusion.md', title: '结论', kind: 'body', numbered: false },
  { file: '90_product_advice.md', title: '产品建议', kind: 'body', numbered: false },
  { file: '92_appendix_rules.md', title: '附录 A　规则与关键算法细节', kind: 'appendix', numbered: false },
  { file: '91_appendix_test_report.md', title: '附录 B　测试、追溯及覆盖矩阵', kind: 'appendix', numbered: false },
  { file: '93_appendix_reproduce.md', title: '附录 C　数据字典与复现方式', kind: 'appendix', numbered: false },
  { file: '94_appendix_sources.md', title: '附录 D　外部来源、问卷统计与证据登记', kind: 'appendix', numbered: false },
  { file: '95_appendix_risk.md', title: '附录 E　风险台账与决策条件', kind: 'appendix', numbered: false },
]

/** 图表索引不单独成章，由 book:build 从 book/figures/index.md 生成，作为附录 F */
export const FIGURE_APPENDIX = { title: '附录 F　图表与索引', source: 'book/figures/index.md' }

/** 由脚本生成、不手工编辑的章节 */
export const GENERATED_CHAPTERS = new Set(['91_appendix_test_report.md'])

export function chapterPath(file: string): string {
  return `${CHAPTERS_DIR}/${file}`
}

export function chapterForFile(file: string): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.file === file)
}

const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** 1→“一”，8→“八”；只用于章号，超出 10 时退回阿拉伯数字 */
export function chapterNumeral(ordinal: number): string {
  return CN_NUMERALS[ordinal - 1] ?? String(ordinal)
}
