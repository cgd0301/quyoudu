import { z } from 'zod'
import { moneySchema, resultCoreSchema } from './result.ts'

function collect(schema: z.core.$ZodType, path: string, out: string[]): void {
  if (schema === moneySchema) {
    out.push(path)
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    collect(schema.unwrap(), path, out)
  } else if (schema instanceof z.ZodArray) {
    collect(schema.element, `${path}[]`, out)
  } else if (schema instanceof z.ZodObject) {
    for (const [key, inner] of Object.entries(schema.shape)) collect(inner, path === '' ? key : `${path}.${key}`, out)
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) collect(option, path, out)
  }
}

const MONEY_PATHS: readonly string[] = (() => {
  const out: string[] = []
  collect(resultCoreSchema, '', out)
  return out
})()

/**
 * ResultCore 中全部金额字段的路径（camelCase，数组写作 []），如 nodes[].unallocated。
 * D32、D52 的"_cents 值"即这些路径上 Money 的 value。
 */
export function moneyPaths(): string[] {
  return [...MONEY_PATHS]
}
