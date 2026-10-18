/**
 * pnpm survey:intake --input <csv> [--out <dir>] [--schema <schema.json>]
 *
 * 问卷导出件的接收检查：只做结构与完整性检查，不解释回答内容，不生成需求结论。
 *
 * 为什么需要它：真实导出件可能在编码转换、平台改版或字段改名后仍然是“能解析的 CSV”，
 * 直接统计会得到看似正常、实际无意义的数字。本工具在统计之前先回答四个问题：
 * 1. 文件是否完整可读（编码、替换符、连续问号）；
 * 2. 表头是否与受治理的问卷 schema 对齐；
 * 3. 是否存在应答编号与时长字段，能否支持去重与有效性判断；
 * 4. 可读字段里是否含个人标识。
 *
 * 输出：
 * - <out>/inventory.json：机器可读的检查结果（不含任何答卷原文）；
 * - <out>/report.md：人读的检查报告（只在“结构安全”的短取值列上列分布）。
 *
 * 纪律：
 * - 原始文件只读，不复制、不改写、不重命名；
 * - 报告不输出姓名、联系方式、开放题原文；
 * - 判定为阻塞时，不生成任何百分比、人数或需求结论。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from './lib/csv.ts'
import { repoPath, writeFileAtomic } from './lib/repo.ts'
import { bufferSignals, looksLikeEncodingLoss } from './lib/survey-integrity.ts'
import { parseSchema } from './survey-report.ts'

export const DEFAULT_OUT = 'docs/_work/survey/intake'
export const DEFAULT_SCHEMA = 'docs/_work/survey/schema.json'

export type Severity = 'block' | 'warn' | 'info'
export type IntakeIssue = { code: string; severity: Severity; message: string }
export type SafeValue = { value: string; count: number }

export type ColumnProfile = {
  index: number
  header: string
  answered: number
  blank: number
  distinct: number
  maxLength: number
  asciiOnly: boolean
  pii: string[]
  /** 只有“短、纯 ASCII、无个人标识、去重后不超过 12 个取值”的列才给出分布 */
  safeValues: SafeValue[] | null
}

export type DurationStats = {
  startColumn: number
  endColumn: number
  rows: number
  minMinutes: number
  medianMinutes: number
  maxMinutes: number
  underOneMinute: number
  negative: number
}

export type RespondentKey = {
  candidateColumn: number | null
  header: string | null
  uniqueValues: number
  looksSequential: boolean
  note: string
}

export type IntakeVerdict = 'ok' | 'blocked_empty' | 'blocked_unreadable' | 'blocked_schema'

export type IntakeInventory = {
  format: 1
  tool: 'pnpm survey:intake'
  input: { name: string; bytes: number; sha256: string; bom: boolean }
  encoding: {
    nonAsciiBytes: number
    cjkChars: number
    replacementChars: number
    questionMarks: number
    questionMarkRuns: number
  }
  table: {
    headerCells: number
    dataRows: number
    columns: number
    duplicateRows: number
    emptyColumns: number[]
    blankHeaderCells: number[]
  }
  respondents: RespondentKey
  columns: ColumnProfile[]
  durations: DurationStats | null
  verdict: IntakeVerdict
  issues: IntakeIssue[]
}

