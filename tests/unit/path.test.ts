import { describe, expect, test } from 'vitest'
import { PathError, parsePath, resolvePath } from '../lib/path.ts'

const EXAMPLE = 'checkpoints[0].result.nodes[event_id=E1].unallocated'

const output = {
  checkpoints: [
    {
      label: 'final',
      result: {
        nodes: [
          { event_id: 'E0', unallocated: 10000 },
          { event_id: 'E1', unallocated: -5000 },
        ],
      },
    },
  ],
}

const result = {
  earliest_gap: null,
  nodes: [
    { at: '2026-09-01T09:00:00+08:00', trigger: { kind: 'START', event_ids: [] }, cash: { value: 100000 } },
    { at: '2026-09-10', trigger: { kind: 'OUTFLOW_GROUP', event_ids: ['E1', 'E2'] }, cash: { value: 86000 } },
    { at: '2026-09-20', trigger: { kind: 'INCOME', event_ids: ['E-INC'] }, cash: { value: 136000 } },
  ],
  candidates: [
    { candidate_id: 'C01', rank: 1, feasible: true, tie_group: null, channel: '渠道甲' },
    { candidate_id: 'C02', rank: null, feasible: false, tie_group: 3, channel: '渠道乙' },
  ],
  forecasts: [
    { series_id: 'S-LODGING', purchase_date: '2026-10-10', phi: '0.80', confirmed: true },
    { series_id: 'S-LODGING', purchase_date: '2026-10-12', phi: '0.80', confirmed: true },
    { series_id: 'S-TRAIN', purchase_date: '2026-10-10', phi: '0.90', confirmed: false },
  ],
}

describe('parsePath', () => {
  test('点号、下标与选择器', () => {
    expect(parsePath(EXAMPLE)).toEqual([
      { kind: 'key', key: 'checkpoints' },
      { kind: 'index', index: 0 },
      { kind: 'key', key: 'result' },
      { kind: 'key', key: 'nodes' },
      { kind: 'select', conditions: [{ field: ['event_id'], value: 'E1' }] },
      { kind: 'key', key: 'unallocated' },
    ])
  })

  test('可以以下标开头，下标可以连写', () => {
    expect(parsePath('[1][0]')).toEqual([
      { kind: 'index', index: 1 },
      { kind: 'index', index: 0 },
    ])
  })

  test('选择器字段可写点号子路径；连写的选择器合并为同时满足', () => {
    expect(parsePath('nodes[trigger.event_ids=E1]')).toEqual([
      { kind: 'key', key: 'nodes' },
      { kind: 'select', conditions: [{ field: ['trigger', 'event_ids'], value: 'E1' }] },
    ])
    expect(parsePath('forecasts[series_id=S-LODGING][purchase_date=2026-10-10].confirmed')).toEqual([
      { kind: 'key', key: 'forecasts' },
      {
        kind: 'select',
        conditions: [
          { field: ['series_id'], value: 'S-LODGING' },
          { field: ['purchase_date'], value: '2026-10-10' },
        ],
      },
      { kind: 'key', key: 'confirmed' },
    ])
  })

  test('选择值里的冒号、加号、点号、等号和中文原样保留', () => {
    expect(parsePath('nodes[at=2026-09-01T09:00:00+08:00]')[1]).toEqual({
      kind: 'select',
      conditions: [{ field: ['at'], value: '2026-09-01T09:00:00+08:00' }],
    })
    expect(parsePath('forecasts[phi=0.80]')[1]).toEqual({ kind: 'select', conditions: [{ field: ['phi'], value: '0.80' }] })
    expect(parsePath('candidates[channel=渠道甲]')[1]).toEqual({
      kind: 'select',
      conditions: [{ field: ['channel'], value: '渠道甲' }],
    })
    expect(parsePath('items[note=a=b]')[1]).toEqual({ kind: 'select', conditions: [{ field: ['note'], value: 'a=b' }] })
  })

  test.each([
    ['空路径', ''],
    ['点号开头', '.nodes'],
    ['点号结尾', 'nodes.'],
    ['连续点号', 'nodes..cash'],
    ['点号后接方括号', 'nodes.[0]'],
    ['方括号未闭合', 'nodes[0'],
    ['空方括号', 'nodes[]'],
    ['方括号里不是数字也没有等号', 'nodes[first]'],
    ['选择器缺字段', 'nodes[=E1]'],
    ['选择器缺值', 'nodes[event_id=]'],
    ['选择器字段有空段', 'nodes[trigger..event_ids=E1]'],
    ['方括号里套方括号', 'nodes[a[0]=1]'],
    ['方括号后直接接键名', 'nodes[0]cash'],
    ['键名里有右方括号', 'nodes]'],
  ])('语法错误：%s', (_name, path) => {
    expect(() => parsePath(path)).toThrow(PathError)
  })
})

