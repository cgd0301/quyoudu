import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { buildSchemaFiles } from '../../scripts/export-schemas.ts'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import * as enums from '../../src/engine/enums.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { MODULES, doneModules } from '../../src/engine/modules.ts'
import { moneyPaths } from '../../src/engine/money.ts'
import {
  ENGINE_OP_TYPES,
  FINAL_CHECKPOINT_LABEL,
  OP_TYPES,
  UI_OP_TYPES,
  WHITELIST_OP_TYPES,
  ensureCheckpoint,
  opSchema,
  type Op,
} from '../../src/engine/ops/index.ts'
import { LABEL_TEXT, moneySchema, resultCoreSchema, type Money, type ResultCore } from '../../src/engine/result.ts'
import { caseFileSchema } from '../../src/engine/schema.ts'
import { toSnakeKey, toWire } from '../../src/engine/wire.ts'
import { AS_OF, c01 } from './samples.ts'

function readRepo(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

function sectionOf(text: string, start: string, end: string): string {
  const from = text.indexOf(start)
  const to = text.indexOf(end, from + start.length)
  expect(from, start).toBeGreaterThanOrEqual(0)
  expect(to, end).toBeGreaterThan(from)
  return text.slice(from, to)
}

function money(value: number, rules: string[] = ['§1'], eventIds: string[] = [], reserveIds: string[] = []): Money {
  return { value, basis: { eventIds, reserveIds, rules } }
}

/** 只用于检查结构，数值不是引擎预期 */
function shapeSample(): ResultCore {
  const balances = {
    cash: money(100000),
    livingReserve: money(30000, ['§1'], [], ['R-LIV-09']),
    otherProtectedReserve: money(0),
    otherGoalHold: money(0),
    contingencyReserve: money(20000, ['§1'], [], ['R-CON']),
    goalAllocation: money(40000),
    goalAvailable: money(70000),
    paymentHeadroom: money(50000),
    unallocated: money(10000),
    protectedTotal: money(50000),
  }
  const gap = {
    nodeIndex: 1,
    at: '2026-09-10',
    nodeVerdict: 'PROTECTED_SHORTFALL' as const,
    amount: money(15000, ['D05', 'D34'], ['E1']),
    related: ['E1'],
  }
  return {
    asOf: AS_OF,
    inputVersion: 'v1',
    configVersion: 'DEMO-CFG-1',
    topKLabel: 'K=3（演示配置v1）',
    checkPeriod: { start: AS_OF, end: '2027-01-01', outOfRange: false },
    inputIssues: [{ code: 'SPEC_NOT_COVERED', rule: '§8', refs: [] }],
    snapshot: { ...balances, issues: [{ nodeVerdict: 'ALLOCATION_CONFLICT', amount: money(10000, ['D05']) }] },
    nodes: [
      {
        at: AS_OF,
        trigger: { kind: 'START', eventIds: [] },
        ...balances,
        nodeVerdict: 'PASS',
        amount: null,
        protectedOverCash: null,
        allocationUnsupported: null,
        related: [],
      },
      {
        at: '2026-09-10',
        trigger: { kind: 'OUTFLOW', eventIds: ['E1'] },
        ...balances,
        nodeVerdict: 'PROTECTED_SHORTFALL',
        amount: money(15000, ['D05', 'D34'], ['E1']),
        protectedOverCash: money(15000, ['D34']),
        allocationUnsupported: money(0, ['D34']),
        related: ['E1'],
      },
    ],
    earliestGap: gap,
    gapList: [gap],
    constraintIssues: {
      budgetOverrun: money(5000, ['§3']),
      allocationConflicts: [{ ...gap, nodeIndex: 0, at: AS_OF, nodeVerdict: 'ALLOCATION_CONFLICT', related: [] }],
    },
    cost: {
      paidTotal: money(58000, ['§3'], ['E0']),
      futurePayable: money(42000),
      eligibleReturn: money(0),
      netSpend: money(100000),
      netSpendIfReceived: money(95000, ['D12']),
      budgetOverrun: money(10000),
      paidPayments: [{ eventId: 'E0', costItemId: 'TICKET', at: '2026-08-20', amount: money(58000) }],
      futurePayments: [{ eventId: 'E1', costItemId: 'LODGING', at: '2026-09-10', amount: money(42000) }],
      protectedReserves: { livingReserve: money(30000), otherProtectedReserve: money(0), otherGoalHold: money(0) },
      contingencyReserve: money(20000),
      pendingCostItemIds: [],
      possibleRefund: { amount: money(15000, ['R012']), condition: '平台审核通过' },
    },
    dependencies: [{ kind: 'EXPECTED_INCOME', refs: ['E-INC'], amount: money(50000), at: '2026-09-20' }],
    candidates: [
      {
        candidateId: 'C01',
        planVersion: 'C01@v1',
        evaluable: true,
        pendingReasons: [],
        excludedReasons: [{ code: 'PAYMENT_GAP', rule: 'D05', refs: ['E1'] }],
        feasible: false,
        netSpend: money(80000),
        netSpendIfReceived: money(75000, ['D12']),
        tieGroup: null,
        rank: null,
      },
    ],
    optimization: { scope: ['C01'], evaluatedCount: 1, pendingCount: 0, excludedCount: 1, topK: 3 },
    confirmation: {
      candidateId: 'C01',
      planVersion: 'C01@v1',
      inputVersion: 'v1',
      w: money(85000, ['D46']),
      m: money(20000, ['D46']),
      deltaA: money(30000, ['D46']),
      plannedAllocation: { fundingEventId: 'E-INC', amount: money(55000, ['D46']) },
      unallocatedNote: money(0, ['D46', 'D06']),
    },
    actionList: [
      {
        taskId: 'T-LODGING',
        costItemId: 'LODGING',
        category: 'LODGING',
        spec: '大床房',
        purchaseDate: '2026-09-10',
        channel: '渠道甲',
        offerIds: ['Y1'],
        amount: money(42000),
        paymentAt: '2026-09-27',
        pendingChecks: ['RECHECK_PRICE'],
        taskState: 'PENDING_PURCHASE',
        planVersion: 'C01@v1',
      },
    ],
    dailyReference: {
      display: 'AMOUNT',
      amount: money(10000, ['§4']),
      limitedBy: { scenario: 'CONFIRMED_ONLY', nodeIndex: 1 },
      label: 'CONFIRMED_ONLY',
      unavailable: [{ scenario: 'RECENT_MONTH', reason: 'HISTORY_INSUFFICIENT' }],
      missingReasons: [],
    },
    pendingDifferences: [{ costItemId: 'LODGING', delta: money(5000, ['R017']) }],
    userConfirmations: [],
    states: {
      planState: 'PAYMENT_GAP',
      underlyingPlanState: null,
      optimizationState: 'NO_KNOWN_FEASIBLE',
      confirmationState: 'DRAFT',
      planTarget: 'SELECTED_CANDIDATE',
    },
    forecasts: [
      {
        seriesId: 'S-LODGING',
        costItemId: 'LODGING',
        purchaseDate: '2026-10-10',
        horizon: 10,
        status: 'AVAILABLE',
        configVersion: 'DEMO-CFG-1',
        sampleCount: 30,
        historyEnd: '2026-09-30',
        alpha: '0.2',
        beta: '0.2',
        phi: '0.80',
        level: '58000.000000000000',
        trend: '0.000000000000',
        trainSse: '0.000000000000',
        predicted: '58000.000000000000',
        amount: money(58000, ['R020', 'D25']),
        backtestMae: '0.000000000000',
        baselineMae: '0.000000000000',
        backtestCount: 7,
        confirmed: false,
      },
    ],
    scenarios: [
      {
        kind: 'RECENT_MONTH',
        available: true,
        unavailableReason: null,
        configVersion: 'DEMO-CFG-1',
        observationStart: '2026-09-01',
        observationEnd: '2026-09-30',
        completeDays: 30,
        groups: [
          {
            category: 'MEALS',
            coverageStart: '2026-10-01',
            coverageEnd: '2026-10-10',
            scenarioGroupTotal: money(33333, ['§5', 'D23']),
            scheduledGroupTotal: money(30000, ['§5']),
            scenarioIncrement: money(3333, ['§5', 'D23']),
            dailyAmounts: [{ date: '2026-10-01', amount: money(334, ['D23']) }],
          },
        ],
        todayReplacement: money(0, ['D22']),
        dailyReference: money(7000, ['§4', 'D26']),
      },
    ],
    labels: ['SIMULATED_DATA', 'DAILY_DISCLAIMER', 'CONFIRMED_ONLY'],
  }
}

/** 按 moneyPaths 的写法（a.b[].c）取出全部值 */
function resolvePath(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root]
  for (const segment of path.split('.')) {
    const spread = segment.endsWith('[]')
    const key = spread ? segment.slice(0, -2) : segment
    current = current.flatMap((node) => {
      if (node === null || typeof node !== 'object') return []
      const next = (node as Record<string, unknown>)[key]
      if (next === undefined || next === null) return []
      if (!spread) return [next]
      return Array.isArray(next) ? next : []
    })
  }
  return current
}

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key)
      collectKeys(inner, out)
    }
  }
  return out
}

