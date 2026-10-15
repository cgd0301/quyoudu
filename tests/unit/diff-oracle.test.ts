import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  MISSING,
  clauseFor,
  compareCheckpoints,
  diffResults,
  formatDiffReport,
  priorityFor,
  runDiff,
  type RunTs,
} from '../../scripts/diff-oracle.ts'
import type { OracleSpawn } from '../../scripts/lib/oracle-run.ts'

const basis = (event: string) => ({ event_ids: [event], reserve_ids: ['R'], rules: ['R001'] })

describe('字段比较', () => {
  test('忽略 basis、rule、refs', () => {
    expect(
      diffResults(
        {
          input_issues: [{ code: 'X', rule: 'R001', refs: ['a'] }],
          cost: { net_spend: { value: 10, basis: basis('E1') } },
        },
        {
          input_issues: [{ code: 'X', rule: 'R999', refs: ['b', 'c'] }],
          cost: { net_spend: { value: 10, basis: basis('E2') } },
        },
      ),
    ).toEqual([])
  })

  test('labels、related、event_ids 按集合比较，其余数组按顺序', () => {
    expect(
      diffResults(
        {
          labels: ['B', 'A', 'A'],
          related: ['2', '1'],
          trigger: { event_ids: ['E2', 'E1'] },
          pending_cost_item_ids: ['A', 'B'],
        },
        {
          labels: ['A', 'B'],
          related: ['1', '2'],
          trigger: { event_ids: ['E1', 'E2'] },
          pending_cost_item_ids: ['B', 'A'],
        },
      ),
    ).toEqual([
      { path: 'pending_cost_item_ids[0]', ts: 'A', oracle: 'B' },
      { path: 'pending_cost_item_ids[1]', ts: 'B', oracle: 'A' },
    ])
    expect(diffResults({ labels: ['A', 'B'] }, { labels: ['A', 'C'] })).toEqual([
      { path: 'labels', ts: ['A', 'B'], oracle: ['A', 'C'] },
    ])
  })

  test('金额只比较 value', () => {
    expect(
      diffResults(
        { cost: { net_spend: { value: 10, basis: basis('E1'), extra: 1 } } },
        { cost: { net_spend: { value: 10, basis: basis('E2') } } },
      ),
    ).toEqual([])
    expect(
      diffResults(
        { cost: { net_spend: { value: 10, basis: basis('E1') } } },
        { cost: { net_spend: { value: 20, basis: basis('E1'), extra: 1 } } },
      ),
    ).toEqual([{ path: 'cost.net_spend.value', ts: 10, oracle: 20 }])
    expect(
      diffResults(
        { cost: { net_spend: null } },
        { cost: { net_spend: { value: 50, basis: basis('E1') } } },
      ),
    ).toEqual([{ path: 'cost.net_spend', ts: null, oracle: { value: 50 } }])
    expect(diffResults({ labels: ['A'] }, {})).toEqual([{ path: 'labels', ts: ['A'], oracle: MISSING }])
    const node = (value: number, event: string, extra?: boolean) => ({
      cash: extra ? { value, basis: basis(event), extra: true } : { value, basis: basis(event) },
    })
    expect(diffResults({ nodes: [node(1, 'A', true)] }, { nodes: [node(1, 'B')] })).toEqual([])
    expect(diffResults({ nodes: [node(1, 'A')] }, { nodes: [node(2, 'A')] })).toEqual([
      { path: 'nodes[0].cash.value', ts: 1, oracle: 2 },
    ])
  })

  test('candidate_id 对齐，nodes 按顺序', () => {
    expect(
      diffResults(
        {
          candidates: [
            { candidate_id: 'C02', rank: 1 },
            { candidate_id: 'C01', rank: 2 },
          ],
          nodes: [{ at: 'a' }, { at: 'b' }],
        },
        {
          candidates: [
            { candidate_id: 'C01', rank: 2 },
            { candidate_id: 'C02', rank: 1 },
          ],
          nodes: [{ at: 'b' }, { at: 'a' }],
        },
      ),
    ).toEqual([
      { path: 'nodes[0].at', ts: 'a', oracle: 'b' },
      { path: 'nodes[1].at', ts: 'b', oracle: 'a' },
    ])
    expect(
      diffResults({ candidates: [{ candidate_id: 'C01', rank: 1 }] }, { candidates: [] }),
    ).toEqual([{ path: 'candidates[candidate_id=C01]', ts: { candidate_id: 'C01', rank: 1 }, oracle: MISSING }])
  })

  test('复合编号不唯一时按顺序', () => {
    const payment = (event: string, item: string, value: number) => ({
      event_id: event,
      cost_item_id: item,
      amount: { value, basis: basis(event) },
    })
    expect(
      diffResults(
        { cost: { paid_payments: [payment('E2', 'B', 2), payment('E1', 'A', 1)] } },
        { cost: { paid_payments: [payment('E1', 'A', 1), payment('E2', 'B', 2)] } },
      ),
    ).toEqual([])
    const row = (n: number) => ({ event_id: 'E1', cost_item_id: 'A', n })
    expect(diffResults({ items: [row(1), row(2)] }, { items: [row(2), row(1)] })).toEqual([
      { path: 'items[0].n', ts: 1, oracle: 2 },
      { path: 'items[1].n', ts: 2, oracle: 1 },
    ])
    expect(
      diffResults(
        {
          items: [
            { event_id: 'E1', cost_item_id: 'A', n: 1 },
            { event_id: 'E2', cost_item_id: 'B', n: 2 },
          ],
        },
        {
          items: [
            { event_id: 'E2', cost_item_id: 'B', n: 2 },
            { event_id: 'E1', cost_item_id: 'A', n: 9 },
          ],
        },
      ),
    ).toEqual([{ path: 'items[cost_item_id=A][event_id=E1].n', ts: 1, oracle: 9 }])
  })
})

