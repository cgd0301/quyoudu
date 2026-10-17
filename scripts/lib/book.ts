/**
 * 项目书的章节清单与数据占位符约定。
 *
 * 章节顺序由本文件固定（book:build 按此排序），文件缺失、标题不符或占位符解析失败都算构建失败。
 * 数据占位符写作 <!-- data: 路径 -->，路径相对 book/data 下的 JSON 文件，形如
 * cases/c01_base.json#checkpoints.0.result.cost.total。build 时由真实导出结果填入。
 */
export type ChapterKind = 'overview' | 'body' | 'appendix'

export type Chapter = {
  file: string
  title: string
  kind: ChapterKind
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
  { file: '00_overview.md', title: '作品概述', kind: 'overview' },
  { file: '01_problem.md', title: '项目问题与目标用户', kind: 'body' },
  { file: '02_solution.md', title: '产品方案与范围', kind: 'body' },
  { file: '03_compute.md', title: '核心计算逻辑', kind: 'body' },
  { file: '04_architecture.md', title: '系统架构', kind: 'body' },
  { file: '05_data_algo.md', title: '数据与算法设计', kind: 'body' },
  { file: '06_price_offer.md', title: '价格与优惠约束', kind: 'body' },
  { file: '07_timeline.md', title: '资金时间轴与可行性判断', kind: 'body' },
  { file: '08_confirm.md', title: '确认机制与行动清单', kind: 'body' },
  { file: '09_business.md', title: '商业模式与财务测算边界', kind: 'body' },
  { file: '10_safety.md', title: '安全、隐私与模拟数据边界', kind: 'body' },
  { file: '11_validation.md', title: '技术验证与局限性', kind: 'body' },
  { file: '12_roadmap.md', title: '推进计划与风险分析', kind: 'body' },
  { file: '90_product_advice.md', title: '产品建议', kind: 'body' },
  { file: '91_appendix_test_report.md', title: '附录A 测试与验证记录', kind: 'appendix' },
  { file: '92_appendix_reproduce.md', title: '附录B 复现与数据字典', kind: 'appendix' },
]

/** 由脚本生成、不手工编辑的章节 */
export const GENERATED_CHAPTERS = new Set(['91_appendix_test_report.md'])

export function chapterPath(file: string): string {
  return `${CHAPTERS_DIR}/${file}`
}

export function chapterForFile(file: string): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.file === file)
}