function collectLeaves(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLeaves(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) collectLeaves(inner, out)
  } else {
    out.push(value)
  }
  return out
}

function schemaKeys(schema: z.core.$ZodType, out = new Set<string>()): Set<string> {
  if (schema instanceof z.ZodObject) {
    for (const [key, inner] of Object.entries(schema.shape)) {
      out.add(key)
      schemaKeys(inner, out)
    }
  } else if (schema instanceof z.ZodArray) {
    schemaKeys(schema.element, out)
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    schemaKeys(schema.unwrap(), out)
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) schemaKeys(option, out)
  }
  return out
}

function jsonSchemaPropertyNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) jsonSchemaPropertyNames(item, out)
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value !== null && typeof value === 'object') {
        for (const name of Object.keys(value)) out.add(name)
      }
      jsonSchemaPropertyNames(value, out)
    }
  }
  return out
}

/** rules.md §9 各表"数据字段"列中的字段名 */
function section9DataFields(): string[] {
  const body = sectionOf(readRepo('docs/rules.md'), '### 9.', '### 10.')
  const fields = new Set<string>()
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('|') || line.startsWith('|----')) continue
    const cell = line.split('|').slice(1, -1).map((part) => part.trim())[3]
    if (cell === undefined || cell === '数据字段' || cell === '—') continue
    for (const name of cell.split('、')) fields.add(name.trim())
  }
  return [...fields]
}

