/**
 * 计算 tests/golden 下每个文件的 SHA-256，与 tests/golden.lock 比对。
 * 不一致时退出码为 1。更新 lock 只能人工运行 scripts/golden-approve.ts。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const goldenDir = path.join(rootDir, 'tests', 'golden')
const lockPath = path.join(rootDir, 'tests', 'golden.lock')

export type GoldenCheckResult = {
  ok: boolean
  message: string
}

async function collectFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }

  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

export async function goldenManifest(): Promise<string> {
  const files = await collectFiles(goldenDir)
  const relativePaths = files
    .map((file) => path.relative(rootDir, file).split(path.sep).join('/'))
    .sort()

  const lines: string[] = []
  for (const relativePath of relativePaths) {
    const bytes = await readFile(path.join(rootDir, relativePath))
    const hash = createHash('sha256').update(bytes).digest('hex')
    lines.push(`${hash}  ${relativePath}`)
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

export async function checkGolden(): Promise<GoldenCheckResult> {
  const actual = await goldenManifest()
  let expected: string
  try {
    expected = await readFile(lockPath, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return {
        ok: false,
        message: '缺少 tests/golden.lock',
      }
    }
    throw error
  }

  const normalizedActual = normalizeNewlines(actual)
  const normalizedExpected = normalizeNewlines(expected)
  if (normalizedActual !== normalizedExpected) {
    return {
      ok: false,
      message: [
        'tests/golden 的 SHA-256 与 tests/golden.lock 不一致',
        '--- tests/golden.lock',
        normalizedExpected.trimEnd(),
        '--- 实际',
        normalizedActual.trimEnd(),
      ].join('\n'),
    }
  }

  return { ok: true, message: 'golden lock 一致' }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  checkGolden()
    .then((result) => {
      if (!result.ok) {
        console.error(result.message)
        process.exit(1)
      }
      console.log(result.message)
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
}
