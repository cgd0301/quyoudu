import { CONSUMPTION_CATEGORIES, type ConsumptionCategory } from '../enums.ts'
import type { ConsumptionItemInput } from './types.ts'

export type CategoryFlags = {
  coveredByLivingReserve: boolean
  sameScopeAsDiscretionary: boolean
}

/** D21、D48（DEMO-CFG-1）；null 为不进入日常情景的类别 */
export const CATEGORY_FLAGS: Readonly<Record<ConsumptionCategory, CategoryFlags | null>> = {
  MEALS: { coveredByLivingReserve: true, sameScopeAsDiscretionary: false },
  LOCAL_TRANSPORT: { coveredByLivingReserve: true, sameScopeAsDiscretionary: false },
  DAILY_GOODS: { coveredByLivingReserve: true, sameScopeAsDiscretionary: false },
  ENTERTAINMENT: { coveredByLivingReserve: false, sameScopeAsDiscretionary: true },
  GOAL_RELATED: null,
  INCOME: null,
  REFUND: null,
  TRANSFER: null,
}

export const DAILY_CATEGORIES: readonly ConsumptionCategory[] = CONSUMPTION_CATEGORIES.filter(
  (category) => CATEGORY_FLAGS[category] !== null,
)

export function isDailyCategory(category: ConsumptionCategory): boolean {
  return CATEGORY_FLAGS[category] !== null
}

export function isSameScope(category: ConsumptionCategory): boolean {
  return CATEGORY_FLAGS[category]?.sameScopeAsDiscretionary === true
}

// SPEC-GAP SG-52：记录上写明的标记与 D48 不一致，即类别标注不清
export function flagsConflict(item: ConsumptionItemInput): boolean {
  const flags = CATEGORY_FLAGS[item.category]
  if (flags === null) return false
  return (
    (item.coveredByLivingReserve !== undefined && item.coveredByLivingReserve !== flags.coveredByLivingReserve) ||
    (item.sameScopeAsDiscretionary !== undefined && item.sameScopeAsDiscretionary !== flags.sameScopeAsDiscretionary)
  )
}