const SNAKE_KEY = /^[a-z][a-z0-9_]*$/
const CAMEL_KEY = /^[a-z][a-zA-Z0-9]*$/

describe('ResultCore 与 toWire', () => {
  test('结构样例通过 resultCoreSchema', () => {
    expect(resultCoreSchema.safeParse(shapeSample()).error).toBeUndefined()
  })

  test('结构样例去掉 forecasts、scenarios 后仍通过', () => {
    const { forecasts: _forecasts, scenarios: _scenarios, ...rest } = shapeSample()
    expect(resultCoreSchema.safeParse(rest).error).toBeUndefined()
  })

  test('金额不是整数分时被拒绝', () => {
    const sample = shapeSample()
    sample.nodes[0].cash.value = 1000.5
    expect(resultCoreSchema.safeParse(sample).success).toBe(false)
  })

  test('toSnakeKey 只在大写字母前加下划线', () => {
    expect(toSnakeKey('lodgingDistanceM')).toBe('lodging_distance_m')
    expect(toSnakeKey('deltaA')).toBe('delta_a')
    expect(toSnakeKey('topKLabel')).toBe('top_k_label')
    expect(toSnakeKey('w')).toBe('w')
    expect(toSnakeKey('as_of')).toBe('as_of')
  })

  test('toWire 只改键名：全部键为 snake_case，值和顺序不变', () => {
    const sample = shapeSample()
    const wire = toWire(sample)
    expect(collectKeys(wire).filter((key) => !SNAKE_KEY.test(key))).toEqual([])
    expect(collectLeaves(wire)).toEqual(collectLeaves(sample))
    expect(wire).toMatchObject({
      as_of: AS_OF,
      top_k_label: 'K=3（演示配置v1）',
      nodes: [{ payment_headroom: { value: 50000, basis: { event_ids: [], reserve_ids: [], rules: ['§1'] } } }, {}],
      confirmation: { delta_a: { value: 30000 }, planned_allocation: { funding_event_id: 'E-INC' } },
      states: { plan_state: 'PAYMENT_GAP' },
      daily_reference: { limited_by: { scenario: 'CONFIRMED_ONLY' } },
    })
  })

  test('toWire 不改值中的编号和枚举', () => {
    expect(toWire({ snapshotPhase: 'AFTER_EVENT(1)', candidateIds: ['C01', 'C02'], nodeVerdict: 'GAP_CONTINUED' })).toEqual({
      snapshot_phase: 'AFTER_EVENT(1)',
      candidate_ids: ['C01', 'C02'],
      node_verdict: 'GAP_CONTINUED',
    })
  })
})

