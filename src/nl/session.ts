/**
 * 自然语言辅助的状态机：提取 → 追问 → 草稿 → 确认 → 交给正式计算入口。
 *
 * 设计要点（对应 AGENTS.md §3 与 R015、D30、D32、D52、D60）：
 * - 所有模型输出都先过 contracts 里的 zod 契约，未知字段、错类型、非法金额一律拒绝；
 * - 每个字段先进入 PENDING，只有用户显式确认后才变成 CONFIRMED；
 * - 确认记录只以引擎自己的 schema 形态写回案例输入，且 input_version 等于该案例所代表的版本；
 * - 进入计算的始终是案例输入（含 confirmations[]），模型给的值不直接参与计算；
 * - 纯函数，不读时钟、不发网络请求；调用层由外部注入。
 */
import { z } from 'zod'
import { DEMO_CFG_1, type EngineConfig } from '../engine/config.ts'
import { evaluate } from '../engine/evaluate.ts'
import { caseFileSchema, type CaseFile } from '../engine/schema.ts'
import { confirmationRecordSchema } from './contracts.ts'
import type { ResultCore } from '../engine/result.ts'
import {
  AMOUNT_FIELDS,
  BOOLEAN_FIELDS,
  DATE_FIELDS,
  EXTRACTION_FIELDS,
  MAX_QUESTIONS_PER_ROUND,
  MAX_QUESTION_ROUNDS,
  NlError,
  OPTIONAL_AMOUNT_FIELDS,
  extractionPayloadSchema,
  type Draft,
  type ExtractedField,
  type ExtractionField,
  type FieldState,
  type Question,
  type ReplayTurn,
} from './contracts.ts'

export type FieldSlot = {
  field: ExtractionField
  state: FieldState
  value: string | number | boolean | null
  /** 用户修改后的值；与提取值不同即需要重新确认 */
  sourceText: string
}

export type NlSession = {
  /** 作为计算输入的案例；本模块不修改它的任何字段，只追加确认记录 */
  base: CaseFile
  /** 案例所代表的输入版本；evaluate 每次都从 v1 开始 */
  inputVersion: string
  mode: 'replay' | 'live' | 'off'
  fields: Map<ExtractionField, FieldSlot>
  /** 已完成的追问轮数 */
  rounds: number
  /** 本轮已提出的问题（用于限制每轮 2 问） */
  askedThisRound: Question[]
  /** 表单补填：追问轮数用尽后为 true */
  formFallback: boolean
  utterances: string[]
}

export function createSession(base: CaseFile, options: { mode?: NlSession['mode'] } = {}): NlSession {
  const fields = new Map<ExtractionField, FieldSlot>()
  for (const field of EXTRACTION_FIELDS) {
    fields.set(field as ExtractionField, { field: field as ExtractionField, state: 'PENDING', value: null, sourceText: '' })
  }
  return {
    base: caseFileSchema.parse(base),
    inputVersion: 'v1',
    mode: options.mode ?? 'replay',
    fields,
    rounds: 0,
    askedThisRound: [],
    formFallback: false,
    utterances: [],
  }
}

/** 金额字段必须是整数分；负金额、浮点与字符串都拒绝（R007） */
function assertValue(field: ExtractionField, value: ExtractedField['value']): void {
  if (value === null) return
  if (AMOUNT_FIELDS.includes(field)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new NlError('VALUE_INVALID', `${field} 的金额必须是整数分且不小于 0，实际为 ${JSON.stringify(value)}`)
    }
    return
  }
  if (OPTIONAL_AMOUNT_FIELDS.includes(field)) {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new NlError('VALUE_INVALID', `${field} 的金额必须是整数分且不小于 0，实际为 ${JSON.stringify(value)}`)
      }
      return
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new NlError('VALUE_INVALID', `${field} 应为整数分或非空描述，实际为 ${JSON.stringify(value)}`)
    }
    return
  }
  if (BOOLEAN_FIELDS.includes(field)) {
    if (typeof value !== 'boolean') throw new NlError('VALUE_INVALID', `${field} 应为布尔值，实际为 ${JSON.stringify(value)}`)
    return
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NlError('VALUE_INVALID', `${field} 应为非空字符串，实际为 ${JSON.stringify(value)}`)
  }
  if (DATE_FIELDS.includes(field) && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\+08:00)?$/.test(value)) {
    throw new NlError('VALUE_INVALID', `${field} 应为 YYYY-MM-DD 或带 +08:00 的时刻，实际为 ${value}`)
  }
}

