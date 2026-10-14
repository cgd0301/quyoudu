/**
 * 仅限人工运行
 *
 * 清空本仓库 oracle/（保留 .gitkeep），再从 ../quyoudu-oracle 复制：
 * oracle/（排除 __pycache__）、AMBIGUOUS.md、oracle_inputs.json。
 */
import { access, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

async function requireSource(file: string, label: string): Promise<void> {
  try {
    await access(file)
  } catch (error) {
    if (isEnoent(error)) throw new Error(`缺少 ${label}`)
    throw error
  }
}

/** 先确认来源齐全，再清空目标，避免缺文件时抹掉已有参考实现 */
export async function importOracle(sourceRoot: string, targetOracleDir: string): Promise<string[]> {
  await requireSource(path.join(sourceRoot, 'oracle'), 'oracle/')
  await requireSource(path.join(sourceRoot, 'AMBIGUOUS.md'), 'AMBIGUOUS.md')
  await requireSource(path.join(sourceRoot, 'oracle_inputs.json'), 'oracle_inputs.json')
  await clearExceptGitkeep(targetOracleDir)
  const copied: string[] = []
  await copyTree(path.join(sourceRoot, 'oracle'), targetOracleDir, '', copied)
  await copyFile(path.join(sourceRoot, 'AMBIGUOUS.md'), path.join(targetOracleDir, 'AMBIGUOUS.md'))
  await copyFile(path.join(sourceRoot, 'oracle_inputs.json'), path.join(targetOracleDir, 'oracle_inputs.json'))
  copied.push('AMBIGUOUS.md', 'oracle_inputs.json')
  return copied.sort()
}

async function clearExceptGitkeep(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue
    await rm(path.join(dir, entry.name), { recursive: true, force: true })
  }
  const keep = path.join(dir, '.gitkeep')
  try {
    await access(keep)
  } catch (error) {
    if (!isEnoent(error)) throw error
    await writeFile(keep, '', 'utf8')
  }
}

async function copyTree(source: string, target: string, prefix: string, copied: string[]): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true })
  await mkdir(target, { recursive: true })
  for (const entry of entries) {
    if (entry.name === '__pycache__') continue
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) await copyTree(from, to, relative, copied)
    else if (entry.isFile()) {
      await copyFile(from, to)
      copied.push(relative)
    }
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  const target = path.join(repoRoot, 'oracle')
  importOracle(path.resolve(repoRoot, '..', 'quyoudu-oracle'), target)
    .then((files) => {
      console.log(`已导入 ${files.length} 个文件到 ${target}`)
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