export type InspectOptions = {
  /** 仅用于报告展示的文件名，不写绝对路径 */
  name: string
  /** 受治理的问卷 schema 文本；缺省时跳过字段对齐检查 */
  schemaText?: string | null
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/
const CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/
const URL = /https?:\/\/[^\s]+/i
const LONG_DIGITS = /^(?:\d[ -]?){15,19}$/

function piiFlags(values: readonly string[]): string[] {
  const flags = new Set<string>()
  for (const value of values) {
    if (EMAIL.test(value)) flags.add('邮箱')
    if (CN_MOBILE.test(value)) flags.add('手机号')
    if (URL.test(value)) flags.add('链接')
    if (LONG_DIGITS.test(value.trim())) flags.add('长数字串')
  }
  return [...flags]
}

function redact(text: string): string {
  return text.replace(new RegExp(EMAIL, 'g'), '[已隐去]').replace(new RegExp(CN_MOBILE, 'g'), '[已隐去]').replace(new RegExp(URL, 'g'), '[已隐去]')
}

/** 表头可能带个人标识或长文本：脱敏、压缩问号串、截断；整段被替换成问号时显式标注 */
function displayHeader(header: string): string {
  const trimmed = header.replace(/[\r\n]+/g, ' ').trim()
  if (trimmed === '') return '（空）'
  if (/^\?+$/.test(trimmed)) return `[?×${trimmed.length}]`
  const compressed = trimmed.replace(/\?{2,}/g, (run) => `[?×${run.length}]`)
  const masked = redact(compressed)
  return masked.length > 60 ? `${masked.slice(0, 60)}…` : masked
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** 支持 M/D/YYYY H:MM、YYYY-MM-DDTHH:MM[:SS]、YYYY/M/D H:MM */
export function parseTimestamp(value: string): number | null {
  const text = value.trim()
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (match !== null) {
    return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0))
  }
  match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text)
  if (match !== null) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0))
  }
  match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (match !== null) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0))
  }
  return null
}

/** 只输出“短、纯 ASCII、无个人标识”的取值分布；其他列一律只给计数 */
function safeDistribution(values: readonly string[]): SafeValue[] | null {
  const nonEmpty = values.map((value) => value.trim()).filter((value) => value !== '')
  if (nonEmpty.length === 0) return null
  const safe = nonEmpty.every((value) => /^[\x20-\x7E]{1,12}$/.test(value) && !/^\?+$/.test(value) && piiFlags([value]).length === 0)
  if (!safe) return null
  const counts = new Map<string, number>()
  for (const value of nonEmpty) counts.set(value, (counts.get(value) ?? 0) + 1)
  if (counts.size > 12) return null
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => (right.count - left.count) || (left.value < right.value ? -1 : 1))
}

function findDuration(header: readonly string[], rows: readonly string[][]): DurationStats | null {
  const timeColumns: number[] = []
  for (let index = 0; index < header.length; index += 1) {
    const values = rows.map((row) => (row[index] ?? '').trim()).filter((value) => value !== '')
    if (values.length === 0) continue
    if (values.every((value) => parseTimestamp(value) !== null)) timeColumns.push(index)
    if (timeColumns.length === 2) break
  }
  if (timeColumns.length < 2) return null
  const startColumn = timeColumns[0] ?? 0
  const endColumn = timeColumns[1] ?? 0
  const minutes: number[] = []
  let negative = 0
  let rowsUsed = 0
  for (const row of rows) {
    const start = parseTimestamp((row[startColumn] ?? '').trim())
    const end = parseTimestamp((row[endColumn] ?? '').trim())
    if (start === null || end === null) continue
    const diff = (end - start) / 60000
    if (diff < 0) negative += 1
    minutes.push(diff)
    rowsUsed += 1
  }
  if (minutes.length === 0) return null
  return {
    startColumn,
    endColumn,
    rows: rowsUsed,
    minMinutes: round1(Math.min(...minutes)),
    medianMinutes: round1(median(minutes)),
    maxMinutes: round1(Math.max(...minutes)),
    underOneMinute: minutes.filter((value) => value < 1).length,
    negative,
  }
}

