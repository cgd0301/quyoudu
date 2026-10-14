import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { canonicalWire, flowFileSchema } from '../../scripts/golden-write.ts'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'
import { REPO_ROOT } from '../lib/vector.ts'

function resultNames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.result.json'))
      .sort()
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

const casesDir = path.join(REPO_ROOT, 'tests/golden/cases')
const flowsDir = path.join(REPO_ROOT, 'tests/golden/flows')
const caseNames = resultNames(casesDir)
const flowNames = resultNames(flowsDir)

test.skipIf(caseNames.length === 0)('tests/golden/cases 与引擎输出一致', () => {
  for (const name of caseNames) {
    const caseId = name.slice(0, -'.result.json'.length)
    const fixture = path.join(REPO_ROOT, 'fixtures/cases', `${caseId}.json`)
    const data = caseFileSchema.parse(JSON.parse(readFileSync(fixture, 'utf8')))
    const actual = canonicalWire(evaluate(data, [], DEMO_CFG_1))
    const expected = readFileSync(path.join(casesDir, name), 'utf8')
    expect(actual, name).toBe(expected)
  }
})

test.skipIf(flowNames.length === 0)('tests/golden/flows 与引擎输出一致', () => {
  for (const name of flowNames) {
    const flowId = name.slice(0, -'.result.json'.length)
    const fixture = path.join(REPO_ROOT, 'fixtures/flows', `${flowId}.json`)
    const flow = flowFileSchema.parse(JSON.parse(readFileSync(fixture, 'utf8')))
    const actual = canonicalWire(evaluate(flow.input, flow.ops, DEMO_CFG_1))
    const expected = readFileSync(path.join(flowsDir, name), 'utf8')
    expect(actual, name).toBe(expected)
  }
})
