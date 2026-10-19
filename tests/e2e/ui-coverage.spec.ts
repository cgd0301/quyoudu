import { expect, test, type Page } from '@playwright/test'

/**
 * UI 层子用例的端到端覆盖（证据映射见 docs/_work/test_layers.md）。
 *
 * 约定：每个 test 标题必须以子用例编号开头（T+3 位数字-2 位数字），
 * scripts/lib/results.ts 只从标题开头提取编号，因此一个 test 只对应一条子用例。
 * 断言只针对界面真实存在的行为与文案；界面没有的展示位置不写“通过”，
 * 而是在 docs/_work/test_layers.md 的覆盖矩阵里标“未覆盖”并写明原因。
 */

let consoleErrors: string[] = []

test.beforeEach(async ({ page }) => {
  consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.goto('/')
})

test.afterEach(() => {
  expect(consoleErrors, `控制台出现错误：\n${consoleErrors.join('\n')}`).toEqual([])
})

async function gotoCompare(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^方案比较/ }).click()
  await expect(page.getByRole('heading', { name: '本次推荐' })).toBeVisible()
}

async function selectC02(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择方案 C02' }).click()
  await expect(page.getByText('待用户确认', { exact: true })).toBeVisible()
}

async function confirmPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: '确认方案' }).click()
  await expect(page.getByText('已确认', { exact: true })).toBeVisible()
}

test('T013-05 四页都显示“模拟数据”标识', async ({ page }) => {
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()
  await gotoCompare(page)
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^资金日历/ }).click()
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^计划管理/ }).click()
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()
})

test('T009-02 选择 C02 后住宿报价标注为估算，不称为已核实报价', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  // C02 的住宿价格依据是 REFERENCE，界面必须显示为“有效参考价，估算”
  await expect(page.getByText('有效参考价，估算')).toBeVisible()
  await expect(page.getByText(/已核实|保证成交|保证同价/)).toHaveCount(0)
})

test('T009-04 价格依据显示为模拟报价并带模拟数据标识', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await expect(page.getByText('有效参考价，估算')).toBeVisible()
  await expect(page.getByText('280.00 元').first()).toBeVisible()
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()
})

test('UI 补充：比较页显示已评估范围与子集结论', async ({ page }) => {
  await gotoCompare(page)
  await expect(page.getByText('已评估')).toBeVisible()
  await expect(page.getByText('结论仅覆盖本次列出的已知候选与演示配置。')).toBeVisible()
})

test('UI 补充：比较页不宣称全部候选最低或全部无解', async ({ page }) => {
  await gotoCompare(page)
  await expect(page.getByText('结论仅覆盖本次列出的已知候选与演示配置。')).toBeVisible()
  await expect(page.getByText(/全部已知候选|全部候选最低|所有方案均无解|全部无解/)).toHaveCount(0)
})

test('T011-05 金额表述为预计消费净支出，不表述为确定成本', async ({ page }) => {
  await gotoCompare(page)
  await expect(page.getByRole('columnheader', { name: '预计消费净支出' })).toBeVisible()
  await expect(page.getByText(/确定成本|实际总成本|最终成本/)).toHaveCount(0)
})

test('T012-01 取消计划后不出现“取消=0 元”或“取消最省钱”', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await confirmPlan(page)
  await page.getByRole('button', { name: /^计划管理/ }).click()
  await page.getByRole('button', { name: '取消计划' }).click()
  await expect(page.getByText('计划已取消')).toBeVisible()
  await expect(page.getByText(/取消[^。！？\n]{0,8}0\s*元|取消最省|取消更省/)).toHaveCount(0)
})

test('T016-04 说明 K=3 是演示配置，不是最终定案', async ({ page }) => {
  await gotoCompare(page)
  await expect(page.getByText('K=3（演示配置v1）').first()).toBeVisible()
  await expect(page.getByText('结论仅覆盖本次列出的已知候选与演示配置。')).toBeVisible()
})

test('T017-01 未确认时资金日历标“草案预览，未确认”', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await page.getByRole('button', { name: /^资金日历/ }).click()
  await expect(page.locator('.calendar-state').getByText('草案预览', { exact: true })).toBeVisible()
  await expect(page.locator('.calendar-state').getByText('预览，未确认', { exact: true })).toBeVisible()
})

test('T017-04 选择方案后显示“建议分配额（不减少今日可额外支出）”', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await expect(page.getByText('建议分配额（不减少今日可额外支出）')).toBeVisible()
})

test('T017-09 无独立购买日历，资金日历分别标注购买日与付款日', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await page.getByRole('button', { name: /^资金日历/ }).click()
  await expect(page.getByRole('heading', { name: '购买日历' })).toHaveCount(0)
  await expect(page.getByText('购买日期与付款日期分别列示。预计收入按到账前提参与模拟，不表示已到账。')).toBeVisible()
  await expect(page.locator('.timeline-row', { hasText: '购买日' }).first()).toBeVisible()
  await expect(page.locator('.timeline-row', { hasText: '付款' }).first()).toBeVisible()
})

test('T017-12 确认后再看方案比较，仍显示“建议分配额（不减少今日可额外支出）”', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await confirmPlan(page)
  await page.getByRole('button', { name: /^方案比较/ }).click()
  await expect(page.getByText('建议分配额（不减少今日可额外支出）')).toBeVisible()
  await expect(page.getByRole('button', { name: '再次确认方案' })).toBeVisible()
})

test('UI 补充：历史覆盖只展示覆盖情况，不给出覆盖金额', async ({ page }) => {
  await gotoCompare(page)
  await expect(page.getByRole('heading', { name: '历史覆盖' })).toBeVisible()
  await expect(page.getByText('历史不足 · 当前基础安排仍可检查')).toBeVisible()
  await expect(page.locator('.scenario-section').getByText(/元/)).toHaveCount(0)
})

test('T018-09 付款缺口只展示最早缺口、金额与依据，不显示失败概率', async ({ page }) => {
  await gotoCompare(page)
  await selectC02(page)
  await confirmPlan(page)
  await page.getByRole('button', { name: /^计划管理/ }).click()
  await page.getByRole('tab', { name: '收入延期' }).click()
  await page.getByLabel('调整后的到账日期').fill('2026-11-20')
  await page.getByRole('button', { name: '更新收入日期' }).click()
  await expect(page.getByText(/最早缺口 · \d{4}\.\d{2}\.\d{2}/)).toBeVisible()
  await expect(page.locator('.gap-summary').getByText(/\d+\.\d{2} 元/)).toBeVisible()
  await expect(page.getByText(/失败概率|成功概率|概率是多少/)).toHaveCount(0)
})

test('T020-06 价格趋势用模拟数据标识，不表述为真实预测效果', async ({ page }) => {
  await expect(page.getByText(/条模拟观测 · 不作确定报价/)).toBeVisible()
  await expect(page.getByText(/预测准确率|准确率|真实预测效果/)).toHaveCount(0)
})

test('T020-09 价格趋势不显示为确定报价', async ({ page }) => {
  // 概览页的“价格趋势”只给状态与样本数，并明确“不作确定报价”
  await expect(page.getByText(/条模拟观测 · 不作确定报价/)).toBeVisible()
  await gotoCompare(page)
  await expect(page.getByText('预测不可用')).toBeVisible()
  await expect(page.getByText(/确定报价[:：]/)).toHaveCount(0)
})