export function inspectBytes(buffer: Buffer, options: InspectOptions): IntakeInventory {
  const signals = bufferSignals(buffer)
  const text = buffer.toString('utf8')
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const table = parseCsv(text.replace(/^\uFEFF/, ''))
  const header = (table[0] ?? []).map((cell) => cell.trim())
  const rows = table.slice(1).filter((cells) => cells.some((value) => value.trim() !== ''))
  const duplicateRows = rows.length - new Set(rows.map((cells) => JSON.stringify(cells))).size
  const columns: ColumnProfile[] = header.map((name, index) => {
    const values = rows.map((row) => row[index] ?? '')
    const nonEmpty = values.filter((value) => value.trim() !== '')
    return {
      index,
      header: displayHeader(name),
      answered: nonEmpty.length,
      blank: values.length - nonEmpty.length,
      distinct: new Set(nonEmpty.map((value) => value.trim())).size,
      maxLength: nonEmpty.reduce((max, value) => Math.max(max, value.trim().length), 0),
      asciiOnly: nonEmpty.every((value) => /^[\x00-\x7F]*$/.test(value)),
      pii: piiFlags(nonEmpty),
      safeValues: safeDistribution(values),
    }
  })

  const emptyColumns = columns.filter((column) => column.answered === 0).map((column) => column.index)
  const blankHeaderCells = header.map((name, index) => (name === '' ? index : -1)).filter((index) => index >= 0)
  const issues: IntakeIssue[] = []

  if (header.length <= 1 || rows.length === 0) {
    issues.push({ code: 'empty', severity: 'block', message: '文件没有表头或没有数据行' })
  }
  if (looksLikeEncodingLoss(signals)) {
    issues.push({
      code: 'encoding_loss',
      severity: 'block',
      message:
        signals.replacementChars > 0
          ? `编码损坏：检测到 ${signals.replacementChars} 个 U+FFFD 替换符，文件不是有效的 UTF-8`
          : `编码丢失：文件没有非 ASCII 字节，却有 ${signals.questionMarkRuns} 段连续 "?"，中文题干与选项疑似在导出时被替换`,
    })
  }

  let schemaQuestionIds: string[] = []
  if (options.schemaText !== undefined && options.schemaText !== null && options.schemaText.trim() !== '') {
    const schema = parseSchema(options.schemaText)
    schemaQuestionIds = schema.questions.map((question) => question.id)
    const required = new Set<string>(schema.rules.required)
    if (schema.rules.duplicate_key !== null) required.add(schema.rules.duplicate_key)
    if (schema.rules.attention_check !== null) required.add(schema.rules.attention_check.question)
    required.add('meta_submitted_at')
    required.add('meta_duration_seconds')
    const missing = [...required].filter((id) => !header.includes(id))
    if (missing.length > 0) {
      issues.push({
        code: 'schema_mismatch',
        severity: 'block',
        message: `表头缺少 schema 必需字段：${missing.join('、')}；导出件与受治理问卷不是同一套字段`,
      })
    }
    const missingQuestions = schemaQuestionIds.filter((id) => !header.includes(id))
    if (missing.length === 0 && missingQuestions.length > 0) {
      issues.push({
        code: 'schema_partial',
        severity: 'warn',
        message: `表头缺少 ${missingQuestions.length} 个非必答题字段：${missingQuestions.join('、')}；这些题无法统计`,
      })
    }
    const overlap = schemaQuestionIds.filter((id) => header.includes(id)).length
    if (schemaQuestionIds.length > 0 && overlap === 0) {
      issues.push({
        code: 'schema_no_overlap',
        severity: 'warn',
        message: `导出件没有任何字段命中受治理问卷的 ${schemaQuestionIds.length} 个题号：无法建立字段映射，不能把作答列当成 Q1—Q15`,
      })
    }
  }

  const idColumn = header.findIndex((name) => /(^id$|respondent|应答|编号)/i.test(name))
  let respondentKey: RespondentKey
  if (idColumn < 0) {
    respondentKey = {
      candidateColumn: null,
      header: null,
      uniqueValues: 0,
      looksSequential: false,
      note: '未找到应答编号字段：只能确认提交条数，不能确认独立受访者数，也无法识别重复提交',
    }
    issues.push({ code: 'dedupe_missing', severity: 'warn', message: respondentKey.note })
  } else {
    const values = rows.map((row) => (row[idColumn] ?? '').trim()).filter((value) => value !== '')
    const unique = new Set(values).size
    const numeric = values.map((value) => Number(value))
    const looksSequential =
      values.length === rows.length &&
      unique === values.length &&
      numeric.every((value, index) => Number.isSafeInteger(value) && value === index + 1)
    respondentKey = {
      candidateColumn: idColumn,
      header: displayHeader(header[idColumn] ?? ''),
      uniqueValues: unique,
      looksSequential,
      note: looksSequential
        ? `${displayHeader(header[idColumn] ?? '')} 取值为连续行号 1..${values.length}，判断为导出行号而非应答编号：不能据此确认独立受访者数`
        : `存在候选编号字段 ${displayHeader(header[idColumn] ?? '')}（唯一值 ${unique} 个）：仍需人工确认它不是行号或平台流水号`,
    }
    if (looksSequential) issues.push({ code: 'dedupe_unusable', severity: 'warn', message: respondentKey.note })
  }

  const durations = findDuration(header, rows)
  if (durations === null) {
    issues.push({ code: 'duration_unavailable', severity: 'warn', message: '未找到可配对解析的开始/结束时间列：无法判断作答时长' })
  } else if (durations.negative > 0) {
    issues.push({ code: 'duration_negative', severity: 'warn', message: `有 ${durations.negative} 行结束时间早于开始时间：时间列顺序或时区需要人工确认` })
  }

  const piiColumns = columns.filter((column) => column.pii.length > 0)
  if (piiColumns.length > 0) {
    issues.push({
      code: 'pii_detected',
      severity: 'warn',
      message: `有 ${piiColumns.length} 列检出潜在个人标识（${[...new Set(piiColumns.flatMap((column) => column.pii))].join('、')}）；分析前必须排除或脱敏`,
    })
  }
  if (duplicateRows > 0) {
    issues.push({ code: 'duplicate_rows', severity: 'warn', message: `有 ${duplicateRows} 行与另一行完全相同；是否重复提交需要人工确认` })
  }
  if (emptyColumns.length > 0) {
    issues.push({ code: 'empty_columns', severity: 'info', message: `有 ${emptyColumns.length} 列在全部数据行中为空：第 ${emptyColumns.map((index) => index + 1).join('、')} 列` })
  }

  const blocked = issues.some((issue) => issue.severity === 'block')
  const verdict: IntakeVerdict = blocked
    ? issues.some((issue) => issue.code === 'empty')
      ? 'blocked_empty'
      : issues.some((issue) => issue.code === 'encoding_loss')
        ? 'blocked_unreadable'
        : 'blocked_schema'
    : 'ok'

  return {
    format: 1,
    tool: 'pnpm survey:intake',
    input: {
      name: options.name,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bom,
    },
    encoding: signals,
    table: {
      headerCells: header.length,
      dataRows: rows.length,
      columns: header.length,
      duplicateRows,
      emptyColumns,
      blankHeaderCells,
    },
    respondents: respondentKey,
    columns,
    durations,
    verdict,
    issues,
  }
}

