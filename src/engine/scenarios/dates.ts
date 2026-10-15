const DAY_MS = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
// D03：偏移固定为 +08:00
const INSTANT = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\+08:00$/

/** 北京时间的日期；time 为 null 表示只给了日期 */
export type Instant = {
  date: string
  time: string | null
}

function formatDay(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10)
}

function dayNumberOf(date: string): number | null {
  const match = DATE.exec(date)
  if (match === null) return null
  const dayNumber = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
  return formatDay(dayNumber) === date ? dayNumber : null
}

export function isDate(text: string): boolean {
  return dayNumberOf(text) !== null
}

export function addDays(date: string, days: number): string {
  const dayNumber = dayNumberOf(date)
  if (dayNumber === null) throw new Error(`不是 YYYY-MM-DD 日期：${date}`)
  return formatDay(dayNumber + days)
}

/** from 至 to 的各日，含首尾 */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(date)
  return days
}

/** 只接受 YYYY-MM-DD 与 YYYY-MM-DDTHH:mm:ss+08:00，其余写法返回 null */
export function parseInstant(text: string): Instant | null {
  if (isDate(text)) return { date: text, time: null }
  const match = INSTANT.exec(text)
  if (match === null || !isDate(match[1])) return null
  return { date: match[1], time: match[2] }
}

/**
 * 可获得时间不晚于 as_of（R008）。
 * SPEC-GAP SG-70：无法解析的按不可获得；只给日期的可获得时间按当日结束计，只给日期的 as_of 按当日开始计。
 */
export function isAvailableBy(availableAt: string, asOf: Instant): boolean {
  const available = parseInstant(availableAt)
  if (available === null) return false
  if (available.date !== asOf.date) return available.date < asOf.date
  if (available.time === null) return false
  if (asOf.time === null) return available.time === '00:00:00'
  return available.time <= asOf.time
}
