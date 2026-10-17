import { defineConfig } from '@playwright/test'

// 端口可由 E2E_PORT 指定，避免两个工作树或一次并发运行抢 5173（A5-prep）
const port = process.env.E2E_PORT ?? '5173'
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  reporter: [['list'], ['json', { outputFile: '.cache/report/playwright.json' }]],
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
})
