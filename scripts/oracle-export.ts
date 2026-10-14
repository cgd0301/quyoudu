/**
 * 仅限人工运行
 *
 * 把独立对拍（oracle）需要的规格与数据复制到 ../quyoudu-oracle/，目录结构与本仓库相同：
 * docs/rules.md、policy_card.md、scope.md；traceability.csv 去掉“预期结果”列，存为 docs/traceability_noexpect.csv；
 * docs/_work 下的 JSON Schema；fixtures/cases/*.json；fixtures/vectors/*.json（删去 expect 与 source_text）；
 * scripts/oracle-template/AGENTS.md 放到目标根目录。不复制 src/ 和 tests/。
 * 目标中的 fixtures/cases、fixtures/vectors 先清空再写，其他目录不动。
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, stringifyCsv } from './lib/csv.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export const ORACLE_DIR = path.resolve(repoRoot, '..', 'quyoudu-oracle')

const DOCS = ['docs/rules.md', 'docs/policy_card.md', 'docs/scope.md']
const TRACEABILITY = 'docs/traceability.csv'
const TRACEABILITY_NOEXPECT = 'docs/traceability_noexpect.csv'
const SCHEMA_DIR = 'docs/_work'
const CASES_DIR = 'fixtures/cases'
const VECTORS_DIR = 'fixtures/vectors'
const TEMPLATE = 'scripts/oracle-template/AGENTS.md'
const EXPECTED_COLUMN = '预期结果'
const HIDDEN_VECTOR_FIELDS = ['expect', 'source_text']

export function stripExpectedColumn(csvText: string): string {
  const rows = parseCsv(csvText)
  const column = rows[0]?.indexOf(EXPECTED_COLUMN) ?? -1
  if (column < 0) throw new Error(`${TRACEABILITY} 没有“${EXPECTED_COLUMN}”列`)
  return `${stringifyCsv(rows.map((row) => row.filter((_cell, index) => index !== column)))}\n`
}

export function stripVector(jsonText: string): string {
  const vector: unknown = JSON.parse(jsonText)
  if (vector === null || typeof vector !== 'object' || Array.isArray(vector)) throw new Error('测试向量须为 JSON 对象')
  const kept = Object.fromEntries(Object.entries(vector).filter(([key]) => !HIDDEN_VECTOR_FIELDS.includes(key)))
  return `${JSON.stringify(kept, null, 2)}\n`
}

async function listFiles(root: string, dir: string, accept: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && accept(entry.name))
    .map((entry) => `${dir}/${entry.name}`)
    .sort()
}

function isSchemaFile(name: string): boolean {
  return name === 'schema.json' || name.endsWith('.schema.json')
}

/** 返回写入目标目录的文件（相对路径，按字母排序） */
export async function exportOracle(sourceRoot: string, targetRoot: string): Promise<string[]> {
  const read = (relativePath: string) => readFile(path.join(sourceRoot, relativePath), 'utf8')
  const outputs = new Map<string, string>()
  for (const file of DOCS) outputs.set(file, await read(file))
  outputs.set(TRACEABILITY_NOEXPECT, stripExpectedColumn(await read(TRACEABILITY)))
  for (const file of await listFiles(sourceRoot, SCHEMA_DIR, isSchemaFile)) outputs.set(file, await read(file))
  for (const file of await listFiles(sourceRoot, CASES_DIR, (name) => name.endsWith('.json'))) outputs.set(file, await read(file))
  for (const file of await listFiles(sourceRoot, VECTORS_DIR, (name) => name.endsWith('.json'))) {
    outputs.set(file, stripVector(await read(file)))
  }
  outputs.set('AGENTS.md', await read(TEMPLATE))

  for (const dir of [CASES_DIR, VECTORS_DIR]) await rm(path.join(targetRoot, dir), { recursive: true, force: true })
  for (const [file, text] of outputs) {
    const target = path.join(targetRoot, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }
  return [...outputs.keys()].sort()
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  exportOracle(repoRoot, ORACLE_DIR)
    .then((files) => {
      console.log(`已导出 ${files.length} 个文件到 ${ORACLE_DIR}`)
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
}
