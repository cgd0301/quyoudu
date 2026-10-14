/**
 * pnpm vector:modules
 * 为每个向量计算所需模块，写入 tests/vector-modules.json 与 docs/_work/vector_modules.md。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODULES, type ModuleId } from '../src/engine/modules.ts'
import { loadVectorFiles, vectorSchema, type Expectation, type Vector } from '../tests/lib/vector.ts'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 纠正个别分错的向量。有条目时覆盖自动归类，编号必须对应现有向量。 */
const OVERRIDES: Record<string, { module: ModuleId; reason: string }> = {}

const MODULE_NAMES: Record<ModuleId, string> = {
  M1: '输入、操作与快照',
  M2: '价格项与优惠（单个候选）',
  M3: '时间轴、检查期间与节点判定',
  M4: '成本、状态与依赖',
  M5: '候选比较与 Top-K',
  M6: '确认与行动清单',
  M7: '每日参考',
  M8: 'Holt 预测',
  M9: '消费情景',
}

const FIELD_MODULE: Record<string, ModuleId> = {
  as_of: 'M1',
  input_version: 'M1',
  config_version: 'M1',
  input_issues: 'M1',
  snapshot: 'M1',
  user_confirmations: 'M1',
  nodes: 'M3',
  earliest_gap: 'M3',
  gap_list: 'M3',
  check_period: 'M3',
  cost: 'M4',
  states: 'M4',
  dependencies: 'M4',
  candidates: 'M5',
  optimization: 'M5',
  top_k_label: 'M5',
  confirmation: 'M6',
  action_list: 'M6',
  pending_differences: 'M6',
  daily_reference: 'M7',
  forecasts: 'M8',
  scenarios: 'M9',
}

const LABEL_MODULE: Record<string, ModuleId> = {
  TOP_K_DEMO: 'M5',
  SAME_PRICE: 'M5',
  IF_RECEIVED: 'M5',
  PAID_BY_UNALLOCATED_LATER: 'M6',
  NEED_CONFIRMED_PLAN: 'M7',
  UNAVAILABLE: 'M7',
  NOT_RECOMMENDED: 'M7',
  DAILY_DISCLAIMER: 'M7',
  CONFIRMED_ONLY: 'M7',
  LIVING_ARRANGEMENT_MISSING: 'M7',
  FORECAST_CONFIG_NOT_FROZEN: 'M8',
  FORECAST_UNAVAILABLE: 'M8',
  FORECAST_DISCLAIMER: 'M8',
}

function moduleNumber(id: ModuleId): number {
  return Number(id.slice(1))
}

function maxModule(left: ModuleId, right: ModuleId): ModuleId {
  return moduleNumber(left) >= moduleNumber(right) ? left : right
}

function testIdParts(id: string): [number, number, number] | null {
  const match = /^T(\d+)-(\d+)(?:#(\d+))?$/.exec(id)
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), match[3] === undefined ? 0 : Number(match[3])]
}

function compareTestId(left: string, right: string): number {
  const a = testIdParts(left)
  const b = testIdParts(right)
  if (a === null || b === null) return left < right ? -1 : left > right ? 1 : 0
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}

