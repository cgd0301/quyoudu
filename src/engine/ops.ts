import { z } from 'zod'
import { consumptionCategorySchema, coverModeSchema } from './enums.ts'
import { amountSchema, coverageSchema, dateSchema, inputVersionSchema, instantSchema } from './schema.ts'

// D29 白名单
const delayIncomeOp = z.strictObject({
  type: z.literal('DELAY_INCOME'),
  event_id: z.string(),
  expected_at: instantSchema,
})

const addLivingExpenseOp = z.strictObject({
  type: z.literal('ADD_LIVING_EXPENSE'),
  event_id: z.string(),
  expected_at: instantSchema,
  amount: amountSchema,
  cover_mode: coverModeSchema,
  // NEW_RESERVE 时为新建预留的编号，EXISTING_RESERVE 时为已有预留的编号
  reserve_id: z.string(),
  category: consumptionCategorySchema.optional(),
})

const changePaymentDateOp = z.strictObject({
  type: z.literal('CHANGE_PAYMENT_DATE'),
  window_id: z.string(),
})

const setAllocationOp = z.strictObject({
  type: z.literal('SET_ALLOCATION'),
  goal_allocation: amountSchema,
})

const addTodaySpendOp = z.strictObject({
  type: z.literal('ADD_TODAY_SPEND'),
  event_id: z.string(),
  amount: amountSchema,
  actual_at: instantSchema,
  goal_id: z.string().optional(),
  cost_item_id: z.string().optional(),
  category: consumptionCategorySchema.optional(),
  coverage: z.array(coverageSchema),
})

const pauseOp = z.strictObject({ type: z.literal('PAUSE') })

const cancelOp = z.strictObject({ type: z.literal('CANCEL') })

// 流程操作
const selectCandidateOp = z.strictObject({
  type: z.literal('SELECT_CANDIDATE'),
  candidate_id: z.string(),
})

const confirmOp = z.strictObject({
  type: z.literal('CONFIRM'),
  candidate_id: z.string(),
  plan_version: z.string(),
  input_version: inputVersionSchema,
})

const confirmForecastsOp = z.strictObject({
  type: z.literal('CONFIRM_FORECASTS'),
  forecasts: z.array(
    z.strictObject({
      series_id: z.string(),
      purchase_date: dateSchema,
    }),
  ),
})

// 引擎变异，界面不得出现（D58）
const patchOp = z.strictObject({
  type: z.literal('PATCH'),
  path: z.string().startsWith('/').meta({ description: '指向 CaseFile 的 JSON Pointer（RFC 6901）' }),
  value: z.unknown(),
})

const evaluateOp = z.strictObject({
  type: z.literal('EVALUATE'),
  label: z.string(),
})

export const opSchema = z.discriminatedUnion('type', [
  delayIncomeOp,
  addLivingExpenseOp,
  changePaymentDateOp,
  setAllocationOp,
  addTodaySpendOp,
  pauseOp,
  cancelOp,
  selectCandidateOp,
  confirmOp,
  confirmForecastsOp,
  patchOp,
  evaluateOp,
])

export const opsSchema = z.array(opSchema).meta({ title: 'Ops', description: '操作序列（rules.md §12.4）' })

export type Op = z.infer<typeof opSchema>
export type OpType = Op['type']

export const WHITELIST_OP_TYPES = [
  'DELAY_INCOME',
  'ADD_LIVING_EXPENSE',
  'CHANGE_PAYMENT_DATE',
  'SET_ALLOCATION',
  'ADD_TODAY_SPEND',
  'PAUSE',
  'CANCEL',
] as const satisfies readonly OpType[]

export const FLOW_OP_TYPES = ['SELECT_CANDIDATE', 'CONFIRM', 'CONFIRM_FORECASTS'] as const satisfies readonly OpType[]

export const ENGINE_OP_TYPES = ['PATCH'] as const satisfies readonly OpType[]

export const CHECKPOINT_OP_TYPES = ['EVALUATE'] as const satisfies readonly OpType[]

export const OP_TYPES = [
  ...WHITELIST_OP_TYPES,
  ...FLOW_OP_TYPES,
  ...ENGINE_OP_TYPES,
  ...CHECKPOINT_OP_TYPES,
] as const satisfies readonly OpType[]

export const UI_OP_TYPES = [...WHITELIST_OP_TYPES, ...FLOW_OP_TYPES] as const satisfies readonly OpType[]

// SPEC-GAP SG-32
export const FINAL_CHECKPOINT_LABEL = 'final'

/** ops 中没有 EVALUATE 时在末尾补一个检查点 */
export function ensureCheckpoint(ops: readonly Op[]): Op[] {
  if (ops.some((op) => op.type === 'EVALUATE')) return [...ops]
  return [...ops, { type: 'EVALUATE', label: FINAL_CHECKPOINT_LABEL }]
}