describe('优先级', () => {
  test('案例差异为 P1', () => {
    expect(
      priorityFor({
        kind: 'case',
        checkpoint: 'final',
        path: 'labels',
        expects: [],
        tsResult: { labels: ['A'] },
        oracleResult: { labels: ['B'] },
      }),
    ).toBe('P1')
  })

  test('未断言的向量字段为 P2，已断言为 P3', () => {
    const ts = {
      input_issues: [{ code: 'A', rule: 'R', refs: [] as string[] }],
      candidates: [{ candidate_id: 'C01', rank: 1, net_spend: { value: 10, basis: basis('E1') } }],
      cost: { net: 1, net_spend: { value: 2, basis: basis('E1') } },
    }
    const oracle = {
      input_issues: [{ code: 'B', rule: 'R', refs: ['x'] }],
      candidates: [{ candidate_id: 'C01', rank: 1, net_spend: { value: 11, basis: basis('E1') } }],
      cost: { net: 1, net_spend: { value: 3, basis: basis('E1') } },
    }
    const base = { kind: 'vector' as const, checkpoint: 'final', tsResult: ts, oracleResult: oracle }
    expect(
      priorityFor({
        ...base,
        path: 'input_issues[0].code',
        expects: [{ checkpoint: 'final', path: 'input_issues' }],
      }),
    ).toBe('P3')
    expect(
      priorityFor({
        ...base,
        path: 'input_issues[0].code',
        expects: [{ checkpoint: 'final', path: '/events/0/event_id' }],
      }),
    ).toBe('P2')
    expect(
      priorityFor({
        ...base,
        path: 'candidates[candidate_id=C01].net_spend.value',
        expects: [{ checkpoint: 'final', path: 'candidates[candidate_id=C01].rank' }],
      }),
    ).toBe('P2')
    expect(
      priorityFor({
        ...base,
        path: 'candidates[candidate_id=C01].rank',
        expects: [{ checkpoint: 'final', path: 'candidates[candidate_id=C01].rank' }],
      }),
    ).toBe('P3')
    expect(
      priorityFor({
        ...base,
        path: 'cost.net_spend.value',
        expects: [{ checkpoint: 'final', path: 'cost.net' }],
      }),
    ).toBe('P2')
  })

  test('选择器落到同一节点算已断言，多命中则不覆盖', () => {
    const ts = { nodes: [{ trigger: { event_ids: ['E1'] }, cash: { value: 1, basis: basis('E1') } }] }
    const oracle = { nodes: [{ trigger: { event_ids: ['E1'] }, cash: { value: 9, basis: basis('E1') } }] }
    expect(
      priorityFor({
        kind: 'vector',
        checkpoint: 'final',
        path: 'nodes[0].cash.value',
        expects: [{ checkpoint: 'final', path: 'nodes[trigger.event_ids=E1].cash.value' }],
        tsResult: ts,
        oracleResult: oracle,
      }),
    ).toBe('P3')
    const duplicated = {
      nodes: [
        { trigger: { event_ids: ['E1'] }, at: 'a' },
        { trigger: { event_ids: ['E1'] }, at: 'b' },
      ],
    }
    const duplicatedOracle = {
      nodes: [
        { trigger: { event_ids: ['E1'] }, at: 'a' },
        { trigger: { event_ids: ['E1'] }, at: 'c' },
      ],
    }
    expect(
      priorityFor({
        kind: 'vector',
        checkpoint: 'final',
        path: 'nodes[1].at',
        expects: [{ checkpoint: 'final', path: 'nodes[trigger.event_ids=E1].at' }],
        tsResult: duplicated,
        oracleResult: duplicatedOracle,
      }),
    ).toBe('P2')
  })

  test('复合编号路径仍被单个选择器覆盖', () => {
    const ts = { action_list: [{ task_id: 'T1', cost_item_id: 'TRAIN', task_state: 'OPEN' }] }
    const oracle = { action_list: [{ task_id: 'T1', cost_item_id: 'TRAIN', task_state: 'DONE' }] }
    const path = diffResults(ts, oracle)[0]?.path
    expect(path).toBe('action_list[cost_item_id=TRAIN][task_id=T1].task_state')
    expect(
      priorityFor({
        kind: 'vector',
        checkpoint: 'final',
        path: path ?? '',
        expects: [{ checkpoint: 'final', path: 'action_list[cost_item_id=TRAIN].task_state' }],
        tsResult: ts,
        oracleResult: oracle,
      }),
    ).toBe('P3')
  })

  test('争议断言仍算已断言', () => {
    expect(
      priorityFor({
        kind: 'vector',
        checkpoint: 'final',
        path: 'labels',
        expects: [{ checkpoint: 'final', path: 'labels' }],
        tsResult: { labels: ['A'] },
        oracleResult: { labels: ['B'] },
      }),
    ).toBe('P3')
  })

  test('检查点只在一侧出现时，有断言为 P3，否则为 P2', () => {
    const rows = compareCheckpoints([{ label: 'final', result: { labels: ['A'] } }], [{ label: 'after', result: { labels: ['A'] } }])
    expect(rows).toEqual([
      { checkpoint: 'after', path: '(检查点)', ts: MISSING, oracle: { labels: ['A'] } },
      { checkpoint: 'final', path: '(检查点)', ts: { labels: ['A'] }, oracle: MISSING },
    ])
    expect(
      priorityFor({
        kind: 'vector',
        checkpoint: 'after',
        path: '(检查点)',
        expects: [{ checkpoint: 'final', path: 'labels' }],
        tsResult: undefined,
        oracleResult: { labels: ['A'] },
      }),
    ).toBe('P2')
    expect(
      priorityFor({
        kind: 'vector',
        checkpoint: 'after',
        path: '(检查点)',
        expects: [{ checkpoint: 'after', path: 'labels' }],
        tsResult: undefined,
        oracleResult: { labels: ['A'] },
      }),
    ).toBe('P3')
  })
})

