import { expect, test } from '@playwright/test'

test('reviews a simulated plan and confirms a feasible candidate', async ({ page }) => {
  // 控制台错误与未捕获异常都算失败：界面不得在运行时报错
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

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

  // 第四页：确认后应能进入计划管理并看到购买行动清单
  await page.getByRole('button', { name: /^计划管理/ }).click()
  await expect(page.getByRole('heading', { name: '计划管理' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '购买行动清单' })).toBeVisible()
  await expect(page.getByText('待购买').first()).toBeVisible()

  expect(consoleErrors, `控制台出现错误：\n${consoleErrors.join('\n')}`).toEqual([])
})
