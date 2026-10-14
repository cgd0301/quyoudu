import { describe, expect, test } from 'vitest'
import {
  assertionSignature,
  checksForUnitRun,
  collectObservations,
  compareUnit,
  groupFailures,
  multiHitCount,
  renderReport,
  sampleLine,
  staleMessage,
  type PrecheckAssertion,
} from '../../scripts/precheck-report.ts'

/** 2026-10-15 运行 python -m oracle unit 的标准输出 */
const ORACLE_UNIT_STDOUT = `{
  "T007-05": [
    {
      "input": "4999.500000000000",
      "integer_cents": 5000,
      "rounded_12": "4999.500000000000"
    },
    {
      "input": "4999.499999999999",
      "integer_cents": 4999,
      "rounded_12": "4999.499999999999"
    }
  ],
  "T020-01": {
    "b3": "788.000000000000",
    "forecast_h2": "12874.720000000000",
    "integer_cents": 12875,
    "l3": "11740.000000000000",
    "third_one_step_error": "-300.000000000000"
  },
  "T020-11": [
    {
      "input": "4999.500000000000",
      "integer_cents": 5000,
      "rounded_12": "4999.500000000000"
    },
    {
      "input": "4999.499999999999",
      "integer_cents": 4999,
      "rounded_12": "4999.499999999999"
    }
  ]
}
`

function row(overrides: Partial<PrecheckAssertion> & Pick<PrecheckAssertion, 'path' | 'op' | 'status'>): PrecheckAssertion {
  return {
    testId: 'T001-01',
    checkpoint: 'final',
    expected: '1',
    actual: '2',
    ...overrides,
  }
}

describe('失败签名', () => {
  test('选择器值换成 *，下标换成 #，再加 op', () => {
    expect(assertionSignature('nodes[at=2026-10-01].unallocated.value', 'eq')).toBe('nodes[at=*].unallocated.value eq')
    expect(assertionSignature('nodes[trigger.event_ids=E-INC].related', 'includes')).toBe('nodes[trigger.event_ids=*].related includes')
    expect(assertionSignature('candidates[candidate_id=C04][plan_version=C04@v1].tie_group', 'not_eq')).toBe(
      'candidates[candidate_id=*][plan_version=*].tie_group not_eq',
    )
    expect(assertionSignature('candidates[0].rank', 'eq')).toBe('candidates[#].rank eq')
    expect(assertionSignature('candidates[10].rank', 'eq')).toBe('candidates[#].rank eq')
    expect(assertionSignature('labels', 'includes')).toBe('labels includes')
  })

  test('按失败数降序，同数按签名排序，样例只留前 3 条', () => {
    const groups = groupFailures([
      row({ testId: 'T002-01', path: 'b.x', op: 'eq', status: 'fail', expected: 'a', actual: 'b' }),
      row({ testId: 'T001-01', path: 'labels', op: 'includes', status: 'fail', expected: '"A"', actual: '[]' }),
      row({ testId: 'T001-02', path: 'labels', op: 'includes', status: 'fail', expected: '"B"', actual: '[]' }),
      row({ testId: 'T001-02', path: 'labels', op: 'includes', status: 'fail', expected: '"C"', actual: '[]' }),
      row({ testId: 'T001-03', path: 'labels', op: 'includes', status: 'fail', expected: '"D"', actual: '[]' }),
      row({ path: 'labels', op: 'includes', status: 'pass' }),
      row({ path: 'skipped.path', op: 'eq', status: 'skipped' }),
    ])
    expect(groups.map((group) => `${group.signature}#${group.count}`)).toEqual(['labels includes#4', 'b.x eq#1'])
    expect(groups[0]?.vectors).toEqual(['T001-01', 'T001-02', 'T001-03'])
    expect(groups[0]?.samples.map((sample) => sample.expected)).toEqual(['"A"', '"B"', '"C"'])
    expect(groups[0]?.samples.map(sampleLine)[0]).toBe('T001-01｜final｜"A"｜[]')
  })

  test('选择器多命中按 actual 计数', () => {
    const assertions = [
      row({ path: 'nodes[at=2026-10-01].x', op: 'eq', status: 'fail', actual: '选择器多命中' }),
      row({ path: 'states.plan_state', op: 'eq', status: 'fail', actual: '"INCOMPLETE"' }),
    ]
    expect(multiHitCount(assertions)).toBe(1)
    expect(groupFailures(assertions)).toHaveLength(2)
  })
})

describe('单元核对', () => {
  test('对照本次 oracle unit 输出', () => {
    const checks = compareUnit(ORACLE_UNIT_STDOUT)
    expect(checks.map((check) => `${check.caseId}｜${check.item}｜${check.verdict}`)).toEqual([
      'T020-01｜l3=11740｜一致',
      'T020-01｜b3=788｜一致',
      'T020-01｜h=2 预测 12874.72 取整为 12875｜一致',
      'T020-01｜第3笔一步误差 -300｜一致',
      'T007-05｜4999.500000000000 得 5000｜一致',
      'T007-05｜4999.499999999999 得 4999｜一致',
      'T020-11｜0.1234567890125 得 0.123456789013｜未能核对',
      'T020-11｜-0.1234567890125 得 -0.123456789013｜未能核对',
      'T020-11｜12874.72 得 12875｜未能核对',
    ])
    expect(checks[0]?.note).toContain('11740.000000000000')
    expect(checks[2]?.note).toContain('12874.720000000000')
    expect(checks[3]?.note).toContain('-300.000000000000')
    expect(checks[6]?.note).toContain('没有 input=0.1234567890125')
  })

  test('T020-11 探针命中时判为一致，数值不符则不一致', () => {
    const data = JSON.parse(ORACLE_UNIT_STDOUT) as { 'T020-01': { l3: string }; 'T020-11': unknown }
    data['T020-11'] = [
      { input: '0.1234567890125', rounded_12: '0.123456789013', integer_cents: 0 },
      { input: '-0.1234567890125', rounded_12: '-0.123456789013', integer_cents: 0 },
      { input: '12874.720000000000', integer_cents: 12875 },
    ]
    expect(
      compareUnit(JSON.stringify(data))
        .filter((check) => check.caseId === 'T020-11')
        .map((check) => check.verdict),
    ).toEqual(['一致', '一致', '一致'])
    data['T020-01'].l3 = '11741.000000000000'
    const l3 = compareUnit(JSON.stringify(data)).find((check) => check.item === 'l3=11740')
    expect(l3?.verdict).toBe('不一致')
    expect(l3?.note).toContain('11741.000000000000')
    expect(l3?.note).toContain('11740')
  })

  test('输出不是 JSON 或命令失败时全部未能核对', () => {
    expect(compareUnit('{').every((check) => check.verdict === '未能核对')).toBe(true)
    const failed = checksForUnitRun(1, '', 'boom')
    expect(failed.checks).toHaveLength(9)
    expect(failed.checks.every((check) => check.verdict === '未能核对')).toBe(true)
    expect(failed.raw).toContain('boom')
  })
})

