import { z } from 'zod'

// §9.2
export const RESERVE_KINDS = ['LIVING', 'OTHER_PROTECTED', 'CONTINGENCY'] as const
export const reserveKindSchema = z.enum(RESERVE_KINDS)
export type ReserveKind = z.infer<typeof reserveKindSchema>

// §9.3、§10.2
export const EVENT_KINDS = ['GOAL_PAYMENT', 'OTHER_EXPENSE', 'INCOME', 'RETURN', 'CONTINGENCY_RELEASE'] as const
export const eventKindSchema = z.enum(EVENT_KINDS)
export type EventKind = z.infer<typeof eventKindSchema>

// §9.3
export const EVENT_STATUSES = ['EXPECTED', 'ACTUAL'] as const
export const eventStatusSchema = z.enum(EVENT_STATUSES)
export type EventStatus = z.infer<typeof eventStatusSchema>

// SPEC-GAP SG-31：DATE 只知日期，DATETIME 有具体时刻
export const TIME_PRECISIONS = ['DATE', 'DATETIME'] as const
export const timePrecisionSchema = z.enum(TIME_PRECISIONS)
export type TimePrecision = z.infer<typeof timePrecisionSchema>

// D03；AFTER_EVENT(n) 带参数，见 schema.ts
export const SNAPSHOT_PHASE_FIXED = ['DAY_START', 'DAY_END'] as const

// §9.3、D35
export const NODE_VERDICTS = [
  'PASS',
  'PROTECTED_SHORTFALL',
  'ALLOCATION_CONFLICT',
  'PAYMENT_SHORTFALL',
  'GAP_CONTINUED',
  'CONFLICT_CONTINUED',
] as const
export const nodeVerdictSchema = z.enum(NODE_VERDICTS)
export type NodeVerdict = z.infer<typeof nodeVerdictSchema>

// §10.6
export const TRIGGER_KINDS = ['START', 'OUTFLOW', 'OUTFLOW_GROUP', 'INCOME', 'OTHER'] as const
export const triggerKindSchema = z.enum(TRIGGER_KINDS)
export type TriggerKind = z.infer<typeof triggerKindSchema>

// §9.5、D21、D48
export const CONSUMPTION_CATEGORIES = [
  'MEALS',
  'LOCAL_TRANSPORT',
  'DAILY_GOODS',
  'ENTERTAINMENT',
  'GOAL_RELATED',
  'INCOME',
  'REFUND',
  'TRANSFER',
] as const
export const consumptionCategorySchema = z.enum(CONSUMPTION_CATEGORIES)
export type ConsumptionCategory = z.infer<typeof consumptionCategorySchema>

// §9.5
export const DAY_COVERAGES = ['COMPLETE', 'NO_SPEND', 'MISSING'] as const
export const dayCoverageSchema = z.enum(DAY_COVERAGES)
export type DayCoverage = z.infer<typeof dayCoverageSchema>

// R010
export const AMOUNT_STATUSES = ['CONFIRMED', 'ESTIMATE', 'PENDING', 'CONFIRMED_FREE', 'NOT_APPLICABLE'] as const
export const amountStatusSchema = z.enum(AMOUNT_STATUSES)
export type AmountStatus = z.infer<typeof amountStatusSchema>

// D59：省略即 PROVIDED
export const LIVING_ARRANGEMENTS = ['PROVIDED', 'NOT_PROVIDED'] as const
export const livingArrangementSchema = z.enum(LIVING_ARRANGEMENTS)
export type LivingArrangement = z.infer<typeof livingArrangementSchema>

// D60：D30 的十三项，另加 T015-07 的出行日期与住宿晚数
export const CONFIRMATION_FIELDS = [
  'ACTIVITY',
  'CITY',
  'SHOW_DATETIME',
  'TICKET_PURCHASED',
  'AMOUNT_PAID',
  'SEAT_TIER',
  'ORIGIN_CITY',
  'TRANSPORT_PREFERENCE',
  'LODGING_REQUIREMENT',
  'BUDGET',
  'CASH',
  'EXPECTED_INCOME',
  'LIVING_COST',
  'TRAVEL_DATE',
  'LODGING_NIGHTS',
] as const
export const confirmationFieldSchema = z.enum(CONFIRMATION_FIELDS)
export type ConfirmationField = z.infer<typeof confirmationFieldSchema>

export const USER_CONFIRMATION_STATUSES = ['CURRENT', 'NEEDS_RECONFIRM'] as const
export const userConfirmationStatusSchema = z.enum(USER_CONFIRMATION_STATUSES)
export type UserConfirmationStatus = z.infer<typeof userConfirmationStatusSchema>

// SPEC-GAP SG-31：cost_items.category、offers.scope、refundable_required 共用
export const ITEM_CATEGORIES = [
  'TICKET',
  'OUTBOUND_TRANSPORT',
  'RETURN_TRANSPORT',
  'LODGING',
  'MEALS',
  'LOCAL_TRANSPORT',
  'SERVICE_FEE',
  'OPTIONAL_PURCHASE',
] as const
export const itemCategorySchema = z.enum(ITEM_CATEGORIES)
export type ItemCategory = z.infer<typeof itemCategorySchema>

