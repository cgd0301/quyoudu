import { expect, test } from 'vitest'
import { checkGolden } from '../../scripts/golden-check.ts'

test('tests/golden 的 SHA-256 与 golden.lock 一致', async () => {
  const result = await checkGolden()
  expect(result.ok, result.message).toBe(true)
})
