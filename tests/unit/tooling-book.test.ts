import { describe, expect, test } from 'vitest'
import { countChars, checkAmounts, checkStatements, runDocLint } from '../../scripts/doc-lint.ts'
import { buildCharReport, renderReport } from '../../scripts/count-chars.ts'
import { buildBook, parseMeta } from '../../scripts/book-build.ts'
import { checkData, parsePlaceholder, renderData } from '../../scripts/lib/placeholder.ts'
import { CHAPTERS } from '../../scripts/lib/book.ts'

describe('placeholder 数据占位符', () => {
  test('placeholder 解析路径、数组下标与格式', () => {
    const parsed = parsePlaceholder('<!-- data: cases/c01_base.json#checkpoints[0].result.cost.total.value | cents -->')
    expect(parsed).not.toBeNull()
    expect(parsed?.target).toBe('cases/c01_base.json')
    expect(parsed?.segments).toEqual(['checkpoints', '0', 'result', 'cost', 'total', 'value'])
    expect(parsed?.format).toBe('cents')
  })

  test('placeholder 用真实导出数据渲染整数分为两位小数', () => {
    const rendered = renderData('合计 <!-- data: cases/c01_base.json#checkpoints.0.result.snapshot.cash.value | cents --> 元')
    expect(rendered.count).toBe(1)
    expect(rendered.text).toMatch(/^合计 \d+\.\d{2} 元$/)
  })

  test('placeholder 路径不存在时报错而不是留原样', () => {
    const errors = checkData('<!-- data: cases/c01_base.json#checkpoints.0.result.not_exists -->')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('没有该路径')
    expect(() => renderData('<!-- data: cases/c01_base.json#nope -->')).toThrow()
  })

  test('placeholder 文件不存在与 cents 用于非整数都报错', () => {
    const missing = checkData('<!-- data: cases/not-a-case.json#a -->')
    expect(missing.join()).toContain('读不到')
    const wrongType = checkData('<!-- data: cases/c01_base.json#checkpoints.0.result.states.plan_state | cents -->')
    expect(wrongType.join()).toContain('cents 只能用于整数分')
  })
})

describe('book-build 项目书构建', () => {
  test('book-build 解析 meta.yml 的标题、成员与日期', () => {
    const meta = parseMeta(
      ['title: "标题"', 'subtitle: "副标题"', 'team_name: "队"', 'school: "校"', 'date: "2026-10"', 'members:', '  - name: "甲"', '    role: "队长"'].join('\n'),
    )
    expect(meta).toMatchObject({ title: '标题', subtitle: '副标题', team_name: '队', school: '校', date: '2026-10' })
    expect(meta.members).toEqual([{ name: '甲', role: '队长' }])
  })

  test('book-build 缺少必需字段时直接报错', () => {
    expect(() => parseMeta('title: "只有标题"')).toThrow('缺少 subtitle')
  })

  test('book-build 合成正文包含全部章节、目录与模拟数据声明', () => {
    const built = buildBook()
    expect(built.chapters).toBe(CHAPTERS.length)
    expect(built.placeholders).toBeGreaterThan(0)
    expect(built.figures).toBeGreaterThanOrEqual(15)
    expect(built.text).toContain('## 目录')
    expect(built.text).toContain('模拟数据')
    expect(built.text).toContain('## 第1章 作品概述')
    expect(built.text).not.toContain('<!-- data:')
  })
})

describe('count-chars 篇幅统计', () => {
  test('count-chars 字数口径为汉字按字、英文数字按词，并单列非空白字符数', () => {
    const counted = countChars('趣有度 2026 年 useful 3 个字。')
    // 汉字：趣有度、年、个字 → 6 个；英文数字按词：2026、useful、3 → 3 个
    expect(counted.wordLike).toBe(9)
    expect(counted.chars).toBeGreaterThan(counted.wordLike)
  })

  test('count-chars 概述与产品建议都在 500 字上限内，且口径与官方一致', () => {
    const report = buildCharReport()
    expect(report.official.overview_limit).toBe(500)
    expect(report.official.advice_limit).toBe(500)
    expect(report.overview.wordlike).toBeLessThanOrEqual(500)
    expect(report.advice.wordlike).toBeLessThanOrEqual(500)
    expect(report.figures).toBeGreaterThanOrEqual(15)
    const text = renderReport(report)
    expect(text).toContain('不是官方指标')
  })
})

describe('doc-lint 文档检查', () => {
  test('doc-lint 全部检查在当前仓库通过', () => {
    const output = runDocLint()
    const failed = output.checks.filter((check) => !check.passed)
    expect(failed.map((check) => `${check.id}:${check.message}`)).toEqual([])
    expect(output.figures).toBeGreaterThanOrEqual(15)
  })

  test('doc-lint 能识别把模拟数据当需求证据、把技术通过当需求成立的表述', () => {
    const checks = checkStatements([
      { file: 'x.md', text: '模拟数据表明用户愿意为省时付费。' },
      { file: 'x.md', text: '测试通过说明需求成立。' },
    ])
    const t01401 = checks.find((check) => check.id === 'T014-01')
    const t01403 = checks.find((check) => check.id === 'T014-03')
    expect(t01401?.passed).toBe(false)
    expect(t01403?.passed).toBe(false)
    expect(t01401?.message).toContain('x.md')
  })

  test('doc-lint 金额检查要求每个“X.YY 元”都能在导出数据或规则原文中找到依据', () => {
    const ok = checkAmounts([{ file: 'x.md', text: '门票 660.00 元。' }])
    const bad = checkAmounts([{ file: 'x.md', text: '门票 12345.67 元。' }])
    expect(ok.passed).toBe(true)
    expect(bad.passed).toBe(false)
  })
})
