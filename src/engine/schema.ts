import { z } from 'zod'
import {
  SNAPSHOT_PHASE_FIXED,
  amountStatusSchema,
  appliesAtSchema,
  consumptionCategorySchema,
  dayCoverageSchema,
  eventKindSchema,
  eventStatusSchema,
  itemCategorySchema,
  offerTypeSchema,
  priceBasisSchema,
  reserveKindSchema,
  roundingSchema,
  sourceTypeSchema,
  timePrecisionSchema,
} from './enums.ts'

// schema 只拒绝结构错误；币种、日期范围、时区偏移、快照阶段与计入标记、编号引用由引擎报告输入冲突（§11.1）

export const amountSchema = z.int().meta({ description: '金额，整数分（R007、§9.1）' })

export const instantSchema = z
  .string()
  .meta({ description: '时刻（应带 +08:00 偏移，D03）或只给日期的 YYYY-MM-DD；格式与范围由引擎检查' })

export const dateSchema = z.iso.date()

export const inputVersionSchema = z
  .string()
  .regex(/^v[1-9][0-9]*$/)
  .meta({ description: '输入版本 v1、v2……（R013）' })

const AFTER_EVENT_PATTERN = /^AFTER_EVENT\([1-9][0-9]*\)$/

// templateLiteral 不执行各部分的检查，正整数另行校验
export const afterEventPhaseSchema = z
  .templateLiteral(['AFTER_EVENT(', z.int(), ')'])
  .refine((value) => AFTER_EVENT_PATTERN.test(value), 'AFTER_EVENT(n) 的 n 须为正整数')
  .meta({ pattern: AFTER_EVENT_PATTERN.source, description: '已计入至当日第 n 笔收付款（D03、D51）' })

export const snapshotPhaseSchema = z.union([z.enum(SNAPSHOT_PHASE_FIXED), afterEventPhaseSchema])
export type SnapshotPhase = z.infer<typeof snapshotPhaseSchema>

export const coverageSchema = z.strictObject({
  reserve_id: z.string(),
  covered_amount: amountSchema,
})

const metaSchema = z.strictObject({
  case_id: z.string(),
  purpose: z.string(),
  data_version: z.string(),
  simulated: z.literal(true),
  source_type: sourceTypeSchema,
  generator: z.string(),
  batch: z.string(),
  created_at_real: z.string().meta({ description: '真实生成时间，只作管理元数据，不进入计算（R008）' }),
  demo_points: z.array(z.string()),
  boundary_test: z.boolean().optional(),
  continuation_of: z.string().optional(),
})

// SPEC-GAP SG-30：§9.2 的 other_goal_hold，D09 只表示为一条固定占用
const otherGoalHoldSchema = z.strictObject({
  name: z.string(),
  amount: amountSchema,
})

const snapshotSchema = z.strictObject({
  as_of: instantSchema,
  cash_as_of: instantSchema,
  snapshot_phase: snapshotPhaseSchema.nullable(),
  cash: amountSchema.nullable(),
  goal_allocation: amountSchema,
  other_goal_hold: otherGoalHoldSchema.nullable(),
})

const reserveSchema = z.strictObject({
  reserve_id: z.string(),
  reserve_kind: reserveKindSchema,
  amount: amountSchema,
  coverage_start: dateSchema,
  coverage_end: dateSchema,
  release_at_end: z.boolean(),
  funding_event_id: z.string().optional(),
})

// SPEC-GAP SG-31：D29 改付款日期只能选这里列出的窗口
const eventPaymentWindowSchema = z.strictObject({
  window_id: z.string(),
  expected_at: instantSchema,
})

const eventSchema = z.strictObject({
  event_id: z.string(),
  event_kind: eventKindSchema,
  event_status: eventStatusSchema,
  amount: amountSchema.nullable(),
  expected_at: instantSchema.nullable(),
  actual_at: instantSchema.optional(),
  time_precision: timePrecisionSchema,
  known_order: z.int().optional(),
  in_snapshot: z.boolean(),
  goal_id: z.string().optional(),
  cost_item_id: z.string().optional(),
  task_id: z.string().optional(),
  coverage: z.array(coverageSchema),
  trigger_condition: z.string().optional(),
  recorded_at: instantSchema,
  available_at: instantSchema,
  currency: z.string(),
  // SPEC-GAP SG-31：生活支出的消费类别，供 §5 去重
  category: consumptionCategorySchema.optional(),
  payment_windows: z.array(eventPaymentWindowSchema).optional(),
})

const seatTierSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
})

// D16、D44：约束为 null 表示未填写
const goalSchema = z.strictObject({
  goal_id: z.string(),
  // SPEC-GAP SG-31：本目标分配的名称（T004-03）
  name: z.string().optional(),
  budget_cap: amountSchema.nullable(),
  show_start_at: instantSchema,
  show_end_at: instantSchema,
  venue_city: z.string(),
  seat_tiers: z.array(seatTierSchema),
  arrive_before_show_min: z.int().nullable(),
  return_after_show_min: z.int().nullable(),
  lodging_nights_required: z.array(dateSchema).nullable(),
  seat_tier_allowed: z.array(z.string()).nullable(),
  lodging_max_distance_m: z.int().nullable(),
  refundable_required: z.array(itemCategorySchema).nullable(),
})

const costItemSchema = z.strictObject({
  cost_item_id: z.string(),
  category: itemCategorySchema,
  necessary: z.boolean(),
  amount_status: amountStatusSchema,
  confirm_basis: z.string().optional(),
})

