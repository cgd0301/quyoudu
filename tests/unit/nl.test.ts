import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEMO_CFG_1 } from '../../src/engine/config.ts'
import { evaluate } from '../../src/engine/evaluate.ts'
import { resultCoreSchema } from '../../src/engine/result.ts'
import { caseFileSchema, type CaseFile } from '../../src/engine/schema.ts'
import {
  applyExtraction,
  applyTurn,
  buildConfirmedCase,
  buildDraft,
  confirmFields,
  createOffTransport,
  createReplayTransport,
  createSession,
  evaluateConfirmed,
  explain,
  listRecordings,
  loadRecording,
  MAX_QUESTIONS_PER_ROUND,
  MAX_QUESTION_ROUNDS,
  modifyField,
  nextQuestions,
  NlError,
  parseExtraction,
  recordQuestions,
  rejectField,
  sentenceIsSupported,
  type NlSession,
} from '../../src/nl/index.ts'
import { REPO_ROOT } from '../../scripts/lib/repo.ts'

function loadCase(name: string): CaseFile {
  return caseFileSchema.parse(JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/cases', `${name}.json`), 'utf8')))
}

function sessionWith(fields: Parameters<typeof applyExtraction>[1], caseName = 'cB_topk'): NlSession {
  return applyExtraction(createSession(loadCase(caseName)), fields, '（测试话术）')
}

describe('自然语言层：契约与错误', () => {
  test('nl 只接受 D30 的 13 个字段名，未知字段被拒绝', () => {
    expect(() =>
      parseExtraction(JSON.stringify({ fields: [{ field: 'PLAN_STATE', value: 'FEASIBLE', source_text: 'x', source_span: null }] })),
    ).toThrow(NlError)
    const error = (() => {
      try {
        parseExtraction(JSON.stringify({ fields: [{ field: 'PLAN_STATE', value: 'x', source_text: 'x', source_span: null }] }))
      } catch (caught) {
        return caught as NlError
      }
      return null
    })()
    expect(error?.code).toBe('SCHEMA_VIOLATION')
  })

  test('nl 拒绝多出来的顶层键（模型不能绕开契约塞状态）', () => {
    const payload = JSON.stringify({ fields: [], planState: 'FEASIBLE_UNDER_ASSUMPTIONS' })
    const error = (() => {
      try {
        parseExtraction(payload)
      } catch (caught) {
        return caught as NlError
      }
      return null
    })()
    expect(error?.code).toBe('SCHEMA_VIOLATION')
  })

  test('nl 金额必须是整数分，非法 JSON 与非法金额都给出明确代码', () => {
    expect(() => parseExtraction('{"fields": [')).toThrow(/不是合法 JSON/)
    const invalid = (() => {
      try {
        parseExtraction(JSON.stringify({ fields: [{ field: 'CASH', value: '1600.00', source_text: 'x', source_span: null }] }))
      } catch (caught) {
        return caught as NlError
      }
      return null
    })()
    expect(invalid?.code).toBe('VALUE_INVALID')
  })

  test('nl 部分字段合法、部分不合法时整轮拒绝，不写入任何字段', () => {
    const recording = loadRecording('cB_topk_partial_invalid')
    const session = createSession(loadCase('cB_topk'))
    const turn = recording.turns[0]
    expect(turn).toBeDefined()
    expect(() => applyTurn(session, '（话术）', turn!)).toThrow(NlError)
    expect([...session.fields.values()].every((slot) => slot.value === null)).toBe(true)
  })

  test('nl 模型超时与服务异常返回可处理状态，不产生字段', () => {
    for (const id of ['c00_timeout', 'c00_http_error']) {
      const recording = loadRecording(id)
      const turn = recording.turns[0]
      expect(turn).toBeDefined()
      const error = (() => {
        try {
          applyTurn(createSession(loadCase('c00_r019_minimal')), '（话术）', turn!)
        } catch (caught) {
          return caught as NlError
        }
        return null
      })()
      expect(['TIMEOUT', 'HTTP_ERROR']).toContain(error?.code)
    }
  })

  test('nl 回放文件结构有效，且 turns 与 utterances 数量一致', () => {
    const recordings = listRecordings()
    expect(recordings.length).toBeGreaterThanOrEqual(9)
    for (const recording of recordings) {
      expect(recording.utterances.length).toBe(recording.turns.length)
      expect(recording.case_id).not.toBe('')
      expect(recording.scenario).not.toBe('')
    }
  })
})

describe('自然语言层：提取与追问', () => {
  test('T015-01 gap 固定话术提取，后续追问不再问已提供字段', async () => {
    const recording = loadRecording('cB_topk_normal')
    const transport = createReplayTransport(recording)
    let session = createSession(loadCase('cB_topk'), { mode: 'replay' })
    for (const [index, utterance] of recording.utterances.entries()) {
      const turn = await transport.send(index, utterance)
      session = applyTurn(session, utterance, turn)
    }
    const first = nextQuestions(session)
    const asked = first.questions.map((question) => question.field)
    expect(asked).not.toContain('CITY')
    expect(asked).not.toContain('CASH')
    expect(asked).not.toContain('SHOW_DATETIME')
    expect(asked.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_ROUND)
  })

  test('T015-02 gap 只追问影响付款检查的缺失字段，每轮最多2问、最多3轮', () => {
    let session = createSession(loadCase('c01_base'))
    const seenRounds: number[] = []
    for (let round = 0; round < MAX_QUESTION_ROUNDS + 1; round += 1) {
      const { questions, formFallback } = nextQuestions(session)
      if (questions.length > 0) {
        seenRounds.push(questions.length)
        expect(questions.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_ROUND)
        session = recordQuestions(session, questions)
      } else {
        expect(formFallback).toBe(true)
        break
      }
    }
    expect(seenRounds.length).toBeLessThanOrEqual(MAX_QUESTION_ROUNDS)
    expect(session.formFallback).toBe(true)
  })

  test('T015-09 gap 结构化结果只含 D30 的13个字段，话术未提及的为空并进入待办', () => {
    const recording = loadRecording('c01_missing_budget')
    const turn = recording.turns[0]
    const session = applyTurn(createSession(loadCase('c01_base')), recording.utterances[0] ?? '', turn!)
    expect(session.fields.size).toBe(13)
    expect(session.fields.get('BUDGET')?.value).toBeNull()
    expect(session.fields.get('CASH')?.value).toBeNull()
    const draft = buildDraft(session)
    expect(draft.todos.join()).toContain('补充')
    expect(draft.cost_items.some((item) => item.status === 'PENDING')).toBe(true)
  })

  test('T015-08 gap 输出需求草稿、费用清单草稿和关键待办', () => {
    const session = sessionWith([
      { field: 'ACTIVITY', value: '演唱会', source_text: '看演唱会', source_span: { start: 0, end: 4 } },
      { field: 'CITY', value: '上海', source_text: '去上海', source_span: { start: 5, end: 8 } },
      { field: 'TICKET_PURCHASED', value: false, source_text: '还没买票', source_span: null },
    ])
    const draft = buildDraft(session)
    expect(draft.requirement).toContain('上海')
    expect(draft.requirement).toContain('待确认')
    expect(draft.cost_items.map((item) => item.category)).toEqual(['TICKET', 'OUTBOUND_TRANSPORT', 'RETURN_TRANSPORT', 'LODGING'])
    expect(draft.cost_items.find((item) => item.category === 'TICKET')?.status).toBe('PROVIDED')
    expect(draft.cost_items.find((item) => item.category === 'LODGING')?.status).toBe('PENDING')
    expect(JSON.stringify(draft)).not.toMatch(/\d+\.\d{2}/)
    expect(draft.todos.length).toBeGreaterThan(0)
  })
})

describe('自然语言层：确认与版本', () => {
  test('nl 未确认的值不会写成确认记录', () => {
    const session = sessionWith([{ field: 'CITY', value: '上海', source_text: '去上海', source_span: null }])
    const error = (() => {
      try {
        confirmFields(session, ['BUDGET'])
      } catch (caught) {
        return caught as NlError
      }
      return null
    })()
    expect(error?.code).toBe('NOT_CONFIRMED')
    expect(buildConfirmedCase(session, [])).toEqual(session.base)
  })

  test('nl 确认后写入案例输入的 confirmations[]，并在引擎结果中标为 CURRENT', () => {
    const session = sessionWith([
      { field: 'CITY', value: '上海', source_text: '去上海', source_span: null },
      { field: 'CASH', value: 160000, source_text: '手里有1600元', source_span: null },
    ])
    const confirmed = confirmFields(session, ['CITY', 'CASH'])
    expect(confirmed.records).toEqual([
      { field: 'CITY', value: '上海', input_version: 'v1' },
      { field: 'CASH', value: 160000, input_version: 'v1' },
    ])
    const handoff = evaluateConfirmed(confirmed.session, confirmed.records)
    expect(handoff.caseFile.confirmations).toHaveLength(2)
    expect(handoff.result.userConfirmations.map((item) => item.status)).toEqual(['CURRENT', 'CURRENT'])
    expect(handoff.staleFields).toEqual([])
    expect(() => resultCoreSchema.parse(handoff.result)).not.toThrow()
  })

  test('nl 重复确认同一字段同一版本不重复追加记录', () => {
    const session = sessionWith([{ field: 'CITY', value: '上海', source_text: '去上海', source_span: null }])
    const first = confirmFields(session, ['CITY'])
    const twice = confirmFields(first.session, ['CITY'])
    expect(twice.records).toHaveLength(1)
    const caseFile = buildConfirmedCase(twice.session, [...first.records, ...twice.records])
    expect(caseFile.confirmations).toHaveLength(1)
  })

  test('nl 输入版本变化后旧确认标为需重新确认，且不用于判断', () => {
    const session = sessionWith([{ field: 'CITY', value: '上海', source_text: '去上海', source_span: null }])
    const confirmed = confirmFields(session, ['CITY'])
    const caseFile = buildConfirmedCase(confirmed.session, confirmed.records)
    const output = evaluate(
      caseFile,
      [{ type: 'PATCH', path: '/snapshot/cash', value: 120000 }, { type: 'EVALUATE', label: '改后' }],
      DEMO_CFG_1,
    )
    const after = output.checkpoints.at(-1)?.result
    expect(after?.inputVersion).toBe('v2')
    expect(after?.userConfirmations[0]?.status).toBe('NEEDS_RECONFIRM')
  })

  test('nl 用户拒绝或修改字段后回到待确认，确认记录不被旧值污染', () => {
    const session = sessionWith([{ field: 'BUDGET', value: 180000, source_text: '控制在1800元以内', source_span: null }])
    const rejected = rejectField(session, 'BUDGET')
    expect(rejected.fields.get('BUDGET')?.value).toBeNull()
    const modified = modifyField(rejected, 'BUDGET', 150000, '其实是1500元')
    expect(modified.fields.get('BUDGET')?.state).toBe('MODIFIED')
    const confirmed = confirmFields(modified, ['BUDGET'])
    expect(confirmed.records[0]?.value).toBe(150000)
  })

  test('nl 合法确认数据能进入 evaluate 并返回正式结果；同一输入两次结果相同', () => {
    const session = sessionWith([
      { field: 'CITY', value: '上海', source_text: '去上海', source_span: null },
      { field: 'SHOW_DATETIME', value: '2026-11-28T19:30:00+08:00', source_text: '11月28日晚上7点半', source_span: null },
    ])
    const confirmed = confirmFields(session, ['CITY', 'SHOW_DATETIME'])
    const first = evaluateConfirmed(confirmed.session, confirmed.records)
    const second = evaluateConfirmed(confirmed.session, confirmed.records)
    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result))
    expect(first.result.labels).toContain('SIMULATED_DATA')
    expect(first.result.states.planState).toBeDefined()
  })

  test('nl 正式计算仍可能给出暂无法完整判断，不被 NL 层改写', () => {
    const session = sessionWith([{ field: 'CITY', value: '上海', source_text: '去上海', source_span: null }], 'c01_base')
    const confirmed = confirmFields(session, ['CITY'])
    const handoff = evaluateConfirmed(confirmed.session, confirmed.records)
    expect(handoff.result.states.planState).toBe('INCOMPLETE')
  })
})