/** 解析模型返回的一轮文本：JSON 非法、结构不符、值非法都给出可处理的状态 */
export function parseExtraction(raw: string): ExtractedField[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new NlError('INVALID_JSON', `模型返回不是合法 JSON：${raw.slice(0, 120)}`)
  }
  const parsed = extractionPayloadSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new NlError('SCHEMA_VIOLATION', `模型返回不符合契约：${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`)
  }
  const seen = new Set<string>()
  for (const item of parsed.data.fields) {
    if (seen.has(item.field)) throw new NlError('SCHEMA_VIOLATION', `字段重复：${item.field}`)
    seen.add(item.field)
    assertValue(item.field, item.value)
    if (item.source_span !== null) {
      const utterance = item.source_text
      if (utterance === '') throw new NlError('VALUE_INVALID', `${item.field} 的 source_text 为空`)
    }
  }
  return parsed.data.fields
}

/** 把一轮提取结果写入会话；已确认的字段不会被模型覆盖（改写必须由用户操作） */
export function applyExtraction(session: NlSession, fields: readonly ExtractedField[], utterance: string): NlSession {
  const next: NlSession = { ...session, fields: new Map(session.fields), utterances: [...session.utterances, utterance] }
  for (const item of fields) {
    const slot = next.fields.get(item.field)
    if (slot === undefined) throw new NlError('SCHEMA_VIOLATION', `未知字段 ${item.field}`)
    if (slot.state === 'CONFIRMED') continue
    next.fields.set(item.field, { field: item.field, state: 'PENDING', value: item.value, sourceText: item.source_text })
  }
  return next
}

/** 处理一次回放／实时返回：成功则写入字段，失败则抛出带代码的错误 */
export function applyTurn(session: NlSession, utterance: string, turn: ReplayTurn): NlSession {
  if (turn.kind === 'timeout') throw new NlError('TIMEOUT', '模型调用超时')
  if (turn.kind === 'http_error') throw new NlError('HTTP_ERROR', `模型服务异常：${turn.payload}`)
  if (turn.kind === 'invalid_json') throw new NlError('INVALID_JSON', `模型返回不是合法 JSON：${turn.payload.slice(0, 120)}`)
  if (turn.kind === 'schema_violation') throw new NlError('SCHEMA_VIOLATION', `模型返回不符合契约：${turn.payload.slice(0, 120)}`)
  return applyExtraction(session, parseExtraction(turn.payload), utterance)
}

const QUESTION_PROMPTS: Record<string, string> = {
  ACTIVITY: '你想看的是哪一场演出？',
  CITY: '演出在哪个城市？',
  SHOW_DATETIME: '演出是哪天、几点开始？',
  TICKET_PURCHASED: '门票已经买了吗？',
  AMOUNT_PAID: '已经为门票付了多少钱？',
  SEAT_TIER: '对票档有要求吗？',
  ORIGIN_CITY: '你从哪个城市出发？',
  TRANSPORT_PREFERENCE: '交通方式有偏好吗？',
  LODGING_REQUIREMENT: '住宿有什么要求？',
  BUDGET: '这次观演的总预算大约多少？',
  CASH: '当前可用的现金大约多少？',
  EXPECTED_INCOME: '这段时间有确定的收入到账吗？',
  LIVING_COST: '生活费安排是怎样的？',
}

