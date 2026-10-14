import { z } from 'zod'
import {
  confirmationStateSchema,
  consumptionCategorySchema,
  dailyDisplaySchema,
  dependencyKindSchema,
  excludedReasonCodeSchema,
  forecastStatusSchema,
  confirmationFieldSchema,
  inputIssueCodeSchema,
  itemCategorySchema,
  labelCodeSchema,
  userConfirmationStatusSchema,
  nodeVerdictSchema,
  optimizationStateSchema,
  pendingCheckSchema,
  pendingReasonCodeSchema,
  planStateSchema,
  planTargetSchema,
  scenarioKindSchema,
  scenarioUnavailableReasonSchema,
  taskStateSchema,
  triggerKindSchema,
  type LabelCode,
} from './enums.ts'
import { confirmationValueSchema, dateSchema, inputVersionSchema } from './schema.ts'

// TS 内用 camelCase，toWire() 只把键名转为 snake_case；不得用数据作键，否则会被一并转换

export const basisSchema = z.strictObject({
  eventIds: z.array(z.string()),
  reserveIds: z.array(z.string()),
  rules: z.array(z.string()),
})

export const moneySchema = z
  .strictObject({
    value: z.int(),
    basis: basisSchema,
  })
  .meta({ id: 'Money', description: '金额（整数分）及计算依据；全部位置由 moneyPaths() 列出' })

export type Basis = z.infer<typeof basisSchema>
export type Money = z.infer<typeof moneySchema>

const decimal12Schema = z
  .string()
  .regex(/^-?[0-9]+\.[0-9]{12}$/)
  .meta({ description: '保留 12 位小数的十进制串，单位为分（D25、D50）' })

const decimalParamSchema = z.string().regex(/^[0-9]+(\.[0-9]+)?$/)

const inputIssueSchema = z.strictObject({
  code: inputIssueCodeSchema,
  rule: z.string(),
  refs: z.array(z.string()),
})

const pendingReasonSchema = z.strictObject({
  code: pendingReasonCodeSchema,
  rule: z.string(),
  refs: z.array(z.string()),
})

const excludedReasonSchema = z.strictObject({
  code: excludedReasonCodeSchema,
  rule: z.string(),
  refs: z.array(z.string()),
})

const checkPeriodSchema = z.strictObject({
  start: z.string(),
  end: dateSchema.nullable(),
  outOfRange: z.boolean(),
})

// §1、§9.2：C、L、N、O、M、A、G、H、U
const balanceShape = {
  cash: moneySchema,
  livingReserve: moneySchema,
  otherProtectedReserve: moneySchema,
  otherGoalHold: moneySchema,
  contingencyReserve: moneySchema,
  goalAllocation: moneySchema,
  goalAvailable: moneySchema,
  paymentHeadroom: moneySchema,
  unallocated: moneySchema,
  protectedTotal: moneySchema,
}

const snapshotIssueSchema = z.strictObject({
  nodeVerdict: nodeVerdictSchema.extract(['PROTECTED_SHORTFALL', 'ALLOCATION_CONFLICT']),
  amount: moneySchema,
})

const snapshotResultSchema = z.strictObject({
  ...balanceShape,
  issues: z.array(snapshotIssueSchema),
})

// §10.4 第5步
const nodeSchema = z.strictObject({
  at: z.string(),
  trigger: z.strictObject({
    kind: triggerKindSchema,
    eventIds: z.array(z.string()),
  }),
  ...balanceShape,
  nodeVerdict: nodeVerdictSchema,
  amount: moneySchema.nullable(),
  protectedOverCash: moneySchema.nullable(),
  allocationUnsupported: moneySchema.nullable(),
  related: z.array(z.string()),
})

// D11、D35
const gapRefSchema = z
  .strictObject({
    nodeIndex: z.int(),
    at: z.string(),
    nodeVerdict: nodeVerdictSchema,
    amount: moneySchema,
    related: z.array(z.string()),
  })
  .meta({ id: 'GapRef' })

const constraintIssuesSchema = z.strictObject({
  budgetOverrun: moneySchema.nullable(),
  allocationConflicts: z.array(gapRefSchema),
})

const paymentLineSchema = z.strictObject({
  eventId: z.string(),
  costItemId: z.string().nullable(),
  at: z.string().nullable(),
  amount: moneySchema,
})