function firstField(testId: string, pathText: string): string {
  const match = /^([^.[]+)/.exec(pathText)
  const field = match?.[1]
  if (field === undefined || field === '') throw new Error(`${testId}：无法归类 ${pathText}`)
  return field
}

function secondField(pathText: string, field: string): string | null {
  const match = /^\.([^.[]+)/.exec(pathText.slice(field.length))
  return match?.[1] ?? null
}

function labelModule(testId: string, pathText: string, value: unknown, hasScenarios: boolean): ModuleId {
  if (typeof value !== 'string') throw new Error(`${testId}：${pathText} 的 value 不是字符串`)
  if (value === 'HISTORY_INSUFFICIENT') return hasScenarios ? 'M9' : 'M8'
  return LABEL_MODULE[value] ?? 'M4'
}

function expectationModule(testId: string, expectation: Expectation, hasScenarios: boolean): ModuleId {
  const field = firstField(testId, expectation.path)
  if (field === 'labels') {
    const value = 'value' in expectation ? expectation.value : undefined
    return labelModule(testId, expectation.path, value, hasScenarios)
  }
  if (field === 'constraint_issues') {
    const second = secondField(expectation.path, field)
    if (second === 'allocation_conflicts') return 'M3'
    if (second === 'budget_overrun') return 'M4'
    throw new Error(`${testId}：无法归类 ${expectation.path}`)
  }
  const mapped = FIELD_MODULE[field]
  if (mapped === undefined) throw new Error(`${testId}：无法归类 ${expectation.path}`)
  return mapped
}

function opFloor(type: string): ModuleId | null {
  if (type === 'CONFIRM') return 'M6'
  if (type === 'CONFIRM_FORECASTS') return 'M8'
  if (type === 'PAUSE' || type === 'CANCEL') return 'M4'
  return null
}

function requiredModule(vector: Vector): ModuleId {
  const hasScenarios = vector.expect.some((expectation) => firstField(vector.test_id, expectation.path) === 'scenarios')
  let required: ModuleId | null = null
  const bump = (moduleId: ModuleId) => {
    required = required === null ? moduleId : maxModule(required, moduleId)
  }
  for (const expectation of vector.expect) bump(expectationModule(vector.test_id, expectation, hasScenarios))
  for (const op of vector.ops) {
    const floor = opFloor(op.type)
    if (floor !== null) bump(floor)
  }
  if (required === null) throw new Error(`${vector.test_id}：没有可归类的断言或操作`)
  return required
}

function loadVectors(): Vector[] {
  const { files } = loadVectorFiles(root)
  if (files.length === 0) throw new Error('没有向量文件')
  return files.map(({ file, text }) => {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`${file} 不是 JSON`)
    }
    const parsed = vectorSchema.safeParse(data)
    if (!parsed.success) throw new Error(`${file} 不是合法向量`)
    return parsed.data
  })
}

function markdown(assigned: ReadonlyMap<string, ModuleId>): string {
  const lines = [
    '# 向量所属模块',
    '',
    '由 pnpm vector:modules 生成。所需模块取断言路径、labels 和 ops 中序号最大者；OVERRIDES 覆盖个别编号。',
    '',
  ]
  const ids = [...assigned.keys()].sort(compareTestId)
  for (const moduleId of MODULES) {
    const owned = ids.filter((id) => assigned.get(id) === moduleId)
    lines.push(`## ${moduleId} ${MODULE_NAMES[moduleId]}（${owned.length}）`, '')
    lines.push(owned.length === 0 ? '无' : owned.join('、'), '')
  }
  const overrides = Object.entries(OVERRIDES).sort((left, right) => compareTestId(left[0], right[0]))
  if (overrides.length > 0) {
    lines.push('## 覆盖', '')
    for (const [id, override] of overrides) lines.push(`- ${id} → ${override.module}：${override.reason}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function jsonText(assigned: ReadonlyMap<string, ModuleId>): string {
  const obj: Record<string, ModuleId> = {}
  for (const id of [...assigned.keys()].sort(compareTestId)) {
    const moduleId = assigned.get(id)
    if (moduleId !== undefined) obj[id] = moduleId
  }
  return `${JSON.stringify(obj, null, 2)}\n`
}

const vectors = loadVectors()
const assigned = new Map<string, ModuleId>()
const errors: string[] = []
const vectorIds = new Set(vectors.map((vector) => vector.test_id))
for (const id of Object.keys(OVERRIDES)) {
  if (!vectorIds.has(id)) errors.push(`${id}：OVERRIDES 的编号没有对应向量`)
}
for (const vector of vectors) {
  try {
    const override = OVERRIDES[vector.test_id]
    assigned.set(vector.test_id, override?.module ?? requiredModule(vector))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
}
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

const jsonPath = path.join(root, 'tests/vector-modules.json')
const mdPath = path.join(root, 'docs/_work/vector_modules.md')
await mkdir(path.dirname(jsonPath), { recursive: true })
await writeFile(jsonPath, jsonText(assigned), 'utf8')
await writeFile(mdPath, markdown(assigned), 'utf8')
for (const moduleId of MODULES) {
  const count = [...assigned.values()].filter((id) => id === moduleId).length
  console.log(`${moduleId} ${MODULE_NAMES[moduleId]} ${count}`)
}