describe('resolvePath', () => {
  test('例子路径', () => {
    expect(resolvePath(output, EXAMPLE)).toEqual({ found: true, value: -5000 })
  })

  test('选择器字段的值是数组时按包含匹配', () => {
    expect(resolvePath(result, 'nodes[trigger.event_ids=E2].cash.value')).toEqual({ found: true, value: 86000 })
    expect(resolvePath(result, 'nodes[trigger.event_ids=E-INC].trigger.kind')).toEqual({ found: true, value: 'INCOME' })
  })

  test('数字、布尔与 null 先转成字符串再比较', () => {
    expect(resolvePath(result, 'candidates[rank=1].candidate_id')).toEqual({ found: true, value: 'C01' })
    expect(resolvePath(result, 'candidates[feasible=false].candidate_id')).toEqual({ found: true, value: 'C02' })
    expect(resolvePath(result, 'candidates[tie_group=null].candidate_id')).toEqual({ found: true, value: 'C01' })
    expect(resolvePath(result, 'candidates[tie_group=3].candidate_id')).toEqual({ found: true, value: 'C02' })
  })

  test('选择值含时刻、小数和中文', () => {
    expect(resolvePath(result, 'nodes[at=2026-09-01T09:00:00+08:00].trigger.kind')).toEqual({ found: true, value: 'START' })
    expect(resolvePath(result, 'forecasts[phi=0.90].series_id')).toEqual({ found: true, value: 'S-TRAIN' })
    expect(resolvePath(result, 'candidates[channel=渠道乙].rank')).toEqual({ found: true, value: null })
  })

  test('连写的选择器同时满足', () => {
    expect(resolvePath(result, 'forecasts[series_id=S-LODGING][purchase_date=2026-10-10].phi')).toEqual({
      found: true,
      value: '0.80',
    })
    expect(resolvePath(result, 'forecasts[series_id=S-TRAIN][purchase_date=2026-10-12]')).toEqual({ found: false })
  })

  test('值为 null 的字段算存在', () => {
    expect(resolvePath(result, 'earliest_gap')).toEqual({ found: true, value: null })
  })

  test('下标取数组元素', () => {
    expect(resolvePath(result, 'nodes[2].at')).toEqual({ found: true, value: '2026-09-20' })
    expect(resolvePath(result, 'nodes[0].trigger.event_ids')).toEqual({ found: true, value: [] })
  })

  test.each([
    ['键名不存在', 'daily_reference.amount'],
    ['下标越界', 'nodes[3]'],
    ['选择器没有命中', 'nodes[trigger.event_ids=E9]'],
    ['选择器用在对象上', 'earliest_gap[node_index=1]'],
    ['下标用在对象上', 'candidates[0][0]'],
    ['键名用在数组上', 'nodes.length'],
    ['经过 null', 'earliest_gap.amount'],
    ['选择器字段在元素中不存在', 'candidates[score=1]'],
    ['选择器字段的值是对象', 'nodes[trigger=START]'],
  ])('不存在：%s', (_name, path) => {
    expect(resolvePath(result, path)).toEqual({ found: false })
  })

  test('选择器命中多个元素时报错', () => {
    expect(() => resolvePath(result, 'forecasts[series_id=S-LODGING].phi')).toThrow(PathError)
    expect(() => resolvePath(result, 'forecasts[series_id=S-LODGING].phi')).toThrow('2 个')
  })

  test('语法错误时报错', () => {
    expect(() => resolvePath(result, 'nodes[')).toThrow(PathError)
  })

  test('可以传入已解析的路径段', () => {
    expect(resolvePath(output, parsePath(EXAMPLE))).toEqual({ found: true, value: -5000 })
  })
})
