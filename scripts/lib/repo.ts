/**
 * 脚本共用的仓库路径、原子写入与提交信息。
 *
 * 写入一律 UTF-8 无 BOM、LF；先写临时文件再改名，避免中断后留下半份正式产物。
 * 时间只取提交时间（git log），不读系统时钟（AGENTS.md §3）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const CACHE_DIR = path.join(REPO_ROOT, '.cache')
export const REPORT_DIR = path.join(CACHE_DIR, 'report')

/** 认定“最后一次改动代码和数据”的路径（不含产出目录，重跑才不会自己改变哈希） */
export const CODE_PATHS = ['src', 'scripts', 'tests', 'fixtures'] as const

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments)
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8')
}

export function readTextIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function readJsonIfExists<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  try {
    writeFileSync(temp, text, { encoding: 'utf8' })
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** 写仓库内文件（相对路径），UTF-8 无 BOM、LF */
export function writeRepoFile(relativePath: string, text: string): void {
  writeAtomic(repoPath(relativePath), text)
}

/** 写绝对路径文件，UTF-8 无 BOM、LF */
export function writeFileAtomic(file: string, text: string): void {
  writeAtomic(file, text)
}

export type CommitInfo = {
  /** 短哈希；仓库没有提交时为空字符串 */
  hash: string
  /** 提交时间，ISO 8601 带时区；仓库没有提交时为空字符串 */
  time: string
}

/** git log -1 的最后一次改动代码与数据的提交；不读系统时钟 */
export function codeCommitInfo(): CommitInfo {
  try {
    const text = execFileSync('git', ['log', '-1', '--format=%h%x09%cI', '--', ...CODE_PATHS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
    const [hash = '', time = ''] = text.split('\t')
    return { hash, time }
  } catch {
    return { hash: '', time: '' }
  }
}

/** 运行 git 子命令，返回 stdout（去掉首尾空白）；失败时抛出带命令的说明 */
export function git(args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true }).trim()
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    throw new Error(`git ${args.join(' ')} 失败：${message}`)
  }
}

/** 提交时间里的日期部分（YYYY-MM-DD） */
export function commitDate(info: CommitInfo): string {
  return info.time.slice(0, 10)
}

export function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}

/** 列出目录下指定后缀的文件名（已排序）；目录不存在时抛错，由调用方决定是否容忍 */
export function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`)
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .sort()
}