// §3 与政策卡第四节分开显示的金额
const costSchema = z.strictObject({
  paidTotal: moneySchema,
  futurePayable: moneySchema.nullable(),
  eligibleReturn: moneySchema,
  netSpend: moneySchema.nullable(),
  netSpendIfReceived: moneySchema.nullable(),
  budgetOverrun: moneySchema.nullable(),
  paidPayments: z.array(paymentLineSchema),
  futurePayments: z.array(paymentLineSchema),
  protectedReserves: z.strictObject({
    livingReserve: moneySchema,
    otherProtectedReserve: moneySchema,
    otherGoalHold: moneySchema,
  }),
  contingencyReserve: moneySchema,
  pendingCostItemIds: z.array(z.string()),
})

const dependencySchema = z.strictObject({
  kind: dependencyKindSchema,
  refs: z.array(z.string()),
  amount: moneySchema.nullable(),
  at: z.string().nullable(),
})

const candidateResultSchema = z.strictObject({
  candidateId: z.string(),
  planVersion: z.string(),
  evaluable: z.boolean(),
  pendingReasons: z.array(pendingReasonSchema),
  excludedReasons: z.array(excludedReasonSchema),
  feasible: z.boolean().nullable(),
  netSpend: moneySchema.nullable(),
  netSpendIfReceived: moneySchema.nullable(),
  tieGroup: z.int().nullable(),
  rank: z.int().nullable(),
})

const optimizationSchema = z.strictObject({
  scope: z.array(z.string()),
  evaluatedCount: z.int(),
  pendingCount: z.int(),
  excludedCount: z.int(),
  topK: z.int(),
})

// D46；unallocatedNote 非 null 时显示"届时由未分配资金支付"及该金额
const confirmationSchema = z.strictObject({
  candidateId: z.string(),
  planVersion: z.string(),
  inputVersion: inputVersionSchema,
  w: moneySchema,
  m: moneySchema,
  deltaA: moneySchema,
  plannedAllocation: z
    .strictObject({
      fundingEventId: z.string(),
      amount: moneySchema,
    })
    .nullable(),
  unallocatedNote: moneySchema.nullable(),
})

// R017 第7条
const actionItemSchema = z.strictObject({
  taskId: z.string(),
  costItemId: z.string(),
  category: itemCategorySchema,
  spec: z.string(),
  purchaseDate: z.string().nullable(),
  channel: z.string(),
  offerIds: z.array(z.string()),
  amount: moneySchema.nullable(),
  paymentAt: z.string().nullable(),
  pendingChecks: z.array(pendingCheckSchema),
  taskState: taskStateSchema,
  planVersion: z.string(),
})

// R019、D26、D27
const dailyReferenceSchema = z.strictObject({
  display: dailyDisplaySchema,
  amount: moneySchema.optional(),
  limitedBy: z
    .strictObject({
      scenario: scenarioKindSchema,
      nodeIndex: z.int().nullable(),
    })
    .optional(),
  label: labelCodeSchema.optional(),
  unavailable: z.array(
    z.strictObject({
      scenario: scenarioKindSchema,
      reason: scenarioUnavailableReasonSchema,
    }),
  ),
  // D59：NOT_PROVIDED 时含 LIVING_ARRANGEMENT_MISSING，且不给出 amount
  missingReasons: z.array(z.literal('LIVING_ARRANGEMENT_MISSING')),
})

// §11、D47；underlyingPlanState 只在已暂停、已取消时给出底层检查的状态
const statesSchema = z.strictObject({
  planState: planStateSchema,
  underlyingPlanState: planStateSchema.exclude(['PAUSED', 'CANCELLED']).nullable(),
  optimizationState: optimizationStateSchema,
  confirmationState: confirmationStateSchema,
  planTarget: planTargetSchema,
})

// R020、§6、§9.6
const forecastSchema = z.strictObject({
  seriesId: z.string(),
  costItemId: z.string(),
  purchaseDate: dateSchema,
  horizon: z.int(),
  status: forecastStatusSchema,
  configVersion: z.string().nullable(),
  sampleCount: z.int(),
  historyEnd: dateSchema.nullable(),
  alpha: decimalParamSchema.nullable(),
  beta: decimalParamSchema.nullable(),
  phi: decimalParamSchema.nullable(),
  level: decimal12Schema.nullable(),
  trend: decimal12Schema.nullable(),
  trainSse: decimal12Schema.nullable(),
  predicted: decimal12Schema.nullable(),
  amount: moneySchema.nullable(),
  backtestMae: decimal12Schema.nullable(),
  baselineMae: decimal12Schema.nullable(),
  backtestCount: z.int(),
  confirmed: z.boolean(),
})