describe('自然语言层：解释句与模式', () => {
  test('T013-04 gap AI 回复中的300不进入计算，解释句不出现该数字', () => {
    const session = sessionWith([{ field: 'LODGING_REQUIREMENT', value: '住宿大约300元', source_text: '住宿大约300元', source_span: null }])
    const confirmed = confirmFields(session, ['LODGING_REQUIREMENT'])
    const handoff = evaluateConfirmed(confirmed.session, confirmed.records)
    const control = evaluateConfirmed(createSession(loadCase('cB_topk')), [])
    // 该描述只落在确认记录里，不改变任何金额与状态
    expect(handoff.result.cost).toEqual(control.result.cost)
    expect(handoff.result.states).toEqual(control.result.states)
    expect(handoff.result.nodes).toEqual(control.result.nodes)
    const sentences = explain(handoff.result)
    expect(sentences.join('')).not.toMatch(/(^|\D)300(\D|$)/)
    expect(sentences.every((sentence) => sentenceIsSupported(sentence, handoff.result))).toBe(true)
  })

  test('T013-06 gap 重算时不调用大模型重新生成数据', async () => {
    const recording = loadRecording('cB_topk_normal')
    const transport = createReplayTransport(recording)
    const session = createSession(loadCase('cB_topk'), { mode: 'replay' })
    const turn = await transport.send(0, recording.utterances[0] ?? '')
    const extracted = applyTurn(session, recording.utterances[0] ?? '', turn)
    const confirmed = confirmFields(extracted, ['CITY'])
    const first = evaluateConfirmed(confirmed.session, confirmed.records)
    // 重算只用案例输入，不再向模型要数据
    const recomputed = evaluate(first.caseFile, [], DEMO_CFG_1)
    expect(JSON.stringify(recomputed.checkpoints.at(-1)?.result)).toBe(JSON.stringify(first.result))
  })

  test('nl 关闭模式给出明确不可用状态，不回退假数据', async () => {
    const transport = createOffTransport()
    await expect(transport.send(0, '我想去看演出')).rejects.toMatchObject({ code: 'LIVE_UNAVAILABLE' })
  })
})