describe('条款与报告', () => {
  test('按字段推断条款，更具体的键优先', () => {
    expect(clauseFor('candidates[candidate_id=C01].rank')).toBe('§12.7')
    expect(clauseFor('candidates[candidate_id=C01].tie_group')).toBe('R016')
    expect(clauseFor('nodes[0].node_verdict')).toBe('D36、§10.4')
    expect(clauseFor('cost.net_spend.value')).toBe('§3、§11.1')
    expect(clauseFor('labels')).toBe('§11.4、§12.7')
    expect(clauseFor('input_version')).toBe('§12.4')
    expect(clauseFor('as_of')).toBe('§12.5')
    expect(clauseFor('(检查点)')).toBe('§12.5')
    expect(clauseFor('daily_reference.amount.value')).toBe('R019、D26、D27、D59')
    expect(clauseFor('action_list[cost_item_id=TRAIN].task_state')).toBe('R017 第7条')
  })

  test('输入过期时警告在首行，单元格超过 200 个码位截断', () => {
    const long = 'x'.repeat(201)
    const text = formatDiffReport({
      stale: ['b', 'a'],
      caseCount: 1,
      vectorCount: 2,
      tsCheckpoints: 3,
      oracleCheckpoints: 4,
      failures: [{ object: 'c01', message: 'TS 失败：坏了' }],
      diffs: [{ object: 'c01/final', path: 'labels', ts: long, oracle: '["A"]', clause: '§11.4、§12.7', priority: 'P1' }],
    })
    expect(text).toBe(
      [
        '警告：oracle 输入与记录指纹不一致：a、b',
        '',
        '# 引擎与参考实现对拍',
        '',
        '## 总体',
        '',
        '案例 1，向量 2，检查点 TS 3 / oracle 4',
        '差异 合计 1（P1 1，P2 0，P3 0）',
        '运行失败 1',
        '',
        '对象｜说明',
        'c01｜TS 失败：坏了',
        '',
        '## P1 演示案例',
        '',
        '对象｜字段路径｜TS｜oracle｜相关条款',
        `c01/final｜labels｜${'x'.repeat(200)}…｜["A"]｜§11.4、§12.7`,
        '',
        '## P2 向量中未被断言的字段',
        '',
        '无',
        '',
        '## P3 其余',
        '',
        '无',
        '',
      ].join('\n'),
    )
  })

  test('没有过期时不以警告开头', () => {
    const text = formatDiffReport({
      stale: [],
      caseCount: 0,
      vectorCount: 0,
      tsCheckpoints: 0,
      oracleCheckpoints: 0,
      failures: [],
      diffs: [],
    })
    expect(text.startsWith('# 引擎与参考实现对拍\n')).toBe(true)
    expect(text).toContain('差异 合计 0（P1 0，P2 0，P3 0）')
  })
})

