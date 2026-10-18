import { expect, test } from '@playwright/test'

test('reviews a simulated plan and confirms a feasible candidate', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/趣有度/)
  await expect(page.getByRole('heading', { name: '上海演唱会' })).toBeVisible()
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()

  // 侧栏导航按钮带计数徽标（文案为“方案比较 3”），另有一个“查看方案比较”的正文按钮；
  // 用锚定前缀只选中侧栏导航，避免 strict mode 命中两个元素
  await page.getByRole('button', { name: /^方案比较/ }).click()
  await expect(page.getByText('K=3（演示配置v1）', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '本次推荐' })).toBeVisible()

  await page.getByRole('button', { name: '选择方案 C02' }).click()
  await expect(page.getByText('待用户确认', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认方案' }).click()

  await expect(page.getByText('已确认', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^资金日历/ }).click()
  await expect(page.getByRole('heading', { name: '资金日历' })).toBeVisible()
  // 该页副标题由目标名与所选方案拼成（goal.name 去掉“资金”后缀），不渲染“上海演唱会资金”
  await expect(page.getByText('上海演唱会 · 方案 C02')).toBeVisible()
  await expect(page.getByText('检查起点')).toBeVisible()
})
