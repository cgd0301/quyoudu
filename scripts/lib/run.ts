/** 统一调用仓库内的 Node 工具；参数数组直传，不经 shell，避免引号与空格问题 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { REPO_ROOT } from './repo.ts'

export type RunResult = {
  status: number
  stdout: string
  stderr: string
}

export const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
export const VITEST_CLI = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
export const TSC_CLI = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
export const OXLINT_CLI = path.join(REPO_ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint')

function runNode(script: string, args: readonly string[]): RunResult {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const stderr = typeof result.stderr === 'string' && result.stderr !== '' ? result.stderr : (result.error?.message ?? '')
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr,
  }
}

/** 用仓库自己的 tsx 运行一个脚本 */
export function runTsx(script: string, args: readonly string[] = []): RunResult {
  return runNode(TSX_CLI, [script, ...args])
}

/** 运行 vitest（默认单次运行） */
export function runVitest(args: readonly string[]): RunResult {
  return runNode(VITEST_CLI, [...args])
}

/** 运行仓库自己的 tsc（不依赖全局 tsc） */
export function runTsc(args: readonly string[]): RunResult {
  return runNode(TSC_CLI, [...args])
}

/** 运行仓库自己的 oxlint */
export function runOxlint(args: readonly string[]): RunResult {
  return runNode(OXLINT_CLI, [...args])
}