// R018、§5、§9.5
const scenarioGroupSchema = z.strictObject({
  category: consumptionCategorySchema,
  coverageStart: dateSchema,
  coverageEnd: dateSchema,
  scenarioGroupTotal: moneySchema,
  scheduledGroupTotal: moneySchema,
  scenarioIncrement: moneySchema,
  dailyAmounts: z.array(
    z.strictObject({
      date: dateSchema,
      amount: moneySchema,
    }),
  ),
})

const scenarioSchema = z.strictObject({
  kind: scenarioKindSchema,
  available: z.boolean(),
  unavailableReason: scenarioUnavailableReasonSchema.nullable(),
  configVersion: z.string().nullable(),
  observationStart: dateSchema.nullable(),
  observationEnd: dateSchema.nullable(),
  completeDays: z.int(),
  groups: z.array(scenarioGroupSchema),
  todayReplacement: moneySchema.nullable(),
  dailyReference: moneySchema.nullable(),
})

export const resultCoreSchema = z
  .strictObject({
    asOf: z.string(),
    inputVersion: inputVersionSchema,
    configVersion: z.string().nullable(),
    topKLabel: z.string(),
    checkPeriod: checkPeriodSchema,
    inputIssues: z.array(inputIssueSchema),
    snapshot: snapshotResultSchema.nullable(),
    nodes: z.array(nodeSchema),
    earliestGap: gapRefSchema.nullable(),
    gapList: z.array(gapRefSchema),
    constraintIssues: constraintIssuesSchema,
    cost: costSchema,
    dependencies: z.array(dependencySchema),
    candidates: z.array(candidateResultSchema),
    optimization: optimizationSchema,
    confirmation: confirmationSchema.nullable(),
    actionList: z.array(actionItemSchema),
    dailyReference: dailyReferenceSchema,
    // D60：早于当前输入版本的确认 status 为 NEEDS_RECONFIRM，不用于该版本的判断
    userConfirmations: z.array(
      z.strictObject({
        field: confirmationFieldSchema,
        value: confirmationValueSchema,
        inputVersion: inputVersionSchema,
        status: userConfirmationStatusSchema,
      }),
    ),
    states: statesSchema,
    forecasts: z.array(forecastSchema).optional(),
    scenarios: z.array(scenarioSchema).optional(),
    labels: z.array(labelCodeSchema),
  })
  .meta({ title: 'ResultCore', description: '输出（rules.md §12.5）；导出的 JSON Schema 键名为 toWire() 之后的 snake_case' })

export type ResultCore = z.infer<typeof resultCoreSchema>

// rules.md §11.4 原文；SIMULATED_DATA 为 AGENTS.md 要求的模拟数据标识
export const LABEL_TEXT: Readonly<Record<LabelCode, string>> = {
  NEED_CONFIRMED_PLAN: '确认方案后可计算',
  UNAVAILABLE: '暂无法给出建议金额',
  NOT_RECOMMENDED: '当前不建议新增非计划支出',
  DAILY_DISCLAIMER: '按当前输入和假设测算，不是资金安全保证',
  CONFIRMED_ONLY: '仅依据已确认安排',
  FORECAST_CONFIG_NOT_FROZEN: '预测配置未冻结',
  HISTORY_INSUFFICIENT: '历史不足',
  FORECAST_UNAVAILABLE: '预测不可用',
  FORECAST_DISCLAIMER: '模拟历史数据生成的预测估算，不是确定报价',
  DRAFT_PREVIEW: '草案预览',
  PREVIEW_UNCONFIRMED: '预览，未确认',
  TOP_K_DEMO: 'K=3（演示配置v1）',
  IF_RECEIVED: '若到账',
  SAME_PRICE: '同价',
  SPEC_NOT_COVERED: '规格未覆盖',
  PRE_RANGE_PAID: '范围前已付，仅计入成本',
  PAID_BY_UNALLOCATED_LATER: '届时由未分配资金支付',
  PROTECTED_SQUEEZE: '这笔付款会挤占生活、机动等保护性预留 X 元',
  NEED_RECONFIRM: '需重新确认',
  LIVING_ARRANGEMENT_MISSING: '生活安排未提供',
  SIMULATED_DATA: '模拟数据',
}