// SPEC-GAP SG-31：D13 的五档，按优先级排列
export const PRICE_BASES = ['QUOTE', 'FORECAST', 'REFERENCE', 'UNDATED_QUOTE', 'PENDING'] as const
export const priceBasisSchema = z.enum(PRICE_BASES)
export type PriceBasis = z.infer<typeof priceBasisSchema>

// §9.7
export const OFFER_TYPES = ['INSTANT_OFF', 'THRESHOLD_OFF', 'PERCENT_OFF', 'CASHBACK', 'VOUCHER'] as const
export const offerTypeSchema = z.enum(OFFER_TYPES)
export type OfferType = z.infer<typeof offerTypeSchema>

// §9.7
export const APPLIES_AT = ['ORDER', 'PAYMENT'] as const
export const appliesAtSchema = z.enum(APPLIES_AT)
export type AppliesAt = z.infer<typeof appliesAtSchema>

// §9.7、D45
export const ROUNDINGS = ['FLOOR', 'HALF_UP', 'CEIL', 'UNKNOWN'] as const
export const roundingSchema = z.enum(ROUNDINGS)
export type Rounding = z.infer<typeof roundingSchema>

// SPEC-GAP SG-31：R013 的来源类型
export const SOURCE_TYPES = ['LLM_GENERATED', 'HAND_WRITTEN'] as const
export const sourceTypeSchema = z.enum(SOURCE_TYPES)
export type SourceType = z.infer<typeof sourceTypeSchema>

// D29
export const COVER_MODES = ['NEW_RESERVE', 'EXISTING_RESERVE'] as const
export const coverModeSchema = z.enum(COVER_MODES)
export type CoverMode = z.infer<typeof coverModeSchema>

// §11.1
export const PLAN_STATES = [
  'INCOMPLETE',
  'PAYMENT_GAP',
  'CONSTRAINT_ISSUE',
  'FEASIBLE_UNDER_ASSUMPTIONS',
  'PAUSED',
  'CANCELLED',
] as const
export const planStateSchema = z.enum(PLAN_STATES)
export type PlanState = z.infer<typeof planStateSchema>

// §11.2
export const OPTIMIZATION_STATES = ['NOT_COMPARED', 'PARTIALLY_EVALUABLE', 'COMPLETED_FEASIBLE', 'NO_KNOWN_FEASIBLE'] as const
export const optimizationStateSchema = z.enum(OPTIMIZATION_STATES)
export type OptimizationState = z.infer<typeof optimizationStateSchema>

