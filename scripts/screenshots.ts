/**
 * pnpm shots
 *
 * 用真实启动的界面截四页图，输出到 submission/screenshots/。
 * - 由 vite 以固定端口启动同一份源码，再用已安装的 Playwright chromium 访问；
 * - 截图前先走一遍"选方案 C02 → 确认"，保证资金日历与计划管理页有真实内容；
 * - 任何一步失败即退出码 1，不生成占位图或示意图；
 * - 页面上必须有"模拟数据"标识，否则本次截图作废（避免把模拟数据当真实界面）。
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT_DIR = path.join(root, 'submission', 'screenshots')
const PORT = Number(process.env.SHOT_PORT ?? '5199')
const BASE = `http://127.0.0.1:${PORT}`

export type Shot = { file: string; page: string; note: string }

export const SHOTS: readonly Shot[] = [
  { file: '01-overview.png', page: 'overview', note: '目标概览：现金、保护性预留、每日参考与时间轴图' },
  { file: '02-compare.png', page: 'compare', note: '方案比较：Top-K 与完整组合净支出' },
  { file: '03-calendar.png', page: 'calendar', note: '资金日历：逐节点余额与判定' },
  { file: '04-manage.png', page: 'manage', note: '计划管理：购买行动清单与任务状态' },
]

async function main(): Promise<number> {
  await mkdir(OUT_DIR, { recursive: true })
  const server = await createServer({ root, server: { host: '127.0.0.1', port: PORT, strictPort: true }, logLevel: 'error' })
  await server.listen()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 414, height: 900 }, deviceScaleFactor: 2 })
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(BASE, { waitUntil: 'networkidle' })
    const badge = page.getByText('模拟数据', { exact: true })
    if ((await badge.count()) === 0) throw new Error('页面上没有“模拟数据”标识，拒绝截图')

    // 先让资金日历与计划管理页有真实内容：选方案并确认
    await page.getByRole('button', { name: /^方案比较/ }).click()
    await page.getByRole('button', { name: '选择方案 C02' }).click()
    await page.getByRole('button', { name: '确认方案' }).click()
    await page.getByText('已确认', { exact: true }).waitFor()

    const labels: Record<string, RegExp> = {
      overview: /^目标概览/,
      compare: /^方案比较/,
      calendar: /^资金日历/,
      manage: /^计划管理/,
    }

    for (const shot of SHOTS) {
      const pattern = labels[shot.page]
      if (pattern === undefined) throw new Error(`未知页面 ${shot.page}`)
      await page.getByRole('button', { name: pattern }).click()
      await page.waitForTimeout(400)
      const target = path.join(OUT_DIR, shot.file)
      await page.screenshot({ path: target, fullPage: true })
      console.log(`已截图 ${path.relative(root, target)}｜${shot.note}`)
    }

    if (errors.length > 0) throw new Error(`截图过程中出现控制台错误：\n${errors.join('\n')}`)
    return 0
  } finally {
    await browser.close()
    await server.close()
  }
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