const VERDICT_LABEL: Record<IntakeVerdict, string> = {
  ok: '通过（结构与编码可用）',
  blocked_empty: '阻塞（空文件或没有数据行）',
  blocked_unreadable: '阻塞（题干与选项不可读）',
  blocked_schema: '阻塞（字段与受治理问卷不一致）',
}

export function renderIntakeReport(inventory: IntakeInventory): string {
  const lines: string[] = []
  lines.push('# 问卷导出件接收检查', '')
  lines.push(`> 工具：\`${inventory.tool}\`。本报告只做结构与完整性检查，不生成任何需求结论或回答分布。`, '')
  lines.push('## 一、判定', '')
  lines.push(`- 判定：**${VERDICT_LABEL[inventory.verdict]}**`)
  lines.push(`- 能否进入统计：${inventory.verdict === 'ok' ? '可以（仍需按 schema 清洗）' : '不能；在阻塞原因消除前不生成任何统计数字'}`)
  lines.push('- 客户结论：无。阻塞状态不得被解释为“没有需求”“样本为 0”或“付费意愿低”。', '')
  lines.push('## 二、输入与编码', '')
  lines.push('| 项 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 文件名 | \`${inventory.input.name}\` |`)
  lines.push(`| 字节数 | ${inventory.input.bytes} |`)
  lines.push(`| SHA-256 | \`${inventory.input.sha256}\` |`)
  lines.push(`| UTF-8 BOM | ${inventory.input.bom ? '有' : '无'} |`)
  lines.push(`| 非 ASCII 字节 | ${inventory.encoding.nonAsciiBytes} |`)
  lines.push(`| 汉字数 | ${inventory.encoding.cjkChars} |`)
  lines.push(`| U+FFFD 替换符 | ${inventory.encoding.replacementChars} |`)
  lines.push(`| 半角 "?" | ${inventory.encoding.questionMarks}；连续 3 个以上片段 ${inventory.encoding.questionMarkRuns} 段 |`)
  lines.push('')
  lines.push('## 三、表结构', '')
  lines.push('| 项 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 表头单元格 | ${inventory.table.headerCells} |`)
  lines.push(`| 数据行 | ${inventory.table.dataRows} |`)
  lines.push(`| 完全相同的行 | ${inventory.table.duplicateRows} |`)
  lines.push(`| 全空列 | ${inventory.table.emptyColumns.length === 0 ? '无' : inventory.table.emptyColumns.map((index) => `第 ${index + 1} 列`).join('、')} |`)
  lines.push(`| 空表头 | ${inventory.table.blankHeaderCells.length === 0 ? '无' : inventory.table.blankHeaderCells.map((index) => `第 ${index + 1} 列`).join('、')} |`)
  lines.push('')
  lines.push('## 四、列概况（不输出原始单元格）', '')
  lines.push('| 列 | 表头 | 作答 | 空白 | 去重取值 | 最长 | 纯 ASCII | 个人标识 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const column of inventory.columns) {
    lines.push(
      `| ${column.index + 1} | ${column.header} | ${column.answered} | ${column.blank} | ${column.distinct} | ${column.maxLength} | ${column.asciiOnly ? '是' : '否'} | ${column.pii.length === 0 ? '无' : column.pii.join('、')} |`,
    )
  }
  lines.push('')
  const safe = inventory.columns.filter((column) => column.safeValues !== null)
  lines.push('## 五、可读且结构安全的取值分布', '')
  if (safe.length === 0) {
    lines.push('没有列同时满足“短、纯 ASCII、无个人标识、去重后不超过 12 个取值”，因此不输出任何取值分布。')
  } else {
    lines.push('只有下列列满足结构安全条件；这仍然只是“该列写了什么”，不是需求结论。')
    for (const column of safe) {
      lines.push('', `### 第 ${column.index + 1} 列：${column.header}`, '', '| 取值 | 条数 |', '| --- | --- |')
      for (const item of column.safeValues ?? []) lines.push(`| ${item.value} | ${item.count} |`)
    }
  }
  lines.push('')
  lines.push('## 六、应答编号与去重', '')
  lines.push(`- 候选编号列：${inventory.respondents.candidateColumn === null ? '无' : `第 ${inventory.respondents.candidateColumn + 1} 列`}`)
  lines.push(`- 唯一值：${inventory.respondents.uniqueValues}`)
  lines.push(`- 是否为连续行号：${inventory.respondents.looksSequential ? '是' : '否或无法判断'}`)
  lines.push(`- 说明：${inventory.respondents.note}`, '')
  lines.push('## 七、时间列与作答时长', '')
  if (inventory.durations === null) {
    lines.push('未找到可配对解析的开始/结束时间列。')
  } else {
    const d = inventory.durations
    lines.push(`- 列：第 ${d.startColumn + 1} 列 → 第 ${d.endColumn + 1} 列；可用行 ${d.rows}`)
    lines.push(`- 时长（分钟）：最小 ${d.minMinutes}；中位数 ${d.medianMinutes}；最大 ${d.maxMinutes}`)
    lines.push(`- 不足 1 分钟：${d.underOneMinute} 行；结束早于开始：${d.negative} 行`)
    lines.push('- 说明：时间戳只有分钟精度；时长只能作为质量参考，不能单独据此判定答卷无效。')
  }
  lines.push('')
  lines.push('## 八、问题清单', '')
  if (inventory.issues.length === 0) {
    lines.push('未发现问题。')
  } else {
    lines.push('| 级别 | 代码 | 说明 |')
    lines.push('| --- | --- | --- |')
    for (const issue of inventory.issues) {
      const level = issue.severity === 'block' ? '阻塞' : issue.severity === 'warn' ? '警告' : '提示'
      lines.push(`| ${level} | ${issue.code} | ${issue.message} |`)
    }
  }
  lines.push('')
  lines.push('## 九、处置建议', '')
  lines.push('1. 从原始表单或工作簿重新导出 **XLSX** 或 **UTF-8 CSV**；不要使用 Excel for the web 的旧版“下载为 CSV”。')
  lines.push('2. 确认导出件包含题干与选项原文；若线上表单与 `docs/_work/survey/schema.json` 不是同一套题目，提供两版题面与字段映射。')
  lines.push('3. 确认导出件包含应答编号、提交时间与作答时长字段，用于去重、有效性与时长校验。')
  lines.push('4. 检查开放题是否含个人信息；如有，先脱敏再分析，原文不进入报告或项目书。')
  lines.push('5. 把可读导出件放到 `docs/_work/survey/raw/responses.csv`（不入库），运行 `pnpm survey:intake` 与 `pnpm survey:report`。')
  lines.push('')
  lines.push('## 十、隐私边界', '')
  lines.push('- 本报告不包含任何完整答卷行、姓名、联系方式或开放题原文。')
  lines.push('- 原始导出件只读，未复制、未改写；仓库与 Git 中不保存原始答卷。')
  lines.push('- 个人标识只报告“哪一列有、什么类型”，不报告具体值。')
  lines.push('')
  return lines.join('\n')
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

function displayName(file: string): string {
  const absolute = path.resolve(file)
  const relative = path.relative(repoPath(), absolute)
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/')
  return path.basename(absolute)
}

export async function main(argv: readonly string[]): Promise<number> {
  const input = argValue(argv, '--input')
  if (input === undefined) {
    console.error('用法：pnpm survey:intake --input <csv> [--out <dir>] [--schema <schema.json>]')
    return 1
  }
  const outDir = argValue(argv, '--out') ?? DEFAULT_OUT
  const schemaPath = argValue(argv, '--schema') ?? DEFAULT_SCHEMA
  const buffer = readFileSync(path.resolve(input))
  const schemaText = readFileSync(path.resolve(schemaPath), 'utf8')
  const inventory = inspectBytes(buffer, { name: displayName(input), schemaText })
  writeFileAtomic(repoPath(outDir, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  writeFileAtomic(repoPath(outDir, 'report.md'), renderIntakeReport(inventory))
  console.log(
    `已写入 ${outDir}/inventory.json 与 ${outDir}/report.md：判定 ${inventory.verdict}；` +
      `数据行 ${inventory.table.dataRows}、列 ${inventory.table.columns}、阻塞 ${inventory.issues.filter((issue) => issue.severity === 'block').length} 项、警告 ${inventory.issues.filter((issue) => issue.severity === 'warn').length} 项`,
  )
  return 0
}

function isDirectRun(): boolean {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.normalize(path.resolve(invoked)) === path.normalize(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