// §11.3
export const CONFIRMATION_STATES = ['NOT_SELECTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'DRAFT'] as const
export const confirmationStateSchema = z.enum(CONFIRMATION_STATES)
export type ConfirmationState = z.infer<typeof confirmationStateSchema>

// SPEC-GAP SG-31：D47 计划状态所针对的方案
export const PLAN_TARGETS = ['CONFIRMED_PLAN', 'SELECTED_CANDIDATE', 'INITIAL_DRAFT', 'NONE'] as const
export const planTargetSchema = z.enum(PLAN_TARGETS)
export type PlanTarget = z.infer<typeof planTargetSchema>

// D26
export const SCENARIO_KINDS = ['CONFIRMED_ONLY', 'RECENT_MONTH'] as const
export const scenarioKindSchema = z.enum(SCENARIO_KINDS)
export type ScenarioKind = z.infer<typeof scenarioKindSchema>

// SPEC-GAP SG-31：§10.5 第4步列出的情景不可用原因
export const SCENARIO_UNAVAILABLE_REASONS = [
  'HISTORY_INSUFFICIENT',
  'RECORDS_INCOMPLETE',
  'CONFIG_VERSION_MISSING',
  'CATEGORY_FLAGS_MISSING',
  'COVERAGE_UNCLEAR',
] as const
export const scenarioUnavailableReasonSchema = z.enum(SCENARIO_UNAVAILABLE_REASONS)
export type ScenarioUnavailableReason = z.infer<typeof scenarioUnavailableReasonSchema>

// SPEC-GAP SG-31：非 AMOUNT 的取值与 LABEL_CODES 同名
export const DAILY_DISPLAYS = ['AMOUNT', 'NEED_CONFIRMED_PLAN', 'UNAVAILABLE', 'NOT_RECOMMENDED'] as const
export const dailyDisplaySchema = z.enum(DAILY_DISPLAYS)
export type DailyDisplay = z.infer<typeof dailyDisplaySchema>

// SPEC-GAP SG-31：R017 第7、8条，购买与付款分开
export const TASK_STATES = ['PENDING_PURCHASE', 'PURCHASED', 'PAID'] as const
export const taskStateSchema = z.enum(TASK_STATES)
export type TaskState = z.infer<typeof taskStateSchema>

// SPEC-GAP SG-31：R010、§11.1"按当前假设可行"须列明的依赖条件
export const DEPENDENCY_KINDS = ['EXPECTED_INCOME', 'EXPECTED_RETURN', 'CONFIRMED_FORECAST', 'ESTIMATE'] as const
export const dependencyKindSchema = z.enum(DEPENDENCY_KINDS)
export type DependencyKind = z.infer<typeof dependencyKindSchema>

// SPEC-GAP SG-31：R017 第7条待核价条件、政策卡第五节购买前核价和条件复核
export const PENDING_CHECKS = ['RECHECK_PRICE', 'RECHECK_OFFER_CONDITIONS'] as const
export const pendingCheckSchema = z.enum(PENDING_CHECKS)
export type PendingCheck = z.infer<typeof pendingCheckSchema>

// SPEC-GAP SG-31：R020、D24、§7.2
export const FORECAST_STATUSES = [
  'AVAILABLE',
  'HISTORY_INSUFFICIENT',
  'BACKTEST_INSUFFICIENT',
  'NOT_COMPARABLE',
  'FIT_FAILED',
  'INVALID_RESULT',
  'CONFIG_NOT_FROZEN',
] as const
export const forecastStatusSchema = z.enum(FORECAST_STATUSES)
export type ForecastStatus = z.infer<typeof forecastStatusSchema>

// SPEC-GAP SG-31：§11.1"暂无法完整判断"的触发条件
export const INPUT_ISSUE_CODES = [
  'MISSING_KEY_INFO',
  'CASH_AS_OF_MISMATCH',
  'AS_OF_FORMAT',
  'SNAPSHOT_PHASE_MISSING',
  'SNAPSHOT_PHASE_MISMATCH',
  'COVERAGE_EXCEEDS_AMOUNT',
  'GROUP_COVERAGE_OVERSUBSCRIBED',
  'OVERDUE_EVENT',
  'QUOTE_EXPIRED',
  'OUT_OF_RANGE',
  'NON_CNY',
  'REFERENCE_INVALID',
  'NO_PLAN',
  'SPEC_NOT_COVERED',
] as const
export const inputIssueCodeSchema = z.enum(INPUT_ISSUE_CODES)
export type InputIssueCode = z.infer<typeof inputIssueCodeSchema>

// SPEC-GAP SG-31：计入待确认数的原因（R010、R011、D16、D17）
export const PENDING_REASON_CODES = [
  'PRICE_PENDING',
  'QUOTE_EXPIRED',
  'NON_CNY',
  'ROUNDING_UNKNOWN',
  'OFFER_ORDER_MISSING',
  'OFFER_CONDITION_UNKNOWN',
  'COMPARISON_FIELD_MISSING',
  'PAYMENT_TIME_MISSING',
  'SHARED_INPUT_INCOMPLETE',
] as const
export const pendingReasonCodeSchema = z.enum(PENDING_REASON_CODES)
export type PendingReasonCode = z.infer<typeof pendingReasonCodeSchema>

// SPEC-GAP SG-31：确定性排除的原因（R009、R016、D16）
export const EXCLUDED_REASON_CODES = [
  'BUDGET_EXCEEDED',
  'PAYMENT_GAP',
  'ALLOCATION_CONFLICT',
  'ARRIVAL_TOO_LATE',
  'RETURN_TOO_EARLY',
  'LODGING_NIGHTS_NOT_COVERED',
  'SEAT_TIER_NOT_ALLOWED',
  'LODGING_TOO_FAR',
  'NOT_REFUNDABLE',
  'OFFER_EXPIRED',
  'OFFER_NOT_STACKABLE',
  'OFFER_MAX_USES_EXCEEDED',
  'OFFER_THRESHOLD_NOT_MET',
  'OFFER_SCOPE_MISMATCH',
  'DUPLICATE_CANDIDATE',
] as const
export const excludedReasonCodeSchema = z.enum(EXCLUDED_REASON_CODES)
export type ExcludedReasonCode = z.infer<typeof excludedReasonCodeSchema>

// SPEC-GAP SG-31：§11.4 固定文案的代码，文字见 result.ts 的 LABEL_TEXT
export const LABEL_CODES = [
  'NEED_CONFIRMED_PLAN',
  'UNAVAILABLE',
  'NOT_RECOMMENDED',
  'DAILY_DISCLAIMER',
  'CONFIRMED_ONLY',
  'FORECAST_CONFIG_NOT_FROZEN',
  'HISTORY_INSUFFICIENT',
  'FORECAST_UNAVAILABLE',
  'FORECAST_DISCLAIMER',
  'DRAFT_PREVIEW',
  'PREVIEW_UNCONFIRMED',
  'TOP_K_DEMO',
  'IF_RECEIVED',
  'SAME_PRICE',
  'SPEC_NOT_COVERED',
  'PRE_RANGE_PAID',
  'PAID_BY_UNALLOCATED_LATER',
  'PROTECTED_SQUEEZE',
  'NEED_RECONFIRM',
  'LIVING_ARRANGEMENT_MISSING',
  'SIMULATED_DATA',
] as const
export const labelCodeSchema = z.enum(LABEL_CODES)
export type LabelCode = z.infer<typeof labelCodeSchema>
