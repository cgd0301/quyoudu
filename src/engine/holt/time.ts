const DAY_MS = 86_400_000
const OFFSET_MS = 8 * 3_600_000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const OFFSET_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function civilDay(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1) return null
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const last = month === 2 && leap ? 29 : MONTH_DAYS[month - 1]
  if (day > last) return null
  return Date.UTC(year, month - 1, day) / DAY_MS
}

/** YYYY-MM-DD 的日序号（1970-01-01 为 0）；不是合法日期时为 null */
export function dayNumber(date: string): number | null {
  const match = DATE_ONLY.exec(date)
  if (match === null) return null
  return civilDay(Number(match[1]), Number(match[2]), Number(match[3]))
}

/** 带 +08:00 偏移的时刻（D03）的毫秒数；其他写法为 null */
export function instantMs(text: string): number | null {
  const match = OFFSET_INSTANT.exec(text)
  if (match === null) return null
  const day = civilDay(Number(match[1]), Number(match[2]), Number(match[3]))
  const [hour, minute, second] = [Number(match[4]), Number(match[5]), Number(match[6])]
  if (day === null || hour > 23 || minute > 59 || second > 59) return null
  return day * DAY_MS + ((hour * 60 + minute) * 60 + second) * 1000 - OFFSET_MS
}

// SPEC-GAP SG-48：只给日期的可获得时间按该日结束计
/** 最晚可能的时刻：只给日期时取次日 00:00+08:00；无法解析时为 null */
export function latestMs(text: string): number | null {
  const day = dayNumber(text)
  if (day !== null) return (day + 1) * DAY_MS - OFFSET_MS
  return instantMs(text)
}

/** 时刻在 +08:00 下所在日的日序号 */
export function localDay(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / DAY_MS)
}