/** 只追问影响当前判断且仍为空的字段，按 D30 顺序，每轮最多 2 问、最多 3 轮（D52） */
export function nextQuestions(session: NlSession): { questions: Question[]; formFallback: boolean } {
  if (session.rounds >= MAX_QUESTION_ROUNDS) return { questions: [], formFallback: true }
  const asked = new Set(session.askedThisRound.map((question) => question.field))
  const questions: Question[] = []
  for (const field of EXTRACTION_FIELDS) {
    if (questions.length >= MAX_QUESTIONS_PER_ROUND) break
    const slot = session.fields.get(field as ExtractionField)
    if (slot === undefined) continue
    if (slot.state === 'CONFIRMED' || slot.state === 'REJECTED') continue
    if (slot.value !== null) continue
    if (asked.has(slot.field)) continue
    questions.push({ field: slot.field, prompt: QUESTION_PROMPTS[slot.field] ?? slot.field })
  }
  return { questions, formFallback: false }
}

/** 记录一轮追问已经提出；达到 3 轮后转为表单补填 */
export function recordQuestions(session: NlSession, questions: readonly Question[]): NlSession {
  if (questions.length > MAX_QUESTIONS_PER_ROUND) {
    throw new NlError('ROUNDS_EXHAUSTED', `每轮最多 ${MAX_QUESTIONS_PER_ROUND} 个问题，实际 ${questions.length} 个`)
  }
  const rounds = session.rounds + 1
  return {
    ...session,
    rounds,
    askedThisRound: [...questions],
    formFallback: rounds >= MAX_QUESTION_ROUNDS,
  }
}

/** 需求草稿、费用清单草稿与关键待办（T015-08）：费用清单只给类别与状态，不出现任何金额 */
export function buildDraft(session: NlSession): Draft {
  const valueOf = (field: ExtractionField): string | number | boolean | null => session.fields.get(field)?.value ?? null
  const parts: string[] = []
  if (valueOf('CITY') !== null) parts.push(`演出城市 ${String(valueOf('CITY'))}`)
  if (valueOf('ACTIVITY') !== null) parts.push(`活动 ${String(valueOf('ACTIVITY'))}`)
  if (valueOf('SHOW_DATETIME') !== null) parts.push(`时间 ${String(valueOf('SHOW_DATETIME'))}`)
  if (valueOf('ORIGIN_CITY') !== null) parts.push(`出发城市 ${String(valueOf('ORIGIN_CITY'))}`)
  const requirement = parts.length === 0 ? '尚未提取到可用字段，请补充需求。' : `${parts.join('；')}。以上为待确认信息。`

  const categories: { category: string; field: ExtractionField }[] = [
    { category: 'TICKET', field: 'TICKET_PURCHASED' },
    { category: 'OUTBOUND_TRANSPORT', field: 'ORIGIN_CITY' },
    { category: 'RETURN_TRANSPORT', field: 'ORIGIN_CITY' },
    { category: 'LODGING', field: 'LODGING_REQUIREMENT' },
  ]
  const costItems = categories.map((item) => ({ category: item.category, status: valueOf(item.field) === null ? ('PENDING' as const) : ('PROVIDED' as const) }))

  const todos: string[] = []
  for (const field of EXTRACTION_FIELDS) {
    const slot = session.fields.get(field as ExtractionField)
    if (slot !== undefined && slot.state !== 'CONFIRMED' && slot.value === null) todos.push(`补充${QUESTION_PROMPTS[slot.field] ?? slot.field}`)
  }
  for (const item of costItems) {
    if (item.status === 'PENDING') todos.push(`确认${item.category}的费用与付款日`)
  }
  return { requirement, cost_items: costItems, todos }
}

