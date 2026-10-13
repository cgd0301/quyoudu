/**
 * 仅限人工运行
 *
 * 按 tests/golden 当前内容生成 tests/golden.lock。
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldenManifest } from './golden-check.ts'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const lockPath = path.join(rootDir, 'tests', 'golden.lock')

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  goldenManifest()
    .then(async (manifest) => {
      await writeFile(lockPath, manifest, 'utf8')
      console.log('已写入 tests/golden.lock')
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
}
