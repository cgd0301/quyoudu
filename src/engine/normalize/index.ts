import type { CaseFile } from '../schema.ts'

type CamelKey<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Head}${Capitalize<CamelKey<Tail>>}` : S

type Camelize<T> = T extends readonly (infer Item)[]
  ? Camelize<Item>[]
  : T extends object
    ? { [K in keyof T as K extends string ? CamelKey<K> : K]: Camelize<T[K]> }
    : T

export type NormalizedCase = Camelize<CaseFile> & {
  snapshot: Camelize<CaseFile['snapshot']> & {
    livingArrangement: 'PROVIDED' | 'NOT_PROVIDED'
  }
}

function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => camelize(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[camelKey(key)] = camelize(inner)
    return out
  }
  return value
}

/** 读入案例后按 §9.1 转为 camelCase；省略的生活安排视为 PROVIDED（D59） */
export function normalize(data: CaseFile): NormalizedCase {
  const camel = camelize(structuredClone(data)) as NormalizedCase
  if (camel.snapshot.livingArrangement === undefined) camel.snapshot.livingArrangement = 'PROVIDED'
  return camel
}