describe('runDiff', () => {
  test('假 oracle 与假 TS 写入 ts-out 和报告', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'diff-oracle-'))
    const caseFile = path.join(root, 'fixtures/cases/c01.json')
    mkdirSync(path.dirname(caseFile), { recursive: true })
    writeFileSync(caseFile, '{"x":1}\n', 'utf8')
    try {
      const spawn: OracleSpawn = (args) => {
        if (args[2] === 'batch') {
          const target = path.join(root, '.cache/oracle-out/cases/c01.json')
          mkdirSync(path.dirname(target), { recursive: true })
          writeFileSync(
            target,
            `${JSON.stringify({ checkpoints: [{ label: 'final', result: { labels: ['A'] } }] }, null, 2)}\n`,
            'utf8',
          )
        }
        return { status: 0, stdout: '', stderr: '' }
      }
      const runTs: RunTs = (input) => {
        expect(input).toEqual({ kind: 'cases', name: 'c01.json', data: { x: 1 } })
        return { checkpoints: [{ label: 'final', result: { labels: ['B'] } }] }
      }
      await runDiff({ root, spawn, runTs })
      const written = JSON.parse(readFileSync(path.join(root, '.cache/ts-out/cases/c01.json'), 'utf8')) as unknown
      expect(written).toEqual({ checkpoints: [{ label: 'final', result: { labels: ['B'] } }] })
      const report = readFileSync(path.join(root, 'docs/_work/diff_report.md'), 'utf8')
      expect(report.startsWith('警告：oracle 输入与记录指纹不一致：fixtures/cases/c01.json\n')).toBe(true)
      expect(report).not.toContain('\r')
      expect(report).toContain('案例 1，向量 0，检查点 TS 1 / oracle 1')
      expect(report).toContain('c01/final｜labels｜["B"]｜["A"]｜§11.4、§12.7')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