describe('moneyPaths', () => {
  const paths = moneyPaths()

  test('包含各部分的关键金额路径，且不重复', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        'snapshot.cash',
        'snapshot.unallocated',
        'nodes[].unallocated',
        'nodes[].amount',
        'nodes[].protectedOverCash',
        'earliestGap.amount',
        'gapList[].amount',
        'constraintIssues.budgetOverrun',
        'cost.paidTotal',
        'cost.netSpend',
        'cost.futurePayments[].amount',
        'candidates[].netSpend',
        'confirmation.w',
        'confirmation.deltaA',
        'confirmation.plannedAllocation.amount',
        'actionList[].amount',
        'dailyReference.amount',
        'forecasts[].amount',
        'scenarios[].groups[].scenarioIncrement',
        'scenarios[].groups[].dailyAmounts[].amount',
      ]),
    )
    expect(new Set(paths).size).toBe(paths.length)
  })

  test('每条路径在结构样例上都取到 Money', () => {
    const sample = shapeSample()
    for (const path of paths) {
      const values = resolvePath(sample, path)
      expect(values.length, path).toBeGreaterThan(0)
      for (const value of values) expect(moneySchema.safeParse(value).success, path).toBe(true)
    }
  })

  test('计数、序号和步长不登记为金额', () => {
    for (const path of ['optimization.topK', 'candidates[].rank', 'forecasts[].horizon', 'nodes[].trigger']) {
      expect(paths).not.toContain(path)
    }
  })
})