// valid_from、valid_to 为 null 即有效期未知（R009）
const quoteSchema = z.strictObject({
  valid_from: instantSchema.nullable(),
  valid_to: instantSchema.nullable(),
  recorded_at: instantSchema,
  available_at: instantSchema,
})

const itemPaymentWindowSchema = z.strictObject({
  window_id: z.string(),
  payment_at: instantSchema,
})

const candidateItemSchema = z.strictObject({
  cost_item_id: z.string(),
  channel: z.string(),
  // 门票项填 goal.seat_tiers 中的编码
  spec: z.string(),
  price: amountSchema.nullable(),
  currency: z.string(),
  price_basis: priceBasisSchema,
  order_id: z.string(),
  purchase_date: dateSchema,
  payment_at: instantSchema,
  arrive_at: instantSchema.optional(),
  depart_at: instantSchema.optional(),
  lodging_distance_m: z.int().optional(),
  lodging_nights: z.array(dateSchema).optional(),
  refundable: z.boolean().optional(),
  quote: quoteSchema,
  payment_windows: z.array(itemPaymentWindowSchema).optional(),
})

// SPEC-GAP SG-30：order_id 为该次使用所作用的订单；sequence 缺省即未给出叠加计算顺序（D45）
const offerUseSchema = z.strictObject({
  offer_id: z.string(),
  order_id: z.string(),
  sequence: z.int().optional(),
})

// SPEC-GAP SG-31：取 RETURN 事件字段的子集
const candidateReturnSchema = z.strictObject({
  event_id: z.string(),
  amount: amountSchema.nullable(),
  expected_at: instantSchema.nullable(),
  time_precision: timePrecisionSchema,
  trigger_condition: z.string().optional(),
  cost_item_id: z.string().optional(),
  currency: z.string(),
  recorded_at: instantSchema,
  available_at: instantSchema,
})

const candidateSchema = z.strictObject({
  candidate_id: z.string(),
  items: z.array(candidateItemSchema),
  offers_used: z.array(offerUseSchema),
  returns: z.array(candidateReturnSchema),
})

const offerSchema = z.strictObject({
  offer_id: z.string(),
  type: offerTypeSchema,
  value: z.int().meta({ description: '立减、满减、返现、返券为整数分；折扣为万分比，9500 即 9.5 折（D45）' }),
  scope: z.array(itemCategorySchema),
  threshold: amountSchema.nullable(),
  valid_from: instantSchema.nullable(),
  valid_to: instantSchema.nullable(),
  applies_at: appliesAtSchema,
  max_uses: z.int(),
  stackable_with: z.array(z.string()),
  rounding: roundingSchema,
  // 返现的到账日期和触发条件（D12）
  expected_at: instantSchema.optional(),
  trigger_condition: z.string().optional(),
})

// SPEC-GAP SG-31：每行一笔日级观测，按 series_id 成序列
const priceObservationSchema = z.strictObject({
  series_id: z.string(),
  cost_item_id: z.string(),
  channel: z.string(),
  spec: z.string(),
  service_date: dateSchema,
  observed_on: dateSchema,
  price: amountSchema,
  currency: z.string(),
  recorded_at: instantSchema,
  available_at: instantSchema,
})

const consumptionItemSchema = z.strictObject({
  event_id: z.string(),
  category: consumptionCategorySchema,
  amount: amountSchema,
  currency: z.string(),
  in_snapshot: z.boolean(),
  recorded_at: instantSchema,
  available_at: instantSchema,
  covered_by_living_reserve: z.boolean().optional(),
  same_scope_as_discretionary: z.boolean().optional(),
})

// SPEC-GAP SG-31：按日记录覆盖状态和当日消费
const consumptionDaySchema = z.strictObject({
  observed_on: dateSchema,
  day_coverage: dayCoverageSchema,
  items: z.array(consumptionItemSchema),
})

// SPEC-GAP SG-30：§9.2 的 planned_allocation，D46 只建一笔
const plannedAllocationSchema = z.strictObject({
  funding_event_id: z.string(),
  amount: amountSchema,
})

const confirmedPlanSchema = z.strictObject({
  candidate_id: z.string(),
  plan_version: z.string(),
  input_version: inputVersionSchema,
})

// D14：按项目＋购买日确认
const forecastConfirmationSchema = z.strictObject({
  series_id: z.string(),
  purchase_date: dateSchema,
  price: amountSchema,
  config_version: z.string(),
})

const nlScriptSchema = z.strictObject({
  script_id: z.string(),
  utterances: z.array(z.string()),
})

export const caseFileSchema = z
  .strictObject({
    meta: metaSchema,
    snapshot: snapshotSchema,
    reserves: z.array(reserveSchema),
    events: z.array(eventSchema),
    goal: goalSchema,
    cost_items: z.array(costItemSchema),
    candidates: z.array(candidateSchema),
    offers: z.array(offerSchema),
    price_series: z.array(priceObservationSchema),
    consumption_records: z.array(consumptionDaySchema),
    planned_allocation: plannedAllocationSchema.nullable(),
    confirmed_plan: confirmedPlanSchema.optional(),
    forecast_confirmations: z.array(forecastConfirmationSchema),
    nl_script: nlScriptSchema.optional(),
  })
  .meta({ title: 'CaseFile', description: '案例输入（rules.md §12.2）' })

export type CaseFile = z.infer<typeof caseFileSchema>
