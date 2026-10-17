import { expect, test } from '@playwright/test'

test('reviews a simulated plan and confirms a feasible candidate', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/趣有度/)
  await expect(page.getByRole('heading', { name: '上海演唱会' })).toBeVisible()
  await expect(page.getByText('模拟数据', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '方案比较' }).click()
  await expect(page.getByText('K=3（演示配置v1）')).toBeVisible()
  await expect(page.getByRole('heading', { name: '本次推荐' })).toBeVisible()

  await page.getByRole('button', { name: '选择方案 C02' }).click()
  await expect(page.getByText('待用户确认', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认方案' }).click()

  await expect(page.getByText('已确认', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '资金日历' }).click()
  await expect(page.getByRole('heading', { name: '资金日历' })).toBeVisible()
  await expect(page.getByText('上海演唱会资金')).toBeVisible()
})