describe('命名与枚举', () => {
  test('枚举值都是大写下划线写法（§9.1）', () => {
    const exported: [string, unknown][] = Object.entries(enums)
    const arrays = exported.filter((entry): entry is [string, readonly string[]] => Array.isArray(entry[1]))
    expect(arrays.length).toBeGreaterThan(20)
    for (const [name, values] of arrays) {
      expect(values.length, name).toBeGreaterThan(0)
      for (const value of values) expect(value, name).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(new Set(values).size, name).toBe(values.length)
    }
  })

  test('CaseFile 与 Op 的键为 snake_case，ResultCore 的键为 camelCase', () => {
    expect([...schemaKeys(caseFileSchema)].filter((key) => !SNAKE_KEY.test(key))).toEqual([])
    expect([...schemaKeys(opSchema)].filter((key) => !SNAKE_KEY.test(key))).toEqual([])
    expect([...schemaKeys(resultCoreSchema)].filter((key) => !CAMEL_KEY.test(key))).toEqual([])
  })

  test('§9 各表"数据字段"列的字段都出现在导出的 JSON Schema 中', () => {
    const fields = section9DataFields()
    expect(fields).toEqual(expect.arrayContaining(['as_of', 'snapshot_phase', 'lodging_max_distance_m', 'plan_state']))
    const names = new Set<string>()
    for (const content of Object.values(buildSchemaFiles())) jsonSchemaPropertyNames(JSON.parse(content), names)
    expect(fields.filter((field) => !names.has(field))).toEqual([])
  })

  test('LABEL_TEXT 与 rules.md §11.4 原文一致', () => {
    const fixedText = sectionOf(readRepo('docs/rules.md'), '#### 11.4', '#### 11.5')
    for (const [code, text] of Object.entries(LABEL_TEXT)) {
      if (code === 'SIMULATED_DATA') continue
      expect(fixedText, code).toContain(text)
    }
    expect(LABEL_TEXT.SIMULATED_DATA).toBe('模拟数据')
    expect(Object.keys(LABEL_TEXT).sort()).toEqual([...enums.LABEL_CODES].sort())
  })

  test('DEMO-CFG-1 的 K 与标签', () => {
    expect(DEMO_CFG_1.configVersion).toBe('DEMO-CFG-1')
    expect(DEMO_CFG_1.topK).toBe(3)
    expect(DEMO_CFG_1.topKLabel).toBe(LABEL_TEXT.TOP_K_DEMO)
  })
})

describe('操作分组与检查点', () => {
  test('OP_TYPES 与 opSchema 的判别值一一对应', () => {
    const discriminators = opSchema.options.map((option) => option.shape.type.value)
    expect([...discriminators].sort()).toEqual([...OP_TYPES].sort())
  })

  test('D29 白名单共 7 种，界面可用操作不含 PATCH 与 EVALUATE（D58）', () => {
    expect(WHITELIST_OP_TYPES).toHaveLength(7)
    expect(ENGINE_OP_TYPES).toEqual(['PATCH'])
    expect(UI_OP_TYPES).not.toContain('PATCH')
    expect(UI_OP_TYPES).not.toContain('EVALUATE')
  })

  test('ops 中没有 EVALUATE 时在末尾补一个', () => {
    const setAllocation: Op = { type: 'SET_ALLOCATION', goal_allocation: 60000 }
    expect(ensureCheckpoint([])).toEqual([{ type: 'EVALUATE', label: FINAL_CHECKPOINT_LABEL }])
    expect(ensureCheckpoint([setAllocation])).toEqual([setAllocation, { type: 'EVALUATE', label: 'final' }])
    const withCheckpoint: Op[] = [{ type: 'EVALUATE', label: 'v1' }, setAllocation]
    expect(ensureCheckpoint(withCheckpoint)).toEqual(withCheckpoint)
  })
})

describe('导出与占位', () => {
  test('docs/_work 下的 JSON Schema 与 schema 定义同步（改了 schema 要运行 pnpm schema:export）', () => {
    const files = buildSchemaFiles()
    expect(Object.keys(files).sort()).toEqual([
      'docs/_work/ops.schema.json',
      'docs/_work/result.schema.json',
      'docs/_work/schema.json',
    ])
    for (const [file, content] of Object.entries(files)) {
      expect(readRepo(file).replace(/\r\n/g, '\n'), file).toBe(content)
    }
  })

  test('evaluate 返回通过 resultCoreSchema 的检查点', () => {
    const output = evaluate(c01(), [], DEMO_CFG_1)
    expect(output.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['final'])
    expect(resultCoreSchema.safeParse(output.checkpoints[0]?.result).success).toBe(true)
  })

  test('doneModules 都在 MODULES 中且不重复', () => {
    expect(doneModules.filter((id) => !MODULES.includes(id))).toEqual([])
    expect(new Set(doneModules).size).toBe(doneModules.length)
  })
})