/** 用户确认若干字段：只接受非空且未确认的字段，产生确认记录（D60） */
export function confirmFields(session: NlSession, fields: readonly ExtractionField[]): { session: NlSession; records: { field: ExtractionField; value: string | number | boolean; input_version: string }[] } {
  const next: NlSession = { ...session, fields: new Map(session.fields) }
  const records: { field: ExtractionField; value: string | number | boolean; input_version: string }[] = []
  for (const field of fields) {
    const slot = next.fields.get(field)
    if (slot === undefined) throw new NlError('SCHEMA_VIOLATION', `未知字段 ${field}`)
    if (slot.value === null) throw new NlError('NOT_CONFIRMED', `${field} 没有可确认的值，不能把未提供的信息标记为已确认`)
    const record = z
      .strictObject({ field: z.string(), value: z.union([z.string(), z.int(), z.boolean()]), input_version: z.string() })
      .parse({ field, value: slot.value, input_version: session.inputVersion })
    records.push({ field, value: record.value, input_version: record.input_version })
    next.fields.set(field, { ...slot, state: 'CONFIRMED' })
  }
  return { session: next, records }
}

/** 用户拒绝某个候选值：不再用于草稿，也不会进入确认记录 */
export function rejectField(session: NlSession, field: ExtractionField): NlSession {
  const slot = session.fields.get(field)
  if (slot === undefined) throw new NlError('SCHEMA_VIOLATION', `未知字段 ${field}`)
  const next: NlSession = { ...session, fields: new Map(session.fields) }
  next.fields.set(field, { ...slot, state: 'REJECTED', value: null, sourceText: '' })
  return next
}

/** 用户修改字段：写入新值并回到待确认；已有确认记录不被改写 */
export function modifyField(session: NlSession, field: ExtractionField, value: ExtractedField['value'], sourceText: string): NlSession {
  const slot = session.fields.get(field)
  if (slot === undefined) throw new NlError('SCHEMA_VIOLATION', `未知字段 ${field}`)
  assertValue(field, value)
  const next: NlSession = { ...session, fields: new Map(session.fields) }
  next.fields.set(field, { field, state: 'MODIFIED', value, sourceText })
  return next
}

/**
 * 把已确认字段写成案例输入里的 confirmations[]，并用引擎 schema 复验。
 * 同一字段、同一版本、同一值重复确认不重复追加（幂等）；同字段不同值追加新记录。
 */
export function buildConfirmedCase(session: NlSession, records: readonly { field: string; value: string | number | boolean; input_version: string }[]): CaseFile {
  const existing = session.base.confirmations ?? []
  if (records.length === 0) return session.base
  const appended = [...existing]
  for (const record of records) {
    const same = appended.some((item) => item.field === record.field && item.input_version === record.input_version)
    if (same) {
      const previous = appended.find((item) => item.field === record.field && item.input_version === record.input_version)
      if (previous !== undefined && previous.value !== record.value) {
        throw new NlError('ALREADY_CONFIRMED', `${record.field} 在当前输入版本已有不同的确认值，须先形成新的输入版本`)
      }
      continue
    }
    appended.push(confirmationRecordSchema.parse({ field: record.field, value: record.value, input_version: record.input_version }))
  }
  const next = caseFileSchema.parse({ ...session.base, confirmations: appended })
  return next
}

export type HandoffResult = {
  caseFile: CaseFile
  result: ResultCore
  /** 早于当前输入版本的确认记录：不用于判断，须重新确认（D60） */
  staleFields: { field: string; inputVersion: string }[]
}

/**
 * 合法入口：把带确认记录的案例交给确定性引擎。
 * 这里不构造任何操作，也不使用 PATCH——确认记录是案例输入的一部分（D60、D58）。
 */
export function evaluateConfirmed(session: NlSession, records: readonly { field: string; value: string | number | boolean; input_version: string }[], config: EngineConfig = DEMO_CFG_1): HandoffResult {
  const caseFile = buildConfirmedCase(session, records)
  const output = evaluate(caseFile, [], config)
  const checkpoint = output.checkpoints.at(-1)
  if (checkpoint === undefined) throw new Error('引擎没有返回检查点')
  const staleFields = checkpoint.result.userConfirmations
    .filter((item) => item.status === 'NEEDS_RECONFIRM')
    .map((item) => ({ field: item.field, inputVersion: item.inputVersion }))
  return { caseFile, result: checkpoint.result, staleFields }
}
