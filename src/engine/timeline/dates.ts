const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/

function leapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function monthDays(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function validDate(year: number, month: number, date: number): boolean {
  return month >= 1 && month <= 12 && date >= 1 && date <= monthDays(year, month)
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** 带 +08:00 偏移的时刻（D03）；同一写法的时刻按字符串比较即按时间先后 */
export function isInstant(value: string): boolean {
  const match = INSTANT.exec(value)
  if (match === null) return false
  const clock = Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59
  return clock && validDate(Number(match[1]), Number(match[2]), Number(match[3]))
}

/** 北京时间自然日 YYYY-MM-DD（R008）；不是日期或带 +08:00 的时刻时为 null */
export function dayOf(value: string): string | null {
  const match = DATE_ONLY.exec(value)
  if (match !== null) return validDate(Number(match[1]), Number(match[2]), Number(match[3])) ? value : null
  return isInstant(value) ? value.slice(0, 10) : null
}

/** dayOf 得出的日期的次日 */
export function nextDay(day: string): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  if (date < monthDays(year, month)) return `${pad(year, 4)}-${pad(month, 2)}-${pad(date + 1, 2)}`
  if (month < 12) return `${pad(year, 4)}-${pad(month + 1, 2)}-01`
  return `${pad(year + 1, 4)}-01-01`
}

/** 两个 YYYY-MM-DD 中较晚的一个 */
export function laterDay(left: string, right: string): string {
  return right > left ? right : left
}
