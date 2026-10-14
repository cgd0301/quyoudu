import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate, type EvaluateOutput } from '../../src/engine/evaluate.ts'
import { doneModules } from '../../src/engine/modules.ts'
import { resultCoreSchema } from '../../src/engine/result.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'
import { REPO_ROOT, loadVectorFiles, vectorSchema } from '../lib/vector.ts'

function undefinedKeyPaths(value: unknown, at: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => undefinedKeyPaths(item, `${at}[${index}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => {
      const here = at === '' ? key : `${at}.${key}`
      if (inner === undefined) return [here]
      return undefinedKeyPaths(inner, here)
    })
  }
  return []
}

function shapeProblems(label: string, output: EvaluateOutput): string[] {
  const problems: string[] = []
  for (const checkpoint of output.checkpoints) {
    const where = `${label} ${checkpoint.label}`
    const keys = undefinedKeyPaths(checkpoint.result, '')
    if (keys.length > 0) problems.push(`${where} 含 undefined：${keys.join('、')}`)
    const parsed = resultCoreSchema.safeParse(checkpoint.result)
    if (!parsed.success) problems.push(`${where} 未通过 resultCoreSchema：${parsed.error.message}`)
  }
  return problems
}

describe.skipIf(!doneModules.includes('M1'))('ResultCore 形状', () => {
  const caseDir = path.join(REPO_ROOT, 'fixtures/cases')
  const caseFiles = readdirSync(caseDir)
    .filter((name) => name.endsWith('.json'))
    .sort()

  for (const name of caseFiles) {
    test(name, () => {
      const data = caseFileSchema.parse(JSON.parse(readFileSync(path.join(caseDir, name), 'utf8')))
      expect(shapeProblems(name, evaluate(data, [], DEMO_CFG_1))).toEqual([])
    })
  }

  const { files } = loadVectorFiles(REPO_ROOT)
  for (const file of files) {
    const testId = path.basename(file.file, '.json')
    test(testId, () => {
      const vector = vectorSchema.parse(JSON.parse(file.text))
      expect(shapeProblems(testId, evaluate(vector.input, vector.ops, DEMO_CFG_1))).toEqual([])
    })
  }
})
