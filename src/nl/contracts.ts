/**
 * 自然语言层的输入输出契约（R015、D30、D32、D52、D60）。
 *
 * 三条硬约束写在这里是为了让它们可被校验，而不是只写在文档里：
 * 1. 模型只能输出 D30 固定的 13 个字段，字段名与类型固定，未知字段一律拒绝；
 * 2. 模型给的每个值都是“待确认值”，本模块不产生任何金额、可行性或排序结论；
 * 3. 进入计算的确认记录只用引擎自己的 schema（caseConfirmationSchema）表达。
 */
import { z } from 'zod'
import { CONFIRMATION_FIELDS, confirmationFieldSchema } from '../engine/enums.ts'
import { confirmationValueSchema, inputVersionSchema } from '../engine/schema.ts'

/** D30 的 13 个提取字段（CONFIRMATION_FIELDS 的前 13 项） */
export const EXTRACTION_FIELDS = CONFIRMATION_FIELDS.slice(0, 13) as readonly string[]
export const extractionFieldSchema = z.enum(EXTRACTION_FIELDS as [string, ...string[]])
export type ExtractionField = z.infer<typeof extractionFieldSchema>

/** 纯金额字段：必须是整数分。EXPECTED_INCOME 与 LIVING_COST 是复合描述，见 OPTIONAL_AMOUNT_FIELDS */
export const AMOUNT_FIELDS: readonly ExtractionField[] = ['AMOUNT_PAID', 'BUDGET', 'CASH']
/** 既可给整数分、也可给文字描述（如“每月1号1200元生活费”） */
export const OPTIONAL_AMOUNT_FIELDS: readonly ExtractionField[] = ['EXPECTED_INCOME', 'LIVING_COST']
export const BOOLEAN_FIELDS: readonly ExtractionField[] = ['TICKET_PURCHASED']
export const DATE_FIELDS: readonly ExtractionField[] = ['SHOW_DATETIME']

export const sourceSpanSchema = z
  .strictObject({
    start: z.int().min(0),
    end: z.int().min(0),
  })
  .refine((span) => span.end > span.start, 'source_span 的 end 必须大于 start')

/** 模型输出的单个字段：值为 null 表示原文没有提到，不猜 */
export const extractedValueSchema = z.union([z.string(), z.int(), z.boolean(), z.null()])

export const extractedFieldSchema = z.strictObject({
  field: extractionFieldSchema,
  value: extractedValueSchema,
  /** 原文片段，用作用户核对；不参与计算 */
  source_text: z.string(),
  source_span: sourceSpanSchema.nullable(),
})

/** 模型一次返回的内容：只允许 fields，未知键报错（zod strict） */
export const extractionPayloadSchema = z.strictObject({
  fields: z.array(extractedFieldSchema),
})

export type ExtractedField = z.infer<typeof extractedFieldSchema>
export type ExtractionPayload = z.infer<typeof extractionPayloadSchema>

/** 字段级状态：待确认 → 已确认 / 已拒绝；修改后回到待确认并记录新值 */
export const FIELD_STATES = ['PENDING', 'CONFIRMED', 'REJECTED', 'MODIFIED'] as const
export const fieldStateSchema = z.enum(FIELD_STATES)
export type FieldState = z.infer<typeof fieldStateSchema>

export const draftCostItemSchema = z.strictObject({
  category: z.string(),
  status: z.enum(['PROVIDED', 'PENDING']),
})

export const draftSchema = z.strictObject({
  requirement: z.string(),
  cost_items: z.array(draftCostItemSchema),
  todos: z.array(z.string()),
})
export type Draft = z.infer<typeof draftSchema>

export const questionSchema = z.strictObject({
  field: extractionFieldSchema,
  prompt: z.string(),
})
export type Question = z.infer<typeof questionSchema>

/** 每轮最多 2 问、最多 3 轮（D52） */
export const MAX_QUESTIONS_PER_ROUND = 2
export const MAX_QUESTION_ROUNDS = 3

export const replayTurnSchema = z.strictObject({
  /** ok：正常结构化输出；timeout／http_error／invalid_json：调用失败；schema_violation：JSON 合法但违反契约 */
  kind: z.enum(['ok', 'timeout', 'http_error', 'invalid_json', 'schema_violation']),
  /** ok 时为字符串化的 JSON；失败时为错误说明；schema_violation 时为越界 JSON 原文 */
  payload: z.string(),
})
export type ReplayTurn = z.infer<typeof replayTurnSchema>

export const recordingSchema = z.strictObject({
  recording_id: z.string().min(1),
  case_id: z.string().min(1),
  scenario: z.string().min(1),
  /** 固定话术（D30：演示使用固定话术，默认回放模式） */
  utterances: z.array(z.string()).min(1),
  turns: z.array(replayTurnSchema).min(1),
})
export type Recording = z.infer<typeof recordingSchema>

export const recordingIndexSchema = z.strictObject({
  simulated: z.literal(true),
  notice: z.string(),
  about: z.string(),
  recordings: z.array(z.string().min(1)),
})

/** 确认记录：进入引擎输入的唯一形态（D60）；字段名与类型取自引擎的枚举与基础 schema */
export const confirmationRecordSchema = z.strictObject({
  field: confirmationFieldSchema,
  value: confirmationValueSchema,
  input_version: inputVersionSchema,
})

export type NlErrorCode =
  | 'INVALID_JSON'
  | 'SCHEMA_VIOLATION'
  | 'VALUE_INVALID'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'LIVE_UNAVAILABLE'
  | 'NOT_CONFIRMED'
  | 'ALREADY_CONFIRMED'
  | 'STALE_VERSION'
  | 'ROUNDS_EXHAUSTED'

export class NlError extends Error {
  readonly code: NlErrorCode

  constructor(code: NlErrorCode, message: string) {
    super(message)
    this.name = 'NlError'
    this.code = code
  }
}
