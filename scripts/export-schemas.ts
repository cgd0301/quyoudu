/**
 * 用 z.toJSONSchema 导出数据契约，写入 docs/_work/：
 * schema.json（CaseFile）、result.schema.json（ResultCore，键名为 toWire() 之后的 snake_case）、ops.schema.json（Op 数组）。
 * tests/unit/contract.test.ts 检查这三个文件与 schema 定义同步。
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { opsSchema } from '../src/engine/ops/index.ts'
import { resultCoreSchema } from '../src/engine/result.ts'
import { caseFileSchema } from '../src/engine/schema.ts'
import { toSnakeKey } from '../src/engine/wire.ts'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 只改 properties 的键名和 required 中的名字，与 toWire() 对 ResultCore 的转换一致 */
function toWireJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toWireJsonSchema)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value !== null && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, inner]) => [toSnakeKey(name), toWireJsonSchema(inner)]),
      )
    } else if (key === 'required' && Array.isArray(value)) {
      out[key] = value.map((name: unknown) => (typeof name === 'string' ? toSnakeKey(name) : name))
    } else {
      out[key] = toWireJsonSchema(value)
    }
  }
  return out
}

function serialize(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}

export function buildSchemaFiles(): Record<string, string> {
  return {
    'docs/_work/schema.json': serialize(z.toJSONSchema(caseFileSchema)),
    'docs/_work/result.schema.json': serialize(toWireJsonSchema(z.toJSONSchema(resultCoreSchema))),
    'docs/_work/ops.schema.json': serialize(z.toJSONSchema(opsSchema)),
  }
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  for (const [relativePath, content] of Object.entries(buildSchemaFiles())) {
    writeFileSync(path.join(rootDir, relativePath), content, 'utf8')
    console.log(`已写入 ${relativePath}`)
  }
}