describe('约定观察与报告', () => {
  test('统计字段写法并写入报告', () => {
    const observations = collectObservations([
      {
        source: 'cases/a.json',
        label: 'final',
        result: {
          nodes: [{ at: '2026-09-01T09:00:00+08:00' }, { at: '2026-09-28' }],
          check_period: { start: '2026-09-01 09:00' },
          candidates: [
            { candidate_id: 'C01', plan_version: 'C01@v1', rank: null },
            { candidate_id: 'C02', plan_version: 'C02@v1', rank: 1 },
          ],
          optimization: { top_k: 3 },
          confirmation: null,
          forecasts: [],
          scenarios: [
            { kind: 'CONFIRMED_ONLY', available: true },
            { kind: 'RECENT_MONTH', available: false },
          ],
          labels: ['SIMULATED_DATA', 'TOP_K_DEMO'],
        },
      },
      {
        source: 'vectors/T001-01.json',
        label: 'after',
        result: {
          nodes: [{ at: '2026-10-01' }],
          check_period: { start: '2026-10-01T09:00:00+08:00' },
          candidates: [{ candidate_id: 'C03', plan_version: 'C03@v1', rank: 4 }],
          optimization: { top_k: 3 },
          confirmation: { plan_version: 'C03@v1' },
          forecasts: [{ status: 'AVAILABLE' }],
          scenarios: [{ kind: 'CONFIRMED_ONLY', available: true }],
          labels: ['TOP_K_DEMO'],
        },
      },
    ])
    expect(observations.checkpoints).toBe(2)
    expect(observations.nodeAt.shapes).toEqual([
      { value: 'YYYY-MM-DD', count: 2 },
      { value: 'YYYY-MM-DDTHH:mm:ss+08:00', count: 1 },
    ])
    expect(observations.checkStart.values.map((item) => item.value)).toContain('"2026-09-01 09:00"')
    expect(observations.outsideRank.values.map((item) => item.value).sort()).toEqual(['4', 'null'])
    expect(observations.candidateOrderCheckpoints).toBe(1)
    expect(observations.candidateOrders[0]?.text).toContain('C01 rank=null')
    expect(observations.candidateOrders[0]?.text).toContain('C02 rank=1')
    expect(observations.forecasts).toMatchObject({ missing: 0, empty: 1, nonempty: 1 })
    expect(observations.labelsWithSimulated).toBe(1)
    expect(observations.labelsWithoutSimulated).toBe(1)
    expect(observations.confirmationNull).toBe(1)
    expect(observations.confirmationPlanVersion.values.map((item) => item.value)).toEqual(['"C03@v1"'])

    const markdown = renderReport({
      summary: {
        vectorsPassed: 1,
        vectorsTotal: 2,
        assertionsPassed: 3,
        assertionsTotal: 4,
        assertionsSkipped: 5,
        runErrors: 1,
      },
      groups: groupFailures([
        row({ testId: 'T004-07', path: 'nodes[at=2026-10-01].x', op: 'eq', status: 'fail', actual: '选择器多命中' }),
      ]),
      runErrors: [{ testId: 'T009-01', message: '运行错误：boom' }],
      multiHits: 1,
      unitStatus: 0,
      checks: compareUnit(ORACLE_UNIT_STDOUT),
      unitRaw: ORACLE_UNIT_STDOUT,
      observations,
    })
    expect(markdown.includes('\r')).toBe(false)
    expect(markdown.endsWith('\n')).toBe(true)
    expect(markdown).toContain('向量通过数：1／2')
    expect(markdown).toContain('断言通过数：3／4（跳过 5）')
    expect(markdown).toContain('选择器多命中数：1')
    expect(markdown).toContain('T009-01｜运行错误：boom')
    expect(markdown).toContain('nodes[at=*].x eq')
    expect(markdown).toContain('T004-07｜final｜1｜选择器多命中')
    expect(markdown).toContain('T020-11｜12874.72 得 12875｜未能核对')
    expect(markdown).toContain('cases/a.json｜final｜"2026-09-01T09:00:00+08:00"')
    expect(markdown).toContain('含 SIMULATED_DATA：1')
  })
})

describe('stale', () => {
  test('空列表不警告，非空列表排序后拼出', () => {
    expect(staleMessage([])).toBeNull()
    expect(staleMessage(['fixtures/cases/a.json', 'docs/rules.md'])).toBe(
      'oracle 输入与记录指纹不一致：docs/rules.md、fixtures/cases/a.json',
    )
  })
})
